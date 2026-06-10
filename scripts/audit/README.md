# Production readiness audits (#426)

CI-runnable static audits for issue #426 Tier 1 engineering gates.

```bash
node scripts/audit/run-all.mjs --self-test   # regression self-tests
node scripts/audit/run-all.mjs               # full audit (CI)
```

| Script | Fails CI on |
|--------|-------------|
| `rls-coverage.mjs` | Public tables without RLS (minus allowlist) |
| `secrets-scan.mjs` | Hardcoded secrets in mingla-business client paths |
| `swallowed-errors.mjs` | Empty catch blocks in mingla-business |
| `n-plus-one-heuristic.mjs` | Informational only (use `--strict` to fail) |

Allowlist: `rls-allowlist.json`
