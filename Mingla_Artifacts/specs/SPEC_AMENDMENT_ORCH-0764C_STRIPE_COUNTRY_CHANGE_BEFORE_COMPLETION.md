# Spec Amendment: Stripe Country Change Before Onboarding Completion (ORCH-0764C)

> Date: 2026-05-09  
> Supersedes: implementor prompt `prompts/IMPLEMENTOR_ORCH-0764C_STRIPE_COUNTRY_AND_ACTIVE_STATUS_SYNC.md`  
> Amends: `specs/SPEC_ORCH-0764C_STRIPE_COUNTRY_AND_ACTIVE_STATUS_SYNC.md`  
> Evidence base: `reports/INVESTIGATION_ORCH-0764C_STRIPE_COUNTRY_AND_ACTIVE_STATUS_SYNC.md` + current code/schema readback  
> Status: ready for orchestrator review, then implementor dispatch

## 1. Plain-English Summary

The previous ORCH-0764C spec was too strict for the product contract the operator wants.

The intended user promise is:

> If I picked the wrong country and have not completed Stripe onboarding yet, I can change the country in Mingla and Stripe will use the new country.

Stripe account country itself is immutable, so Mingla cannot update the existing Stripe account from UK to US. The correct repair is to treat an incomplete/no-money connected account as replaceable: abandon/detach the old incomplete account, create a new connected account with the newly selected country, and then open the new Stripe onboarding link.

Once the account is completed or money-risky, the country/currency becomes locked for that brand. This must **not** look like a Stripe problem in the normal success state: completed onboarding should show the green `You're connected to Stripe` confirmation. Lock guidance appears only when the user tries to change country/currency after completion, and the recommended product guidance is to create a new brand for a different country/currency.

This amendment preserves the original ORCH-0764C requirements for the green active Payments banner and stale-status/cache convergence.

## 2. Proven Current Behavior

### Facts

- `BrandStripeCountryPicker` emits the selected country via `onChange(code)`.
- `BrandOnboardView` passes `country: selectedCountry` into `useStartBrandStripeOnboarding`.
- `brandStripeService.startBrandStripeOnboarding` sends `{ brand_id, return_url, country }` and still defaults missing country to `GB`.
- `brand-stripe-onboard` validates the requested country through `normalizeStripeCountry`.
- New account creation passes that requested country to Stripe Accounts v2 as `identity.country`.
- Existing account reuse does not compare `existingSca.country` to the requested country.
- Current create-account idempotency key is `generateIdempotencyKey(brand_id, "onboard_create")`, which is not country-specific.

### Implications

The app can send `US` correctly, but if a `GB` account already exists for that brand, the edge function reuses it and creates an Account Link for the `GB` account.

Even if implementor changes the branch to "create a new account on mismatch," the current brand-level idempotency key can still replay the prior account creation. The replacement flow must use a country/replacement-aware idempotency key.

## 3. Stripe Source Constraints

Official Stripe docs establish the key constraints:

- Express accounts: Stripe says to select the country when creating the connected account and says the country cannot be changed later. Source: <https://docs.stripe.com/connect/accounts>
- Custom onboarding docs state that immutable fields such as country require creating a new connected account with the new values. Source: <https://docs.stripe.com/connect/custom/onboarding>
- Hosted onboarding return URLs are not proof that all information has been collected; after return, the platform must retrieve/check the account, including `details_submitted` and `charges_enabled`. Source: <https://docs.stripe.com/connect/express-accounts>
- Stripe delete account docs say test-mode accounts can be deleted at any time; live-mode deletions depend on account type/liability and zero balances. Source: <https://docs.stripe.com/api/accounts/delete>

Inference from these sources: Mingla should not attempt to update a connected account country. To honor a corrected country before completion, Mingla must create a replacement connected account.

## 4. Revised Product Contract

### Country Editable State

Country remains editable while the current connected account is replaceable.

A connected account is **replaceable** only when all of these hold:

