import * as vscode from "vscode";
import * as path from "path";
import { resolveLlmConfig } from "../helpers/llmConfig";

function findCurrentOperationFromActiveEditor(): {
  projectRoot: vscode.Uri;
  contextsDir: vscode.Uri;
  opDir: vscode.Uri;
  opName: string;
} {
  const ed = vscode.window.activeTextEditor;
  if (!ed) throw new Error("No active editor. Open a file under contexts/<operation>/ and try again.");

  const fsPath = ed.document.uri.fsPath;
  const parts = fsPath.split(path.sep).filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === "contexts");
  if (idx === -1 || idx + 1 >= parts.length) {
    throw new Error("Active file is not under a contexts/<operation>/ folder.\nOpen a file like contexts/<op>/operation.graphql and try again.");
  }

  const contextsDirFsPath = path.join(...parts.slice(0, idx + 1));
  const projectRootFsPath = path.dirname(contextsDirFsPath);
  const opName = parts[idx + 1];
  const opDirFsPath = path.join(contextsDirFsPath, opName);

  return {
    projectRoot: vscode.Uri.file(projectRootFsPath),
    contextsDir: vscode.Uri.file(contextsDirFsPath),
    opDir: vscode.Uri.file(opDirFsPath),
    opName
  };
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

export function registerGenerateTestsForCurrent(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.generateTestsForCurrent", async () => {
    let where;
    try {
      where = findCurrentOperationFromActiveEditor();
    } catch (e: any) {
      vscode.window.showErrorMessage(String(e?.message ?? e));
      return;
    }

    const opGql = vscode.Uri.joinPath(where.opDir, "operation.graphql");
    const ctxJson = vscode.Uri.joinPath(where.opDir, "context.json");
    const opSdl = vscode.Uri.joinPath(where.opDir, "operation.sdl.graphql");
    if (!(await pathExists(opGql)) || !(await pathExists(ctxJson)) || !(await pathExists(opSdl))) {
      vscode.window.showWarningMessage(
        `Some files are missing under ${where.opDir.fsPath}. I will continue, but generation may fail.\nExpected: operation.graphql, operation.sdl.graphql, context.json`
      );
    }

    try {
      const { model, baseUrl, apiKey } = await resolveLlmConfig(context);
      const { generateTestsForAllContexts } = await import("../contexts/generateTestsFromContexts");
      const res = await generateTestsForAllContexts(where.projectRoot, { baseUrl, apiKey, model }, { names: [where.opName] });
      vscode.window.showInformationMessage(`Generated ${res.total} plan(s), ${res.failed} failed.`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Generation failed: ${err?.message ?? String(err)}`);
    }
  });
  context.subscriptions.push(cmd);
}
