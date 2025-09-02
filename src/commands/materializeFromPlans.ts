// src/commands/materializeFromPlans.ts
import * as vscode from "vscode";
import { materializeTestsForPlan } from "./materializeTests";

type OpType = "query" | "mutation" | "subscription";
type Scenario = {
  id?: string;
  title?: string;
  level?: "unit" | "integration";
  gql: string;
  variables?: Record<string, unknown>;
  expected?: { data?: unknown; errors?: unknown };
  notes?: string;
};
type Plan = {
  operations: Array<{ name: string; type: OpType; scenarios: Scenario[] }>;
};

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
async function readText(uri: vscode.Uri): Promise<string> {
  const buf = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(buf).toString("utf8");
}
async function readJSON<T=any>(uri: vscode.Uri): Promise<T> {
  return JSON.parse(await readText(uri)) as T;
}
async function listDirs(uri: vscode.Uri): Promise<string[]> {
  const entries = await vscode.workspace.fs.readDirectory(uri);
  return entries.filter(([,t])=>t===vscode.FileType.Directory).map(([n])=>n).sort();
}

export function registerMaterializeFromPlans(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    "appsyncTestGen.materializeTestsFromPlans",
    async () => {
      // 1) Pick root that contains contexts/
      const root = await (async () => {
        const pick = await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
          openLabel: "Select project root that contains contexts/"
        });
        return pick?.[0];
      })();
      if (!root) return;

      const contextsRoot = vscode.Uri.joinPath(root, "contexts");
      if (!(await exists(contextsRoot))) {
        vscode.window.showErrorMessage(`No contexts/ under ${root.fsPath}.`);
        return;
      }

      // 2) Find operation dirs that have a plan.json
      const allOps = await listDirs(contextsRoot);
      const opsWithPlan: string[] = [];
      for (const name of allOps) {
        const plan = vscode.Uri.joinPath(contextsRoot, name, "plan.json");
        if (await exists(plan)) opsWithPlan.push(name);
      }
      if (opsWithPlan.length === 0) {
        vscode.window.showWarningMessage("No plan.json files found in contexts/*.");
        return;
      }

      // 3) Multi-select which ones to materialize
      const picked = await vscode.window.showQuickPick(
        opsWithPlan.map(n => ({ label: n, value: n })),
        { canPickMany: true, placeHolder: "Select operations to materialize (plan.json → tests)" }
      );
      if (!picked || picked.length === 0) return;
      const selected = picked.map(p => p.value);

      // 4) Framework: use setting, but allow override
      const cfg = vscode.workspace.getConfiguration("appsyncTestGen.tests");
      const defaultFw = (cfg.get<string>("framework","jest") as "jest"|"pytest");
      const fwPick = await vscode.window.showQuickPick(
        [{label:"jest"},{label:"pytest"},{label:`Use setting (${defaultFw})`}],
        { placeHolder: "Choose framework to emit" }
      );
      const framework = (fwPick?.label === "jest" || fwPick?.label === "pytest")
        ? (fwPick.label as "jest"|"pytest")
        : defaultFw;

      // 5) Work
      const out = vscode.window.createOutputChannel("AppSync TestGen");
      out.show(true);

      let total = 0, failed = 0;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Materializing tests from plans…", cancellable: false },
        async () => {
          for (const name of selected) {
            const opDir = vscode.Uri.joinPath(contextsRoot, name);
            const planUri = vscode.Uri.joinPath(opDir, "plan.json");
            try {
              const plan = await readJSON<Plan>(planUri);
              const res = await materializeTestsForPlan(opDir, plan, framework);
              out.appendLine(`${name}: wrote ${res.written} ${framework} file(s).`);
              total++;
            } catch (e:any) {
              failed++;
              out.appendLine(`${name}: ERROR → ${String(e?.message ?? e)}`);
              await vscode.workspace.fs.writeFile(
                vscode.Uri.joinPath(opDir, "plan.error.txt"),
                Buffer.from(String(e?.message ?? e), "utf8")
              );
            }
          }
        }
      );

      vscode.window.showInformationMessage(`Materialized ${total} plan(s), ${failed} failed.`);
    }
  );

  context.subscriptions.push(cmd);
}
