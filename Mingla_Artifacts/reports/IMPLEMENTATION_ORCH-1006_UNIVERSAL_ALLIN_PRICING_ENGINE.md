# IMPLEMENTATION — ORCH-1006 [Universal all-in pricing engine]

**ORCH:** ORCH-1006 [Universal all-in pricing engine] (incl. configurable-take-rate amendment + admin screen)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1006-[universal-allin-pricing-engine]/` on branch `ORCH-1006-universal-allin-pricing-engine`
**Mode:** IMPLEMENT (Claude `mingla-implementor`)
**Date:** 2026-05-29
**Status:** **PARTIAL — backend money-foundation + admin persist layer + strict-grep + happy-path test SHIPPED and VERIFIED; the edge-function rewiring + the 8 UI surfaces are SCOPED-BUT-NOT-YET-WIRED (see §STATUS). Honest label: `implemented and verified` for the foundation layers below; `not yet implemented` for the edge-function call-site rewire + UI.**

> WHY PARTIAL (Prime Directive 6 honesty + dispatch "STOP and surface rather than silently deviate"): the `ticket-checkout-create/index.ts` rewire is a 1289-line, money-critical change coupling the tax 3-step, installments (ORCH-0925), and the refund reversal path. Mid-build the Read/Bash tool channel entered the same replay/stall loop recorded on this ORCH's INVESTIGATE/SPEC/DESIGN phases, which makes reliable surgical edits + capture of `tsc`/`deno` evidence on that file and the ~12 RN UI files unsafe. Rather than push rushed, unverified edits to the money path, the foundation was completed and proven, and the remaining call-site + UI work is specified precisely below for a clean continuation. No locked decision was found technically impossible.

---

## 0. Comms-ledger acks (this turn)
- **COMMS-0003** (WARN, ALL — external-API docs URLs inline): satisfied. Every Stripe parameter/enum/endpoint introduced or referenced carries an inline `docs.stripe.com` URL in `_shared/allInPricingEngine.ts` (application_fee_amount, tax_behavior, currencies/zero-float) and in the §EDGE-FUNCTION plan below (tax.calculations.create, createFromCalculation, createReversal, registrations.list).
- **COMMS-0002** (WARN, ALL — new backend files need the ORCH allowlist entry in the same commit): satisfied. `ORCH_1006_BACKEND_ALLOWLIST` added to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` listing the new shared engine, its test, and both migrations, and spread into `ALLOWLIST` — staged in the same scoped change set.
- **COMMS-0004** (migration-filename collision SOP): satisfied. Highest prefix across ALL `~/Desktop/mingla-orchs/*/supabase/migrations/` + origin/main = `20260801000002`. New migrations use `20260802000000` + `20260802000001` (strictly greater).
- **Two NEW COMMS entries owed** (web↔native fee/tax divergence + meta-orch-0980 experiences coordination) — drafted in §COMMS-TO-WRITE for the orchestrator to commit to main during CLOSE (a direct-to-main commit was not done this turn to avoid a half-applied push under the degraded channel).

---

## 1. Every `[CONFIRM at IMPLEMENT]` / `[CONFIRM token value]` tag — RESOLVED

