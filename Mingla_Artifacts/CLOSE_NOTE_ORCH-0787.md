# CLOSE NOTE — ORCH-0787

Date closed: 2026-05-11
Closed by: Claude `mingla-orchestrator` (operator delegated "take over" through hotfix → deploy → device verify → close)
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
PR: pending (this close opens it)

## Verdict

**PASS.** Live-fire QA at `Mingla_Artifacts/reports/QA_ORCH-0787_LIVE_FIRE_REPORT.md` returned PASS after a four-step hotfix chain. Operator-witnessed device live-fire on 2026-05-11 17:46 UTC: a real $50 USD test-mode refund against order `6ad119af-…` on event "The party block" (brand "Leggo This") completed end-to-end — Stripe refund `re_3TVkS5PjlZyAYA401Z1MzZad`, order `payment_status` flipped to `refunded`, `refunded_amount_cents=5000`. All 4 P0 defects discovered post-deploy were fixed and verified in production.

## What shipped — base ORCH-0787 work

Server-side production-grade refund + cancel pipeline:

1. **Migration** `20260520000000_orch_0787_order_refund_cancel.sql` — extends `orders` (cancellation_reason/cancelled_at/cancelled_by/refunded_amount_cents), extends `refunds` (currency/stripe_payment_intent_id/stripe_charge_id/application_fee_refunded_cents/processed_at/metadata), new `refund_line_items` table, 6 new indexes including `idx_refunds_metadata_idempotency_key` (race-mitigation match path), 4 new RPCs (`biz_refund_order`, `biz_refund_order_commit`, `biz_refund_order_commit_from_webhook`, `biz_cancel_order`), RLS policies including direct-predicate SELECT-for-RETURNING per I-PROPOSED-H, generated `payment_webhook_events.account_id` column (S-09 fix).
2. **Edge functions** `refund-order` (Stripe Refunds API with `reverse_transfer:true`, idempotency-key-aware) and `cancel-order` (free-order-only, paid orders forced through refund path per Q-1).
3. **Stripe webhook router extension** in `_shared/stripeWebhookRouter.ts` — handles `charge.refunded`, `refund.created`, `refund.updated` and calls `biz_refund_order_commit_from_webhook` with `metadata.mingla_idempotency_key` match path for the in-app/dashboard race (T-19).
4. **Mingla-business UI** — `RefundSheet`, `CancelOrderDialog`, `OrderDetailRoute` wired to the new mutations (`useRefundOrder`, `useCancelOrder`) replacing the prior Zustand stubs. `eventOrdersService` queries joined `refunds (…)` and `refund_line_items (…)`. `brandStripeOrphanedRefundsService` re-pointed at the real `payload`/`type`/`stripe_event_id` columns.
5. **Order detail page** — `deriveActionFlags(order, canRefund)` replaces hardcoded `false` flags so the Refund/Cancel CTAs render under the correct conditions.

## Post-deploy P0 hotfix chain (this session)

After v1 deploy, four production-blocking defects surfaced and were fixed:

### F-12 + F-13 — Hermes `crypto` ReferenceError (P0)

