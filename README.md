# AppSync TestGen (VS Code Extension)

Generate high-quality GraphQL test plans for **AWS AppSync** directly from VS Code.  
This extension can:

- Connect to an AppSync API (API key or IAM / AWS profile)  
- Fetch **schema** (runtime introspection or **control-plane fallback** via `GetIntrospectionSchema`)  
- Fetch **resolvers** (VTL & JS) using IAM  
- Build per-operation **contexts** (variables skeleton, return type tree, resolver references)  
- Generate test plans via your **preferred LLM** (OpenAI / Anthropic / Bedrock / Gemini / OpenAI-compatible)

> **Default secret policy:** secrets are **not** persisted. You’ll be prompted each run unless you enable persistence.

---

## Install / Build

```bash
npm i
npm run build
# Press F5 in VS Code to launch Extension Development Host
