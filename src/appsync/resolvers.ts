import {
  AppSyncClient,
  ListResolversCommand,
  ListResolversCommandOutput,
  GetResolverCommand,
  GetResolverCommandOutput,
  Resolver,
  ListGraphqlApisCommand,
  ListGraphqlApisCommandOutput 
} from "@aws-sdk/client-appsync";

import { fromIni } from "@aws-sdk/credential-providers";
import * as vscode from "vscode";
import { getIntrospectionQuery } from "graphql";
import { executeSigV4 } from "./sigv4";

function norm(u: string | undefined): string {
  return (u || "").trim().replace(/\/+$/, "").toLowerCase();
}

async function resolveApiIdFromEndpoint(
  endpoint: string,
  region: string,
  profile?: string
): Promise<string> {
  const client = new AppSyncClient({
    region,
    ...(profile ? { credentials: fromIni({ profile }) } : {})
  });
  const target = norm(endpoint);

  let nextToken: string | undefined = undefined;
  do {
    const out: ListGraphqlApisCommandOutput = await client.send(new ListGraphqlApisCommand({ maxResults: 25, nextToken }));
    for (const api of out.graphqlApis ?? []) {
      const uri = norm(api.uris?.GRAPHQL as string);
      if (uri && uri === target) {
        if (!api.apiId) throw new Error("Matched API has no apiId");
        return api.apiId;
      }
    }
    nextToken = out.nextToken;
  } while (nextToken);

  throw new Error(
    `Could not resolve API ID from endpoint for region ${region}. Check the region/profile, or provide the API ID.`
  );
}

export async function getAllTypeNamesViaIntrospection(
  endpoint: string,
  region: string,
  profile?: string
): Promise<string[]> {
  const q = getIntrospectionQuery({ descriptions: false });
  const resp = (await executeSigV4(endpoint, { query: q }, { region, profile })) as {
    data?: { __schema?: { types?: Array<{ name?: string }> } };
    errors?: any;
  };

  if (resp?.errors?.length) {
    throw new Error(resp.errors[0]?.message ?? "GraphQL error during introspection");
  }

  const types = resp?.data?.__schema?.types ?? [];
  return types.map((t) => t?.name).filter((n): n is string => !!n && !n.startsWith("__"));
}

type SaveOpts = { folder: vscode.Uri };

/** Fetch all resolvers and save VTL/JS + metadata to disk. */
export async function fetchAndSaveResolvers(
  apiIdOrUndefined: string | undefined,
  endpoint: string,
  region: string,
  profile: string | undefined,
  opts: SaveOpts
) {
  // Resolve API ID if not provided
  const apiId = apiIdOrUndefined ?? (await resolveApiIdFromEndpoint(endpoint, region, profile));

  const client = new AppSyncClient({
    region,
    ...(profile ? { credentials: fromIni({ profile }) } : {})
  });

  const typeNames = await getAllTypeNamesViaIntrospection(endpoint, region, profile);

  let total = 0;

  for (const typeName of typeNames) {
    let nextToken: string | undefined = undefined;

    do {
      const page: ListResolversCommandOutput = await client.send(
        new ListResolversCommand({ apiId, typeName, nextToken })
      );

      for (const r of page.resolvers ?? []) {
        const fieldName = r.fieldName;
        if (!fieldName) continue;

        const fullOut: GetResolverCommandOutput = await client.send(
          new GetResolverCommand({ apiId, typeName, fieldName })
        );
        const full: Resolver | undefined = fullOut.resolver;
        if (!full) continue;

        const dir = vscode.Uri.joinPath(opts.folder, "resolvers", typeName, fieldName);
        await vscode.workspace.fs.createDirectory(dir);

        if (full.requestMappingTemplate) {
          const f = vscode.Uri.joinPath(dir, "request.vtl");
          await vscode.workspace.fs.writeFile(f, Buffer.from(full.requestMappingTemplate, "utf8"));
        }
        if (full.responseMappingTemplate) {
          const f = vscode.Uri.joinPath(dir, "response.vtl");
          await vscode.workspace.fs.writeFile(f, Buffer.from(full.responseMappingTemplate, "utf8"));
        }

        if (full.runtime?.name === "APPSYNC_JS" && full.code) {
          const f = vscode.Uri.joinPath(dir, "code.js");
          await vscode.workspace.fs.writeFile(f, Buffer.from(full.code, "utf8"));
        }

        const meta = {
          typeName,
          fieldName,
          kind: full.kind, // "UNIT" | "PIPELINE"
          dataSourceName: full.dataSourceName,
          runtime: full.runtime,
          pipelineConfig: full.pipelineConfig
        };
        const metaPath = vscode.Uri.joinPath(dir, "resolver.meta.json");
        await vscode.workspace.fs.writeFile(metaPath, Buffer.from(JSON.stringify(meta, null, 2), "utf8"));

        total++;
      }

      nextToken = page.nextToken;
    } while (nextToken);
  }

  return { total };
}
