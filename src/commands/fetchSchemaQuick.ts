import * as vscode from "vscode";
import { SecretBroker } from "../security/secretBroker";
import { executeApiKey, MIN_INTROSPECTION } from "../appsync/graphql";
import { executeSigV4 } from "../appsync/sigv4";
import { askEndpoint, askAuth, askRegionProfile, askRegionAndPickProfile } from "../helpers/inputs";

type GraphQLResponse = { data?: any; errors?: Array<{ message?: string }>; };

export function registerFetchSchemaQuick(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.fetchSchemaQuick", async () => {
    const broker = new SecretBroker(
      context,
      vscode.workspace.getConfiguration("appsyncTestGen.secrets").get<boolean>("persist", false),
      (vscode.workspace.getConfiguration("appsyncTestGen.secrets").get<string>("backend", "secretStorage") as any)
    );

    broker.beginOperation();
    try {
      const endpoint = await askEndpoint(); if (!endpoint) return;
      const auth = await askAuth(); if (!auth) return;

      let count = 0;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Fetching schema…", cancellable: false },
        async () => {
          if (auth === "apikey") {
            const apiKey = await broker.get("APPSYNC_API_KEY", "Enter your AppSync API Key");
            const result = (await executeApiKey(endpoint, apiKey, { query: MIN_INTROSPECTION })) as GraphQLResponse;
            if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "GraphQL error");
            count = result.data?.__schema?.types?.length ?? 0;
          } else if (auth === "iamProfile") {
            const { region, profile } = await askRegionAndPickProfile(endpoint);
            const result = (await executeSigV4(endpoint, { query: MIN_INTROSPECTION }, { region, profile })) as GraphQLResponse;
            if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "GraphQL error");
            count = result.data?.__schema?.types?.length ?? 0;
          } else {
            const { region, profile } = await askRegionProfile(endpoint);
            const result = (await executeSigV4(endpoint, { query: MIN_INTROSPECTION }, { region, profile: profile || undefined })) as GraphQLResponse;
            if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "GraphQL error");
            count = result.data?.__schema?.types?.length ?? 0;
          }
        }
      );

      vscode.window.showInformationMessage(`Fetched schema: ${count} types found.`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Fetch failed: ${err?.message ?? String(err)}`);
    } finally {
      broker.endOperation();
    }
  });
  context.subscriptions.push(cmd);
}
