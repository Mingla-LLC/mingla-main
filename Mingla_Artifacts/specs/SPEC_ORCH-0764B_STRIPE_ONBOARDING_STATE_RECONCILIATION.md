# SPEC ORCH-0764B — Stripe Onboarding State Reconciliation

**Date:** 2026-05-09  
**Owner:** `$implementor` next  
**Depends on:** `INVESTIGATION_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`  
**Goal:** Make Stripe onboarding, verification remediation, app copy, and status ownership agree end-to-end.

## Product Promise

When a brand admin or finance manager sets up Stripe:

1. Mingla opens the correct Stripe-hosted Account Link.
2. If Stripe needs more information, Mingla says exactly that and gives one clear "continue verification" action.
3. The Payments page never shows contradictory "verifying" and "overdue" states at the same time.
4. Returning from Stripe triggers a bounded refresh of Stripe account state before Mingla labels the outcome.

## Non-Goals

- Do not switch to legacy `/v1/accounts` account creation.
- Do not reintroduce embedded Connect components for the primary native flow.
- Do not change Stripe API key/env handling except where needed for tests.
- Do not implement payment checkout / destination charges in this spec.
- Do not solve all Vercel project metadata issues in app code; document deploy requirement and verify route availability.

## Required Changes

### 1. Payments Page: Single Effective Stripe Status

**File:** `mingla-business/src/components/brand/BrandPaymentsView.tsx`

Create an effective status:

```ts
const liveStripeStatus = stripeStatusQuery.data?.status;
const stripeStatus = liveStripeStatus ?? brand?.stripeStatus ?? "not_connected";
```

Rules:

- Use this `stripeStatus` for the main banner, remediation card gating, bank section gating, and all status decisions.
- Keep cached `brand.stripeStatus` only as a fallback while live query is loading.
- If live query errors, show cached status but expose a non-blocking "Could not refresh Stripe status" affordance or log; do not silently pretend status is fresh.

Acceptance:

- A brand whose cache says `onboarding` but live query says `restricted` renders only the restricted/remediation surface, not "Onboarding submitted — verifying."

### 2. Replace Generic Express Login With Account Link Continuation

**File:** `mingla-business/src/components/brand/BrandPaymentsView.tsx`

Delete restricted remediation dependency on:

```ts
Linking.openURL("https://connect.stripe.com/express_login")
```

Instead:

- Route all actionable requirement CTAs to `onOpenOnboard`.
- This includes:
  - restricted banner CTA
  - `BrandStripeKycRemediationCard` CTA
  - `BrandStripeDeadlineBanner` CTA
  - `BrandStripeBankSection` resolve CTA if it is requirement/remediation oriented

Copy:

- Restricted banner CTA should be "Continue verification" or use the remediation card label.
- Avoid "Resolve" as the primary label; it is too vague.

Acceptance:

- Tapping **Resume verification** or equivalent navigates to `/brand/[id]/payments/onboard`.
- The onboarding shell calls `brand-stripe-onboard` and receives a fresh Account Link for the existing Stripe account.
- No user-facing remediation path opens bare `https://connect.stripe.com/express_login`.

### 3. Onboarding Shell: Split Restricted Into Actionable vs Terminal

**File:** `mingla-business/src/components/brand/BrandOnboardView.tsx`

Add a new view state:

```ts
"needs-information"
```

Mapping:

- `status === "active"` -> `complete-active`
- `status === "onboarding"` -> `complete-verifying`
- `status === "restricted"` with `requirements.disabled_reason` in:
  - `requirements.past_due`
  - `action_required.requested_capabilities`
  - `requirements.pending_verification`
  - or non-empty `currently_due` / `past_due`
  -> `needs-information`
- `status === "restricted"` with terminal Stripe rejection:
  - `rejected.fraud`
  - `rejected.listed`
  - `rejected.other`
  - `rejected.terms_of_service`
  -> `failed-stripe`

User copy for `needs-information`:

- Title: **More information needed**
- Body: **Stripe needs a few more details before payments can be enabled. Continue verification to finish setup.**
- Primary CTA: **Continue verification**
- Secondary: **Back to payments**

Implementation preference:

- Reuse or share the existing KYC remediation mapping from `stripeKycRemediationMessages.ts` so modal and payments page do not diverge.

Acceptance:

- A refresh response with `requirements.disabled_reason=requirements.past_due` never renders "Stripe couldn't verify."
- A terminal rejection still renders a failure/contact-support state.

### 4. Post-Stripe Return: Bounded Status Settlement

**Files:**

- `mingla-business/src/components/brand/BrandOnboardView.tsx`
- optionally a small helper under `mingla-business/src/utils/stripeStatusSettlement.ts`

After `WebBrowser.openAuthSessionAsync` returns:

1. Invalidate `brandStripeStatusKeys.detail(brand.id)`.
2. Refetch immediately.
3. If result is not final/actionable, poll/refetch for a bounded window:
   - every 2 seconds
   - up to 30 seconds
   - stop on `active`, `restricted`, or stable `onboarding` after final attempt

Do not infinite-loop.

Outcome mapping:

- `active` -> complete.
- `restricted` -> `needs-information` or `failed-stripe` via rule above.
- `onboarding` -> submitted/verifying.
- `not_connected` -> session expired / try again.
- browser cancel/dismiss before redirect -> cancelled unless the bounded refresh proves active/restricted/onboarding.

Acceptance:

- A delayed second refresh can correct the modal before it shows a final false failure.
- Test covers first refresh stale, second refresh restricted.

### 5. Status Derivation Parity Fix

**Files:**

