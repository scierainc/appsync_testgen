// Minimal GraphQL POST helper for API key auth.
export async function executeApiKey(endpoint: string, apiKey: string, body: any): Promise<any> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as any;
}

export const MIN_INTROSPECTION = /* GraphQL */ `
  query Introspect {
    __schema {
      types { name }
    }
  }
`;
