# Spec: App-wide currency after Stripe onboarding (ORCH-0769)

> Date: 2026-05-09
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`
> Orchestrator review: `Mingla_Artifacts/reports/REVIEW_FORENSICS_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`
> Root cause: `RC-0769`
> Status: ready for implementation after orchestrator review

## 1. Summary

Mingla Business must stop treating GBP as the hidden global commerce currency after Stripe onboarding. The app already lets a brand choose a Stripe country whose default currency may be USD, CAD, EUR, CHF, PLN, etc.; the current code records that currency in `stripe_connect_accounts`, but the rest of the app mostly keeps reading, writing, and formatting GBP.

This spec makes `brands.default_currency` the app-wide brand commerce default, propagates safe Stripe account currency into that field, gives events/tickets their own immutable published currency, and updates checkout/order/door/refund/reconciliation/export/display contracts so future money is labeled with its actual ISO currency. Existing historical GBP records must remain GBP; the implementation must not relabel old GBP amounts as a new currency.

Verdict: implementation-ready. No operator decision is required before implementation. The implementor must still re-check local and linked remote migration heads before creating the migration.

## 2. User Story

As an organiser, I want the currency I selected during Stripe onboarding to become the currency Mingla uses across my business app, so ticket prices, checkout totals, revenue, refunds, reconciliation, and exports match the country/currency Stripe will settle for my brand.

As a buyer, I want public event pages, checkout, order receipts, and refund copy to show the correct currency for the event I am buying from, so I am not misled by a pound sign on a USD/EUR/CAD event.

As an operator, I want historical GBP transactions to stay GBP even after a brand connects a non-GBP Stripe account, so Mingla never rewrites financial history by changing a label.

## 3. Current Proven Root Causes

| ID | Root cause | Evidence |
| --- | --- | --- |
| RC-0769-A | Stripe onboarding writes currency to `stripe_connect_accounts.default_currency`, but no trusted path updates `brands.default_currency`. | `brand-stripe-onboard`, SCA trigger, `brandMapping`, and `useBrandStripeStatus` chain in the investigation. |
| RC-0769-B | Event publish hardcodes `ticket_types.currency = 'GBP'` and drafts use `priceGbp`. | `ticketTypeMapper.ts`, `draftEventStore.ts`, and `20260515000004_orch_0763_event_system_regression_repair.sql`. |
| RC-0769-C | Checkout/order/refund/door snapshots freeze `currency: "GBP"` and `*Gbp` amounts. | `CartContext.tsx`, `orderStore.ts`, `doorSalesStore.ts`, checkout confirm, door sale sheet. |
| RC-0769-D | App-wide displays and exports still call GBP-only helpers and use GBP-named data. | Home, Events, public pages, checkout, orders, guests, door, reconciliation, finance, CSV export. |
| RC-0769-E | Stripe refresh/webhook paths expose/update SCA currency but not the app-wide brand currency. | `brand-stripe-refresh-status`, `stripeWebhookRouter`, `brand-stripe-balances`. |

## 4. Canonical Currency Contract

### Brand default currency

`brands.default_currency` is the canonical brand commerce default used by Mingla Business for future pricing and brand-level zero/empty/comparison states.

Rules:

1. The value is an uppercase ISO 4217 currency code.
2. It defaults to `GBP` only before a brand has selected or completed a non-GBP Stripe country.
3. When Mingla creates or safely replaces a Stripe connected account for a brand, the selected country's default currency updates both:
   - `stripe_connect_accounts.default_currency`
   - `brands.default_currency`
4. `stripe_connect_accounts.default_currency` remains Stripe account metadata. It is not the value UI components should read for app-wide brand pricing/display.
5. Client brand reads continue to map `Brand.defaultCurrency` from `brands.default_currency`.

### Event and ticket currency

Published event ticket pricing is immutable per event/ticket publication state.

Rules:

1. Add or expose an event-level commerce currency, `events.currency`, for organiser/public event reads.
2. New server drafts start with the current brand `default_currency`.
3. Publishing a draft sets:
   - `events.currency = brand.default_currency` unless the draft already has a valid explicit currency.
   - every inserted `ticket_types.currency = events.currency`.
4. Public/business event mappers expose ticket/event currency to UI and checkout.
5. Published ticket rows keep their stored `ticket_types.currency`; later brand currency changes do not relabel already published prices.
6. Mixed-currency events are prohibited for new writes. All ticket types for an event must share `events.currency`.

### Transaction snapshot currency

Orders, refunds, door sales, and reconciliation must render from the transaction/event currency frozen at purchase/sale time.

Rules:

1. New checkout order snapshots carry `currency: string`, not the literal `"GBP"`.
2. New door sale snapshots carry `currency: string`, not the literal `"GBP"`.
3. Line and aggregate amount field names should become currency-neutral for new types:
   - `unitPriceAtPurchase`, `totalAtPurchase`, `refundedAmount`
   - `unitPriceAtSale`, `totalAtSale`
4. Backward-compatible readers may accept legacy `*Gbp` fields but must treat them as GBP-only legacy records.
5. Refund records inherit and preserve their parent order/sale currency.
6. Brand-level totals that encounter more than one currency must not silently sum and render one symbol. They must group by currency or show an honest mixed-currency state.

## 5. Data / Schema Changes

### Migration

Create a new monotonic migration after re-checking local and linked remote migration heads.

Observed during this spec:

- Local max: `20260515000008_orch_0767_public_brand_profile_view.sql`
- Linked remote max from read-only `supabase migration list --linked`: `20260515000008`

Required implementor action:

- Re-run both checks before writing the migration.
- Use a prefix greater than both, expected next prefix if still current:
  - `20260515000009_orch_0769_app_wide_currency.sql`

### SQL requirements

The migration must be additive and safe.

Required changes:

1. Add `events.currency char(3) NOT NULL DEFAULT 'GBP'`.
2. Backfill `events.currency`:
   - If active/non-deleted `ticket_types` for the event all have the same `currency`, use that currency.
   - Else use the owning brand's `default_currency`.
   - Else fall back to `GBP`.
3. Add a CHECK constraint on `events.currency` using the same 34-country/default currency universe already represented by the Stripe supported countries constants and `stripe_connect_accounts` default currency values. If a full currency allowlist exists in code but not DB, the migration may inline the current supported currency list:
   - `GBP`, `USD`, `CAD`, `CHF`, `EUR`, `BGN`, `CZK`, `DKK`, `HUF`, `ISK`, `NOK`, `PLN`, `RON`, `SEK`
4. Add a trigger/function guard so future `ticket_types` rows for an event match `events.currency`.
   - Function name suggestion: `public.tg_enforce_event_ticket_currency`.
   - Reject insert/update where `NEW.currency <> (SELECT currency FROM public.events WHERE id = NEW.event_id)`.
   - Allow legacy rows created before this migration to remain.
5. Replace `public.tg_sync_brand_stripe_cache` so, when `NEW.detached_at IS NULL`, it mirrors `NEW.default_currency` to `brands.default_currency` along with Stripe id/enabled flags.
6. Detach behavior:
   - Detaching an SCA row must clear Stripe cache fields as current code does.
   - Detach must not reset `brands.default_currency` to GBP. Currency remains the brand commerce default unless a future account replacement or explicit brand settings path changes it.
7. Add a one-time backfill from active/non-detached SCA rows:
   - For each brand with `stripe_connect_accounts.detached_at IS NULL` and SCA `default_currency IS NOT NULL`, set `brands.default_currency = stripe_connect_accounts.default_currency`.
   - This is safe because historical transaction currency will be frozen on event/order/door records; the brand default is only future/default state.
8. Add comments documenting:
   - `brands.default_currency` = brand commerce default.
   - `stripe_connect_accounts.default_currency` = Stripe account metadata.
   - `events.currency` = immutable event/ticket commerce currency for that event.

### RLS

No new tables are required.

RLS requirements:

- Existing `events` RLS must continue to govern reads/writes. Adding `events.currency` must not widen access.
- Existing `brands` RLS must continue to govern reads. Service-role edge functions/triggers remain the only trusted Stripe-to-brand currency sync path.
- No public view may expose private brand operational fields. Public event views may expose event/ticket currency because buyers need it.

### Rollback

Rollback is forward-compatible:

- Do not drop existing data during ordinary rollback.
- If a deploy rollback occurs, old code can ignore `events.currency`.
- Do not roll back the SCA-to-brand currency backfill unless a verified incident proves incorrect propagation.

## 6. Stripe Edge Function Changes

### `brand-stripe-onboard`

Path: `supabase/functions/brand-stripe-onboard/index.ts`

Required behavior:

1. On fresh account creation and safe incomplete-account replacement, compute `defaultCurrency = defaultCurrencyForCountry(country)`.
2. Upsert SCA with `country` and `default_currency` as today.
3. In the same trusted server-side flow, ensure `brands.default_currency` becomes `defaultCurrency`.
   - Preferred implementation: rely on the updated SCA trigger.
   - Acceptable explicit belt-and-suspenders update only if documented and tested; do not create two divergent rules.
4. Response can continue returning onboarding/account data. It may include `default_currency` if already present, but UI must not rely on this response alone for app-wide currency.
5. If a connected account is active/money-risk locked per ORCH-0764C and country change is refused, do not change `brands.default_currency`.

Error contract:

- If `country` is unsupported, retain existing validation behavior.
- If SCA upsert succeeds but brand currency sync fails, return structured failure and do not present onboarding as successful.

### `brand-stripe-refresh-status`

Path: `supabase/functions/brand-stripe-refresh-status/index.ts`

Required behavior:

1. When Stripe retrieve returns `account.country` and `account.default_currency`, persist both to SCA.
2. The updated SCA trigger must sync brand currency when the row is not detached.
3. Response should include current SCA/Stripe `country` and `default_currency` as now.
4. Status refresh must not override brand currency when the SCA row is detached.

### `stripeWebhookRouter`

Path: `supabase/functions/_shared/stripeWebhookRouter.ts`

Required behavior:

1. Existing `account.updated` sync already writes SCA `country/default_currency`.
2. After trigger update, webhook upserts must also update `brands.default_currency` for non-detached accounts.
3. Keep webhook idempotency and audit behavior intact.

### `brand-stripe-balances`

Path: `supabase/functions/brand-stripe-balances/index.ts`

Required behavior:

1. Continue filtering balances by SCA/brand default currency.
2. For no account/detached account, return brand default currency if available; do not hardcode GBP unless the brand row is unavailable or GBP is the brand default.
3. Preserve minor-unit response shape (`available_minor`, `pending_minor`, `currency`) expected by `brandStripeBalancesService`.

## 7. Event / Ticket Publish Changes

### Draft types and mapper

Files:

- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/services/ticketTypeMapper.ts`
- `mingla-business/src/services/eventDrafts.ts`

