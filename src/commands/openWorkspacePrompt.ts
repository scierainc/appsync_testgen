// v1 — openWorkspacePrompt.ts
import * as vscode from "vscode";

/**
 * Registers the command:
 *   appsyncTestGen.openWorkspacePrompt
 *
 * Behavior:
 * - Creates (if missing) ./.appsync-testgen/prompt.md in the chosen workspace root.
 * - Opens the file for editing.
 * - Seeds a friendly template the first time.
 */
export function registerOpenWorkspacePrompt(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "appsyncTestGen.openWorkspacePrompt",
    async () => {
      try {
        const wsFolder = await pickWorkspaceFolder();
        if (!wsFolder) {
          vscode.window.showWarningMessage("No workspace folder selected.");
          return;
        }

        const dir = vscode.Uri.joinPath(wsFolder.uri, ".appsync-testgen");
        const file = vscode.Uri.joinPath(dir, "prompt.md");

        await vscode.workspace.fs.createDirectory(dir);

        const exists = await fileExists(file);
        if (!exists) {
          await vscode.workspace.fs.writeFile(
            file,
            Buffer.from(defaultTemplate(), "utf8")
          );
        }

        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc, { preview: false });

        // Friendly hint
        vscode.window.setStatusBarMessage(
          "Tip: This prompt is injected into the LLM when generating test plans.",
          4000
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Open Workspace Prompt failed: ${err?.message || String(err)}`
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return undefined;
  if (folders.length === 1) return folders[0];

  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { placeHolder: "Select a workspace folder for .appsync-testgen/prompt.md" }
  );
  return pick?.folder;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function defaultTemplate(): string {
  return `# AppSync TestGen — Workspace Prompt
This file lets you add **project-specific guidance** for the LLM when generating test plans.
It will be appended to the system/user prompt automatically.

## Common patterns
- Prefer \`API_KEY\` tests for smoke; add IAM/Cognito only where necessary.
- Use realistic dates and IDs. Avoid empty strings unless testing validation.
- Keep selection sets concise and match assertions to selected fields.
- For errors: assert statusCode + stable error messages; avoid brittle details.

## GraphQL conventions
- Always include \`__typename\` only if you assert on it.
- Lists: assert representative subset, not full arrays (unless needed).
- Interfaces/unions: pick 1-2 likely variants with inline fragments.

## Artifacts & categories
- Categories: add “happy”, “validation”, “notfound”, “auth” in the test name/description.
- Enable Executive View with \`APPSYNC_EXEC_VIEW=1\` when running pytest tasks.

## Anything else unique to your org goes here…
- e.g., \`orgId\` must always equal "acme".
- e.g., "courseName" must be Title Case.

`;
}
