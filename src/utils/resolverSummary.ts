// v1 - src/utils/resolverSummary.ts
import * as vscode from "vscode";

async function readUtf8(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const buf = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(buf).toString("utf8");
  } catch {
    return undefined;
  }
}
async function readJson<T = any>(uri: vscode.Uri): Promise<T | undefined> {
  const txt = await readUtf8(uri);
  if (!txt) return undefined;
  try { return JSON.parse(txt) as T; } catch { return undefined; }
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function harvestArgsFromVtl(vtl: string): string[] {
  const args: string[] = [];
  // $ctx.args.name   or   $context.arguments.name (rare)
  const rx1 = /\$(?:ctx\.args|context\.arguments)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = rx1.exec(vtl))) args.push(m[1]);

  // if(!$ctx.args.x) / if($util.isNullOrEmpty($ctx.args.x)) patterns hint required args
  const rxReq = /\$ctx\.args\.([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = rxReq.exec(vtl))) args.push(m[1]);

  return uniq(args);
}
function harvestErrorsFromVtl(vtl: string): Array<{message: string; type?: string}> {
  const out: Array<{message: string; type?: string}> = [];
  // $util.error("msg","Type")   OR   $util.unauthorized() etc
  const rxErr = /\$util\.(?:error|unauthorized|forbidden)\s*\(\s*(?:(['"])(.*?)\1\s*(?:,\s*(['"])(.*?)\3\s*)?)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = rxErr.exec(vtl))) {
    const msg = m[2] || (vtl.slice(m.index, m.index + 40).includes("unauthorized") ? "Unauthorized" : "Error");
    const typ = m[4] || (vtl.slice(m.index, m.index + 40).includes("unauthorized") ? "Unauthorized" : undefined);
    out.push({ message: msg, type: typ });
  }
  return out;
}
function usesIdentityInVtl(vtl: string): boolean {
  return /\$ctx\.identity\./.test(vtl) || /\$ctx\.identity\b/.test(vtl);
}

function harvestArgsFromJs(code: string): string[] {
  const args: string[] = [];
  // ctx.arguments.foo
  const rx = /\bctx\.arguments\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(code))) args.push(m[1]);
  return uniq(args);
}
function harvestErrorsFromJs(code: string): Array<{message: string; type?: string}> {
  const out: Array<{message: string; type?: string}> = [];
  // util.error("msg","Type"), util.appendError("msg","Type"), or throw new Error("msg")
  const rxUtil = /\butil\.(?:error|appendError)\s*\(\s*(['"])(.*?)\1\s*(?:,\s*(['"])(.*?)\3\s*)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = rxUtil.exec(code))) {
    out.push({ message: m[2], type: m[4] });
  }
  const rxThrow = /throw\s+new\s+Error\s*\(\s*(['"])(.*?)\1\s*\)/g;
  while ((m = rxThrow.exec(code))) {
    out.push({ message: m[2] });
  }
  return out;
}
function usesIdentityInJs(code: string): boolean {
  return /\bctx\.identity\b/.test(code);
}

export type ResolverHints = {
  kind?: "UNIT" | "PIPELINE";
  dataSourceName?: string | null;
  dataSourceType?: string | null; // e.g. AMAZON_DYNAMODB, AWS_LAMBDA, HTTP, ...
  runtime?: { name?: string; runtimeVersion?: string } | null;
  referencedArgs?: string[];
  potentialErrors?: Array<{ message: string; type?: string }>;
  usesIdentity?: boolean;
};

export async function loadResolverHints(
  workspaceRoot: vscode.Uri,  // the folder you picked to run generation (contains contexts/, resolvers/)
  opDir: vscode.Uri           // the specific contexts/<Type.field> folder
): Promise<ResolverHints | undefined> {
  const resDir = vscode.Uri.joinPath(opDir, "resolver");
  if (!(await exists(resDir))) return undefined;

  const meta = await readJson<any>(vscode.Uri.joinPath(resDir, "resolver.meta.json"));
  if (!meta) return undefined;

  const requestVtl   = await readUtf8(vscode.Uri.joinPath(resDir, "request.vtl"));
  const responseVtl  = await readUtf8(vscode.Uri.joinPath(resDir, "response.vtl"));
  const jsCode       = await readUtf8(vscode.Uri.joinPath(resDir, "code.js"));

  let referencedArgs: string[] = [];
  let potentialErrors: Array<{message: string; type?: string}> = [];
  let usesIdentity = false;

  if (requestVtl) {
    referencedArgs.push(...harvestArgsFromVtl(requestVtl));
    potentialErrors.push(...harvestErrorsFromVtl(requestVtl));
    usesIdentity = usesIdentity || usesIdentityInVtl(requestVtl);
  }
  if (responseVtl) {
    potentialErrors.push(...harvestErrorsFromVtl(responseVtl));
    usesIdentity = usesIdentity || usesIdentityInVtl(responseVtl);
  }
  if (jsCode) {
    referencedArgs.push(...harvestArgsFromJs(jsCode));
    potentialErrors.push(...harvestErrorsFromJs(jsCode));
    usesIdentity = usesIdentity || usesIdentityInJs(jsCode);
  }

  referencedArgs = uniq(referencedArgs);
  // try to enrich DS type if we have resolvers/_datasources/<name>.json under workspace root
  let dataSourceType: string | null = meta?.dataSourceName ?? null;
  if (meta?.dataSourceName) {
    const dsJson = await readJson<any>(
      vscode.Uri.joinPath(workspaceRoot, "resolvers", "_datasources", `${meta.dataSourceName}.json`)
    );
    dataSourceType = dsJson?.type ?? null;
  }

  return {
    kind: meta?.kind ?? undefined,
    dataSourceName: meta?.dataSourceName ?? null,
    dataSourceType,
    runtime: meta?.runtime ?? null,
    referencedArgs,
    potentialErrors: potentialErrors.length ? uniq(potentialErrors.map(e => JSON.stringify(e))).map(s => JSON.parse(s)) : undefined,
    usesIdentity,
  };
}
