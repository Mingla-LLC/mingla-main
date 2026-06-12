# G1 load test evidence — Issue #426 Tier 2

**Gate:** G1 — 100k load test on staging  
**Target project:** Mingla-dev `gqnoajqerqhnvulmnyvv` (G2)  
**Harness:** `scripts/load/` + `scripts/load/run-staging.sh`

## Progressive plan

| Phase | VUs | Duration | Script | Pass criteria |
|-------|-----|----------|--------|---------------|
| 0 — Smoke | 2 | 15s | `smoke.js` | All paths not 5xx; discover 2xx |
| 1 | 50 | 60s | per-path + smoke | p95 within SLO (`docs/load-profile.md`) |
| 2 | 1,000 | 5–10m | per-path | error rate &lt; 0.1–0.5% per path |
| 3 | 10,000 | TBD | distributed k6 | same |
| 4 | 100,000 | TBD | distributed k6 | **epic headline gate** |

Reports land in `docs/evidence/g1-load/reports/` (JSON summary exports).

## Run locally

```bash
cp scripts/load/fixtures/example.env scripts/load/fixtures/.env.load
# Fill SUPABASE_ANON_KEY (staging anon — same as EXPO_PUBLIC_SUPABASE_ANON_KEY for dev project)

source scripts/load/fixtures/.env.load
node scripts/load/discover-fixtures.mjs >> scripts/load/fixtures/.env.load

chmod +x scripts/load/run-staging.sh
./scripts/load/run-staging.sh smoke
./scripts/load/run-staging.sh scale 50 60s
```

Optional JWT path (agent-chat, marketing-send):

```bash
export LOAD_TEST_EMAIL=...
export LOAD_TEST_PASSWORD=...
eval "$(node scripts/load/fetch-test-jwt.mjs)"
./scripts/load/run-staging.sh agent-chat
```

## Attach to #426

When a phase passes, add a comment on epic #426 with:

- Phase name + VU count + duration
- Link to report JSON in this folder (or paste p50/p95/p99 + error rate table)
- Any regressions fixed before next phase
