# INVESTIGATION ORCH-0764B — Stripe Onboarding State Reconciliation

**Date:** 2026-05-09  
**Mode:** `$forensics` INVESTIGATE-THEN-SPEC  
**Surface:** `mingla-business` Stripe Connect onboarding / payments remediation  
**Verdict:** CONFIRMED BUGS + UX GAP; not ready to close ORCH-0764A runtime until implemented and retested.

## Executive Summary

The browser and Mingla app disagree because Mingla currently has **two status truths** and **two remediation entry points**:

1. `BrandPaymentsView` renders its main banner from cached `brand.stripeStatus`, derived from `brands.stripe_*` columns that do **not** carry Stripe `requirements`.
2. The KYC remediation card renders from `useBrandStripeStatus().requirements`, which does carry `requirements.disabled_reason`.
3. The onboarding shell treats `restricted` as `failed-stripe`, even when Stripe is simply asking for more required fields.
4. The restricted/remediation CTA opens generic `https://connect.stripe.com/express_login`, while the onboarding CTA creates a fresh Stripe Account Link through `brand-stripe-onboard`.

Stripe's hosted-onboarding guidance says return URL completion does **not** mean onboarding is complete; the platform must retrieve the account / requirements afterward and prompt the user to continue onboarding if incomplete. The current Mingla UX partially does that, but labels and routes the state inconsistently.

## User Symptom

Screenshots show:

- Payments screen top banner: **"Onboarding submitted — verifying"** with **Finish onboarding**.
- Same screen red card: **"Verification overdue"** with **Resume verification**.
- Browser opens `connect.stripe.com` in Stripe-hosted onboarding.
- On returning through the onboarding shell, Mingla shows **"Stripe couldn't verify"**.

The user asks why the browser says continue onboarding while Mingla says failed / overdue.

## Current Data Proof

Live DB probe for the two test brands:

| Brand | Brand ID | Stripe account | Requirements | Derived status |
|---|---|---|---|---|
| Stripe Wise 2 | `81fd06bc-f31d-43e2-8189-b5a2a297cfee` | `acct_1TUzsvPjlZplCVEZ` | `disabled_reason=requirements.past_due`; `currently_due` includes business profile, representative, external account, ToS | `restricted` |
| Stripe Wise | `e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd` | `acct_1TV06aPjlZ3e5YTo` | same requirement family | `restricted` |

This proves the red **Verification overdue** card is based on real Stripe data, not stale UI fiction.

## Source Evidence

### E1 — Payments screen uses cached status for main banner

`mingla-business/src/components/brand/BrandPaymentsView.tsx`

- Lines 90-122 define banner copy by `BrandStripeStatus`.
- Lines 189-190 set `stripeStatus = brand?.stripeStatus ?? "not_connected"`.
- Lines 304-311 wire the banner CTA. Restricted routes to `handleResolveBanner`, not onboarding.

Because `brand.stripeStatus` comes from the `brands` cache, it can show `onboarding` while live Stripe requirements say `restricted`.

### E2 — Remediation card uses live requirements, not the cached banner status

`mingla-business/src/components/brand/BrandPaymentsView.tsx`

- Lines 326-350 use `stripeStatusQuery.data?.requirements`.
- `BrandStripeKycRemediationCard` chooses `requirements.disabled_reason`, then `past_due`, then `currently_due`.
- `stripeKycRemediationMessages.ts` maps `requirements.past_due` to **Verification overdue**.

This explains why the top banner and red card can disagree on the same screen.

### E3 — Restricted CTA opens a generic Stripe Express login URL

`mingla-business/src/components/brand/BrandPaymentsView.tsx`

- Lines 169-182 call `Linking.openURL("https://connect.stripe.com/express_login")`.

That is not the same as the app-controlled Account Link flow. It can open outside the app's auth-session return path and does not guarantee the app gets a clean completion signal.

### E4 — Onboarding shell treats restricted as failure

`mingla-business/src/components/brand/BrandOnboardView.tsx`

