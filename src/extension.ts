// v3 — extension.ts (use named export for openWorkspacePrompt, consistent with others)
import * as vscode from "vscode";
import { statusBar } from "./ui/statusBar";

// Command registrations
import { registerFetchSchemaQuick } from "./commands/fetchSchemaQuick";
import { registerFetchSchemaAndSave } from "./commands/fetchSchemaAndSave";
import { registerFetchResolversAndSave } from "./commands/fetchResolversAndSave";
import { registerBuildOperationContexts } from "./commands/buildOperationContextsCmd";
import { registerGenerateAll } from "./commands/generateAll";
import { registerGenerateTestsForSelection } from "./commands/generateForSelection";
import { registerGenerateTestsForCurrent } from "./commands/generateForCurrent";
import { registerGenerateTestsByRegex } from "./commands/generateByRegex";
import { registerToggleStatusBar } from "./commands/toggleStatusBar";
import { registerMaterializeFromPlans } from "./commands/materializeFromPlans";
import { registerConfigureLlmCommands } from "./commands/configureLlm";

// ⬇️ now a **named** export, and it pushes internally (returns void)
import { registerOpenWorkspacePrompt } from "./commands/openWorkspacePrompt";

export async function activate(context: vscode.ExtensionContext) {
  const uiCfg = vscode.workspace.getConfiguration("appsyncTestGen.ui");
  statusBar.init(context, uiCfg.get<boolean>("statusBar.enabled", true));

  // Register all commands (each pushes its Disposable internally)
  registerFetchSchemaQuick(context);
  registerFetchSchemaAndSave(context);
  registerFetchResolversAndSave(context);
  registerBuildOperationContexts(context);
  registerGenerateAll(context);
  registerGenerateTestsForSelection(context);
  registerGenerateTestsForCurrent(context);
  registerGenerateTestsByRegex(context);
  registerToggleStatusBar(context);
  registerMaterializeFromPlans(context);
  registerConfigureLlmCommands(context);
  registerOpenWorkspacePrompt(context);
}

export function deactivate() {}