1. Existing saved country differs from the newly requested country.
2. The account is not detached into a historical state that should simply be ignored.
3. Fresh Stripe retrieval does not report `details_submitted === true`.
4. Fresh Stripe retrieval does not report `charges_enabled === true`.
5. Fresh Stripe retrieval does not report `payouts_enabled === true`.
6. Local Mingla money/audit checks show no money movement tied to the old account.
7. Stripe account deletion or local-abandonment preflight does not indicate non-zero balance or another unsafe state.

### Country/Currency Locked State

Country/currency is locked when any of these are true:

1. `details_submitted === true`.
2. `charges_enabled === true`.
3. `payouts_enabled === true`.
4. Stripe delete/replacement preflight is rejected due to balance, liability, account access, or unknown Stripe error.
5. Mingla has local money rows tied to the account or brand, including any of:
   - `payouts` rows for the brand.
   - `mingla_revenue_log` rows with the old `stripe_account_id`.
   - `orders` rows for the brand's events with `stripe_payment_intent_id` or `stripe_charge_id`.
   - future checkout/payment records once ORCH-0764B checkout ships.

### Completed Account UX

When the account is active/completed, the Payments page must show a positive connected state:

- Green/check title: `You're connected to Stripe`.
- No `Onboarding submitted — verifying` banner.
- No default error/support framing.

If the user later tries to change country or currency for that completed brand, Mingla should explain that Stripe setup is tied to the brand's original country/currency and that they should create a new brand for a different country/currency.

### Details On Restricted Accounts

`requirements.disabled_reason = "requirements.past_due"` alone must **not** automatically lock country/currency.

Reason: brand-new or abandoned onboarding can already have past-due requirements before the user has completed KYC. The stronger lock signal is `details_submitted === true`, money enablement, or money movement.

If Stripe retrieval lacks `details_submitted`, implementor must treat the account as **not safely replaceable** unless another source proves it is pre-completion. This avoids destructive assumptions.

## 5. Data / Schema Implications

### Required Minimal Path

No migration is strictly required if implementor uses the existing single `stripe_connect_accounts` row per brand and preserves old-account identity in `audit_log`.

The minimal implementation may update the existing row from old account to replacement account after a successful replacement:

- `stripe_account_id = newStripeAccountId`
- `country = requestedCountry`
- `default_currency = defaultCurrencyForCountry(requestedCountry)`
- `charges_enabled = false`
- `payouts_enabled = false`
- `requirements = {}`
- `detached_at = null`
- `updated_at = now()`

Audit must record the old account id and new account id.

### Optional More Durable Path

If implementor determines webhook/history safety requires multiple `stripe_connect_accounts` rows per brand, a migration is allowed but must be explicitly justified in the implementation report.

That migration would need to:

- Replace the current unique `brand_id` index with a partial unique active-account constraint, e.g. one row per brand where `detached_at IS NULL`.
- Update every `.maybeSingle().eq("brand_id", brandId)` reader to select only the active row or order deterministically.
- Update webhook `upsert(..., { onConflict: "brand_id" })`, because it currently depends on one row per brand.
- Use a migration filename greater than local max `20260515000007` and the linked remote head.

Given blast radius, the recommended first implementation is the **minimal path** with audit-preserved old account id, not the multi-row schema refactor.

## 6. Edge Function Contract

### `brand-stripe-onboard`

File:

- `supabase/functions/brand-stripe-onboard/index.ts`

Current mismatch branch must be replaced with a replacement-aware branch.

#### Read Existing Row

Select at least:

- `id`
- `brand_id`
- `stripe_account_id`
- `detached_at`
- `country`
- `default_currency`
- `charges_enabled`
- `payouts_enabled`
- `requirements`

#### Same Country

If existing active row exists and `existingSca.country === requestedCountry`, reuse it exactly as today, including detached reactivation behavior where appropriate.

#### Detached / Historical Row With Different Country

If row exists but `detached_at IS NOT NULL` and requested country differs:

- Do not reactivate old country.
- Treat as a fresh replacement create using requested country.
- Update the existing row to the new account id/country after successful create.

#### Active Row With Different Country

If row exists, `detached_at IS NULL`, and country differs:

