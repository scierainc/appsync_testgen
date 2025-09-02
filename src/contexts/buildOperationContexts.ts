// v2.1.0
// - NEW: ensurePytestSharedScaffold(contextsDir) so contexts/_shared/pytest is created
// - Everything else unchanged

//
// Builds per-operation context packages for LLM/test generation.
// ...

import * as vscode from "vscode";
import {
  buildSchema,
  buildClientSchema,
  getIntrospectionQuery,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLType,
  GraphQLNamedType,
  GraphQLInputType,
  isNonNullType,
  isListType,
  getNamedType,
  isScalarType,
  isEnumType,
  isObjectType,
  isInterfaceType,
  isUnionType,
  isInputObjectType,
  printType
} from "graphql";

import { ensurePytestSharedScaffold } from "../utils/scaffold";

/* ----------------------------- Public API ----------------------------- */

export type BuildContextsOptions = {
  /** Folder containing schema.graphql (or schema.introspection.json) and resolvers/ */
  sourceFolder: vscode.Uri;
  /** Output folder for contexts (defaults to sourceFolder/contexts) */
  outFolder?: vscode.Uri;
  /** Selection depth for building default selection sets (0 = no selections) */
  selectionDepth?: number; // default 1
  /** Max fields per object level in selection set (avoid huge docs) */
  maxFieldsPerLevel?: number; // default 20
  /** Depth for returnTree expansion (how deep we expand nested object shapes) */
  returnTreeDepth?: number; // default 2
  /** Max fields to include per object in returnTree */
  returnTreeMaxFields?: number; // default 25
};

export async function buildPerOperationContexts(opts: BuildContextsOptions): Promise<{ total: number }> {
  const source = opts.sourceFolder;
  const outRoot = opts.outFolder ?? source;

  const schemaSdl = vscode.Uri.joinPath(source, "schema.graphql");
  const schemaJson = vscode.Uri.joinPath(source, "schema.introspection.json");
  const resolversRoot = vscode.Uri.joinPath(source, "resolvers");

  const schema = await loadSchema(schemaSdl, schemaJson);

  // Where to write contexts
  const contextsDir = vscode.Uri.joinPath(outRoot, "contexts");
  await vscode.workspace.fs.createDirectory(contextsDir);

  // ✅ NEW: create pytest shared scaffold under contexts/
  try {
    await ensurePytestSharedScaffold(contextsDir);
  } catch {
    // soft-fail; materializeTests will scaffold under testsRoot as well
  }

  const operations = enumerateOperations(schema);

  let total = 0;
  for (const op of operations) {
    const closure = collectTypeClosureForOperation(schema, op);
    const prunedSdl = composePrunedSDL(schema, op, closure);

    const { operationDoc, variablesSkeleton } = buildOperationDocument(schema, op, {
      depth: opts.selectionDepth ?? 1,
      maxFields: opts.maxFieldsPerLevel ?? 20
    });

    const returnTree = buildReturnTree(schema, op.returnType, {
      depth: opts.returnTreeDepth ?? 2,
      maxFields: opts.returnTreeMaxFields ?? 25
    });

    const opDirName = `${op.parentType}.${op.fieldName}`;
    const opDir = vscode.Uri.joinPath(contextsDir, opDirName);
    await vscode.workspace.fs.createDirectory(opDir);

    const sdlUri = vscode.Uri.joinPath(opDir, "operation.sdl.graphql");
    const gqlUri = vscode.Uri.joinPath(opDir, "operation.graphql");
    await vscode.workspace.fs.writeFile(sdlUri, Buffer.from(prunedSdl, "utf8"));
    await vscode.workspace.fs.writeFile(gqlUri, Buffer.from(operationDoc, "utf8"));

    const resolverSrcDir = vscode.Uri.joinPath(resolversRoot, op.parentType, op.fieldName);
    const resolverOutDir = vscode.Uri.joinPath(opDir, "resolver");
    await copyResolverArtifacts(resolverSrcDir, resolverOutDir);

    const contextMeta = {
      operation: {
        type: op.operationType,
        parentType: op.parentType,
        fieldName: op.fieldName
      },
      args: op.args.map((a) => ({
        name: a.name,
        type: renderTypeRef(a.type)
      })),
      returnType: renderTypeRef(op.returnType),
      variablesSkeleton,
      typeClosure: Array.from(closure).sort(),
      returnTree
    };
    const ctxUri = vscode.Uri.joinPath(opDir, "context.json");
    await vscode.workspace.fs.writeFile(ctxUri, Buffer.from(JSON.stringify(contextMeta, null, 2), "utf8"));

    total++;
  }

  return { total };
}


