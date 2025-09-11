// v10 - src/commands/fetchResolversAndSave.ts
// Fetches resolvers for an AppSync API (IAM) and saves them under <sourceFolder>/resolvers.
// Optionally also fetches data sources (configurable).
//
// Changes in v10:
// - Rich progress reporting via vscode.window.withProgress
// - Safe progress meter (caps at 95% during long loops, finishes at 100%)
// - Cancellable task (Esc to cancel)
// - Status messages at each major step (auth, API discovery, per-type scans, paging, saves)

import * as vscode from "vscode";
import {
  AppSyncClient,
  ListResolversCommand,
  GetResolverCommand,
  ListDataSourcesCommand,
  GetDataSourceCommand,
  ListGraphqlApisCommand,
  Resolver,
  GraphqlApi,
} from "@aws-sdk/client-appsync";
import { fromIni } from "@aws-sdk/credential-providers";
import {
  buildSchema,
  buildClientSchema,
  GraphQLSchema,
} from "graphql";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

/* -------------------------------- Utilities -------------------------------- */

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
async function readText(uri: vscode.Uri): Promise<string> {
  const buf = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(buf).toString("utf8");
}
async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));
}
async function writeJSON(uri: vscode.Uri, obj: any): Promise<void> {
  await writeText(uri, JSON.stringify(obj, null, 2));
}

/** Parse `https://<apiId>.appsync-api.<region>.amazonaws.com/graphql` → { apiId, region, host } */
function parseApiFromEndpoint(endpoint: string): { apiId?: string; region?: string; host?: string } {
  try {
    const u = new URL(endpoint);
    const host = u.hostname;
    const parts = host.split(".");
    const idx = parts.indexOf("appsync-api");
    const apiId = parts[0] && idx === 1 ? parts[0] : undefined; // only when <id>.appsync-api.<region>.amazonaws.com
    const region = idx >= 0 ? parts[idx + 1] : undefined;
    return { apiId, region, host };
  } catch {
    return {};
  }
}

/** Load GraphQL schema from source folder if present (introspection JSON preferred). */
async function loadSchemaFromSource(sourceFolder: vscode.Uri): Promise<GraphQLSchema | undefined> {
  const jsonUri = vscode.Uri.joinPath(sourceFolder, "schema.introspection.json");
  const sdlUri  = vscode.Uri.joinPath(sourceFolder, "schema.graphql");

  if (await exists(jsonUri)) {
    const raw = await readText(jsonUri);
    const json = JSON.parse(raw);
    return buildClientSchema(json.data ?? json);
  }
  if (await exists(sdlUri)) {
    const sdl = await readText(sdlUri);
    try {
      // @ts-ignore assumeValidSDL is available on graphql-js v16
      return buildSchema(sdl, { assumeValidSDL: true });
    } catch {
      return buildSchema(sdl);
    }
  }
  return undefined;
}

/** Get likely root type names to enumerate resolvers on. */
async function getRootTypeNames(sourceFolder: vscode.Uri): Promise<string[]> {
  const schema = await loadSchemaFromSource(sourceFolder);
  if (!schema) return ["Query", "Mutation", "Subscription"];
  const names: string[] = [];
  const q = schema.getQueryType()?.name;        if (q) names.push(q);
  const m = schema.getMutationType()?.name;     if (m) names.push(m);
  const s = schema.getSubscriptionType()?.name; if (s) names.push(s);
  return names.length ? names : ["Query", "Mutation", "Subscription"];
}

function getBoolSetting(section: string, key: string, def: boolean): boolean {
  const cfg = vscode.workspace.getConfiguration(section);
  const v = cfg.get<boolean>(key);
  return typeof v === "boolean" ? v : def;
}

/** Simple INI parser for ~/.aws/{credentials,config} */
function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const mSec = line.match(/^\[(.+?)\]\s*$/);
    if (mSec) { current = mSec[1]; out[current] = out[current] || {}; continue; }
    const mKV = line.match(/^([^=:#]+?)\s*[:=]\s*(.*)$/);
    if (mKV && current) { out[current][mKV[1].trim()] = mKV[2].trim(); }
  }
  return out;
}

async function readIfExists(filePath: string): Promise<string | undefined> {
  try { return await fs.readFile(filePath, "utf8"); } catch { return undefined; }
}

/** List profiles from ~/.aws/credentials and ~/.aws/config (normalize "profile X"→"X") */
async function listAwsProfiles(): Promise<string[]> {
  const home = os.homedir();
  const credIni = await readIfExists(path.join(home, ".aws", "credentials"));
  const cfgIni  = await readIfExists(path.join(home, ".aws", "config"));
  const set = new Set<string>();

  if (credIni) {
    const obj = parseIni(credIni);
    for (const name of Object.keys(obj)) set.add(name.trim());
  }
  if (cfgIni) {
    const obj = parseIni(cfgIni);
    for (const name of Object.keys(obj)) {
      const norm = name.startsWith("profile ") ? name.slice("profile ".length) : name;
      set.add(norm.trim());
    }
  }

  const list = Array.from(set);
  list.sort((a, b) => (a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b)));
  return list;
}

