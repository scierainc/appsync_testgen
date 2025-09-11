// v1 - src/utils/vscodeWorkspace.ts
import * as vscode from "vscode";

/** First workspace root, or the workspace that contains `hintUri` if provided. */
export function workspaceRoot(hintUri?: vscode.Uri): vscode.Uri | undefined {
  if (hintUri) return vscode.workspace.getWorkspaceFolder(hintUri)?.uri;
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Update a config key; writes to Workspace if open, else to User settings. */
export async function updateSettingSafe(
  section: string,
  key: string,
  value: unknown
): Promise<void> {
  const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
  const cfg = vscode.workspace.getConfiguration(section);
  await cfg.update(
    key,
    value as any,
    hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
  );
}
