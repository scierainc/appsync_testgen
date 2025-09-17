---
layout: default
title: FAQ
nav_order: 11
---

# FAQ

**Where do Pytest helper files come from?**\
`ensurePytestSharedScaffold()` writes `contexts/_shared/pytest/graphql_client.py` and `conftest_shared.py` from `src/templates/pytest/`.

**Can I force a specific selection set?**\
Edit `operation.graphql` in the context folder before generation; the generator validates scenarios to that canonical op.

**Per‑operation custom logic?**\
Use `perOperationPrompts` with wildcards or drop a `gen.prompt.md` next to the operation.

**Will fetching resolvers modify my plans automatically?**\
Resolver hints are merged into the generation prompt and used by the augmentation logic to choose smarter validation targets.

**Where do I set selection depth?**  
`appsyncTestGen.generation.selectionDepth`. Also see `maxFieldsPerLevel`, `returnTreeDepth`, `returnTreeMaxFields`.

**Can I control prompts per operation?**  
Yes via `perOperationPrompts[]` (supports `*` wildcard) and per-op file `gen.prompt.md` inside the op folder. See [prompts](prompts.md).

**Where are resolvers saved?**  
`<schema-folder>/resolvers/<Type>/<Field>/`. Matching artifacts are copied into each op folder as `resolver/` when building contexts.

**How does resolver info improve plans?**  
We load summarized hints (referenced args, runtime, pipeline config, data sources) to bias validations and variable mutations during plan generation.

**How do I view Allure reports?**  
Run a Pytest task with `--alluredir`, then an **Allure: Serve** task (workspace/external). For static, run **Allure: Generate static report** then **Allure: Open static report**.

**Jest status?**  
See [Testing & Allure](testing.md). Jest paths exist, but **may not work** across all schemas/auth setups yet.


> **Status**: experimental, some flows may change. Please file issues with a minimal repro.

