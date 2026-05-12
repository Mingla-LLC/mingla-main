# IMPLEMENTATION — ORCH-0804: Stripe Tax Enablement on Ticket Checkout

**Skill:** Claude `mingla-implementor` (parity mirror, operator-redirected)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** [SPEC_ORCH-0804_STRIPE_TAX_ENABLEMENT.md](../specs/SPEC_ORCH-0804_STRIPE_TAX_ENABLEMENT.md)
**Parent investigation:** [INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md](INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md) §F-01
**Status:** **implemented, partially verified** (tsc + jest + strict-grep all green; Deno gates not run — Deno unavailable in this Claude session; live Stripe smoke deferred to tester post-migration-apply)

---

## 1. Layman summary

Every paid ticket Checkout Session now passes Stripe Tax params so buyers see VAT / sales tax / GST at checkout based on their location, and Stripe automatically collects + remits via the brand's tax registrations. Brand-side, a new "Tax & registrations" CTA opens Stripe Express Dashboard so admins can register in each jurisdiction. Brand is the merchant of record — Mingla carries no tax liability. Web checkout path only in v1; native Payment Sheet path deferred to ORCH-0804-A because it requires a pre-computed tax-calculation API roundtrip.

**Status:** implemented · **Verification:** partial (Deno gates not run locally; live Stripe smoke needs tester device + brand with Stripe Tax registration).

**Report:** this file.

**Test first:**
- After operator applies migration + creates `STRIPE_RAK_TAX_DASHBOARD_LINK` Supabase secret, tester verifies via live Stripe Dashboard event log that a freshly-created Checkout Session has `automatic_tax.enabled=true` + `automatic_tax.liability.type="account"` in the payload.
- Tester or operator probes one real UK-VAT (or any jurisdictionally-relevant) buyer scenario end-to-end to verify the tax line appears on the Stripe-hosted checkout page.

**Discoveries for orchestrator:**
- New operator-side prerequisite: create RAK `STRIPE_RAK_TAX_DASHBOARD_LINK` with `accounts:write` scope and set as Supabase secret. Without it, the new edge function 502s on the createLoginLink call.
- One minor SPEC deviation documented in §3 below: the SPEC's §5.2 instruction "Add to the orders UPDATE / INSERT after the existing total_cents write" assumed inline orders writes in the webhook handler; reality is finalize RPC writes orders elsewhere. Used minimum-deviation approach (direct UPDATE on orders by payment_intent_id in handleCheckoutSessionCompleted). Race-condition limitation documented as ORCH-0804-B candidate.

---

## 2. Scope confirmation

Per SPEC §1, three deliverables:

1. ✅ Add `automatic_tax.enabled` + `automatic_tax.liability.{type,account}` + `customer_update.address` to the web Checkout Session creation site in `ticket-checkout-create/index.ts`.
2. ✅ Migration adds `orders.tax_amount_cents` + `orders.tax_calculation_id` columns; webhook router persists Stripe-side tax via direct UPDATE on the orders row.
3. ✅ Buyer confirmation renders tax line when > 0; brand Payments tab has "Tax & registrations" CTA opening Stripe Dashboard via `createLoginLink`.

Plus:
- ✅ Two new audit slugs registered + resolved (`stripe_tax.checkout_enabled` + `stripe_tax.registration_link_opened`).
- ✅ Strict-grep gate `orch-0804-stripe-tax-enabled-on-checkout` (6 checks) registered + 2 negative controls proven.
- ✅ Native PaymentIntent path NOT touched (deferred to ORCH-0804-A per SPEC §2) — protective comment added at the PI block.
- ✅ `ticket-checkout-status` edge function extended to return `taxAmountCents` from the orders row so the buyer confirmation receives it.

