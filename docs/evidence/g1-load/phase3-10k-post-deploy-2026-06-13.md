# G1 Phase 3 — 10k VU distributed discover (post-deploy)

**Date:** 2026-06-13  
**Deploy:** PR #455 merged + staging deployed  
**Runner:** `./scripts/load/run-distributed.sh discover 4 2500 5m` (4 segments × 2500 VU)

## Result: FAIL — ~25% errors at 10k VU

| Segment | Requests | 2xx pass | Error rate | p95 (successful) |
|---------|----------|----------|------------|------------------|
| 0/4 | ~20.8k | 75.1% | 24.9% | ~15 s |
| 1/4 | (see worker-1 log) | — | — | — |
| 2/4 | 41,289 | 74.8% | 25.2% | ~14.5 s |
| 3/4 | 61,681 | 74.9% | 25.1% | ~15 s |

**Combined:** ~145k+ requests; majority of failures are 30 s k6 timeouts.

**vs pre-deploy Phase 3:** error rate improved from **~79%** → **~25%**, but gate not met (&lt;0.5% error target).

Reports: `reports/20260613T044150Z-discover-seg*of4-vus2500.json`

## Next

- Increase cache TTL or widen cache key bucketing for load-test city payloads
- Consider materialized view / slimmer discover select (drop ticket_types embed from list query)
- Re-run 1k until p95 &lt; 800 ms before re-attempting 10k
