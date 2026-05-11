# Implementation Rework ORCH-0769: Currency Mismatch Revenue, Reconciliation, Wizard, Orders, Sales

## Status

Implemented and verified.

## Source Contract

- Prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0769_CURRENCY_MISMATCH_REVENUE_RECON_WIZARD_ORDERS_SALES.md`
- Evidence: `Mingla_Artifacts/reports/INVESTIGATION_REWORK_ORCH-0769_CURRENCY_MISMATCH_REVENUE_RECON_WIZARD_ORDERS_SALES.md`

## Files Changed

- `mingla-business/src/utils/currency.ts`
- `mingla-business/src/utils/moneySummary.ts`
- `mingla-business/src/store/orderStore.ts`
- `mingla-business/src/store/doorSalesStore.ts`
- `mingla-business/src/utils/reconciliation.ts`
- `mingla-business/src/utils/guestCsvExport.ts`
- `mingla-business/src/components/brand/BrandPaymentsView.tsx`
- `mingla-business/src/components/brand/BrandFinanceReportsView.tsx`
- `mingla-business/app/(tabs)/home.tsx`
- `mingla-business/app/event/[id]/index.tsx`
- `mingla-business/app/event/[id]/door/index.tsx`
- `mingla-business/src/components/event/EventListCard.tsx`
- `mingla-business/src/components/event/CreatorStep5Tickets.tsx`
- `mingla-business/src/components/event/CreatorStep7Preview.tsx`
- `mingla-business/src/components/event/TicketTierCard.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/components/event/EditPublishedScreen.tsx`
- `mingla-business/src/components/event/types.ts`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/services/brandStripeBalancesService.ts`
- `mingla-business/src/utils/__tests__/moneySummary.test.ts`
- `mingla-business/src/services/__tests__/brandStripeBalancesService.test.ts`
- `mingla-business/package.json`
- `supabase/functions/brand-stripe-balances/index.ts`

## Behavior Before

- Event/home/list/detail revenue selectors returned bare legacy `*Gbp` numbers and callers formatted them as `event.currency` or `brand.defaultCurrency`.
- Door reconciliation summed `totalGbpAtSale - refundedAmountGbp` under the event currency.
- Full reconciliation could silently combine stale GBP rows with new non-GBP rows.
- Finance reports repainted brand stub `revenueGbp` / `amountGbp` as the brand default currency.
- Payments had a live Stripe balances hook/service, but the screen did not use it; the edge function returned camelCase fields while the service required snake_case.
- Wizard Step 5/7 still fell back to GBP for null draft currency even when the brand default currency was known.

## Behavior After

- Added shared `summarizeEventMoney` helper that totals only rows matching the expected event currency, tracks currencies present, and returns mismatch records for stale/mixed rows.
- Added `summarizeLegacyBrandFinance` helper so legacy brand finance stubs remain GBP and emit transitional mismatch state for non-GBP brands.
- Order and door stores now expose currency-aware summary selectors while keeping legacy numeric selectors for compatibility.
- Event Detail, Home live hero, Event list revenue strip, Door Sales card, Reconciliation, and reconciliation CSV now use currency-aware summaries.
- Mixed/stale rows are excluded from the displayed single-currency total and flagged through mismatch cards/discrepancies/CSV metadata.
- Payments now uses `useBrandStripeBalances` for active Stripe brands, converts minor units with currency minor-unit rules, and treats payout/refund stubs as explicit GBP.
- `brand-stripe-balances` now returns the snake_case contract expected by the client: `available_minor`, `pending_minor`, `retrieved_at`, plus backward-compatible camelCase aliases.
- Wizard Step 5/7 use `draft.currency ?? brand.defaultCurrency ?? "GBP"` for display, and server ticket sync fetches brand default currency before falling back to GBP.

## Mixed Currency Representation

- Matching rows contribute to the expected-currency totals.
- Non-matching rows are not FX-converted and not relabeled.
- `currenciesPresent`, `byCurrency`, and `mismatches` preserve what was found.
- Reconciliation adds `method_sum_mismatch` discrepancies for excluded currencies.
- Door/event detail screens show visible currency review copy when stale rows are present.
- Finance reports label legacy brand finance as GBP and show a transitional notice for non-GBP brand currency.

## Verification

### Smoke Rework After Operator Screenshots

The operator smoke test showed:

- Payments fell back to `£0.00` because `brand-stripe-refresh-status` and balances were returning `401 unauthenticated`.
- Event Detail showed `£0.00` for a dollar brand when the event had no revenue rows.

Additional fix applied:

- `refreshBrandStripeStatus` and `fetchBrandStripeBalances` now accept an explicit access token and pass `Authorization: Bearer <token>` to Supabase Edge Functions.
- `useBrandStripeStatus` and `useBrandStripeBalances` pass the AuthContext session access token instead of relying on implicit function auth headers.
- Payments zero-value fallback now displays the brand default currency when the cached legacy balance is zero. Positive legacy balance stubs remain GBP.
- Event Detail zero-revenue display uses the brand default currency when there are no money rows to establish event-currency revenue.
- Added a service test proving `brandStripeBalancesService` sends the explicit bearer token.

```bash
cd mingla-business && npm run test:orch-0769
```

Result: PASS. Strict grep passed. Jest suites passed: 6/6, tests passed: 32/32. Watchman emitted a recrawl warning only.

```bash
cd mingla-business && npx tsc --noEmit
```

Result: PASS.

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-balances/index.ts
```

Result: PASS.

## Remaining Runtime QA

- Create or use a non-GBP Stripe-onboarded brand and verify Payments KPIs show live Stripe balance in the Stripe/default currency.
- Verify an event with same-currency rows shows normal totals, and an event with stale GBP local rows shows the currency review state instead of combining totals.
- Verify a null-currency draft under a USD/CAD brand displays ticket prices in the brand currency through Step 5 and Step 7.

## Deploy Notes

- No Supabase DB migration was added or pushed in this implementation pass.
- `supabase/functions/brand-stripe-balances/index.ts` changed and passed Deno check; deploy that edge function when the operator is ready.
