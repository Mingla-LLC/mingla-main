# Investigation Report: Stripe Country Propagation + Active Payments Success State (ORCH-0764C)

> Date: 2026-05-09  
> Source: Operator smoke after ORCH-0764B deploy  
> Confidence: H for code/schema root causes; M-H for runtime fixture mapping because audit-log query was unavailable  
> Status: root cause proven for active banner + existing-account country reuse; runtime fixture evidence narrows the country report

## 1. Layman Summary

The core Stripe onboarding flow is now working, but two post-success truths are still confusing:

1. A country selected in Mingla can be ignored when the brand already has a Stripe connected account. The app sends the chosen country on new-account creation, but the edge function silently reuses any existing `stripe_connect_accounts.stripe_account_id` without checking whether that existing account was created for another country.
2. The Payments page was intentionally built with **no active success banner**. So even when Stripe/Mingla says the account is active, the user does not get the requested green **You're connected to Stripe** confirmation.

Runtime evidence also shows an important distinction: the current `Test Stripe` brand is a **GB active** connected account, while the later `Stripe Wise` and `Stripe Wise 2` fixtures are **US but restricted/past-due**, not active. That makes the reported "US became UK" most likely an existing-account/old-fixture confusion or silent reuse problem, not proof that the fresh US create path always sends GB.

Recommended direction: implement ORCH-0764C as a tight rework: hard-block/warn on existing-account country mismatch, lock or explain country after account creation, add active success banner, and tighten cache invalidation/routes so Payments cannot fall back to stale verifying state after the onboarding shell has already settled.

## 2. Scope

- **Feature / issue:** Stripe Connect country selection and Payments active-state UI.
- **Actor:** Mingla Business brand admin setting up payouts.
- **Environment:** Mingla Business app + Supabase edge functions + Stripe sandbox/test mode.
- **Success definition:** Selecting a country creates a connected account for that country when no account exists; existing account country is treated as locked; active live Stripe status renders a green/check success banner on Payments and hides verifying copy.
- **Assumptions:** Operator's latest smoke used either `Test Stripe` or another Stripe-named brand in the same sandbox. Exact screenshot/brand id for this latest smoke was not attached.
- **Out of scope:** Deleting/recreating Stripe accounts, live-mode Stripe mutation, checkout/payment collection, legal ToS copy, unrelated rich-preview work.

## 3. Intended Journey

`Payments -> Set up payments -> pick country -> accept Mingla ToS -> brand-stripe-onboard -> create/reuse Stripe account -> Account Link -> Stripe-hosted onboarding -> app refreshes Stripe status -> Payments shows the one effective status`

Expected negative behavior:

- If an account already exists, the chosen country must not pretend to mutate the existing Stripe account.
- If Stripe returns with open requirements, Mingla should show remediation/verifying, not success.
- If live status is active, Mingla should show clear active confirmation, not stale verifying copy.

Stripe's hosted-onboarding docs are relevant here: the return URL only means the onboarding flow was entered/exited; the platform must retrieve the account and check requirements afterward. Stripe also documents that when country or capabilities are specified during account creation, the account owner cannot change the country later. Sources: [Stripe-hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding) and [Connect account types](https://docs.stripe.com/connect/accounts).

## 4. Historical Context

- `reports/DEPLOY_ORCH-0763E_ORCH-0764B_BUSINESS_WEB.md`: production `business.usemingla.com` deployed and `/stripe-onboarding-return` returns 200.
- `reports/INVESTIGATION_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`: prior contradiction was verifying banner plus verification overdue remediation.
- `specs/SPEC_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`: live Stripe status should win over cached brand status.
- `reports/IMPLEMENTATION_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`: cached-active bypass removed in onboarding shell.
- `DECISION_LOG.md` DEC-121/DEC-122: multi-country support is intended, bounded to 34 Stripe self-serve countries.
- `INVARIANT_REGISTRY.md` I-PROPOSED-T: country allowlist enforced across UI/backend/DB.
- Older J-A10/J-A11 docs intentionally said active has no banner; operator has now superseded that product contract.

