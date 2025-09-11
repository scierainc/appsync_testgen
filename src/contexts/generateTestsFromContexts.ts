// v10 - src/contexts/generateTestsFromContexts.ts
import * as vscode from "vscode";
import type { LlmMessage } from "../llm/types";
import { createLlmClient } from "../llm/factory";
import {
  buildHappyVariables,
  makeMissingField,
  makeNotFound,
  makeInvalidEmptyString,
} from "./coverage";
import { loadExtraPromptForOperation } from "../utils/promptLoader";
import { loadResolverHints, type ResolverHints } from "../utils/resolverSummary";
import { buildSchema, parse, validate, GraphQLError } from "graphql";

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
  operations: Array<{
    name: string;
    type: OpType;
    endpoint?: string;
    headers?: Record<string, string>;
    scenarios: Scenario[];
  }>;
  meta?: any;
};

/* -------------------------------- FS utils ------------------------------- */
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
async function readText(uri: vscode.Uri): Promise<string> {
  const buf = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(buf).toString("utf8");
}
async function readJSON<T = any>(uri: vscode.Uri): Promise<T> {
  return JSON.parse(await readText(uri)) as T;
}
async function listOperationDirs(contextsRoot: vscode.Uri): Promise<vscode.Uri[]> {
  const out: vscode.Uri[] = [];
  const entries = await vscode.workspace.fs.readDirectory(contextsRoot);
  for (const [name, kind] of entries) if (kind === vscode.FileType.Directory) out.push(vscode.Uri.joinPath(contextsRoot, name));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/* ----------------------------- JSON helpers ------------------------------ */
function stripFence(s: string) {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  }
  return t;
}

/* ----------------------------- Prompt helpers ---------------------------- */
function renderReturnTreeGuidance(): string {
  return [
    "- Use `returnTree` to decide which fields to select in `gql` and which to assert in `expected`.",
    "- If a field is non-null (trailing `!` or `__nonNull: true`), assert strongly.",
    "- Use inline fragments for interfaces/unions; represent lists as arrays in expected.",
    "- Only assert fields you actually select.",
  ].join("\n");
}

/* ----------------------- augmentation (baseline scenarios) ----------------------- */

function topFieldFromContext(ctx: any): string {
  return ctx?.operation?.fieldName || "result";
}

/** Deep clone for plain JSON-like values. */
function jclone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

/** Return an array of candidate JSON paths for string-ish inputs (["input","name"], ["title"], …). */
function collectStringyPaths(obj: any, maxDepth = 3): string[][] {
  const out: string[][] = [];
  const preferNames = new Set([
    "name","title","description","email","phone","username","firstName","lastName",
    "displayName","subject","message","text","body","content","label"
  ]);
  const isStrHint = (k: string, v: any) => {
    const lk = k.toLowerCase();
    if (preferNames.has(lk)) return true;
    if (typeof v === "string") return true;
    if (typeof v === "number" || typeof v === "boolean") return false;
    if (typeof v === "string" && /^<.*?>$/.test(v)) return true; // placeholders
    return false;
  };

  const visit = (val: any, path: string[], depth: number) => {
    if (depth > maxDepth || val == null) return;
    if (Array.isArray(val)) {
      if (val.length > 0) visit(val[0], path.concat("0"), depth + 1);
      return;
    }
    if (typeof val !== "object") return;
    for (const [k, v] of Object.entries(val)) {
      const p = path.concat(k);
      if (isStrHint(k, v)) out.push(p);
      if (typeof v === "object" && v != null) visit(v, p, depth + 1);
    }
  };
  visit(obj, [], 0);

  const score = (p: string[]) => {
    const last = (p[p.length - 1] || "").toLowerCase();
    if (last === "name") return 0;
    if (last === "title") return 1;
    if (last === "description") return 2;
    if (last === "email") return 3;
    if (last === "username") return 4;
    return 10;
  };
  out.sort((a, b) => score(a) - score(b));
  return out;
}

