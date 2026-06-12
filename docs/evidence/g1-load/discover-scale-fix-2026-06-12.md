# discover-merged-events scale fix (ORCH-426 G1)

**Date:** 2026-06-12  
**Root cause (Phase 2 @ 1k VU):** Sequential Postgres fan-out + Ticketmaster invoke; exact row count on nested embed; no response cache for identical city queries. Checkout paths stayed &lt;200 ms p95 at same concurrency.

## Changes (local — deploy required)

| Layer | Change |
|-------|--------|
| Edge | **Parallel fan-out** — `Promise.all([businessPromise, ticketmasterPromise])` |
| Edge | **30s response cache** — `discover_merged_events_cache` keyed by city/filters/page |
| Edge | **Estimated count** — `count: "estimated"` on business query |
| DB | `idx_events_discover_feed` — partial index incl. `event_type = 'event'` |
| DB | `idx_event_dates_master_end_at` — `(event_id, end_at) WHERE is_master` |
| Harness | `scripts/load/run-distributed.sh` — k6 execution segments for 10k VU |
| CI | `scripts/audit/discover-scale-contract.mjs` + Deno tests |

## Deploy to Mingla-dev

```bash
export SUPABASE_ACCESS_TOKEN=...
./scripts/load/deploy-discover-staging.sh
```

Then re-run:

```bash
./scripts/load/run-staging.sh discover 1000 5m
```

## Regression tests

```bash
node scripts/audit/discover-scale-contract.mjs
deno test --allow-read supabase/functions/discover-merged-events/__tests__/cache_key.test.ts
deno test --allow-read supabase/functions/discover-merged-events/__tests__/discover_scale_contract.test.ts
```
