# SPEC — ORCH-0796 Reconciliation real expected-payout (B2b wiring)

**Date:** 2026-05-11
**Owner:** Claude `mingla-forensics` (SPEC mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Predecessor:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0796_PAYOUTS_STUB_FIXTURE_LEAK.md`

---

## 1. Scope reframe

The ORCH-0796 dispatch originally framed this as a Zustand-stub-leak in BrandPaymentsView. Investigation disproved that framing (ORCH-0742 already collapsed the persist payload to `currentBrandId`; `mapBrandRowToUi` never populates `payouts`/`refunds`). The operator confirmed the actual fix wanted: **remove the 4% Stripe-fee stub on the per-event Reconciliation screen and compute a real expected-payout figure from existing Stripe data already captured per order/refund.**

This SPEC absorbs the work that was previously queued under ORCH-0797. ORCH-0797 is **deprecated** in favor of this ORCH-0796 reframe.

## 2. Goal

The PAYOUT row on `mingla-business/app/event/[id]/reconciliation.tsx` must show the real, data-derived expected net to the organiser's Stripe account for this event, not a 4% approximation. When an event has zero paid Stripe orders, the row renders `—` (em-dash) instead of `£0.00` to avoid implying a payout will arrive.

## 3. Non-goals

- No changes to BrandPaymentsView's RECENT PAYOUTS list (that surface uses a different data path — the future-cycle work, if any, lands separately).
- No new DB tables, no new edge functions, no new RPCs. All data needed is already in `orders` + `refunds` post-ORCH-0787.
- No card-reader / NFC fee schedules (no Terminal SDK shipped; door sales remain at 1.0 multiplier — cash only, which is the only door payment method live today).
- No PDF export (still B-cycle per D-13-7).
- No `audit_log` integration (still deferred per D-13-11).
- No persist-version bump on currentBrandStore (already v14; no schema change).

## 4. Data sources (already exist)

| Source | Column | Meaning |
|---|---|---|
| `public.orders.total_cents` | total | Buyer-paid amount in minor units |
| `public.orders.stripe_application_fee_amount_cents` | Stripe-confirmed platform fee | What Stripe actually charged as `application_fee_amount` on the charge (set by webhook on `payment_intent.succeeded` / `checkout.session.completed`) |
| `public.orders.application_fee_amount_cents` | Intended platform fee | What Mingla requested as `application_fee_amount` at charge creation. Reconciles with `stripe_application_fee_amount_cents` post-webhook. |
| `public.orders.refunded_amount_cents` | refunded total | Cumulative refund amount across all refunds for this order |
| `public.refunds.amount_cents` per refund | individual refund | |
| `public.refunds.application_fee_refunded_cents` per refund | per-refund app-fee refund | Set by `refund-order` / `stripe-webhook` on `charge.refunded` |

## 5. Net-to-organiser formula (per order)

For a given paid (or partially refunded) order belonging to the event:

```
net_to_organiser_cents =
    total_cents
  - stripe_application_fee_amount_cents   -- platform fee taken by Mingla
  - refunded_amount_cents                  -- refunds reduce organiser's net
  + sum(refund.application_fee_refunded_cents)  -- but app-fee portion of refund flows back
```

Rationale: under Stripe Connect destination charges with `application_fee_amount`, Stripe absorbs processing fees at the platform tier (Mingla pays). The connected account (organiser) receives `total - application_fee`. Each refund reduces what the connected account keeps by `refund.amount - refund.application_fee_refunded`.

Use `stripe_application_fee_amount_cents` (Stripe-confirmed value) **when set**; fall back to `application_fee_amount_cents` (Mingla-intended) when null (only happens pre-webhook; an order that has not been paid is excluded from the aggregation by status anyway).

## 6. Per-event aggregation

```
expectedPayoutOnlineCents =
    sum over event's PAID and PARTIAL_REFUND orders of net_to_organiser_cents

expectedPayoutDoorCents =
    sum over event's door sales of amount_cents
    (cash; no fee schedule today)

expectedPayoutCents = expectedPayoutOnlineCents + expectedPayoutDoorCents
```

Empty-event rule: if `orders.length === 0 && doorSales.length === 0` (or all orders are unpaid), `expectedPayoutCents` is `null`, not `0`. The UI renders `—` for `null`.

Currency rule: aggregation is per the event's `defaultCurrency`. The existing `summarizeEventMoney` `expectedCurrency` argument continues to gate cross-currency mismatch detection (`CurrencyMismatch` path stays as-is — that's an existing concern, not in scope).

## 7. Code changes — file by file

### 7.1 `mingla-business/src/services/eventOrdersService.ts`

Extend the `orders` select to include:
- `application_fee_amount_cents`
- `stripe_application_fee_amount_cents`

Extend the refund mapping inside `fetchEventOrders` (around line 96-110) to surface `application_fee_refunded_cents` per refund.

### 7.2 `mingla-business/src/store/orderStore.ts` (types only — not the store logic)

Extend `OrderRecord` with two optional fields:
- `applicationFeeAmountCents?: number` — Mingla-intended
- `stripeApplicationFeeAmountCents?: number | null` — Stripe-confirmed; null until webhook lands

Extend `RefundRecord` with:
- `applicationFeeRefundedCents?: number` — defaults to 0

Both fields are passthrough; no store-action changes.

### 7.3 `mingla-business/src/utils/moneySummary.ts`

Replace the 4% stub formula. The current return shape:

```ts
return {
  onlineRevenue, doorRevenue, grossRevenue,
  onlineRefunded, doorRefunded, totalRefunded,
  payoutEstimate: round2(round2(onlineRevenue * 0.96) + doorRevenue),
  revenueByMethod, currencyMismatches, expectedCurrency,
};
```

Becomes:

```ts
// expectedPayoutCents — null when no paid online activity and no door activity exists,
// signalling the UI to render "—" rather than a misleading £0.00.
let onlineNetCents = 0;
let hasAnyOnlinePayment = false;
for (const order of paidOrPartialOrders) {
  const total = order.totalCents ?? Math.round((order.amountGbp ?? 0) * 100);
  const stripeAppFee = order.stripeApplicationFeeAmountCents
    ?? order.applicationFeeAmountCents
    ?? 0;
  const refunded = order.refundedAmountCents
    ?? Math.round((order.refundedAmount ?? order.refundedAmountGbp ?? 0) * 100);
  const appFeeRefunded = (order.refunds ?? []).reduce(
    (acc, r) => acc + (r.applicationFeeRefundedCents ?? 0),
    0,
  );
  onlineNetCents += total - stripeAppFee - refunded + appFeeRefunded;
  hasAnyOnlinePayment = true;
}

const doorNetCents = doorRevenueCents; // cash, no fees
const hasAnyDoorPayment = doorSales.length > 0;

const expectedPayoutCents =
  (hasAnyOnlinePayment || hasAnyDoorPayment)
    ? Math.max(0, onlineNetCents + doorNetCents)
    : null;

return {
  ...
  expectedPayoutCents,  // new (replaces payoutEstimate semantically + name)
  expectedPayoutMajor: expectedPayoutCents === null ? null : expectedPayoutCents / 100,
  // payoutEstimate field REMOVED from the returned shape
};
```

Note: `Math.max(0, ...)` guards against refund-overshoot edge cases (a refund that exceeds the original net to organiser due to Stripe fee absorption). This is rare but documented in Stripe's destination-charges semantics.

The type `MoneySummary` interface (line 41-56) loses `payoutEstimate: number` and gains `expectedPayoutCents: number | null` + `expectedPayoutMajor: number | null`.

### 7.4 `mingla-business/src/utils/reconciliation.ts`

`ReconciliationSummary` interface (around line 85-86):

```ts
// REMOVE:
/** [TRANSITIONAL] payoutEstimate per D-13-10. EXIT: B-cycle Stripe payout API + Stripe Terminal SDK. */
payoutEstimate: number;

// ADD:
/** Expected net to organiser's Stripe account, in event currency major units. Null when no payments exist. */
expectedPayoutMajor: number | null;
```

Both call sites that forward the value from `summarizeEventMoney` (lines 260 + 380) update to forward `expectedPayoutMajor` instead of `payoutEstimate`. Header doc D-13-10 comment block updated to reflect the real formula (or removed entirely).

The header `[TRANSITIONAL] payoutEstimate uses 4% Stripe-fee stub` JSDoc (lines 17-18 + 85) is removed.

### 7.5 `mingla-business/app/event/[id]/reconciliation.tsx`

Header doc (lines 27-28) — remove the `[TRANSITIONAL] payoutEstimate uses 4% Stripe-fee stub` block.

`SectionRow` block (lines 548-559) — change to:

```tsx
<SectionRow
  label="Stripe fee (online)"
  value={summary.stripeFeeOnlineMajor !== null
    ? `−${formatCurrency(summary.stripeFeeOnlineMajor, currency)}`
    : "—"}
  variant="muted"
/>
<SectionRow label="Door fee" value={formatCurrency(0, currency)} variant="muted" />
<SectionRow
  label="EXPECTED PAYOUT"
  value={summary.expectedPayoutMajor !== null
    ? formatCurrency(summary.expectedPayoutMajor, currency)
    : "—"}
  variant="mid"
  hint={summary.expectedPayoutMajor !== null
    ? "Net to your Stripe account after fees and refunds"
    : "No payments yet"}
/>
```

This requires the summary to also expose `stripeFeeOnlineMajor: number | null` — the sum of `stripeApplicationFeeAmountCents` across paid orders, divided by 100. Add that field to `MoneySummary` + `ReconciliationSummary`. The literal "(online, 4% stub)" label disappears entirely.

Where the prior code computed `stripeFeeOnline` locally as `summary.grossRevenue * 0.04` (currently somewhere in the component — verify line during implementation), remove that local computation and use `summary.stripeFeeOnlineMajor`.

### 7.6 `mingla-business/src/components/brand/BrandPaymentsView.tsx`

Reap the now-misleading `[TRANSITIONAL]` comments:

- Lines 170-180 — the block beginning `[TRANSITIONAL] payouts + refunds still read from Zustand stub`.
- Lines 419-421 — `[TRANSITIONAL] payout rows are visually inert in Cycle 2`.

Replace both with a single short comment:

```ts
// `brand.payouts` and `brand.refunds` are intentionally unpopulated by
// mapBrandRowToUi today; this screen renders the empty state. Real per-brand
// payout/refund listing is tracked separately from per-event reconciliation.
```

No runtime behavior change for BrandPaymentsView. The screen still renders empty state as before.

### 7.7 Tests

`mingla-business/src/utils/__tests__/moneySummary.test.ts` (new or extend existing):
- T-01 — zero orders, zero door → `expectedPayoutMajor === null`
- T-02 — one paid order, no refund → `expectedPayoutMajor === (total - stripeFee) / 100`
- T-03 — one paid order, full refund (status `refunded_full`) → `expectedPayoutMajor === 0` (Stripe takes back its slice via `application_fee_refunded_cents`; organiser nets 0)
- T-04 — one paid order, partial refund → equals net-after-partial-refund formula
- T-05 — cash door sale only → `expectedPayoutMajor === doorRevenue`
- T-06 — mixed online + door → sums correctly
- T-07 — `stripeApplicationFeeAmountCents` null, falls back to `applicationFeeAmountCents` → still computes
- T-08 — refund-overshoot edge case → `Math.max(0, ...)` clamps to 0
- T-09 — currency mismatch path unchanged (regression guard)

`mingla-business/src/utils/__tests__/reconciliation.test.ts` (extend existing):
- Update any existing tests that assert on `payoutEstimate` → `expectedPayoutMajor`
- Add: zero-payment event → `summary.expectedPayoutMajor === null`

### 7.8 Strict-grep CI gate

New file `.github/scripts/strict-grep/orch-0796-no-stub-payout-fee.mjs`:
- Check 1 — zero occurrences of `0\.96` literal inside `mingla-business/src/utils/moneySummary.ts` or `mingla-business/src/utils/reconciliation.ts`.
- Check 2 — zero occurrences of `payoutEstimate` field name across `mingla-business/src/` (the field is renamed; orphan references would mean an incomplete rename).
- Check 3 — zero occurrences of `TRANSITIONAL — B-cycle Stripe payout API` literal anywhere in `mingla-business/`.
- Check 4 — `expectedPayoutCents` AND `expectedPayoutMajor` both present in `moneySummary.ts`.
- Check 5 — the EXPECTED PAYOUT SectionRow in `reconciliation.tsx` references `summary.expectedPayoutMajor` (the rename is complete at the UI layer).

Register as new job `orch-0796-no-stub-payout-fee` in `.github/workflows/strict-grep-mingla-business.yml` per registry pattern (one script + one job; no parallel workflow file).

## 8. Success criteria

| # | Criterion | Verification |
|---|---|---|
| SC-1 | The string `* 0.96` is gone from `mingla-business/src/utils/moneySummary.ts` | `grep -n '\* 0\.96' mingla-business/src/utils/moneySummary.ts` returns no results |
| SC-2 | The string `TRANSITIONAL — B-cycle Stripe payout API` is gone from the entire `mingla-business/` tree | grep returns no results |
| SC-3 | An event with one paid Stripe Checkout order and no refund shows `EXPECTED PAYOUT = formatCurrency((total - stripeAppFee) / 100, currency)` on the Reconciliation screen | Unit test T-02 + manual smoke on a test-mode order |
| SC-4 | An event with zero payments shows `EXPECTED PAYOUT = —` with hint `"No payments yet"` | Unit test T-01 + visual smoke on a draft event |
| SC-5 | An event with a fully refunded order shows `EXPECTED PAYOUT = £0.00` (not the original gross) | Unit test T-03 + manual smoke against the ORCH-0787 refund test order `6ad119af-…` |
| SC-6 | All existing `moneySummary` + `reconciliation` tests still pass after the field rename | `cd mingla-business && yarn jest src/utils/__tests__/` exits 0 |
| SC-7 | TypeScript compiles clean | `cd mingla-business && yarn tsc --noEmit` exits 0 |
| SC-8 | New CI gate `orch-0796-no-stub-payout-fee` runs and exits 0 in CI | GitHub Actions job result |
| SC-9 | Cross-currency mismatch detection still functions | Existing test that exercises `currencyMismatches` array still passes |
| SC-10 | Header docs of `reconciliation.ts` + `reconciliation.tsx` no longer reference D-13-10 4% stub or B-cycle exit condition | grep within the two files returns no `D-13-10` or `4%` mention |

## 9. Invariants

### Preserves
- **Constitution #9 No fabricated data** — the new formula computes net from real columns; the `—` empty-state preserves "missing = hidden, never fake".
- **Constitution #10 Currency-aware** — aggregation continues to honor event's `defaultCurrency`.
- **I-PROPOSED-J ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS** — unchanged; no new persist surface.
- **I-CYCLE-13-RECON RAW-ARRAYS-SELECTOR** — unchanged; selector contract preserved.
- **Const #7 Label temporary** — by removing the `TRANSITIONAL` label, this CHANGE removes a transitional gate; the work goes from labelled-transitional to permanent. No regression of Const #7.

### Establishes (NEW)
- **I-PROPOSED-BB EVENT-PAYOUT-DATA-DERIVED** (DRAFT — flips to ACTIVE on ORCH-0796 CLOSE): the expected-payout figure on the Reconciliation screen MUST be derived from `orders.stripe_application_fee_amount_cents` (or fall-back `application_fee_amount_cents`) and `orders.refunded_amount_cents` + `refunds.application_fee_refunded_cents`. No fee multipliers may be hardcoded. CI gate `orch-0796-no-stub-payout-fee` enforces.

## 10. Implementation order

1. Extend `OrderRecord` + `RefundRecord` types in `orderStore.ts` (pure additive)
2. Extend `eventOrdersService.fetchEventOrders` select + mapping
3. Rewrite `summarizeEventMoney` in `moneySummary.ts` (formula change + interface change)
4. Update `computeReconciliation` in `reconciliation.ts` (field rename + interface change)
5. Update `reconciliation.tsx` UI (label change + hint change + rendering null → "—")
6. Reap stale comments in `BrandPaymentsView.tsx` (doc-only)
7. Add unit tests T-01..T-09
8. Add CI gate `orch-0796-no-stub-payout-fee`
9. `yarn tsc --noEmit` clean
10. `yarn jest src/utils/__tests__/` clean
11. Smoke locally against the ORCH-0787 refund test order to verify SC-5

## 11. Regression prevention

- The CI gate at §7.8 enforces all three negative invariants (no `0.96`, no `payoutEstimate`, no `TRANSITIONAL — B-cycle` string).
- T-08 (refund-overshoot clamp) regression-locks the `Math.max(0, ...)` guard.
- T-03 (full-refund → zero) regression-locks the `+ application_fee_refunded_cents` add-back.

## 12. Hard guards for implementor

- **No DB migration.** All columns needed already exist (post-ORCH-0787 and post-ORCH-0777).
- **No new edge function.** All data is queryable client-side via the existing `fetchEventOrders` Supabase query under RLS.
- **No new RPC.** Same reason.
- **No new persist version bump.** No new persisted state.
- **No supabase db push.** Operator owns DB pushes; this change touches none.
- **No `supabase functions deploy`.** No edge function source touched; orchestrator's edge-deploy step is N/A.
- **No EAS native build.** Pure JS/TS — eligible for OTA update via `eas update --branch production --platform ios` and `--platform android` (per memory `feedback_eas_update_no_web.md`).
- **No scope into BrandPaymentsView's RECENT PAYOUTS list.** Only the doc comments in 7.6.
- **No scope into PDF export / audit log** — those remain B-cycle gated.
- **No scope into ORCH-0764B's onboarding state path.** Untouched.
- **No card-reader / NFC fee logic.** Door sales stay at 1.0.

## 13. Discoveries for orchestrator

1. **ORCH-0797 (queued by the orchestrator dispatch for B2b real wiring) is now absorbed into this reframed ORCH-0796.** The orchestrator should remove the queued ORCH-0797 placeholder and cite this SPEC as the authoritative B2b reconciliation-payout work.
2. **ORCH-0795 close note also registered an unrelated ORCH-0796 (scanner-row churn).** That ID collision still needs resolving — the scanner-churn follow-up needs renumbering to ORCH-0800 (or whatever the next free slot is). Not this SPEC's scope.
3. **`availableBalanceGbp` / `pendingBalanceGbp`** on the Brand type remain dead fields. Candidate deletion in a follow-up small cycle. Not this SPEC's scope.
4. **Stripe webhook reconciliation timing.** `stripe_application_fee_amount_cents` is set by the webhook on `payment_intent.succeeded` / `checkout.session.completed`. There is a small window between order creation and webhook landing where this column is NULL. The §5 fallback to `application_fee_amount_cents` handles this — the value is the intended platform fee at charge creation, which equals the eventual Stripe-confirmed fee in normal operation. Document but do not gate against it.

---

NEXT HANDOFF — paste into Codex `implementor-mingla` (or Claude `mingla-implementor`):

Implement ORCH-0796 reframed per `Mingla_Artifacts/specs/SPEC_ORCH-0796_RECONCILIATION_REAL_PAYOUT.md`, following the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0796_PAYOUTS_STUB_FIXTURE_LEAK.md`. Goal: remove the 4% Stripe-fee stub in `mingla-business/src/utils/moneySummary.ts:183`, replace with real net-to-organiser computation from `orders.stripe_application_fee_amount_cents` + `orders.refunded_amount_cents` + `refunds.application_fee_refunded_cents` (all already shipped post-ORCH-0777/0787), and update the Reconciliation screen `mingla-business/app/event/[id]/reconciliation.tsx:554-559` to render `EXPECTED PAYOUT` with hint `"Net to your Stripe account after fees and refunds"` (or `—` + `"No payments yet"` when no payments exist). Also reap stale `[TRANSITIONAL]` doc comments at `BrandPaymentsView.tsx:170-180` and `:419-421` per §7.6. Hard guards: no DB migration, no edge function changes, no new RPC, no persist version bump, no scope into BrandPaymentsView's RECENT PAYOUTS list, no card-reader fee logic. Implementation order at §10 — 11 sequential steps. Success criteria SC-1..SC-10 at §8 — every one is independently verifiable. New strict-grep CI gate `orch-0796-no-stub-payout-fee` required per §7.8. Unit tests T-01..T-09 per §7.7 (extend `moneySummary.test.ts` + `reconciliation.test.ts`). On completion write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0796_RECONCILIATION_REAL_PAYOUT.md` with old→new code receipts per layer + tsc/jest gate output. Downstream routing: Claude `mingla-forensics` (TEST mode) → orchestrator CLOSE (with the iOS + Android EAS OTA step, no native build needed since pure JS/TS). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
