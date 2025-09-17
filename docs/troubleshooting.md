---
layout: default
title: Troubleshooting
---

# Troubleshooting

### Generation failed: `(genCfg.get(...) || "").trim is not a function`

A non‑string setting (e.g., object/array) is being read as string. Ensure `extraPrompt*` keys are strings, and `perOperationPrompts` is an **array of objects**.

### GraphQL 401 Unauthorized: *Unable to parse JWT token*

You selected **COGNITO** in tests but the token/env is empty or expired. For IAM flows, use **Jest** or fetch resolvers via control‑plane APIs (not GraphQL endpoint).

### Could not load credentials from any providers

Configure `appsyncTestGen.connection.profile` and ensure your AWS CLI profile exists, or set env vars before running resolver fetch.

### No progress indication

Long‑running tasks show VS Code progress notifications. Resolver fetch logs to **“AppSync TestGen”** output channel.

### Missing type expansion in `returnTree`

Increase selection/return tree depth settings (or accept truncation). Verify the type exists in the schema.

### Scenario `gql` invalid

The generator validates each `scenario.gql` against the pruned SDL; if invalid, it auto‑replaces with canonical `operation.graphql` and annotates `notes`.


### “Waiting for preLaunchTask 'watch'…”

Ensure `npm run watch` exists and TypeScript compiles (problem matcher `$tsc-watch`).

### “Generation failed: (genCfg.get(...) || '').trim is not a function”

A string setting was saved as non-string. In Settings (JSON) check:
- `extraPrompt`, `extraPromptQuery/Mutation/Subscription`, `extraPromptFile`
Reset to empty strings if needed.

### IAM: “Could not load credentials from any providers”

Pick a valid AWS profile/region. Verify:
```bash
aws sts get-caller-identity --profile YOUR_PROFILE --region us-east-1
```