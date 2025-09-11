
# Security notes

- Secrets (API keys, JWT) should be passed via **env vars** or VS Code inputs—avoid committing to git.
- Resolver/data source snapshots omit secrets.
- Consider using a separate AWS profile with least‑privilege for resolver fetch.