- Lines 166-180: while in flight, `status === "restricted"` sets `failed-stripe`.
- Lines 213-232: after browser success, `status === "restricted"` sets `failed-stripe`.
- UI copy says **Stripe couldn't verify**.

But for `requirements.past_due` / due fields, restricted is usually actionable remediation, not a terminal app failure.

### E5 — Refresh endpoint does retrieve Stripe account state

`supabase/functions/brand-stripe-refresh-status/index.ts`

- Lines 128-163 read the existing connected account row and retrieve the Stripe account.
- Lines 176-184 update `charges_enabled`, `payouts_enabled`, and `requirements`.
- Lines 195-235 derive and return status plus requirements.

So the backend has the right raw truth available; the frontend is not consuming it coherently.

### E6 — SQL/TS derivation order is inconsistent

SQL helper:

`supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql`

- Lines 67-72: SQL returns `active` before checking `requirements.disabled_reason`.

TS helper:

`mingla-business/src/utils/deriveBrandStripeStatus.ts`

- Lines 52-57: TS returns `restricted` before checking `charges_enabled`.

Current test data has `charges_enabled=false`, so the mismatch is not causing this exact screenshot. But it is a latent parity bug: an account with `charges_enabled=true` plus `disabled_reason` would be `active` in SQL and `restricted` in TS.

### E7 — Stripe hosted onboarding confirms our product interpretation

Stripe documentation says:

- Account Links require return and refresh URLs and redirect the account user back when they complete the flow or click Save for later.
- That redirect does **not** mean all information has been collected.
- Platforms should retrieve the account / requirements after return.
- If onboarding is incomplete, the app should prompt the account user to continue onboarding later through a new Account Link.
- Refresh URLs should create a new Account Link and redirect the user back to onboarding.

Sources:

- https://docs.stripe.com/connect/marketplace/tasks/onboard
- https://docs.stripe.com/connect/hosted-onboarding
- https://docs.stripe.com/connect/express-accounts
- https://docs.stripe.com/api/accounts/login_link/create

## Root Causes

### RC-1 — Mixed status ownership on Payments screen

**File/lines:** `BrandPaymentsView.tsx:189-190`, `BrandPaymentsView.tsx:326-350`  
**Current behavior:** Main banner uses cached brand status; remediation card uses live requirements.  
**Expected behavior:** The Payments page should derive one effective status from `useBrandStripeStatus.data.status` when available, falling back to cached `brand.stripeStatus` only while live status is loading.  
**Causal chain:** `brands.stripe_*` cache cannot store requirements -> cache maps `charges_enabled=false` to `onboarding` -> live query sees `requirements.disabled_reason=requirements.past_due` -> UI shows both "verifying" and "verification overdue."  
**Verification step:** Mock or fixture a brand with cached `stripeStatus=onboarding` and live query `status=restricted`; expect only restricted/remediation UI.

### RC-2 — Restricted remediation uses generic Express login, not Account Link continuation

**File/lines:** `BrandPaymentsView.tsx:169-182`, `BrandPaymentsView.tsx:304-311`  
**Current behavior:** `Resume verification` opens `https://connect.stripe.com/express_login` outside the app-controlled Account Link flow.  
**Expected behavior:** For `requirements.past_due`, `currently_due`, or `eventually_due`, CTA should route to the same onboarding shell / Account Link creation path as `Finish onboarding`.  
**Causal chain:** Generic Express login is a dashboard surface; Account Link is the onboarding/remediation surface -> generic login can open outside Mingla's return/refetch lifecycle -> browser/app state drifts.  
**Verification step:** Tap restricted CTA; assert `brand-stripe-onboard` is invoked and a fresh `connect.stripe.com` account-link URL opens via `WebBrowser.openAuthSessionAsync`.

### RC-3 — Onboarding shell labels actionable requirements as terminal failure

