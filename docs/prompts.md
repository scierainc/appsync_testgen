---
layout: default
title: Per-operation prompt customization
---

# Per-operation prompt customization

Prompt assembly is handled by `src/utils/promptLoader.ts` (v3). For each operation directory (e.g., `contexts/Mutation.createCourse`), the loader concatenates sources in this **generic → specific** order:

1. Settings: `extraPrompt` (or `userGuidance`)
2. Settings (type): `extraPrompt{Query|Mutation|Subscription}`
3. Settings file: `extraPromptFile`
4. Workspace: `.appsync-testgen/prompt.md`
5. Workspace (type): `.appsync-testgen/prompt.<type>.md`
6. Contexts: `contexts/_prompts/prompt.md`
7. Contexts (type): `contexts/_prompts/prompt.<type>.md`
8. Settings: `perOperationPrompts[]` (supports `*` wildcard on `op`)
9. Workspace per-op: `.appsync-testgen/operations/<Parent>.<field>.md`
10. Contexts per-op: `contexts/_prompts/operations/<Parent>.<field>.md`
11. Per-op file in op folder: `<opDir>/gen.prompt.md`

> Tip: Prefer small, focused files per operation for strict guidance, and keep global guidance light.

## Examples

```jsonc
// settings.json
{
  "appsyncTestGen.generation.perOperationPrompts": [
    { "op": "Mutation.create*", "prompt": "When validating, remove a required string field." },
    { "op": "Query.get*", "file": ".appsync-testgen/prompt.query.md" }
  ]
}
```

Create `contexts/_prompts/operations/Mutation.createCourse.md` to target a single operation.