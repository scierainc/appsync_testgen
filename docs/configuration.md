---
layout: default
title: Configuration
nav_order: 3
---

# Configuration

Open **Settings** → search `appsyncTestGen`.

## LLM (`appsyncTestGen.llm`)
- `provider`: `"openai" | "anthropic" | "bedrock" | "compat" | "gemini"`
- `model`, `baseUrl` (OpenAI-compatible endpoints)
- `temperature` (default `0.2`), `maxTokens` (default `1600`), `streaming` (default `true`)
- Bedrock extras: `region`, `profile`, `bedrockModelId`

## Generation (`appsyncTestGen.generation`)
- `minScenariosPerOperation` (default `4`)
- **Prompts**
  - `extraPrompt` (string or string[]; legacy `userGuidance` also read)
  - `extraPromptQuery`, `extraPromptMutation`, `extraPromptSubscription`
  - `extraPromptFile` (abs or workspace-relative)
  - `perOperationPrompts` (array of `{ op, prompt?, file? }`), e.g.:
    ```jsonc
    [
      { "op": "Mutation.createCourse", "file": ".appsync-testgen/operations/Mutation.createCourse.md" },
      { "op": "Query.get*", "prompt": "Keep selection sets minimal." }
    ]
    ```

## Contexts (`appsyncTestGen.contexts`)
- `selectionDepth` (default `2`)
- `maxFieldsPerLevel` (default `20`)
- `returnTreeDepth` (default `2`)
- `returnTreeMaxFields` (default `25`)

## Tests (`appsyncTestGen.tests`)
- `framework`: `"pytest" | "jest"` (recommended: **pytest**)
- `outputRoot`: default `contexts`

## Resolvers (`appsyncTestGen.resolvers`)
- `fetchDataSources`: boolean (default `true`)

## Connection (`appsyncTestGen.connection`)
- `region`
- `profile`
