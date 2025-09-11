// v2.1.2 — buildOperationContexts.ts
// - Fix: eliminate “void → GraphQLNamedType” and “never.name” errors by using safe accessors and relaxed
//        types at GraphQL traversal points.
// - Keep: pytest scaffold under contexts/_shared/pytest via ensurePytestSharedScaffold()
// - Outputs: pruned SDL, operation.graphql, context.json (+ resolver copies)

import * as vscode from "vscode";
import {
  buildSchema,
  buildClientSchema,
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
  printType,
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

export async function buildPerOperationContexts(
  opts: BuildContextsOptions
): Promise<{ total: number }> {
  const source = opts.sourceFolder;
  const outRoot = opts.outFolder ?? source;

  const schemaSdl = vscode.Uri.joinPath(source, "schema.graphql");
  const schemaJson = vscode.Uri.joinPath(source, "schema.introspection.json");
  const resolversRoot = vscode.Uri.joinPath(source, "resolvers");

  const schema = await loadSchema(schemaSdl, schemaJson);

  // Where to write contexts
  const contextsDir = vscode.Uri.joinPath(outRoot, "contexts");
  await vscode.workspace.fs.createDirectory(contextsDir);

  // Create pytest shared scaffold under contexts/
  try {
    await ensurePytestSharedScaffold(contextsDir);
  } catch {
    // soft-fail; tests materializer also scaffolds at testsRoot if needed
  }

  const operations = enumerateOperations(schema);

  let total = 0;
  for (const op of operations) {
    const closure = collectTypeClosureForOperation(schema, op);
    const prunedSdl = composePrunedSDL(schema, op, closure);

    const { operationDoc, variablesSkeleton } = buildOperationDocument(schema, op, {
      depth: opts.selectionDepth ?? 1,
      maxFields: opts.maxFieldsPerLevel ?? 20,
    });

    const returnTree = buildReturnTree(schema, op.returnType, {
      depth: opts.returnTreeDepth ?? 2,
      maxFields: opts.returnTreeMaxFields ?? 25,
    });

    // contexts/<Type>.<field>/
    const opDirName = `${op.parentType}.${op.fieldName}`;
    const opDir = vscode.Uri.joinPath(contextsDir, opDirName);
    await vscode.workspace.fs.createDirectory(opDir);

    // Write SDL + operation
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(opDir, "operation.sdl.graphql"),
      Buffer.from(prunedSdl, "utf8")
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(opDir, "operation.graphql"),
      Buffer.from(operationDoc, "utf8")
    );

    // Copy resolver artifacts if present
    const resolverSrcDir = vscode.Uri.joinPath(resolversRoot, op.parentType, op.fieldName);
    const resolverOutDir = vscode.Uri.joinPath(opDir, "resolver");
    await copyResolverArtifacts(resolverSrcDir, resolverOutDir);

    // context.json metadata
    const contextMeta = {
      operation: {
        type: op.operationType, // "query" | "mutation" | "subscription"
        parentType: op.parentType,
        fieldName: op.fieldName,
      },
      args: op.args.map((a) => ({
        name: a.name,
        type: renderTypeRef(a.type),
      })),
      returnType: renderTypeRef(op.returnType),
      variablesSkeleton,
      typeClosure: Array.from(closure).sort(),
      returnTree,
    };
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(opDir, "context.json"),
      Buffer.from(JSON.stringify(contextMeta, null, 2), "utf8")
    );

    total++;
  }

  return { total };
}

/* --------------------------- Schema Loading --------------------------- */