Required behavior:

1. Add a draft/event currency property:
   - Suggested: `currency: string` on `DraftEvent`.
   - Default new drafts to the current brand `defaultCurrency`.
   - Legacy drafts without currency hydrate as brand default when brand is known, else GBP.
2. Introduce currency-neutral ticket field naming for new code:
   - Suggested `price` or `priceMajor` instead of `priceGbp`.
   - Preserve legacy `priceGbp` hydration compatibility from stored draft JSON.
3. `draftTicketToTicketTypeInsert` must accept the event/draft currency and write `currency: draft.currency`, never literal GBP.
4. `syncDraftTicketsToServerEvent` must pass draft currency to mapper.
5. `serverDraftEventMapper` must persist draft currency inside `theme.business_draft` and hydrate it.

### Publish RPC

Migration function:

- `public.business_publish_event_draft` from `20260515000004_orch_0763_event_system_regression_repair.sql`

Required behavior:

1. Read the event's owning brand default currency inside the RPC.
2. Determine publish currency:
   - `v_currency = upper(p_draft_payload->>'currency')` if valid.
   - Else `brands.default_currency`.
   - Else `GBP`.
3. Update `events.currency = v_currency` during publish.
4. Insert `ticket_types.currency = v_currency`, not `'GBP'`.
5. Accept legacy draft payloads with `priceGbp`; prefer new `price`/`priceMajor` if present.
6. Validate that all ticket prices are non-negative and belong to the single publish currency.