/** Find the best path to target given referenced arg names (from resolver) & stringy candidates. */
function choosePreferredPath(candidates: string[][], referencedArgs?: string[]): string[] | undefined {
  if (!candidates.length) return undefined;
  const refs = (referencedArgs || []).map(s => s.toLowerCase());
  if (refs.length) {
    const hit = candidates.find(p => refs.includes((p[p.length - 1] || "").toLowerCase()));
    if (hit) return hit;
    const hit2 = candidates.find(p => p.some(seg => refs.includes(seg.toLowerCase())));
    if (hit2) return hit2;
  }
  return candidates[0];
}

function getAtPath(obj: any, path: string[]): any {
  let cur = obj;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg as any];
  }
  return cur;
}
function setAtPath(obj: any, path: string[], value: any): boolean {
  if (!path.length) return false;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (cur[seg as any] == null || typeof cur[seg as any] !== "object") return false;
    cur = cur[seg as any];
  }
  const leaf = path[path.length - 1];
  if (cur && Object.prototype.hasOwnProperty.call(cur, leaf)) {
    (cur as any)[leaf] = value;
    return true;
  }
  return false;
}
function deleteAtPath(obj: any, path: string[]): boolean {
  if (!path.length) return false;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (cur[seg as any] == null || typeof cur[seg as any] !== "object") return false;
    cur = cur[seg as any];
  }
  const leaf = path[path.length - 1];
  if (cur && Object.prototype.hasOwnProperty.call(cur, leaf)) {
    delete (cur as any)[leaf];
    return true;
  }
  return false;
}

function ensureCoverage(
  opName: string,
  opType: OpType,
  fieldName: string,
  gqlDoc: string,
  variablesSkeleton: Record<string, unknown>,
  plan: Plan,
  minScenarios: number,
  resolverHints?: ResolverHints
): Plan {
  const operations = plan.operations?.length ? plan.operations : [{ name: opName, type: opType, scenarios: [] }];
  const op = operations[0];
  const scenarios: Scenario[] = Array.isArray(op.scenarios) ? [...op.scenarios] : [];

  // 1) Happy path (baseline)
  if (!scenarios.some(s => (s.id || s.title || "").toLowerCase().includes("happy"))) {
    const happyVars = buildHappyVariables(variablesSkeleton, "001");
    scenarios.push({
      id: "happy-001",
      title: "Happy path (baseline)",
      level: "integration",
      gql: gqlDoc,
      variables: happyVars,
      expected: { data: { [fieldName]: {} } },
      notes: "Baseline happy path added automatically; adjust variables/expected as needed."
    });
  }

  const candidates = collectStringyPaths(variablesSkeleton);
  const preferredPath = choosePreferredPath(candidates, resolverHints?.referencedArgs);

  // 2) Validation: missing field (baseline)
  if (opType === "mutation" && !scenarios.some(s => /missing|required|validation/i.test(s.title || s.id || ""))) {
    const base = buildHappyVariables(variablesSkeleton, "002");
    let vars = jclone(base);
    let removedPath: string[] | undefined;

    if (preferredPath && deleteAtPath(vars, preferredPath)) {
      removedPath = preferredPath;
    } else {
      const m = makeMissingField(base);
      vars = m.vars;
      removedPath = m.removedPath;
    }

    scenarios.push({
      id: "validation-missing-field",
      title: "Validation (missing a field) — baseline",
      level: "integration",
      gql: gqlDoc,
      variables: vars,
      notes: `Removed field path: ${(removedPath || []).join(".") || "(unknown)"}`
    });
  }

  // 3) Validation: invalid empty string (baseline, smarter)
  if (opType === "mutation" && !scenarios.some(s => /invalid.*empty/i.test((s.title || s.id || "").toLowerCase()))) {
    const base = buildHappyVariables(variablesSkeleton, "003");
    let vars = jclone(base);
    let mutatedPath: string[] | undefined;

    if (preferredPath) {
      const cur = getAtPath(vars, preferredPath);
      const okType = typeof cur === "string" || cur == null || (typeof cur !== "object");
      if (okType && setAtPath(vars, preferredPath, "")) {
        mutatedPath = preferredPath;
      }
    }

    if (!mutatedPath) {
      const inv = makeInvalidEmptyString(base);
      vars = inv.vars;
      mutatedPath = inv.mutatedPath;
    }

    scenarios.push({
      id: "validation-invalid-empty",
      title: "Validation (invalid empty string) — baseline",
      level: "integration",
      gql: gqlDoc,
      variables: vars,
      notes: `Mutated path to empty string: ${(mutatedPath || []).join(".") || "(unknown)"}`
    });
  }

  // 4) Not found (baseline)
  if (!scenarios.some(s => /not\s*found|404/i.test((s.title || s.id || "").toLowerCase()))) {
    const base = buildHappyVariables(variablesSkeleton, "004");
    const notf = makeNotFound(base);
    scenarios.push({
      id: "notfound-001",
      title: "Not Found (baseline) — edit to your resource model",
      level: "integration",
      gql: gqlDoc,
      variables: notf.vars,
      notes: `Mutated path: ${(notf.mutatedPath || []).join(".") || "(unknown)"}`
    });
  }

  // 5) Enforce minimum scenarios
  const seeds = ["010", "011", "012", "013", "014", "015"];
  let i = 0;
  while (scenarios.length < Math.max(1, minScenarios)) {
    const seed = seeds[i++] || `${100 + i}`;
    scenarios.push({
      id: `happy-extra-${seed}`,
      title: `Happy path (extra seed ${seed})`,
      level: "integration",
      gql: gqlDoc,
      variables: buildHappyVariables(variablesSkeleton, seed),
      expected: { data: { [fieldName]: {} } }
    });
    if (i > 20) break;
  }

  return { operations: [{ name: opName, type: opType, scenarios }], meta: plan.meta };
}