async function loadSchema(schemaSdlUri: vscode.Uri, schemaJsonUri: vscode.Uri): Promise<GraphQLSchema> {
  const jsonExists = await exists(schemaJsonUri);
  const sdlExists = await exists(schemaSdlUri);

  if (!jsonExists && !sdlExists) {
    throw new Error(
      `Missing schema files. Expected either:\n- ${schemaSdlUri.fsPath}\n- or ${schemaJsonUri.fsPath}`
    );
  }

  // Prefer JSON: includes everything and avoids unknown directive issues
  if (jsonExists) {
    const raw = await readText(schemaJsonUri);
    const json = JSON.parse(raw);
    return buildClientSchema(json.data ?? json); // tolerate { data: {...} } or raw
  }

  // Fallback to SDL: lenient, strip AppSync runtime directives if needed
  const sdlRaw = await readText(schemaSdlUri);
  try {
    // @ts-ignore graphql-js v16 accepts assumeValidSDL
    return buildSchema(sdlRaw, { assumeValidSDL: true });
  } catch {
    const cleaned = stripAwsRuntimeDirectives(sdlRaw);
    // @ts-ignore graphql-js v16 accepts assumeValidSDL
    return buildSchema(cleaned, { assumeValidSDL: true });
  }
}

/** Remove AppSync runtime directive usages like @aws_auth, @aws_iam, etc. */
function stripAwsRuntimeDirectives(sdl: string): string {
  return sdl.replace(/@aws[_a-zA-Z0-9]*(\s*\([^)]*\))?/g, "").replace(/[ \t]+$/gm, "");
}

/* -------------------------- Operation Discovery ----------------------- */

export type OperationField = {
  operationType: "query" | "mutation" | "subscription";
  parentType: string; // actual root name
  fieldName: string;
  args: Array<{ name: string; type: GraphQLInputType }>;
  returnType: GraphQLType;
};

function enumerateOperations(schema: GraphQLSchema): OperationField[] {
  const out: OperationField[] = [];

  const items: Array<{ op: "query" | "mutation" | "subscription"; type: GraphQLObjectType | null }> = [
    { op: "query", type: schema.getQueryType() ?? null },
    { op: "mutation", type: schema.getMutationType() ?? null },
    { op: "subscription", type: schema.getSubscriptionType() ?? null },
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
        returnType: f.type,
      });
    }
  }

  return out.sort((a, b) =>
    (a.parentType + "." + a.fieldName).localeCompare(b.parentType + "." + b.fieldName)
  );
}

/* ---------------------------- Safe accessors -------------------------- */

