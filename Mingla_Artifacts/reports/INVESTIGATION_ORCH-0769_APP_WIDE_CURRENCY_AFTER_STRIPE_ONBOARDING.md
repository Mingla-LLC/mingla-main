# INVESTIGATION ORCH-0769: App-wide currency after Stripe onboarding

Date: 2026-05-09
Role: Forensics
Status: ROOT CAUSE PROVEN - NOT READY FOR IMPLEMENTATION WITHOUT A CROSS-SURFACE SPEC
Severity: S1 High / Fix Now
Confidence: High

## Executive summary

The user report is confirmed. After a brand onboards to Stripe in a non-GBP country, Mingla records the Stripe account's country/currency in `stripe_connect_accounts`, but the rest of the business app mostly continues to use GBP.

This is not a single formatter bug. It is a split-source and legacy-currency-model bug:

1. Stripe onboarding writes `stripe_connect_accounts.default_currency`, but no trigger/function updates `brands.default_currency`. The app reads `Brand.defaultCurrency` from `brands.default_currency`, so the canonical UI brand object remains GBP.
2. Event ticket publishing still stores `ticket_types.currency = 'GBP'` and consumes draft `priceGbp`.
3. Checkout, orders, refunds, door sales, reconciliation, exports, and many event surfaces use GBP-only field names and formatters (`priceGbp`, `totalGbp`, `amountGbp`, `revenueGbp`, `formatGbp`, `currency: "GBP"`).
4. Only a narrow Brand Payments slice was partially converted to `formatCurrency`, and even that still depends on `brand.defaultCurrency`, which is not updated by Stripe onboarding.

Therefore a user can select/onboard as US/USD, CA/CAD, CH/CHF, or EEA/EUR/local currency and still see GBP on Home, Events, checkout, ticket tiers, orders, door sales, reconciliation, finance reports, and CSV exports.

## User-facing symptom

Expected:

- Brand selects a Stripe country during onboarding.
- The selected/Stripe-confirmed default currency becomes the brand/event commerce currency.
- App-wide money surfaces display and persist that currency consistently.

Actual:

- `stripe_connect_accounts.default_currency` can become `USD`, `CAD`, `EUR`, etc.
- `brands.default_currency` remains `GBP`.
- App-wide commerce paths keep rendering and persisting GBP.

## Investigation manifest

| Layer | Evidence checked | Result |
| --- | --- | --- |
| Product/docs | `README.md`, B2A/V3 specs and implementation reports, ORCH-0764C history | Multi-currency was intended, but only a narrow Stripe payments slice was implemented. |
| Schema/migrations | `brands`, `stripe_connect_accounts`, `ticket_types`, `orders`, `door_sales_ledger`, publish RPC | DB defaults and publish RPC still encode GBP. |
| Stripe edge functions | `brand-stripe-onboard`, `brand-stripe-refresh-status`, webhook router, balances | SCA receives currency; brand and app-wide contracts do not. |
| Business app code | brand hooks, mapping, event creator, checkout, orders, door, finance, public pages | GBP-only field names and formatters remain widespread. |
| Tests/guards | Jest tests, strict-grep context, historical reports | Existing tests assert GBP behavior; no non-GBP onboarding-to-display regression guard. |

Static grep found 308 references across app/schema/function code matching GBP-only currency markers (`formatGbp`, `priceGbp`, `amountGbp`, `totalGbp`, `currency: "GBP"`, etc.).

## Historical context

- The product constitution says currency display must use locale/currency plumbing, not hardcoded symbols (`README.md:65`).
- B2A Path C V3 introduced multi-country Stripe Connect and `stripe_connect_accounts.country/default_currency`.
- Session B only partially handled UI currency by adding `Brand.defaultCurrency` and converting a few `BrandPaymentsView` KPI/row calls to `formatCurrency`.
- `IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_V3_SUB_C_FINAL_REPORT.md` explicitly warned that `amountGbp` semantics were still wrong and real fix required carrying currency in storage.
- ORCH-0764C fixed Stripe country replacement/status visibility, not app-wide currency propagation.

## Root cause proof

### Root cause 1 - Stripe currency is not propagated to `brands.default_currency`

Finding type: Confirmed bug / invariant violation
Primary owner boundary: Supabase migrations + Stripe edge functions

