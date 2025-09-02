// v3.1.0
// - Writes pytest files into a configurable tests root (appsyncTestGen.tests.outputRoot)
// - Ensures testsRoot/_shared/pytest/{graphql_client.py, conftest_shared.py} + testsRoot/conftest.py
// - Idempotent writes (writeIfChanged)

import * as vscode from "vscode";
import { renderPytestForOperation, makePyTestFileName } from "../renderers/pytest";

import {
  getGraphqlClientPy,
  getConftestSharedPy,
  getTopLevelConftestPy,
} from "../templates/pytest";

type OpType = "query" | "mutation" | "subscription";

export interface Scenario {
  id?: string;
  title?: string;
  level?: "unit" | "integration";
  gql: string;
  variables?: Record<string, unknown>;
  expected?: { data?: unknown; errors?: unknown };
  notes?: string;
}

export interface Plan {
  operations: Array<{
    name: string;
    type: OpType;
    scenarios: Scenario[];
  }>;
}

function safeBase(s: string): string {
  return (s || "op").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

async function readUtf8(uri: vscode.Uri): Promise<string | undefined> {
  try { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8"); }
  catch { return undefined; }
}
async function writeIfChanged(uri: vscode.Uri, content: string): Promise<void> {
  const prev = await readUtf8(uri);
  if (prev === content) return;
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
}

// Resolve tests root from setting; supports absolute or workspace-relative paths.
function resolveTestsRoot(opDir: vscode.Uri): vscode.Uri {
  const cfg = vscode.workspace.getConfiguration("appsyncTestGen.tests");
  const configured = (cfg.get<string>("outputRoot", "contexts") || "contexts").trim();

  const isAbs =
    configured.startsWith("/") ||
    configured.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(configured);

  if (isAbs) {
    return vscode.Uri.file(configured);
  }

  const ws = vscode.workspace.getWorkspaceFolder(opDir);
  const base = ws?.uri ?? vscode.Uri.joinPath(opDir, "..", "..");
  return vscode.Uri.joinPath(base, configured);
}

async function ensurePytestScaffold(testsRoot: vscode.Uri): Promise<void> {
  const sharedDir = vscode.Uri.joinPath(testsRoot, "_shared", "pytest");
  await vscode.workspace.fs.createDirectory(sharedDir);

  // shared helpers
  await writeIfChanged(vscode.Uri.joinPath(sharedDir, "graphql_client.py"), getGraphqlClientPy());
  await writeIfChanged(vscode.Uri.joinPath(sharedDir, "conftest_shared.py"), getConftestSharedPy());

  // top-level shim so pytest auto-loads hooks no matter where test files sit
  await writeIfChanged(vscode.Uri.joinPath(testsRoot, "conftest.py"), getTopLevelConftestPy());
}

/**
 * Materialize tests from a plan.json found in an operation folder.
 * For pytest, writes to:
 *   <testsRoot>/<Operation.Name>/tests/pytest/test_<Operation_Name>.py
 * And ensures:
 *   <testsRoot>/_shared/pytest/{graphql_client.py, conftest_shared.py}
 *   <testsRoot>/conftest.py
 */
export async function materializeTestsForPlan(
  opDir: vscode.Uri,
  plan: Plan,
  framework: "pytest" | "jest" = "pytest"
): Promise<{ written: number; outPaths: vscode.Uri[] }> {
  const outPaths: vscode.Uri[] = [];
  let written = 0;

  const ops = Array.isArray(plan?.operations) ? plan.operations : [];
  if (ops.length === 0) return { written: 0, outPaths };

  // Resolve where tests live
  const testsRoot = resolveTestsRoot(opDir);

  // Ensure pytest shared scaffold (idempotent)
  await ensurePytestScaffold(testsRoot);

  for (const op of ops) {
    const { name, type, scenarios } = op;

    if (framework === "pytest") {
      // mirror per-operation folder under the tests root
      const opFolder = vscode.Uri.joinPath(testsRoot, name);
      const outFolder = vscode.Uri.joinPath(opFolder, "tests", "pytest");
      await vscode.workspace.fs.createDirectory(outFolder);

      const content = renderPytestForOperation({
        operationName: name,
        operationType: type,
        scenarios,
      });

      const fileName = makePyTestFileName(name); // test_<safe>.py
      const outUri = vscode.Uri.joinPath(outFolder, fileName);
      await writeIfChanged(outUri, content);

      outPaths.push(outUri);
      written++;
    } else {
      // (Jest path to be added later if/when you enable it here)
    }
  }

  return { written, outPaths };
}

export default materializeTestsForPlan;
