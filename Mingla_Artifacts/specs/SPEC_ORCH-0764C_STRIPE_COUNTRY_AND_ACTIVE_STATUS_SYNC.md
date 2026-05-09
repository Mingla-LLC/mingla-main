# Spec: Stripe Country Propagation + Active Payments Success State (ORCH-0764C)

> Date: 2026-05-09  
> Investigation: `reports/INVESTIGATION_ORCH-0764C_STRIPE_COUNTRY_AND_ACTIVE_STATUS_SYNC.md`  
> Root cause: RC-1 edge country mismatch reuse, RC-2 active banner suppressed, RC-3 list-cache convergence gap  
> Status: ready for implementation

## 1. Layman Summary

After this fix, Mingla will stop pretending country can change after a Stripe account already exists, and Payments will finally give organisers a clear green success state when Stripe is connected. Fresh US setup must create a US connected account. Existing GB accounts must stay GB and tell the user that the country is locked instead of silently opening a GB Stripe flow after they picked US.

## 2. User Story

As a brand admin, I want the Stripe country I choose to be honored before my account is created, and I want a clear success banner once Stripe is connected, so that payout setup feels legally correct and complete.

## 3. Scope

- **In scope:**
  - Guard existing connected-account country mismatch in `brand-stripe-onboard`.
  - Lock/explain country in onboarding UI when a connected account already exists.
  - Add active green/check success banner to Payments.
  - Tighten status/list cache convergence after onboarding/refresh.
  - Add regression tests for country propagation, mismatch handling, active banner, and stale status convergence.
- **Non-goals:**
  - Do not delete/recreate Stripe connected accounts.
  - Do not implement a "reset Stripe account" admin workflow.
  - Do not change the 34-country allowlist.
  - Do not alter checkout/payment collection.
  - Do not use live-mode Stripe.
- **Assumptions:**
  - Stripe account country is locked for this integration once account/capabilities are created.
  - `stripe_connect_accounts` is canonical for connected-account metadata.
  - Business app can ship via Expo/web bundle; no native module changes.
- **Dependencies:**
  - Existing Supabase migration `20260511000001` already adds `country` and `default_currency`.
  - Existing ORCH-0764B migration already fixes status derivation order.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Existing account country mismatch must not be silent | Investigation RC-1 | H |
| Active success banner must render | Operator acceptance + RC-2 | H |
| Status/list invalidation must converge | Investigation RC-3 | M-H |
| New account path must preserve selected country | Current tests + code path | H |
| Return from Stripe must be followed by account retrieval | Stripe-hosted onboarding docs | H |

## 5. Success Criteria

1. Selecting United States on a brand with no connected account sends `US` to `brand-stripe-onboard`, creates a Stripe account with `identity.country = "US"`, and persists `stripe_connect_accounts.country = "US"` / `default_currency = "USD"`.
2. If a brand already has a GB connected account and the caller requests US, `brand-stripe-onboard` returns a typed non-2xx response such as `409 { error: "country_locked", existing_country: "GB", requested_country: "US" }` and does not create an Account Link.
3. Onboarding UI disables or clearly locks the country picker once a connected account exists, showing the saved country and explaining that Stripe country is locked for this brand.
4. Payments renders a green/check success banner with title `You're connected to Stripe` when effective live status is `active`.
5. Payments does not render `Onboarding submitted — verifying` when live status is `active`, even if cached brand status is still `onboarding`.
6. Returning from onboarding and tapping Done lands back on Payments with status converged from live Stripe status without requiring a second tap or a 5-minute brand-list cache wait.
7. Restricted/onboarding states remain truthful: active success banner must not render for `restricted`, `not_connected`, or `onboarding`.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| I-PROPOSED-T country allowlist | Keep frontend/backend constants and DB CHECK intact | Existing strict-grep + focused tests |
| Server state via React Query | Do not reintroduce Zustand writes for Stripe status | grep/no `setBrands`; query invalidation tests |
| `stripe_connect_accounts` canonical | Edge reads and writes canonical row; brands cache remains trigger-owned | no direct writes to `brands.stripe_*` |
| No silent failures | Country mismatch returns typed error and user-visible copy | service/hook/UI tests |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| Stripe connected-account country is locked per brand after account creation | Stripe Connect / `stripe_connect_accounts` | Edge rejects mismatch; UI locks picker when account exists | Deno + Jest + runtime smoke |
| Active payment setup needs an affirmative visible success state | `BrandPaymentsView` | Active banner config renders green/check copy | component/helper test |

