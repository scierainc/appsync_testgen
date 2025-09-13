# Project structure

```
src/
  commands/
  contexts/
    buildOperationContexts.ts
    generateTestsFromContexts.ts
  templates/
    pytest/
      index.ts
      graphql_client.ts
      conftest_shared.ts
      conftest_top.ts
  utils/
    promptLoader.ts (v3)
    resolverSummary.ts
    scaffold.ts
contexts/ (generated)
  _shared/
    pytest/
      graphql_client.py
      conftest_shared.py
  Query.getFoo/
    operation.graphql
    operation.sdl.graphql
    context.json
    plan.json
    test_*.py (after materialize)
resolvers/ (optional, fetched)
  Query/getFoo/
    request.vtl / response.vtl / code.js / resolver.meta.json
  _datasources/
    <name>.json
```

**Generated per-op folder:**
```
contexts/
  Mutation.createCourse/
    operation.graphql
    operation.sdl.graphql
    context.json
    plan.json
    resolver/               # copied from resolvers/ if present
      request.vtl | code.js | response.vtl | resolver.meta.json
  _shared/
    pytest/
      graphql_client.py
      conftest_shared.py

```