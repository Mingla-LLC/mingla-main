# G1 Phase 0 — Staging smoke (2 VU × 15s)

**Date:** 2026-06-12  
**Project:** Mingla-dev `gqnoajqerqhnvulmnyvv` (G2 ✅)  
**Runner:** `scripts/load/run-staging.sh smoke` (Docker g6/k6)  
**Reports:** `reports/20260612T134407Z-smoke-vus2.json` (pre-fix) · `reports/*-smoke-vus2.json` (post-fix ✅)

## Fixture IDs (discovered)

| Variable | Value |
|----------|-------|
| `LOAD_TEST_EVENT_ID` | `a0000000-0000-4000-8000-000000002076` (Paystack NG Test Event) |
| `LOAD_TEST_TICKET_TYPE_ID` | `a0000000-0000-4000-8000-000000003076` |

## Path results (first run)

| Path | Check | p95 latency | Notes |
|------|-------|-------------|-------|
| discover-merged-events | ✅ 2xx | ~475ms | OK |
| ticket-checkout-status | ✅ not 5xx | — | OK |
| ticket-checkout-create | ✅ not 5xx | — | OK with real fixtures |
| agent-chat | ✅ 401 gate | — | No JWT (expected) |
| marketing-send | ❌ → fixed | — | Staging returns **401** not 403; smoke harness updated |

## Harness fix (same day)

- `smoke.js` / `marketing-send.js`: accept 401 or 403 for unauthenticated marketing-send
- `smoke.js` thresholds: use `checks` rate instead of global `http_req_failed` (auth gates are 4xx by design)

## Phase 0 result (post-fix)

**PASS** — 100% checks, 20 iterations, p95 latency **547ms** (threshold 3s).

## Next

- [x] Phase 0 smoke green
- [x] Phase 1: 50 VU × 60s — see [phase1-50vu-2026-06-12.md](./phase1-50vu-2026-06-12.md)
- [ ] Phase 2–4: 1k → 10k → 100k (distributed k6)
