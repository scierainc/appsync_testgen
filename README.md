# AppSync TestGen (VS Code Extension)

<!-- Marketplace badges -->
<p align="left">
  <!-- Version -->
  <a href="https://marketplace.visualstudio.com/items?itemName=scierainc.appsync-testgen" target="_blank" rel="noopener noreferrer">
    <img alt="VS Code Marketplace Version"
         src="https://img.shields.io/visual-studio-marketplace/v/scierainc.appsync-testgen.svg?logo=visualstudiocode&label=Marketplace&color=blue">
  </a>
  <!-- Installs -->
  <a href="https://marketplace.visualstudio.com/items?itemName=scierainc.appsync-testgen" target="_blank" rel="noopener noreferrer">
    <img alt="Installs"
         src="https://img.shields.io/visual-studio-marketplace/i/scierainc.appsync-testgen.svg">
  </a>
  <!-- Rating (will appear once ratings exist) -->
  <a href="https://marketplace.visualstudio.com/items?itemName=scierainc.appsync-testgen#review-details" target="_blank" rel="noopener noreferrer">
    <img alt="Rating"
         src="https://img.shields.io/visual-studio-marketplace/r/scierainc.appsync-testgen.svg">
  </a>
</p>

<!-- Install button (optional): place PNGs in ./icons/ before enabling) -->
<p align="left">
  <a href="https://marketplace.visualstudio.com/items?itemName=scierainc.appsync-testgen"
     target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="icons/vscode-install-badge-dark.png">
      <img alt="Install on VS Code" src="icons/vscode-install-badge-light.png" width="220" height="44">
    </picture>
  </a>
</p>

<!-- Product Hunt badge -->
<p align="left">
  <a href="https://www.producthunt.com/products/appsync-testgen?embed=true&utm_source=badge-featured&utm_medium=badge"
     target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)"
              srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1017653&theme=dark">
      <img alt="AppSync TestGen | Product Hunt"
           src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1017653&theme=light"
           width="250" height="54">
    </picture>
  </a>
</p>

> 📘 **Docs:** https://scierainc.github.io/appsync_testgen/

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

- [Getting started](docs/getting_started.md)
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

## Quickstart
1. Fetch schema → Build contexts → Generate plans → Materialize tests
2. Run Pytest or Jest via tasks (`.vscode/tasks.json`)
3. Allure: `pytest ... --alluredir ./allure-results` then `npx allure serve ./allure-results`

## TODO

- **Jest test cases may not work** reliably across all auth modes and schemas yet. Treat Jest materialization as experimental and prefer Pytest for now.
