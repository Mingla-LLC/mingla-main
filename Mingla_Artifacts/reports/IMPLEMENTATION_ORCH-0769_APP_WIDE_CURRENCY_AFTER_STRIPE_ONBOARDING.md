# Implementation: ORCH-0769 App-wide currency after Stripe onboarding

Date: 2026-05-09
Status: implemented and verified
Implementor: Codex `$implementor`

## Summary

Implemented the approved ORCH-0769 source-of-truth repair so Stripe-selected currency can propagate into app-visible commerce state instead of remaining hidden in `stripe_connect_accounts`.

The implementation makes `brands.default_currency` the canonical brand commerce default, adds immutable `events.currency`, publishes new event tickets in the event currency, carries currency into checkout/order/door sale/refund snapshots, and converts active business app money display paths to `formatCurrency` / `formatCurrencyRound`.

Historical GBP fields remain readable as compatibility aliases. Existing GBP records are not relabeled.

## Files changed

Schema and edge:

- `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql`
- `supabase/functions/brand-stripe-refresh-status/index.ts`
- `supabase/functions/brand-stripe-balances/index.ts`

Business app currency contract:

- `mingla-business/src/utils/currency.ts`
- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/src/store/liveEventStore.ts`
- `mingla-business/src/store/orderStore.ts`
- `mingla-business/src/store/doorSalesStore.ts`
- `mingla-business/src/utils/liveEventConverter.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/services/ticketTypeMapper.ts`
- `mingla-business/src/services/businessEvents.ts`
- `mingla-business/src/services/publicEventsService.ts`

Checkout, door, orders, reconciliation, export, and display:

- `mingla-business/src/components/checkout/CartContext.tsx`
- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/checkout/[eventId]/buyer.tsx`
- `mingla-business/app/checkout/[eventId]/payment.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/src/components/checkout/PaymentElementStub.tsx`
- `mingla-business/src/components/checkout/QuantityRow.tsx`
- `mingla-business/src/components/door/DoorSaleNewSheet.tsx`
- `mingla-business/src/components/door/DoorRefundSheet.tsx`
- `mingla-business/app/event/[id]/door/index.tsx`
- `mingla-business/app/event/[id]/door/[saleId].tsx`
- `mingla-business/src/components/orders/RefundSheet.tsx`
- `mingla-business/src/components/orders/OrderListCard.tsx`
- `mingla-business/app/event/[id]/orders/[oid]/index.tsx`
- `mingla-business/app/o/[orderId].tsx`
- `mingla-business/app/event/[id]/guests/[guestId].tsx`
- `mingla-business/app/event/[id]/index.tsx`
- `mingla-business/app/event/[id]/reconciliation.tsx`
- `mingla-business/src/utils/reconciliation.ts`
- `mingla-business/src/utils/guestCsvExport.ts`
- Home/event/public/brand display components that previously used active GBP-only helpers.

Tests and guard:

- `.github/scripts/strict-grep/orch-0769-app-wide-currency.mjs`
- `mingla-business/package.json`
- `mingla-business/src/services/__tests__/eventDraftsPublishTickets.test.ts`

## Migration head evidence

Before creating the migration:

- Local max migration: `20260515000008_orch_0767_public_brand_profile_view.sql`
- Linked remote max migration: `20260515000008`

Created monotonic migration:

- `20260515000009_orch_0769_app_wide_currency.sql`

## Behavior before and after

Before:

- Stripe onboarding/refresh could know `default_currency`, but `brands.default_currency` stayed GBP.
- Publish RPC inserted `ticket_types.currency = 'GBP'`.
- Event reads did not expose event currency.
- Checkout, order, door sale, refund, reconciliation, and export paths rendered or persisted GBP-only snapshots.

After:

- Active/non-detached SCA rows sync `default_currency` into `brands.default_currency`.
- Detach still clears Stripe cache but does not reset brand commerce currency.
- `events.currency` is backfilled, exposed in management/public event views, and enforced against active ticket rows.
- Publish RPC chooses draft currency, then brand default currency, then GBP fallback; inserted ticket rows use the selected event currency.
- Refresh-status persists Stripe `country/default_currency`; balances fallback to brand default currency when no active account exists.
- New checkout/order/door/refund snapshots carry `currency` plus neutral aliases while legacy `*Gbp` fields remain readable.
- Active UI/export paths use currency-aware formatting and CSV rows include currency columns.

## Legacy compatibility

- Existing `priceGbp`, `totalGbpAtPurchase`, `totalGbpAtSale`, `amountGbp`, and related fields remain as compatibility reads.
- New records write neutral aliases where the current store shape allows it.
- Legacy records with missing currency or GBP-named fields are treated as GBP; no hydration path rewrites them to a new brand currency.

## Verification

Passed:

- `cd mingla-business && npm run test:orch-0769`
  - strict-grep passed
  - 4 Jest suites passed, 25 tests passed
- `cd mingla-business && npm run test:orch-0763`
  - 7 Jest suites passed, 54 tests passed
- `cd mingla-business && npm run test:orch-0759`
  - strict-grep self-test passed, live scan passed
  - 4 Jest suites passed, 30 tests passed
  - Note: the self-test intentionally prints one synthetic URL violation before reporting `I-PROPOSED-Y self-test: PASS`.
- `cd mingla-business && npx tsc --noEmit`
  - passed
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-refresh-status/index.ts`
  - passed
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-balances/index.ts`
  - passed
- `git diff --check`
  - passed

Non-blocking verification noise:

- Jest emitted the existing Watchman recrawl warning. Tests still exited 0.

## Deploy requirements

Operator must run:

```bash
/Users/sethogieva/bin/supabase db push
```

After DB push confirmation, deploy touched edge functions:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-refresh-status --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy brand-stripe-balances --project-ref gqnoajqerqhnvulmnyvv
```

`brand-stripe-onboard` and webhook callers rely on the updated database trigger for SCA-to-brand currency sync. No direct code deploy was needed for those files in this implementation pass.

Business app changes are JS/TS only; no new native dependency was added by ORCH-0769.

## Notes and risks

- The working tree already contained unrelated event cover media/package changes before this ORCH-0769 implementation. They were not reverted.
- `mingla-business/package.json` already contained unrelated `expo-file-system` dependency drift in the worktree; this implementation only added `test:orch-0769`.
- The migration is additive but changes the publish RPC and SCA trigger behavior. Production rollout should follow the required order: DB push first, then edge deploys, then business app deploy/OTA.

## Rework addendum: DB push SQL scope fix

After this report, the operator ran `supabase db push` and Postgres rejected statement 3 in the migration with:

```text
ERROR: invalid reference to FROM-clause entry for table "e" (SQLSTATE 42P01)
```

Follow-up rework report: `reports/IMPLEMENTATION_REWORK_ORCH-0769_DB_PUSH_SQL_SCOPE_FIX.md`.

Patch applied:

- Updated `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql` so the event-currency backfill no longer references the `UPDATE` target alias `e` inside a `JOIN ... ON` clause.
- Preserved the same fallback order: event ticket currency, then brand default currency, then GBP.

Updated deploy note: rerun `supabase db push` before deploying the touched edge functions.