## 5. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 | `BrandStripeCountryPicker.tsx` | UI | Prove selected country emission |
| 2 | `BrandOnboardView.tsx` | UI/state | Prove selected country is passed to mutation and status settlement behavior |
| 3 | `useStartBrandStripeOnboarding.ts` | hook/cache | Prove mutation payload and invalidation |
| 4 | `brandStripeService.ts` | service | Prove default GB and request body |
| 5 | `brand-stripe-onboard/index.ts` | edge | Prove create vs reuse branch behavior |
| 6 | `_shared/stripeBlueprintClient.ts` | Stripe client | Prove Accounts v2 payload uses `identity.country` |
| 7 | `_shared/stripeSupportedCountries.ts` | edge validation | Prove backend allowlist includes US/GB |
| 8 | `brand-stripe-refresh-status/index.ts` | edge/status | Prove status refresh writes canonical row and derives status |
| 9 | `pg_derive_brand_stripe_status` migrations | schema | Prove active/restricted/onboarding status rules |
| 10 | `BrandPaymentsView.tsx` | UI | Prove active banner is suppressed |
| 11 | `useBrandStripeStatus.ts` | hook/cache | Prove live status precedence and invalidation gaps |
| 12 | routes under `app/brand/[id]/payments*` | navigation/cache | Prove route brand prop comes from list cache |
| 13 | focused tests | tests | Prove currently guarded behavior and missing coverage |
| 14 | read-only Stripe/Supabase probes | runtime/data | Prove current fixture countries/statuses |

## 6. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs | Multi-country is intended; active used to be no banner; operator now wants green active banner. Stripe says return URL does not prove completion and country can be locked after account creation. | DEC-122; `BrandPaymentsView` comments; Stripe docs | Partial |
| Schema/RLS | `stripe_connect_accounts.country` is NOT NULL, allowlisted, and legacy rows were backfilled to `GB`. Status derived from canonical `stripe_connect_accounts`. | `20260511000001` lines 26-50; `20260515000007` lines 9-30 | Partial |
| Code | New account path sends selected country to Stripe. Existing account path reuses account without country comparison. Payments active config is `null`. | `brand-stripe-onboard/index.ts` lines 170-176, 243-275, 301-305; `BrandPaymentsView.tsx` lines 75-95 | No |
| Runtime/tests | Existing frontend service test proves selected `US` reaches edge body; Deno test only proves reuse happens, not that country mismatch is guarded. | `onboardReactivation.test.ts` lines 41-54; `brand-stripe-onboard/index.test.ts` lines 27-45 | Partial |
| Data/cache | `Test Stripe` is GB/active; `Stripe Wise` and `Stripe Wise 2` are US/restricted. Payments route gets brand from 5-minute list cache while live status hook is separate. | read-only DB + Stripe CLI probes; `useBrandListShim.ts` lines 23-26; `useBrands.ts` line 44 | Partial |

**Contradictions:**

- Product wants "US means US"; code permits "US requested, existing GB account reused."
- Product now wants a green active banner; code explicitly suppresses active banner.
- Route comments claim status updates flow through React Query, but the route brand prop is from the brand list cache, and current invalidation focuses status/detail, not brand lists.

## 7. Findings

### Finding 1: Existing connected account country can silently override the newly selected country

- **Severity:** S1 high before broad organiser payout onboarding
- **Type:** confirmed bug / invariant violation
- **Confidence:** proven in code; runtime strongly supports old `Test Stripe` GB account reuse risk
- **Broken journey step:** User picks US before setup but Stripe link opens for an already-created GB account.
- **Evidence:**
  - Picker calls `onChange(code)` with selected row country at `BrandStripeCountryPicker.tsx:81-87`.
  - Onboard view sends `country: selectedCountry` at `BrandOnboardView.tsx:311-316`.
  - Service sends `{ brand_id, return_url, country }` and defaults missing country to `GB` at `brandStripeService.ts:108-116`.
  - Edge validates requested country at `brand-stripe-onboard/index.ts:170-176`.
  - Edge reads existing row including `country` but reuses `existingSca.stripe_account_id` without comparing `existingSca.country` to `country` at `brand-stripe-onboard/index.ts:229-275`.
  - New-account path correctly passes `country` to Stripe at `brand-stripe-onboard/index.ts:301-305` and `_shared/stripeBlueprintClient.ts:147-149`.