- New migration under `supabase/migrations/` with prefix greater than current max migration version.
- `mingla-business/src/utils/deriveBrandStripeStatus.ts`
- `mingla-business/src/utils/__tests__/deriveBrandStripeStatus.test.ts`

Current max observed migration prefix includes `20260515000005`; use a prefix greater than that, for example:

```text
20260515000006_orch_0764b_stripe_status_derivation_parity.sql
```

Update SQL `pg_derive_brand_stripe_status` to match TS and product expectation:

1. no row -> `not_connected`
2. `detached_at IS NOT NULL` -> `not_connected`
3. `requirements.disabled_reason` present -> `restricted`
4. `charges_enabled = true` -> `active`
5. else -> `onboarding`

Update comments to stop claiming false parity.

Acceptance:

- SQL and TS both return `restricted` for `charges_enabled=true + disabled_reason=rejected.fraud`.
- Existing active/onboarding/not_connected cases still pass.

### 6. Account Link Return/Refresh Deployment Contract

**Files:**

- `mingla-business/app/stripe-onboarding-return.tsx`
- `docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md` or ORCH-0764B report update

Requirements:

- Verify `https://business.usemingla.com/stripe-onboarding-return` returns HTTP 200 from the deployed web app.
- If CLI Vercel project metadata is broken, document exact manual/GitHub deploy path and do not mark runtime ready until deployed.
- For refresh URLs, minimum acceptable behavior is redirecting to app with `stripe_onboarding_refresh=1` and showing Continue verification.
- Preferred follow-up: app handles `stripe_onboarding_refresh=1` by immediately creating a fresh Account Link.

Acceptance:

- `curl -I https://business.usemingla.com/stripe-onboarding-return` returns 200 or app shell equivalent, not Vercel 404.
- A Stripe return from Account Link can bounce through HTTPS relay into the app.

## Tests To Add Or Update

### Mingla Business Jest

Add/update tests for:

1. `deriveBrandStripeStatus.test.ts`
   - SQL parity-described case: `charges_enabled=true + disabled_reason` expected `restricted`.

2. New `BrandPaymentsView` test, if component test harness exists; otherwise create a narrow pure helper:
   - Input: cached status `onboarding`, live status `restricted`.
   - Expected effective status: `restricted`.

3. New onboarding outcome helper test:
   - `requirements.past_due` -> `needs-information`.
   - `rejected.fraud` -> `failed-stripe`.
   - `currently_due` non-empty -> `needs-information`.

4. `onboardReactivation.test.ts`
   - Existing account path still calls `brand-stripe-onboard`.
   - Continue/resume path passes country and app return URL.

Commands:

```bash
cd mingla-business
npx jest deriveBrandStripeStatus.test onboardReactivation.test
npx tsc --noEmit --pretty false
```

### Supabase Deno Tests

Add/update:

- `brand-stripe-onboard/index.test.ts`: existing account reuse + HTTPS relay retained.
- SQL migration verification may be via a local SQL test/probe if available; otherwise document manual SQL probe after `supabase db push`.

Commands:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write \
  _shared/__tests__/stripeBlueprintClient.test.ts \
  brand-stripe-onboard/index.test.ts \
  brand-mingla-tos-accept/index.test.ts
/Users/sethogieva/.deno/bin/deno check \
  brand-stripe-onboard/index.ts \
  brand-stripe-refresh-status/index.ts \
  _shared/stripeBlueprintClient.ts
```

### Manual Device QA

1. Use brand `Stripe Wise` or `Stripe Wise 2`.
2. Confirm Payments screen does not show both "Onboarding submitted — verifying" and "Verification overdue."
3. Tap **Continue verification**.
4. Confirm app opens a fresh Stripe-hosted `connect.stripe.com` Account Link.
5. Click Save for later / complete partial test onboarding.
6. Confirm app returns to either:
   - **More information needed**, with Continue verification, or
   - **Submitted to Stripe**, or
   - **Set up complete**
7. Confirm no path shows "Stripe couldn't verify" for ordinary `requirements.past_due`.

## Deployment Order

1. Implement app changes.
2. Add migration for SQL status parity.
3. Run local Jest/TypeScript/Deno gates.
4. `supabase db push` for the migration.
5. Deploy affected edge functions if changed:
   - `brand-stripe-onboard`
   - `brand-stripe-refresh-status` only if edited
6. Deploy `mingla-business` web so `/stripe-onboarding-return` exists on `business.usemingla.com`.
7. EAS update or dev-client reload for JS-only app changes.
8. Device retest.

## Rollback Safety

- App copy/CTA changes are JS-only and can be reverted by OTA/dev bundle.
- SQL derivation migration changes status classification; rollback requires another `CREATE OR REPLACE FUNCTION` migration, not manual editing.
- Edge account-link creation remains idempotent per existing `generateIdempotencyKey`; do not change idempotency key inputs in this spec.

## Success Criteria

| ID | Criterion |
|---|---|
| SC-1 | Payments page uses one effective status and never shows verifying + overdue simultaneously. |
| SC-2 | All verification-remediation CTAs create/open a fresh Account Link through `brand-stripe-onboard`. |
| SC-3 | `requirements.past_due` renders "More information needed" / "Continue verification," not "Stripe couldn't verify." |
| SC-4 | Terminal rejection reasons still render failure/contact-support state. |
| SC-5 | Return from Stripe triggers bounded refresh before final UI classification. |
| SC-6 | SQL and TS status derivation agree on `charges_enabled=true + disabled_reason`. |
| SC-7 | `business.usemingla.com/stripe-onboarding-return` is deployed and reachable. |
| SC-8 | Device QA on one test brand can repeatedly resume verification without browser/app disagreement. |

