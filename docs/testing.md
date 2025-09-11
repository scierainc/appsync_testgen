# Testing & Allure (Pytest)

### Install

```bash
pip install pytest requests allure-pytest
# Optional: install Allure CLI
npm i -D allure-commandline
```

### Run

```bash
# minimal
APPSYNC_ENDPOINT=... APPSYNC_API_KEY=... python -m pytest contexts

# with JWT
APPSYNC_ENDPOINT=... APPSYNC_AUTH_MODE=COGNITO APPSYNC_JWT=... python -m pytest contexts

# write artifacts and Allure results
python -m pytest contexts --alluredir ./allure-results
npx allure serve ./allure-results
```

Environment variables consumed by the helper:

- `APPSYNC_ENDPOINT` (required)
- `APPSYNC_AUTH_MODE` = `API_KEY | COGNITO` (IAM not supported in Python helper)
- `APPSYNC_API_KEY` or `APPSYNC_JWT`
- `AWS_REGION`, `AWS_PROFILE` (metadata only)
- `APPSYNC_WRITE_ARTIFACTS` = `onfail|all|off` (default `onfail`)
- `APPSYNC_ARTIFACT_DIR` (default `artifacts`)

> IAM testing is supported via **Jest/Node** or by adding a botocore signer—out of scope of the default Pytest client.




# Testing & Allure

We ship multiple VS Code tasks for **workspace** and **external** contexts.  
External mode points to an arbitrary folder that contains `contexts/`.

## Pytest (recommended)

### Workspace
- `Test: Pytest (API Key, workspace)`
- `Test: Pytest (IAM, workspace)` ⚠️ Your `graphql_client.py` must implement SigV4 for IAM.
- `Test: Pytest (Cognito JWT, workspace)`

### External
- `Test: Pytest (API Key, external)`
- `Test: Pytest (IAM, external)`
- `Test: Pytest (Cognito JWT, external)`

## Jest (experimental)
- `Test: Jest (API Key, workspace/external)`
- `Test: Jest (IAM, workspace/external)`
- `Test: Jest (Cognito*, workspace/external)`

> **TODO:** Jest test cases may not work reliably across all schemas/auth modes.

## Allure

### Generate results (workspace)
- `Test: Pytest (API Key, workspace) + Allure`  
- `Test: Pytest (IAM, workspace) + Allure`  
- `Test: Pytest (Cognito JWT, workspace) + Allure`

### Generate results (external)
- `Test: Pytest (API Key, external) + Allure`

### Serve & static
- `Allure: Serve (workspace results)`
- `Allure: Generate static report (workspace)`
- `Allure: Open static report (workspace)`
- `Allure: Serve (external results)`
- `Allure: Generate static report (external)`
- `Allure: Open static report (external)`

### One-click (examples)
- `Allure: Run Pytest (workspace/API Key) & Serve`
- `Allure: Run Pytest (external/API Key) & Serve`

## Snippets (for `.vscode/tasks.json`)

> **Workspace Allure serve**
```jsonc
{
  "label": "Allure: Serve (workspace results)",
  "type": "shell",
  "command": "npx",
  "args": ["allure", "serve", "${workspaceFolder}/allure-results"],
  "problemMatcher": []
}
```


> **External Allure serve**
```jsonc

{
  "label": "Allure: Serve (external results)",
  "type": "shell",
  "command": "npx",
  "args": ["allure", "serve", "${input:CONTEXTS_ROOT}/allure-results"],
  "problemMatcher": []
}
```

> **Workspace Pytest + Allure**
```jsonc

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
  }
}
```

> **External Pytest + Allure**
```jsonc

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
  }
}
```

> **One-click run & serve (workspace/API Key)**
```jsonc

{
  "label": "Allure: Run Pytest (workspace/API Key) & Serve",
  "dependsOrder": "sequence",
  "dependsOn": [
    "Test: Pytest (API Key, workspace) + Allure",
    "Allure: Serve (workspace results)"
  ]
}
```

> **One-click run & serve (external/API Key)**
```jsonc

{
  "label": "Allure: Run Pytest (external/API Key) & Serve",
  "dependsOrder": "sequence",
  "dependsOn": [
    "Test: Pytest (API Key, external) + Allure",
    "Allure: Serve (external results)"
  ]
}
```