- **Current behavior:** Existing account reuse ignores country mismatch.
- **Expected behavior:** Existing account country is locked/truthful; if requested country differs, stop or explain, not silently reuse.
- **Causal chain:** User selects US -> service sends US -> edge normalizes US -> existing SCA row exists with GB -> edge skips create path -> Account Link is created for GB account -> Stripe shows GB.
- **User impact:** User sees the wrong legal/payout country and cannot trust setup.
- **Fix direction:** Add explicit country mismatch handling in edge, plus UI lock/explanation when a brand already has a connected account.
- **Missing test or guardrail:** No edge test asserts mismatch rejection; no UI test asserts existing country is locked.
- **Invariant violated:** I-PROPOSED-T country allowlist is enforced, but "selected country owns account creation" is not enforced.

### Finding 2: Active Payments success banner is intentionally impossible today

- **Severity:** S2 UX trust gap, S1 for launch polish because money setup must feel resolved
- **Type:** confirmed UX gap
- **Confidence:** proven
- **Broken journey step:** After active verification, Payments should reassure the organiser; instead no success banner exists.
- **Evidence:**
  - File header says active renders "NO banner" at `BrandPaymentsView.tsx:4-12`.
  - `BANNER_CONFIG.active = null` at `BrandPaymentsView.tsx:75-95`.
  - Render only shows banner when `bannerConfig !== null` at `BrandPaymentsView.tsx:238-274`.
- **Current behavior:** Live active status suppresses all top status banners.
- **Expected behavior:** Live active status renders green/check **You're connected to Stripe** and no verifying banner.
- **Causal chain:** `useBrandStripeStatus` returns active or cache derives active -> `getEffectiveBrandStripeStatus` returns active -> config lookup returns null -> top banner hidden.
- **User impact:** User finishes a sensitive finance setup and gets no clear "done" signal.
- **Fix direction:** Replace `active: null` with an active success banner config and allow banner rendering without a CTA.
- **Missing test or guardrail:** No component/helper test asserts active success banner copy.

### Finding 3: Payments/onboard routes can keep stale brand-list status longer than the live status source

- **Severity:** S2 production-hardening gap
- **Type:** likely bug / cache gap
- **Confidence:** probable from code; exact latest smoke timing not reproduced
- **Broken journey step:** Onboarding shell completes, but Payments route can still receive an old `brand.stripeStatus` from the 5-minute brand list cache.
- **Evidence:**
  - Payments route resolves brand from `useBrandList()` at `app/brand/[id]/payments/index.tsx:24-35`.
  - Onboard route also resolves brand from `useBrandList()` at `app/brand/[id]/payments/onboard.tsx:20-33`.
  - `useBrandList` delegates to `useBrands(userId)` at `useBrandListShim.ts:23-26`.
  - `useBrands` list staleTime is 5 minutes at `useBrands.ts:44` and `useBrands.ts:103-115`.
  - `useBrandStripeStatus` Realtime invalidates `brand-stripe-status` and `["brands","detail",brandId]`, not `["brands","list",accountId]`, at `useBrandStripeStatus.ts:63-71`.
  - `useStartBrandStripeOnboarding` invalidates only `brandStripeStatusKeys.detail(brandId)` at `useStartBrandStripeOnboarding.ts:49-53`.
  - Onboard route `handleAfterDone` only navigates back at `app/brand/[id]/payments/onboard.tsx:45-52`.
