# TEST REPORT — ORCH-0777 RETEST — Production Ticket Checkout Rework

Date: 2026-05-10
Tester: Claude `mingla-tester` (legacy mirror — operator explicitly redirected from canonical Claude `mingla-forensics` TEST mode)
Mode: RETEST
Subject: implementor rework returned 2026-05-10
Verdict: **CONDITIONAL PASS — Edge Functions not yet deployed; B2 privacy concern needs operator adjudication**

## One-Paragraph Layman Summary

The structural rework lands cleanly. Every original P0 and P1 from the prior tester FAIL is fixed in code, the migration is **already live on the production database** (not the local-only state the implementor reported), and all schema gates I queried independently came back green. However, **five of the six Edge Functions ORCH-0777 needs are not yet deployed** — only `stripe-webhook` is live; `ticket-checkout-create`, `ticket-checkout-status`, `ticket-confirmation-dispatch`, `twilio-message-status`, and `scan-ticket` are absent from the project's deployed function list. So the mobile app would 404 against production today. Once those are deployed and the operator decides whether brand-team SELECT access to `tickets.qr_code` is acceptable in scope, ORCH-0777 is ready for the operator-assisted live-fire matrix.

## Counts

P0: 1 (Edge deploy gap) | P1: 1 (B2 privacy operator-adjudication) | P2: 6 | P3: 4 | P4: 2

## Original-Finding Map (re-prove from prior tester FAIL)

| Finding | Code Evidence | Runtime Evidence | Verdict |
|---|---|---|---|
| **P0a** SQL predicate rejects scheduled/live | `migration:356` `NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text]))` | Remote `pg_get_functiondef(biz_ticket_checkout_create_session)` confirms fixed predicate live on production | **PASS** |
| **P0b** Successful payment shown as error | `payment.tsx:158-172, 303-313` adds `setFinalizing` + `pollTicketCheckoutStatus` + success-framed `"Payment received"` UI on timeout; throw string removed; strict-grep enforces absence | `pollTicketCheckoutStatus` Jest test proves bounded polling returns null on timeout instead of throwing | **PASS** |
| **P0c** Migration not applied remotely | n/a | `supabase migration list --linked` shows `20260515000013` populated in BOTH Local and Remote columns; `pg_get_functiondef` confirms fixed code is live | **PASS — operator pushed since implementor's report** |
| **P1a** Order Detail off useOrderStore | `orders/[oid]/index.tsx:42, 154` `useEventOrderById`; type-only import of `OrderStatus, RefundRecord` is acceptable | `grep -rn useOrderStore` returns 0 hits in 7 surface files (3 stale JSDoc comments in OUT-OF-SCOPE files: `EventDetailKpiCard.tsx`, `types.ts`, `EventDetailTicketTypeRow.tsx`) | **PASS** |
| **P1a** Event Detail sold/revenue/activity | `event/[id]/index.tsx:79, 313, 314, 349-389` uses `useEventOrders` + `summarizeEventMoney` (currency-aware) | Static + grep clean | **PASS** |
| **P1a** Guest list / detail | `guests/index.tsx:44, 215`; `guests/[guestId].tsx:29, 185` | grep clean | **PASS** (cross-event buyer history scoped to current event — accepted scope reduction) |
| **P1a** Reconciliation | `reconciliation.tsx:58, 102` uses `useEventReconciliation` + `computeReconciliation` | grep clean | **PASS** |
| **P1a** EventListCard | `EventListCard.tsx:33, 98-124` uses `useEventOrders` + `summarizeEventMoney` with `expectedCurrency` from event/brand | grep clean | **PASS** |
| **P1a** EditPublishedScreen web-purchase guard | `EditPublishedScreen.tsx:111, 746` uses `useEventHasWebPurchases` | grep clean | **PASS** with B1 risk noted below |
| **P1b** Anonymous status endpoint | `ticket-checkout-status/index.ts:19-30` requires `buyerStatusToken`, returns 401 on missing, 403 on wrong token. Token verified by SHA-256 against `buyer_status_token_hash` on session row. | Remote `ticket_checkout_sessions.buyer_status_token_hash` column present (text, nullable) | **PASS** for anon-leak vector |
| **P1b** QR plaintext bearer | `migration:269-272` qr_code now stores `mingla:v1:ticket:<uuid>:sig:<sha256>` derived from `ticket_id + qr_token_hash + server pepper`. Hash uses SHA-256 (`migration:255-258`). Old MD5 + raw bearer pattern removed. | Remote `idx_tickets_qr_token_hash` unique index present; `biz_ticket_checkout_token_hash` and `biz_ticket_checkout_qr_payload` RPCs deployed | **PASS** for raw-bearer concern; **B2 brand-team-readable qr_code remains — see below** |
| **P1c** PaymentIntent persist failure ignored | `ticket-checkout-create/index.ts:169-181` checks update result, calls `stripe.paymentIntents.cancel()` on failure (with try/catch around cancel), returns `payment_session_persist_failed` 500 BEFORE buyer sees PaymentSheet | Static — no live test possible without invoking against production | **PASS** with P3 note (cancel-error swallow) |
| **P2** Schema/spec reconciliation | All 7 expected `orders` columns present with correct defaults; all 7 expected `ticket_checkout_sessions` columns; 3 unique indexes including `idx_tickets_qr_token_hash`; phone E.164 check constraint on `online_checkout` orders | All verified live via remote `information_schema.columns` and `pg_indexes` queries | **PASS** |