Evidence:

- `brand-stripe-onboard` reads the brand row including `default_currency` but does not use it to update brand currency. It computes `defaultCurrency = defaultCurrencyForCountry(country)` and upserts only `stripe_connect_accounts.default_currency` (`supabase/functions/brand-stripe-onboard/index.ts:346-415`).
- The original SCA-to-brand trigger mirrors only Stripe account id and enabled flags into `brands` (`supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql:101-115`).
- The later detach-aware trigger replacement still mirrors only `stripe_connect_id`, `stripe_charges_enabled`, and `stripe_payouts_enabled` (`supabase/migrations/20260510000001_b2a_path_c_trigger_detach_cascade.sql:36-44`).
- V3 migration adds `stripe_connect_accounts.default_currency` and comments that it drives KPI tile formatting, but does not add propagation to `brands.default_currency` (`supabase/migrations/20260511000001_b2a_v3_country_support.sql:26-42`, `:91-92`).
- App brand reads come from `brands.select("*")` and `mapBrandRowToUi`, which maps `Brand.defaultCurrency` from `row.default_currency || "GBP"` (`mingla-business/src/services/brandsService.ts:168-178`, `mingla-business/src/services/brandMapping.ts:237-240`).
- `useBrandStripeStatus` invalidates brand queries after `stripe_connect_accounts` updates, but that only refreshes `brands.default_currency`; because it was never updated, the refreshed brand remains GBP (`mingla-business/src/hooks/useBrandStripeStatus.ts:56-75`).

Causal chain:

`Stripe country selected` -> `stripe_connect_accounts.default_currency = USD/EUR/etc.` -> trigger/webhook do not update `brands.default_currency` -> `getBrand()` returns brand row still `GBP` -> `Brand.defaultCurrency` remains `GBP` -> even currency-aware UI formats GBP.

Missing guard:

- No test proves onboarding in a non-GB country updates `brands.default_currency`.
- No migration/static guard proves the SCA trigger mirrors default currency when connected.

### Root cause 2 - Event publishing hardcodes ticket currency to GBP

Finding type: Confirmed bug / data contract violation
Primary owner boundary: Event draft/publish pipeline

Evidence:

- Draft ticket type names money as `priceGbp`; comment says positive number in GBP whole-units (`mingla-business/src/store/draftEventStore.ts:78-82`).
- Client ticket mapper converts `priceGbp` to cents and writes `currency: "GBP"` (`mingla-business/src/services/ticketTypeMapper.ts:3-17`).
- Server publish RPC validates JSON field `priceGbp` and inserts `ticket_types.currency` as literal `'GBP'` (`supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql:157-168`, `:252-286`).
- Test coverage asserts this behavior: `eventDraftsPublishTickets.test.ts` expects `currency: "GBP"` (`mingla-business/src/services/__tests__/eventDraftsPublishTickets.test.ts:29-40`).

Causal chain:

`Brand/Stripe currency != GBP` -> creator enters ticket price -> draft stores `priceGbp` -> publish writes `ticket_types.currency = 'GBP'` -> public/buyer/event surfaces derive GBP ticket economics.

Missing guard:

- No publish test for a USD/EUR/CAD brand.
- Publish RPC has no brand currency lookup or parameter.

### Root cause 3 - Checkout, order, refund, and door-sale snapshots are GBP-only

Finding type: Confirmed bug / persistence model violation
Primary owner boundary: buyer checkout and organiser commerce stores

Evidence:

- `OrderRecord` stores `unitPriceGbpAtPurchase`, `totalGbpAtPurchase`, `refundedAmountGbp`, `RefundRecord.amountGbp`, and `currency: "GBP"` (`mingla-business/src/store/orderStore.ts:57-112`).
- Checkout confirmation persists `currency: "GBP"` and GBP price snapshots into `recordOrder` (`mingla-business/app/checkout/[eventId]/confirm.tsx:168-175`).
- `DoorSaleRecord` stores `unitPriceGbpAtSale`, `totalGbpAtSale`, `refundedAmountGbp`, `DoorRefundRecord.amountGbp`, and `currency: "GBP"` (`mingla-business/src/store/doorSalesStore.ts:48-100`).
- Door sale creation persists `currency: "GBP"` (`mingla-business/src/components/door/DoorSaleNewSheet.tsx:271-278`).
- Cart state uses `unitPriceGbp`, `subtotalGbp`, and `totalGbp` (`mingla-business/src/components/checkout/CartContext.tsx:40-70`, `:225-245`).

