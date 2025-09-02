// v1.0.0
import * as vscode from "vscode";
import { getGraphqlClientPy, getConftestSharedPy } from "../templates/pytest";

async function readUtf8(u: vscode.Uri): Promise<string | undefined> {
  try { return Buffer.from(await vscode.workspace.fs.readFile(u)).toString("utf8"); }
  catch { return undefined; }
}
async function writeIfChanged(u: vscode.Uri, content: string) {
  const prev = await readUtf8(u);
  if (prev === content) return;
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(u, ".."));
  await vscode.workspace.fs.writeFile(u, Buffer.from(content, "utf8"));
}

// Ensure contexts/_shared/pytest/{graphql_client.py, conftest_shared.py}
export async function ensurePytestSharedScaffold(contextsRoot: vscode.Uri) {
  const shared = vscode.Uri.joinPath(contextsRoot, "_shared", "pytest");
  await vscode.workspace.fs.createDirectory(shared);
  await writeIfChanged(vscode.Uri.joinPath(shared, "graphql_client.py"), getGraphqlClientPy());
  await writeIfChanged(vscode.Uri.joinPath(shared, "conftest_shared.py"), getConftestSharedPy());
}
