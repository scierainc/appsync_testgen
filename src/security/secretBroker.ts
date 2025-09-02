import * as vscode from "vscode";

type Backend = "secretStorage" | "workspaceFile";

export const KNOWN_SECRET_KEYS = [
  "APPSYNC_API_KEY",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY"
] as const;

export type SecretKey = (typeof KNOWN_SECRET_KEYS)[number];

/** Ephemeral-by-default secret broker. */
export class SecretBroker {
  private mem = new Map<SecretKey, string>(); // per-operation only

  constructor(
    private ctx: vscode.ExtensionContext,
    private persistDefault: boolean,
    private backend: Backend
  ) {}

  beginOperation() { this.mem.clear(); }
  endOperation()   { this.mem.clear(); }

  async get(key: SecretKey, promptLabel: string): Promise<string> {
    const memVal = this.mem.get(key);
    if (memVal) return memVal;

    const persistEnabled = vscode.workspace.getConfiguration("appsyncTestGen.secrets").get<boolean>("persist", false);
    if (persistEnabled) {
      const persisted = await this.readPersisted(key);
      if (persisted) { this.mem.set(key, persisted); return persisted; }
    }

    const input = await vscode.window.showInputBox({
      prompt: promptLabel,
      password: true,
      ignoreFocusOut: true
    });
    if (!input) throw new Error(`${key} not provided`);

    let shouldPersist = false;
    if (persistEnabled) {
      const pick = await vscode.window.showQuickPick(
        [{ label: "Use once (donâ€™t save)" }, { label: "Save for future operations (secure)" }],
        { placeHolder: "Secret handling" }
      );
      shouldPersist = pick?.label.includes("Save") ?? false;
    }

    this.mem.set(key, input);
    if (shouldPersist) await this.writePersisted(key, input);
    return input;
  }

  private async readPersisted(key: SecretKey): Promise<string | undefined> {
    const backend = vscode.workspace.getConfiguration("appsyncTestGen.secrets").get<string>("backend", "secretStorage");
    if (backend === "secretStorage") return (await this.ctx.secrets.get(key)) ?? undefined;
    return vscode.workspace.getConfiguration("appsyncTestGen.secrets").get<string>(`persisted.${key}`) ?? undefined;
  }

  private async writePersisted(key: SecretKey, val: string) {
    const backend = vscode.workspace.getConfiguration("appsyncTestGen.secrets").get<string>("backend", "secretStorage");
    if (backend === "secretStorage") await this.ctx.secrets.store(key, val);
    else await vscode.workspace.getConfiguration("appsyncTestGen.secrets").update(`persisted.${key}`, val, vscode.ConfigurationTarget.Workspace);
  }

  async forget(key: SecretKey) {
    this.mem.delete(key);
    await this.ctx.secrets.delete(key);
    await vscode.workspace.getConfiguration("appsyncTestGen.secrets").update(`persisted.${key}`, undefined, vscode.ConfigurationTarget.Workspace);
  }
}