### Event services

Files:

- `mingla-business/src/services/businessEvents.ts`
- `mingla-business/src/services/publicEventsService.ts`

Required behavior:

1. Select `events.currency` and `ticket_types.currency`.
2. Add event-level currency to the returned Live/Public event model.
3. Add ticket-level currency to ticket records or derive it from event currency when all tickets match.
4. Never convert money between currencies client-side.

## 8. Checkout / Order / Door / Refund / Reconciliation Changes

### Cart

File: `mingla-business/src/components/checkout/CartContext.tsx`

Required behavior:

1. Add `currency: string` to cart state and order result.
2. Rename new amount fields to currency-neutral names:
   - `unitPrice`
   - `subtotal`
   - `total`
3. Preserve compatibility helpers or aliases only where needed for incremental compile safety, but new call sites must use neutral names.
4. `setLineQuantity` must receive currency from the event/ticket context or assert that the cart currency matches the event currency.
5. Single-event cart remains single-currency; if a mismatch appears, fail visibly rather than mixing.

### Orders

File: `mingla-business/src/store/orderStore.ts`

Required behavior:

1. Update `OrderRecord.currency` to `string`.
2. Add currency-neutral fields for new records:
   - `unitPriceAtPurchase`
   - `totalAtPurchase`
   - `refundedAmount`
   - `RefundRecord.amount`
