# Load profile — Mingla Business (#426)

**Status:** Engineering baseline (Tier 1). Full 100k proof is a launch gate — see [LAUNCH_GATES.md](./LAUNCH_GATES.md).

## What “100k users” means for Mingla Business

| Metric | Assumption (v1) | Notes |
|--------|-----------------|-------|
| Registered business users (brands) | 100,000 | Organizers on mingla-business |
| Peak concurrent sessions | 5,000 (5%) | Event-day spikes |
| Peak RPS — discover/read | 200 | Public event pages + discover merge |
| Peak RPS — checkout | 50 | Buyer checkout create/confirm/status |
| Peak RPS — Ari | 30 | `agent-chat` + `agent-confirm-action` |
| Peak RPS — marketing send | 10 sustained, 500 burst | Campaign blast (queued) |
| Realtime chat/collab | 2,000 concurrent channels | Consumer app; business app lower |

Adjust these with real Mixpanel/Supabase metrics before launch.

## Critical paths (business app)

| Path | Edge / service | Auth | Load script |
|------|----------------|------|-------------|
| Public discover merge | `discover-merged-events` | Anon | `scripts/load/discover-merged-events.js` |
| Buyer checkout status | `ticket-checkout-status` | Anon token | `scripts/load/ticket-checkout-status.js` |
| Checkout create | `ticket-checkout-create` | Anon / mixed | Future (needs test fixtures) |
| Ari chat | `agent-chat` | JWT | Future (needs test user JWT) |
| Marketing send | `marketing-send` | JWT | Future (rate-limited; queue) |
| Stripe webhooks | `stripe-webhook` | Signature | Stripe load tests only |

## SLO targets (staging / production)

| Path | p95 latency | Error rate |
|------|-------------|------------|
| Read/list endpoints | &lt; 800 ms | &lt; 0.1% |
| Checkout create | &lt; 2 s | &lt; 0.5% |
| Ari turn | &lt; 8 s | &lt; 1% (model latency) |
| Marketing send enqueue | &lt; 3 s | &lt; 0.5% |

## Progressive test plan

1. **CI smoke** — 2 VU, 15 s (`scripts/load/smoke.js`)
2. **Local / staging** — 10–50 VU per path
3. **Staging scale** — 1k → 10k → 100k (operator staging project)
4. **Fix → re-run** until green

## Harness

- Scripts: `scripts/load/`
- Validation: `node scripts/load/validate-k6-scripts.mjs`
- Workflow: `.github/workflows/load-smoke.yml`
