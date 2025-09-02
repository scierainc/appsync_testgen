// src/renderers/types.ts
export type Plan = {
  operations: Array<{
    name: string;
    type: "query" | "mutation" | "subscription";
    endpoint?: string;
    headers?: Record<string, string>;
    scenarios: Array<{
      id: string;
      title: string;
      level: "unit" | "integration";
      gql: string;
      variables?: Record<string, unknown>;
      expected?: { data?: unknown; errors?: unknown };
      notes?: string;
    }>;
  }>;
};
