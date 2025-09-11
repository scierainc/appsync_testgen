# Generate workflow

1. **Fetch schema**  
   Use the appropriate auth mode. Prefer `schema.introspection.json`, but `schema.graphql` works.
2. **(Optional) Fetch resolvers**  
   IAM-only command. Parses endpoint → apiId/region; prompts for profile/region.
3. **Build contexts**  
   Writes:
   - `contexts/<Parent>.<field>/operation.graphql`
   - `contexts/<Parent>.<field>/operation.sdl.graphql`
   - `contexts/<Parent>.<field>/context.json` (includes `returnTree`)
   - `contexts/<Parent>.<field>/resolver/` (copied if harvested)
   - Ensures `contexts/_shared/pytest/` scaffold (`graphql_client.py`, `conftest_shared.py`)
4. **Generate test plans**  
   LLM produces `plan.json`. We validate scenario GQL against pruned SDL; invalid is replaced with canonical op doc and annotated.
5. **Materialize tests**  
   Writes runnable tests (Pytest/Jest) into the configured output root.

> Not seeing deep fields in `returnTree`? Bump:
> - `selectionDepth`
> - `maxFieldsPerLevel`
> - `returnTreeDepth`
> - `returnTreeMaxFields`