/* --------------------------- Schema Loading --------------------------- */

async function loadSchema(schemaSdlUri: vscode.Uri, schemaJsonUri: vscode.Uri): Promise<GraphQLSchema> {
  const jsonExists = await exists(schemaJsonUri);
  const sdlExists  = await exists(schemaSdlUri);

  if (!jsonExists && !sdlExists) {
    throw new Error(
      `Missing schema files. Expected either:\n- ${schemaSdlUri.fsPath}\n- or ${schemaJsonUri.fsPath}`
    );
  }

  // Prefer JSON: it includes everything needed and avoids unknown directive issues
  if (jsonExists) {
    const raw = await readText(schemaJsonUri);
    const json = JSON.parse(raw);
    return buildClientSchema(json.data ?? json); // tolerate { data: {...} } or raw
  }

  // Fallback to SDL: be lenient and strip AppSync-specific directives if needed
  const sdlRaw = await readText(schemaSdlUri);

  // Try a lenient build first
  try {
    // @ts-ignore graphql-js v16 accepts assumeValidSDL
    return buildSchema(sdlRaw, { assumeValidSDL: true });
  } catch {
    const cleaned = stripAwsRuntimeDirectives(sdlRaw);
    // @ts-ignore graphql-js v16 accepts assumeValidSDL
    return buildSchema(cleaned, { assumeValidSDL: true });
  }
}

/** Remove AppSync runtime directive usages like @aws_auth, @aws_iam, @aws_api_key, @aws_oidc, @aws_cognito_user_pools */
function stripAwsRuntimeDirectives(sdl: string): string {
  return sdl.replace(/@aws[_a-zA-Z0-9]*(\s*\([^)]*\))?/g, "").replace(/[ \t]+$/gm, "");
}

/* -------------------------- Operation Discovery ----------------------- */

export type OperationField = {
  operationType: "query" | "mutation" | "subscription";
  parentType: string; // usually Query/Mutation/Subscription (actual root type name)
  fieldName: string;
  args: Array<{ name: string; type: GraphQLInputType }>;
  returnType: GraphQLType;
};

function enumerateOperations(schema: GraphQLSchema): OperationField[] {
  const out: OperationField[] = [];

  const items: Array<{ op: "query" | "mutation" | "subscription"; type: GraphQLObjectType | null }> = [
    { op: "query",        type: schema.getQueryType()        ?? null },
    { op: "mutation",     type: schema.getMutationType()     ?? null },
    { op: "subscription", type: schema.getSubscriptionType() ?? null }
  ];

  for (const { op, type } of items) {
    if (!type) continue;
    const fields = type.getFields();
    for (const name of Object.keys(fields)) {
      const f = fields[name];
      out.push({
        operationType: op,
        parentType: type.name,
        fieldName: name,
        args: f.args.map((a) => ({ name: a.name, type: a.type })),
        returnType: f.type
      });
    }
  }

  return out.sort((a, b) => (a.parentType + "." + a.fieldName).localeCompare(b.parentType + "." + b.fieldName));
}

/* ------------------------- Type Closure (Minimal) --------------------- */

function collectTypeClosureForOperation(schema: GraphQLSchema, op: OperationField): Set<string> {
  const keep = new Set<string>();

  // Add root parent type & field types
  keep.add(op.parentType);

  // Args (input side)
  for (const a of op.args) addInputTypeClosure(getNamedType(a.type), keep, schema);

  // Return (output side)
  addOutputTypeClosure(getNamedType(op.returnType), keep, schema);

  return keep;
}