/** QuickPick to choose profile (or default chain). Returns undefined for default chain. */
async function pickAwsProfile(initial?: string): Promise<string | undefined> {
  const profiles = await listAwsProfiles();
  const items: vscode.QuickPickItem[] = [
    { label: "$(debug-start) Use default provider chain", description: "Environment, EC2/SSO cached, etc." },
    ...profiles.map((p) => ({ label: p })),
    { label: "$(pencil) Enter profile name…" },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "Choose AWS profile (IAM for AppSync)",
    placeHolder: initial && profiles.includes(initial) ? `Current: ${initial}` : undefined,
    ignoreFocusOut: true,
  });
  if (!picked) return undefined;

  if (picked.label.startsWith("$(debug-start)")) return undefined;
  if (picked.label.startsWith("$(pencil)")) {
    const entered = await vscode.window.showInputBox({
      title: "Enter AWS profile name",
      value: initial ?? "",
      ignoreFocusOut: true,
    });
    return entered?.trim() || undefined;
  }
  return picked.label;
}

/** Ensure credentials are resolvable before hitting the API. */
async function assertAwsCredentials(client: AppSyncClient): Promise<{ accessKeyId?: string; source?: string }> {
  try {
    const prov = client.config.credentials as unknown as (() => Promise<any>) | any;
    const creds = typeof prov === "function" ? await prov() : prov;
    if (!creds || !creds.accessKeyId) {
      throw new Error("Empty credentials");
    }
    return { accessKeyId: creds.accessKeyId, source: creds.source };
  } catch {
    throw new Error(
      "Could not load AWS credentials.\n" +
      "Pick a profile (or configure appsyncTestGen.connection.profile), set AWS_PROFILE, or provide env keys.\n" +
      "If using SSO, run `aws sso login` for that profile first."
    );
  }
}

/** Try to discover API ID from endpoint by listing APIs and matching GRAPHQL URI host. */
async function resolveApiIdFromEndpoint(
  client: AppSyncClient,
  endpoint: string,
  parsedApiId?: string
): Promise<{ apiId?: string; matchedApis: GraphqlApi[] }> {
  let host: string | undefined;
  try { host = new URL(endpoint).hostname; } catch { /* ignore */ }

  const found: GraphqlApi[] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(new ListGraphqlApisCommand({ nextToken }));
    nextToken = page.nextToken;
    for (const api of page.graphqlApis ?? []) {
      const gql = api.uris?.GRAPHQL;
      if (!gql) continue;
      try {
        const h = new URL(gql).hostname;
        if (host && h === host) found.push(api);
      } catch { /* ignore bad URIs */ }
    }
  } while (nextToken);

  if (found.length === 1) return { apiId: found[0].apiId, matchedApis: found };
  if (found.length > 1) return { apiId: undefined, matchedApis: found };

  return { apiId: parsedApiId, matchedApis: [] };
}

/* --------------------------- Data source fetching --------------------------- */

async function fetchAndSaveDataSources(
  client: AppSyncClient,
  apiId: string,
  region: string,
  resolversRoot: vscode.Uri,
  needed: Set<string>,
  outChan: vscode.OutputChannel,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  pm: ProgressMeter,
  token: vscode.CancellationToken
) {
  const dsRoot = vscode.Uri.joinPath(resolversRoot, "_datasources");
  await vscode.workspace.fs.createDirectory(dsRoot);

  const all: Record<string, any> = {};
  let nextToken: string | undefined;
  let pageNo = 0;

  do {
    if (token.isCancellationRequested) return;
    pageNo++;
    progress.report({ message: `DataSources: listing (page ${pageNo})…` });
    const page = await client.send(new ListDataSourcesCommand({ apiId, nextToken }));
    nextToken = page.nextToken;
    for (const ds of page.dataSources ?? []) {
      if (ds?.name) all[ds.name] = ds;
    }
    pm.bump(progress, 1, `DataSources: listed page ${pageNo}`);
  } while (nextToken);

  let idx = 0;
  for (const name of needed) {
    if (token.isCancellationRequested) return;

    let ds = all[name];
    if (!ds) {
      try {
        progress.report({ message: `DataSources: fetching ${name}…` });
        const got = await client.send(new GetDataSourceCommand({ apiId, name }));
        ds = got.dataSource;
      } catch (e) {
        ds = { name, _error: String(e) };
      }
    }

    const out = {
      name: ds?.name ?? name,
      type: ds?.type ?? null,
      region,
      description: ds?.description ?? null,
      serviceRoleArn: ds?.serviceRoleArn ?? null,
      lambdaConfig: ds?.lambdaConfig ?? null,
      dynamodbConfig: ds?.dynamodbConfig ?? null,
      httpConfig: ds?.httpConfig ?? null,
      relationalDatabaseConfig: ds?.relationalDatabaseConfig ?? null,
      openSearchServiceConfig: ds?.openSearchServiceConfig ?? null,
      eventBridgeConfig: ds?.eventBridgeConfig ?? null,
      _note: "Secrets/keys are not returned by AppSync APIs.",
    };

    const dst = vscode.Uri.joinPath(dsRoot, `${name}.json`);
    await writeJSON(dst, out);
    idx++;
    pm.bump(progress, 1, `DataSources: saved ${idx}/${needed.size} (${name})`);
    outChan.appendLine(`[dataSource] saved ${name}`);
  }
}

