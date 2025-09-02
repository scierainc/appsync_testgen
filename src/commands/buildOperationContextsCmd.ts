import * as vscode from "vscode";

export function registerBuildOperationContexts(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.buildOperationContexts", async () => {
    try {
      const source = await (async () => {
        const folder = await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
          openLabel: "Select folder with schema.graphql and resolvers/"
        });
        return folder?.[0];
      })();
      if (!source) return;

      const { buildPerOperationContexts } = await import("../contexts/buildOperationContexts");
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Building per-operation contexts…", cancellable: false },
        () => buildPerOperationContexts({ sourceFolder: source, selectionDepth: 1, maxFieldsPerLevel: 20 })
      );
      vscode.window.showInformationMessage(`Built ${result.total} context(s).`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Build contexts failed: ${err?.message ?? String(err)}`);
    }
  });
  context.subscriptions.push(cmd);
}