function addInputTypeClosure(named: GraphQLNamedType, keep: Set<string>, schema: GraphQLSchema) {
  if (isScalarType(named) || isEnumType(named)) {
    keep.add(named.name);
    return;
  }
  if (isInputObjectType(named)) {
    if (keep.has(named.name)) return;
    keep.add(named.name);
    for (const field of Object.values(named.getFields())) {
      addInputTypeClosure(getNamedType(field.type), keep, schema);
    }
    return;
  }
  if (isObjectType(named) || isInterfaceType(named) || isUnionType(named)) {
    keep.add(named.name);
  }
}

function addOutputTypeClosure(named: GraphQLNamedType, keep: Set<string>, schema: GraphQLSchema) {
  if (isScalarType(named) || isEnumType(named)) {
    keep.add(named.name);
    return;
  }
  if (isObjectType(named)) {
    if (keep.has(named.name)) return;
    keep.add(named.name);
    for (const iface of named.getInterfaces()) addOutputTypeClosure(iface, keep, schema);
    for (const field of Object.values(named.getFields())) {
      addOutputTypeClosure(getNamedType(field.type), keep, schema);
      for (const arg of field.args) addInputTypeClosure(getNamedType(arg.type), keep, schema);
    }
    return;
  }
  if (isInterfaceType(named)) {
    if (keep.has(named.name)) return;
    keep.add(named.name);
    for (const field of Object.values(named.getFields())) {
      addOutputTypeClosure(getNamedType(field.type), keep, schema);
      for (const arg of field.args) addInputTypeClosure(getNamedType(arg.type), keep, schema);
    }
    const impls = schema.getPossibleTypes(named);
    for (const impl of impls) addOutputTypeClosure(impl, keep, schema);
    return;
  }
  if (isUnionType(named)) {
    if (keep.has(named.name)) return;
    keep.add(named.name);
    for (const m of named.getTypes()) addOutputTypeClosure(m, keep, schema);
    return;
  }
  if (isInputObjectType(named)) {
    addInputTypeClosure(named, keep, schema);
  }
}

/* ----------------------- SDL Composition (Pruned) --------------------- */

function composePrunedSDL(schema: GraphQLSchema, op: OperationField, keep: Set<string>): string {
  // 1) Root type with ONLY the single field
  const rootFieldSig = renderRootFieldSignature(schema, op);
  const rootBlock = `type ${op.parentType} {\n  ${rootFieldSig}\n}\n`;

  // 2) Add definitions for every kept named type EXCEPT the parent root type
  const lines: string[] = [rootBlock];

  for (const name of Array.from(keep).sort()) {
    if (name === op.parentType) continue;
    const t = schema.getType(name);
    if (!t) continue;
    if (isBuiltInScalar(name)) continue;

    try {
      lines.push(printType(t));
    } catch {
      // ignore
    }
  }

  return lines.join("\n\n") + "\n";
}

function isBuiltInScalar(name: string) {
  return name === "String" || name === "Int" || name === "Float" || name === "Boolean" || name === "ID";
}

function renderRootFieldSignature(schema: GraphQLSchema, op: OperationField): string {
  const argList =
    op.args.length === 0
      ? ""
      : "(" +
        op.args
          .map((a) => `${a.name}: ${renderTypeRef(a.type)}`)
          .join(", ") +
        ")";

  return `${op.fieldName}${argList}: ${renderTypeRef(op.returnType)}`;
}

function renderTypeRef(t: GraphQLType): string {
  if (isNonNullType(t)) return `${renderTypeRef(t.ofType)}!`;
  if (isListType(t)) return `[${renderTypeRef(t.ofType)}]`;
  return getNamedType(t).name;
}

/* ------------------ Operation Doc & Variables Skeleton ---------------- */