Causal chain:

Even if ticket rows became multi-currency, checkout/order/door snapshots would still freeze money as GBP unless their contracts carry `{ amountMinor, currency }` or equivalent.

Missing guard:

- No checkout/order/door tests verify non-GBP order creation, refund display, or reconciliation.

### Root cause 4 - App-wide UI is still wired to GBP formatters and GBP field names

Finding type: Confirmed display bug / app-wide blast radius
Primary owner boundary: UI surfaces and shared currency utilities

Evidence examples:

- `formatGbp` and `formatGbpRound` hardcode locale `en-GB` and currency `GBP`; `formatCurrency` exists but is sparsely adopted (`mingla-business/src/utils/currency.ts:27-49`, `:78-112`).
- Home renders revenue with `formatGbpRound` (`mingla-business/app/(tabs)/home.tsx:359-402`).
- Event cards render revenue with `formatGbpRound(revenueGbp)` (`mingla-business/src/components/event/EventListCard.tsx:210-215`).
- Checkout pages render totals with `formatGbp`, and `PaymentElementStub` has an inline `Intl.NumberFormat(... currency: "GBP")` (`mingla-business/app/checkout/[eventId]/payment.tsx:311-395`, `mingla-business/src/components/checkout/PaymentElementStub.tsx:84-89`).
- Door and reconciliation screens render every method/refund/payout figure with `formatGbp` (`mingla-business/app/event/[id]/door/index.tsx:428-577`, `mingla-business/app/event/[id]/reconciliation.tsx:441-543`).
- CSV export prints `GBP` suffixes (`mingla-business/src/utils/guestCsvExport.ts:165-167`).
- Public brand and public event pages still derive "From ..." prices from `priceGbp` with `formatGbpRound` (`mingla-business/src/components/brand/PublicBrandPage.tsx:659-663`, `mingla-business/src/components/event/PublicEventPage.tsx:611-612`).
- Brand finance reports remain GBP-field based and hardcode GBP fee labels in surrounding financial logic (`mingla-business/src/components/brand/BrandFinanceReportsView.tsx`, grep evidence lines for `revenueGbp`, `amountGbp`, `formatGbp`).

This directly explains the user's "home page, events screen, etc. app wide" observation.

### Root cause 5 - Stripe refresh/status paths expose currency but do not persist it into the app-wide source

Finding type: Confirmed integration gap
Primary owner boundary: Stripe edge functions

Evidence:

- `brand-stripe-refresh-status` selects SCA `country/default_currency` and returns `account.default_currency ?? scaRow.default_currency`, but its update only writes `charges_enabled`, `payouts_enabled`, `requirements`, and `updated_at` (`supabase/functions/brand-stripe-refresh-status/index.ts:131-191`, `:236-247`).
- Webhook router writes `account.country` and `account.default_currency` back to `stripe_connect_accounts`, but the SCA trigger still does not propagate default currency to `brands` (`supabase/functions/_shared/stripeWebhookRouter.ts:148-170`).
- `brand-stripe-balances` reads `stripe_connect_accounts.default_currency` for balance filtering, but returns GBP when no account exists and does not repair brand currency (`supabase/functions/brand-stripe-balances/index.ts:43-61`).

Impact:

- Stripe status/balance surfaces may know the real currency, while brand/event/order surfaces remain GBP. This creates contradictory app state.

## Blast radius matrix