**File/lines:** `BrandOnboardView.tsx:166-180`, `BrandOnboardView.tsx:213-232`  
**Current behavior:** Any `restricted` state after Stripe return becomes `failed-stripe` with "Stripe couldn't verify."  
**Expected behavior:** Requirement-driven restricted states should become an actionable `needs-information` state with copy like "More information needed" and CTA "Continue verification." Only rejection/fraud/TOS rejection should be terminal failure/contact-support.  
**Causal chain:** The modal has one `failed-stripe` bucket for both terminal rejection and normal KYC remediation -> user sees failure while Stripe is inviting them to continue.  
**Verification step:** Stub refresh response `status=restricted`, `requirements.disabled_reason=requirements.past_due`; modal must show "More information needed," not "Stripe couldn't verify."

### RC-4 — Return/refetch lifecycle is too brittle for delayed Stripe/webhook state

**File/lines:** `BrandOnboardView.tsx:207-211`  
**Current behavior:** After browser closes, the app invalidates once and refetches once.  
**Expected behavior:** On return/dismiss from Stripe, poll refresh status for a short bounded window, because Stripe/webhook propagation can lag.  
**Causal chain:** Account Link redirects do not guarantee all requirements are done; webhook and retrieve timing may lag -> one refetch can classify a still-updating account as cancelled/failed.  
**Verification step:** Simulate first refresh `onboarding`, second refresh `restricted/active`; modal should settle to final actionable state within the bounded poll.

### RC-5 — SQL/TS status derivation parity is not actually preserved

**Files/lines:** SQL `20260508000000...sql:67-72`, TS `deriveBrandStripeStatus.ts:52-57`  
**Current behavior:** SQL checks `charges_enabled=true` before requirements; TS checks requirements first.  
**Expected behavior:** One canonical order, documented and tested in both layers. Recommended: `detached -> restricted if disabled_reason -> active if charges_enabled -> onboarding`.  
**Causal chain:** Test suite says SQL and TS are twins, but they diverge in a rare but important state.  
**Verification step:** SQL probe and TS test for `charges_enabled=true + disabled_reason=rejected.fraud` must both return `restricted`.

## Side Discoveries

### SD-1 — Web relay route deploy remains a production dependency

The edge function now sends Stripe HTTPS return URLs through `/stripe-onboarding-return`. Local Expo export includes this route, but Vercel production deploy was blocked by project-root metadata. Final browser return from Stripe depends on `https://business.usemingla.com/stripe-onboarding-return` being deployed.

### SD-2 — Account Link refresh URL is currently only a passive relay

Stripe expects `refresh_url` to create a new Account Link and redirect back to onboarding. The current relay route redirects back to the app with `stripe_onboarding_refresh=1`; the app does not yet parse that event to auto-create a new link. This is acceptable for a minimum fix if the app shows "Continue verification," but it is not a seamless refresh-url implementation.

### SD-3 — Requirement copy is useful but not connected to the onboarding modal

`BrandStripeKycRemediationCard` has friendly requirement-specific copy. `BrandOnboardView` does not reuse it, so the modal loses the detail that the Payments page already has.

## Blast Radius

Affected:

- `mingla-business/src/components/brand/BrandPaymentsView.tsx`
- `mingla-business/src/components/brand/BrandOnboardView.tsx`
- `mingla-business/src/hooks/useBrandStripeStatus.ts`
- `mingla-business/src/services/brandStripeService.ts`
- `mingla-business/src/utils/deriveBrandStripeStatus.ts`
- `supabase/functions/brand-stripe-refresh-status/index.ts`
- `supabase/functions/brand-stripe-onboard/index.ts`
- `supabase/migrations/*pg_derive_brand_stripe_status*`
- Vercel deployment for `mingla-business/app/stripe-onboarding-return.tsx`

Not directly affected:

- Stripe checkout/payment collection blueprint once connected account is active.
- Consumer app `app-mobile`.
- Admin, except future support tooling may need visibility into restricted requirements.

## Production Readiness

Current state is **not ready to close** because:

- Two status truths are rendered on the same Payments screen.
- A remediation CTA bypasses the Account Link lifecycle.
- Restricted KYC remediation is mislabeled as verification failure.
- Return/refresh URL web deployment remains unverified.
- SQL/TS derivation parity claim is false in one edge case.