function buildOperationDocument(
  schema: GraphQLSchema,
  op: OperationField,
  opts: { depth: number; maxFields: number }
): { operationDoc: string; variablesSkeleton: Record<string, unknown> } {
  const varsDecl = op.args.length
    ? "(" + op.args.map((a) => `$${a.name}: ${renderTypeRef(a.type)}`).join(", ") + ")"
    : "";
  const varsUse = op.args.length
    ? "(" + op.args.map((a) => `${a.name}: $${a.name}`).join(", ") + ")"
    : "";

  const namedReturn = getNamedType(op.returnType);
  const selection = buildSelectionSet(schema, namedReturn, {
    depth: Math.max(0, opts.depth),
    maxFields: Math.max(1, opts.maxFields)
  });

  const opName = `${capitalize(op.operationType)}_${op.fieldName}`;
  const operationDoc =
    `${op.operationType} ${opName}${varsDecl} {\n` +
    `  ${op.fieldName}${varsUse}${selection ? ` ${selection}` : ""}\n` +
    `}\n`;

  const variablesSkeleton: Record<string, unknown> = {};
  for (const a of op.args) {
    variablesSkeleton[a.name] = defaultValueForInput(schema, a.type);
  }

  return { operationDoc, variablesSkeleton };
}

function buildSelectionSet(
  schema: GraphQLSchema,
  named: GraphQLNamedType,
  opts: { depth: number; maxFields: number }
): string {
  if (isScalarType(named) || isEnumType(named)) return "";

  const fields: Array<{ name: string; type: GraphQLType }> = [];
  if (isObjectType(named) || isInterfaceType(named)) {
    for (const [fname, f] of Object.entries(named.getFields())) {
      fields.push({ name: fname, type: f.type });
    }
  } else if (isUnionType(named)) {
    const parts: string[] = [];
    for (const t of named.getTypes()) {
      const sel = buildSelectionSet(schema, t, opts);
      parts.push(`  ... on ${t.name}${sel ? ` ${sel}` : ""}`);
    }
    return parts.length ? `{\n${parts.join("\n")}\n}` : "";
  } else {
    return "";
  }

  fields.sort((a, b) => priorityForField(a.name) - priorityForField(b.name));

  const picked = fields.slice(0, opts.maxFields);
  const lines: string[] = [];

  for (const f of picked) {
    const nt = getNamedType(f.type);
    if (isScalarType(nt) || isEnumType(nt)) {
      lines.push(`  ${f.name}`);
    } else if (opts.depth > 0) {
      const inner = buildSelectionSet(schema, nt, { depth: opts.depth - 1, maxFields: opts.maxFields });
      lines.push(`  ${f.name}${inner ? ` ${inner}` : ""}`);
    } else {
      lines.push(`  ${f.name}`);
    }
  }

  return lines.length ? `{\n${lines.join("\n")}\n}` : "";
}

function priorityForField(name: string): number {
  if (name === "id" || name.endsWith("Id") || name.endsWith("ID")) return 0;
  if (name === "name" || name.startsWith("name")) return 1;
  if (name === "__typename") return 9999;
  return 10;
}

/* ------------------------- Input Value Skeletons ---------------------- */

function defaultValueForInput(schema: GraphQLSchema, t: GraphQLInputType): unknown {
  if (isNonNullType(t)) return defaultValueForInput(schema, t.ofType as GraphQLInputType);
  if (isListType(t)) return [defaultValueForInput(schema, t.ofType as GraphQLInputType)];

  const named = getNamedType(t);
  if (isScalarType(named)) {
    switch (named.name) {
      case "ID":
      case "AWSID":
        return "<ID>";
      case "String":
      case "AWSDate":
      case "AWSDateTime":
      case "AWSTime":
      case "AWSTimestamp":
      case "AWSPhone":
      case "AWSEmail":
      case "AWSJSON":
        return `<${named.name}>`;
      case "Int":
      case "AWSInteger":
        return 0;
      case "Float":
        return 0.0;
      case "Boolean":
        return true;
      default:
        return `<${named.name}>`; // custom scalar placeholder
    }
  }
  if (isEnumType(named)) {
    const vals = named.getValues();
    return vals.length ? vals[0].name : "<ENUM>";
  }
  if (isInputObjectType(named)) {
    const obj: Record<string, unknown> = {};
    for (const [fname, f] of Object.entries(named.getFields())) {
      obj[fname] = defaultValueForInput(schema, f.type);
    }
    return obj;
  }
  return null;
}

