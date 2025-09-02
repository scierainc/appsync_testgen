import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/** Ask for endpoint, remember last used (global if no workspace). */
export async function askEndpoint(): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration("appsyncTestGen");
  const last = cfg.get<string>("lastEndpoint", "");
  const input = await vscode.window.showInputBox({
    prompt: "Enter your AppSync GraphQL endpoint URL",
    value: last,
    ignoreFocusOut: true,
    validateInput: (v) => (!v || !/^https?:\/\//.test(v) ? "Enter a valid https URL" : undefined)
  });
  if (input) {
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    const target = hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await cfg.update("lastEndpoint", input, target);
  }
  return input;
}

export type AuthPick = "apikey" | "iam" | "iamProfile";
export async function askAuth(): Promise<AuthPick | undefined> {
  const preset = vscode.workspace.getConfiguration("appsyncTestGen.connection").get<string>("defaultAuth", "");
  if (preset === "apikey" || preset === "iam" || preset === "iamProfile") return preset as AuthPick;

  const pick = await vscode.window.showQuickPick(
    [
      { label: "API Key", description: "Use x-api-key header", value: "apikey" as const },
      { label: "IAM (SigV4: manual region/profile)", description: "Sign request with AWS credentials", value: "iam" as const },
      { label: "AWS Profile (SigV4)", description: "Pick from ~/.aws/credentials", value: "iamProfile" as const }
    ],
    { placeHolder: "Choose authentication method", ignoreFocusOut: true }
  );
  return pick?.value;
}

export function regionFromEndpoint(endpoint: string): string | undefined {
  try {
    const host = new URL(endpoint).hostname;
    const m = host.match(/appsync-(?:api|realtime-api)\.([a-z0-9-]+)\.amazonaws\.com$/i);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export async function askRegionProfile(endpoint?: string) {
  const suggested = endpoint ? regionFromEndpoint(endpoint) : undefined;
  const region = await vscode.window.showInputBox({
    prompt: "Enter AWS region for the AppSync endpoint (e.g., ap-south-1)",
    value: suggested ?? "us-east-1",
    ignoreFocusOut: true
  });
  if (!region) throw new Error("Region is required");

  const profile = await vscode.window.showInputBox({
    prompt: "AWS CLI profile to use (optional). Leave blank for default chain.",
    ignoreFocusOut: true
  });

  return { region, profile };
}

async function listAwsProfiles(): Promise<string[]> {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) return [];
  const credPath = path.join(home, ".aws", "credentials");
  const confPath = path.join(home, ".aws", "config");
  const names = new Set<string>();
  for (const p of [credPath, confPath]) {
    try {
      const txt = await fs.promises.readFile(p, "utf8");
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*\[\s*(?:profile\s+)?([^\]\s]+)\s*\]\s*$/);
        if (m) names.add(m[1].trim());
      }
    } catch { /* ignore */ }
  }
  return Array.from(names).sort();
}

export async function askRegionAndPickProfile(endpoint?: string) {
  const profiles = await listAwsProfiles();
  const cfgConn = vscode.workspace.getConfiguration("appsyncTestGen.connection");
  const defaultProfile = (cfgConn.get<string>("profile", "") || "").trim();

  let picked: string | undefined =
    (defaultProfile && profiles.includes(defaultProfile)) ? defaultProfile :
    (profiles.length === 1 ? profiles[0] : undefined);

  if (!picked && profiles.length > 0) {
    const sel = await vscode.window.showQuickPick(
      profiles.map(p => ({ label: p })),
      { placeHolder: "Select AWS CLI profile (from ~/.aws/credentials)", ignoreFocusOut: true }
    );
    picked = sel?.label ?? undefined;
  }
  if (!picked) {
    picked = await vscode.window.showInputBox({ prompt: "Enter AWS CLI profile name", ignoreFocusOut: true }) || undefined;
  }
  if (!picked) throw new Error("No AWS profile selected");

  const suggested = endpoint ? regionFromEndpoint(endpoint) : undefined;
  const region = await vscode.window.showInputBox({
    prompt: "AWS region (e.g., ap-south-1)",
    value: cfgConn.get<string>("region", suggested ?? "us-east-1") || suggested || "us-east-1",
    ignoreFocusOut: true
  });
  if (!region) throw new Error("Region is required");

  return { region, profile: picked };
}

export async function pickFolder(label = "Select a folder") {
  const picks = await vscode.window.showOpenDialog({
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: label
  });
  return picks?.[0];
}
