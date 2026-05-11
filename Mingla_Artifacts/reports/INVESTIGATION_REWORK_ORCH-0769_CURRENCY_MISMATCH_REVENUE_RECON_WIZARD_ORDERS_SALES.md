# Investigation Rework: ORCH-0769 currency mismatch across revenue, reconciliation, wizard, orders, sales

Date: 2026-05-09
Mode: `$forensics`
Status: FAIL - ORCH-0769 is not close-ready
Trigger: Operator confirmed DB push + edge deploy, then observed mismatched/foreign currencies on Events revenue and Reconciliation. Operator requested no-stone-unturned analysis including event wizard, orders, and sales.

## Executive verdict

The DB migration and edge deploy fixed part of the source-of-truth problem, but the business app still has active money surfaces that treat amounts as currencyless numbers and then format them with `event.currency` or `brand.defaultCurrency`.

That means a CAD/USD/EUR brand can still see GBP-derived numbers painted as CAD/USD/EUR, and a mixed/stale local event can show event-level summaries in one currency while row-level orders or door sales retain another currency.

The primary issue is not one missing formatter. It is a semantic money aggregation bug across finance reports, event detail revenue, door reconciliation, full reconciliation, payments KPIs, and draft/wizard defaults.

## Confirmed findings

### F-0769-R1 - Finance reports still sum GBP-named brand stubs and repaint them as brand default currency

Severity: P0 launch blocker
Files:

- `mingla-business/src/components/brand/BrandFinanceReportsView.tsx`
- `mingla-business/src/types/brand.ts`

Evidence:

- `BrandEventStub.revenueGbp` is documented as gross revenue in GBP at `src/types/brand.ts:87-94`.
- `BrandRefund.amountGbp` and `BrandPayout.amountGbp` are documented as GBP at `src/types/brand.ts:50-67`.
- `BrandFinanceReportsView` computes sparkline buckets with `event.revenueGbp` at `BrandFinanceReportsView.tsx:147-168`.
- It computes gross sales and refunds with `revenueGbp` / `amountGbp` at `BrandFinanceReportsView.tsx:223-229`.
- It calculates fees with hardcoded GBP flat fees at `BrandFinanceReportsView.tsx:235-237`.
- It then sets `const currency = brand.defaultCurrency ?? "GBP"` at `BrandFinanceReportsView.tsx:289` and formats the totals/top-events with that currency at `BrandFinanceReportsView.tsx:422-465`.

Impact:

- A non-GBP brand can see GBP stub amounts displayed as CAD/USD/EUR.
- A brand with events in multiple currencies would get a single fake total.
- Fee labels still say `£0.30`, while values are formatted in whatever `brand.defaultCurrency` is.

Required fix:

- Do not compute brand finance totals from `BrandEventStub.revenueGbp` without a currency.
- Replace finance report inputs with currency-bearing event/order/refund/payout rows, or group legacy stubs under explicit GBP.
- If more than one currency is present, group sections by currency or show an honest mixed-currency state. Do not show one combined currency total.

### F-0769-R2 - Event detail revenue and Door Sales tile still aggregate currencyless order/door numbers

Severity: P0 launch blocker
Files:

- `mingla-business/app/event/[id]/index.tsx`
- `mingla-business/src/store/orderStore.ts`
- `mingla-business/src/store/doorSalesStore.ts`
- `mingla-business/src/components/event/EventDetailKpiCard.tsx`

Evidence:

- `orderStore.getRevenueForEvent` is documented as summing `totalGbpAtPurchase - refundedAmountGbp` at `orderStore.ts:173-177`.
- The selector implementation sums those same GBP-named fields and returns only a number, no currency, at `orderStore.ts:352-360`.
- Event detail reads that number into `revenueGbp` at `app/event/[id]/index.tsx:313-318`.
- It formats the KPI with `event.currency ?? "GBP"` at `app/event/[id]/index.tsx:663-666`.
- Door revenue is computed from `sale.totalGbpAtSale - sale.refundedAmountGbp` at `app/event/[id]/index.tsx:340-347`.
- The Door Sales tile formats that total with `event.currency ?? "GBP"` at `app/event/[id]/index.tsx:647-652`.
- `doorSalesStore.getDoorRevenueForEvent` also returns only a currencyless number from GBP-named fields at `doorSalesStore.ts:287-292`.

Impact:

- Event detail can show a numeric revenue total in the event currency even if the underlying orders/sales are a different currency.
- Row-level order/sale screens may show the row's stored currency, while event-level cards show a different currency. This matches the operator's observed "foreign currencies that don't match" symptom.

Required fix:

- Replace `getRevenueForEvent` and `getDoorRevenueForEvent` with currency-aware summary selectors or helper functions.
- Event detail must either:
  - include only rows whose `order.currency` / `sale.currency` equals `event.currency`, and flag mismatches, or
  - group revenue by currency.
- For a single event, the preferred contract is strict consistency: all online orders, door sales, refunds, and ticket rows must match `event.currency`; any mismatch must surface as a reconciliation warning and be excluded from single-currency totals until resolved.

### F-0769-R3 - Door reconciliation sums door sales regardless of sale currency, then formats as event currency

Severity: P0 launch blocker
File: `mingla-business/app/event/[id]/door/index.tsx`

Evidence:

- Totals by method use `s.totalGbpAtSale - s.refundedAmountGbp` at `door/index.tsx:180-184`.
- Totals by scanner do the same at `door/index.tsx:188-204`.
- Gross/refunded/net totals use `totalGbpAtSale` and `refundedAmountGbp` at `door/index.tsx:208-214`.
- The reconciliation card formats every method/refund/net/scanner total with `event.currency ?? "GBP"` at `door/index.tsx:425-505`.

Impact:

- Door list rows can preserve `sale.currency`, but the reconciliation card can repaint all sales as `event.currency`.
- If a stale/local sale was created before the event currency changed, the summary lies.

Required fix:

- Door reconciliation must derive an event-currency-only summary and a mismatch list.
- If all door sales match event currency, show the normal single-currency card.
- If mismatches exist, show a visible finance warning with counts and currencies, and do not silently include mismatched rows in the event-currency net.

### F-0769-R4 - Full reconciliation utility has no currency guard or grouping

Severity: P0 launch blocker
Files:

- `mingla-business/src/utils/reconciliation.ts`
- `mingla-business/app/event/[id]/reconciliation.tsx`
- `mingla-business/src/utils/guestCsvExport.ts`

Evidence:

- The route passes only `currency: event.currency ?? "GBP"` into the summary at `app/event/[id]/reconciliation.tsx:113`.
- The utility sums order revenue from `order.totalGbpAtPurchase - order.refundedAmountGbp` at `reconciliation.ts:235-239`.
- It sums door revenue from `sale.totalGbpAtSale - sale.refundedAmountGbp` at `reconciliation.ts:242-248`.
- It sums refunds from `refund.amountGbp` at `reconciliation.ts:250-263`.
- It builds per-method revenue from the same GBP-named fields at `reconciliation.ts:265-281`.
- The CSV export sets summary currency from `args.event.currency ?? "GBP"` and repeats the summary, even though row-level order/sale currencies can differ.

Impact:

- Full reconciliation can combine online orders and door sales with different currencies into one total.
- Exported CSV can carry row-level currency columns while the top summary reports a single event currency.

Required fix:

- `buildReconciliationSummary` must inspect every order/sale/refund row currency.
- Add `currencyMismatches` / `currenciesPresent` to the summary model.
- Single-currency totals must be computed from rows matching the event currency only, or grouped by currency. Do not silently sum mixed currencies.
- CSV summary must include mismatch diagnostics and must not report a single fake total when mixed currencies exist.

### F-0769-R5 - Event wizard still has null-currency states that fall back to GBP

Severity: P1
Files:

- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/components/event/CreatorStep5Tickets.tsx`
- `mingla-business/src/components/event/CreatorStep7Preview.tsx`

Evidence:

- `DraftEvent.currency` is optional/null at `draftEventStore.ts:263-265`.
- Default draft fields set `currency: null` at `draftEventStore.ts:349`.
- Persist migrations intentionally preserve old/local drafts with `currency: null` at `draftEventStore.ts:610-623`.
- Server draft creation correctly fetches brand default and stamps `currency: brandCurrency` at `eventDrafts.ts:97-110`.
- But legacy/local draft ticket sync still passes `draft.currency ?? "GBP"` at `eventDrafts.ts:89-90`.
- Wizard Step 5 formats projected max revenue using `draft.currency ?? "GBP"` at `CreatorStep5Tickets.tsx:188-195`.
- Wizard Step 7 preview formats ticket price line using `draft.currency ?? "GBP"` at `CreatorStep7Preview.tsx:90-95`.

Impact:

- A new server-backed draft should be okay after server creation completes.
- A legacy local draft, server creation failure, edit/preview path during hydration, or migrated persisted draft can still show GBP in the wizard before publish.
- This confirms the operator's concern that the change does not fully translate to the event wizard.

Required fix:

- Introduce one effective draft currency helper: `draft.currency ?? currentBrand.defaultCurrency ?? "GBP"`.
- Stamp local drafts with brand default currency when creating or hydrating where brand context is available.
- Step 5, Step 7, preview, ticket sheets, and sync paths must all use the same effective currency.
- `syncDraftTicketsToServerEvent` must not use `draft.currency ?? "GBP"` when brand currency is knowable.

### F-0769-R6 - Payments screen does not use live Stripe balances and has an edge/client response-shape mismatch

Severity: P1
Files:

- `supabase/functions/brand-stripe-balances/index.ts`
- `mingla-business/src/services/brandStripeBalancesService.ts`
- `mingla-business/src/hooks/useBrandStripeBalances.ts`
- `mingla-business/src/components/brand/BrandPaymentsView.tsx`

Evidence:

- Edge returns `availableMinor` / `pendingMinor` at `brand-stripe-balances/index.ts:66-72` and `brand-stripe-balances/index.ts:105-108`.
- Frontend service expects `available_minor` / `pending_minor` at `brandStripeBalancesService.ts:27-31` and rejects payloads without those snake_case fields at `brandStripeBalancesService.ts:45-52`.
- `useBrandStripeBalances` exists, but `BrandPaymentsView` never imports or calls it.
- Payments KPIs use `brand.availableBalanceGbp` and `brand.pendingBalanceGbp` at `BrandPaymentsView.tsx:350-358`.
- Recent payouts/refunds remain stub-backed and formatted with `brand.defaultCurrency` at `BrandPaymentsView.tsx:165-180`, `BrandPaymentsView.tsx:220-223`, and `BrandPaymentsView.tsx:388-427`.

Impact:

- Deploying `brand-stripe-balances` does not make the Payments KPIs correct because the UI does not read the hook.
- If wired as-is, the hook would throw `malformed payload` because the edge/client key names do not match.
- Stub GBP values can be displayed under a non-GBP brand currency.

Required fix:

- Align edge response shape with the frontend contract, or update the frontend to accept the deployed camelCase shape. Prefer snake_case if that was the documented service contract.
- Wire `useBrandStripeBalances` into `BrandPaymentsView`.
- Convert minor units to major units with currency-aware zero-decimal handling before display.
- Treat legacy stub payouts/refunds as explicit GBP, not brand default currency, unless replaced by real currency-bearing server rows.

### F-0769-R7 - Regression guard passed while missing the active bug surfaces

Severity: P1
File: `.github/scripts/strict-grep/orch-0769-app-wide-currency.mjs`

Evidence:

- `npm run test:orch-0769` passes: strict-grep plus 25 Jest tests all green.
- The guard allowlists any line containing `?? "GBP"` at `orch-0769-app-wide-currency.mjs:31-33`.
- It excludes common active legacy fields such as `totalGbpAtPurchase`, `totalGbpAtSale`, `refundedAmountGbp`, `unitPriceGbpAtPurchase`, and `unitPriceGbpAtSale` from violation detection.
- It allowlists all of `src/types/brand.ts`, where the stale GBP-only brand finance contract still lives.

Impact:

- The current gate validates mapper/publish happy paths, but not finance, payments, event detail, door reconciliation, full reconciliation, or wizard fallbacks.
- The green test result is not evidence that the operator-visible currency issue is fixed.

Required fix:

- Add semantic tests, not just grep:
  - Non-GBP brand finance reports do not repaint GBP stubs as brand currency.
  - Event detail excludes or flags order/sale rows whose currency differs from event currency.
  - Door and full reconciliation detect mixed currencies.
  - Wizard Step 5/7 use brand default currency when draft currency is null.
  - Payments hook/service/edge response shape round-trips.
- Tighten strict-grep to forbid active `?? "GBP"` fallback in money UI unless wrapped in a named helper with documented legacy behavior.

## Surfaces probed

| Surface | Current status |
| --- | --- |
| Stripe onboarding DB propagation | Mostly fixed by migration/trigger; DB push succeeded. |
| Stripe refresh edge | Deployed; needs runtime proof but static code aligns with trigger path. |
| Stripe balances edge | Broken integration contract: edge camelCase vs service snake_case; UI not wired to hook. |
| Brand finance reports | Broken. Sums `revenueGbp` / `amountGbp`; formats with `brand.defaultCurrency`. |
| Brand payments | Broken/transitional. Stub GBP fields formatted as brand currency; live hook unused. |
| Brand profile GMV | Risk. `brand.stats.rev` has no currency, formatted with `brand.defaultCurrency`. |
| Home live hero revenue | Risk. Uses `getRevenueForEvent` currencyless selector, formats with event/brand currency. |
| Events list cards | Risk. Same currencyless selector pattern. |
| Event detail KPI | Broken. Order revenue selector returns a number with no currency. |
| Event detail Door Sales tile | Broken. Door sale revenue returns a number with no currency. |
| Orders list/detail | Mostly row-currency-aware for display; upstream event summaries still unsafe. |
| Online checkout | Mostly okay for new hydrated events/tickets; cart prevents mixed currencies. Needs tests. |
| Door sale creation | Mostly uses event/ticket currency, but stale/local mismatches are not guarded before summaries. |
| Door reconciliation card | Broken. Sums all sale rows and formats as event currency. |
| Full reconciliation | Broken. Sums all orders/sales/refunds and formats as event currency. |
| CSV exports | Risk/broken. Row currency exists, summary currency can lie. |
| Event wizard Step 5/7 | Gap confirmed. Null draft currency falls back to GBP. |
| Server draft creation | Mostly fixed. New server draft stamps brand default currency. |
| Legacy/local draft migration | Gap confirmed. Migrated drafts remain null and UI falls back to GBP. |
| Strict-grep/test gate | Inadequate. Passes while major active bugs remain. |

## Root cause synthesis

ORCH-0769 fixed schema propagation and some row-level display plumbing, but it did not establish a universal money model in the business app.

The app still has three incompatible concepts:

1. Legacy field names whose comments say GBP.
2. New `currency` fields on events/orders/sales/tickets.
3. Summary components that accept only a bare number.

Any summary that accepts only `number` cannot be trusted once Mingla supports non-GBP or mixed historical/current records.

## Rework implementation contract

### Required model helpers

Create a small currency summary utility and use it across event/detail/door/reconciliation/finance:

- `normalizeCurrency(value): string`
- `moneyAmount(record): { amount: number; currency: string; source: "order" | "door" | "refund" | "legacy" }`
- `summarizeMoney(records, expectedCurrency): { expectedTotal, byCurrency, mismatches, currenciesPresent }`

Rules:

- Rows with explicit `currency` use that currency.
- Legacy rows with missing currency and only `*Gbp` fields are GBP.
- Single-currency UI may show one formatted total only when all included rows match the expected currency.
- Mixed-currency UI must group by currency or show a blocking warning; no silent conversion.
- Do not convert FX. There is no exchange-rate system in scope.

### Required UI behavior

- Event detail KPI: show event-currency revenue only; warn on mismatched order currencies.
- Door tile/card: show event-currency door revenue only; warn on mismatched sale currencies.
- Door reconciliation: add mismatch warning and exclude mismatches from event-currency net, or group by currency.
- Full reconciliation: add `currenciesPresent`, `currencyMismatches`, grouped revenue/refunds, and honest copy.
- Finance reports: replace brand stubs or group them as explicit GBP until real server finance rows exist.
- Payments: wire live Stripe balance query; do not render stub GBP rows as brand currency.
- Wizard: use effective draft currency from draft first, then current brand default, then GBP fallback only as last-resort legacy.

### Required tests

Add tests before close:

- `buildReconciliationSummary` with one USD event, one USD order, one GBP stale order: mismatch detected; USD total excludes/states mismatch.
- Door reconciliation helper with CAD event and GBP stale door sale: mismatch detected.
- `getRevenueForEvent` replacement returns `{ total, currency, mismatches }`, not just number.
- Wizard Step 5/7 with `draft.currency=null` and brand default `USD` renders USD.
- Finance report with GBP stubs under CAD brand does not show CAD total.
- `brand-stripe-balances` edge/client contract test for response field names.

### Deployment/retest gates

- Re-run `npm run test:orch-0769` after adding semantic tests; old pass is insufficient.
- Run `npx tsc --noEmit`.
- Deno check `brand-stripe-balances` if response shape changes.
- Runtime QA must cover a non-GBP brand after Stripe onboarding:
  - create new event draft,
  - wizard Step 5/7 prices,
  - publish event,
  - checkout order,
  - order row/detail,
  - event detail revenue,
  - door sale,
  - door reconciliation,
  - full reconciliation,
  - finance reports/payments.

## Verification performed in this investigation

Static investigation:

- Broad `rg` sweep over `mingla-business/src`, `mingla-business/app`, `supabase/functions`, `supabase/migrations`, `.github/scripts/strict-grep`, and ORCH-0769 artifacts.
- Targeted reads of finance, payments, checkout, order, door, reconciliation, draft, event, and Stripe balance paths.

Automated check:

```bash
cd mingla-business && npm run test:orch-0769
```

Result: PASS, but this is a false confidence signal because the test set does not cover the failing surfaces above.

## Close decision

Do not close ORCH-0769. Dispatch implementor rework against this report.

The fix must be semantic and currency-aware across summaries, not a formatter sweep.