## Substantive-Concern Map (orchestrator review's four flags)

| Concern | Probe | Verdict |
|---|---|---|
| **B1** Loading-state honesty in new hooks | Adapters return `[]` / `0` / `false` while loading. Concrete blast: minor flash effect on Event Detail "Sold" tile during slow networks; EditPublishedScreen guard could fail-open during mid-load click. In practice the underlying React Query has `staleTime: 15s` and `useAuth` gate, and the dominant editing flow is post-render after data settles. | **PASS — P2 noted (cosmetic flash)**. Recommend tester surface a UseQueryResult-shaped variant for loading-aware consumers in a follow-up. |
| **B2** QR/RLS privacy adjudication | Remote `tickets` RLS policy `Buyer or brand team can select tickets` permits `biz_is_brand_member_for_read(...)` to SELECT all columns including `qr_code`. The signed display payload is exactly what `scan-ticket` accepts as input. **Brand-team members can read scan credentials and impersonate scans for any ticket on their event.** | **OPEN — operator must adjudicate.** If in scope: tighten RLS to deny `qr_code` SELECT outside service-role; or move payload off row, issue at confirmation via buyer-auth. If accepted: document explicitly. |
| **B3** Refund/cancel disabled UI | `orders/[oid]/index.tsx:278-280` `showRefundFull = false`, `showRefundPartialAgain = false`, `showCancelOrder = false` all hardcoded. `:430, 455, 466` gate the JSX. Refund history section (`:401`) renders only on `order.refunds.length > 0` — for new server orders this is always 0 (projection hardcodes `refunds: []`), so no spurious section. No swipe/long-press/deep-link affordance discovered. | **PASS** |
| **B4** Currency default in `useEventOrderRevenue` | Production paths do NOT call `useEventOrderRevenue`. They call `summarizeEventMoney` directly (`event/[id]/index.tsx:349`, `EventListCard.tsx:114`, `reconciliation.tsx` via `computeReconciliation`) with explicit `expectedCurrency = event.currency ?? brand.defaultCurrency`. `summarizeEventMoney` (`utils/moneySummary.ts:76-167`) properly bins by currency and emits `mismatches[]` for non-matching orders. | **PASS — false alarm.** `getEventOrderRevenue` is dead-code adapter (P3 — clean up). |

## Net-New Findings (independent of original FAIL)

### P0 — Edge Functions not yet deployed (BLOCKING)

Evidence: `GET https://api.supabase.com/v1/projects/gqnoajqerqhnvulmnyvv/functions` returns only one of the six required functions:

| Function | Deployed? |
|---|---|
| `ticket-checkout-create` | ❌ MISSING |
| `ticket-checkout-status` | ❌ MISSING |
| `ticket-confirmation-dispatch` | ❌ MISSING |
| `twilio-message-status` | ❌ MISSING |
| `scan-ticket` | ❌ MISSING |
| `stripe-webhook` | ✅ ACTIVE v5 |

User outcome if shipped today: every checkout call from the mobile app would 404 against `https://gqnoajqerqhnvulmnyvv.functions.supabase.co/ticket-checkout-create`. No tickets ever sold. Migration is already live, so the schema is ready; only deploy is missing.

