import * as vscode from "vscode";
import { resolveLlmConfig } from "../helpers/llmConfig";

export function registerGenerateTestsForSelection(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.generateTestsForSelection", async () => {
    const folder = await (async () => {
      const pick = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        openLabel: "Select project root that contains contexts/"
      });
      return pick?.[0];
    })();
    if (!folder) return;

    const contextsDir = vscode.Uri.joinPath(folder, "contexts");
    try { await vscode.workspace.fs.stat(contextsDir); }
    catch {
      vscode.window.showErrorMessage(`No contexts/ folder under ${folder.fsPath}. Run "Build Per-Operation Contexts" first.`);
      return;
    }

    const entries = await vscode.workspace.fs.readDirectory(contextsDir);
    const opDirs = entries.filter(([_, kind]) => kind === vscode.FileType.Directory).map(([name]) => name);
    if (opDirs.length === 0) {
      vscode.window.showWarningMessage("No operation folders found in contexts/.");
      return;
    }

    const items: Array<vscode.QuickPickItem & { value: string }> = [];
    for (const name of opDirs) {
      let type = "";
      try {
        const ctxUri = vscode.Uri.joinPath(contextsDir, name, "context.json");
        const buf = await vscode.workspace.fs.readFile(ctxUri);
        const ctx = JSON.parse(Buffer.from(buf).toString("utf8"));
        type = ctx?.operation?.type ?? "";
      } catch { /* ignore */ }
      items.push({ label: name, description: type ? `${type}` : undefined, value: name });
    }

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Select one or more operations to generate tests for (type to filter)"
    });
    if (!picked || picked.length === 0) return;
    const selectedNames = picked.map(p => p.value);

    try {
      const { model, baseUrl, apiKey } = await resolveLlmConfig(context);
      const { generateTestsForAllContexts } = await import("../contexts/generateTestsFromContexts");
      const res = await generateTestsForAllContexts(folder, { baseUrl, apiKey, model }, { names: selectedNames });
      vscode.window.showInformationMessage(`Generated ${res.total} plan(s), ${res.failed} failed.`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Generation failed: ${err?.message ?? String(err)}`);
    }
  });
  context.subscriptions.push(cmd);
}
