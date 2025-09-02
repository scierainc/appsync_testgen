// scripts/test-runner.js
/* eslint-disable no-console */
const { spawn } = require("child_process");
const path = require("path");

async function run() {
  const cwd = process.cwd();

  // ---- Inputs from tasks.json ----
  const FRAMEWORK = (process.env.FRAMEWORK || "").toLowerCase(); // 'jest' | 'pytest'
  const SCOPE = (process.env.SCOPE || "workspace").toLowerCase(); // 'workspace' | 'external'
  const AUTH_CHOICE = (process.env.AUTH_CHOICE || "API_KEY").toUpperCase(); // API_KEY | IAM | COGNITO_JWT | COGNITO_UP

  const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
  const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";
  const AWS_REGION = process.env.AWS_REGION || "";
  const AWS_PROFILE = process.env.AWS_PROFILE || "";
  const APPSYNC_JWT = process.env.APPSYNC_JWT || "";
  const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || "";
  const COGNITO_USERNAME = process.env.COGNITO_USERNAME || "";
  const COGNITO_PASSWORD = process.env.COGNITO_PASSWORD || "";
  const CONTEXTS_ROOT = process.env.CONTEXTS_ROOT || ""; // used if SCOPE=external
  const PYTHON_BIN = process.env.PYTHON_BIN || "python";

  if (!APPSYNC_ENDPOINT) {
    console.error("❌ APPSYNC_ENDPOINT is required.");
    process.exit(1);
  }

  // ---- Compute contexts path ----
  const contextsRoot =
    SCOPE === "external"
      ? (CONTEXTS_ROOT || "")
      : cwd; // workspace root

  if (!contextsRoot) {
    console.error("❌ CONTEXTS_ROOT is required for SCOPE=external.");
    process.exit(1);
  }

  const contextsFolder = path.resolve(contextsRoot, "contexts");

  // ---- Auth mapping to shared clients ----
  const childEnv = { ...process.env };
  if (AUTH_CHOICE === "API_KEY") {
    if (!APPSYNC_API_KEY) {
      console.error("❌ APPSYNC_API_KEY required for API_KEY auth.");
      process.exit(1);
    }
    childEnv.APPSYNC_AUTH_MODE = "API_KEY";
  } else if (AUTH_CHOICE === "IAM") {
    if (!AWS_REGION) {
      console.error("❌ AWS_REGION required for IAM auth.");
      process.exit(1);
    }
    childEnv.APPSYNC_AUTH_MODE = "IAM";
  } else if (AUTH_CHOICE === "COGNITO_JWT") {
    if (!APPSYNC_JWT) {
      console.error("❌ APPSYNC_JWT (ID token) required for Cognito JWT auth.");
      process.exit(1);
    }
    childEnv.APPSYNC_AUTH_MODE = "COGNITO";
  } else if (AUTH_CHOICE === "COGNITO_UP") {
    if (!COGNITO_CLIENT_ID || !COGNITO_USERNAME || !COGNITO_PASSWORD || !AWS_REGION) {
      console.error("❌ COGNITO_CLIENT_ID, COGNITO_USERNAME, COGNITO_PASSWORD and AWS_REGION are required for Cognito username/password auth.");
      process.exit(1);
    }
    childEnv.APPSYNC_AUTH_MODE = "COGNITO";
  } else {
    console.error(`❌ Unknown AUTH_CHOICE: ${AUTH_CHOICE}`);
    process.exit(1);
  }

  // Always pass through endpoint/keys/region/profile; shared clients will use what they need
  childEnv.APPSYNC_ENDPOINT = APPSYNC_ENDPOINT;
  childEnv.APPSYNC_API_KEY = APPSYNC_API_KEY;
  childEnv.AWS_REGION = AWS_REGION;
  childEnv.AWS_PROFILE = AWS_PROFILE;
  childEnv.APPSYNC_JWT = APPSYNC_JWT;
  childEnv.COGNITO_CLIENT_ID = COGNITO_CLIENT_ID;
  childEnv.COGNITO_USERNAME = COGNITO_USERNAME;
  childEnv.COGNITO_PASSWORD = COGNITO_PASSWORD;

  // ---- Run framework ----
  if (FRAMEWORK === "jest") {
    // Run jest from the workspace (cwd). For external contexts, point directly at the test files folder.
    // Let Jest discover tests; we just pass the directory.
    const testDir =
      SCOPE === "external"
        ? path.join(contextsFolder, "**/tests/jest")
        : path.join("contexts", "**/tests/jest");

    const args = [
      "jest",
      "--config",
      path.resolve(cwd, "jest.config.ts"),
      testDir
    ];

    console.log(`▶ Running: npx ${args.join(" ")}`);
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, {
      stdio: "inherit",
      env: childEnv,
      cwd
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return;
  }

  if (FRAMEWORK === "pytest") {
    // Pytest: pass the contexts folder; pytest will discover test_*.py
    const pathArg =
      SCOPE === "external"
        ? contextsFolder
        : path.join("contexts");

    const args = ["-m", "pytest", pathArg];

    console.log(`▶ Running: ${PYTHON_BIN} ${args.join(" ")}`);
    const child = spawn(PYTHON_BIN, args, {
      stdio: "inherit",
      env: childEnv,
      cwd
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return;
  }

  console.error(`❌ Unknown FRAMEWORK: ${FRAMEWORK} (expected 'jest' or 'pytest')`);
  process.exit(1);
}

run().catch((e) => {
  console.error("❌ Runner error:", e?.message || e);
  process.exit(1);
});
