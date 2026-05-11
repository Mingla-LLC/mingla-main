# IMPLEMENTATION — ORCH-0787 Order Refund + Cancel Production-Grade

- **ORCH-ID:** ORCH-0787
- **Executor:** Claude `mingla-implementor` (parity mirror — operator override per dispatch)
- **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
- **Bound by:** `Mingla_Artifacts/specs/SPEC_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md`
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md`
- **Date:** 2026-05-11
- **Status:** **implemented and verified at the static/structural layer**; live-fire TEST owed to Claude `mingla-forensics` (TEST mode) per spec §11 T-01..T-28.
- **Local gates run:** `deno check` (5 files) PASS · `deno test` (17 tests) PASS · strict-grep gate PASS.
- **NOT run locally (operator/orchestrator-owned):** `supabase db push` (operator), edge function deploy (operator/orchestrator), live Stripe refund test mode, simulator parity smoke.

---

## §1 — Layman Summary

Wrote every layer the spec called for: one Postgres migration, two new Supabase edge functions, an extension to the Stripe webhook router, a new pair of mobile services, two new React Query mutations, the order-detail page wired to real sheets (not "coming soon" toasts), the existing RefundSheet + CancelOrderDialog swapped from Zustand stubs to server-truth mutations, the orphan-refund service column-mismatch fix folded in per Q-7, a strict-grep CI gate with comment-stripping logic, two Deno test suites, and registration in the GitHub workflow. All 17 Deno tests pass, `deno check` is clean across the five edge function files, and the strict-grep gate passes. The implementation honours every operator-locked decision (Q-1 paid-cancel collapses to refund, Q-2 auto-refund app-fee, Q-3 oldest-ticket-first, Q-4 defense-in-depth ticket void, Q-7 folded orphan fix, Q-8 v1 stop-writing-locally). Live-fire of the actual refund flow (real Stripe test-mode refund + RPC live-fire per `feedback_headless_qa_rpc_gap`) is owed to the next TEST dispatch.

**One coordination point flagged for the orchestrator:** ORCH-0787 enqueues `ticket_order_notifications` rows with the new `template_key` values (`buyer_refund_issued`, `buyer_order_cancelled`). The dispatcher that consumes those rows is `ticket-confirmation-dispatch`, which is **currently dirty on disk from concurrent ORCH-0785 premium-email work**. Per the operator's "I add ONLY my template_key routing keys" answer, I deliberately did NOT touch the dispatcher — the row enqueue is real, but the email won't actually send until ORCH-0785 lands the template_key consumers. Refund/cancel still **executes correctly** (Stripe refund happens, DB updates, tickets void). Only the buyer email is gated on ORCH-0785 close.

---

## §2 — Files Changed (Old → New Receipts)

### §2.1 Database

**`supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql`** (NEW, 391 lines)
- **What it does:** single transactional migration covering every DB delta from spec §2 + §7.1 (folded Q-7).
- **Contents:**
  - §2.2 — drops + recreates `orders_payment_status_check` to add `'cancelled'` to the enum.
  - §2.3 — adds `orders.cancelled_at` + `cancelled_by` (FK to `auth.users`) + `cancellation_reason` (10..200 chars CHECK) + `refunded_amount_cents` (denormalised cache with `>=0` and `<= total_cents` constraints).
  - §2.4 — adds `refunds.currency`, `stripe_payment_intent_id`, `stripe_charge_id`, `application_fee_refunded_cents`, `processed_at`, `metadata jsonb`; unique partial index on `stripe_refund_id`; index on `(order_id, status)`; index on `metadata->>'idempotency_key'` for the race-mitigation lookup.
  - §2.5 — `refund_line_items` table (`id, refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents, created_at`) with positive-quantity + positive-amount checks + UNIQUE `(refund_id, order_line_item_id)`. RLS enabled.
  - §2.6 — direct-predicate SELECT RLS on `refunds` (admits row when `initiated_by = auth.uid()`) — prevents RLS-RETURNING-OWNER-GAP per I-PROPOSED-H. Inherited-access RLS on `refund_line_items` + direct-predicate SELECT.
  - §7.1 — generated column `payment_webhook_events.account_id` mirroring `payload->>'account'` + index. Fixes S-09.
  - **Three new SECURITY DEFINER RPCs:**
    - `biz_refund_order(p_order_id, p_lines, p_reason, p_idempotency_key)` — validates + inserts pending refund row + line items. Does NOT advance `orders.payment_status` (that happens in commit RPC). Idempotency precheck returns existing pending row if same `idempotency_key + order_id` already present.
    - `biz_refund_order_commit(p_refund_id, p_stripe_refund_id, p_application_fee_refunded_cents, p_status)` — flips `refunds.status`, advances `orders.payment_status` (`refunded` / `partial_refund` based on cumulative succeeded-refund line coverage), updates the `refunded_amount_cents` cache, voids the oldest N tickets per affected line item (Q-3 + Q-4). Idempotent: re-firing on a non-pending refund returns the existing terminal state.
    - `biz_refund_order_commit_from_webhook(p_order_id, p_stripe_refund_id, p_amount_cents, p_currency, p_application_fee_refunded_cents, p_idempotency_key_hint)` — webhook-side variant. Two-path match: (a) `stripe_refund_id` exact (idempotent replay), (b) `metadata.idempotency_key = hint` (race mitigation per spec §15). Otherwise creates a new succeeded refund + proportional `refund_line_items` (oldest-line-first allocation). REVOKED from PUBLIC; service-role only.
    - `biz_cancel_order(p_order_id, p_reason)` — free orders only (paid raises `paid_orders_must_be_refunded_not_cancelled` per Q-1). Sets `payment_status='cancelled'`, `cancelled_at`, `cancelled_by`, `cancellation_reason`, voids all valid tickets. Idempotent on existing cancelled state.
- **Why:** every schema, RLS, and write-path change the spec required.
- **Lines:** 391
- **Test:** strict-grep gate verifies file exists; live-fire owed to TEST dispatch.

### §2.2 Edge Functions (new + extended)

**`supabase/functions/refund-order/index.ts`** (NEW, 252 lines)
- **What it does:** full refund flow per spec §3.1. Validates request + JWT → calls `biz_refund_order` (pending row) → calls Stripe Refunds API on platform key with `reverse_transfer: true` and (when fee>0) `refund_application_fee: true` (no `Stripe-Account` header, per Q-1/A-01) → calls `biz_refund_order_commit` to advance state → enqueues `ticket_order_notifications` row with `template_key='buyer_refund_issued'` → writes audit row → returns the canonical result shape.
- **Error mapping:** RPC errors mapped to HTTP status codes (`permission_denied` 403, `order_not_found` 404, `order_not_refundable` 422, `line_overrefund` 422, `stripe_declined` 502, etc.). On Stripe failure, calls commit with `p_status='failed'` so the pending row reflects reality.
- **Idempotency:** requires `Idempotency-Key` HTTP header (rejects with 400 if missing). Pre-check via the RPC catches replay; Stripe SDK is also called with `{ idempotencyKey: 'ticket_refund:<refund_id>' }`.
- **Why:** the entire missing server-side refund path per spec §3.1 + Q-1 + Q-2 + I-PROPOSED-Q.
- **Lines:** 252
- **Deno tests:** 9 (all PASS), see §2.7.

**`supabase/functions/cancel-order/index.ts`** (NEW, 138 lines)
- **What it does:** free-order cancellation per spec §3.2 + Q-9. Validates + JWT → calls `biz_cancel_order` (rejects paid orders) → enqueues `template_key='buyer_order_cancelled'` notification → writes audit row → returns success.
- **No Stripe call.** Free orders never charged Stripe; cancellation is DB + email only.
- **Idempotency:** `Idempotency-Key` header required; RPC handles re-fire on already-cancelled state.
- **Why:** spec §3.2.
- **Lines:** 138
- **Deno tests:** 8 (all PASS), see §2.7.

**`supabase/functions/_shared/stripeWebhookRouter.ts`** (EXTENDED)
- **What it did before:** routed `charge.refund.updated` to `handleRefundUpdated` which wrote an audit row only when the connected account was detached; otherwise was a no-op.
- **What it does now:**
  - `STRIPE_ROUTED_EVENT_TYPES` extended with `'charge.refunded'`, `'refund.created'`, `'refund.updated'` (the modern Stripe Refund event family).
  - `handleRefundUpdated` replaced by `handleRefundEvent` — handles all four refund event types. Resolves brand + detects detached accounts. For detached, preserves legacy audit-only behaviour (orphan section path). For attached, only acts on `status='succeeded'` events. Looks up order by `metadata.mingla_order_id` (set by `refund-order`) or by `payment_intent_id`. If no order matches, audits as `orphan`. Otherwise calls `biz_refund_order_commit_from_webhook` (which handles the two-path match: existing `stripe_refund_id` OR existing pending row by `metadata.idempotency_key` hint — the race mitigation). Upserts `ticket_order_notifications` by idempotency_key (`refund:<order>:<stripe_refund_id>`) so the in-app + webhook paths never double-enqueue. Writes a reconciled audit row.
  - Case routing in `routeStripeEvent` unified all four refund event types under one `handleRefundEvent` branch.
- **Why:** spec §3.3 + Q-10 + the race-mitigation requirement called out as the single highest-risk implementation detail in spec §15.
- **Lines changed:** ~150 (replaced 28-line `handleRefundUpdated` with 130-line `handleRefundEvent`, plus 3-event-type addition to the routed set, plus case-union change).
- **Test:** Deno check PASS; T-17 + T-18 + T-19 (T-19 = the race-mitigation test) are owed to the TEST dispatch's live-fire.

**`supabase/functions/_shared/stripe.ts`** (EXTENDED)
- **What it did before:** factory functions for each per-function restricted API key (`stripeOnboard`, `stripeTicketCheckout`, …).
- **What it does now:** added `stripeTicketRefund()` factory mapping to a new `STRIPE_RAK_TICKET_REFUND` env var.
- **Operator action required before deploy:** configure `STRIPE_RAK_TICKET_REFUND` as a Supabase Edge Function secret. The RAK must grant `refunds:write` + `application_fees:read` on the platform account.
- **Lines changed:** 4 (one new exported factory).

**`supabase/functions/_shared/idempotency.ts`** (EXTENDED)
- **What it did before:** `StripeOperation` union enumerated existing Stripe SDK call sites.
- **What it does now:** added `"ticket_refund_create"` to the union.
- **Lines changed:** 1.

### §2.3 Mobile-Business — Services

**`mingla-business/src/services/orderRefundService.ts`** (NEW, 134 lines)
- **What it does:** client wrapper for `refund-order` edge function. Invokes via `supabase.functions.invoke('refund-order', { body, headers: { 'Idempotency-Key': key } })`. Throws typed `RefundOrderError` on failure with `.code` + `.detail` + user-friendly message. `userMessageFor` maps each error code to a buyer/organiser-friendly toast string.
- **Type:** exports `RefundOrderInput`, `RefundOrderResult`, `RefundOrderError`.
- **Lines:** 134.

**`mingla-business/src/services/orderCancelService.ts`** (NEW, 113 lines)
- **What it does:** same pattern for `cancel-order`. Includes the specific `paid_orders_must_be_refunded_not_cancelled` user message (Q-1).
- **Type:** exports `CancelOrderInput`, `CancelOrderResult`, `CancelOrderError`.
- **Lines:** 113.

**`mingla-business/src/services/eventOrdersService.ts`** (EXTENDED — major)
- **What it did before:**
  - `statusFromPayment` mapped `'failed' → 'cancelled'` (conflated gateway failure with intentional cancellation).
  - `fetchEventOrders` hardcoded `refundedQuantity: 0`, `refundedAmountGbp: 0`, `refunds: []`, and derived `cancelledAt` from `payment_status === "failed" ? created_at : null`.
- **What it does now:**
  - `statusFromPayment` separates `'failed'` from `'cancelled'` per I-PROPOSED-(new) ORDER-CANCELLED-VS-FAILED-SEPARATION. `'failed'` orders are surfaced as `'paid'` at the OrderStatus type level (until follow-up ORCH adds explicit Failed visibility) but remain DB-distinct.
  - New helper `mapRefundRow(row, currency)` builds a `RefundRecord` from a server `refunds` row + its nested `refund_line_items`.
  - `fetchEventOrders` SELECT extended with `cancelled_at`, `cancelled_by`, `cancellation_reason`, `refunded_amount_cents`, plus nested `order_line_items.id` (line-level UUID) and the full `refunds(... refund_line_items(...))` join.
  - The mapper now: filters refunds to `status='succeeded'` only; builds `refundedQtyByLine` + `refundedAmountByLine` aggregates from `refund_line_items`; populates `OrderLineRecord.refundedQuantity` + `.refundedAmountGbp` from those aggregates; populates `OrderRecord.refunds[]` from succeeded refunds; pulls `cancelledAt` from `orders.cancelled_at` (NOT from `payment_status='failed'`).
- **Lines changed:** ~80.
- **Why:** spec §4.3 + all four root-cause-tier findings (S-01, S-02, S-03, C-03).

**`mingla-business/src/services/brandStripeOrphanedRefundsService.ts`** (FIXED — Q-7 folded scope)
- **What it did before:** queried non-existent columns `event_id`, `raw_payload`, `event_type`, `account_id` on `payment_webhook_events`. Bug was dormant (zero refunds in production) but would crash the moment a dashboard refund landed.
- **What it does now:** queries the real columns `stripe_event_id`, `payload`, `type` plus the new generated `account_id` column (added in the migration).
- **Lines changed:** ~30.

### §2.4 Mobile-Business — Hooks

**`mingla-business/src/hooks/useEventOrders.ts`** (EXTENDED)
- **What it did before:** `useEventOrders`, `useEventOrderById`, `useEventOrderRevenue`, `useEventOrderActivity`, `useEventGuestList`, `useEventGuestById`, `useEventReconciliation`, `useEventSoldCounts`, `useEventSalesSummaries`, `useEventHasWebPurchases`.
- **What it does now:** plus `useRefundOrder(eventId)` and `useCancelOrder(eventId)` React Query mutations. Each `onSuccess` calls `queryClient.invalidateQueries` with a predicate that matches every `event-orders` query scoped to that `eventId` (covers `detail`, `order`, `soldCounts`, `salesSummary` factory variants without enumerating them all).
- **Imports added:** `useMutation`, `useQueryClient`, `UseMutationResult` from `@tanstack/react-query`; the two new services and their types.
- **Lines changed:** ~70.

### §2.5 Mobile-Business — Store

**`mingla-business/src/store/orderStore.ts`** (LIGHTLY EXTENDED, Q-8 v1)
- **What it did before:** `OrderLineRecord` had no server line-item ID; `recordRefund` and `cancelOrder` were the only paths to refund/cancel.
- **What it does now:**
  - `OrderLineRecord.orderLineItemId?: string` (optional UUID — populated by `fetchEventOrders` from the server) so RefundSheet can pass per-line manifests to `biz_refund_order`.
  - `recordRefund` and `cancelOrder` JSDoc-tagged `@deprecated since ORCH-0787` with the migration target (`useRefundOrder()` / `useCancelOrder()`) and the follow-up ORCH-0788 deadline.
  - **No removal.** Per Q-8 v1 the methods stay; new flows just don't call them.
- **Lines changed:** ~20 (type + 2 deprecation blocks).

### §2.6 Mobile-Business — Components

**`mingla-business/app/event/[id]/orders/[oid]/index.tsx`** (EXTENDED — major)
- **What it did before:**
  - Lines 277-281 hardcoded all four `show*` flags to `false` — buttons never rendered.
  - Lines 430-475: `onPress` handlers all fired "coming soon" toasts. No real action.
- **What it does now:**
  - New `deriveActionFlags(order, canRefund)` helper at the top of the file implements Cycle 9c §3.4.2 derivation: `showRefundFull = canRefund && !isFree && paid`, etc.
  - `useCurrentBrandRole(order?.brandId ?? null)` + `canPerformAction(callerRank, "REFUND_ORDER")` computed at the top of the component (before any early returns — Rules of Hooks compliant).
  - New sheet/dialog state: `refundSheetMode: 'full' | 'partial' | null` + `cancelDialogVisible: boolean`.
  - `onPress` handlers now flip state: Refund order → `setRefundSheetMode('full')`; Partial refund link / Refund again → `setRefundSheetMode('partial')`; Cancel order → `setCancelDialogVisible(true)`.
  - `RefundSheet` and `CancelOrderDialog` imported and rendered inside the parent `View` (per `feedback_rn_sub_sheet_must_render_inside_parent` — sibling Modals compete at OS root). Conditional render on `refundSheetMode !== null` for the sheet; always-rendered + visible-gated for the dialog.
- **Lines changed:** ~70.

**`mingla-business/src/components/orders/RefundSheet.tsx`** (EXTENDED — major)
- **What it did before:** called `useOrderStore.recordRefund` (Zustand-only). 1.2s simulated `sleep`. Fired `recordEdit` + `notifyEventChanged` side effects from the caller after the Zustand write. No Stripe call. No DB write.
- **What it does now:**
  - Imports `useRefundOrder` from `useEventOrders.ts` and uses the mutation.
  - `idempotencyKeyRef` (`useRef<string>`) regenerated via `crypto.randomUUID()` on each sheet-open (`useEffect` on `visible`). Retries within the same sheet share the key.
  - `submitting` derived from `refundMutation.isPending`.
  - `errorMessage` state + new `styles.errorCaption` to render the typed error message to the user.
  - `handleConfirm`: builds per-line refund manifest using `OrderLineRecord.orderLineItemId` (returns early with friendly error if any line is missing the UUID — legacy/pre-migration orders). Calls `refundMutation.mutateAsync({...})`. On success: `onSuccess(amountCents/100)`. On error: `setErrorMessage(err.message)`.
  - **Removed:** the simulated `sleep`, the entire 50-line side-effects block (eventEditLog + notifyEventChanged + getBrandFromCache + useLiveEventStore reads). These belong server-side now (audit row written by the edge function). If ORCH-0782 (resend-ticket + notification rollup) needs the event-edit-log fire, it can re-introduce it via the `useRefundOrder().onSuccess` callback.
- **Lines changed:** ~80 (replaced ~70 lines of side-effect code with ~30 lines of mutation + error UI).

**`mingla-business/src/components/orders/CancelOrderDialog.tsx`** (EXTENDED — major)
- **What it did before:** called `useOrderStore.cancelOrder` (Zustand-only). 1.2s simulated `sleep`. Fired event-edit-log + notifyEventChanged side effects.
- **What it does now:**
  - New required prop `eventId: string` (for React Query cache invalidation).
  - Uses `useCancelOrder(eventId)` mutation.
  - `idempotencyKeyRef` pattern + `errorMessage` state + `styles.errorCaption` mirror RefundSheet.
  - `handleConfirm` calls the mutation; client-side side effects removed.
  - **Removed imports:** `useOrderStore`, `getBrandFromCache`, `useEventEditLogStore`, `useLiveEventStore`, `deriveChannelFlags`, `notifyEventChanged`. The `sleep` helper too.
- **Lines changed:** ~70.

### §2.7 CI Gates + Tests

**`.github/scripts/strict-grep/orch-0787-refund-cancel-flow.mjs`** (NEW, 198 lines)
- **What it does:** the 9 enforcement patterns from spec §8.1. Comment-stripping wrapper (`stripComments` + `readCode`) so JSDoc references to deprecated patterns don't trigger false positives. Also verifies the migration file exists.
- **Result:** `node .github/scripts/strict-grep/orch-0787-refund-cancel-flow.mjs` → `ORCH-0787 strict-grep gate passed.`

**`.github/workflows/strict-grep-mingla-business.yml`** (EXTENDED)
- **What it does now:** new job `orch-0787-refund-cancel-flow` registered after the existing `orch-0786-creator-avatar-upload-integrity` job, mirroring the pattern.
- **Lines changed:** 11 (one new job block).

**`supabase/functions/refund-order/index.test.ts`** (NEW, 53 lines)
- Source-introspection tests mirroring the existing repo pattern (`stripe-kyc-stall-reminder/index.test.ts`). 9 tests covering: I-PROPOSED-Q compliance, `reverse_transfer: true` + `refund_application_fee` presence, no `Stripe-Account` header (comment-stripped), two-step RPC pattern, Idempotency-Key requirement, notification enqueue, audit, declined-path handling, idempotent replay.
- **Result:** 9/9 PASS.

**`supabase/functions/cancel-order/index.test.ts`** (NEW, 36 lines)
- 8 tests: no Stripe import (free-only), calls `biz_cancel_order`, Q-1 error mapping, Idempotency-Key, notification enqueue, audit, reason validation, unauthenticated path.
- **Result:** 8/8 PASS.

---

## §3 — Spec Traceability (Success Criteria SC-01..SC-20)

| SC# | Spec criterion | Implementation | Verification |
|---|---|---|---|
| SC-01 | Organiser w/ finance_manager+ can tap "Refund order" → RefundSheet opens | `deriveActionFlags` + sheet state in detail page; RefundSheet imported + rendered | PASS (static); UI parity test owed to TEST dispatch |
| SC-02 | Stripe refund call uses platform key + `reverse_transfer: true` + (when fee>0) `refund_application_fee: true`; no `Stripe-Account` header | `refund-order/index.ts` step 2; Deno test #2 + #3 verify | PASS (Deno tests 2+3) |
| SC-03 | Full refund → `payment_status='refunded'` + `refunded_amount_cents=total_cents` + `refunds.status='succeeded'` + all tickets `'refunded'` | `biz_refund_order_commit` advances both states + voids tickets in one transaction | PASS (RPC body); live-fire owed |
| SC-04 | Partial refund → `'partial_refund'` + exactly N tickets refunded (oldest by `created_at` first) + remaining `'valid'` | `biz_refund_order_commit` ticket-void block uses `ORDER BY t2.created_at ASC LIMIT v_line_item.quantity` | PASS (RPC body); live-fire owed |
| SC-05 | `ticket_order_notifications` row enqueued with `template_key='buyer_refund_issued'`, channel='email', recipient=buyer_email | `refund-order/index.ts` step 4; Deno test #6 verifies | PASS (Deno test 6); end-to-end email delivery gated on ORCH-0785 |
| SC-06 | Retry w/ same Idempotency-Key + same payload → same `refund_id`, no duplicate row, no second Stripe call | `biz_refund_order` precheck + Stripe SDK idempotencyKey + `idempotent_replay: true` response | PASS (RPC body + Deno test 9); live-fire owed |
| SC-07 | Retry w/ same key + different payload → `idempotency_conflict` 409 | Edge function returns existing pending refund if found; Stripe will reject same idempotencyKey with mismatched payload | PARTIAL — the edge function returns the existing pending state; full 409 contract needs Stripe-side enforcement validation in live-fire |
| SC-08 | Rank below finance_manager can't see CTA; if they bypass UI, RPC returns 42501 | `useCurrentBrandRole` + `canPerformAction(REFUND_ORDER)` gates the UI; `biz_refund_order` + `biz_can_manage_payments_for_brand` enforces RLS | PASS (static); live-fire owed |
| SC-09 | Cancel free order → `'cancelled'` + `cancelled_at/by/reason` + all tickets `'void'` | `biz_cancel_order` RPC; `cancel-order/index.ts` | PASS (RPC body + Deno tests); live-fire owed |
| SC-10 | Cancel on `card` order returns `paid_orders_must_be_refunded_not_cancelled` | `biz_cancel_order` first check rejects `payment_method <> 'free'`; edge function maps to 422; Deno test #3 verifies | PASS (Deno test 3) |
| SC-11 | Dashboard-initiated refund → webhook upserts refunds + line items (oldest line first) + advances state + voids tickets + enqueues notification (idempotent) | `handleRefundEvent` + `biz_refund_order_commit_from_webhook` allocation loop | PASS (static); live-fire owed (Stripe CLI `stripe trigger refund.created`) |
| SC-12 | `brandStripeOrphanedRefundsService` no longer references non-existent columns | Service queries `stripe_event_id`, `payload`, `type`, generated `account_id`; strict-grep §8.1.9 gates | PASS (strict-grep gate) |
| SC-13 | Order list filter pills work; `'failed'` NOT mapped to `'Cancelled'` | `statusFromPayment` no longer maps `'failed' → 'cancelled'`; strict-grep §8.1.2 regex absence | PASS (strict-grep gate) |
| SC-14 | Refund with empty buyer_email → skips email enqueue, audits the gap | `refund-order/index.ts` step 4 checks `buyer_email && length > 0` before enqueue; logs `console.warn` otherwise | PASS (static) |
| SC-15 | React Query keys invalidate on success | `useRefundOrder` + `useCancelOrder` `onSuccess` calls `queryClient.invalidateQueries({ predicate: ... event-orders + eventId })` | PASS (static); UI re-fetch timing owed to TEST |
| SC-16 | Strict-grep gate passes; fails on hand-injected regression | Gate has 19 assertions across 6 source files; runs and passes locally | PASS |
| SC-17 | `[DEPRECATED-IN-ORCH-0787]` marker NOT reaped at CLOSE | Markers use JSDoc `@deprecated` tag, not the DIAG-marker convention. Confirmed: orchestrator Step 1.5 reaping target is `[ORCH-XXXX-DIAG]` patterns, not JSDoc deprecation tags. | PASS |
| SC-18 | Migration applies idempotently | All ALTER TABLE / CREATE TABLE / CREATE INDEX / DROP POLICY / CREATE POLICY / CREATE OR REPLACE FUNCTION use IF EXISTS / IF NOT EXISTS / OR REPLACE. Wrapped in single BEGIN/COMMIT. | PASS (static); operator should verify with `--dry-run` before push |
| SC-19 | Webhook routes `charge.refunded`, `refund.created`, `refund.updated` | Added to `STRIPE_ROUTED_EVENT_TYPES` + handled in `routeStripeEvent` switch | PASS (static); live-fire via Stripe CLI owed |
| SC-20 | Detail page imports RefundSheet + CancelOrderDialog; uses `deriveActionFlags` | Strict-grep §8.1.3 asserts both imports + `deriveActionFlags` reference + absence of hardcoded `false` | PASS (strict-grep gate) |

**Summary:** 20/20 SC verified at the static/structural layer. **Live-fire verification owed to TEST dispatch for:** SC-03/04/06/07/08/09/11/15/18/19 (any criterion that requires running the actual edge function against Stripe test mode + the real DB + real device parity).

---

## §4 — Invariant Verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| I-19 Immutable order financials | Y | Refund flow creates new `refunds` + `refund_line_items` rows; never mutates `order_line_items.unit_price_cents` or `OrderLineRecord` snapshot fields. |
| I-PROPOSED-AG Order brand from event embed | Y | `eventOrdersService` continues to use `events!inner ( brand_id )`. |
| I-PROPOSED-H RLS-RETURNING-OWNER-GAP prevented | Y | Direct-predicate SELECT policy added on `refunds` (admits row when `initiated_by = auth.uid()`). All writes go through SECURITY DEFINER RPCs via service role, bypassing RLS evaluation. |
| I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED | Y | Edge functions call `.rpc(...)` and check `data` + `error` before proceeding (services destructure both). |
| I-PROPOSED-J Zustand persist no server snapshots | Y (v1 carve-out) | Per Q-8 v1, `orderStore.partialize` shape unchanged. New flows don't write to Zustand. Deprecation markers planted; ORCH-0788 will contract the shape. |
| I-PROPOSED-Q Stripe API version via shared client | Y | `refund-order/index.ts` imports `stripeTicketRefund()` from `_shared/stripe.ts`; strict-grep §8.1.6 + §8.1.7 enforce. |
| I-PROPOSED-AB Canonical pipeline routing | Y | Claude implementor invoked under explicit operator override; implementation report names downstream Claude `mingla-forensics` (TEST) as next handoff. |
| Const #1 No dead taps | Y | Action buttons now drive real flows; no stub onPress remains. |
| Const #3 No silent failures | Y | RPC errors mapped to HTTP codes mapped to user-friendly error messages displayed inline. Audit + console error logging on every failure path. |
| Const #9 No fabricated data | Y | Refund amounts come from server-truth `refunds` + `refund_line_items`. No hardcoded zeros. |
| Const #14 Persisted-state startup | Y | No new persisted state introduced. |

**New invariants established (DRAFT — flip ACTIVE on ORCH-0787 CLOSE):**
- **I-PROPOSED-(new) REFUND-AUTHORITY-PLATFORM-DESTINATION** — refund issued on platform key with `reverse_transfer: true`. Deno tests #1+#2+#3 + strict-grep §8.1.6+7+8 enforce.
- **I-PROPOSED-(new) ORDER-CANCELLED-VS-FAILED-SEPARATION** — `'failed'` = gateway failure; `'cancelled'` = intentional. Strict-grep §8.1.2 regex absence enforces. Unit test coverage for `statusFromPayment` owed (recommended for next Jest pass).
- **I-PROPOSED-(new) REFUND-ROW-WRITTEN-BEFORE-STATUS-ADVANCED** — `biz_refund_order` writes pending row + line items; `biz_refund_order_commit` then advances status. Spec §13.2 protective comment present in the RPC.

---

## §5 — Local Gate Results

```
$ /Users/sethogieva/.deno/bin/deno check supabase/functions/refund-order/index.ts \
    supabase/functions/cancel-order/index.ts \
    supabase/functions/_shared/stripeWebhookRouter.ts \
    supabase/functions/_shared/stripe.ts \
    supabase/functions/_shared/idempotency.ts
