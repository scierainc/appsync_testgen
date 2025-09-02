import * as vscode from "vscode";
import { statusBar } from "../ui/statusBar";

export function registerToggleStatusBar(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.toggleStatusBar", () => {
    statusBar.toggle();
    vscode.window.showInformationMessage(`Status bar ${statusBar.isEnabled() ? "enabled" : "disabled"}.`);
  });
  context.subscriptions.push(cmd);
}
