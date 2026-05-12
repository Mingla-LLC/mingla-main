# SPEC — ORCH-0804: Stripe Tax Enablement on Ticket Checkout

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** [INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md](../reports/INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md) §F-01
**Dispatch:** [prompts/SPEC_ORCH-0804_STRIPE_TAX_ENABLEMENT.md](../prompts/SPEC_ORCH-0804_STRIPE_TAX_ENABLEMENT.md)
**Stripe docs verified:** https://docs.stripe.com/tax/tax-for-platforms (2026-05-12), https://docs.stripe.com/connect/supported-embedded-components (2026-05-12)

---

## 1. Scope

Enable **Stripe Tax** on every ticket Checkout Session creation in `supabase/functions/ticket-checkout-create/index.ts`, persist Stripe-side tax data on orders via webhook, render tax on the buyer confirmation, and surface a brand-side "Manage tax in Stripe Dashboard" CTA on the Payments tab.

Wave 4 part 1 of the ORCH-0801 brand-page campaign. Closes F-01 (tax + VAT completely unimplemented) for the **web Checkout Session path only** — the dominant paid-ticket route.

**Three layer touches in this SPEC:**

1. **Edge function** — add `automatic_tax[enabled]=true` + `automatic_tax[liability][type]=account` + `automatic_tax[liability][account]={CONNECTED_ACCOUNT_ID}` to the `stripeWeb.checkout.sessions.create` call at `ticket-checkout-create/index.ts:194-230`.
2. **Database** — new migration adds `orders.tax_amount_cents integer NOT NULL DEFAULT 0` + `orders.tax_calculation_id text`. Webhook router updates these from `checkout.session.completed.total_details.amount_tax` and `tax_calculation_reference`.
3. **Component** — buyer confirmation renders the tax line. Brand Payments tab gets a "Tax & registrations" CTA opening Stripe Express Dashboard via `createLoginLink`.

## 2. Non-goals

- **Native PaymentIntent path tax** — line 296-309 of `ticket-checkout-create/index.ts` creates a PaymentIntent for the RN Payment Sheet flow. PaymentIntent tax requires a pre-computed `tax_calculation_id` via separate `POST /v1/tax/calculations` call. Material complexity. **Deferred to ORCH-0804-A.** The web Checkout Session is the dominant paid path and the legally critical surface for now.
- **Free-ticket path** — `supabase/functions/_shared/ticketCheckout.ts` handles free tickets (no Stripe call). Tax is N/A. No changes.
- **Door-sale path** — cash/manual orders bypass Stripe entirely. Brand handles tax compliance on door sales themselves out-of-band. No changes.
- **Building a Mingla-side tax UI** — registrations + filing live in Stripe Dashboard. We do NOT build forms, store VAT numbers, or compute tax client-side. Banned by `I-PROPOSED-O` (no DIY WebView wrap of web Embedded Components).
- **`tax.transaction.created` webhook handling** — Stripe Tax emits this for filing. Stripe handles filing; our orders + finance reports source from `total_details.amount_tax` instead. Documented as a future follow-up.
- **Stripe Tax fee absorption** — Stripe Tax adds ~0.5% on top of regular Stripe fees, billed to the brand. We disclose this in the CTA copy; we do NOT subsidize.
- **Multi-currency tax math** — Stripe Tax handles currency natively. We pass our existing `currency` field; no change.
- **Buyer receipt email tax line** — Stripe Checkout's hosted receipt already shows tax breakdown. Our own `ticket-confirmation-dispatch` email touches order data; SPEC §6 adds an optional tax line to the email template but does not redesign it.
- **Old orders backfill** — `tax_amount_cents` defaults to 0 for historical orders. No migration retro-fetch.

## 3. Assumptions

- Brand has registered with Stripe Tax in at least one jurisdiction before tax is collected for buyers in that jurisdiction. **If the brand hasn't registered in the buyer's jurisdiction, Stripe returns tax = 0 — no error.** Documented Stripe behavior.
- Connected accounts are Accounts v2 with `controller.dashboard.type = "express"` (verified by orchestrator on 2026-05-12; see DECISION_LOG entry coming with this close).
- `stripeWeb.checkout.sessions.create` already passes `payment_intent_data.transfer_data.destination` (destination charge); Stripe Tax for Connect destination charges requires the new `automatic_tax.liability` field to designate the connected account as tax-liable.
- The `orders` table is owned by Mingla; the new `tax_amount_cents` + `tax_calculation_id` columns extend it. RLS already gates by brand membership (no policy changes needed).
- The webhook router at `_shared/stripeWebhookRouter.ts` already handles `checkout.session.completed`; we extend it, not replace.

