// src/helpers/llmConfig.ts
import * as vscode from "vscode";
import { SecretBroker, type SecretKey } from "../security/secretBroker";

export type Provider = "openai" | "anthropic" | "bedrock" | "compat" | "gemini";

export type ResolvedLlmConfig = {
  provider: Provider;
  model: string;
  baseUrl: string; // may be "" for providers where it's optional; generator has fallbacks too
  apiKey: string;  // "" for bedrock (IAM)
};

/**
 * Centralized resolver for provider/model/baseUrl/apiKey.
 * - ENV fallbacks respected.
 * - Prompts for secret (via SecretBroker) only when needed.
 * - Only prompts for baseUrl when provider === "compat".
 */
export async function resolveLlmConfig(context: vscode.ExtensionContext): Promise<ResolvedLlmConfig> {
  const cfg = vscode.workspace.getConfiguration("appsyncTestGen.llm");
  const provider = (cfg.get<string>("provider", "compat") || "compat") as Provider;

  // model defaults per provider (bedrock model is configured via `bedrockModelId`)
  const modelCfg = (cfg.get<string>("model", "") || "").trim();
  const modelDefault =
    provider === "openai"    ? "gpt-4o-mini" :
    provider === "anthropic" ? "claude-3-5-sonnet-20240620" :
    provider === "gemini"    ? "gemini-1.5-pro" :
                                "gpt-4o-mini";
  const bedrockModel = cfg.get<string>("bedrockModelId", "anthropic.claude-3-5-sonnet-20240620-v1:0")!;
  const model = provider === "bedrock" ? bedrockModel : (modelCfg || modelDefault);

  // baseUrl resolution (optional for openai/anthropic/gemini; required for compat)
  const baseUrlCfg = (cfg.get<string>("baseUrl", "") || "").trim();
  const baseUrlEnv = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "").trim();
  let baseUrl = baseUrlCfg || baseUrlEnv || "";

  // apiKey resolution (bedrock uses IAM)
  let apiKey = "";
  if (provider !== "bedrock") {
    const envKey =
      provider === "openai"    ? process.env.OPENAI_API_KEY :
      provider === "anthropic" ? process.env.ANTHROPIC_API_KEY :
      provider === "gemini"    ? (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY) :
                                 (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY);

    if (envKey && envKey.trim()) {
      apiKey = envKey.trim();
    } else {
      // Prompt via SecretBroker (respects persist=false so you’re prompted each run)
      const sbCfg = vscode.workspace.getConfiguration("appsyncTestGen.secrets");
      const broker = new SecretBroker(context, sbCfg.get<boolean>("persist", false), (sbCfg.get<string>("backend", "secretStorage") as any));
      const secretId: SecretKey =
        provider === "openai"    ? "OPENAI_API_KEY" :
        provider === "anthropic" ? "ANTHROPIC_API_KEY" :
        provider === "gemini"    ? "GEMINI_API_KEY" :
                                   "LLM_API_KEY";
      broker.beginOperation();
      try {
        apiKey = await broker.get(secretId, `Enter your ${provider.toUpperCase()} API Key`);
      } finally {
        broker.endOperation();
      }
    }
  }

  // Prompt for baseUrl only when required (compat)
  if (provider === "compat" && !baseUrl) {
    baseUrl = (await vscode.window.showInputBox({
      prompt: "OpenAI-compatible Base URL (e.g., http://localhost:11434/v1)",
      ignoreFocusOut: true
    })) || "";
    if (!baseUrl) {
      throw new Error("A base URL is required for the 'compat' provider.");
    }
  }

  return { provider, model, baseUrl, apiKey };
}
