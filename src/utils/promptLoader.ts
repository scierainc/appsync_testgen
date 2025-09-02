// v1 - src/utils/promptLoader.ts
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
  return (
    p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(p)
  );
}

/** Resolve a file path from settings; supports absolute and workspace-relative. */
function resolveMaybeRelativePath(base: vscode.Uri | undefined, p: string): vscode.Uri | undefined {
  const trimmed = p.trim();
  if (!trimmed) return undefined;
  if (isAbsolutePath(trimmed)) return vscode.Uri.file(trimmed);
  if (!base) return undefined;
  return vscode.Uri.joinPath(base, trimmed);
}

/**
 * Load extra prompt text and list of source paths that contributed.
 * Order (concatenated in this order):
 *   1) appsyncTestGen.generation.extraPrompt            (inline text)
 *   2) appsyncTestGen.generation.extraPromptFile        (file path; abs or workspace-relative)
 *   3) <workspace>/.appsync-testgen/prompt.md           (convention)
 *   4) <opDir>/gen.prompt.md                            (per-operation)
 * (We also keep backward-compat read of 'userGuidance' setting.)
 */
export async function loadExtraPromptForOperation(
  opDir: vscode.Uri
): Promise<{ text: string; sources: string[] }> {
  const cfg = vscode.workspace.getConfiguration("appsyncTestGen.generation");

  const inline = (cfg.get<string>("extraPrompt", "") || "").trim()
    || (cfg.get<string>("userGuidance", "") || "").trim(); // legacy key

  const workspace = vscode.workspace.getWorkspaceFolder(opDir)?.uri;
  const fileSetting = (cfg.get<string>("extraPromptFile", "") || "").trim();
  const fileSettingUri = fileSetting ? resolveMaybeRelativePath(workspace, fileSetting) : undefined;

  const workspaceConvUri = workspace
    ? vscode.Uri.joinPath(workspace, ".appsync-testgen", "prompt.md")
    : undefined;

  const perOpUri = vscode.Uri.joinPath(opDir, "gen.prompt.md");

  const pieces: string[] = [];
  const sources: string[] = [];

  if (inline) {
    pieces.push(inline);
    sources.push("settings:appsyncTestGen.generation.extraPrompt");
  }

  if (fileSettingUri) {
    const t = await readUtf8(fileSettingUri);
    if (t && t.trim()) {
      pieces.push(t.trim());
      sources.push(`file:${fileSettingUri.fsPath}`);
    }
  }

  if (workspaceConvUri) {
    const t = await readUtf8(workspaceConvUri);
    if (t && t.trim()) {
      pieces.push(t.trim());
      sources.push(`file:${workspaceConvUri.fsPath}`);
    }
  }

  // per-op last (most specific)
  const tPerOp = await readUtf8(perOpUri);
  if (tPerOp && tPerOp.trim()) {
    pieces.push(tPerOp.trim());
    sources.push(`file:${perOpUri.fsPath}`);
  }

  const text = pieces.filter(Boolean).join("\n\n");
  return { text, sources };
}