## 7. Database / RLS / Migration

No migration expected.

- RLS policies: None.
- Backfill/data migration: None.
- Indexes/constraints: Existing `stripe_connect_accounts_country_allowlist_check` remains sufficient.
- Rollback: Revert code-only changes; existing DB rows remain valid.

If implementor discovers a DB change is unavoidable, migration filename must be greater than the current local max in `supabase/migrations/` and remote head, not derived from wall-clock alone.

## 8. Edge Functions / RPCs / Webhooks

### `brand-stripe-onboard`

- **Path:** `supabase/functions/brand-stripe-onboard/index.ts`
- **Auth:** unchanged JWT + `biz_can_manage_payments_for_brand`.
- **Request schema:** `{ brand_id: uuid, return_url: string, country: string }`
- **Existing-account behavior:**
  - After reading `existingSca`, if `existingSca?.stripe_account_id` exists:
    - Normalize `existingSca.country`.
    - If `existingSca.country !== requested country`, return typed conflict:
      ```json
      {
        "error": "country_locked",
        "detail": "stripe_account_country_locked",
        "existing_country": "GB",
        "requested_country": "US"
      }
      ```
    - Use HTTP `409`.
    - Do not call `createRecipientAccount`.
    - Do not call `createRecipientAccountLink`.
    - Do not change `stripe_connect_accounts.country`.
  - If countries match, reuse account exactly as today.
- **New-account behavior:** unchanged, but add a test proving `US` reaches `createRecipientAccount`.
- **Success response:** existing response can remain `{ client_secret: null, account_id, onboarding_url }`.
- **Error contract:** service layer should surface `country_locked` in a user-friendly message.
- **External calls/timeouts/retries:** unchanged.
- **Idempotency:** unchanged.
- **Deploy notes:** deploy this edge function after Deno tests pass:
  ```bash
  /Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
  ```

### `brand-stripe-refresh-status`

- **Path:** `supabase/functions/brand-stripe-refresh-status/index.ts`
- **Required only if adding country to response.**
- **Recommended response widening:** include `stripe_account_id`, `country`, `default_currency` in `RefreshStatusResult` so UI can lock/explain country without a separate query.
- **Select change:** update SCA select to include `stripe_account_id, country, default_currency`.
- **Deploy notes:** deploy if response shape changes:
  ```bash
  /Users/sethogieva/bin/supabase functions deploy brand-stripe-refresh-status --project-ref gqnoajqerqhnvulmnyvv
  ```

## 9. Service Layer

### `startBrandStripeOnboarding`

- **Path:** `mingla-business/src/services/brandStripeService.ts`
- **Signature:** may remain `country = "GB"` for back-compat, but all UI callers must pass explicit selected/locked country.
- **Error contract:** parse `country_locked` payload and throw a message that `BrandOnboardView` can map to country-lock copy.
- **Return type:** unchanged unless implementor chooses to surface `existing_country`.

### `refreshBrandStripeStatus`

- **Path:** `mingla-business/src/services/brandStripeService.ts`
- **Return type:** widen `RefreshStatusResult` if edge response includes account metadata:
  ```ts
  stripe_account_id?: string | null;
  country?: string | null;
  default_currency?: string | null;
  ```
- **Error contract:** unchanged.

## 10. Hook / State / Cache Layer

### `useStartBrandStripeOnboarding`

- **Path:** `mingla-business/src/hooks/useStartBrandStripeOnboarding.ts`
- **Mutation behavior:** unchanged for success.
- **Invalidation:** on success, invalidate:
  - `brandStripeStatusKeys.detail(brandId)`
  - `brandKeys.detail(brandId)`
  - all `brandKeys.lists()`
- **Error behavior:** preserve console diagnostic in dev, but country lock should surface to component as a typed/message error.

