# AppSync TestGen (VS Code Extension)

Generate per-operation GraphQL contexts from an AppSync schema, draft test plans with an LLM, and materialize executable tests for **Pytest** or **Jest**. Includes optional resolver/data-source harvesting (IAM), per-operation prompt customization, and Allure reporting.

> ⚠️ **Warning**  
> Some parts of this codebase were “vibe-coded” for speed. Use with care, review generated code, and expect sharp edges in advanced/edge cases.

> ✅ **Status**  
> - Pytest flows: stable.  
> - IAM in Pytest: requires your own SigV4 wiring in `graphql_client.py`.  
> - Allure: supported via tasks.  
> - **Jest**: basic paths wired, **see TODO**.

---

## Quick links

- [Getting started](docs/GETTING_STARTED.md)
- [Commands](docs/commands.md)
- [Configuration](docs/configuration.md)
- [Per-operation prompts](docs/prompts.md)
- [Generate workflow](docs/workflow.md)
- [Testing & Allure](docs/testing.md)
- [Resolvers & data sources (IAM)](docs/resolvers.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Project structure](docs/project-structure.md)
- [Security notes](docs/security.md)
- [FAQ](docs/faq.md)

---

## Features

- Build **per-operation contexts** with:
  - Canonical `operation.graphql`
  - Pruned `operation.sdl.graphql`
  - Rich `context.json` (args, variables skeleton, `typeClosure`, `returnTree`)
  - Copy of resolver artifacts (if harvested)
- **LLM-backed** plan generation with SDL validation & auto-repair of invalid GQL
- **Per-operation prompt customization** (settings + files + wildcards)
- **Materialize** Pytest or Jest tests from plans
- **Allure** reporting tasks (workspace & external contexts)

---

## TODO

- **Jest test cases may not work** reliably across all auth modes and schemas yet. Treat Jest materialization as experimental and prefer Pytest for now.