3. Legacy compatibility:
   - Existing persisted records with `currency: "GBP"` and `*Gbp` fields remain readable.
   - Selectors must normalize old and new records into a display model carrying `{ amount, currency }`.
4. Refunds inherit `order.currency`.
5. Do not mutate original line price/currency snapshots after purchase.

### Door sales

File: `mingla-business/src/store/doorSalesStore.ts`

Required behavior mirrors orders:

1. `DoorSaleRecord.currency: string`.
2. New neutral fields:
   - `unitPriceAtSale`
   - `totalAtSale`
   - `refundedAmount`
   - `DoorRefundRecord.amount`
3. Legacy `*Gbp` records normalize as GBP-only.
4. Door refunds inherit `sale.currency`.

### Checkout and door entry points

Files:

- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/checkout/[eventId]/buyer.tsx`
- `mingla-business/app/checkout/[eventId]/payment.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/src/components/checkout/PaymentElementStub.tsx`
- `mingla-business/src/components/door/DoorSaleNewSheet.tsx`
- `mingla-business/src/components/orders/RefundSheet.tsx`
- `mingla-business/src/components/door/DoorRefundSheet.tsx`

Required behavior:

1. Use event/ticket currency for every displayed total.
2. Persist order and door sale currency from event currency.
3. Payment stub accepts `total` and `currency`; no inline GBP formatter remains.
4. Refund sheets display and record refund amounts in parent order/sale currency.
5. Free orders/sales still show `Free`, not a zero-currency string, where current UX expects that.

### Reconciliation

Files:

- `mingla-business/src/utils/reconciliation.ts`
- `mingla-business/app/event/[id]/reconciliation.tsx`

Required behavior:

1. Event reconciliation is scoped to a single event currency.
2. If legacy data contains mixed currencies for one event, render an explicit mixed-currency warning and do not produce a single payout estimate.
3. Existing fee estimates must either:
   - calculate in the event currency using current hardcoded percentages/fees only when those fee constants are known valid for that currency, or
   - mark fixed-fee estimates as transitional/unavailable for non-GBP.
4. Do not show `£0.30`/`£0.20` fee copy on non-GBP events.

## 9. UI Display Changes

### Currency utility

File: `mingla-business/src/utils/currency.ts`

Required behavior:

1. `formatCurrency` and `formatCurrencyRound` become the active app-wide helpers.
2. `formatGbp` and `formatGbpRound` must be deprecated or moved behind explicit legacy/test usage.
3. Add helper(s) for normalized money objects if useful:
   - Suggested `Money = { amount: number; currency: string }`
   - Suggested `formatMoney(money, { rounded?: boolean })`
4. Inline `Intl.NumberFormat(... currency: "GBP")` outside `currency.ts` is forbidden.

### Required surface conversions

Convert these surfaces to pass real currency:

- Home revenue and brand KPI tiles.
- Events list revenue strip.
- Event detail KPI cards, ticket type rows, and activity rows.
- Creator Step 5 ticket totals and Step 7 preview price line.
- Preview/public event ticket cards.
- Public brand "From ..." pricing.
- Checkout ticket/total/payment/confirmation screens.
- Order detail and buyer order page.
- Guest detail order/door/refund sections.
- Door sale list/detail/new/refund sheets.
- Reconciliation screen.
- Brand Payments view.
- Brand Finance Reports view.
- Account deletion preview revenue labels if it shows commerce totals.
- Styleguide/demo values only if active strict-grep would otherwise fail; demo GBP may be explicitly allowlisted.

Currency lookup rules:

1. Event/ticket screens use event/ticket currency.
2. Brand-level empty/current/future states use `brand.defaultCurrency`.
3. Order/refund/door/receipt screens use transaction snapshot currency.
4. Exports use row-level transaction currency.

## 10. Export / CSV Changes

File: `mingla-business/src/utils/guestCsvExport.ts`

Required behavior:

1. CSV headers and comments must include a currency column or per-row currency value.
2. Replace hardcoded `GBP` suffixes with row/event currency.
3. If a CSV section contains multiple currencies, either:
   - group subtotal comments by currency, or
   - omit single net/gross comments and include a warning line.
4. Numeric amount cells may remain plain decimal strings, but each amount row must carry currency in an adjacent column.
5. Legacy GBP rows must export as GBP.

## 11. Backfill And Historical Data Rules

### Brand default currency backfill

The migration may update `brands.default_currency` from active/non-detached `stripe_connect_accounts.default_currency`.

Safe rule:

```text
For each brand:
if active SCA exists and SCA.default_currency is non-null:
  brands.default_currency = upper(SCA.default_currency)