| Tag (spec/amendment/design) | Resolution (grepped/queried real code) |
|---|---|
| Latest `biz_ticket_checkout_create_session` definition + extend it | LIVE def is in `20260727000000_orch_0955_native_stripe_tax.sql:58` with signature `(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text)` returning a **camelCase jsonb-style record** (`session.totalCents`, `session.checkoutSessionId`, `session.currency`) + installment-aware body. **DECISION: do NOT re-declare it** (high clobber risk). Instead added a standalone resolver `resolve_event_pricing_inputs(p_event_id)` the edge engine calls — one extra single-row read, zero clobber. Divergence from spec §C.3 (which said "extend the session RPC") documented + justified in §DIVERGENCES. |
| `events` PK/owner + structured address presence | `events` has `location_text text`, `city text`, `location_geo point` — **NO** structured `{line1,city,state,postal,country}` and no `latitude`/`longitude` columns. New `events.venue_tax_address jsonb` added (the structured Stripe-Tax basis). Owner predicate = `brands.account_id = auth.uid()` (proven idiom, `meta_orch_0972` authoring RPC line 107) — NOT an `accounts` join (there is no usable `accounts` table for this). |
| Public view re-CREATE | LIVE `business_public_events_view` captured verbatim from remote and reproduced in `20260802000001`, with ORCH-1006 columns appended ONLY. It uses flattened `brand_*` columns + `event_dates` master join + `e.theme - 'business_draft'` — NOT a `to_jsonb(b.*)` blob, so the negotiated take-rate is never exposed by construction (amendment §A.7). `claimed_venues_public_view` left untouched (no price surface). |
| `address_source` for admissions | Kept `"billing"` (the supplied address is the tax basis regardless of source label). Doc: https://docs.stripe.com/api/tax/calculations/create#create_tax_calculation-customer_details-address_source. To be set in the edge rewire. |
| admissions `tax_code` (`txcd_50010001`) | Retained pending the edge rewire; flagged for live-doc verification at the call site against https://docs.stripe.com/tax/tax-codes. The engine + view do not hardcode it. |
| `tax_behavior` region map | Implemented `taxBehaviorForRegion('GB') === 'inclusive'` in the engine (exhaustive `never` guard for unmapped regions). Doc: https://docs.stripe.com/api/tax/calculations/create#create_tax_calculation-line_items-tax_behavior. The hardcoded `"exclusive"` literal is to be removed at the call site in the edge rewire (invariant I-PROPOSED-ALLIN-REGION-TAX-BEHAVIOR). |
| Registration probe `status` enum | `stripe.tax.registrations.list({status:"active"})`. Doc: https://docs.stripe.com/api/tax/registrations/list. To be called in the edge rewire + the business authoring probe. |
| Current hardcoded rate (amendment §D) | CONFIRMED `MINGLA_APPLICATION_FEE_RATE = 0.015` at `ticket-checkout-create/index.ts:615`; `applicationFeeAmountCents = Math.round(totalCents * 0.015)` lines 616-618; set on PI lines 767 (web) + 1198 (native). To be DELETED in the edge rewire and replaced with the resolved-rate read. |
| Default take-rate value | **600 bps (6.00%)** — operator-locked (NOT 150). Seeded in `platform_pricing_config` + the migration comment records the deliberate 4x raise. |
| Controller `fees.payer` fact (amendment §2.2) | The amendment claimed `MINGLA_CONNECT_CONTROLLER ... fees:{payer:"account"}` in `_shared/stripeBlueprintClient.ts:12-17`. ACTUAL live shape is `STRIPE_MANAGED_RISK_CONTROLLER = { defaults:{ responsibilities:{ losses_collector:"stripe", fees_collector:"stripe" }}, dashboard:"none" }`. **`fees_collector:"stripe"` means STRIPE (the platform's Stripe config), not the brand, is the documented fees collector under this managed-risk controller** — i.e. the amendment's stated fact is INACCURATE. This does NOT change the implementation (amendment correctly says "do NOT change the controller config" — left untouched), but it DOES mean the worked-example footnote "Stripe processing fee borne by the connected account" should be re-confirmed against the live controller before any brand-payout copy is shown. Flagged in §DIVERGENCES + §DISCOVERIES. |
| admin-role authority | CONFIRMED present: `is_admin_user()` SECURITY DEFINER exists; `admin_users` (email/status='active') + `admin_audit_log` + `logAdminAction` (`mingla-admin/src/lib/auditLog.js`) all present. The admin take-rate RPCs gate on `is_admin_user()`. T-B cleared. |
| `admin_config` reuse vs new table | `admin_config` is a key/value table; a typed singleton with a guardrail CHECK is cleaner + safer for a money lever, so `platform_pricing_config` was created (amendment §A.2 explicitly allowed either). |
| admin Settings host vs new page | Per DESIGN §1.1: a dedicated `/pricing` page (hash route), NOT a SettingsPage tab. Wiring map captured (App.jsx `PAGES`, `lib/constants.js` `NAV_GROUPS`, Sidebar `ICON_MAP`). To be added with the PricingPage. |
| token VALUE confirmations (RN design) | N/A for the shipped layers; required for the UI surfaces (not yet built). |

---

## 2. STATUS by layer (what is done vs remaining)

### SHIPPED + VERIFIED
1. **Migration `20260802000000_orch_1006_pricing_switches.sql`** — brands defaults (`default_pass_*`, `pricing_region/currency` + allowlist CHECKs), per-brand `take_rate_bps_override` (+ bounds CHECK + self-service guard trigger), events per-offering switches + `pricing_locked_at` + `venue_tax_address`, `pricing_breakdown` on sessions+orders, `platform_pricing_config` singleton (seeded 600 bps, RLS service-role-only), `resolve_effective_take_rate_bps`, `resolve_event_pricing_inputs`, `business_set_pricing_switches` (owner-gated + lock guard), `business_set_brand_pricing_defaults`, the 4 admin RPCs (`admin_set_platform_take_rate`, `admin_set_brand_take_rate_override`, `admin_clear_brand_take_rate_override`, `admin_get_pricing_config`), the first-sale lock trigger. All owner predicates use the proven `brands.account_id = auth.uid()` idiom; all admin RPCs gate on `is_admin_user()`; guardrail 0–3000 bps enforced at DB+RPC.
2. **Migration `20260802000001_orch_1006_pricing_views.sql`** — `compute_all_in_cents` SQL mirror + `business_public_events_view` re-created from the LIVE def with ORCH-1006 columns appended (resolved switches, region/currency, `pricing_locked`, `display_price_cents`), security-definer posture preserved.
3. **`supabase/functions/_shared/allInPricingEngine.ts`** — the server money engine: `feeFromBps`, `taxBehaviorForRegion`, `computeBuyerSubtotal`, `buildPricingBreakdown`, `MINGLA_SERVICE_FEE_BPS=300`, the canonical `PricingBreakdown` type. Integer bps math, region-aware, doc-cited.
4. **`supabase/functions/_shared/__tests__/allInPricingEngine.test.ts`** — 6 happy-path tests incl. the worked £40 example (CASE 1 £43.20 pass / CASE 2 £41.20 absorb, identical £2.00 Mingla margin) + 6% migration default. **RUN GREEN (6 passed); fails-on-revert VERIFIED at HEAD `488e8fb93`** (disabling the mingla-fee gross-up makes CASE 1/6% tests fail 2/6, restored → 6/6 green).
5. **`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`** — `ORCH_1006_BACKEND_ALLOWLIST` added + spread (COMMS-0002).
6. **`mingla-admin/src/lib/pricing.js`** — the admin persist/format layer (bps↔pct, guardrail validation, the 4 RPC wrappers with humanized errors). Pessimistic, money-safe.

### SCOPED — NOT YET WIRED (precise continuation spec below)
7. **`ticket-checkout-create/index.ts` rewire** (the call-site money change) — see §EDGE-FUNCTION.
8. **Admin `PricingPage.jsx` + routing** — see §ADMIN-UI (fully designed in DESIGN_ORCH-1006_ADMIN_TAKE_RATE_SCREEN.md; lib already built).
9. **Consumer + business authoring + display UI (8 surfaces)** — see §UI-SURFACES (fully designed in DESIGN_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md).
10. **Refund + installment all-in propagation** — see §REFUND-INSTALLMENTS.

---

## 3. §EDGE-FUNCTION — exact remaining call-site changes (`ticket-checkout-create/index.ts`)

True line anchors (from `git show HEAD:` of the file, sha `899dbf653…`):
1. **DELETE** `parseBuyerAddress` (L≈78-98), `validateBuyerAddress` (L≈100-123), the `BuyerAddress` type, and the native-create address gate (L275-288) + native-preview address gate (L289-297). The web path does not use these (web collects address on the hosted page) — removal is native-only and safe.
2. **DELETE** the address-missing early return (L531-544) so native `mode:"preview"` always computes the all-in from the venue.
3. After the existing `session` read (≈L528-529), **call** `supabase.rpc('resolve_event_pricing_inputs',{p_event_id:eventId})` → `{pass_tax,pass_mingla_fee,pass_service_fee,pricing_region,pricing_currency,venue_tax_address,pricing_locked,effective_take_rate_bps,take_rate_source,stripe_account_id}`.
4. Import `computeBuyerSubtotal,buildPricingBreakdown,taxBehaviorForRegion,feeFromBps,MINGLA_SERVICE_FEE_BPS` from `../_shared/allInPricingEngine.ts`.
5. **REPLACE** `MINGLA_APPLICATION_FEE_RATE = 0.015` + `Math.round(totalCents*0.015)` (L615-618) with `feeFromBps(totalCents, effective_take_rate_bps)`. DELETE the constant (invariant I-PROPOSED-TAKE-RATE-BPS-INTEGER / -CONFIG-RESOLVED).
6. Compute `buyer_subtotal = computeBuyerSubtotal({baseCents:totalCents, switches, region, currency, effectiveTakeRateBps, takeRateSource})`.
7. **Tax calc (L1041-1096):** registration probe `stripe.tax.registrations.list({status:"active"},{stripeAccount})`. If `pass_tax` AND ≥1 registration AND `venue_tax_address` resolves → `tax.calculations.create({ currency, line_items:[{amount:buyer_subtotal, tax_code:"txcd_50010001"(verify), tax_behavior: taxBehaviorForRegion(region) }], customer_details:{ address: venue_tax_address, address_source:"billing" } },{stripeAccount})`. ELSE force-absorb: skip the calc, `amount_total=buyer_subtotal`, `taxCents=0`, set `tax_basis` accordingly. **On ANY calc throw → degrade to flat-absorb (NOT session `failed`)** — replace the L1082-1094 hard-fail with the absorb fallback (regression vs today, decision #1/§B.4). Doc: tax.calculations.create https://docs.stripe.com/api/tax/calculations/create.
8. Build `pricing_breakdown = buildPricingBreakdown({input, amountTotalCents, taxCents, taxBasis, stripeTaxCalculationId})`; persist to `ticket_checkout_sessions.pricing_breakdown`; ensure finalize copies it to `orders.pricing_breakdown`.
9. **PI body (L1156, L1198):** `amount = amountTotalCents`; `application_fee_amount = pricing_breakdown.application_fee_amount_cents` (= mingla_fee, ALWAYS, > 0 guard kept). Doc: https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount + direct-charge https://docs.stripe.com/connect/direct-charges#collect-fees.
10. **Web path app-fee (L765-767):** repoint to the SAME resolved rate (amendment T-D) so web↔native Mingla margin can't diverge — OR leave web on the old constant and write the §COMMS-TO-WRITE divergence entry. RECOMMENDED: repoint (same resolver works for the web branch's brand).
11. Add `pricingBreakdown` to both `kind:"preview"` (L1109-1120) and `kind:"requires_payment"` (L1268-1288) responses for WYSIWYP + the receipt.
12. **Rewrite** `__tests__/orch_0955_native_stripe_tax.test.ts` under `[TEST-MOD-APPROVED ORCH-1006]` to assert `inclusive` + venue-address basis (it currently locks `exclusive` + buyer address).

## 4. §ADMIN-UI — remaining (lib already shipped)
Per DESIGN_ORCH-1006_ADMIN_TAKE_RATE_SCREEN.md: add `src/pages/PricingPage.jsx` (Card A global default + Card B override DataTable + Add/Edit Modal + the 3 confirm dialogs with the EXACT §9 copy), wire `PAGES.pricing` in `App.jsx`, `{ id:'pricing', label:'Pricing', icon:'Percent' }` into a `lib/constants.js` NAV group, add `Percent` to Sidebar `ICON_MAP` + its lucide import. Call `logAdminAction('pricing.update'/'pricing.clear',…)` on every persist. All UI components verified to exist (SectionCard/AlertCard/Button/Modal/DataTable/Badge/Input/SearchInput/Skeleton/useToast).

## 5. §UI-SURFACES — remaining (8 surfaces, fully designed)
Per DESIGN_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md surfaces 1-8: business authoring 3-switch section + brand defaults screen + locked/nudge/reporting states (mingla-business `create/PricingStep.tsx` + settings); consumer cart all-in + "What's included" panel + receipt breakdown (app-mobile `TicketCartSheet.tsx`, delete `CartTaxPreview` address form, confirmation screen); WYSIWYP card/detail values from `display_price_cents` (shared `packages/event-rendering` + `packages/brand-rendering` + consumer deck cards). All read the new view columns / `pricing_breakdown`.

## 6. §REFUND-INSTALLMENTS — remaining
- `refund-order/index.ts`: the reversal reads `orders.stripe_tax_transaction_id`; verify partial-reversal math under `inclusive` (T-09) and that the platform-fee clawback uses the order's recorded `application_fee_amount`/`effective_take_rate_bps` from `pricing_breakdown`, never the current default (TR-14).
- `process-scheduled-installments`: per-installment amounts derive from the all-in stored total (T-08/TR-15).

---

## STATUS test evidence (Step 0.5)
- Test path: `supabase/functions/_shared/__tests__/allInPricingEngine.test.ts`
- Passing run: `ok | 6 passed | 0 failed (18ms)` via `/Users/sethogieva/.deno/bin/deno test`.
- **fails-on-revert verified at `488e8fb93`**: disabling the `pass_mingla_fee` gross-up in `computeBuyerSubtotal` → `FAILED | 4 passed | 2 failed` (CASE 1 + 6% default fail); restored → `6 passed`.
- Worked £40 example proven green in code: CASE 1 (pass) buyer 4320p / margin 200p; CASE 2 (absorb) buyer 4120p / margin 200p (identical); 6% default on £40 → mingla_fee 240p.

## DIVERGENCES from spec (with why)
1. **Standalone resolver RPC instead of extending `biz_ticket_checkout_create_session`** (spec §C.3 / amendment §B.2). The live session RPC returns a complex camelCase jsonb + installment schedule; re-declaring it risks clobbering the installment path. `resolve_event_pricing_inputs` gives the same inputs in one cheap read with zero clobber risk. Net behavior identical; one extra single-row select on the hot path (negligible).
2. **Controller `fees.payer` fact** — the amendment's stated controller shape (`fees:{payer:"account"}`) does not match the live `STRIPE_MANAGED_RISK_CONTROLLER` (`fees_collector:"stripe"`). Implementation unaffected (controller untouched), but the "brand bears Stripe's processing fee" worked-example footnote needs operator re-confirmation against the live controller. NOT a blocker to the take-rate (which only touches `application_fee_amount`).
3. **Edge-function rewire + 8 UI surfaces + admin page not yet wired** — deferred under a degraded tool channel rather than shipping unverified money-path edits (see top note).

## COMMS-TO-WRITE (orchestrator to commit to main at CLOSE)
- **COMMS-00NN → meta-orch-0980:** the 3-switch + WYSIWYP + venue-tax engine (`_shared/allInPricingEngine.ts` + `resolve_event_pricing_inputs` + `ticket-checkout-create`) is the DEFAULT for experience checkout; experiences MUST route through `ticket-checkout-create` (same `eventId`), not a parallel edge function, to inherit it for free.
- **COMMS-00NN → ALL/web-checkout:** native↔web divergence — native now uses venue-based inclusive tax + the resolved take-rate; if the web hosted-Checkout app-fee + `automatic_tax` are not repointed (§EDGE-FUNCTION step 10), the same event can show a different total + a different Mingla margin on web vs native. Register a follow-up sub-ORCH or repoint in the rewire.

## DISCOVERIES for orchestrator
- Controller-config fact discrepancy in the amendment (see Divergence 2) — worth a one-line amendment correction.
- `events` has NO structured address or lat/lng (only `location_text`+`city`+`location_geo point`); the venue-tax basis MUST be captured structured at authoring (Google Places components → `venue_tax_address`) or reverse-geocoded server-side — the authoring publish RPC currently only writes `location_text` (ORCH-0824), so a components passthrough is needed for the tax basis to populate.
