// v3.1 - src/utils/promptLoader.ts
// - Hardens all settings reads: never call .trim() on non-strings
// - Safely parses perOperationPrompts even if misconfigured

import * as vscode from "vscode";

/** Read a UTF-8 file if it exists; return undefined if missing. */
async function readUtf8(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const buf = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(buf).toString("utf8");
  } catch {
    return undefined;
  }
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(p);
}

/** Resolve a file path from settings; supports absolute and workspace-relative. */
function resolveMaybeRelativePath(base: vscode.Uri | undefined, p: string): vscode.Uri | undefined {
  const trimmed = (p || "").trim();
  if (!trimmed) return undefined;
  if (isAbsolutePath(trimmed)) return vscode.Uri.file(trimmed);
  if (!base) return undefined;
  return vscode.Uri.joinPath(base, trimmed);
}

/** Find the nearest ancestor named `contexts` (…/contexts/<Type.field>). */
function findContextsRoot(dir: vscode.Uri): vscode.Uri | undefined {
  let cur: vscode.Uri | undefined = dir;
  while (cur) {
    const segs = cur.path.split("/").filter(Boolean);
    if (segs.length && segs[segs.length - 1] === "contexts") return cur;
    const parent = vscode.Uri.joinPath(cur, "..");
    if (parent.fsPath === cur.fsPath) break;
    cur = parent;
  }
  return undefined;
}

