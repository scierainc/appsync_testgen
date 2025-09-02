import { AppSyncClient, GetIntrospectionSchemaCommand, ListGraphqlApisCommand, ListGraphqlApisCommandOutput } from "@aws-sdk/client-appsync";
import { fromIni } from "@aws-sdk/credential-providers";

function norm(u: string | undefined): string {
  return (u || "").trim().replace(/\/+$/, "").toLowerCase();
}

export async function resolveApiIdFromEndpoint(endpoint: string, region: string, profile?: string): Promise<string> {
  const client = new AppSyncClient({ region, ...(profile ? { credentials: fromIni({ profile }) } : {}) });
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
  throw new Error(`Could not resolve API ID from endpoint for region ${region}. Check the region/profile, or provide the API ID.`);
}

export async function fetchSchemaControlPlane(apiId: string, region: string, profile?: string) {
  const client = new AppSyncClient({ region, ...(profile ? { credentials: fromIni({ profile }) } : {}) });
  const sdlOut = await client.send(new GetIntrospectionSchemaCommand({ apiId, format: "SDL", includeDirectives: true }));
  const jsonOut = await client.send(new GetIntrospectionSchemaCommand({ apiId, format: "JSON", includeDirectives: true }));
  const sdl = Buffer.from(sdlOut.schema ?? []).toString("utf8");
  const json = Buffer.from(jsonOut.schema ?? []).toString("utf8");
  return { sdl, jsonString: json };
}
