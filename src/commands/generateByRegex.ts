// src/commands/generateByRegex.ts
import * as vscode from "vscode";
import { generateTestsForAllContexts } from "../contexts/generateTestsFromContexts";
import { SecretBroker } from "../security/secretBroker";

// Helper: turn user text into a RegExp (supports `/pat/flags`, comma list, or simple globs * ?)
function compileRegex(input?: string): RegExp | undefined {
  if (!input) return undefined;
  const raw = input.trim();
  if (!raw) return undefined;

  try {
    // /pattern/flags syntax
    const m = raw.match(/^\/(.+)\/([a-z]*)$/i);
    if (m) return new RegExp(m[1], m[2] || "i");

    // Comma-separated list, allow simple globs * and ?
    const parts = raw.split(",").map(s => s.trim()).filter(Boolean).map(p => {
      // escape then re-enable glob tokens
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                   .replace(/\\\*/g, ".*")
                   .replace(/\\\?/g, ".");
      return `(${esc})`;
    });
    return parts.length ? new RegExp(parts.join("|"), "i") : undefined;
  } catch {
    vscode.window.showWarningMessage(`Invalid regex: ${raw}. Ignoring.`);
    return undefined;
  }
}

export function registerGenerateTestsByRegex(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    "appsyncTestGen.generateTestsByRegex",
    async () => {
      // 1) Choose project root that has contexts/
      const root = await (async () => {
        const pick = await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
          openLabel: "Select project root that contains contexts/"
        });
        return pick?.[0];
      })();
      if (!root) return;

      // 2) Ask for include/exclude filter strings
      const includeStr = await vscode.window.showInputBox({
        prompt: "Include filter (regex like /Mutation\\.create.*/i, or comma/glob: Mutation.*,Query.get*)",
        placeHolder: "Leave empty to include all"
      });
      const excludeStr = await vscode.window.showInputBox({
        prompt: "Exclude filter (optional)",
        placeHolder: "e.g. /Subscription/i or Subscription.*"
      });

      // 3) Compile to RegExp
      const includeRe = compileRegex(includeStr);
      const excludeRe = compileRegex(excludeStr);

      // 4) Resolve LLM config (same pattern you use elsewhere)
      const cfgLlm = vscode.workspace.getConfiguration("appsyncTestGen.llm");
      const provider = (cfgLlm.get<string>("provider", "compat") || "compat") as
        "openai" | "anthropic" | "bedrock" | "compat" | "gemini";

      const modelCfg = (cfgLlm.get<string>("model", "") || "").trim();
      const modelDefault =
        provider === "openai" ? "gpt-4o-mini" :
        provider === "anthropic" ? "claude-3-5-sonnet-20240620" :
        provider === "gemini" ? "gemini-1.5-pro" :
        "gpt-4o-mini";
      const model = modelCfg || modelDefault;

      let baseUrl = (cfgLlm.get<string>("baseUrl", "") || process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "").trim();

      // API key (not needed for bedrock)
      let apiKey = "";
      if (provider !== "bedrock") {
        const envKey =
          provider === "openai" ? process.env.OPENAI_API_KEY :
          provider === "anthropic" ? process.env.ANTHROPIC_API_KEY :
          provider === "gemini" ? (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY) :
          (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY);

        const sbCfg = vscode.workspace.getConfiguration("appsyncTestGen.secrets");
        const broker = new SecretBroker(
          context,
          sbCfg.get<boolean>("persist", false)!,
          (sbCfg.get<string>("backend", "secretStorage") as any)
        );

        broker.beginOperation();
        try {
          const secretId =
            provider === "openai" ? "OPENAI_API_KEY" :
            provider === "anthropic" ? "ANTHROPIC_API_KEY" :
            provider === "gemini" ? "GEMINI_API_KEY" :
            "LLM_API_KEY";
          apiKey = envKey || await broker.get(secretId as any, `Enter your ${provider.toUpperCase()} API Key`);
        } finally {
          broker.endOperation();
        }
      }

      // compat provider requires baseUrl
      if (provider === "compat" && !baseUrl) {
        baseUrl = (await vscode.window.showInputBox({
          prompt: "OpenAI-compatible Base URL (e.g., http://localhost:11434/v1)",
          ignoreFocusOut: true
        })) || "";
        if (!baseUrl) {
          vscode.window.showErrorMessage("A base URL is required for the 'compat' provider.");
          return;
        }
      }

      // 5) Generate with regex selection
      try {
        const res = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Generating tests (regex selection)…", cancellable: false },
          () => generateTestsForAllContexts(
            root,
            { baseUrl, apiKey, model },
            { include: includeRe, exclude: excludeRe }
          )
        );
        vscode.window.showInformationMessage(`Generated ${res.total} plan(s), ${res.failed} failed.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Generation failed: ${err?.message ?? String(err)}`);
      }
    }
  );

  context.subscriptions.push(cmd);
}
