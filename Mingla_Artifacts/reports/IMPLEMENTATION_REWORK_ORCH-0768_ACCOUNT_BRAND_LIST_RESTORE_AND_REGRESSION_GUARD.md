# Implementation Rework — ORCH-0768 — Account Brand List Restore And Regression Guard

## Status

Implemented and verified.

Plain-English outcome: Account now has `Your brands` back as a useful brand-profile entry point, but the dishonest event/follower count subcopy remains removed.

## Source Contract

Implemented from:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0768_ACCOUNT_BRAND_LIST_RESTORE_AND_REGRESSION_GUARD.md`
- `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- Prior implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`

## Files Changed In This Rework

- `mingla-business/app/(tabs)/account.tsx`
- `.github/scripts/strict-grep/orch-0768-brand-audience-identity-honesty.mjs`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0768_ACCOUNT_BRAND_LIST_RESTORE_AND_REGRESSION_GUARD.md`

No Supabase, Stripe, admin, consumer, public-brand service, migration, or deploy files were changed.

Note: the working tree still includes the prior ORCH-0768 implementation changes to Home, BrandSwitcherSheet, PublicBrandPage, `package.json`, and the ORCH-0768 guard script wiring. This report covers the rework delta on top of that implementation.

## Account Before / After

Before this rework:

- Account had no `Your brands` card.
- Account had a generic Settings row labelled `Brand profile` when `currentBrandId !== null`.

After this rework:

- Account imports and uses `useBrandList()` again.
- Account renders `Your brands` when `brands.length > 0`.
- Each brand row shows:
  - avatar initial;
  - `brand.displayName`;
  - right chevron;
  - accessible label `Open {brand.displayName} profile`;
  - press route `/brand/${brand.id}`.
- Rows show no event count, follower count, revenue, attendees, or `brand.stats` values.
- The generic Settings `Brand profile` row was removed as redundant.
- Settings now returns to the focused rows: `Edit profile`, `Notifications`, `Sign out everywhere`.

## Guard Changes

Updated:

`.github/scripts/strict-grep/orch-0768-brand-audience-identity-honesty.mjs`

Changes:

- `Your brands` is no longer forbidden in Account.
- The guard now positively requires `Your brands` in `account.tsx`.
- Account still fails on `brand.stats.events`, `brand.stats.followers`, `brand.stats.rev`, `brand.stats.attendees`, or `followers`.
- Existing Home, BrandSwitcherSheet, and PublicBrandPage forbidden signatures remain guarded.

## Preserved ORCH-0768 Fixes

Preserved from the prior implementation:

- Home has no `Followers` KPI and does not render `currentBrand.stats.followers`.
- BrandSwitcherSheet rows do not render event/follower count copy.
- PublicBrandPage does not render `@{brand.slug}`.
- PublicBrandPage does not render private/stub follower or attendee stats.
- PublicBrandPage event count remains public-event-row-backed.
- ORCH-0767 public-brand service/social preview behavior remains untouched.

## Verification

Commands run from `mingla-business/` unless noted.

```bash
PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0768
# ORCH-0768 PASS: brand audience/count and public identity honesty guard passed (4 files).
```

```bash
PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/jest publicEventsService.test socialPreview.test --runInBand
# PASS server/__tests__/socialPreview.test.ts
# PASS src/services/__tests__/publicEventsService.test.ts
# Test Suites: 2 passed, 2 total
# Tests: 16 passed, 16 total
```

```bash
PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/tsc --noEmit
# PASS exit 0
```

```bash
git diff --check
# PASS exit 0
```

Source scan:

```bash
rg -n "Your brands" 'mingla-business/app/(tabs)/account.tsx'
# mingla-business/app/(tabs)/account.tsx:168: <Text style={styles.title}>Your brands</Text>

rg -n "brand\\.stats\\.(events|followers|rev|attendees)|followers|Followers|currentBrand\\.stats\\.followers|@\\$\\{brand\\.slug\\}" \
  'mingla-business/app/(tabs)/account.tsx' \
  'mingla-business/app/(tabs)/home.tsx' \
  mingla-business/src/components/brand/BrandSwitcherSheet.tsx \
  mingla-business/src/components/brand/PublicBrandPage.tsx
# PASS: no matches
```

Environment note: Node/npm were available with `/opt/homebrew/bin` prepended to PATH. Jest printed the inherited Watchman recrawl warning, but the suites passed.

## Manual QA Still Needed

Tester should verify:

1. Account with one or more brands shows `Your brands`.
2. Each `Your brands` row opens `/brand/{brand.id}`.
3. Rows show no event/follower/count subcopy.
4. Settings does not duplicate brand-profile navigation.
5. Home still has no `Followers`.
6. BrandSwitcherSheet still has no event/follower count rows.
7. PublicBrandPage still has no visible `@brandSlug`.
8. ORCH-0767 empty-brand behavior remains compatible.

## Other Regressions Discovered

No additional regressions were discovered by the focused static/test gates.

Independent runtime tester sweep is still required before ORCH-0768 can close.