function wildcardToRegex(pattern: string): RegExp {
  // Supports '*' wildcard; match full string, case-sensitive
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`);
}

/* ------------------------- Safe coerces for settings ------------------------- */

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStringTrim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

type PerOpPrompt = { op: string; prompt?: string; file?: string };
function parsePerOpPrompts(v: unknown): PerOpPrompt[] {
  const arr = asArray<any>(v);
  const out: PerOpPrompt[] = [];
  for (const it of arr) {
    const op = asStringTrim(it?.op);
    if (!op) continue;
    const prompt = asStringTrim(it?.prompt);
    const file = asStringTrim(it?.file);
    out.push({ op, prompt: prompt || undefined, file: file || undefined });
  }
  return out;
}

/**
 * Load extra prompt text and list of source paths that contributed.
 * Concatenation order (generic → specific):
 *   1) settings: appsyncTestGen.generation.extraPrompt (inline generic) + legacy userGuidance
 *   2) settings: appsyncTestGen.generation.extraPrompt{Query|Mutation|Subscription}
 *   3) settings file: appsyncTestGen.generation.extraPromptFile
 *   4) workspace: .appsync-testgen/prompt.md (generic)
 *   5) workspace: .appsync-testgen/prompt.{query|mutation|subscription}.md (type-specific)
 *   6) contexts root: contexts/_prompts/prompt.md (generic)
 *   7) contexts root: contexts/_prompts/prompt.{type}.md (type-specific)
 *   8) settings: appsyncTestGen.generation.perOperationPrompts[] (wildcard-capable)
 *   9) workspace: .appsync-testgen/operations/<ParentType>.<field>.md (exact match)
 *  10) contexts:  contexts/_prompts/operations/<ParentType>.<field>.md (exact match)
 *  11) per-operation: <opDir>/gen.prompt.md (most specific)
 */
export async function loadExtraPromptForOperation(
  opDir: vscode.Uri,
  opType?: "query" | "mutation" | "subscription",
  opKey?: string // e.g., "Mutation.createCourse"
): Promise<{ text: string; sources: string[] }> {
  const genCfg = vscode.workspace.getConfiguration("appsyncTestGen.generation");
  const workspace = vscode.workspace.getWorkspaceFolder(opDir)?.uri;
  const contextsRoot = findContextsRoot(opDir);

  const pieces: string[] = [];
  const sources: string[] = [];

  // 1) inline generic (or legacy)
  const inlineGeneric =
    asStringTrim(genCfg.get("extraPrompt")) ||
    asStringTrim(genCfg.get("userGuidance"));
  if (inlineGeneric) {
    pieces.push(inlineGeneric);
    sources.push("settings:appsyncTestGen.generation.extraPrompt|userGuidance");
  }

  // 2) inline type-specific
  const inlineByTypeKey =
    opType === "query" ? "extraPromptQuery"
    : opType === "mutation" ? "extraPromptMutation"
    : opType === "subscription" ? "extraPromptSubscription"
    : undefined;
  const inlineType = inlineByTypeKey ? asStringTrim(genCfg.get(inlineByTypeKey)) : "";
  if (inlineType) {
    pieces.push(inlineType);
    sources.push(`settings:appsyncTestGen.generation.${inlineByTypeKey}`);
  }

  // 3) user-specified file
  const fileSetting = asStringTrim(genCfg.get("extraPromptFile"));
  const fileSettingUri = fileSetting ? resolveMaybeRelativePath(workspace, fileSetting) : undefined;
  if (fileSettingUri) {
    const t = await readUtf8(fileSettingUri);
    if (typeof t === "string" && t.trim()) {
      pieces.push(t.trim());
      sources.push(`file:${fileSettingUri.fsPath}`);
    }
  }

  // 4/5) workspace conventional files
  const wsGeneric = workspace ? vscode.Uri.joinPath(workspace, ".appsync-testgen", "prompt.md") : undefined;
  const wsType = workspace && opType
    ? vscode.Uri.joinPath(workspace, ".appsync-testgen", `prompt.${opType}.md`)
    : undefined;
  for (const [uri, label] of [
    [wsGeneric, "file:.appsync-testgen/prompt.md"],
    [wsType,    `file:.appsync-testgen/prompt.${opType}.md`],
  ] as Array<[vscode.Uri | undefined, string]>) {
    if (!uri) continue;
    const t = await readUtf8(uri);
    if (typeof t === "string" && t.trim()) { pieces.push(t.trim()); sources.push(label); }
  }

  // 6/7) contexts/_prompts
  const ctxGeneric = contextsRoot ? vscode.Uri.joinPath(contextsRoot, "_prompts", "prompt.md") : undefined;
  const ctxType = contextsRoot && opType
    ? vscode.Uri.joinPath(contextsRoot, "_prompts", `prompt.${opType}.md`)
    : undefined;
  for (const [uri, label] of [
    [ctxGeneric, "file:contexts/_prompts/prompt.md"],
    [ctxType,    `file:contexts/_prompts/prompt.${opType}.md`],
  ] as Array<[vscode.Uri | undefined, string]>) {
    if (!uri) continue;
    const t = await readUtf8(uri);
    if (typeof t === "string" && t.trim()) { pieces.push(t.trim()); sources.push(label); }
  }

  // 8) settings: perOperationPrompts (wildcard capable)
  if (opKey) {
    const perOps = parsePerOpPrompts(genCfg.get("perOperationPrompts"));
    const matches = perOps.filter(e => e.op && wildcardToRegex(e.op).test(opKey));
    for (const m of matches) {
      const p = asStringTrim(m.prompt);
      if (p) {
        pieces.push(p);
        sources.push(`settings:perOperationPrompts(op=${m.op})`);
      }
      const f = asStringTrim(m.file);
      if (f) {
        const uri = resolveMaybeRelativePath(workspace, f);
        if (uri) {
          const t = await readUtf8(uri);
          if (typeof t === "string" && t.trim()) { pieces.push(t.trim()); sources.push(`file:${uri.fsPath}`); }
        }
      }
    }
  }

  // 9/10) workspace/contexts operations/<Parent>.<field>.md
  if (opKey) {
    const wsOp = workspace ? vscode.Uri.joinPath(workspace, ".appsync-testgen", "operations", `${opKey}.md`) : undefined;
    const ctxOp = contextsRoot ? vscode.Uri.joinPath(contextsRoot, "_prompts", "operations", `${opKey}.md`) : undefined;
    for (const [uri, label] of [
      [wsOp,  `file:.appsync-testgen/operations/${opKey}.md`],
      [ctxOp, `file:contexts/_prompts/operations/${opKey}.md`],
    ] as Array<[vscode.Uri | undefined, string]>) {
      if (!uri) continue;
      const t = await readUtf8(uri);
      if (typeof t === "string" && t.trim()) { pieces.push(t.trim()); sources.push(label); }
    }
  }

  // 11) per-operation file right in the op folder
  const perOpUri = vscode.Uri.joinPath(opDir, "gen.prompt.md");
  {
    const t = await readUtf8(perOpUri);
    if (typeof t === "string" && t.trim()) { pieces.push(t.trim()); sources.push("file:<opDir>/gen.prompt.md"); }
  }

  const text = pieces.filter((p) => typeof p === "string" && p.length > 0).join("\n\n");
  return { text, sources };
}
