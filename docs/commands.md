---
layout: default
title: Commands
nav_order: 5
---

# Key Concepts & Outputs

- **Per-operation context** (generated under contexts/<ParentType>.<fieldName>/):

  * operation operation.graphql — canonical GraphQL document with a compact selection set

  * operation.sdl.graphql — pruned SDL for only the types reachable by this operation

  * context.json — metadata: args, variables skeleton, typeClosure, and a returnTree

  * resolver/ (optional) — resolver artifacts copied from AppSync (VTL/JS + meta)

  * plan.json — (after LLM) test plan with scenarios for the operation

**Test materialization:**

  * Pytest: Python tests are emitted under the chosen tests root (default contexts/).

  * Jest: TS/JS tests are emitted alongside or under configured root.

**Shared test scaffold for Pytest:**

  * Created at contexts/_shared/pytest/ from templates:

  * graphql_client.py (AppSync HTTP client)

  * conftest_shared.py (fixtures/env)




Open the Command Palette (Ctrl/Cmd+Shift+P):

- **AppSync: Fetch Schema (… auth …)**  
  Uses AWS profile/region to introspect the GraphQL API.
  Saves `schema.graphql` / `schema.introspection.json`.

- **AppSync: Fetch Resolvers and Save (IAM)**  
  Stores resolver artifacts under `<schemaFolder>/resolvers/Type/Field/` and optional data sources in `_datasources/`.

- **AppSync: Build Per-Operation Contexts**  
  Emits per-op folders in `contexts/<Parent>.<field>/`:
  - `operation.graphql`
  - `operation.sdl.graphql` (pruned)
  - `context.json`
  - `resolver/` (copied from harvested resolvers)
  - Ensures `contexts/_shared/pytest/` scaffold exists.

- **AppSync: Generate Tests (Pick Operations / All)**  
  Calls LLM to propose scenarios; auto‑adds baseline happy/validation/not‑found; validates/repairs `scenario.gql` against the pruned SDL.
  Produces `plan.json` leveraging your prompts, SDL, return tree, and (optional) resolver hints. Invalid scenario GQL is auto-replaced with the canonical `operation.graphql` and noted.

- **AppSync: Materialize Tests from Plans**  
  Writes runnable Pytest/Jest tests into the configured output root (default `contexts/`).

- **AppSync: Open Workspace Prompt**\
  Opens/commonizes project‑wide prompt files.