/* ------------------------ Return Tree (NEW) --------------------------- */

type ReturnTree =
  | string // leaf scalars/enums/custom scalars => "Type", "Type!", "[Type!]", etc.
  | { __type: string; __kind: "OBJECT" | "INTERFACE"; fields: Record<string, ReturnTree>; __nonNull?: boolean; __truncated?: boolean; __implements?: string[] }
  | { __type: string; __kind: "UNION"; variants: ReturnTree[]; __nonNull?: boolean }
  | ReturnTree[]; // list wrapper: [innerShape]

function buildReturnTree(
  schema: GraphQLSchema,
  t: GraphQLType,
  opts: { depth: number; maxFields: number },
  seen: Set<string> = new Set()
): ReturnTree {
  // Handle non-null wrapper
  if (isNonNullType(t)) {
    const inner = buildReturnTree(schema, t.ofType, opts, seen);
    return appendNonNull(inner);
  }
  // Handle list wrapper
  if (isListType(t)) {
    const inner = buildReturnTree(schema, t.ofType, opts, seen);
    return [inner];
  }

  const named = getNamedType(t);

  if (isScalarType(named) || isEnumType(named)) {
    return named.name;
  }

  if (isObjectType(named) || isInterfaceType(named)) {
    // Prevent cycles
    if (seen.has(named.name) || opts.depth <= 0) {
      return { __type: named.name, __kind: isObjectType(named) ? "OBJECT" : "INTERFACE", fields: {}, __truncated: true };
    }

    const nextSeen = new Set(seen);
    nextSeen.add(named.name);

    const allFields = Object.entries(named.getFields());
    // Prioritize id/name-ish fields
    allFields.sort((a, b) => priorityForField(a[0]) - priorityForField(b[0]));
    const picked = allFields.slice(0, opts.maxFields);

    const fields: Record<string, ReturnTree> = {};
    for (const [fname, f] of picked) {
      fields[fname] = buildReturnTree(schema, f.type, { depth: opts.depth - 1, maxFields: opts.maxFields }, nextSeen);
    }

    const base: any = {
      __type: named.name,
      __kind: isObjectType(named) ? "OBJECT" : "INTERFACE",
      fields
    };

    if (isInterfaceType(named)) {
      base.__implements = schema.getPossibleTypes(named).map((x) => x.name);
    }

    return base;
  }

  if (isUnionType(named)) {
    if (seen.has(named.name) || opts.depth <= 0) {
      return { __type: named.name, __kind: "UNION", variants: [], __nonNull: false };
    }
    const nextSeen = new Set(seen);
    nextSeen.add(named.name);
    const variants = named.getTypes().slice(0, opts.maxFields).map((m) =>
      buildReturnTree(schema, m, { depth: opts.depth - 1, maxFields: opts.maxFields }, nextSeen)
    );
    return { __type: named.name, __kind: "UNION", variants };
  }

  // Fallback: unknown named kind (shouldn't happen)
  return getNamedType(t).name;
}

function appendNonNull(shape: ReturnTree): ReturnTree {
  if (typeof shape === "string") return shape + "!";
  if (Array.isArray(shape)) return Object.assign([], shape, { __nonNull: true }) as any;
  return { ...shape, __nonNull: true };
}

/* -------------------------- Resolver Copying -------------------------- */

async function copyResolverArtifacts(srcDir: vscode.Uri, dstDir: vscode.Uri) {
  if (!(await exists(srcDir))) return; // nothing to copy
  await vscode.workspace.fs.createDirectory(dstDir);

  const candidates = ["request.vtl", "response.vtl", "code.js", "resolver.meta.json"];
  for (const name of candidates) {
    const src = vscode.Uri.joinPath(srcDir, name);
    if (await exists(src)) {
      const buf = await vscode.workspace.fs.readFile(src);
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dstDir, name), buf);
    }
  }
}

/* ------------------------------ FS utils ------------------------------ */

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
async function readText(uri: vscode.Uri): Promise<string> {
  const buf = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(buf).toString("utf8");
}
function capitalize(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