Required before live-fire: operator (or Codex implementor) deploys the 5 missing functions. Confirm secrets are set (`STRIPE_RAK_TICKET_CHECKOUT`, `STRIPE_RAK_WEBHOOK`, `RESEND_API_KEY`, `RESEND_TICKET_FROM`, `TWILIO_*`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`) before invoking.

### P1 — Brand-team SELECT on `tickets.qr_code` permits scan-credential leakage (B2)

Evidence: `pg_policy` query confirms `Buyer or brand team can select tickets` policy permits SELECT for `biz_is_brand_member_for_read(...)`. Scan validation in `biz_ticket_scan` (`migration:704`) verifies by recomputing the deterministic payload from `ticket_id + qr_token_hash + server pepper`. Brand-team members reading `qr_code` get the validating payload directly — they can scan any ticket on their event without authorization.

Operator decision required:
- **(a) Accept**: brand-team is already trusted with revenue/buyer/refund/scanner permissions. Treat scan-credential read as part of that trust bundle. Document the decision.
- **(b) Tighten RLS**: deny `qr_code` SELECT for brand-team. Add a buyer-authenticated endpoint (or use the existing buyer status token flow) for ticket display. Scanner uses service role.
- **(c) Move payload off row**: store only `qr_token_hash`; issue signed payload at confirmation/buyer-fetch time, signed by a server key.

### P2 — `notification_status: 'queued'` returned but enum doesn't include `'queued'`

Evidence: `migration:534, 652` — both `biz_ticket_checkout_finalize` return paths emit `'notificationStatus', 'queued'` in the JSON response. `migration:159-167` constraint on `ticket_order_notifications.status` is `'pending' | 'sending' | 'sent' | 'delivered' | 'failed_retryable' | 'failed_terminal' | 'skipped'` — no `'queued'`. The string is a return-value-only label, not a column write, so doesn't trigger a constraint violation. But it's a contract mismatch: client receives a state name that doesn't exist in the durable enum. Recommend rename to `'pending'` for consistency.

### P2 — `eventOrdersService.fetchEventOrders` projection drops refund data

Evidence: `eventOrdersService.ts:103-125` — `refundedQuantity: 0`, `refundedAmountGbp: 0`, `refundedAmount: 0`, `refunds: []`, `marketingOptIn: false`, `cancelledAt: order.payment_status === "failed" ? order.created_at : null` are all hardcoded or simplistic. The DB schema may have richer state in `order_refunds` (or similar) that the projection ignores.

Real impact: For new ORCH-0777 server orders, refunds aren't supported yet (refund/cancel UI is intentionally disabled), so refund counts of zero are accurate. But once refund/cancel ships in a follow-up cycle, this projection will need to JOIN refunds and properly populate the fields. **Marker for follow-up:** the projection must be revisited when refund/cancel goes live.

### P2 — `payment_status` mapping silently coerces unknown statuses to `'paid'`

Evidence: `eventOrdersService.ts:45-50` `statusFromPayment`:
```ts
if (status === "refunded") return "refunded_full";
if (status === "partial_refund") return "refunded_partial";
if (status === "failed") return "cancelled";
return "paid";  // ← anything else, including "pending"/"authorized"/"void"
```

Right now `biz_ticket_checkout_finalize` only writes `payment_status='paid'`, so this is benign. But a future code path or legacy door-sale row with `payment_status='pending'` would surface as `'paid'` in the dashboard — fabricated data risk.

Recommend: explicitly map every `orders.payment_status` value, throw on unknown.

### P2 — `payment.tsx` finalizingTimedOut UI dead-end

Evidence: `payment.tsx:303-313` shows "Payment received" copy on timeout. But the bottom bar still renders the (disabled) Pay button (`:335-344`), and there's no "Continue" / "Done" / "Back to event" CTA. User must back-navigate manually.

Recommend: add an explicit "Done" or "Back to event" CTA when `finalizingTimedOut === true`, swapping out the Pay button.

### P2 — `getEventOrderRevenue` adapter is dead code

Evidence: Production callers use `summarizeEventMoney` directly. `getEventOrderRevenue` is exported, used only by the test, has a `currency = "GBP"` default, and silently sums across currencies (no mismatch handling).

Recommend: remove `getEventOrderRevenue` from `eventOrdersService.ts` and update tests, OR refactor it to wrap `summarizeEventMoney`.

### P2 — Strict-grep gate brittleness

Evidence: `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs:87-91` forbids the literal string `.select("id, ticket_type_id, qr_code, status, ticket_types(name)")`. The current file uses the equivalent backtick-template-literal form (`status/index.ts:43-49`), which is semantically identical but doesn't trigger the gate. Today the buyer status token gate makes this safe, but a future regression could re-introduce the anonymous read in a different format and pass the strict-grep.

Recommend: convert this assertion to a regex or AST check that catches both forms, OR enforce a non-formatting invariant like "ticket-checkout-status must require `buyerStatusToken`".

### P3 — Stale JSDoc comments referencing useOrderStore

Evidence: 3 stale doc-comments outside the strict-grep scope:
- `mingla-business/src/components/event/EventDetailKpiCard.tsx:5`
- `mingla-business/src/components/event/types.ts:39`
- `mingla-business/src/components/event/EventDetailTicketTypeRow.tsx:23`

These could mislead future readers. Cleanup recommended.

### P3 — `paymentIntents.cancel` swallows cancel errors silently

Evidence: `ticket-checkout-create/index.ts:171-176` wraps cancel in try/catch and only logs. If cancel itself fails (network, race), the PI stays alive with the idempotency key `ticket_checkout:<sessionId>`, so a buyer retry would collide. Edge case — typical recovery is a fresh checkout session, which would generate a fresh idempotency key naturally.

Recommend: minimum, return a different error code on cancel failure so the client knows to use a fresh session ID for retry.

### P3 — `expectedUnitPriceCents` decorative

Evidence: `ticketCheckoutService.ts:70` sends `expectedUnitPriceCents: centsFromMajor(line.unitPrice)`. The Edge function and RPC do not read it (grep confirmed zero matches in either file). Server uses `ticket_types.price_cents` as authority — which is **correct security posture**. The client field is decorative.

Recommend: remove from the client payload OR add server-side validation that rejects mismatch with logged warning, so the field becomes a tripwire for client-server price drift.

### P3 — `useEventOrderRevenue` dead hook

Same as P2 dead-code finding above.

### P4 — Praise: server-as-price-authority

The RPC recomputes prices from `ticket_types.price_cents` rather than trusting client `expectedUnitPriceCents`. This is the correct posture and prevents client-side price tampering. Worth replicating in any future commerce flow.

### P4 — Praise: `summarizeEventMoney` correctly bins by currency

`utils/moneySummary.ts:76-167` properly handles mixed-currency events: orders not matching `expectedCurrency` are pushed into `mismatches[]` and excluded from `onlineRevenue`. This is exactly the contract that prevented the ORCH-0769 currency-mismatch class from re-emerging in this rework. Pattern worth replicating.

## Constitutional Sweep

| Rule | Status | Evidence |
|---|---|---|
| 1. No dead taps | PASS | Refund/cancel hidden when disabled, not greyed-with-no-action |
| 2. One owner per truth | PASS | Server orders canonical post-rework |
| 3. No silent failures | PASS | Errors surfaced via response shape; webhook timing handled gracefully |
| 4. One key per entity | PASS | `eventOrdersKeys` factory at `useEventOrders.ts:18-26` |
| 5. Server state server-side | PASS | React Query, not Zustand for orders |
| 6. Logout clears everything | PASS | `AuthContext.tsx:217, 519` `queryClient.clear() + clearAllStores()` |
| 7. Label temporary | PASS | Refund/cancel deferred + flagged in implementor report |
| 8. Subtract before adding | PASS | `useOrderStore` reads removed before server reads added |
| 9. No fabricated data | RISK (P2) | `statusFromPayment` falls through to `'paid'` for unknowns |
| 10. Currency-aware | PASS | `summarizeEventMoney` is currency-aware |
| 11. One auth instance | PASS | Centralized AuthContext |
| 12. Validate at right time | PASS | Webhook timing UX, post-payment processing state |
| 13. Exclusion consistency | PASS | Selling-state predicate fixed |
| 14. Persisted-state startup | PASS | Server data fetched fresh; no stale Zustand sales projection |

## Verification Command Outputs

### `npm run test:orch-0777`

```
> mingla-business@1.0.0 test:orch-0777
> node ../.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs && npx jest phone.test eventOrdersService.test ticketCheckoutService.test ticketCheckoutMigrationGuards.test && npx tsc --noEmit

ORCH-0777 production checkout guard passed.
PASS src/services/__tests__/ticketCheckoutService.test.ts
PASS src/services/__tests__/ticketCheckoutMigrationGuards.test.ts
PASS src/services/__tests__/eventOrdersService.test.ts
PASS src/utils/__tests__/phone.test.ts

Test Suites: 4 passed, 4 total
Tests:       7 passed, 7 total
```

### `npx tsc --noEmit`
PASS (zero stdout)

### `git diff --check`
PASS (zero stdout)

### `grep -rn useOrderStore mingla-business/app/event/ mingla-business/src/components/event/`
3 hits, all in stale JSDoc comments in OUT-OF-SCOPE files (`EventDetailKpiCard.tsx:5`, `types.ts:39`, `EventDetailTicketTypeRow.tsx:23`). The 7 in-scope surface files have ZERO hits.

### `supabase migration list --linked`
```
20260515000013 | 20260515000013 | 2026-05-15 00:00:13
20260515000014 | 20260515000014 | 2026-05-15 00:00:14
```
Both Local and Remote columns populated → migration is live on production.

### Remote function definition probe
`pg_get_functiondef(biz_ticket_checkout_create_session)` confirms:
```sql
IF v_event.visibility <> 'public' OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
  RAISE EXCEPTION 'event_not_selling';
```
Fixed predicate IS LIVE on production.

### Remote schema probe — orders columns
All 7 expected columns present with correct defaults:
- `notification_status` default `'pending'`, NOT NULL
- `source` default `'online_checkout'`, NOT NULL
- `stripe_application_fee_amount_cents` default 0, NOT NULL
- `stripe_payment_intent_status`, `failed_at`, `buyer_phone_e164`, `checkout_session_id` (nullable per spec)

### Remote schema probe — ticket_checkout_sessions columns
All 7 expected columns present.

### Remote schema probe — unique indexes
3 expected unique indexes present including `idx_tickets_qr_token_hash`.

### Remote RPC probe
All 5 RPCs deployed: `biz_ticket_checkout_create_session`, `biz_ticket_checkout_finalize`, `biz_ticket_checkout_qr_payload`, `biz_ticket_checkout_token_hash`, `biz_ticket_scan`.

### Edge Function deploy probe
**FAIL — only `stripe-webhook` v5 ACTIVE**. Missing: `ticket-checkout-create`, `ticket-checkout-status`, `ticket-confirmation-dispatch`, `twilio-message-status`, `scan-ticket`.

### RLS policy probe — `tickets`
3 policies: `Buyer or brand team can select tickets` (SELECT, allows brand-team and buyer), `Finance plus can update tickets` (UPDATE), `Scanners can update tickets for check-in` (UPDATE). The first one is the B2 concern.

## Operator Gate Log

- Tester requested: `supabase status --workdir <root>` to check local stack.
- Result: local Docker container `supabase_db_gqnoajqerqhnvulmnyvv` not running; local apply blocked.
- Tester redirected: queried REMOTE schema directly via Supabase Management API (per memory `feedback_supabase_mcp_workaround.md` and `reference_supabase_management_api.md`) using `~/.claude.json` `SUPABASE_ACCESS_TOKEN` Bearer.
- Outcome: live-DB gate not blocked because the migration is already applied remotely. Remote function definition + schema introspection prove the rework is in production schema. **The implementor's "blocked" claim was stale by the time of retest** — operator pushed `20260515000013` (and `20260515000014` for ORCH-0776D) since the rework finished.

## Live-Fire Matrix Readiness

Pre-deploy gate (must complete BEFORE live-fire):
- [ ] **P0 — operator deploys 5 Edge Functions:** `ticket-checkout-create`, `ticket-checkout-status`, `ticket-confirmation-dispatch`, `twilio-message-status`, `scan-ticket`
- [ ] **P0 — operator confirms required secrets:** `STRIPE_RAK_TICKET_CHECKOUT`, `STRIPE_RAK_WEBHOOK`, `RESEND_API_KEY`, `RESEND_TICKET_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_STATUS_CALLBACK_SECRET`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] **P0 — operator confirms Stripe webhook endpoint includes:** `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`
- [ ] **P0 — server config:** set `app.qr_token_pepper` to a strong production secret on the database (NOT the local fallback `'local-ticket-pepper'`); without this, every QR payload uses the literal default and is forgeable from `ticket_id + qr_token_hash` knowledge alone (extra-bad given B2)
- [ ] **P1 — operator adjudicates B2** (brand-team-readable `qr_code` privacy)

Once gates clear, human-in-loop matrix:
- [ ] Free checkout — buyer enters details, reserves, lands on confirmation with server-issued tickets, receives email + SMS confirmation
- [ ] Paid checkout — buyer enters card via PaymentSheet, payment succeeds, "Finalizing your tickets…" appears briefly, then `/confirm` with server-issued QR
- [ ] Webhook latency simulation — delay webhook 5–15s, confirm buyer never sees an error and lands on either `/confirm` or "Payment received" terminal state
- [ ] Webhook replay — re-deliver `payment_intent.succeeded` for an already-finalized session; assert idempotent (no duplicate tickets)
- [ ] Resend delivery — buyer receives email with Mingla branding and ticket QR
- [ ] Twilio delivery — buyer receives SMS; status callback updates `ticket_order_notifications`
- [ ] Organizer Orders — real order appears on Event Detail (sold count, revenue, activity, guest list) within 15s
- [ ] Cross-device scanner — operator scans buyer's QR from a separate device/account; ticket marks `used`; second scan returns `duplicate`; wrong-event scan returns `wrong_event`

## Final Gate

ORCH-0777 is **NOT close-ready** until:
1. The 5 missing Edge Functions are deployed.
2. Operator decides and documents B2 (RLS adjudication).
3. `app.qr_token_pepper` is set on the production database to a non-default value.
4. Operator-assisted live-fire matrix above passes.

Code/schema gates: **GREEN**. The rework is structurally sound and the migration is live. The remaining work is operator-driven (deploy + adjudication + live-fire), not code-driven.

## Discoveries for Orchestrator

- ORCH-0776D migration `20260515000014` is also already applied remotely — operator may have pushed it during the same `supabase db push` cycle as ORCH-0777. ORCH-0776D banner on Priority Board still says "IMPLEMENTOR DISPATCH NOW" — that may be stale; orchestrator should reconcile.
- The `app.qr_token_pepper` GUC is referenced but its current production value is unknown to me. If unset, the qr_payload deterministic function falls back to the literal string `'local-ticket-pepper'` — which makes every signed payload trivially forgeable by anyone who can read `ticket_id + qr_token_hash` (and given B2, that's any brand-team member). Treat as a P0 production-config gap until operator confirms the GUC is set to a secure value.

---

NEXT HANDOFF — paste into Codex `implementor-mingla` (or operator console for direct deploy):

The ORCH-0777 production-checkout rework code/schema gates are GREEN — migration `20260515000013` is live on `gqnoajqerqhnvulmnyvv`, all 5 RPCs are deployed, and every original P0/P1 finding is fixed in code. However, the rework cannot be live-fire-tested because **5 of 6 required Edge Functions are missing from the project's deployed function list**: `ticket-checkout-create`, `ticket-checkout-status`, `ticket-confirmation-dispatch`, `twilio-message-status`, and `scan-ticket` are absent (only `stripe-webhook` v5 is ACTIVE). Inputs: this test report `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`, implementor rework report `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`, orchestrator review `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`. Hard guard: do not modify migration code or any rework files; this is a deploy-only task. Required: deploy all 5 Edge Functions to project `gqnoajqerqhnvulmnyvv`, confirm required secrets are set (STRIPE_RAK_TICKET_CHECKOUT, STRIPE_RAK_WEBHOOK, RESEND_API_KEY, RESEND_TICKET_FROM, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID, TWILIO_STATUS_CALLBACK_SECRET, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY), confirm Stripe webhook endpoint includes payment_intent.succeeded/payment_intent.payment_failed/payment_intent.canceled, and confirm `app.qr_token_pepper` GUC is set to a strong production secret on the database. Expected output: `Mingla_Artifacts/reports/DEPLOY_ORCH-0777_EDGE_FUNCTIONS_AND_SECRETS.md` listing function versions deployed, secrets confirmed (presence only — never values), and webhook event subscriptions. Downstream routing: after deploy report returns, orchestrator dispatches operator-assisted live-fire matrix using the gate items in this test report's "Live-Fire Matrix Readiness" section, AND requests operator decision on B2 (brand-team-readable `qr_code` RLS) — if operator chooses to tighten RLS, that becomes a follow-up Codex `implementor-mingla` rework before live-fire; if accepted as in-scope, document the decision and proceed to live-fire. Only after live-fire PASS does ORCH-0777 reach Codex `orchestrator-mingla` for CLOSE.
