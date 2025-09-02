import * as vscode from "vscode";
import { askEndpoint, askRegionAndPickProfile, pickFolder } from "../helpers/inputs";
import { resolveApiIdFromEndpoint } from "../appsync/controlPlane";

export function registerFetchResolversAndSave(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.fetchResolversAndSave", async () => {
    try {
      const endpoint = await askEndpoint(); if (!endpoint) return;
      const { region, profile } = await askRegionAndPickProfile(endpoint);
      const folder = await pickFolder("Save resolvers under this folder"); if (!folder) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Fetching resolvers…", cancellable: false },
        async () => {
          const { fetchAndSaveResolvers } = await import("../appsync/resolvers");
          const apiId = await resolveApiIdFromEndpoint(endpoint, region, profile || undefined);
          const result = await fetchAndSaveResolvers(apiId, endpoint, region, profile || undefined, { folder });
          vscode.window.showInformationMessage(`Saved ${result.total} resolver(s).`);
        }
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Resolver fetch failed: ${err?.message ?? String(err)}`);
    }
  });
  context.subscriptions.push(cmd);
}