- **Current behavior:** Live status often wins in `BrandPaymentsView`, but if live query is loading/failed/stale, fallback can be stale cached onboarding from brand list.
- **Expected behavior:** After onboarding status settlement, Payments and onboarding shell converge without a second tap or 5-minute wait.
- **Causal chain:** status refresh updates canonical row -> trigger updates brand cache in DB -> client invalidates status/detail but route prop still comes from list cache -> fallback status can stay `onboarding`.
- **User impact:** "It says I'm successfully onboarded but Payments still says verifying."
- **Fix direction:** Invalidate brand lists on status changes and/or move payments/onboard routes to `useBrand(id)` detail query; explicitly refetch after onboarding done.
- **Missing test or guardrail:** No test covers onboarding done -> brand list/detail invalidation -> Payments active rendering.

### Finding 4: Runtime fixture state says `Stripe Wise` is US but not active; `Test Stripe` is GB and active

- **Severity:** S2 evidence clarification
- **Type:** open question / likely fixture confusion
- **Confidence:** M-H; read-only probes succeeded for brand/account rows and Stripe account list
- **Broken journey step:** Latest operator description did not include the exact brand id used.
- **Evidence:**
  - Supabase read-only probe: `Test Stripe` / `teststripe` / brand `8f989994-1e6c-42c1-8754-78e1085a960d` has `stripe_account_id=acct_1TUvKxBWGYLKEAL8`, `country=GB`, `default_currency=GBP`, `charges_enabled=true`, `payouts_enabled=true`, no disabled reason.
  - Supabase read-only probe: `Stripe Wise` / `stripewise` has `country=US`, `default_currency=USD`, `disabled_reason=requirements.past_due`.
  - Supabase read-only probe: `Stripe Wise 2` / `stripewise2` has `country=US`, `default_currency=USD`, `disabled_reason=requirements.past_due`.
  - Stripe CLI read-only account list matches those country/status shapes.
- **Current behavior:** One old fixture is active/GB; newer US fixtures are restricted.
- **Expected behavior:** Test reports should name exact fixture. UI should not let old GB account feel like a fresh US setup.
- **Causal chain:** Without fixture identity, two truths can appear to conflict: Test Stripe "verified" because it is active GB; Stripe Wise "US" because it was created correctly but still restricted.
- **User impact:** Operator cannot tell whether country propagation is broken globally or they are looking at a pre-existing connected account.
- **Fix direction:** Add UI copy/diagnostics and edge mismatch errors; tester report must record brand id/account id/country.
- **Missing test or guardrail:** Runtime smoke prompt should require exact brand id + account id + country/status evidence.

## 8. Root Cause Proof

### RC-1: Edge reuse branch ignores country mismatch

- **File + line:** `supabase/functions/brand-stripe-onboard/index.ts:229-275`
- **Exact code/schema:** It selects `id, stripe_account_id, detached_at, country, default_currency`, then `if (existingSca?.stripe_account_id)` assigns `stripeAccountId = existingSca.stripe_account_id` and continues to Account Link creation.
- **What it does:** Reuses existing account no matter what country the request asked for.
- **What it should do:** If existing account exists, require `existingSca.country === requested country` or return a typed conflict/locked-country response.
- **Causal chain:** US request + GB existing row -> GB Account Link -> Stripe country appears UK.
- **Verification step:** Add a Deno/source or handler test that an existing `country: "GB"` row plus body `country: "US"` returns `409 country_locked` and does not call `createRecipientAccountLink`.

### RC-2: Payments active banner is suppressed by config

- **File + line:** `mingla-business/src/components/brand/BrandPaymentsView.tsx:75-95` and `238-274`
- **Exact code/schema:** `active: null`; render condition is `bannerConfig !== null`.
- **What it does:** Active state cannot show any banner.
- **What it should do:** Active should map to a success config with check icon and green/success styling.
- **Causal chain:** effective status active -> null config -> no green confirmation.
- **Verification step:** Add a focused helper/component test that live active status renders `You're connected to Stripe` and does not render `Onboarding submitted`.