`RefundSheet.tsx:107` and `CancelOrderDialog.tsx:76` called `crypto.randomUUID()` directly. Hermes (React Native's JS engine) has no global `crypto`; both sheets crashed the instant they opened. Fix:
- New shared util `mingla-business/src/utils/randomId.ts` — uses `globalThis.crypto?.randomUUID` when present, falls back to Date+Math.random tuple. Output always in [8,128] char range per the edge function's Idempotency-Key contract.
- Both components rerouted through `randomId()`. `eventCoverMediaService.ts` refactored to consume the same shared util (removed its inline duplicate).
- 7-test regression spec at `mingla-business/src/utils/__tests__/randomId.test.ts` — includes an explicit "does not throw" guard for the exact ReferenceError.
- Strict-grep §8.1.10 added to `.github/scripts/strict-grep/orch-0787-refund-cancel-flow.mjs` forbidding bare `crypto.randomUUID(` in either component.

### F-15 + F-16 — `auth.uid()` NULL inside SECURITY DEFINER (P0)

Edge functions called the RPCs via `serviceClient()`; service-role JWTs carry no `sub` claim, so `auth.uid()` returned NULL inside the SECURITY DEFINER bodies and `biz_can_manage_payments_for_brand(brand, NULL)` always returned false → `permission_denied` 42501 → HTTP 403. The legitimate brand owner couldn't refund. Fix:
- New `userClient(req)` helper in `supabase/functions/_shared/ticketCheckout.ts` — `SUPABASE_ANON_KEY` + caller's Authorization header.
- `refund-order/index.ts` calls all auth-context RPCs (`biz_refund_order`, three `biz_refund_order_commit` sites) through `supabaseAsUser`; service-role retained for non-auth-context ops (orders lookup, notification enqueue, audit).
- `cancel-order/index.ts` calls `biz_cancel_order` through `supabaseAsUser`.
- Both functions redeployed to v2 with `verify_jwt:true` preserved.

### F-RAK — `STRIPE_RAK_TICKET_REFUND` secret unset (pre-condition gap)

The Stripe Restricted API Key the refund-order code reads (`Deno.env.get("STRIPE_RAK_TICKET_REFUND")`) had never been configured. First post-fix attempt at 17:24 UTC returned 502 with `failed` refund row `cc322207-…` (no Stripe refund created). Resolution:
- Operator created a test-mode RAK in Stripe sandbox ("MINGLA LLC sandbox") with permissions: **Charges and Refunds: Write**, **Payment Intents: Read**, **Connect Application Fees: Write**, **Connect Transfers: Write**.
- Orchestrator set the secret via `supabase secrets set --env-file <tmp>` (value never echoed; temp file deleted; `stripe-values.md` is gitignored).
- Boot probe post-secret confirmed clean.

## Root causes (proven)

| Defect | Root cause | Evidence layer |
|---|---|---|
| F-12 / F-13 | Hermes runtime exposes no global `crypto`; `crypto.randomUUID()` is browser-/Node-only | Runtime stack trace from iOS device |
| F-15 / F-16 | SECURITY DEFINER + service-role client + `auth.uid()` is a well-known anti-pattern; `request.jwt.claim.sub` is unset under service-role | RPC-layer reproduction + DB inspection |
| F-RAK | Configuration gap — RAK existed in operator's local `stripe-values.md` but was never pushed to Supabase Edge Function secrets | `supabase secrets list` showed only sibling RAKs |

## Files shipped (this close)

Code:
- `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql`
- `supabase/functions/refund-order/index.ts` + `index.test.ts`
- `supabase/functions/cancel-order/index.ts` + `index.test.ts`
- `supabase/functions/_shared/ticketCheckout.ts` — adds `userClient(req)` helper
- `supabase/functions/_shared/stripeWebhookRouter.ts` — three new event types + reconciler call
- `supabase/functions/_shared/idempotency.ts`
- `supabase/functions/_shared/stripe.ts`
- `mingla-business/src/components/orders/RefundSheet.tsx` + `CancelOrderDialog.tsx`
- `mingla-business/app/event/[id]/orders/[oid]/index.tsx`
- `mingla-business/src/hooks/useEventOrders.ts`
- `mingla-business/src/services/eventOrdersService.ts` + `brandStripeOrphanedRefundsService.ts`
- `mingla-business/src/services/orderRefundService.ts` + `orderCancelService.ts` (new)
- `mingla-business/src/services/eventCoverMediaService.ts` — refactored to use shared `randomId`
- `mingla-business/src/store/orderStore.ts`
- `mingla-business/src/utils/randomId.ts` (new) + `__tests__/randomId.test.ts` (new, 7 specs)
- `.github/scripts/strict-grep/orch-0787-refund-cancel-flow.mjs` (new, 10-assertion gate including §8.1.10 Hermes-safe-randomId)

Artifacts:
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md`
- `Mingla_Artifacts/reports/QA_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md` (original)
- `Mingla_Artifacts/reports/QA_ORCH-0787_SCHEMA_RETEST_REPORT.md`
- `Mingla_Artifacts/reports/QA_ORCH-0787_LIVE_FIRE_REPORT.md` (final, incl. §10/§11/§12 addenda)
- `Mingla_Artifacts/CLOSE_NOTE_ORCH-0787.md` (this file)

## Deploy state

| Surface | Version | verify_jwt |
|---|---|---|
| `refund-order` edge fn | v2 | true |
| `cancel-order` edge fn | v2 | true |
| `stripe-webhook` edge fn | v27 | false (signature-gated) |
| Migration `20260520000000_orch_0787_order_refund_cancel` | LIVE | n/a |
| `STRIPE_RAK_TICKET_REFUND` secret | SET (test-mode) | n/a |

## Invariants

No new invariants registered at close. The Hermes-safe-randomId rule and the SECURITY-DEFINER-needs-user-client rule are codified in strict-grep §8.1.10 + spec invariants `I-PROPOSED-H` (RLS-RETURNING-OWNER-GAP, ALREADY ACTIVE) + `I-PROPOSED-Q` (Stripe API version via shared client, ALREADY ACTIVE). The auth.uid pattern will be promoted as an invariant inside ORCH-0788 once the dispatcher work surfaces the same risk.

## Decisions logged

- **D-ORCH-0787-CLOSE-1** — Edge functions calling SECURITY DEFINER RPCs that read `auth.uid()` MUST use `userClient(req)` (anon key + caller's Authorization header), not `serviceClient()`. Service-role is reserved for non-auth-context ops (audit, notifications, lookups). Established after F-15/F-16.
- **D-ORCH-0787-CLOSE-2** — Test-mode Stripe RAKs for the ticket refund flow require these four permissions: Charges-and-Refunds:Write, Payment-Intents:Read, Connect-Application-Fees:Write, Connect-Transfers:Write. Documented for future RAK rotation / live-mode key creation.
- **D-ORCH-0787-CLOSE-3** — Buyer post-refund and post-cancel notification dispatcher is OUT OF SCOPE for ORCH-0787 and tracked as **ORCH-0788**. ORCH-0787 enqueues correct rows in `ticket_order_notifications`; consumer build is its own forensic-spec-implement-test cycle.

## Follow-up registered

**ORCH-0788 — Buyer post-purchase / post-refund / post-cancel notification dispatcher.** Scope:
- New edge function or extension that reads `ticket_order_notifications WHERE status='pending'`, routes by `template_key`, renders branded HTML email via Resend, marks `status` + `attempt_count` + `last_error`, retries with backoff.
- Two new templates: `buyer_refund_issued`, `buyer_order_cancelled`.
- Trigger mechanism: pg_cron schedule (e.g., every 1 min) OR pg_net call from db trigger on insert. Decide in INVESTIGATE.
- Test matrix must include the existing pending row `81fe2a68-1c28-4147-ac03-fda9d76d19fe` (would replay via idempotency_key on first dispatcher run).

Severity: **P1** — refund + cancel server flows complete, only the branded buyer email is missing. Operator can manually notify until dispatcher ships.

## Outstanding from prior QA (carried forward)

- F-01..F-04 (P2): orderStore contraction, application_fee_refunded_cents hardcoded 0, Jest extension, ORCH-0782 event-edit-log re-introduction.
- F-05/F-06/F-09 (P3): minor staleness, buyer-side cache, etc.

These remain tracked in `MASTER_BUG_LIST.md` and may roll into ORCH-0789..0791 follow-ups.

## Live-fire evidence

- Refund row: `b39f8633-4f53-4c9c-b5ba-36828649aa78` (succeeded, $50, `re_3TVkS5PjlZyAYA401Z1MzZad`)
- Order: `6ad119af-dee2-4a4d-b21e-eae2d91011f3` → `payment_status='refunded'`, `refunded_amount_cents=5000`
- Queue row: `81fe2a68-1c28-4147-ac03-fda9d76d19fe` (pending, awaiting ORCH-0788 dispatcher)

---

**End of close note — ORCH-0787.**
