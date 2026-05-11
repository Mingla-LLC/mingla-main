# Implementation — ORCH-0768 — Brand Audience Counts And Public Identity Honesty

## Status

Implemented and verified.

Plain-English outcome: Mingla Business no longer shows fake brand follower/event-count signals on the Home, Account, or brand-switching surfaces, and the public brand page no longer presents the route slug as a public username/handle.

## Source Contract

Implemented from:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- `Mingla_Artifacts/reports/REVIEW_FORENSICS_SPEC_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`

## Files Changed

- `mingla-business/app/(tabs)/home.tsx`
- `mingla-business/app/(tabs)/account.tsx`
- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`
- `mingla-business/src/components/brand/PublicBrandPage.tsx`
- `mingla-business/package.json`
- `.github/scripts/strict-grep/orch-0768-brand-audience-identity-honesty.mjs`

No Supabase migrations, edge functions, Stripe code, admin code, or consumer app code were changed.

## Behavior Changes

### Home

Before:

- Home rendered `Followers` from `currentBrand.stats.followers`.
- The non-live `Last 7 days` KPI also showed a hardcoded `+18%` delta.

After:

- Home renders only the truthful `Active events` KPI in that block.
- Home no longer reads or renders `currentBrand.stats.followers`.
- The hardcoded `+18%` delta was removed while touching the same KPI block.

### Account

Before:

- Account rendered a `Your brands` card when `brands.length > 0`.
- Each row displayed `{brand.stats.events} events · {brand.stats.followers} followers`.
- That card was the proven Account-tab route into `/brand/{id}`.

After:

- The `Your brands` card and all count rows are removed.
- A count-free `Brand profile` settings row appears only when `currentBrandId !== null`.
- Pressing `Brand profile` routes to `/brand/${currentBrandId}`.
- If no current brand is selected, no dead profile row renders.

### Brand Switcher

Before:

- Each brand row rendered event/follower count copy from `brand.stats`.

After:

- Brand rows no longer render `brand.stats` count copy.
- The active brand row may show the count-free truthful subcopy `Current brand`.
- Brand selection, create action, active check mark, and delete affordance are preserved.

### Public Brand Page

Before:

- The identity header rendered `@${brand.slug}` for popup brands.
- Physical brands rendered `@${brand.slug} · ${brand.address}`.
- The stats card could render followers/events/attendees from `brand.stats`.

After:

- The public identity header never renders `@{brand.slug}` or route-handle text.
- Physical brands with public address render address text only.
- Popup brands and physical brands without address render no identity subline.
- Slug remains URL/canonical/share identity only.
- The stats card is now public-event-backed only: it renders `EVENTS` from `events.length` and does not render private/stub follower or attendee totals.
- Social links, canonical URLs, OG URLs, tabs, event lists, and share modal behavior are preserved.

## Regression Guard

Added:

`.github/scripts/strict-grep/orch-0768-brand-audience-identity-honesty.mjs`

Wired:

`mingla-business/package.json` -> `test:orch-0768`

The guard checks active source files only and fails if these removed contracts return:

- Home `label="Followers"` or `currentBrand.stats.followers`
- Account `Your brands`, brand stat count reads, or `followers`
- BrandSwitcherSheet `brand.stats.events`, `brand.stats.followers`, or `followers`
- PublicBrandPage slug-as-handle construction or private/stub `brand.stats` public count reads

## ORCH-0767 Compatibility

ORCH-0768 did not alter:

- `mingla-business/src/services/publicEventsService.ts`
- `mingla-business/server/socialPreview.js`
- `business_public_brands_view`
- public brand lookup semantics
- missing slug handling

The existing public brand service and social preview tests still pass after this change. Empty real brand behavior from ORCH-0767 remains compatible because this change only adjusts presentation logic inside `PublicBrandPage`.

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

Additional source scan:

```bash
rg -n "Followers|Your brands|brand\\.stats\\.(events|followers|attendees)|@\\$\\{brand\\.slug\\}|currentBrand\\.stats\\.followers|followers" \
  'mingla-business/app/(tabs)/home.tsx' \
  'mingla-business/app/(tabs)/account.tsx' \
  mingla-business/src/components/brand/BrandSwitcherSheet.tsx \
  mingla-business/src/components/brand/PublicBrandPage.tsx
# PASS: no matches
```

Environment note: Node/npm were available when `/opt/homebrew/bin` was prepended to PATH. Jest printed the inherited Watchman recrawl warning, but both suites passed.

## Manual QA Still Needed

Tester should verify on the business app runtime:

1. Home with a selected brand:
   - `Followers` is absent.
   - `Active events` remains visible and truthful.
   - No replacement fake metric appears.
2. Account:
   - `Your brands` is absent.
   - `Brand profile` appears only when a current brand is selected.
   - `Brand profile` opens `/brand/{currentBrandId}`.
3. Brand switcher:
   - No event/follower count row text appears.
   - Switch, create, and delete affordances still work.
4. Public brand page:
   - No visible `@brandSlug`.
   - Physical brand address displays without slug prefix.
   - Popup brand has no slug/handle subline.
   - Upcoming/Past/About tabs and share still work.
5. ORCH-0767 overlap:
   - Empty real brand still renders a zero-event public page.
   - Missing slug still renders not-found.

## Side Discoveries

No new implementation blockers found.

The broader founder-view `BrandProfileView` aggregate stats and other dashboard revenue-truth work remain out of ORCH-0768 scope, as directed by the approved spec.
