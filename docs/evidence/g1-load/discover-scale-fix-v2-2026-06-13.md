# G1 discover scale fix v2 (ORCH-426)

**Problem:** Phase 2 @ 1k p95 ~6s; Phase 3 @ 10k ~25% errors. Root cause: heavy PostgREST nested query + per-isolate cache stampede + TM/DB serial pressure.

## Changes (this patch)

| Layer | Fix |
|-------|-----|
| SQL | `pg_discover_business_events` — one RPC replaces events+brands+event_dates+ticket_types embed; inline paid-supply gate |
| SQL | `pg_try_discover_cache_build_lock` — cross-isolate single-flight |
| Edge | L1 memory cache (120s fresh / 10m stale) + per-isolate coalesce |
| Edge | Stale-while-revalidate background refresh |
| Edge | DB cache poll for waiters when lock not acquired |
| Harness | k6 v2 segment format `0/4:1/4` in `run-distributed.sh` |

## Deploy

```bash
export SUPABASE_ACCESS_TOKEN=...
./scripts/load/deploy-discover-staging.sh
```

## Validate

```bash
./scripts/load/run-staging.sh discover 1000 5m    # target p95 < 800ms, >99.5% checks
./scripts/load/run-distributed.sh discover 4 2500 5m   # target >99.5% 2xx, p95 < 2s
node scripts/audit/discover-scale-contract.mjs
```

## Expected behavior post-deploy

Load test hammers identical Austin payload → first request builds (RPC + TM once), all others hit L1/DB cache in <100ms. Distributed lock prevents hundreds of parallel origin builds at 10k VU cold start.