---

## 4. Database layer

### 4.1 New migration: `supabase/migrations/20260530000000_orch_0804_orders_tax_columns.sql`

**Monotonic check:** latest is `20260529000001_orch_0805_brand_covers_lower_cap.sql`. New filename `20260530000000_...` is strictly greater. ✓

```sql
-- ORCH-0804 — Stripe Tax enablement on ticket Checkout Sessions.
-- Adds two columns to public.orders so the webhook router can persist
-- Stripe-side tax data when checkout.session.completed fires:
--   - tax_amount_cents: integer (NOT NULL DEFAULT 0) — Stripe's computed tax
--     in cents, sourced from session.total_details.amount_tax.
--   - tax_calculation_id: text (nullable) — Stripe's tax_calculation reference
--     for downstream reporting + audit trail.
--
-- Per ORCH-0804 SPEC §4.1. Establishes I-PROPOSED-BF
-- STRIPE_TAX_ENABLED_ON_CHECKOUT at the DB tier.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tax_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_calculation_id text;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_tax_non_negative CHECK (tax_amount_cents >= 0);

COMMENT ON COLUMN public.orders.tax_amount_cents IS
  'Stripe Tax amount collected on this order, in cents. Populated by stripeWebhookRouter from checkout.session.completed.total_details.amount_tax. Brand is merchant of record (Connect destination charge with automatic_tax.liability.type=account). ORCH-0804.';

COMMENT ON COLUMN public.orders.tax_calculation_id IS
  'Stripe tax_calculation reference (tc_...) for the order. NULL on historical orders predating ORCH-0804 + on free / door-sale orders. ORCH-0804.';

-- In-migration verification probe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'tax_amount_cents'
  ) THEN
    RAISE EXCEPTION 'ORCH-0804 verification probe failed: orders.tax_amount_cents missing';
  END IF;
END $$;

COMMIT;
```

**RLS:** no policy changes. `orders` RLS already gates by brand membership via the events.brand_id chain.

**Index:** no new index. `tax_amount_cents` is only ever read with the row, never aggregated standalone (Wave 5 finance reports query through Stripe webhooks + the orders row together).

---

## 5. Edge function layer

### 5.1 Modify `supabase/functions/ticket-checkout-create/index.ts`

**Site:** `stripeWeb.checkout.sessions.create` block at lines 194-230.

**Current params** (lines 197-227):

```ts
checkoutSession = await stripeWeb.checkout.sessions.create(
  {
    mode: "payment",
    currency,
    line_items: [...],
    payment_intent_data: {
      transfer_data: { destination: stripeAccountId },
      metadata: { ... },
    },
    customer_email: buyerEmail,
    success_url: ...,
    cancel_url: ...,
    metadata: { ... },
  },
  { idempotencyKey: ... },
);
```

**Add three top-level fields:**

```ts
checkoutSession = await stripeWeb.checkout.sessions.create(
  {
    mode: "payment",
    currency,
    line_items: [...],
    payment_intent_data: { ... unchanged ... },
    automatic_tax: {
      enabled: true,
      liability: {
        type: "account",
        account: stripeAccountId,
      },
    },
    customer_update: {
      address: "auto", // required for tax calculation
    },
    customer_email: buyerEmail,
    success_url: ...,
    cancel_url: ...,
    metadata: { ... },
  },
  { idempotencyKey: ... },
);
```

**Why each field:**

- `automatic_tax.enabled: true` — turns on Stripe Tax calculation
- `automatic_tax.liability.type: "account"` + `account: stripeAccountId` — designates the connected account as merchant of record (per Stripe Tax for Platforms doc; required for destination charges on Connect)
- `customer_update.address: "auto"` — Stripe Tax needs a buyer address for jurisdiction. `"auto"` lets Stripe Checkout collect + update the customer record from the form. Required when `automatic_tax.enabled` is true on Checkout Sessions

