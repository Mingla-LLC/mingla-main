# Production readiness audits (#426)

CI-runnable static audits for issue #426 Tier 1 engineering gates.

```bash
node scripts/audit/run-all.mjs --self-test   # regression self-tests
node scripts/audit/run-all.mjs               # full audit (CI)
```

| Script | Fails CI on |
|--------|-------------|
| `secrets-scan.mjs` | Hardcoded secrets in mingla-business client paths |
| `swallowed-errors.mjs` | Empty catch blocks in mingla-business |
| `n-plus-one-heuristic.mjs` | Informational only (use `--strict` to fail) |

## RLS coverage moved out of this directory (#1860)

`rls-coverage.mjs` was **retired and deleted** at issue #1860. It was
near-vacuous: its `CREATE TABLE` / `DROP TABLE` patterns matched only the
double-quoted dump style the baseline squash uses, so every table created since
with plain `CREATE TABLE public.x` was invisible to it — it was green because it
barely looked — and it carried an unbounded `_archive_` prefix skip, an
exemption channel with no names, no review and no record. Twelve tables
accumulated outside RLS behind it.

The rule now lives in one strong gate instead of two of unequal strength:

- `.github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs` (static, every PR)
- `supabase/migrations/__tests__/issue_1860_public_rls_coverage.test.sql` (live catalog, CI container)

`rls-allowlist.json` **stays here** and is still the one reviewed exemption
list — the #1860 gate pins it to exactly `spatial_ref_sys`. Do not re-create
`rls-coverage.mjs`; the gate's C6 rule fails if it reappears.