/* ----------------------------- Progress meter ------------------------------ */

class ProgressMeter {
  private value = 0; // 0..100
  private readonly cap = 95; // cap during long loops; we'll finish to 100% at end
  bump(progress: vscode.Progress<{ message?: string; increment?: number }>, inc: number, message?: string) {
    if (this.value < this.cap) {
      const room = this.cap - this.value;
      const add = Math.min(room, Math.max(1, inc));
      this.value += add;
      progress.report({ increment: add, message });
    } else {
      progress.report({ message });
    }
  }
  finish(progress: vscode.Progress<{ message?: string; increment?: number }>, message?: string) {
    const add = 100 - this.value;
    if (add > 0) progress.report({ increment: add, message });
    else progress.report({ message });
    this.value = 100;
  }
}

/* --------------------------------- Command --------------------------------- */

export function registerFetchResolversAndSave(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("appsyncTestGen.fetchResolversAndSave", async () => {
    const outChan = vscode.window.createOutputChannel("AppSync TestGen");
    outChan.show(true);

    const sourceFolder = await (async () => {
      const pick = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select folder that contains schema.graphql or schema.introspection.json",
      });
      return pick?.[0];
    })();
    if (!sourceFolder) return;

    const cfgConn = vscode.workspace.getConfiguration("appsyncTestGen.connection");
    const cfgRoot = vscode.workspace.getConfiguration("appsyncTestGen");
    const lastEndpoint = (cfgRoot.get<string>("lastEndpoint", "") || "").trim();

    const endpoint = await vscode.window.showInputBox({
      title: "AppSync GraphQL endpoint",
      prompt: "https://<apiId>.appsync-api.<region>.amazonaws.com/graphql (or your custom domain)",
      value: lastEndpoint,
      ignoreFocusOut: true,
    });
    if (!endpoint) return;

    const hasWs = !!vscode.workspace.workspaceFolders?.length;
    await cfgRoot.update(
      "lastEndpoint",
      endpoint,
      hasWs ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    );

    const initialProfile = (cfgConn.get<string>("profile", "") || "").trim();
    const profile = await pickAwsProfile(initialProfile);
    await cfgConn.update(
      "profile",
      profile || "",
      hasWs ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    );

    const parsed = parseApiFromEndpoint(endpoint);
    let region = (cfgConn.get<string>("region", "") || "").trim() || (parsed.region || "");
    if (!region) {
      region = (await vscode.window.showInputBox({
        title: "AWS region",
        value: "us-east-1",
        placeHolder: "e.g., us-east-1",
        ignoreFocusOut: true,
      }))?.trim() || "";
      if (!region) return;
      await cfgConn.update(
        "region",
        region,
        hasWs ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
      );
    }

    const client = new AppSyncClient({
      region,
      credentials: profile ? fromIni({ profile }) : undefined,
    });

    // Output root: <sourceFolder>/resolvers
    const resolversRoot = vscode.Uri.joinPath(sourceFolder, "resolvers");
    await vscode.workspace.fs.createDirectory(resolversRoot);

    // Toggle for data sources
    const fetchDsSetting = getBoolSetting("appsyncTestGen.resolvers", "fetchDataSources", true);
    const fetchDs = fetchDsSetting;

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Fetching AppSync resolvers…", cancellable: true },
        async (progress, token) => {
          const pm = new ProgressMeter();

          progress.report({ message: "Checking AWS credentials…" });
          const info = await assertAwsCredentials(client);
          pm.bump(progress, 5, "Credentials OK");

          progress.report({ message: "Resolving API ID from endpoint…" });
          let apiId = parsed.apiId;
          const resolved = await resolveApiIdFromEndpoint(client, endpoint, apiId);
          if (resolved.matchedApis.length > 1) {
            const pick = await vscode.window.showQuickPick(
              resolved.matchedApis.map((a) => ({
                label: `${a.name ?? a.apiId}`,
                description: a.apiId,
                detail: a.uris?.GRAPHQL ?? "",
              })),
              { title: "Multiple AppSync APIs match this endpoint host — pick one", ignoreFocusOut: true }
            );
            apiId = pick?.description || apiId;
          } else if (resolved.apiId) {
            apiId = resolved.apiId;
          }
          if (!apiId) {
            apiId = (await vscode.window.showInputBox({
              title: "AppSync API ID",
              prompt: "Enter your AppSync API ID (from AWS Console → AppSync).",
              value: apiId || "",
              ignoreFocusOut: true,
            }))?.trim();
          }
          if (!apiId) throw new Error("AppSync API ID is required.");
          pm.bump(progress, 5, `Using API ID ${apiId}`);

          const rootTypes = await getRootTypeNames(sourceFolder);
          outChan.appendLine(
            `[resolvers] Will scan type(s): ${rootTypes.join(", ")} ` +
            `(apiId=${apiId}, region=${region}, profile=${profile || "(default)"}, fetchDataSources=${String(fetchDs)})`
          );

          const neededDataSources = new Set<string>();
          let totalSaved = 0;

          for (const typeName of rootTypes) {
            if (token.isCancellationRequested) return;
            progress.report({ message: `Listing resolvers for ${typeName}…` });
            let nextToken: string | undefined;
            let pageNo = 0;

            do {
              if (token.isCancellationRequested) return;
              pageNo++;
              progress.report({ message: `Listing resolvers for ${typeName} (page ${pageNo})…` });
              const page = await client.send(new ListResolversCommand({
                apiId,
                typeName,
                nextToken,
              }));
              nextToken = page.nextToken;

              for (const r of page.resolvers ?? []) {
                if (token.isCancellationRequested) return;

                const got = await client.send(new GetResolverCommand({
                  apiId,
                  typeName,
                  fieldName: r.fieldName!,
                }));
                const full: Resolver | undefined = got.resolver;
                if (!full || !full.fieldName) continue;

                const fieldName = full.fieldName;
                const outDir = vscode.Uri.joinPath(resolversRoot, typeName, fieldName);
                await vscode.workspace.fs.createDirectory(outDir);

                if (full.requestMappingTemplate) {
                  await writeText(vscode.Uri.joinPath(outDir, "request.vtl"), full.requestMappingTemplate);
                }
                if (full.responseMappingTemplate) {
                  await writeText(vscode.Uri.joinPath(outDir, "response.vtl"), full.responseMappingTemplate);
                }
                if (full.code) {
                  await writeText(vscode.Uri.joinPath(outDir, "code.js"), full.code);
                }

                const meta = {
                  apiId,
                  region,
                  typeName,
                  fieldName,
                  kind: full.kind ?? null,
                  dataSourceName: full.dataSourceName ?? null,
                  pipelineConfig: full.pipelineConfig ?? null,
                  runtime: full.runtime ?? null,
                  syncConfig: full.syncConfig ?? null,
                  cachingConfig: full.cachingConfig ?? null,
                };
                await writeJSON(vscode.Uri.joinPath(outDir, "resolver.meta.json"), meta);
                totalSaved++;
                pm.bump(progress, 1, `Saved ${typeName}.${fieldName} (total ${totalSaved})`);
                outChan.appendLine(`[resolver] saved ${typeName}.${fieldName}`);

                if (meta.dataSourceName) neededDataSources.add(meta.dataSourceName);
              }
            } while (nextToken);

            pm.bump(progress, 2, `Finished ${typeName}`);
          }

          if (fetchDs && neededDataSources.size) {
            progress.report({ message: `Fetching ${neededDataSources.size} data source(s)…` });
            await fetchAndSaveDataSources(client, apiId, region, resolversRoot, neededDataSources, outChan, progress, pm, token);
          } else {
            outChan.appendLine(`[dataSource] skipped (fetchDataSources=${String(fetchDs)})`);
          }

          pm.finish(progress, "Done");
          vscode.window.showInformationMessage("AppSync: resolvers fetched successfully.");
        }
      );
    } catch (err: any) {
      const msg = `Resolver fetch failed: ${err?.message ?? String(err)}`;
      outChan.appendLine(msg);
      vscode.window.showErrorMessage(msg);
    }
  });

  context.subscriptions.push(cmd);
}