### RC-3: Status invalidation does not cover the list cache used by the routes

- **File + line:** `useBrandStripeStatus.ts:63-71`, `useStartBrandStripeOnboarding.ts:49-53`, route files under `app/brand/[id]/payments*`
- **Exact code/schema:** Status invalidation covers `brand-stripe-status` and brand detail, while routes resolve brand from `useBrandList` backed by `brandKeys.list(accountId)` with 5-minute staleTime.
- **What it does:** Allows old list-derived `brand.stripeStatus` to survive after canonical status changes.
- **What it should do:** Payments/onboard route should use detail status or invalidate list cache after Stripe status settlement.
- **Causal chain:** canonical DB row updates -> detail/status invalidated -> list still old -> fallback status can remain onboarding while user returns to Payments.
- **Verification step:** Add tests around query invalidation and/or route status resolution; manually verify no second tap/wait is needed.

## 9. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|
| Secret material in local docs | `stripe-values.md` | File contains Stripe test keys; not quoted in this report | S2 | security gap |
| Country mismatch not typed | `brand-stripe-onboard/index.ts` | No `country_locked`/409 path | S1 | confirmed bug |
| Old product contract in comments | `BrandPaymentsView.tsx` | Header says active signal is KPIs, not green banner | S2 | UX gap |
| Cache invalidation partial | `useBrandStripeStatus.ts`, `useStartBrandStripeOnboarding.ts` | Detail/status invalidated; list cache route still used | S2 | production-hardening gap |
| Audit-log proof unavailable | Supabase CLI | audit query failed with temp-role auth/circuit-breaker error | S3 | evidence gap |

## 10. Blast Radius

- **Other flows affected:** Event publish gating reads `brand.stripeStatus`; stale brand list could affect publishability immediately after onboarding.
- **Mobile/business/admin/public parity:** This is `mingla-business` + Supabase edge only; consumer app/admin unaffected.
- **Query keys/cache/state involved:** `brandStripeStatusKeys.detail`, `brandKeys.detail`, `brandKeys.list`, `useBrandList`.
- **RLS/auth/permission implications:** Edge functions use service role but verify caller JWT and `biz_can_manage_payments_for_brand`; no new RLS bug found.
- **Integrations involved:** Stripe Accounts v2, Account Links, Stripe hosted onboarding, Stripe SDK account retrieval.
- **Deploy/migration implications:** No migration required for the proposed fix; deploy `brand-stripe-onboard`, maybe `brand-stripe-refresh-status` only if response shape changes, plus business web/native OTA bundle.
- **Recurring pattern:** One status truth is canonical in the edge/DB, but UI routes still lean on transitional list-cache shims.

## 11. Production Readiness Verdict

- **Ready / not ready:** Not ready for broad organiser payout onboarding until ORCH-0764C is fixed.
- **Launch blockers:** Silent country mismatch on existing account reuse; missing active success banner; stale list cache convergence risk.
- **Residual risks:** Exact latest smoke fixture identity is not recorded; Stripe/DB audit trail could not be queried due Supabase CLI temp-role auth issue.
- **Telemetry/monitoring gaps:** No structured event/log for requested country vs existing account country.
- **Missing tests:** Edge mismatch, active banner, status/list invalidation, route convergence.
- **Fastest next verification:** Implement ORCH-0764C, deploy edge + business app, then smoke two fixtures: fresh US brand and existing GB brand where user attempts US.

## 12. Discoveries For Orchestrator

- `stripe-values.md` contains raw Stripe test keys. Recommended separate security hygiene follow-up: move secrets into local env/keychain and replace the file with redacted placeholders or delete it after confirming no process depends on it.

## 13. Recommended Next Step

Proceed to implementation from `specs/SPEC_ORCH-0764C_STRIPE_COUNTRY_AND_ACTIVE_STATUS_SYNC.md`. This is a bounded rework, not a fresh architecture cycle.
