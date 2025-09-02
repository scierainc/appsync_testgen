// src/llm/factory.ts
import type { LlmClient } from "./types";

export type ProviderKind = "openai" | "anthropic" | "bedrock" | "compat" | "gemini";

export type FactoryParams =
  | { provider: "openai"; apiKey: string; baseUrl?: string }
  | { provider: "anthropic"; apiKey: string }
  | { provider: "bedrock"; region: string; profile?: string; modelId: string }
  | { provider: "compat"; baseUrl: string; apiKey?: string }
  | { provider: "gemini"; apiKey: string };

function missingSdk(provider: string, pkg: string): never {
  throw new Error(
    `The ${provider} provider requires the "${pkg}" package.\n` +
    `Install it with: npm i ${pkg}`
  );
}

export async function createLlmClient(params: FactoryParams): Promise<LlmClient> {
  switch (params.provider) {
    case "openai": {
      try {
        const mod = await import("./providers/openai");
        return new (mod as any).OpenAiSdkClient(params.apiKey, params.baseUrl);
      } catch {
        missingSdk("openai", "openai");
      }
    }
    case "anthropic": {
      try {
        const mod = await import("./providers/anthropic");
        return new (mod as any).AnthropicSdkClient(params.apiKey);
      } catch {
        missingSdk("anthropic", "@anthropic-ai/sdk");
      }
    }
    case "bedrock": {
      try {
        const mod = await import("./providers/bedrock");
        return new (mod as any).BedrockClaudeClient({
          region: params.region,
          profile: params.profile,
          modelId: params.modelId
        });
      } catch {
        missingSdk("bedrock", "@aws-sdk/client-bedrock-runtime");
      }
    }
    case "gemini": {
      try {
        const mod = await import("./providers/gemini");
        return new (mod as any).GeminiClient(params.apiKey);
      } catch {
        missingSdk("gemini", "@google/generative-ai");
      }
    }
    case "compat":
    default: {
      const mod = await import("./providers/compat");
      return new (mod as any).OpenAiCompatibleHttpClient(params.baseUrl, params.apiKey);
    }
  }
}
