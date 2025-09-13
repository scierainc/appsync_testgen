# Getting started

## Requirements
- Node.js 18+ and npm
- Python 3.9+ (for Pytest)
- VS Code (latest)
- AWS CLI (for IAM flows) with configured profiles
- (Optional) Allure:
  - `npm i -D allure-commandline`
  - `pip install allure-pytest`

## Build
```bash
npm i
npm run watch   # dev loop (used by VS Code debug)
# or
npm run build
```
*If the VS Code debugger says “Waiting for preLaunchTask 'watch'…”, ensure npm run watch exists and TypeScript compiles.*

## Install & set up

1. Install the extension in VS Code.

2. Create a folder with schema.graphql or schema.introspection.json.

3. (Optional) Configure LLM provider in settings: appsyncTestGen.llm.*.

4. (Optional) Configure AWS: appsyncTestGen.connection.region/profile for IAM flows.

## First run

1. **Fetch schema (API Key / IAM / Cognito).**

2. **(Optional) Fetch resolvers using IAM.**

3. **Build contexts from the schema.**

4. **Generate test plans (LLM).**

5. **Materialize tests (Pytest/Jest).**

6. **Run tests and (optionally) serve Allure.**

## Allure (Pytest)
```
pip install allure-pytest
pytest contexts --alluredir ./allure-results
npx allure serve ./allure-results
```