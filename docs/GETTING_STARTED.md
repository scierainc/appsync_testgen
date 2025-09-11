# Getting started

## Requirements
- Node.js 18+ and npm
- Python 3.9+ (for Pytest)
- VS Code (latest)
- AWS CLI (for IAM flows) with configured profiles
- (Optional) Allure:
  - `npm i -D allure-commandline`
  - `pip install allure-pytest`

## Install & build
```bash
npm i
npm run watch   # dev loop (used by VS Code debug)
# or
npm run build
```
*If the VS Code debugger says “Waiting for preLaunchTask 'watch'…”, ensure npm run watch exists and TypeScript compiles.*


## First run

1. **Fetch schema (API Key / IAM / Cognito).**

2. **(Optional) Fetch resolvers using IAM.**

3. **Build contexts from the schema.**

4. **Generate test plans (LLM).**

5. **Materialize tests (Pytest/Jest).**

6. **Run tests and (optionally) serve Allure.**