**Error handling:** Stripe returns 400 with `error.code = "tax_calculation_failed"` if the brand has misconfigured Tax Settings. Wrap the existing try/catch to surface a friendly error to the buyer: `"This event's organizer hasn't finished setting up tax — try again in a few minutes."` Log full Stripe error context for orchestrator triage. Do NOT fall back to a no-tax checkout — fail closed.

### 5.2 Modify `supabase/functions/_shared/stripeWebhookRouter.ts`

**Site:** `checkout.session.completed` handler (already exists; locate the `handleTicketCheckoutCompleted` / `handleCheckoutSessionCompleted` function — forensics will name the exact function during implementation).

**Add to the orders UPDATE / INSERT after the existing `total_cents` write:**

```ts
const taxAmountCents = Number(session.total_details?.amount_tax ?? 0);
const taxCalculationId = typeof session.tax_calculation === "string"
  ? session.tax_calculation
  : null;

// In the orders row write:
{
  // ... existing fields ...
  total_cents: ..., // unchanged
  tax_amount_cents: taxAmountCents,
  tax_calculation_id: taxCalculationId,
}
```

**Field sources from the Stripe Checkout Session object:**

- `session.total_details.amount_tax` — total tax in cents (integer). Always present on completed sessions when `automatic_tax.enabled=true`; `0` when no tax collected.
- `session.tax_calculation` — string reference like `tc_1ABC...`. Present on completed sessions with tax enabled. Used for downstream reporting + audit.

### 5.3 New audit slugs

Add to `mingla-business/src/utils/auditActionLabels.ts → KNOWN_STATIC_SLUGS`:

- `stripe_tax.checkout_enabled` — emitted once per brand by the edge function when the first tax-enabled session creates (idempotent via a check-and-set on `brands.tax_settings.first_enabled_at`)
- `stripe_tax.registration_link_opened` — emitted by the new `brand-stripe-tax-dashboard-link` edge function on each tap

Both with category `stripe_connect`, icon `bank`. Required by `I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE`.

### 5.4 New edge function: `supabase/functions/brand-stripe-tax-dashboard-link/index.ts`

Tiny function: validates the calling user is brand_admin+ on the requested brand, fetches `stripe_account_id` from `stripe_connect_accounts`, calls `stripe.accounts.createLoginLink(stripeAccountId)`, returns the URL. Mirror the shape of any existing `*-link` function in the codebase (forensics will identify during implementation; likely a tweak of `brand-stripe-onboard`).

`verify_jwt: true`. RAK with permissions `accounts:write` (createLoginLink scope) — operator creates this RAK and adds to Supabase secrets as `STRIPE_RAK_TAX_DASHBOARD_LINK`.

---

## 6. Service / hook / component layer

### 6.1 Buyer confirmation tax line

**File:** `mingla-business/src/store/cart/CartContext.tsx` — extend `OrderResult` type:

```ts
export interface OrderResult {
  orderId: string;
  total: string;
  totalGbp: number;
  tax: string | null;        // formatted display, e.g. "£20.00"; null when 0
  taxAmountCents: number;     // raw for math
  // ... existing fields ...
}
```