### `useBrandStripeStatus`

- **Path:** `mingla-business/src/hooks/useBrandStripeStatus.ts`
- **Realtime invalidation:** when `stripe_connect_accounts` updates for a brand, invalidate:
  - `brandStripeStatusKeys.detail(brandId)`
  - `brandKeys.detail(brandId)`
  - all `brandKeys.lists()`
- **Query key:** unchanged.
- **Stale time:** unchanged unless implementor proves a better value is needed.

### Payment/onboard route brand source

- **Paths:**
  - `mingla-business/app/brand/[id]/payments/index.tsx`
  - `mingla-business/app/brand/[id]/payments/onboard.tsx`
- **Preferred fix:** use `useBrand(id)` detail query for these routes, not `useBrandList()` list lookup. If list fallback is kept for transitional loading, live status must still win and list cache must be invalidated.
- **Reason:** `useBrandList()` is backed by a 5-minute list cache and is not the best source for a finance status screen.

## 11. Component / Screen Layer

### `BrandOnboardView`

- **Path:** `mingla-business/src/components/brand/BrandOnboardView.tsx`
- **Country state:**
  - Default may remain GB before account exists.
  - If `statusQuery.data?.country` or equivalent account metadata exists, set/lock selected country to that saved country.
  - Do not overwrite a user's unsaved selection while no account exists.
- **Locked country UI:**
  - Disable picker or replace with a read-only row.
  - Copy: `Stripe account country is locked to United Kingdom for this brand.`
  - If user attempts setup with mismatched country and edge returns `country_locked`, show the same explanation and keep them on the onboarding screen.
- **After done:** after `settleStripeStatus`, invalidate/refetch brand detail/list before navigating back or ensure parent route reads fresh status.

### `BrandStripeCountryPicker`

- **Path:** `mingla-business/src/components/brand/BrandStripeCountryPicker.tsx`
- **Props:** add optional locked/read-only support if needed:
  ```ts
  locked?: boolean;
  helperText?: string;
  ```
- **States:**

| State | Condition | Renders |
|---|---|---|
| editable | no connected account | current picker |
| locked | connected account exists | saved country, no sheet open, explanation |
| mismatch error | edge returns country_locked | inline error copy and locked country |

### `BrandPaymentsView`

- **Path:** `mingla-business/src/components/brand/BrandPaymentsView.tsx`
- **Status banner config:** active must no longer be `null`.
- **Recommended config shape:** make CTA optional so active banner can render without a button.
- **Active state render:**

| State | Condition | Renders |
|---|---|---|
| active | effective live status active | green/check banner, title `You're connected to Stripe`, sub `Payments are ready for this brand.` |
| onboarding | effective status onboarding | existing verifying banner |
| restricted | effective status restricted | remediation banner/cards |
| not_connected | effective status not_connected | connect banner |

- **Design:** use existing `GlassCard`, `Icon`, and design tokens. Avoid nested cards. Green/success styling should match existing `Pill`/semantic success language if available; if no semantic success token exists, introduce a local style with restrained green border/tint and document as a watch-point.
- **Copy:** use straight apostrophe in source if project lint prefers ASCII; rendered copy may show `You're connected to Stripe`.

## 12. Business / Admin / Public Parity

- Business app changes: yes, above.
- Admin changes: none.
- Public/web changes: only if business web bundle deploys the updated RN web code.
- Operational dependency: existing Stripe accounts with wrong country cannot be repaired in-place by this spec. Operator must create a new brand/account or approve a later admin reset workflow if needed.

## 13. Realtime / Notifications / Analytics

- Realtime: update invalidation to include brand lists.
- Notifications: none.
- Analytics: optional but recommended event/log in edge audit when mismatch occurs:
  - `stripe_connect.country_mismatch_blocked`
  - include `existing_country`, `requested_country`, `stripe_account_id`, `brand_id`; no PII.

## 14. Implementation Order

