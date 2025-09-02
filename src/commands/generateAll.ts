import * as vscode from "vscode";
import { resolveLlmConfig } from "../helpers/llmConfig";

export function registerGenerateAll(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.generateTestsFromContexts", async () => {
    const folder = await (async () => {
      const pick = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        openLabel: "Select folder that contains contexts/"
      });
      return pick?.[0];
    })();
    if (!folder) return;

    try {
      const { provider, model, baseUrl, apiKey } = await resolveLlmConfig(context);
      const { generateTestsForAllContexts } = await import("../contexts/generateTestsFromContexts");
      const res = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Generating tests from contexts…", cancellable: false },
        () => generateTestsForAllContexts(folder, { baseUrl, apiKey, model })
      );
      vscode.window.showInformationMessage(`Generated ${res.total} plan(s), ${res.failed} failed.`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Generation failed: ${err?.message ?? String(err)}`);
    }
  });
  context.subscriptions.push(cmd);
}
