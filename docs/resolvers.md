# Resolvers & Data Sources

Use **AppSync: Fetch Resolvers and Save (IAM)**:

- Prompts for source folder (where `schema.*` live) and endpoint
- Parses `apiId` and `region` from endpoint (or uses settings)
- Saves under `<sourceFolder>/resolvers/<Type>/<field>/`
  - `request.vtl`, `response.vtl`, `code.js`, `resolver.meta.json`
- If `appsyncTestGen.resolvers.fetchDataSources = true`, saves data sources under `resolvers/_datasources/*.json`

**How it helps plans**

- A summarizer builds **resolver hints** (e.g., referenced argument names). Generation uses hints to pick smarter validation paths (e.g., empty string on a field the resolver actually reads).

```markdown
# Resolvers & data sources (IAM)

Command: **AppSync: Fetch Resolvers and Save (IAM)**

- Saves per-field resolver artifacts:
  - `resolvers/<Type>/<Field>/request.vtl`
  - `resolvers/<Type>/<Field>/response.vtl`
  - `resolvers/<Type>/<Field>/code.js`
  - `resolvers/<Type>/<Field>/resolver.meta.json`
- Optionally fetches **data sources** into `resolvers/_datasources/<name>.json`
- Settings: `appsyncTestGen.resolvers.fetchDataSources` (default `true`)
- When contexts are built, matching resolver artifacts are copied into the operation folder as `resolver/`, and summarized as “resolver hints” for the LLM.
```