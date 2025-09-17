---
layout: default
title: Security
nav_order: 10
---

# Security notes

- Secrets (API keys, JWT) should be passed via **env vars** or VS Code inputs—avoid committing to git.
- Resolver/data source snapshots omit secrets.
- Consider using a separate AWS profile with least‑privilege for resolver fetch.
- Don’t commit API keys, JWTs, or Allure result payloads that might include headers. The scaffold masks x-api-key and authorization by default for artifacts.
- IAM fetch uses your local AWS credentials; ensure least privilege and avoid committing _datasources/*.json if they reveal internal ARNs or roles.
