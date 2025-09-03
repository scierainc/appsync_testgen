// v2 - src/utils/promptLoader.ts
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
  const trimmed = p.trim();
  if (!trimmed) return undefined;
  if (isAbsolutePath(trimmed)) return vscode.Uri.file(trimmed);
  if (!base) return undefined;
  return vscode.Uri.joinPath(base, trimmed);
}

/** Accept string OR string[] and normalize to a single string with newlines. */
function coerceInlinePrompt(v: unknown): string {
  if (Array.isArray(v)) {
    return v.map(x => (typeof x === "string" ? x : String(x))).join("\n");
  }
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

/**
 * Load extra prompt text and list of source paths that contributed.
 * Order (concatenated in this order):
 *   1) appsyncTestGen.generation.extraPrompt            (string OR string[])
 *   2) appsyncTestGen.generation.extraPromptFile        (file path; abs or workspace-relative)
 *   3) <workspace>/.appsync-testgen/prompt.md           (convention)
 *   4) <opDir>/gen.prompt.md                            (per-operation, your current convention)
 *   5) <opDir>/prompt.md                                (per-operation fallback)
 * (We also keep backward-compat read of 'userGuidance' setting.)
 */
export async function loadExtraPromptForOperation(
  opDir: vscode.Uri
): Promise<{ text: string; sources: string[] }> {
  const cfg = vscode.workspace.getConfiguration("appsyncTestGen.generation");

  // inline settings (new + legacy), allow string OR array
  const inlineNew = coerceInlinePrompt(cfg.get<string | string[]>("extraPrompt", ""));
  const inlineLegacy = coerceInlinePrompt(cfg.get<string | string[]>("userGuidance", ""));
  const inline = (inlineNew || inlineLegacy).trim();

  const workspace = vscode.workspace.getWorkspaceFolder(opDir)?.uri;
  const fileSetting = (cfg.get<string>("extraPromptFile", "") || "").trim();
  const fileSettingUri = fileSetting ? resolveMaybeRelativePath(workspace, fileSetting) : undefined;

  const workspaceConvUri = workspace
    ? vscode.Uri.joinPath(workspace, ".appsync-testgen", "prompt.md")
    : undefined;

  // per-op (support both names; your current is gen.prompt.md)
  const perOpUris = [
    vscode.Uri.joinPath(opDir, "gen.prompt.md"),
    vscode.Uri.joinPath(opDir, "prompt.md"),
  ];

  const pieces: string[] = [];
  const sources: string[] = [];

  // 1) inline
  if (inline) {
    pieces.push(inline);
    // note: don’t duplicate source label if both new+legacy provided — we merged above
    sources.push("settings:appsyncTestGen.generation.extraPrompt|userGuidance");
  }

  // 2) explicit file from settings
  if (fileSettingUri) {
    const t = await readUtf8(fileSettingUri);
    if (t && t.trim()) {
      pieces.push(t.trim());
      sources.push(`file:${fileSettingUri.fsPath}`);
    }
  }

  // 3) workspace conventional file
  if (workspaceConvUri) {
    const t = await readUtf8(workspaceConvUri);
    if (t && t.trim()) {
      pieces.push(t.trim());
      sources.push(`file:${workspaceConvUri.fsPath}`);
    }
  }

  // 4/5) per-operation files
  for (const u of perOpUris) {
    const t = await readUtf8(u);
    if (t && t.trim()) {
      pieces.push(t.trim());
      sources.push(`file:${u.fsPath}`);
      // keep going; if both exist we concatenate both (more specific wins by being last)
    }
  }

  const text = pieces.filter(Boolean).join("\n\n");
  return { text, sources };
}
