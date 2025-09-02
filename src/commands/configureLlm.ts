// src/commands/configureLlm.ts
import * as vscode from "vscode";

type Provider = "openai" | "anthropic" | "bedrock" | "compat" | "gemini";

function getTarget(): vscode.ConfigurationTarget {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

export function registerConfigureLlmCommands(context: vscode.ExtensionContext) {
  const pickProvider = vscode.commands.registerCommand(
    "appsyncTestGen.chooseLlmProvider",
    async () => {
      const cfg = vscode.workspace.getConfiguration("appsyncTestGen.llm");
      const current = (cfg.get<string>("provider", "openai") || "openai") as Provider;

      const pick = await vscode.window.showQuickPick(
        [
          { label: "OpenAI", value: "openai", detail: "OpenAI SDK (default)" },
          { label: "Anthropic", value: "anthropic", detail: "Claude via official SDK" },
          { label: "Gemini", value: "gemini", detail: "Google Gemini SDK" },
          { label: "Bedrock", value: "bedrock", detail: "AWS Bedrock (modelId in settings)" },
          { label: "OpenAI-Compatible", value: "compat", detail: "Any OpenAI API–compatible endpoint (needs Base URL)" }
        ],
        { placeHolder: `Current: ${current}` }
      );
      if (!pick) return;

      const target = getTarget();
      await cfg.update("provider", pick.value, target);

      // Helpful follow-ups
      if (pick.value === "compat") {
        const baseUrl = cfg.get<string>("baseUrl", "")?.trim();
        if (!baseUrl) {
          const entered = await vscode.window.showInputBox({
            prompt: "Enter OpenAI-compatible Base URL (e.g., http://localhost:11434/v1)",
            ignoreFocusOut: true
          });
          if (entered) await cfg.update("baseUrl", entered.trim(), target);
        }
      } else if (pick.value === "bedrock") {
        const region = cfg.get<string>("region", "")?.trim();
        if (!region) {
          const entered = await vscode.window.showInputBox({
            prompt: "AWS Region for Bedrock (e.g., us-east-1)",
            value: "us-east-1",
            ignoreFocusOut: true
          });
          if (entered) await cfg.update("region", entered.trim(), target);
        }
        const modelId = cfg.get<string>("bedrockModelId", "")?.trim();
        if (!modelId) {
          const entered = await vscode.window.showInputBox({
            prompt: "Bedrock modelId (e.g., anthropic.claude-3-5-sonnet-20240620-v1:0)",
            value: "anthropic.claude-3-5-sonnet-20240620-v1:0",
            ignoreFocusOut: true
          });
          if (entered) await cfg.update("bedrockModelId", entered.trim(), target);
        }
      }

      vscode.window.showInformationMessage(`LLM provider set to: ${pick.label}`);
    }
  );

  const pickModel = vscode.commands.registerCommand(
    "appsyncTestGen.chooseLlmModel",
    async () => {
      const cfg = vscode.workspace.getConfiguration("appsyncTestGen.llm");
      const provider = (cfg.get<string>("provider", "openai") || "openai") as Provider;

      // Suggestions (you can tweak these)
      const suggestions: Record<Provider, string[]> = {
        openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
        anthropic: ["claude-3-5-sonnet-20240620", "claude-3-5-haiku-20241022"],
        gemini: ["gemini-1.5-pro", "gemini-1.5-flash"],
        compat: ["gpt-4o", "gpt-3.5-turbo", "llama3.1", "qwen2.5"],
        bedrock: [] // uses bedrockModelId instead
      };

      if (provider === "bedrock") {
        vscode.window.showInformationMessage(
          "For Bedrock, set 'AppSync TestGen: Llm Bedrock Model Id' instead of 'model'."
        );
        return;
      }

      const current = (cfg.get<string>("model", "") || "").trim();
      const picks = suggestions[provider].map(m => ({ label: m, description: provider })) as
        Array<vscode.QuickPickItem & { value?: string }>;
      picks.unshift({ label: "Custom…", description: "enter a custom model name" });

      const pick = await vscode.window.showQuickPick(picks, {
        placeHolder: current ? `Current: ${current}` : "Pick a model or choose Custom…"
      });
      if (!pick) return;

      let chosen = pick.label;
      if (pick.label === "Custom…") {
        const entered = await vscode.window.showInputBox({
          prompt: "Enter model name",
          value: current || "",
          ignoreFocusOut: true
        });
        if (!entered) return;
        chosen = entered.trim();
      }

      await cfg.update("model", chosen, getTarget());
      vscode.window.showInformationMessage(`LLM model set to: ${chosen}`);
    }
  );

  const setBaseUrl = vscode.commands.registerCommand(
    "appsyncTestGen.setLlmBaseUrl",
    async () => {
      const cfg = vscode.workspace.getConfiguration("appsyncTestGen.llm");
      const current = (cfg.get<string>("baseUrl", "") || "").trim();
      const entered = await vscode.window.showInputBox({
        prompt: "OpenAI-compatible Base URL",
        value: current,
        ignoreFocusOut: true
      });
      if (!entered) return;
      await cfg.update("baseUrl", entered.trim(), getTarget());
      vscode.window.showInformationMessage(`LLM base URL set.`);
    }
  );

  context.subscriptions.push(pickProvider, pickModel, setBaseUrl);
}
