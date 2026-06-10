# Load test harness (#426)

k6 scripts for Mingla Business production-readiness. See [docs/load-profile.md](../../docs/load-profile.md).

## Prerequisites

- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) installed locally
- `LOAD_BASE_URL` — Supabase functions base, e.g. `https://<project-ref>.supabase.co/functions/v1`
- `SUPABASE_ANON_KEY` — project anon key

## Run locally

```bash
export LOAD_BASE_URL="https://YOUR_REF.supabase.co/functions/v1"
export SUPABASE_ANON_KEY="your-anon-key"
export LOAD_VUS=10
export LOAD_DURATION=30s

k6 run scripts/load/smoke.js
k6 run scripts/load/discover-merged-events.js
k6 run scripts/load/ticket-checkout-status.js
```

## CI

- `validate-k6-scripts.mjs` runs on every PR (no secrets).
- Full k6 smoke runs when `LOAD_BASE_URL` + `SUPABASE_ANON_KEY` repo secrets are set (optional).

## Scale targets

Full 100k-user proof requires a dedicated staging project. This harness proves repeatability and catches regressions at sub-scale (see `docs/LAUNCH_GATES.md`).
