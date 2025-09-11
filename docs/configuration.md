# Configuration

Open **Settings** → search `appsyncTestGen`.

## LLM
- `appsyncTestGen.llm.provider`: `"openai" | "anthropic" | "bedrock" | "compat" | "gemini"`
- `appsyncTestGen.llm.model`
- `appsyncTestGen.llm.baseUrl` (OpenAI-compatible endpoints)
- `appsyncTestGen.llm.temperature` (default `0.2`)
- `appsyncTestGen.llm.maxTokens` (default `1600`)
- `appsyncTestGen.llm.streaming` (default `true`)
- Bedrock extras: `region`, `profile`, `bedrockModelId`

## Generation
- `appsyncTestGen.generation.minScenariosPerOperation` (default `4`)
- `appsyncTestGen.generation.selectionDepth` (default `1`)
- `appsyncTestGen.generation.maxFieldsPerLevel` (default `20`)
- `appsyncTestGen.generation.returnTreeDepth` (default `2`)
- `appsyncTestGen.generation.returnTreeMaxFields` (default `25`)
- **Prompts**:
  - `extraPrompt` (and legacy `userGuidance`)
  - `extraPromptQuery`, `extraPromptMutation`, `extraPromptSubscription`
  - `extraPromptFile` (abs or workspace-relative)
  - `perOperationPrompts` (array)
    ```jsonc
    [
      { "op": "Mutation.createCourse", "file": ".appsync-testgen/operations/Mutation.createCourse.md" },
      { "op": "Query.get*", "prompt": "Keep selection sets minimal." }
    ]
    ```

## Tests
- `appsyncTestGen.tests.framework`: `"pytest"` or `"jest"` (default `pytest`)
- `appsyncTestGen.tests.outputRoot`: default `contexts`
> **Selection depth** (for context builder): if you expose it as settings, use keys like `appsyncTestGen.contexts.selectionDepth` (default 1) and `appsyncTestGen.contexts.returnTreeDepth` (default 2). When unset, defaults apply.


## Resolvers
- `appsyncTestGen.resolvers.fetchDataSources`: boolean (default `true`)

## Connection
- `appsyncTestGen.connection.region`
- `appsyncTestGen.connection.profile`