| Area | Current currency source | Failure mode |
| --- | --- | --- |
| Stripe onboarding | `stripe_connect_accounts.default_currency` | Correctly written, isolated from brand/app currency. |
| Current brand | `brands.default_currency` via `mapBrandRowToUi` | Remains GBP after onboarding. |
| Home | `revenueGbp`, `formatGbpRound` | Shows GBP revenue. |
| Events list/detail | `revenueGbp`, `priceGbp`, `formatGbp` | Shows GBP event/ticket/revenue data. |
| Event creator/publish | draft `priceGbp`; RPC literal `'GBP'` | Persists GBP ticket rows. |
| Public event/brand | `priceGbp`, `formatGbpRound` | Buyer-facing ticket prices show GBP. |
| Checkout/payment | `unitPriceGbp`, `totalGbp`, inline GBP formatter | Buyer pays/sees GBP in stub flow. |
| Orders/refunds | `currency: "GBP"`, `amountGbp` | Snapshots/refunds permanently GBP. |
| Door sales | `currency: "GBP"`, `totalGbpAtSale` | In-person sales permanently GBP. |
| Reconciliation/CSV | GBP formatters and `GBP` CSV suffixes | Export and ops reporting wrong for non-GBP brands. |
| Brand payments | Partial `formatCurrency(brand.defaultCurrency)` | Still wrong because `brand.defaultCurrency` remains GBP; amounts still named `amountGbp`. |

## Fix requirements

This must be fixed as a cross-surface currency contract, not a blind formatter replacement.

Required implementation direction:

1. Decide and codify the canonical brand commerce currency:
   - Recommended: `brands.default_currency` is the app-wide commerce currency; Stripe SCA currency updates it only when safe.
   - `stripe_connect_accounts.default_currency` remains Stripe account/account-balance metadata.
2. On successful Stripe account create/replacement, update `brands.default_currency` to the selected/default country currency in the same trusted server-side operation.
3. Update SCA trigger/webhook/refresh semantics so currency changes are not silently stranded in SCA.
4. Thread currency into event drafts and publish:
   - Replace or alias `priceGbp` with currency-neutral ticket amount naming.
   - Publish `ticket_types.currency` from the brand/event currency, not literal `'GBP'`.
5. Preserve immutable financial snapshots correctly:
   - Orders, refunds, door sales, reconciliation, and exports must store/render the transaction currency at purchase/sale/refund time.
   - Avoid relabeling old GBP amounts as a new currency after a brand changes/reconnects.
6. Update UI call sites from `formatGbp`/`formatGbpRound` to `formatCurrency`/`formatCurrencyRound` with a real currency source.
7. Add strict-grep/static guards for new GBP regressions, with explicit legacy/test exemptions only where intentional.
8. Add regression tests for at least USD and EUR:
   - onboarding updates brand currency;
   - event publish writes ticket currency;
   - Home/Event/checkout/order/door/reconciliation display and snapshots use the correct currency.

## Data migration notes

- Existing `brands.default_currency = 'GBP'` rows should remain GBP unless there is a connected SCA row proving a non-GBP default currency.
- Backfill candidate:
  - For active/non-detached `stripe_connect_accounts` rows, if `brands.default_currency = 'GBP'` and `stripe_connect_accounts.default_currency != 'GBP'`, update `brands.default_currency` to SCA default currency after product approval.
- Existing orders/door sales/tickets with GBP field contracts need compatibility handling. Do not relabel historical `amountGbp`/`totalGbp` snapshots as another currency.
- Future event ticket rows should store the brand/event currency at publish time.

## Tests and verification performed

Performed:

- Static code/schema search across `mingla-business/app`, `mingla-business/src`, `supabase/functions`, and `supabase/migrations`.
- Direct reads of onboarding, refresh, webhook, balance, brand mapping/hooks, event publish, checkout, order, door sale, UI formatter, and tests.
- Historical artifact review for B2A Path C V3 and ORCH-0764C.

Not performed:

- No Supabase mutation/prod probing.
- No Stripe API calls.
- No product-code changes.
- No Jest run; this investigation is static/source-proof based. Existing tests were inspected and currently encode GBP assumptions.

## Production readiness verdict

Not ready to ship multi-country Stripe onboarding as a trustworthy commerce experience.

The system can create a non-GBP Stripe account, but the app-wide commerce model remains GBP-first. That creates direct customer trust risk: organisers see the wrong currency, buyers may see/pay the wrong labeled currency in app surfaces, and financial exports/reconciliation can misstate money.

## Recommended next lifecycle

Dispatch implementor only after a spec is written for ORCH-0769. The spec should require a currency source-of-truth migration, app-wide call-site conversion, immutable snapshot handling, and strict regression tests. This is too broad for a one-file hotfix.