1. Retrieve fresh Stripe account state for the old account.
2. Evaluate replaceability using the lock rules in section 4.
3. Query local money movement:
   - `payouts` by `brand_id`.
   - `mingla_revenue_log` by old `stripe_account_id`.
   - `orders` joined/filtered through brand events where `stripe_payment_intent_id IS NOT NULL OR stripe_charge_id IS NOT NULL`.
4. If unsafe, return:
   ```json
   {
     "error": "country_locked",
     "detail": "stripe_account_country_locked_after_onboarding",
     "existing_country": "GB",
     "requested_country": "US",
     "reason": "details_submitted"
   }
   ```
   Use HTTP `409`.
5. If replaceable:
   - Best-effort delete the old Stripe account using the existing Stripe SDK account delete path or a shared helper.
   - If Stripe delete is rejected in a way that suggests balance/unsafe state, return `409 country_locked` and do not create a replacement.
   - If deletion succeeds, create a replacement Accounts v2 account with the requested country.
   - Update the existing SCA row to the replacement account id and requested country.
   - Create Account Link for the replacement account.

#### Idempotency Requirement

The replacement/fresh account creation idempotency key must include the requested country and replacement context.

Required shape conceptually:

```ts
generateIdempotencyKey(
  brand_id,
  `onboard_create:${requestedCountry}:${oldStripeAccountId ?? "none"}`,
)
```

The exact helper can differ, but this invariant must hold:

> A previous `GB` account creation must not be replayed when the user requests `US`.

Account Link idempotency should also include the account id or requested country so a replacement account does not get an Account Link intended for the old account.

#### Audit

Write audit events for:

- `stripe_connect.country_change_replaced_before_completion`
- `stripe_connect.country_change_locked`

Replacement audit `before` must include:

- old `stripe_account_id`
- old `country`
- old `charges_enabled`
- old `payouts_enabled`
- old `requirements.disabled_reason` if present

Replacement audit `after` must include:

- new `stripe_account_id`
- requested `country`
- new `default_currency`
- Stripe delete outcome for old account

Do not include secrets or PII.

### `brand-stripe-refresh-status`

Recommended response widening:

```ts
{
  status,
  charges_enabled,
  payouts_enabled,
  requirements,
  detached_at,
  stripe_account_id,
  country,
  default_currency,
  details_submitted
}
```

Persisting `details_submitted` is optional in the minimal path, but returning it from live Stripe retrieval helps the UI explain country editability.

If `details_submitted` is not persisted, the replacement gate in `brand-stripe-onboard` must still retrieve fresh Stripe account state before replacement.

## 7. Business UI Contract

### `BrandOnboardView`

Country picker behavior:

- Before any account exists: editable.
- Existing account, same selected country, incomplete: editable only if user can still choose a different country and trigger replacement.
- Existing account, different selected country, replaceable: show copy explaining a new Stripe account will be created for the new country before opening Stripe.
- Existing account locked: show read-only country and explain that a different country/currency requires creating a new brand.

Suggested copy:

- Replaceable state:
  - `You can still change country because Stripe setup is not complete. We'll create a new Stripe setup for {Country}.`
- Locked state:
  - `Stripe is connected for {Country}. To use a different country or currency, create a new brand.`

If `brand-stripe-onboard` returns `country_locked`, keep the user on the onboarding screen and show the locked copy.

### `BrandStripeCountryPicker`

May add props:

```ts
locked?: boolean;
helperText?: string;
warningText?: string;
```

But do not lock simply because a row exists. Lock only when the account is not replaceable.

### `BrandPaymentsView`

Original ORCH-0764C active banner requirement remains:

- Active status renders green/check title `You're connected to Stripe`.
- Active status does not render `Onboarding submitted — verifying`.
- Onboarding/restricted/not_connected do not render active success.
- Optional info copy may explain that country/currency is fixed for this brand after successful Stripe connection, but it must not replace or visually compete with the success banner.

## 8. Cache / State Contract

Preserve original ORCH-0764C cache requirements:

- `useStartBrandStripeOnboarding` success invalidates:
  - `brandStripeStatusKeys.detail(brandId)`
  - brand detail
  - all brand lists
