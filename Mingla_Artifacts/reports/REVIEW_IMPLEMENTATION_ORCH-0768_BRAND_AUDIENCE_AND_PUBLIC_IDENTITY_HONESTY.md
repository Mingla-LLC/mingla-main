# Review — ORCH-0768 — Brand Audience Counts And Public Identity Honesty Implementation

## Verdict

FAIL / rework required.

Plain-English impact: most of the data-honesty fix is directionally right, but the Account page lost a useful brand-management entry point. The user now clarified that the problem was the false event/follower count copy in `Your brands`, not the existence of a brand list itself. The implementation removed too much.

## Reviewed Inputs

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- Approved spec: `Mingla_Artifacts/specs/SPEC_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- Implementor prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- User runtime/product feedback on 2026-05-09: Account `Your brands` is missing and other regressions are unknown.

## Findings

### F1 — Product Contract Regression — Account `Your brands` was removed too broadly

**Current implementation evidence:**

- `mingla-business/app/(tabs)/account.tsx` no longer imports `useBrandList`.
- `account.tsx` no longer renders the `Your brands` card.
- The replacement is a single `SettingsNavRow` labelled `Brand profile` when `currentBrandId !== null`.
- Implementation report confirms this as intended: `reports/IMPLEMENTATION_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md` says the `Your brands` card was removed and replaced with a count-free `Brand profile` settings row.

**Why this is wrong now:**

- Historical product contract added Account `Your brands` as the brand-profile entry point: `reports/IMPLEMENTATION_BIZ_CYCLE_2_J_A7_BRAND_PROFILE.md`.
- The real defect in ORCH-0768 is the false count copy: `{brand.stats.events} events · {brand.stats.followers} followers`.
- The corrected product contract is: keep Account `Your brands` as a count-free brand list; remove false counts.

### F2 — Regression Guard Now Encodes The Wrong Account Contract

The new strict-grep guard currently treats `Your brands` in `account.tsx` as forbidden. That will block the corrected UI.

Rework must update the guard so:

- `Your brands` is required/allowed in Account.
- `brand.stats.events`, `brand.stats.followers`, and follower/event count row copy remain forbidden in Account.
- Home `Followers`, BrandSwitcher count copy, and PublicBrandPage `@slug` remain forbidden.

### F3 — Independent Runtime Regression Sweep Still Needed

The implementation passed static gates and targeted public-brand tests, but the user correctly flagged uncertainty about other regressions. After rework, independent tester must verify:

- Account `Your brands` restored without false counts.
- Account row navigation to `/brand/{brand.id}` works.
- The Settings card remains coherent.
- Home, BrandSwitcherSheet, PublicBrandPage, and ORCH-0767 overlap still pass.

## Rework Decision

Do not reopen broad forensics. This is a direct implementation-contract correction with sufficient evidence.

Next lifecycle gate:

`$implementor` rework with:

`Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0768_ACCOUNT_BRAND_LIST_RESTORE_AND_REGRESSION_GUARD.md`

Expected output:

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0768_ACCOUNT_BRAND_LIST_RESTORE_AND_REGRESSION_GUARD.md`

After rework returns, orchestrator should dispatch `$tester` for independent runtime/regression QA before close.

## Corrected Product Contract

Keep:

- Home must not show `Followers`.
- BrandSwitcherSheet must not show event/follower counts.
- PublicBrandPage must not show `@{brand.slug}`.
- PublicBrandPage follower/attendee/private-stub stats must not leak.

Change:

- Account must show `Your brands` when `useBrandList()` has brands.
- Account `Your brands` rows must show brand identity and a route affordance only: avatar/initial, display name, chevron.
- Account `Your brands` rows must not show event counts, follower counts, revenue, attendees, or any `Brand.stats` copy.
- Prefer removing the generic Settings `Brand profile` row once the specific brand-list entry point is restored, unless implementor proves it is needed as a loading/fallback affordance.

## Status

ORCH-0768 is not tester-ready and not close-ready until the rework is implemented and independently verified.