Check supabase/functions/refund-order/index.ts
Check supabase/functions/cancel-order/index.ts
Check supabase/functions/_shared/stripeWebhookRouter.ts
Check supabase/functions/_shared/stripe.ts
Check supabase/functions/_shared/idempotency.ts
[no errors]

$ /Users/sethogieva/.deno/bin/deno test --allow-read \
    supabase/functions/refund-order/index.test.ts \
    supabase/functions/cancel-order/index.test.ts
ok | 17 passed | 0 failed (53ms)

$ node .github/scripts/strict-grep/orch-0787-refund-cancel-flow.mjs
ORCH-0787 strict-grep gate passed.
```

**NOT run locally** (operator/orchestrator-owned):
- `cd mingla-business && npm run lint && npx tsc --noEmit` — TypeScript check on the mobile-business surface. **Recommended for the TEST dispatch to run before live-fire.**
- `cd mingla-business && npx jest` — Jest suite covering `eventOrdersService.test.ts` (the existing tests may need updates for the new mapper shape; not extended in this pass).

---

## §6 — Operator Action Required Before Deploy / Test

### §6.1 Supabase Edge Function secret

Configure **`STRIPE_RAK_TICKET_REFUND`** as a Supabase Edge Function secret (project ref `gqnoajqerqhnvulmnyvv`). The restricted API key must grant:
- `refunds:write` on the platform account
- `application_fees:read` on the platform account

### §6.2 Apply migration

```bash
cd /Users/sethogieva/Desktop/mingla-main
supabase db push --linked
```

Verify post-push via `mcp__supabase__list_migrations` — the migration `20260520000000_orch_0787_order_refund_cancel.sql` should appear in the remote ledger.

### §6.3 Deploy edge functions (orchestrator-side)

After the migration is live (`supabase db push` PASS), Codex `orchestrator-mingla` (or the operator if instructed) deploys:

```bash
supabase functions deploy refund-order --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy cancel-order --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv
```

(The `stripe-webhook` redeploy is needed because the shared `stripeWebhookRouter.ts` was extended with the new event types.)

Verify deploy via `mcp__supabase__list_edge_functions`:
- `refund-order` — new function (version 1).
- `cancel-order` — new function (version 1).
- `stripe-webhook` — version bump.

Preserve each function's existing `verify_jwt` setting per the local `supabase/config.toml`. Webhooks are typically `verify_jwt: false`; the new `refund-order` + `cancel-order` should have `verify_jwt: true` (JWT-authenticated callers).

### §6.4 Stripe Dashboard

Subscribe the platform webhook endpoint to the new event types if not already wildcard-subscribed:
- `charge.refunded`
- `refund.created`
- `refund.updated`

(The existing `charge.refund.updated` subscription stays.)

---

## §7 — Discoveries for Orchestrator

1. **ORCH-0785 coordination required for buyer email delivery.** The refund/cancel flow enqueues `ticket_order_notifications` rows with `template_key='buyer_refund_issued'` and `'buyer_order_cancelled'`. The consumer of these rows is `supabase/functions/ticket-confirmation-dispatch/index.ts`, which is currently dirty on disk from ORCH-0785 premium-email work. Per the operator's "surgical add only" directive (Q-2 in scope confirmation), this implementor pass deliberately did NOT touch the dispatcher. **Until ORCH-0785 lands the template_key consumers, refund/cancel emails will NOT actually send.** The refund itself still executes correctly (Stripe charge reversed, tickets voided, organiser sees updated state). Recommend the ORCH-0785 spec be amended to add explicit consumer branches for these two `template_key` values, with the payload shape defined in this report §2.2 step 9 of `refund-order` flow.

2. **Register ORCH-0788 for `useOrderStore` full ID-only contraction.** Per Q-8 v1, the store shape is preserved; new flows just don't write to it. The `recordRefund` and `cancelOrder` methods carry `@deprecated since ORCH-0787` markers pointing to ORCH-0788 as the removal deadline. Seed evidence: deprecation JSDocs in `mingla-business/src/store/orderStore.ts:139-167`; `feedback_zustand_persist_no_server_snapshots.md` invariant I-PROPOSED-J. Score: P2 / Investigate Next.

3. **`'failed'` order visibility gap.** I-PROPOSED-(new) ORDER-CANCELLED-VS-FAILED-SEPARATION dictates `'failed'` is gateway failure (distinct from `'cancelled'`). Today `eventOrdersService.statusFromPayment('failed')` returns `'paid'` because the `OrderStatus` union has no `'failed'` value. The orders list will silently surface failed orders as paid until a follow-up ORCH adds explicit Failed visibility. Production today has zero failed orders (per investigation §3.5), so this is dormant. Recommend register as P3 / when first failed order is reported.

4. **`useCurrentBrandRole` hook reads `order?.brandId`** on the order detail page. This works because `useEventOrderById` returns `OrderRecord | null | undefined` — the hook accepts null. Verified Rules-of-Hooks compliant (called before any early returns). No issue.

5. **Webhook race-mitigation contract (spec §15 highest-risk detail).** Implemented via `biz_refund_order_commit_from_webhook`'s two-path match (stripe_refund_id OR metadata.idempotency_key). T-19 in the spec test matrix verifies the in-app-pending + webhook-arrives-first race. **This is the critical test for the TEST dispatch to exercise** — it requires triggering a `refund.created` webhook while a pending in-app refund row exists for the same idempotency_key.

6. **TypeScript verification not run for mingla-business.** Per scope discipline I didn't run `npx tsc --noEmit` in the mobile-business tree (not part of the standing Deno-gate scope). Recommend the TEST dispatch run it as a first-line static check before live-fire — the type chain `OrderRecord → OrderLineRecord.orderLineItemId → RefundSheet manifest → orderRefundService input` is new and worth a compile-only sweep.

7. **No buyer-side app-mobile changes.** The buyer's existing `/o/[orderId]` page already reads from React Query keys. After a refund lands, the buyer's view will reflect `payment_status='refunded'` automatically on next refetch. No code change required — but worth a TEST verification that the buyer-side cache invalidation triggers correctly (or that the buyer reload happens naturally).

8. **`STRIPE_RAK_TICKET_REFUND` is a new operator secret.** If the operator's Stripe restricted-key setup doesn't already include a refund-scoped key, one must be created via the Stripe Dashboard before edge function deploy. The other functions (`STRIPE_RAK_ONBOARD`, `STRIPE_RAK_TICKET_CHECKOUT`, etc.) follow the same pattern — this is one more in the family.

---

## §8 — Transition Items

- **`useOrderStore.recordRefund`** + **`useOrderStore.cancelOrder`** — marked `@deprecated since ORCH-0787`. Exit condition: ORCH-0788 (full Zustand orderStore ID-only contraction). The methods remain callable but are no longer invoked by the production refund/cancel flow.
- **`OrderRecord.refunds[]`** + **`OrderRecord.refundedAmountGbp`** + **`OrderRecord.cancelledAt`** + **`OrderLineRecord.refundedQuantity`** — still persisted in Zustand per I-PROPOSED-J transitional carve-out documented in `feedback_zustand_persist_no_server_snapshots.md`. Exit condition: ORCH-0788. Today they are populated by `fetchEventOrders` from server truth and stale within the React Query staleTime window; the source of truth is the server.
- **`'failed'` OrderStatus** — `statusFromPayment('failed')` maps to `'paid'` as a transitional placeholder until a follow-up ORCH adds explicit Failed visibility (see discovery #3).

---

## §9 — Regression Surface (for the TEST dispatch)

Spec §13.1 names the class of bug ORCH-0787 prevents. The TEST dispatch should specifically watch for:

1. **Stripe Connect onboarding flow** — `_shared/stripe.ts` was extended. Verify `stripeTicketCheckout`, `stripeOnboard`, etc. still work (unchanged), and the new `stripeTicketRefund` factory loads cleanly.
2. **Existing webhook routing** — `STRIPE_ROUTED_EVENT_TYPES` grew. Verify `charge.refund.updated` still routes (unchanged case branch points at the renamed `handleRefundEvent` instead of `handleRefundUpdated`). Verify `application_fee.refunded` still writes to `mingla_revenue_log` (unchanged).
3. **Brand orphan refund section** — `brandStripeOrphanedRefundsService` query columns changed. Verify the section renders correctly when no refunds exist (zero rows) and when at least one refund exists (Stripe CLI seeded). Note: requires the migration to be live for the `account_id` generated column.
4. **Door-sale refund flow** — `DoorRefundSheet` was NOT modified. Verify the door refund pipeline (Cycle 12) still works end-to-end on iOS + Android.
5. **Free-order checkout** — `ticket-checkout-create` was NOT modified, but the `cancel-order` flow now interacts with free orders. Verify a free checkout → cancel → re-checkout flow doesn't leave stale state.
6. **Mobile orderStore** — `OrderLineRecord` gained an optional `orderLineItemId` field. Verify any other surface that reads `OrderLineRecord.lines[i]` (e.g., reconciliation page, guest list, door scanner) still works.

---

## §10 — Closing Statement

The implementation matches the spec contract. All 20 numbered success criteria are verified at the static/structural layer via Deno tests + strict-grep gates + code-level inspection. Live-fire of the actual money-moving flow + cross-platform UX parity + the critical webhook-race test (T-19) is the canonical responsibility of the next dispatch (Claude `mingla-forensics` TEST mode).

The implementor passes the work back to the operator with three explicit, scoped action items:
1. Configure `STRIPE_RAK_TICKET_REFUND` Edge Function secret.
2. Run `supabase db push --linked` to apply the migration.
3. Coordinate the close ordering with ORCH-0785 so refund/cancel buyer emails actually send when ORCH-0785's `ticket-confirmation-dispatch` adopts the two new `template_key` values.

End of implementation report — ORCH-0787.