- `useBrandStripeStatus` realtime invalidation also invalidates brand detail and lists.
- Payments/onboard routes should prefer brand detail query rather than 5-minute list cache.

Replacement-specific cache requirement:

- After country replacement, invalidate status/detail/list immediately so the UI cannot keep showing the old country/account id.

No Zustand writes for Stripe server state.

## 9. Tests

### Edge Deno Tests

Add/update tests for `brand-stripe-onboard`:

1. Fresh no-account `US` request creates account with `US`.
2. Existing incomplete `GB` account + requested `US`:
   - retrieves old account,
   - evaluates replaceable,
   - deletes old account or confirms delete path,
   - creates replacement with `US`,
   - updates SCA row to `US`,
   - creates Account Link for new account.
3. Existing `GB` account with `details_submitted=true` + requested `US` returns `409 country_locked`.
4. Existing `GB` account with `charges_enabled=true` returns `409 country_locked`.
5. Existing `GB` account with `payouts_enabled=true` returns `409 country_locked`.
6. Existing `GB` account with brand payout/revenue/order money rows returns `409 country_locked`.
7. Stripe delete rejection returns `409 country_locked` and does not create a replacement account.
8. Idempotency keys for `GB` and `US` account creation differ.

### Business Jest Tests

Add/update:

1. Country picker remains editable when account is incomplete/replaceable.
2. Country picker locks when account is active/completed.
3. `country_locked` service error maps to user-visible create-a-new-brand copy.
4. Active Payments banner renders `You're connected to Stripe`.
5. Active status does not render verifying copy.
6. Cache invalidation includes status, brand detail, and brand lists after onboarding/replacement.

### Manual Tester Gates

Tester must verify with two fixtures:

1. Incomplete UK setup:
   - start with UK,
   - cancel before completion,
   - change picker to US,
   - continue,
   - Stripe shows US onboarding.
2. Active/completed UK setup:
   - change picker to US,
   - app refuses with locked-country copy,
   - Stripe does not open a US replacement.

## 10. Implementation Order

1. Add helpers for country replacement lock/replacement decision in edge function or shared local module.
2. Add country/replacement-aware idempotency key helper.
3. Add Stripe account retrieve/delete dependency needed by replacement branch.
4. Update `brand-stripe-onboard` mismatch branch.
5. Add Deno tests for replacement, locks, delete rejection, and idempotency.
6. Widen `brand-stripe-refresh-status` response if needed for UI.
7. Update service/hook types and error parsing.
8. Update onboarding UI country editable/locked states.
9. Add active Payments success banner.
10. Tighten status/list invalidation and route brand source.
11. Add business Jest tests.
12. Run verification.
13. Deploy changed edge functions and business app/web bundle after orchestrator/user approval.

## 11. Deploy / Migration Notes

Expected deploy targets:

- `brand-stripe-onboard`: required.
- `brand-stripe-refresh-status`: required if response shape changes.
- `mingla-business`: required for UI/cache/banner changes.

Expected DB migration:

- Minimal path: none.
- Durable multi-row account-history path: migration required; filename must be greater than `20260515000007` and remote head.

Do not run `supabase db push` unless implementation chooses and justifies a migration.

## 12. Rollback / Data Risk

Rollback of minimal path:

- Revert edge/UI code.
- Any replacement accounts already created remain in Stripe and local SCA row points to the newest account.
- Audit log should preserve old account id and replacement decision.

Known residual risk:

- Updating the single SCA row means old account id no longer maps through `stripe_connect_accounts`. This is acceptable only because replacement is allowed solely before completion/no-money and old account deletion should succeed. If Stripe delete fails, replacement must not proceed.

## 13. Final Implementor Handoff

The next implementor prompt must supersede the old `IMPLEMENTOR_ORCH-0764C_STRIPE_COUNTRY_AND_ACTIVE_STATUS_SYNC.md` and require:

- Country replacement before completion.
- Country lock after completion/money-risk.
- Country/replacement-aware idempotency keys.
- Best-effort Stripe delete with fail-closed behavior.
- Active green Payments banner.
- Status/list cache convergence.
- Edge and business tests listed above.

Do not dispatch implementor against the old country-locked-only prompt.