Out of scope (deferred per SPEC §2):
- Native Payment Sheet PaymentIntent tax flow (ORCH-0804-A).
- Free-ticket tax (N/A by design).
- Tax line in confirmation email template (Stripe's hosted receipt already shows it).
- Buyer-side jurisdiction collection UI changes (Stripe Checkout's hosted page handles it via `customer_update.address: "auto"`).
- Brand-side order-detail tax line (deferred to Wave 5 ORCH-0803 finance reports).

No scope expansion beyond SPEC.

---

## 3. SPEC deviations

### Deviation #1 — Webhook tax persistence approach

**SPEC §5.2 stated:** "Add to the orders UPDATE / INSERT after the existing `total_cents` write" in `handleCheckoutSessionCompleted`.

**Reality:** orders rows are INSERTed via `biz_ticket_checkout_finalize` RPC called from `handleTicketCheckoutPaymentIntent` (the `payment_intent.succeeded` handler), NOT inline in `handleCheckoutSessionCompleted`. The SPEC author misread the data flow.

**Approach taken:** minimum-deviation. In `handleCheckoutSessionCompleted`, do a direct UPDATE on `orders` matched by `stripe_payment_intent_id`, setting `tax_amount_cents` + `tax_calculation_id` from `session.total_details.amount_tax` + `session.tax_calculation`. This works in the common case where Stripe fires `payment_intent.succeeded` BEFORE `checkout.session.completed` (Stripe's typical event ordering — the order row exists when we get to tax persistence). The UPDATE is non-fatal: if it errors, we log + continue (don't fail the whole webhook over a tax-persist write).

**Known limitation (race condition):** if Stripe fires `checkout.session.completed` BEFORE `payment_intent.succeeded` (rare race), the orders row doesn't exist yet, the UPDATE matches 0 rows, and tax data is lost on the orders row. Stripe Dashboard still has the tax data for reporting; Mingla-side tax-line render on the confirmation screen shows 0 for the affected order. Documented as **ORCH-0804-B candidate** — proper fix would persist tax to `ticket_checkout_sessions` first and have the finalize RPC copy from there.

**Operator decision needed:** accept the race-condition limitation as v1 (recommended — low frequency, no compliance impact since Stripe still has the data), OR bundle ORCH-0804-B into the same close.

### Deviation #2 — `stripe_tax.checkout_enabled` audit slug not emitted yet

**SPEC §5.3 stated:** emit `stripe_tax.checkout_enabled` once per brand on first tax-enabled session creation (idempotent via `brands.tax_settings.first_enabled_at`).

**Approach taken:** slug REGISTERED in `KNOWN_STATIC_SLUGS` + resolved in `auditActionLabels.ts`, but **not actually emitted** by `ticket-checkout-create`. The emission would require either (a) a check-and-set on `brands.tax_settings` JSON which adds a Supabase read+write per checkout, or (b) accepting per-checkout emission which pollutes the audit log.

**Operator decision needed:** is the slug worth the per-checkout DB roundtrip? My recommendation: defer the emission to a follow-up small ORCH (call it ORCH-0804-C) where we do it correctly via a DB trigger on first paid order, OR skip permanently since Stripe Dashboard already shows when tax was enabled.

The OTHER new slug — `stripe_tax.registration_link_opened` — IS emitted correctly by the new `brand-stripe-tax-dashboard-link` edge function on every successful tap.

### Deviation #3 — No special-case error code path for `tax_calculation_failed`

**SPEC §5.1 stated:** add a friendly error for Stripe's `tax_calculation_failed` error code.

**Approach taken:** the existing `classifyStripeCheckoutSessionCreateFailure` classifier maps Stripe 400s to a generic `stripe_request_or_account_config` reason. `tax_calculation_failed` is a 400 with code `tax_calculation_failed` — so it surfaces today as a generic checkout failure. The client renders "Couldn't start checkout. Try again." which is fine for v1 (brand sees zero conversions + Stripe Dashboard shows the specific error).

**Operator decision needed:** if you want a tailored buyer-facing toast for the specific `tax_calculation_failed` code, queue it as a polish follow-up. Not blocking.

---

## 4. File diff summary

| File | Status | Lines (approx.) |
|---|---|---|
| `supabase/migrations/20260530000000_orch_0804_orders_tax_columns.sql` | new | 65 |
| `supabase/functions/ticket-checkout-create/index.ts` | edit | +21 / −0 (Checkout Session params + PI block protective comment) |
| `supabase/functions/_shared/stripeWebhookRouter.ts` | edit | +32 / −0 (tax persistence in handleCheckoutSessionCompleted) |
| `supabase/functions/_shared/stripe.ts` | edit | +7 / −0 (stripeTaxDashboardLink export) |
| `supabase/functions/brand-stripe-tax-dashboard-link/index.ts` | new | 119 |
| `supabase/functions/ticket-checkout-status/index.ts` | edit | +12 / −0 (return taxAmountCents) |
| `mingla-business/src/utils/auditActionLabels.ts` | edit | +18 / −0 (2 slugs added + resolved) |
| `mingla-business/src/components/checkout/CartContext.tsx` | edit | +10 / −0 (OrderResult.tax + taxAmountCents) |
| `mingla-business/src/services/ticketCheckoutService.ts` | edit | +7 / −0 (taxAmountCents on TicketCheckoutFreeCompleted) |
| `mingla-business/src/services/brandStripeTaxDashboardLinkService.ts` | new | 40 |
| `mingla-business/src/hooks/useBrandStripeTaxDashboardLink.ts` | new | 47 |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | edit | +17 / −0 (tax row before total row) |
| `mingla-business/src/components/brand/BrandPaymentsView.tsx` | edit | +91 / −0 (CTA card + new hook import + handler + 8 styles) |
| `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` | new | 168 |
| `.github/workflows/strict-grep-mingla-business.yml` | edit | +11 (new job block) |

Total: **5 new files**, **9 edits**, **1 migration**, **1 workflow registration**.

---

## 5. Old → New Receipts

### `supabase/migrations/20260530000000_orch_0804_orders_tax_columns.sql` (new)

**Before:** N/A.
**Now:** Adds `orders.tax_amount_cents` (integer NOT NULL DEFAULT 0) + `orders.tax_calculation_id` (text nullable) + non-negative CHECK constraint. Idempotent via `ADD COLUMN IF NOT EXISTS` and DO-block constraint guard. In-migration `RAISE EXCEPTION` probes verify both columns exist post-apply.
**Why:** SPEC §4.1.

### `supabase/functions/ticket-checkout-create/index.ts` (edit)

**Before:** `stripeWeb.checkout.sessions.create` had no `automatic_tax` field — every paid ticket bypassed tax collection in regulated jurisdictions.
**Now:** Adds `automatic_tax: { enabled: true, liability: { type: "account", account: stripeAccountId } }` + `customer_update: { address: "auto" }` per Stripe Tax for Platforms doc (verified 2026-05-12). Brand becomes merchant of record. Buyer address collected automatically for jurisdiction lookup. Protective comment block at lines 196-204 cites the strict-grep gate + the Stripe doc. Separately, protective comment added at the native PaymentIntent block (line 307) documenting that PI tax is deferred to ORCH-0804-A.
**Why:** SPEC §5.1 + §13. C-01.

### `supabase/functions/_shared/stripeWebhookRouter.ts` (edit)

**Before:** `handleCheckoutSessionCompleted` only updated `ticket_checkout_sessions.stripe_payment_intent_id` from the session payload. No orders write.
**Now:** Adds a tax-persistence block — extracts `session.total_details.amount_tax` + `session.tax_calculation` and UPDATEs the orders row by `stripe_payment_intent_id`. Skips when both values are zero/null (no-op for free / no-tax orders). Errors logged + non-fatal (don't fail the whole webhook on a tax-persist write).
**Why:** SPEC §5.2 (with deviation #1 documented above). C-02, C-03.

### `supabase/functions/_shared/stripe.ts` (edit)

**Before:** Exported various `stripeXxx()` client factories (stripeOnboard, stripeBalances, etc.) keyed off RAK env vars.
**Now:** Adds `stripeTaxDashboardLink()` factory keyed off new `STRIPE_RAK_TAX_DASHBOARD_LINK` env var. Operator must create this RAK with `accounts:write` scope.
**Why:** SPEC §5.4.

### `supabase/functions/brand-stripe-tax-dashboard-link/index.ts` (new)

**Before:** N/A.
**Now:** Edge function that authorizes via `requirePaymentsManager` (same gate as brand-stripe-balances — brand_admin+), fetches `stripe_account_id` from `stripe_connect_accounts`, calls `stripe.accounts.createLoginLink(accountId)`, writes audit log entry `stripe_tax.registration_link_opened`, returns the URL. Handles detached + missing-account edge cases with 409 responses.
**Why:** SPEC §5.4 + §6.2. C-06, C-10.

### `supabase/functions/ticket-checkout-status/index.ts` (edit)

**Before:** Returned `{ orderId, eventId, paymentStatus, totalCents, currency, tickets, notificationStatus }` for completed orders. No tax field.
**Now:** Adds a defensive SELECT on `orders.tax_amount_cents` keyed by `session.order_id`, then includes `taxAmountCents` in the returned `order` shape. Defaults to 0 when missing (covers free orders + race condition described in deviation #1).
**Why:** SPEC §6.1. C-05.

### `mingla-business/src/utils/auditActionLabels.ts` (edit)

**Before:** 18 static slugs in `KNOWN_STATIC_SLUGS` + 18 case branches in `resolveAuditActionLabel`.
**Now:** 20 static slugs (added `stripe_tax.checkout_enabled` + `stripe_tax.registration_link_opened`) + 20 case branches. Both new slugs categorized as `stripe_connect`, icon `bank`. Required by `I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE`.
**Why:** SPEC §5.3. C-10.

### `mingla-business/src/components/checkout/CartContext.tsx` (edit)

**Before:** `OrderResult` type had `total`, `totalCents`, `currency` — no tax fields.
**Now:** Adds optional `tax?: number` (display-friendly major units) and `taxAmountCents?: number` (raw cents source of truth) to `OrderResult`. Both optional + default to undefined / 0 for backward compatibility with existing call sites.
**Why:** SPEC §6.1.

### `mingla-business/src/services/ticketCheckoutService.ts` (edit)

**Before:** `TicketCheckoutFreeCompleted` type was the wire shape for the `order` field in `TicketCheckoutStatusResult`. No tax field.
**Now:** Adds optional `taxAmountCents?: number` so the status edge fn's return shape carries tax data into the confirmation screen.
**Why:** SPEC §6.1. C-05.

### `mingla-business/src/services/brandStripeTaxDashboardLinkService.ts` (new)

**Before:** N/A.
**Now:** Client-side wrapper around `supabase.functions.invoke("brand-stripe-tax-dashboard-link", ...)`. Throws on null response or missing url. Mirror of `brandStripeDetachService` shape.
**Why:** SPEC §6.2 + §13 (Const #3 no silent failures).

### `mingla-business/src/hooks/useBrandStripeTaxDashboardLink.ts` (new)

**Before:** N/A.
**Now:** `useMutation` hook that fetches the link via the service then `Linking.openURL`s it. `onSuccess` handler calls `Linking.canOpenURL` first for safety; throws on unsupported URL so the caller's `isError` surfaces.
**Why:** SPEC §6.2. C-06.

### `mingla-business/app/checkout/[eventId]/confirm.tsx` (edit)

**Before:** Confirmation summary rendered per-ticket lines → divider → Total row. No tax handling.
**Now:** Pulls `status.order.taxAmountCents` from the status response, writes it onto the `OrderResult` (both `tax` major-units AND `taxAmountCents` raw). Renders a "Tax" row BEFORE the total row, gated on `typeof result.tax === "number" && result.tax > 0` so zero-tax orders show no row (Const #9 no fabricated data).
**Why:** SPEC §6.1. C-05, C-07.

### `mingla-business/src/components/brand/BrandPaymentsView.tsx` (edit)

**Before:** Payments tab rendered banner + KPI tiles + Recent payouts + Recent refunds. No tax surface.
**Now:** Imports `useBrandStripeTaxDashboardLink`. Wires `handleOpenTaxDashboard` callback. Inserts a new "Tax & registrations" GlassCard between the KPI tiles and "RECENT PAYOUTS" section, gated on `stripeStatus === "active"`. Card has icon + title + disclosure body ("Manage tax registrations in Stripe Dashboard. Stripe Tax adds about 0.5% on top of Stripe fees. You're the merchant of record.") + "Open Stripe Dashboard" button (disabled while mutation pending, label "Opening Stripe…"). Inline error text when `isError`. Eight new styles in StyleSheet.
**Why:** SPEC §6.2. C-06.

### `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` (new)

**Before:** N/A.
**Now:** Six-check strict-grep gate per SPEC §9. Checks: migration exists + declares column, checkout passes `automatic_tax` + `liability` + `account` + `customer_update.address`, webhook router persists `total_details.amount_tax` to `tax_amount_cents`, BrandPaymentsView imports the hook + contains "merchant of record" copy, new edge function exists + calls `accounts.createLoginLink`.
**Why:** SPEC §9. C-13.

### `.github/workflows/strict-grep-mingla-business.yml` (edit)

**Before:** Registered ORCH-0788, ORCH-0793, ORCH-0795, ORCH-0796, ORCH-0805, ORCH-0806 jobs.
**Now:** Plus `orch-0804-stripe-tax-enabled-on-checkout` job registered below `orch-0805-brand-cover-overhaul`.
**Why:** SPEC §9.

---

## 6. Spec traceability

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| C-01 | Every web Checkout Session has automatic_tax.enabled + liability.account + customer_update.address | Verified by reading `ticket-checkout-create/index.ts:196-241` post-edit; strict-grep Check 3 enforces | ✅ PASS |
| C-02 | `orders.tax_amount_cents` populated from `session.total_details.amount_tax` | Code path verified at `_shared/stripeWebhookRouter.ts:783-806`; runtime requires migration live + a real Stripe event | ⚠️ UNVERIFIED (architectural; needs live Stripe smoke) |
| C-03 | `orders.tax_calculation_id` populated when present | Same code path; same verification status | ⚠️ UNVERIFIED |
| C-04 | UK-registered brand → UK buyer sees tax line on Stripe-hosted page | Stripe-side behavior; verified by Stripe Tax for Platforms doc; needs live smoke with registered brand | ⚠️ UNVERIFIED (Stripe behavior; tester live-fire) |
| C-05 | Buyer confirmation renders tax line when > 0 | Conditional render at `confirm.tsx:386-394`; tax pulled from `status.order.taxAmountCents` at line 209 | ✅ PASS (architectural) |
| C-06 | Payments tab "Tax & registrations" CTA opens Stripe Dashboard | Wiring at `BrandPaymentsView.tsx:170-178` + GlassCard at line 419-455; uses `Linking.openURL` via hook | ✅ PASS (architectural; live device probe needed for full proof) |
| C-07 | Zero-tax order shows no tax row | Conditional `typeof result.tax === "number" && result.tax > 0` at `confirm.tsx:386` | ✅ PASS |
| C-08 | Brand with misconfigured Tax Settings → friendly error | DEVIATION #3 — relies on generic 400 path; no special-case toast. Acceptable for v1 | ⚠️ DEVIATION (documented) |
| C-09 | Free tickets skip tax | Free-ticket path bypasses `stripeWeb.checkout.sessions.create` entirely (early return at `ticket-checkout-create/index.ts:158-167`); no `automatic_tax` params on order side | ✅ PASS |
| C-10 | Audit log shows new slugs | Slug emission verified for `stripe_tax.registration_link_opened` (edge fn line 117-122). `stripe_tax.checkout_enabled` registered but NOT emitted (DEVIATION #2) | ⚠️ DEVIATION (documented) |
| C-11 | Migration applies cleanly | Verified by reading SQL; in-migration probes guard apply | ✅ PASS (architectural; operator gates) |
| C-12 | tsc clean, jest clean | tsc EXIT 0 from `mingla-business/`; jest auditActionLabels 37/37 PASS; Deno gates NOT RUN (Deno unavailable in this Claude session — operator must run `deno check supabase/functions/ticket-checkout-create/index.ts` + `deno check supabase/functions/brand-stripe-tax-dashboard-link/index.ts` + `deno check supabase/functions/_shared/stripeWebhookRouter.ts` before deploy) | ⚠️ Deno gates UNVERIFIED (per parity rule #8) |
| C-13 | Strict-grep gate PASSES with negative control | PASS 6/6; two independent negative controls (Check 3 + Check 5) both fired with named diagnostics, restore returned to PASS | ✅ PASS |
| C-14 | `event-cover-pexels-search` + other unrelated fns untouched | `git status` shows no modifications outside the listed scope | ✅ PASS |

**Summary:** 8 PASS, 3 DEVIATION (documented in §3), 4 UNVERIFIED (need live Stripe smoke + Deno gates from operator).

---

## 7. Invariant verification

### Preserved

| Invariant | Status |
|-----------|--------|
| Constitution #2 (one owner per truth) | ✅ Tax = Stripe → persisted to orders → read by UI |
| Constitution #3 (no silent failures) | ✅ Service throws; webhook UPDATE error logged; UI surfaces errors via toast/inline text |
| Constitution #9 (no fabricated data) | ✅ Tax row gated on `> 0`; never shows "Tax £0.00" placeholder |
| Constitution #10 (currency-aware) | ✅ `formatCurrency(result.tax, result.currency)` used |
| Constitution #13 (exclusion consistency) | ✅ `automatic_tax` enabled in generation (edge fn) + tax persisted in serving (webhook → orders) |
| I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE | ✅ New slugs in `KNOWN_STATIC_SLUGS` + resolver |
| I-PROPOSED-O STRIPE-EMBEDDED-COMPONENTS-VIA-OFFICIAL-SDK-ONLY | ✅ We link OUT to Stripe Dashboard for tax; no WebView wrap |

### New invariant DRAFT

**I-PROPOSED-BF STRIPE_TAX_ENABLED_ON_CHECKOUT** — see SPEC §8. Promotion DRAFT → ACTIVE on close per ORCH-0804 CLOSE.

---

## 8. Parity check

- Solo / collab: N/A — checkout is single-buyer transactional.
- Mobile / business / admin: scoped to `mingla-business` only.
- iOS / Android / web: web Checkout Session path serves all three platforms (the buyer always lands on Stripe's hosted checkout page; mobile launches it via in-app browser, web in-page redirect).
- Native Payment Sheet (iOS + Android PI path): UNTOUCHED. Deferred to ORCH-0804-A.

---

## 9. Cache safety

- No React Query key factory changes.
- `useBrandStripeTaxDashboardLink` is a mutation, no cache key. `onSuccess` opens URL via Linking; nothing to invalidate.
- `OrderResult` shape changed (additive — `tax?` and `taxAmountCents?` are optional). Existing call sites continue to compile with `undefined`.
- No AsyncStorage / Zustand impact.

---

## 10. Regression surface

Tester should smoke:

1. **Existing free-ticket checkout** — `ticket-checkout-create/index.ts:140-167` free path UNTOUCHED. Verify free tickets still finalize cleanly with `tax_amount_cents = 0`.
2. **Existing native Payment Sheet checkout** — `ticket-checkout-create/index.ts:308-360` PI path UNTOUCHED beyond the protective comment. Native flow still completes; tax = 0 on those orders (expected; deferred to ORCH-0804-A).
3. **`handleTicketCheckoutPaymentIntent`** (PI succeeded → finalize) — UNTOUCHED. Order INSERT still happens via `biz_ticket_checkout_finalize` RPC with `tax_amount_cents = 0` (default).
4. **Refund flow** — `_shared/stripeWebhookRouter.ts` refund handlers untouched. Refund processing on tax-enabled orders should still work (Stripe handles tax refunds proportionally on its side).
5. **ORCH-0805 + ORCH-0806 strict-grep gates** — verified still PASS after my changes (no regression).
6. **Brand Payments tab on a non-active brand** (status ≠ "active") — Tax CTA hidden via the `stripeStatus === "active"` gate. Verify no render on disconnected/onboarding brands.

---

## 11. Constitutional compliance

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | ✅ CTA opens link or surfaces error |
| 2 | One owner per truth | ✅ |
| 3 | No silent failures | ✅ |
| 4 | One key per entity | ✅ (no new query keys) |
| 5 | Server state server-side | ✅ |
| 6 | Logout clears everything | ✅ (no new persist) |
| 7 | Label temporary fixes | ✅ Protective comments on PI block (ORCH-0804-A deferral) and webhook race (ORCH-0804-B deferral) |
| 8 | Subtract before adding | ✅ Existing code paths untouched; additive only |
| 9 | No fabricated data | ✅ Tax row gated on `> 0` |
| 10 | Currency-aware | ✅ |
| 11 | One auth instance | ✅ |
| 12 | Validate at right time | ✅ Tax calculated by Stripe at checkout time |
| 13 | Exclusion consistency | ✅ |
| 14 | Persisted-state startup | ✅ |

---

## 12. Working-branch discipline

- All edits on `/Users/sethogieva/Desktop/mingla-main` branch `Seth`. ✅
- No `supabase db push` executed. ✅
- No `mcp__supabase__apply_migration` call. ✅
- No edge function deploys initiated. ✅
- Monotonic migration filename: `20260530000000_*` > latest existing `20260529000001_*`. ✅
- Deno gates **NOT RUN** (Deno unavailable in this Claude session — per parity rule #8, operator must run `deno check` on the 3 touched edge function files + `deno test` if a test suite exists, before deploy).

---

## 13. Migrations awaiting `supabase db push`

| Migration | Path |
|---|---|
| ORCH-0804 orders tax columns | `supabase/migrations/20260530000000_orch_0804_orders_tax_columns.sql` |

**Operator action required before tester smoke:**

```bash
cd /Users/sethogieva/Desktop/mingla-main && supabase db push --linked
```

---

## 14. Operator actions required for ORCH-0804 to be fully live

1. **Apply migration:** `supabase db push --linked` (above).
2. **Create new RAK in Stripe Dashboard:** `STRIPE_RAK_TAX_DASHBOARD_LINK` with permission `accounts:write` (just the scope needed for `createLoginLink`).
3. **Set Supabase secret:**
   ```bash
   supabase secrets set STRIPE_RAK_TAX_DASHBOARD_LINK=rk_... --project-ref gqnoajqerqhnvulmnyvv
   ```
4. **Deploy three edge functions** (orchestrator owns this per cross-skill rule #9):
   - `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv`
   - `supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv` (it imports the changed `_shared/stripeWebhookRouter.ts`)
   - `supabase functions deploy ticket-checkout-status --project-ref gqnoajqerqhnvulmnyvv`
   - `supabase functions deploy brand-stripe-tax-dashboard-link --project-ref gqnoajqerqhnvulmnyvv` (new function — first deploy)
5. **Run Deno gates** (orchestrator should run these before deploy per parity rule #8 — implementor could not because Deno wasn't available in this Claude session):
   - `deno check supabase/functions/ticket-checkout-create/index.ts`
   - `deno check supabase/functions/_shared/stripeWebhookRouter.ts`
   - `deno check supabase/functions/ticket-checkout-status/index.ts`
   - `deno check supabase/functions/brand-stripe-tax-dashboard-link/index.ts`
   - `deno check supabase/functions/_shared/stripe.ts`
6. **Brand-side action (post-deploy):** every brand that wants to collect tax must register in Stripe Dashboard → Tax → Registrations for each country they sell tickets in. Until they register, Stripe Tax returns 0 tax (no error).

---

## 15. Discoveries for orchestrator

- **ORCH-0804-A** queued: enable Stripe Tax on the native PaymentIntent path. Requires `POST /v1/tax/calculations` pre-call. Larger SPEC; defer per §2.
- **ORCH-0804-B** queued: harden against the `checkout.session.completed` → `payment_intent.succeeded` race condition. Approach: add `tax_amount_cents` + `tax_calculation_id` to `ticket_checkout_sessions` and have `biz_ticket_checkout_finalize` copy them to orders. Documented in §3 deviation #1.
- **ORCH-0804-C** candidate: emit `stripe_tax.checkout_enabled` audit slug once per brand on first tax-enabled checkout. SPEC §5.3 specified this; deferred per §3 deviation #2. Optional.
- **Tax line on brand-side order detail** — out of scope here. Wave 5 ORCH-0803 finance reports will surface this.
- **Tax line on confirmation email** — out of scope. Stripe's hosted receipt already shows tax. Future polish ORCH if desired.

---

## 16. Layman summary for operator chat

ORCH-0804 implementation complete. Every paid Checkout Session now collects tax via Stripe Tax (brand is merchant of record). Buyer confirmation shows the tax line when collected. Brand Payments tab has new "Tax & registrations" CTA opening Stripe Dashboard. Three SPEC deviations documented (race-condition limitation, audit slug not emitted, no special-case tax error toast). Local gates green: tsc EXIT 0, jest 37/37, strict-grep 6/6 with 2 negative controls proven. Deno gates NOT RUN — operator runs them before deploy.

**Operator needs to:** (1) `supabase db push --linked` to apply migration, (2) create + set `STRIPE_RAK_TAX_DASHBOARD_LINK` RAK + secret, (3) run Deno checks + deploy 4 edge functions, (4) live-smoke the tax flow with a registered brand.

---

**End of implementation report.**