function getFieldsSafe(named: any): Record<string, any> {
  try {
    const f = named?.getFields?.();
    if (f && typeof f === "object") return f as Record<string, any>;
  } catch {}
  return {};
}
function getInterfacesSafe(named: any): any[] {
  try {
    const fn = named?.getInterfaces;
    const arr = typeof fn === "function" ? fn.call(named) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {}
  return [];
}
function getTypesSafe(named: any): any[] {
  try {
    const fn = named?.getTypes;
    const arr = typeof fn === "function" ? fn.call(named) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {}
  return [];
}
function getEnumValuesSafe(named: any): any[] {
  try {
    const fn = named?.getValues;
    const arr = typeof fn === "function" ? fn.call(named) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {}
  return [];
}

/* ------------------------- Type Closure (Minimal) --------------------- */

function collectTypeClosureForOperation(schema: GraphQLSchema, op: OperationField): Set<string> {
  const keep = new Set<string>();

  // Root parent type
  keep.add(op.parentType);

  // Args (input side)
  for (const a of op.args) addInputTypeClosure(getNamedType(a.type), keep, schema);

  // Return (output side)
  addOutputTypeClosure(getNamedType(op.returnType), keep, schema);

  return keep;
}

function addInputTypeClosure(named: any, keep: Set<string>, schema: GraphQLSchema) {
  if (!named) return;
  if (isScalarType(named) || isEnumType(named)) {
    keep.add(named.name);
    return;
  }
  if (isInputObjectType(named)) {
    if (keep.has(named.name)) return;
    keep.add(named.name);
    for (const field of Object.values(getFieldsSafe(named))) {
      addInputTypeClosure(getNamedType(field.type), keep, schema);
    }
    return;
  }
  if (isObjectType(named) || isInterfaceType(named) || isUnionType(named)) {
    keep.add(named.name);
  }
}

function addOutputTypeClosure(named: any, keep: Set<string>, schema: GraphQLSchema) {
  if (!named) return;
  if (isScalarType(named) || isEnumType(named)) {
    keep.add(named.name);
    return;
  }
  if (isObjectType(named)) {
    if (keep.has(named.name)) return;
    keep.add(named.name);
    for (const iface of getInterfacesSafe(named)) addOutputTypeClosure(iface, keep, schema);
    for (const field of Object.values(getFieldsSafe(named))) {
      addOutputTypeClosure(getNamedType(field.type), keep, schema);
      for (const arg of field.args ?? []) addInputTypeClosure(getNamedType(arg.type), keep, schema);
    }
    return;
  }
  if (isInterfaceType(named)) {
    if (keep.has(named.name)) return;
    keep.add(named.name);
    for (const field of Object.values(getFieldsSafe(named))) {
      addOutputTypeClosure(getNamedType(field.type), keep, schema);
      for (const arg of field.args ?? []) addInputTypeClosure(getNamedType(arg.type), keep, schema);
    }
    const impls = schema.getPossibleTypes(named);
    for (const impl of impls) addOutputTypeClosure(impl, keep, schema);
    return;
  }
  if (isUnionType(named)) {
    if (keep.has(named.name)) return;
    keep.add(named.name);
    for (const m of getTypesSafe(named)) addOutputTypeClosure(m, keep, schema);
    return;
  }
  if (isInputObjectType(named)) {
    addInputTypeClosure(named, keep, schema);
  }
}

/* ----------------------- SDL Composition (Pruned) --------------------- */

function composePrunedSDL(schema: GraphQLSchema, op: OperationField, keep: Set<string>): string {
  // 1) Root type block containing ONLY the single field for this operation
  const rootFieldSig = renderRootFieldSignature(op);
  const rootBlock = `type ${op.parentType} {\n  ${rootFieldSig}\n}\n`;

  const lines: string[] = [rootBlock];

  // 2) Render every kept named type except the parent root
  for (const name of Array.from(keep).sort()) {
    if (name === op.parentType) continue;
    if (isBuiltInScalar(name)) continue;

    const t = schema.getType(name);
    if (!t) {
      lines.push(`# WARN: type '${name}' was in closure but not found in schema`);
      continue;
    }

    try {
      // Prefer GraphQL’s printer
      lines.push(printType(t));
    } catch {
      // Fallback: synthesize SDL directly, using safe any-casts
      try {
        const s = renderNamedTypeSDL(schema, t as GraphQLNamedType);
        if (s.trim()) lines.push(s);
      } catch (e: any) {
        lines.push(`# WARN: failed to render type '${name}': ${String(e?.message ?? e)}`);
      }
    }
  }

  return lines.join("\n\n") + "\n";
}

function renderNamedTypeSDL(_schema: GraphQLSchema, named: any): string {
  // Scalars & enums
  if (isScalarType(named)) {
    // built-ins are skipped earlier; custom scalars still printed here
    return `scalar ${named.name}`;
  }
  if (isEnumType(named)) {
    const vals = getEnumValuesSafe(named).map((v: any) => `  ${v.name}`).join("\n");
    return `enum ${named.name} {\n${vals}\n}`;
  }

  // Input objects
  if (isInputObjectType(named)) {
    const fields = Object.values(getFieldsSafe(named))
      .map((f: any) => `  ${f.name}: ${renderTypeRef(f.type)}`)
      .join("\n");
    return `input ${named.name} {\n${fields}\n}`;
  }

  // Objects & interfaces
  if (isObjectType(named) || isInterfaceType(named)) {
    const fieldEntries = Object.values(getFieldsSafe(named))
      .map((f: any) => {
        const argsArr: any[] = Array.isArray(f.args) ? f.args : [];
        const args = argsArr.length
          ? "(" + argsArr.map((a: any) => `${a.name}: ${renderTypeRef(a.type)}`).join(", ") + ")"
          : "";
        return `  ${f.name}${args}: ${renderTypeRef(f.type)}`;
      })
      .join("\n");

    if (isObjectType(named)) {
      const impls: any[] = getInterfacesSafe(named);
      const implSuffix = impls.length ? " implements " + impls.map((i: any) => i.name).join(" & ") : "";
      return `type ${named.name}${implSuffix} {\n${fieldEntries}\n}`;
    } else {
      return `interface ${named.name} {\n${fieldEntries}\n}`;
    }
  }

  // Unions
  if (isUnionType(named)) {
    const members: any[] = getTypesSafe(named);
    const joined = members.map((t: any) => t.name).join(" | ");
    return `union ${named.name} = ${joined}`;
  }

  // Last resort
  return `# could not render type ${named?.name ?? "(unknown)"}`;
}

function isBuiltInScalar(name: string) {
  return name === "String" || name === "Int" || name === "Float" || name === "Boolean" || name === "ID";
}

function renderRootFieldSignature(op: OperationField): string {
  const argList =
    op.args.length === 0
      ? ""
      : "(" + op.args.map((a) => `${a.name}: ${renderTypeRef(a.type)}`).join(", ") + ")";
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
    maxFields: Math.max(1, opts.maxFields),
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
  // Scalars/enums never need a sub-selection
  if (isScalarType(named) || isEnumType(named)) return "";

  // Object / Interface
  if (isObjectType(named) || isInterfaceType(named)) {
    // Gather fields and sort by priority
    const all = Object.entries(named.getFields())
      .map(([fname, f]) => ({ name: fname, type: f.type }));
    all.sort((a, b) => priorityForField(a.name) - priorityForField(b.name));

    const picked = all.slice(0, Math.max(1, opts.maxFields));
    const lines: string[] = [];

    for (const f of picked) {
      const nt = getNamedType(f.type);

      // If leaf (scalar/enum), select directly
      if (isScalarType(nt) || isEnumType(nt)) {
        lines.push(`  ${f.name}`);
        continue;
      }

      // Non-leaf: we *must* provide a sub-selection
      if (opts.depth > 0) {
        const inner = buildSelectionSet(schema, nt, { depth: opts.depth - 1, maxFields: opts.maxFields });
        lines.push(`  ${f.name}${inner ? ` ${inner}` : " { __typename }"}`);
      } else {
        // Depth exhausted -> emit a minimal valid selection
        lines.push(`  ${f.name} ${minimalSelectionForComposite(schema, nt)}`);
      }
    }

    return lines.length ? `{\n${lines.join("\n")}\n}` : "";
  }

  // Union
  if (isUnionType(named)) {
    const parts: string[] = [];
    for (const t of named.getTypes()) {
      const inner =
        opts.depth > 0
          ? buildSelectionSet(schema, t, { depth: opts.depth - 1, maxFields: opts.maxFields })
          : minimalSelectionForComposite(schema, t);
      parts.push(`  ... on ${t.name} ${inner}`);
    }
    return parts.length ? `{\n${parts.join("\n")}\n}` : "";
  }

  // Fallback (shouldn't happen)
  return "";
}

/** Minimal valid selection for an object/interface (or for a union member when depth=0). */
function minimalSelectionForComposite(schema: GraphQLSchema, named: GraphQLNamedType): string {
  // For objects/interfaces, try to pick a couple of scalar-ish fields; else __typename
  if (isObjectType(named) || isInterfaceType(named)) {
    const fields = named.getFields();
    const entries = Object.entries(fields)
      .map(([name, f]) => ({ name, t: getNamedType(f.type) }));

    // prefer id/name-like fields first
    entries.sort((a, b) => priorityForField(a.name) - priorityForField(b.name));

    const scalars = entries.filter(e => isScalarType(e.t) || isEnumType(e.t)).map(e => e.name);
    const take = scalars.slice(0, Math.max(1, 2)); // pick 1–2 scalars if available

    if (take.length) {
      return `{\n    ${take.join("\n    ")}\n  }`;
    }
    return `{\n    __typename\n  }`;
  }

  // For unions, we’ll be called with a member type; recurse to object/interface case
  if (isUnionType(named)) {
    // choose first member and give its minimal selection
    const m = named.getTypes()[0];
    if (m) return `{\n    ... on ${m.name} ${minimalSelectionForComposite(schema, m)}\n  }`;
    return `{\n    __typename\n  }`;
  }

  // Default fallback
  return `{\n    __typename\n  }`;
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
    const vals = getEnumValuesSafe(named);
    return vals.length ? vals[0].name : "<ENUM>";
  }
  if (isInputObjectType(named)) {
    const obj: Record<string, unknown> = {};
    for (const [fname, f] of Object.entries(getFieldsSafe(named))) {
      obj[fname] = defaultValueForInput(schema, (f as any).type as GraphQLInputType);
    }
    return obj;
  }
  return null;
}

/* ------------------------ Return Tree (NEW) --------------------------- */

type ReturnTree =
  | string // leaf scalars/enums/custom scalars => "Type", "Type!", "[Type!]", etc.
  | {
      __type: string;
      __kind: "OBJECT" | "INTERFACE";
      fields: Record<string, ReturnTree>;
      __nonNull?: boolean;
      __truncated?: boolean;
      __implements?: string[];
    }
  | { __type: string; __kind: "UNION"; variants: ReturnTree[]; __nonNull?: boolean }
  | ReturnTree[]; // list wrapper: [innerShape]

function buildReturnTree(
  schema: GraphQLSchema,
  t: GraphQLType,
  opts: { depth: number; maxFields: number },
  seen: Set<string> = new Set()
): ReturnTree {
  // Non-null wrapper
  if (isNonNullType(t)) {
    const inner = buildReturnTree(schema, t.ofType, opts, seen);
    return appendNonNull(inner);
  }
  // List wrapper
  if (isListType(t)) {
  // decrement depth when traversing into list element
  const inner = buildReturnTree(
    schema,
    t.ofType,
    { depth: Math.max(0, opts.depth - 1), maxFields: opts.maxFields },
    seen
  );
  return [inner];
}

  const named = getNamedType(t);

  if (isScalarType(named) || isEnumType(named)) {
    return named.name;
  }

  if (isObjectType(named) || isInterfaceType(named)) {
    // Prevent cycles
    if (seen.has((named as any).name) || opts.depth <= 0) {
      return {
        __type: (named as any).name,
        __kind: isObjectType(named) ? "OBJECT" : "INTERFACE",
        fields: {},
        __truncated: true,
      };
    }

    const nextSeen = new Set(seen);
    nextSeen.add((named as any).name);

    const allFields = Object.entries(getFieldsSafe(named));
    allFields.sort((a, b) => priorityForField(a[0]) - priorityForField(b[0]));
    const picked = allFields.slice(0, opts.maxFields);

    const fields: Record<string, ReturnTree> = {};
    for (const [fname, f] of picked) {
      fields[fname] = buildReturnTree(
        schema,
        (f as any).type as GraphQLType,
        { depth: opts.depth - 1, maxFields: opts.maxFields },
        nextSeen
      );
    }

    const base: any = {
      __type: (named as any).name,
      __kind: isObjectType(named) ? "OBJECT" : "INTERFACE",
      fields,
    };

    if (isInterfaceType(named)) {
      base.__implements = schema.getPossibleTypes(named).map((x) => x.name);
    }

    return base;
  }

  if (isUnionType(named)) {
    if (seen.has((named as any).name) || opts.depth <= 0) {
      return { __type: (named as any).name, __kind: "UNION", variants: [], __nonNull: false };
    }
    const nextSeen = new Set(seen);
    nextSeen.add((named as any).name);
    const variants = getTypesSafe(named)
      .slice(0, opts.maxFields)
      .map((m: any) => buildReturnTree(schema, m as GraphQLType, { depth: opts.depth - 1, maxFields: opts.maxFields }, nextSeen));
    return { __type: (named as any).name, __kind: "UNION", variants };
  }

  // Fallback
  return (getNamedType(t) as any).name;
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
function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
