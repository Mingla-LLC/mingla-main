# G1 discover @ 1k VU — post-deploy (#455 merged)

**Date:** 2026-06-13  
**Deploy:** PR #455 merged + staging deployed  
**Runner:** `./scripts/load/run-staging.sh discover 1000 5m` (2m ramp + 5m @ 1k VU)

## Result: PARTIAL — latency FAIL, availability PASS

| Metric | Pre-deploy (2026-06-12) | Post-deploy |
|--------|-------------------------|-------------|
| Requests | 50,888 | **147,982** |
| Check pass | 99.996% | **99.99%** (2 fails) |
| Throughput | ~120 req/s | **~350 req/s** |
| p95 latency | 9.69 s | **6.61 s** |
| Error rate | 0.004% | **0.001%** |

**SLO:** read p95 &lt; 800 ms — **FAIL** (6.61 s)  
**k6 threshold:** p95 &lt; 2 s — **FAIL**

Deploy improved throughput ~3× and cut p95 ~32%, but discover is not yet at the 800 ms read SLO at 1k VU.

Report: `reports/20260613T043426Z-discover-vus1000.json`
