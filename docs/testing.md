# Testing & Allure (Pytest)

> Jest support exists but may be flaky across some schemas/auth modes. Prefer **Pytest** first.

## Install

```bash
pip install pytest requests allure-pytest
# Optional: Allure CLI
npm i -D allure-commandline
```

## Run (CLI)

```bash
# minimal
APPSYNC_ENDPOINT=... APPSYNC_API_KEY=... python -m pytest contexts

# with Cognito JWT
APPSYNC_ENDPOINT=... APPSYNC_AUTH_MODE=COGNITO APPSYNC_JWT=... python -m pytest contexts

# write Allure results
python -m pytest contexts --alluredir ./allure-results
npx allure serve ./allure-results
```

## Environment variables used by the Pytest scaffold:

  - APPSYNC_ENDPOINT (required)

  - APPSYNC_AUTH_MODE = API_KEY | COGNITO (IAM not supported by the default Python client)

  - APPSYNC_API_KEY or APPSYNC_JWT

  - AWS_REGION, AWS_PROFILE (metadata only)

  - APPSYNC_WRITE_ARTIFACTS = onfail|all|off (default onfail)

  - APPSYNC_ARTIFACT_DIR (default artifacts)

# VS Code Tasks (snippets)
## Workspace Allure serve
```
{
  "label": "Allure: Serve (workspace results)",
  "type": "shell",
  "command": "npx",
  "args": ["allure", "serve", "${workspaceFolder}/allure-results"],
  "problemMatcher": []
}
```
## External Allure serve
```
{
  "label": "Allure: Serve (external results)",
  "type": "shell",
  "command": "npx",
  "args": ["allure", "serve", "${input:CONTEXTS_ROOT}/allure-results"],
  "problemMatcher": []
}
```
## Workspace Pytest + Allure
```
{
  "label": "Test: Pytest (API Key, workspace) + Allure",
  "type": "process",
  "command": "${config:python.defaultInterpreterPath}",
  "args": ["-m", "pytest", "contexts", "--alluredir", "${workspaceFolder}/allure-results"],
  "options": {
    "env": {
      "PYTHONPATH": "${workspaceFolder}/contexts/_shared/pytest",
      "APPSYNC_ENDPOINT": "${input:APPSYNC_ENDPOINT}",
      "APPSYNC_AUTH_MODE": "API_KEY",
      "APPSYNC_API_KEY": "${input:APPSYNC_API_KEY}"
    }
  },
  "group": "test"
}
```
## External Pytest + Allure
```
{
  "label": "Test: Pytest (API Key, external) + Allure",
  "type": "process",
  "command": "${config:python.defaultInterpreterPath}",
  "args": ["-m", "pytest", "${input:CONTEXTS_ROOT}/contexts", "--alluredir", "${input:CONTEXTS_ROOT}/allure-results"],
  "options": {
    "env": {
      "PYTHONPATH": "${input:CONTEXTS_ROOT}/contexts/_shared/pytest",
      "APPSYNC_ENDPOINT": "${input:APPSYNC_ENDPOINT}",
      "APPSYNC_AUTH_MODE": "API_KEY",
      "APPSYNC_API_KEY": "${input:APPSYNC_API_KEY}"
    }
  },
  "group": "test"
}
```
## One-click examples
```
{
  "label": "Allure: Run Pytest (workspace/API Key) & Serve",
  "dependsOrder": "sequence",
  "dependsOn": [
    "Test: Pytest (API Key, workspace) + Allure",
    "Allure: Serve (workspace results)"
  ]
}
```

(Your current file contains duplicate/snipped content—this replacement removes the confusion.) :contentReference[oaicite:9]{index=9} :contentReference[oaicite:10]{index=10}

---

## 3) Tweak **`docs/commands.md`** (tiny polish)

- Change “**operation operation.graphql**” → “**operation.graphql**”.  
- Keep “Key Concepts & Outputs” but tighten bullet spacing.

Where it currently shows the duplicate phrasing: :contentReference[oaicite:11]{index=11}

---

## 4) Add **`docs/tasks.md`** (missing, but linked elsewhere)

```md
# VS Code Tasks (run & report)

Add entries to `.vscode/tasks.json`.

## Pytest — workspace contexts + Allure
```jsonc
{
  "label": "Test: Pytest (API Key, workspace) + Allure",
  "type": "process",
  "command": "${config:python.defaultInterpreterPath}",
  "args": ["-m","pytest","contexts","--alluredir","${workspaceFolder}/allure-results"],
  "options": {"env": {"PYTHONPATH": "${workspaceFolder}/contexts/_shared/pytest","APPSYNC_ENDPOINT": "${input:APPSYNC_ENDPOINT}","APPSYNC_AUTH_MODE": "API_KEY","APPSYNC_API_KEY": "${input:APPSYNC_API_KEY}"}},
  "group": "test"
}

Allure — serve workspace results
{
  "label": "Allure: Serve (workspace results)",
  "type": "shell",
  "command": "npx",
  "args": ["allure","serve","${workspaceFolder}/allure-results"]
}

Pytest — external contexts + Allure
{
  "label": "Test: Pytest (API Key, external) + Allure",
  "type": "process",
  "command": "${config:python.defaultInterpreterPath}",
  "args": ["-m","pytest","${input:CONTEXTS_ROOT}/contexts","--alluredir","${input:CONTEXTS_ROOT}/allure-results"],
  "options": {"env": {"PYTHONPATH": "${input:CONTEXTS_ROOT}/contexts/_shared/pytest","APPSYNC_ENDPOINT": "${input:APPSYNC_ENDPOINT}","APPSYNC_AUTH_MODE": "API_KEY","APPSYNC_API_KEY": "${input:APPSYNC_API_KEY}"}},
  "group": "test"
}

Allure — serve external results
{
  "label": "Allure: Serve (external results)",
  "type": "shell",
  "command": "npx",
  "args": ["allure","serve","${input:CONTEXTS_ROOT}/allure-results"]
}