1. Add/adjust pure helpers or types for Stripe country lock/error and active payment banner if useful.
2. Update `brand-stripe-onboard` mismatch guard before Account Link creation.
3. Update/extend Deno tests for edge country mismatch and US create path.
4. Optionally widen `brand-stripe-refresh-status` response to include account country/default currency.
5. Update `brandStripeService.ts` and `RefreshStatusResult` types.
6. Update `useBrandStripeStatus` and `useStartBrandStripeOnboarding` invalidation to cover brand lists/detail.
7. Update payments/onboard routes to prefer `useBrand(id)` detail or otherwise prevent list-cache stale fallback.
8. Update `BrandOnboardView` locked-country behavior and error copy.
9. Update `BrandPaymentsView` active success banner.
10. Add Jest tests for service payload, active banner/helper, country lock UI/helper, and cache invalidation/route convergence.
11. Run verification commands.
12. Deploy changed edge function(s), then business app/web bundle as appropriate.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T-01 | New US account payload | no existing SCA, selected `US` | Accounts v2 body has `identity.country = "US"` | Edge/shared | Deno test |
| T-02 | Existing GB account, request US | existing SCA `{ country: "GB", stripe_account_id }` | 409 `country_locked`, no Account Link call | Edge | Deno test |
| T-03 | Existing US account, request US | existing SCA `US` | Account Link created for existing account | Edge | Deno test/source test |
| T-04 | Service selected country | `startBrandStripeOnboarding(..., "US")` | invoke body country `US` | Service | existing Jest, keep passing |
| T-05 | Service default country | no country arg | invoke body country `GB` | Service | existing Jest, keep passing |
| T-06 | Active banner | live status active | renders `You're connected to Stripe`, no verifying copy | UI/helper | Jest |
| T-07 | Cached onboarding + live active | brand cache onboarding, live active | active success banner | UI/helper | Jest |
| T-08 | Cached active + live restricted | cache active, live restricted | restricted/remediation, no active banner | UI/helper | existing + new Jest |
| T-09 | Onboarding done invalidation | settle returns active | status/detail/list invalidated before/at return | Hook/cache | Jest with queryClient mock or targeted helper test |
| T-10 | Runtime fresh US smoke | new safe brand, choose US | Stripe account + SCA both US; UI settles active or honest restricted | Manual tester | iOS/device |
| T-11 | Runtime existing GB mismatch | existing GB brand, choose/attempt US | user sees locked-country message; no wrong-country Account Link | Manual tester | iOS/device |

## 16. Regression Prevention

- **Structural safeguard:** Edge country mismatch guard before Account Link creation.
- **Test:** Deno test must fail if edge can silently reuse mismatched account.
- **Protective comment:** Add short comments around Stripe country lock and why account recreation is out of scope.
- **Artifact update:** Implementor report must cite ORCH-0764C and update any stale "active has no banner" comments it touches.

## 17. Rollback And Deploy Safety

- **Migration order:** none.
- **Edge function deploy:** deploy `brand-stripe-onboard`; deploy `brand-stripe-refresh-status` only if response widened.
- **Mobile OTA vs native build:** no native module changes; Expo update/business bundle sufficient.
- **Business/admin web deploy:** Vercel/business web deploy required if RN web route is used for QA.
- **Env vars/secrets:** no new secrets.
- **Partial rollback risk:** If app updates before edge deploy, UI may still allow a mismatch that old edge silently accepts. Deploy edge first, then app/web.

## 18. Common Mistakes

1. Do not "fix" wrong country by updating `stripe_connect_accounts.country` only; Stripe account country would still be old.
2. Do not delete/recreate connected accounts from implementation.
3. Do not show active success on Stripe return alone; only live status `active` qualifies.
4. Do not leave active banner as `null` while claiming success state is fixed.
5. Do not only invalidate brand detail while the route still reads from brand list.

## 19. Handoff To Implementor

Fix this as a small Stripe correctness rework. Start with the edge guard: existing connected accounts have locked country, and mismatches must return a typed 409 before any Account Link is created. Then update the business app so locked country is visible/truthful, active status renders a green/check **You're connected to Stripe** banner, and onboarding return invalidates/refetches the same brand data the Payments route actually reads. Edge deploy comes before app/web deploy; tests must prove US creation, mismatch rejection, active banner rendering, and status/list cache convergence.
