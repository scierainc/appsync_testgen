import * as vscode from "vscode";
import { buildPerOperationContexts } from "../contexts/buildOperationContexts";

export function registerBuildOperationContexts(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.buildOperationContexts", async () => {
    const pick = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select folder with schema.graphql or schema.introspection.json"
    });
    const sourceFolder = pick?.[0];
    if (!sourceFolder) return;

    const cfg = vscode.workspace.getConfiguration("appsyncTestGen.contexts");
    const selectionDepth     = cfg.get<number>("selectionDepth", 2);
    const maxFieldsPerLevel  = cfg.get<number>("maxFieldsPerLevel", 20);
    const returnTreeDepth    = cfg.get<number>("returnTreeDepth", 2);
    const returnTreeMaxFields= cfg.get<number>("returnTreeMaxFields", 25);

    const res = await buildPerOperationContexts({
      sourceFolder,
      selectionDepth,
      maxFieldsPerLevel,
      returnTreeDepth,
      returnTreeMaxFields
    });

    vscode.window.showInformationMessage(`Built ${res.total} operation context(s).`);
  });

  context.subscriptions.push(cmd);
}