Wherever `OrderResult` is constructed from the post-checkout fetch (the confirmation flow's `useOrder(orderId)` hook or equivalent), populate from the orders row's new columns.

**File:** the buyer confirmation screen (`mingla-business/app/checkout/[eventId]/confirm.tsx` or wherever the confirmation renders) — render a tax line below the subtotal when `tax !== null && taxAmountCents > 0`:

```
Subtotal     £100.00
Tax (VAT)    £20.00     ← new
Total        £120.00
```

Use existing `formatCurrency` per Constitution #10.

### 6.2 Brand-side "Tax & registrations" CTA

**File:** `mingla-business/src/components/brand/BrandPaymentsView.tsx`

Add a new row in the Operations section (or wherever fits the existing IA — keep it near the Stripe-status banner):

```
[Bank icon] Tax & registrations              ›
            Manage tax registrations in Stripe Dashboard.
            Stripe Tax adds about 0.5% on top of Stripe fees.
            You're the merchant of record.
```

Tap handler calls a new hook `useBrandStripeTaxDashboardLink(brandId)` that invokes the new edge function and `Linking.openURL` on the returned URL. Same pattern as any other external-link CTA in the file.

**Loading state:** spinner on the row while the link generates.
**Error state:** toast "Couldn't open Stripe. Try again." Constitution #3 (no silent failures).

### 6.3 No other component layer changes

- Brand-side order-detail screen renders `total_cents` + refund amounts today. Adding a tax line is **out of scope** for this SPEC — handled in Wave 5 ORCH-0803 (finance reports).
- Confirmation email template (`ticket-confirmation-dispatch`) — out of scope. Stripe Checkout's hosted receipt already shows tax. Brand-side organiser email can be enriched in a future ORCH if requested.

---

## 7. Success criteria

1. **C-01** — Every new web Checkout Session in production is created with `automatic_tax.enabled=true`, `automatic_tax.liability.type="account"`, `automatic_tax.liability.account=<connected_account_id>`, and `customer_update.address="auto"`. Verified via Stripe Dashboard event log + strict-grep gate on edge function source.
2. **C-02** — `orders.tax_amount_cents` is populated from `session.total_details.amount_tax` for every paid order created after the deploy. Verified via Supabase MCP probe on post-deploy orders.
3. **C-03** — `orders.tax_calculation_id` is populated when present in the session payload, NULL otherwise. Verified by MCP probe.
4. **C-04** — Buyer who completes checkout for an event whose brand IS registered for Stripe Tax in the buyer's jurisdiction sees a tax line on the Stripe-hosted checkout page (Stripe-side behavior; we verify by visual smoke).
5. **C-05** — Buyer confirmation screen renders the tax line when `tax_amount_cents > 0`; renders without the tax line when `= 0` (no fabricated row). Constitution #9.
6. **C-06** — Brand-side Payments tab shows "Tax & registrations" CTA. Tapping it opens Stripe Express Dashboard in the device's default browser. Disclosure copy includes "Stripe Tax adds about 0.5%" + "You're the merchant of record".
7. **C-07** — A buyer paying for a brand that has NOT registered for Stripe Tax in the buyer's jurisdiction sees the existing checkout flow with `tax = 0`. No error. Constitution #3 (no silent failure — this is expected Stripe behavior, not an error).
8. **C-08** — Brand with misconfigured Tax Settings (e.g. registration submitted but pending) — Stripe returns a `tax_calculation_failed` error; buyer sees a friendly "organizer hasn't finished setting up tax" toast; the edge function returns HTTP 400 with structured error; no charge happens. Fail closed.
9. **C-09** — Free tickets (`_shared/ticketCheckout.ts` path) skip tax entirely. No `automatic_tax` params on the order side; `orders.tax_amount_cents = 0`.
10. **C-10** — Audit log shows `stripe_tax.checkout_enabled` once per brand (first paid checkout) and `stripe_tax.registration_link_opened` on every CTA tap. Slugs resolve to non-`other` category per I-PROPOSED-BD.
11. **C-11** — New migration `20260530000000_orch_0804_orders_tax_columns.sql` applies cleanly via `supabase db push --linked`. In-migration probe verifies both columns exist.
12. **C-12** — `tsc --noEmit` clean from `mingla-business/`. Jest auditActionLabels tests still 28/28 PASS (new slugs added to resolver). New jest tests for the buyer confirmation tax-line render path. Deno tests for the edge function changes (`deno check`, `deno test` on `ticket-checkout-create`).
13. **C-13** — Strict-grep gate `orch-0804-stripe-tax-enabled-on-checkout` PASSES locally with a negative-control smoke.
14. **C-14** — `event-cover-pexels-search` and all other unrelated edge functions are NOT touched (criterion C-20 of ORCH-0805 mirrors here for ORCH-0804: scope discipline).

---

## 8. Invariants

### Preserved

| Invariant | How |
|-----------|-----|
| Constitution #2 (one owner per truth) | Tax data sourced from Stripe → persisted to orders → read by UI. Single canonical source per order. |
| Constitution #3 (no silent failures) | `tax_calculation_failed` Stripe errors fail closed with friendly toast + structured error log |
| Constitution #9 (no fabricated data) | Tax line renders only when `tax_amount_cents > 0`. Zero-tax orders show no tax row. |
| Constitution #10 (currency-aware) | Tax rendered via existing `formatCurrency(amount, currency)`. Honors brand `defaultCurrency` automatically. |
| Constitution #13 (exclusion consistency) | Tax enabled in edge function (generation) AND consumed in webhook handler (serving). Same flag, same flow. |
| I-PROPOSED-AB CANONICAL_PIPELINE_ROUTING | SPEC dispatched via Claude `mingla-forensics`; canonical routing unchanged |
| I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE | New audit slugs added to `KNOWN_STATIC_SLUGS` + resolver. CI gate enforces |
| I-PROPOSED-O STRIPE-EMBEDDED-COMPONENTS-VIA-OFFICIAL-SDK-ONLY | We link OUT to Stripe Dashboard for tax UI; no WebView wrap |

### New invariant promoted DRAFT (flips ACTIVE on ORCH-0804 CLOSE)

**I-PROPOSED-BF STRIPE_TAX_ENABLED_ON_CHECKOUT**

**Rule:** Every `stripeWeb.checkout.sessions.create` call in `supabase/functions/ticket-checkout-create/index.ts` (and any future ticket-checkout edge functions) MUST pass:
- `automatic_tax.enabled: true`
- `automatic_tax.liability.type: "account"`
- `automatic_tax.liability.account: <connected_account_id>` (where the connected account is the destination of `transfer_data.destination`)
- `customer_update.address: "auto"` (or equivalent buyer-address-collection setting required by Stripe Tax)

Webhook handlers for `checkout.session.completed` MUST persist `total_details.amount_tax` to `orders.tax_amount_cents` and `tax_calculation` to `orders.tax_calculation_id`.

**Enforcement:** Strict-grep gate `orch-0804-stripe-tax-enabled-on-checkout` in `.github/workflows/strict-grep-mingla-business.yml`. Script at `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs`.

**Test:** new Deno test in `supabase/functions/ticket-checkout-create/index.test.ts` (or sibling) asserting the params are present in the call. Jest unit tests for the audit-slug resolver entries.

---

## 9. Strict-grep CI gate

New file: `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs`. Mirrors ORCH-0805 / ORCH-0806 registry pattern (one script + one job).

**Six checks:**

1. Migration file `*orch_0804*orders_tax_columns.sql` exists under `supabase/migrations/`.
2. Migration declares `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_amount_cents` (positive grep).
3. `ticket-checkout-create/index.ts` contains literal `automatic_tax:` AND `liability:` AND `account: stripeAccountId` (or equivalent variable name resolving to the connected account).
4. `ticket-checkout-create/index.ts` contains `customer_update:` with `address: "auto"`.
5. `_shared/stripeWebhookRouter.ts` references `total_details` AND `amount_tax` AND `tax_amount_cents` (proves the webhook persists tax).
6. `BrandPaymentsView.tsx` references `useBrandStripeTaxDashboardLink` (or equivalent hook name) AND the literal "merchant of record" appears in the file (disclosure copy enforcement).

Register the job in `.github/workflows/strict-grep-mingla-business.yml` directly below `orch-0805-brand-cover-overhaul`. Job name: `orch-0804-stripe-tax-enabled-on-checkout`. Display name: `"ORCH-0804: Stripe Tax enabled on Checkout Sessions (I-PROPOSED-BF)"`.

Negative control: removing `automatic_tax:` from the Checkout Session block must fire Check 3 with the exact missing-literal name.

---

## 10. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | UK buyer paying UK-registered brand | Brand registered for UK VAT; buyer in London buys £100 ticket | Stripe-hosted checkout shows "£100 + £20 VAT = £120"; orders.tax_amount_cents = 2000; tax_calculation_id starts with "tc_" | Full stack |
| T-02 | US buyer paying US-registered brand | Brand registered in NY; buyer in NY buys $100 ticket | Sales tax computed + shown; orders.tax_amount_cents matches | Full stack |
| T-03 | Buyer in jurisdiction where brand NOT registered | UK-only-registered brand; buyer in Berlin | Checkout proceeds; tax = 0; no error; orders.tax_amount_cents = 0 | Full stack |
| T-04 | Brand with broken Tax Settings | Mock Stripe error code `tax_calculation_failed` | Edge function returns 400 with `tax_setup_incomplete`; mobile UI shows friendly toast | Edge fn + UI |
| T-05 | Free ticket | Order with `total_cents=0` | No Stripe call; no `automatic_tax` params; `orders.tax_amount_cents=0` | Edge fn |
| T-06 | Buyer confirmation render with tax | Order row with `tax_amount_cents=2000`, currency GBP | Confirmation shows "Tax (VAT) £20.00" between subtotal and total | Component |
| T-07 | Buyer confirmation render without tax | Order row with `tax_amount_cents=0` | Confirmation shows subtotal + total only; no tax row (Const #9) | Component |
| T-08 | Brand taps "Tax & registrations" CTA | Brand_admin user | Edge function returns Stripe Express Dashboard URL; `Linking.openURL` fires; audit log captures `stripe_tax.registration_link_opened` | Hook + UI + audit |
| T-09 | Brand member (rank < 50) taps CTA | Non-admin user | RLS denies the edge function call with 403; toast surfaces "You don't have permission" | RLS + UI |
| T-10 | Audit-slug resolver | `resolveAuditActionLabel("stripe_tax.checkout_enabled")` | category `stripe_connect`, icon `bank`, non-`other` | Jest unit |
| T-11 | Strict-grep negative control | Remove `automatic_tax:` from edge fn | Check 3 fires with named diagnostic; restore returns to PASS | CI |
| T-12 | tsc | repo-wide | exit 0 | CI |
| T-13 | Jest | `npx jest auditActionLabels` | 28/28 PASS + new slug coverage | CI |
| T-14 | Deno check | `deno check supabase/functions/ticket-checkout-create/index.ts` | exit 0 | CI |
| T-15 | Deno test | `deno test supabase/functions/ticket-checkout-create/` | new test asserting `automatic_tax` params present | CI |
| T-16 | Migration apply | `supabase db push --linked` | applies cleanly; in-migration probe passes | Operator gate |

---

## 11. Implementation order

1. **DB migration first.** Write `supabase/migrations/20260530000000_orch_0804_orders_tax_columns.sql`. Implementor does NOT run `supabase db push`. State explicitly in the implementation report: "migration awaiting operator `supabase db push --linked`."
2. **Edge function — Checkout Session params.** Modify `ticket-checkout-create/index.ts:194-230` per §5.1. Add the four fields + the structured error handling for `tax_calculation_failed`.
3. **Edge function — webhook router.** Extend the `checkout.session.completed` handler in `_shared/stripeWebhookRouter.ts` per §5.2. Persist `total_details.amount_tax` + `tax_calculation` to orders row.
4. **New edge function** `brand-stripe-tax-dashboard-link` per §5.4. RAK + audit log + auth check.
5. **Audit slug resolver.** Add the two slugs to `mingla-business/src/utils/auditActionLabels.ts → KNOWN_STATIC_SLUGS` + resolver. Update tests to cover them (T-10).
6. **OrderResult type extension.** Update `mingla-business/src/store/cart/CartContext.tsx` + downstream consumers.
7. **Buyer confirmation tax line.** Component edit at the confirmation screen file (forensics identifies during implementation).
8. **Brand "Tax & registrations" CTA.** New hook + UI in `BrandPaymentsView.tsx`.
9. **Strict-grep gate.** Write `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` + register job in workflow.
10. **Local gates.** `npx tsc --noEmit` from `mingla-business/`, `npx jest auditActionLabels`, `deno check + deno test` on the touched edge functions, run the new strict-grep gate + negative-control smoke.
11. **Implementation report.** Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0804_STRIPE_TAX_ENABLEMENT.md` with old→new receipts, every C-01..C-14 mapped, migration-pending callout naming the exact `supabase db push` command for the operator, and Stripe live-fire smoke plan for the tester to run after migration applies.

---

## 12. Regression prevention

- **Class of bug being prevented:** silent tax non-collection on paid checkouts in regulated jurisdictions. Today, every paid ticket sale to a UK / EU / US-with-nexus buyer widens compliance debt. The strict-grep gate ensures any future refactor of `ticket-checkout-create` that drops the `automatic_tax` params fails CI before merge.
- **Structural safeguard:** the I-PROPOSED-BF invariant + 6-check strict-grep gate. The webhook persist path is gated too (Check 5) — so even if someone enables tax client-side but forgets to persist, CI catches it.
- **Test catching regression:** the Deno test on `ticket-checkout-create` (T-15) asserts the params are in the call payload at the source level. Unit-test grade enforcement that doesn't require a live Stripe call.
- **Protective comment** at the top of `ticket-checkout-create/index.ts` near the tax block: "I-PROPOSED-BF: every Checkout Session MUST pass `automatic_tax` + `liability` + `customer_update.address: auto`. Removing these silently disables tax collection in regulated jurisdictions — a legal exposure. See ORCH-0804 SPEC."

---

## 13. Hard guards for implementor

- **Stay scoped.** Only the files named in §5–§6 + §9. No other product code changes.
- **No `supabase db push`.** Implementor writes the migration file, lists it in "Migrations awaiting `supabase db push`" in the implementation report, and stops. Operator applies.
- **No `mcp__supabase__apply_migration`.** Prohibited.
- **No edge function deploys** until operator confirms the DB migration gate.
- **No client-side Stripe API calls.** All Stripe interaction stays in edge functions.
- **No new schema columns on events / ticket_types / order_line_items.** Tax lives on `orders` only per this SPEC.
- **No `automatic_tax` on the native PaymentIntent path** at line 296-309 of `ticket-checkout-create/index.ts`. That's ORCH-0804-A. Implementor leaves the PI block alone except for the protective comment.
- **No removal or modification of existing `transfer_data.destination`** in either checkout path. The tax-liability field is ADDITIVE — it sits alongside the existing destination charge.
- **No WebView wrap of Stripe Tax Settings web component.** Banned by I-PROPOSED-O. We link out via `createLoginLink`.
- **No assumption about brand registration state.** If `automatic_tax.enabled=true` but brand isn't registered for the buyer's jurisdiction, Stripe returns `tax = 0`. Document this in inline comments next to the tax-rendering code so future readers don't think it's a bug.
- **No tax math anywhere in client code.** Display strings only from server-provided `tax_amount_cents`. Constitution #9.
- **Currency-aware tax display.** Use `formatCurrency(taxAmountCents / 100, orderCurrency)` — never hardcode "£" or "$" in tax copy.

---

## 14. Expected implementor output

**File:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0804_STRIPE_TAX_ENABLEMENT.md`

Standard 15-section implementation report. Specifically must include:

- Old→New receipts for `ticket-checkout-create/index.ts`, `_shared/stripeWebhookRouter.ts`, new `brand-stripe-tax-dashboard-link/index.ts`, `auditActionLabels.ts`, `CartContext.tsx`, confirmation screen, `BrandPaymentsView.tsx`, new migration, new strict-grep script.
- Per-criterion C-01..C-14 verification table.
- Deno check + deno test output for the touched edge functions.
- Strict-grep PASS output with negative-control smoke evidence.
- "Migrations awaiting `supabase db push`" callout naming `20260530000000_orch_0804_orders_tax_columns.sql`.
- Stripe Dashboard manual verification plan (operator-runnable post-deploy): create one paid test event, complete a UK-VAT checkout, verify tax line on Stripe page + orders.tax_amount_cents populated.
- Operator action required for new RAK: `STRIPE_RAK_TAX_DASHBOARD_LINK` with permissions `accounts:write`. Implementor names this in the report; operator creates + sets the secret before tester smoke.

---

## Confidence

HIGH on:
- Stripe API param structure (verified directly against Stripe Tax for Platforms doc 2026-05-12)
- Schema additions (orders table is owned by Mingla, additive change, no RLS impact)
- Invariant + strict-grep gate design (mirrors proven ORCH-0805 / ORCH-0806 patterns)

MEDIUM on:
- The exact `customer_update.address: "auto"` parameter — confirmed required by Stripe docs for Checkout + automatic_tax combo, but implementor should verify against the live Stripe SDK type signature when writing
- The exact webhook field names (`session.total_details.amount_tax`, `session.tax_calculation`) — match Stripe docs at time of writing; implementor should grep the Stripe TypeScript types in `node_modules/stripe/types/2025-*.d.ts` for current names
- Buyer confirmation screen file path — forensics named it as `mingla-business/app/checkout/[eventId]/confirm.tsx` but implementor must confirm during implementation; if a different file owns the confirmation render, target that

LOW concerns (none).

---

**End of SPEC.**