else:
  leave brands.default_currency unchanged
```

Reason: `brands.default_currency` is future/default state. It is not the historical transaction currency.

### Event currency backfill

Backfill `events.currency` from ticket rows where possible:

1. If active/non-deleted ticket rows for an event all share one currency, use that.
2. Else use brand default.
3. Else GBP.

### Historical transactions

Rules:

1. Existing persisted Zustand orders/door sales with `currency: "GBP"` remain GBP.
2. Existing `*Gbp` amount fields are interpreted as GBP only.
3. Do not run a migration or client hydration transform that changes old order/sale/refund `currency` to the current brand default.
4. If old records lack `currency`, treat them as GBP and add defensive normalization only at read time.

## 12. Migration And Deploy Order

Required order:

1. Re-check migration heads:
   - `ls supabase/migrations | sort | tail`
   - `/Users/sethogieva/bin/supabase migration list --linked`
2. Add migration greater than local and remote max.
3. Run local SQL/static checks available in repo.
4. Run Deno checks/tests for touched Supabase functions.
5. Operator runs `supabase db push`.
6. After operator confirms DB push, deploy changed edge functions:
   - `/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv`
   - `/Users/sethogieva/bin/supabase functions deploy brand-stripe-refresh-status --project-ref gqnoajqerqhnvulmnyvv`
   - Deploy webhook function owner if `_shared/stripeWebhookRouter.ts` changes require redeploy of its caller.
   - Deploy `brand-stripe-balances` if changed.
7. Run business app tests and TypeScript.
8. Business web/mobile deployment:
   - JS-only business app changes may ship through the existing web deploy/OTA path.
   - No new native dependency is expected; if implementor adds one, that is a spec deviation requiring orchestrator review.

## 13. Implementation Order

1. Schema/migration:
   - Add `events.currency`.
   - Add event/ticket currency enforcement.
   - Replace SCA trigger to sync `brands.default_currency`.
   - Backfill brand and event currency.
2. Edge functions:
   - Update onboarding/refresh/balances/webhook behavior around currency persistence.
   - Add Deno tests or source-level tests for non-GBP propagation.
3. Shared money/currency types:
   - Add currency-neutral money type helpers.
   - Update `currency.ts`.
4. Brand/event service models:
   - Map `Brand.defaultCurrency`, `LiveEvent.currency`, `PublicEvent.currency`, and ticket currency.
5. Draft/publish pipeline:
   - Add draft currency.
   - Rewrite ticket mapper and publish RPC tests.
6. Checkout/cart/order/door stores:
   - Add neutral fields and legacy normalization.
   - Preserve immutable historical GBP records.
7. UI surfaces:
   - Convert displays in the blast-radius list.
8. Reconciliation/export:
   - Add event/row currency and mixed-currency handling.
9. Tests and strict-grep:
   - Rewrite old GBP expectations.
   - Add ORCH-0769 strict-grep script and package script.
10. Verification/artifact report:
   - Implementation report with commands, migration/deploy notes, and residual risks.

## 14. Rollback Plan

Database rollback:

- Additive `events.currency` can remain if code rolls back.
- Trigger replacement can be reverted with `CREATE OR REPLACE FUNCTION` if it causes unintended brand currency updates.
- Do not delete backfilled currency values; instead, apply a corrective migration only if bad data is proven.

Edge rollback:

- Re-deploy prior function versions if onboarding/refresh regressions occur.
- If edge rollback happens while DB remains forward, old code ignores `events.currency` and may temporarily display GBP; mark as a launch blocker until forward app code redeploys.

Client rollback:

- Legacy normalization means old persisted GBP records remain readable.
- New records written with neutral fields must also preserve enough compatibility for current release readers. If not possible, implementation must bump persist versions with a backward-compatible migration.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
| --- | --- | --- | --- | --- | --- |
| T-0769-01 | Stripe US onboarding propagates app-visible currency | Brand with no connected account, onboard country `US` | SCA and `brands.default_currency` become `USD`; `getBrand` maps `defaultCurrency: "USD"` | Edge/schema/service | Deno/source test plus focused Jest for mapper |
| T-0769-02 | Stripe DE onboarding propagates EUR | Country `DE` | Brand default becomes `EUR`; UI formatter uses `€` | Edge/schema/UI | Jest/component or service test |
| T-0769-03 | Detach preserves brand default | Active USD brand SCA detached | Stripe cache clears; `brands.default_currency` remains `USD` | Migration/edge | SQL/Deno test |
| T-0769-04 | Publish writes ticket/event currency | Brand default `USD`, draft paid ticket `12.50` | `events.currency='USD'`; inserted `ticket_types.currency='USD'`; no literal GBP | RPC/service | Jest plus migration/static check |
| T-0769-05 | Legacy draft payload still publishes safely | Draft has `priceGbp`, no `currency` | Publishes using brand default; no crash | RPC/service | Jest |
| T-0769-06 | Public event exposes currency | USD event with ticket rows | Public page displays `$12.50`; service returns currency | Service/UI | Jest |
| T-0769-07 | Checkout records USD order | USD event checkout | Cart/order result/order store record `currency='USD'`; displays `$` | Cart/store/UI | Jest |
| T-0769-08 | Legacy GBP order remains GBP | Persisted old order with `totalGbpAtPurchase` | Order detail displays GBP and does not relabel | Store/UI | Jest |
| T-0769-09 | Door sale records EUR | EUR event door sale | Sale/refund store and UI use EUR | Store/UI | Jest |
| T-0769-10 | Reconciliation refuses mixed single-currency payout | Event has mixed legacy rows | Screen shows mixed-currency warning and no single payout estimate | Utility/UI | Jest |
| T-0769-11 | CSV includes row currency | USD order and GBP legacy order | CSV rows include currency; totals grouped or warning shown | Export | Jest |
| T-0769-12 | Brand Payments balance fallback no account | USD brand, no SCA | Balance endpoint returns currency `USD` with zero amounts | Edge | Deno test |
| T-0769-13 | Strict grep blocks active GBP regressions | Add active `formatGbp` or `currency: "GBP"` in app path | Guard fails unless allowlisted as legacy/test | Static | `npm run test:orch-0769` |
| T-0769-14 | Full focused business gate | Current repo after implementation | ORCH-0769 tests, ORCH-0763/0759 adjacent tests, TypeScript pass | Regression | Commands below |

Required commands:

```bash
cd mingla-business
npm run test:orch-0769
npm run test:orch-0763
npm run test:orch-0759
npx tsc --noEmit
```

If Supabase functions are touched, also run the relevant Deno checks/tests. The implementor must not ask the operator to run Deno gates for them.

## 16. Strict-Grep / Regression Prevention

Add a strict-grep script:

`/.github/scripts/strict-grep/orch-0769-app-wide-currency.mjs`

Add package script:

`mingla-business/package.json`

```json
"test:orch-0769": "node ../.github/scripts/strict-grep/orch-0769-app-wide-currency.mjs && npx jest eventDraftsPublishTickets.test businessEventsPublish.test publicEventsService.test serverDraftEventMapper.test"
```

The exact Jest list may expand, but it must include publish, public events, draft mapper, checkout/cart/order/door/reconciliation/export tests added or updated for this work.

Strict-grep must fail on active non-allowlisted occurrences of:

- `formatGbp(`
- `formatGbpRound(`
- inline `Intl.NumberFormat` with `currency: "GBP"`
- `currency: "GBP"` or `currency: 'GBP'` in active new-write paths
- `priceGbp`, `amountGbp`, `totalGbp`, `revenueGbp`, `unitPriceGbp` in active new contracts
- SQL literal `'GBP'` in active publish/write paths

Allowed categories must be explicit in the script:

- Historical artifact files under `Mingla_Artifacts/`.
- Migration comments or backfill defaults that intentionally preserve legacy GBP.
- Legacy normalization code that reads old `*Gbp` fields and treats them as GBP.
- Tests that assert legacy GBP records remain GBP.
- Styleguide/demo values only when clearly marked demo.

## 17. Non-Goals And Deferred Work

Non-goals:

- Real Stripe paid checkout / PaymentIntent / Checkout Session destination charges.
- New Stripe countries.
- Operator Stripe Dashboard configuration.
- Consumer app currency cleanup.
- Admin app finance/currency cleanup unless direct ORCH-0769 regressions are introduced.
- Full historical conversion of past GBP orders, door sales, or refunds.
- Manual brand settings page for changing currency after paid activity.

Deferred but should be registered if encountered:

- Brand billing country field and settings UX.
- Per-event currency override UI.
- Mixed-currency brand-level analytics beyond grouping/honest unavailable states.
- Region-specific Stripe/Mingla fee constants for reconciliation.

## 18. Handoff To Implementor

Implement ORCH-0769 as a source-of-truth and data-contract repair, not as a formatter sweep. Start with the schema/trigger/backfill migration and Stripe edge propagation so `brands.default_currency` becomes the app-visible commerce default, then thread event/ticket currency through publish, checkout/order/door snapshots, UI displays, reconciliation, exports, tests, and strict-grep. Preserve historical GBP records by normalizing legacy `*Gbp` fields as GBP only; never relabel them to the current brand currency.

Expected implementation report:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`

Required implementation report sections:

- Files changed.
- Migration name and migration head re-check evidence.
- Behavior before/after.
- Legacy data compatibility.
- Tests/commands run with exact output summary.
- Deploy requirements and edge functions requiring deployment.
- Residual risks or deferred follow-ups.