/* ------------------------ GQL validation/repair ------------------------- */
function validateGqlAgainstSdl(sdl: string, gql: string): { ok: boolean; errors?: string[] } {
  try {
    // @ts-ignore graphql v16 supports assumeValidSDL
    const schema = buildSchema(sdl, { assumeValidSDL: true });
    const doc = parse(gql);
    const errs = validate(schema, doc) as readonly GraphQLError[];
    return { ok: errs.length === 0, errors: errs.map(e => e.message) };
  } catch (e: any) {
    return { ok: false, errors: [String(e?.message ?? e)] };
  }
}

/* -------------------------------------------------------------------------------- */

export async function generateTestsForAllContexts(
  rootFolder: vscode.Uri,
  opts: { baseUrl: string; apiKey: string; model: string; temperature?: number },
  selection?: { names?: string[]; include?: RegExp; exclude?: RegExp }
): Promise<{ total: number; failed: number }> {
  const contextsRoot = vscode.Uri.joinPath(rootFolder, "contexts");
  if (!(await exists(contextsRoot))) {
    throw new Error(`Missing ${contextsRoot.fsPath} (run Build Per-Operation Contexts first).`);
  }

  // Settings
  const cfg = vscode.workspace.getConfiguration("appsyncTestGen.llm");
  const genCfg = vscode.workspace.getConfiguration("appsyncTestGen.generation");
  const provider = (cfg.get<string>("provider", "compat") || "compat") as
    | "openai" | "anthropic" | "bedrock" | "compat" | "gemini";
  const streaming = cfg.get<boolean>("streaming", true);
  const temperature = cfg.get<number>("temperature", opts.temperature ?? 0.2);
  const maxTokens = cfg.get<number>("maxTokens", 1600);
  const minScenarios = Math.max(1, genCfg.get<number>("minScenariosPerOperation", 4) ?? 4);

  const modelFromSettings = cfg.get<string>("model", "")?.trim();
  const model =
    provider === "bedrock"
      ? (cfg.get<string>("bedrockModelId", "anthropic.claude-3-5-sonnet-20240620-v1:0")!)
      : (modelFromSettings || opts.model || "gpt-4o-mini");

  // Build client
  const client = await createLlmClient(
    provider === "openai"
      ? { provider: "openai", apiKey: opts.apiKey, baseUrl: cfg.get<string>("baseUrl", "") || undefined }
    : provider === "anthropic"
      ? { provider: "anthropic", apiKey: opts.apiKey }
    : provider === "bedrock"
      ? { provider: "bedrock", region: cfg.get<string>("region", "us-east-1")!, profile: cfg.get<string>("profile", "") || undefined, modelId: model }
    : provider === "gemini"
      ? { provider: "gemini", apiKey: opts.apiKey }
      : { provider: "compat", baseUrl: cfg.get<string>("baseUrl", "http://localhost:11434/v1")!, apiKey: opts.apiKey }
  );

  const opDirsAll = await listOperationDirs(contextsRoot);

  let opDirs = opDirsAll;
  if (selection && (selection.names?.length || selection.include || selection.exclude)) {
    const namesSet = selection.names ? new Set(selection.names) : undefined;

    opDirs = opDirsAll.filter(u => {
      const rel = u.path.split("/contexts/").pop() ?? u.path; // VS Code URI path uses '/'
      if (namesSet && !namesSet.has(rel)) return false;
      if (selection.include && !selection.include.test(rel)) return false;
      if (selection.exclude && selection.exclude.test(rel)) return false;
      return true;
    });
  }

  let total = 0, failed = 0;
  const outChan = vscode.window.createOutputChannel("AppSync TestGen");
  outChan.show(true);

  for (const opDir of opDirs) {
    const relName = opDir.path.split("/contexts/").pop() ?? opDir.path;
    const ctxJson = vscode.Uri.joinPath(opDir, "context.json");
    const opGql = vscode.Uri.joinPath(opDir, "operation.graphql");
    const opSdl = vscode.Uri.joinPath(opDir, "operation.sdl.graphql");

    if (!(await exists(ctxJson)) || !(await exists(opGql)) || !(await exists(opSdl))) {
      failed++;
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(opDir, "plan.error.txt"),
        Buffer.from("Missing operation files (need operation.graphql, operation.sdl.graphql, context.json)", "utf8")
      );
      continue;
    }

    const [ctx, gqlDoc, sdlDoc] = await Promise.all([
      readJSON<any>(ctxJson),
      readText(opGql),
      readText(opSdl),
    ]);

    const operationType: OpType = ctx?.operation?.type ?? "mutation";
    const parentType = ctx?.operation?.parentType
      ?? (operationType === "query" ? "Query" : operationType === "mutation" ? "Mutation" : "Subscription");
    const fieldName = ctx?.operation?.fieldName || topFieldFromContext(ctx);
    const opKey = `${parentType}.${fieldName}`;

    const variablesSkeleton = ctx?.variablesSkeleton ?? {};
    const returnTree = ctx?.returnTree ?? null;

    // Load extra prompt(s) for THIS operation (now type- & opKey-aware)
    const { text: extraPrompt, sources: promptSources } =
      await loadExtraPromptForOperation(opDir, operationType, opKey);

    // Load resolver hints for THIS operation (summarized from resolver/ & datasources, if present)
    const resolverHints = await loadResolverHints(rootFolder, opDir);

    const system: LlmMessage = {
      role: "system",
      content:
        "You are a senior QA engineer generating precise GraphQL test scenarios for AWS AppSync. " +
        "Output STRICT JSON only (no prose, no markdown fences), matching the schema below."
    };

    const requirements = [
      "Return JSON with this shape:",
`{
  "operations": [{
    "name": "string",
    "type": "query|mutation|subscription",
    "scenarios": [{
      "id": "string",
      "title": "string",
      "level": "unit|integration",
      "gql": "string",
      "variables": {"...": "..."},
      "expected": {"data": {}, "errors": [{}]},
      "notes": "optional"
    }]
  }]
}`,
      "",
      "Coverage requirements:",
      "- At least one happy-path scenario with plausible variables.",
      "- At least one error or edge case (e.g., missing/invalid input, not-found).",
      "- Every field asserted in `expected.data` must be selected in `gql`.",
      "- Keep selection sets concise and aligned to the return tree.",
    ].join("\n");

    const parts: string[] = [];
    parts.push(`Operation: ${opKey} (${operationType})`);
    parts.push("");
    parts.push("1) Operation document:\n```graphql\n" + gqlDoc.trim() + "\n```");
    parts.push("");
    parts.push("2) Pruned SDL for this operation (types referenced by this field):\n```graphql\n" + sdlDoc.trim() + "\n```");
    parts.push("");
    parts.push("3) Variables skeleton (edit to realistic values):\n```json\n" + JSON.stringify(variablesSkeleton, null, 2) + "\n```");
    parts.push("");
    parts.push("4) Return type tree (guide selection + assertions):\n```json\n" + JSON.stringify(returnTree ?? {}, null, 2) + "\n```");

    if (resolverHints) {
      parts.push("");
      parts.push("5) Resolver hints (summarized; use to guide auth/validation and errors):");
      parts.push("```json\n" + JSON.stringify(resolverHints, null, 2) + "\n```");
    }

    parts.push(renderReturnTreeGuidance());
    parts.push("");
    parts.push("6) Produce only valid JSON (no code fences).");
    parts.push("");
    parts.push(requirements);

    if (extraPrompt && extraPrompt.trim()) {
      parts.push("");
      parts.push(`7) Additional project guidance for ${opKey} (${operationType.toUpperCase()}) — follow strictly:`);
      parts.push(extraPrompt.trim());
    }

    const user: LlmMessage = { role: "user", content: parts.join("\n") };

    const cts = new vscode.CancellationTokenSource();
    try {
      let raw = "";

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Generating tests: ${opKey}`, cancellable: true },
        async (_progress, token) => {
          token.onCancellationRequested(() => cts.cancel());

          const messages: LlmMessage[] = [system, user];
          const doStreaming = (streaming) && typeof (client as any).chatStream === "function";

          outChan.appendLine(`\n--- ${opKey} ---`);
          outChan.appendLine(`[${provider}] ${model} (streaming ${doStreaming ? "on" : "off"})`);

          if (doStreaming) {
            const abort = new AbortController();
            token.onCancellationRequested(() => abort.abort());
            for await (const chunk of (client as any).chatStream(messages, {
              model, temperature, maxTokens, responseFormatJson: true, signal: abort.signal
            })) {
              if (chunk?.delta) {
                outChan.append(chunk.delta);
                raw += chunk.delta;
              }
            }
          } else {
            raw = await client.chat(messages, { model, temperature, maxTokens });
            outChan.appendLine(raw.slice(0, 200) + (raw.length > 200 ? " …" : ""));
          }
        }
      );

      const cleaned = stripFence(raw);
      let plan: Plan;
      try {
        plan = JSON.parse(cleaned) as Plan;
      } catch {
        plan = { operations: [{ name: opKey, type: operationType, scenarios: [] }] };
      }
      if (!plan?.operations?.length) {
        plan = { operations: [{ name: opKey, type: operationType, scenarios: [] }] };
      }

      // Validate/repair each scenario.gql against this op's SDL
      const opEntry = plan.operations.find(o => o.name === opKey) ?? plan.operations[0];
      if (Array.isArray(opEntry?.scenarios)) {
        for (const sc of opEntry.scenarios) {
          const txt = (sc.gql || "").trim();
          if (!txt) {
            sc.gql = gqlDoc;
            sc.notes = (sc.notes ? sc.notes + " " : "") + "[autofixed] inserted canonical operation.gql";
            continue;
          }
          const vr = validateGqlAgainstSdl(sdlDoc, txt);
          if (!vr.ok) {
            sc.gql = gqlDoc;
            const first = vr.errors?.[0] ? ` (${vr.errors[0]})` : "";
            sc.notes = (sc.notes ? sc.notes + " " : "") + `[autofixed] invalid gql replaced with canonical${first}`;
          }
        }
      }

      // Augment with baselines + min count (using resolver hints when helpful)
      const augmented = ensureCoverage(
        opKey,
        operationType,
        fieldName,
        gqlDoc,
        variablesSkeleton,
        plan,
        minScenarios,
        resolverHints
      );

      // Attach meta: promptSources + resolverHints + opKey (keep operations shape intact)
      (augmented as any).meta = {
        ...(plan as any).meta,
        opKey,
        promptSources,
        resolverHints: resolverHints ?? null,
      };

      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(opDir, "plan.json"),
        Buffer.from(JSON.stringify(augmented, null, 2), "utf8")
      );

      total++;
    } catch (e: any) {
      failed++;
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(opDir, "plan.error.txt"),
        Buffer.from(String(e?.message ?? e), "utf8")
      );
    } finally {
      cts.dispose();
    }
  }

  return { total, failed };
}
