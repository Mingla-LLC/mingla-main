# REVIEW — Implementation Rework ORCH-0777 — Production Ticket Checkout

Date: 2026-05-10
Reviewer: Orchestrator (Claude `mingla-orchestrator`)
Subject: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
Verdict: **APPROVED for independent retest with explicit conditions** — not close-ready.

## Plain-English Verdict

The rework lands the structural fixes that made the prior implementation unsafe to ship. Buyers will no longer be rejected by the SQL bug. A successful card payment now leads to a "Finalizing your tickets…" state that polls instead of throwing. Real organizer surfaces (Event Detail, Order Detail, Guests, Reconciliation, EventListCard, Edit-published guard) read server orders. The status endpoint requires a per-buyer token, the QR shape is no longer a plaintext bearer, the PaymentIntent persist failure is now caught and the PI canceled. None of this proves the path works end-to-end against a real database — local Supabase wasn't running, so the migration was never applied locally and no live RPC ran. That gate plus three substantive concerns (privacy story, loading-state honesty, refund/cancel UI) belong to the independent tester.

## Independent Verification (read against live working tree)

| Delta | Verdict | Live Evidence |
|---|---|---|
| **P0a** SQL predicate | **PASS** | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:356-357` now reads `NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text]))`. Static regression in `ticketCheckoutMigrationGuards.test.ts`. |
| **P0b** Post-payment processing UI | **PASS** | `payment.tsx:158-220` adds `setFinalizing`, `pollTicketCheckoutStatus`, and on timeout `setFinalizingTimedOut(true)` with copy `"Payment received"` (success-framed, not error). Throw string removed. Strict-grep gate forbids it. |
| **P0c** Local DB apply/lint | **BLOCKED** | `supabase db reset --local` and `db lint --local` both blocked because local Supabase stack not running. Operator gate. No remote push attempted. |
| **P1a** Event Detail sold/revenue/activity | **PASS** | `app/event/[id]/index.tsx:79, 313` imports/uses `useEventOrders`. No `useOrderStore` reference (live grep returned 0 hits in this file). |
| **P1a** Order Detail + resend/refund/cancel | **PASS w/ flag** | `app/event/[id]/orders/[oid]/index.tsx:42, 154` uses `useEventOrderById`. `showRefundFull`, `showRefundPartialAgain`, `showCancelOrder` all hardcoded `false` at lines 278-280 — actions hidden, not silently broken. Resend wired through `ticket-confirmation-dispatch`. **Type import at line 38 still imports `OrderStatus, RefundRecord` from `useOrderStore` for shape compatibility — flag for tester to confirm this isn't a back-door read.** |
| **P1a** Guests list / detail | **PASS w/ scope flag** | `guests/index.tsx:44, 215` uses `useEventGuestList`. `guests/[guestId].tsx:29, 185` uses `useEventGuestById` + `useEventGuestList`. Implementor flagged that cross-event buyer history is now current-event-only until a brand-scoped endpoint is built — accepted as deferred. |
| **P1a** Reconciliation | **PASS** | `reconciliation.tsx:58, 102` uses `useEventReconciliation`. |
| **P1a** EventListCard | **PASS** | `EventListCard.tsx:33, 98` uses `useEventOrders`. |
| **P1a** EditPublishedScreen web-purchase guard | **PASS** | `EditPublishedScreen.tsx:111, 746` uses `useEventHasWebPurchases`. |
| **P1b** QR / status endpoint privacy | **PARTIAL — tester must adjudicate** | Status endpoint now hard-requires `buyerStatusToken` and SHA-256-verifies against `buyer_status_token_hash` (`ticket-checkout-status/index.ts:16-30`, returns 401/403). Buyer status token generated and persisted at create time (`ticket-checkout-create/index.ts:62, 93, 130`). Scanner now derives the QR payload from `biz_ticket_checkout_qr_payload(ticket_id, qr_token_hash)` and verifies on submission (migration:704). **However, `tickets.qr_code` still stores the signed display payload, which is what scanner verifies against. Existing RLS (per prior tester report) permits buyer + brand-team SELECT on tickets — so brand-team members can still read scan credentials by reading the `qr_code` column.** Implementor flagged this for review. The original recommendation was "move raw token off entirely"; this rework moved off the raw bearer but kept the signed payload on the row. Tester must decide whether this satisfies the privacy bar the operator set. Hash digest moved from MD5 to SHA-256. |
| **P1c** PaymentIntent session-update error | **PASS** | `ticket-checkout-create/index.ts:173-178` calls `await stripe.paymentIntents.cancel(paymentIntent.id)` on persist failure and returns `payment_session_persist_failed` 500. |
| **P2** Schema/spec reconciliation | **PARTIAL** | Migration grew ~75 lines; defaults/columns/hash index/session fields named in the prompt are present. Full SQL execution gate blocked because local Supabase wasn't running. Tester must validate against local apply once available. |

Strict-grep gate (`.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`) extended with the four new patterns (throw string, `<> ANY` predicate, `useOrderStore` in 7 surfaces, anonymous-status QR shape). Verified live.

## Substantive Concerns to Hand to Tester

These are not blockers to the retest dispatch, but the tester MUST probe them and either pass or document explicit gaps.

### 1. Loading-state honesty across the new server hooks

`useEventReconciliation`, `useEventGuestList`, `useEventGuestById`, `useEventOrderActivity`, `useEventOrderRevenue`, `useEventHasWebPurchases` all collapse the React Query state into a single value (e.g. `ordersQuery.data ?? []`). A loading or errored fetch will surface as "no orders / no guests / no purchases / 0 sold." The previous local-store behavior was the same shape (`[]` for unknown), so this is design-equivalent — but with a network round-trip now in front of every read, a momentary loading flash may show organizers "0 sold" on Event Detail before the data lands. Constitutional concern: response shape truthful in ALL states (loading, error, empty, populated).

Tester must:
- Probe whether Event Detail / EventListCard / Edit-published web-purchase guard ever flashes a misleading state during slow networks or auth re-settle.
- Probe whether the EditPublishedScreen guard could allow a destructive edit during a load window because `useEventHasWebPurchases` returned `false` before data arrived.

### 2. QR/scanner privacy — does this satisfy the operator's bar?

Implementor explicitly flagged. The signed payload is on `tickets.qr_code`, scanner verifies by recomputing from ticket id + `qr_token_hash`. This is strictly better than the old raw bearer, AND the unauthenticated public-leak attack vector through `ticket-checkout-status` is closed by the buyer status token. But brand-team members with normal `tickets` RLS read access can still pull every `qr_code` for their event and impersonate scans.

Tester must:
- Confirm with operator whether brand-team-internal scan-credential leakage is in or out of scope.
- If in scope, recommend either (a) tightening tickets RLS to deny SELECT on `qr_code` outside `scan-ticket` service-role context, or (b) moving the signed payload off the row entirely (per the original P1b recommendation) and issuing it through a buyer-authenticated endpoint at confirmation.

### 3. Refund/cancel disabled rather than wired

`showRefundFull`, `showRefundPartialAgain`, `showCancelOrder` are hardcoded `false`. The buttons don't render. This is honest. But:
- The refund history section still renders if `order.refunds.length > 0`. For new server orders this is always 0, so the section is dead code on the server path. Confirm no UI confusion when a server order has no refunds.
- `Order Detail` line 38 still imports `OrderStatus, RefundRecord` types from `useOrderStore`. Type-only import is fine; tester should confirm no runtime read leaks through this import.

Tester must:
- Confirm refund/cancel buttons are absent in UI for server orders.
- Confirm no fake-success affordance shows up anywhere (e.g. swipe actions, long-press menus, deep links).

### 4. Local apply gate untouched

P0c was blocked by local Supabase not running. The tester pass MUST coordinate an operator step to:
- Start local Supabase (`supabase start`).
- Run `supabase db reset --local` or `supabase migration up --local`.
- Run `supabase db lint --local`.
- Capture the corrected migration's apply output.
- Only then is remote push reasonable to consider.

This is the gate that prevents another "passed static, broke at deploy" outcome.

## Constitutional Compliance Check

| Constitution rule | Status |
|---|---|
| 1. No dead taps | OK — refund/cancel hidden, not greyed-out-with-no-action. |
| 2. One owner per truth | OK — server orders are now canonical; `useOrderStore` is no longer a sales authority. |
| 3. No silent failures | **At risk** — see concern #1 (loading-state collapse). |
| 4. One query key per entity | OK — `eventOrdersKeys` factory in `useEventOrders.ts:18-26`. |
| 5. Server state stays server-side | OK — orders fetched via React Query, not persisted in Zustand. |
| 6. Logout clears everything | Tester to verify: `useAuth` gate on hooks (`session !== null`); does cache invalidate on sign-out? |
| 7. Label temporary fixes | OK — refund/cancel disabled; implementor noted in report; follow-up registered. |
| 8. Subtract before adding | OK — old `useOrderStore` reads removed before server reads added. |
| 9. No fabricated data | At risk — see concern #1. Loading-state `[]` is design-equivalent to old store, so not a regression, but flagged. |
| 10. Currency-aware UI | Tester to verify: `useEventOrderRevenue(eventId, currency = "GBP")` defaults to GBP — does this reintroduce the ORCH-0769 currency-mismatch class? |
| 11. One auth instance | OK. |
| 12. Validate at the right time | OK — webhook timing UX (P0b). |
| 13. Exclusion consistency | OK — selling-state predicate fixed. |
| 14. Persisted-state startup | OK — server data fetched fresh; no stale Zustand sales projection. |

## Five-Truth-Layer Reconciliation (post-rework)

| Layer | State |
|---|---|
| Docs (spec) | Aligned, with two documented partials (refund/cancel, cross-event guest history). |
| Schema | Migration corrected and aligned, but **not applied locally or remotely**. |
| Code | Reflects spec for the rework deltas; static + Deno gates pass. |
| Runtime | **Unproven.** No local DB apply, no Edge deploy, no buyer-flow run. |
| Data | No durable order/ticket created against the corrected migration yet. |

Three layers proven; two remain unproven and gate CLOSE.

## Verdict

**APPROVED for independent retest** by Claude `mingla-forensics` (TEST mode), with the four substantive concerns above explicitly handed in the tester prompt.

Do **NOT**:
- Push migration remotely.
- Deploy Edge Functions.
- Announce production ticket checkout.
- Move ORCH-0777 toward CLOSE.

Until:
- Local DB apply succeeds and lint passes (operator-gated).
- Tester PASS resolves the four concerns or operator explicitly accepts them.
- Operator-assisted live-fire (free + paid + webhook replay + Resend + Twilio + cross-device scanner) confirms the production loop.

## Documents Updated

- This review: `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
- Tester prompt: `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
- Priority Board, Master Bug List, Open Investigations, Agent Handoffs: post-review banners pending.

## Next Step

Operator dispatches **Claude `mingla-forensics`** in TEST mode with the prompt at
`Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`.
Expected output: `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`.

Coordination note: the local Supabase apply step is operator-driven; tester should request operator action explicitly when reaching that gate rather than treating "blocked" as a PASS condition.
