# G1 Phase 3 — 10,000 VU distributed discover

**Date:** 2026-06-12  
**Runner:** `scripts/load/run-distributed.sh discover 4 2500 5m` (native k6, 4 execution segments)  
**Staging:** Mingla-dev `gqnoajqerqhnvulmnyvv` — **discover scale fix not deployed**

## Summary

**FAIL** — ~79% requests failed (30s timeouts / non-2xx). Staging discover path cannot sustain 10k VU without deploy + likely further tuning.

| Worker segment | Approx requests | 2xx check pass | p95 |
|----------------|-----------------|----------------|-----|
| 0/4 | ~9.7k | ~21% | 30 s (timeout) |
| 1/4 | (see logs) | ~21% | 30 s |
| 2/4 | ~19.5k | 21.5% | 30 s |
| 3/4 | ~29.2k | 21.3% | 30 s |

**Combined:** ~68k+ requests across workers; majority timed out at 30s.

Logs: `/tmp/g1-distributed-20260612T150638Z/worker-*.log`  
Reports: `reports/20260612T150638Z-discover-seg*vus2500.json`

## Gate decision

Phase 3 blocked on:

1. Deploy `discover-scale-fix` to staging
2. Re-pass discover @ 1k VU
3. Re-run Phase 3 distributed

## Command

```bash
./scripts/load/run-distributed.sh discover 4 2500 5m
```
