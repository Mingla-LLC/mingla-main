# G1 discover re-run @ 1k VU (pre-deploy baseline)

**Date:** 2026-06-12  
**Note:** Fixes in `discover-scale-fix-2026-06-12.md` were **not deployed** (`SUPABASE_ACCESS_TOKEN` unavailable in runner). This run reflects **current staging** behavior.

| Metric | Phase 2 (before fix) | This re-run |
|--------|-------------------|-------------|
| Requests | 54,131 | 50,888 |
| Check pass | 99.996% | 99.996% (2 fails) |
| p95 latency | 9.18 s | **9.69 s** |
| Throughput | ~130 req/s | ~120 req/s |

**Result:** ❌ FAIL — latency SLO (&lt;800 ms). Deploy fixes and re-run.

Report: `reports/20260612T145925Z-discover-vus1000.json`
