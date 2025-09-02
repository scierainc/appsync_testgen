import * as vscode from "vscode";
import { SecretBroker } from "../security/secretBroker";
import { executeApiKey } from "../appsync/graphql";
import { executeSigV4 } from "../appsync/sigv4";
import { getIntrospectionQuery, buildClientSchema, printSchema } from "graphql";
import { askEndpoint, askAuth, askRegionProfile, askRegionAndPickProfile, pickFolder } from "../helpers/inputs";
import { resolveApiIdFromEndpoint, fetchSchemaControlPlane } from "../appsync/controlPlane";

type GraphQLResponse = { data?: any; errors?: Array<{ message?: string }>; };

export function registerFetchSchemaAndSave(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.fetchSchemaAndSave", async () => {
    const broker = new SecretBroker(
      context,
      vscode.workspace.getConfiguration("appsyncTestGen.secrets").get<boolean>("persist", false),
      (vscode.workspace.getConfiguration("appsyncTestGen.secrets").get<string>("backend", "secretStorage") as any)
    );

    broker.beginOperation();
    try {
      const endpoint = await askEndpoint(); if (!endpoint) return;
      const auth = await askAuth(); if (!auth) return;

      let usedControlPlane = false;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Fetching full schema…", cancellable: false },
        async () => {
          const introspectionQuery = getIntrospectionQuery({ descriptions: true });
          let result: GraphQLResponse | undefined;

          if (auth === "apikey") {
            const apiKey = await broker.get("APPSYNC_API_KEY", "Enter your AppSync API Key");
            result = (await executeApiKey(endpoint, apiKey, { query: introspectionQuery })) as GraphQLResponse;
            if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "GraphQL error");
          } else {
            const { region, profile } =
              auth === "iamProfile" ? await askRegionAndPickProfile(endpoint) : await askRegionProfile(endpoint);

            try {
              const r = (await executeSigV4(endpoint, { query: introspectionQuery }, { region, profile: profile || undefined })) as GraphQLResponse;
              if (r.errors?.length) {
                const msg = r.errors[0]?.message ?? "";
                if (/jwt/i.test(msg) || /unauthorized/i.test(msg)) throw new Error("RUNTIME_UNAUTHORIZED");
                throw new Error(msg || "GraphQL error");
              }
              result = r;
            } catch (e: any) {
              const text = String(e?.message ?? e);
              if (text.includes("RUNTIME_UNAUTHORIZED") || text.includes("401") || /Unable to parse JWT token/i.test(text)) {
                const apiId = await resolveApiIdFromEndpoint(endpoint, region, profile || undefined);
                const { sdl, jsonString } = await fetchSchemaControlPlane(apiId, region, profile || undefined);

                const folder = await pickFolder("Save schema here"); if (!folder) return;
                const jsonUri = vscode.Uri.joinPath(folder, "schema.introspection.json");
                const sdlUri = vscode.Uri.joinPath(folder, "schema.graphql");
                await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(jsonString, "utf8"));
                await vscode.workspace.fs.writeFile(sdlUri, Buffer.from(sdl, "utf8"));

                vscode.window.showInformationMessage(`Saved (control plane): ${jsonUri.fsPath} and ${sdlUri.fsPath}`);
                usedControlPlane = true;
              } else {
                throw e;
              }
            }
          }

          if (usedControlPlane) return;

          if (!result?.data) throw new Error("No data returned from introspection. Check auth/endpoint.");

          const schema = buildClientSchema(result.data);
          const sdl = printSchema(schema);

          const folder = await pickFolder("Save schema here"); if (!folder) return;
          const jsonUri = vscode.Uri.joinPath(folder, "schema.introspection.json");
          const sdlUri = vscode.Uri.joinPath(folder, "schema.graphql");
          await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(JSON.stringify(result.data, null, 2), "utf8"));
          await vscode.workspace.fs.writeFile(sdlUri, Buffer.from(sdl, "utf8"));

          vscode.window.showInformationMessage(`Saved: ${jsonUri.fsPath} and ${sdlUri.fsPath}`);
        }
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Save failed: ${err?.message ?? String(err)}`);
    } finally {
      broker.endOperation();
    }
  });

  context.subscriptions.push(cmd);
}
