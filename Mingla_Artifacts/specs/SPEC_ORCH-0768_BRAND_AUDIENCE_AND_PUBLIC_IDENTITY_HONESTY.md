# Spec — ORCH-0768 — Brand Audience Counts And Public Identity Honesty

## Goal

Remove misleading brand audience/count displays from Home, Account, and brand switching, and remove public brand route-username/handle exposure from `/b/{brandSlug}`.

This spec is a presentation/data-honesty repair. It does not introduce a new analytics/counting system.

## Scope

In scope:

- `mingla-business/app/(tabs)/home.tsx`
- `mingla-business/app/(tabs)/account.tsx`
- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`
- `mingla-business/src/components/brand/PublicBrandPage.tsx`
- Focused tests or strict-grep guards for removed copy.
- Existing public-brand service/social preview tests as compatibility gates.

Out of scope:

- New follower system or audience model.
- New event-count aggregate table/RPC.
- Supabase migration.
- Stripe, checkout, orders, scanner, admin, consumer app.
- Broad BrandProfileView aggregate repair. Record as follow-up unless the operator explicitly expands scope.
- ORCH-0767 empty-brand data-source repair, except for coordination with the same public brand component.

## Product Contract

1. Home must not show a `Followers` KPI or any replacement audience metric unless a real audience source exists.
2. Account must not show the `Your brands` list/card.
3. No active brand-switching row may show event/follower count copy.
4. Removing Account `Your brands` must not remove all direct access to the current brand profile.
5. Public brand page must not render `@{brand.slug}`, route username, brand username, or slug-as-handle under the brand name.
6. Physical public brand location may render only as public location text, e.g. `East London`, without `@slug`.
7. Public brand event tabs/lists remain intact and continue to use public event rows only.
8. Do not replace removed values with fake or transitional metrics.

## Layer Contracts

### Database / RLS

No database change.

Do not add follower/event/revenue/attendee aggregate columns to `business_public_brands_view` for ORCH-0768. ORCH-0767's `business_public_brands_view` may remain field-limited to identity/profile fields.

If an implementor discovers a migration is unavoidable, stop and return to orchestrator. Any migration must use a prefix greater than the current local max `20260515000008` and greater than the linked remote head if the remote head is higher.

### Home

Primary file:

- `mingla-business/app/(tabs)/home.tsx`

Required changes:

- Remove the `KpiTile` whose label is `Followers`.
- Do not render `currentBrand.stats.followers` anywhere in Home.
- Keep `Active events` because it is derived from `buildBrandEventSummary(liveEvents, drafts)`.
- If the `kpiGrid` layout becomes a single tile, make it visually intentional. Acceptable options:
  - render `Active events` as a full-width KPI tile, or
  - remove the grid wrapper and place the tile in the normal dashboard flow.
- Do not add another metric unless it is already derived from a proven source in the same file.
- If touching the non-live `Last 7 days` tile, remove the hardcoded `delta="+18%"` unless a real comparison source is wired. This is a small honesty cleanup in the same dashboard metric block and should not expand into revenue aggregation work.

### Account

Primary file:

- `mingla-business/app/(tabs)/account.tsx`

Required changes:

- Remove the entire `Your brands` `GlassCard` section currently guarded by `brands.length > 0`.
- Remove unused styles that only supported that section if no remaining consumer uses them.
- Remove `handleOpenBrandProfile` if no longer used.
- Preserve a direct, count-free route to the current brand profile:
  - Recommended: add a `SettingsNavRow` labelled `Brand profile` when `currentBrandId !== null`.
  - On press, route to `/brand/${currentBrandId}`.
  - Do not show event/follower counts in this row.
  - If no current brand is selected, do not show a dead row; TopBar already opens the create/select flow.
- Keep Settings row order coherent. Recommended order when a current brand exists:
  - `Brand profile`
  - `Edit profile`
  - `Notifications`
  - `Sign out everywhere`

### Brand Switcher

Primary file:

- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

Required changes:

- Remove the row subtext that displays `{brand.stats.events} events · {brand.stats.followers} followers`.
- Keep brand name, avatar/initial, active check mark, delete affordance, create action, and selection behavior.
- If row subtext is still needed for visual rhythm, use count-free truthful copy only. Acceptable examples:
  - active row only: `Current brand`
  - role label from `brand.role`, e.g. `Owner` / `Admin`
  - no subtext at all
- Do not show `brand.stats` in this component.

### Public Brand Page

Primary file:

- `mingla-business/src/components/brand/PublicBrandPage.tsx`

Required changes:

- Remove `handleSubline` behavior that formats `@${brand.slug}`.
- Do not render `@{brand.slug}` anywhere in the identity header.
- For physical brands with a non-empty `brand.address`, render only the address/location text below the brand name.
- For popup brands or physical brands without address, render no subline under the brand name.
- Update the header comments to remove the outdated `@slug` honesty model.
- Preserve canonical/share/OG URL generation. Slug remains URL identity, just not visible identity.
- Preserve SocialLinksRow; real social handles/URLs may remain as icons/links because they come from explicit `brand.links`.
- Public stats card:
  - Do not render follower or attendee stats unless a future source of truth is introduced.
  - If keeping event count, derive it from `events.length` or the already-mapped public event rows, not from a private/stub counter.
  - The minimal acceptable ORCH-0768 fix is to keep current event-count display only when it is already public-event-backed and remove/harden follower/attendee branches so future non-zero stub/private values cannot leak.

### Public Service / ORCH-0767 Coordination

Primary files for compatibility only:

- `mingla-business/src/services/publicEventsService.ts`
- `mingla-business/src/services/__tests__/publicEventsService.test.ts`
- `mingla-business/server/socialPreview.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`

Required behavior:

- Do not undo ORCH-0767's split brand-profile/event-list source if it is present.
- `getPublicBrandBySlug` must still return a real empty brand with `events: []`.
- Missing brand slugs must still return `null`.
- Social preview must still not expose `@slug`.

## Test Contract

Add the smallest durable regression guard consistent with repo patterns. Component tests appear limited in this area, so strict-grep guards are acceptable if component rendering tests would require new harness work.

Required automated checks:

1. Home no longer has an active `Followers` KPI.
2. Account no longer contains active `Your brands` copy or brand row count copy.
3. BrandSwitcherSheet no longer contains active `stats.events`, `stats.followers`, or `followers` row copy.
4. PublicBrandPage no longer builds or renders `@${brand.slug}` / `@{slug}`.
5. Public brand service and social preview tests still pass.
6. TypeScript still passes.

Recommended implementation:

- Add a strict-grep script under `.github/scripts/strict-grep/`, for example:
  - `orch-0768-brand-audience-identity-honesty.mjs`
- Wire it as a package script:
  - `test:orch-0768`
- The grep should fail on active occurrences of:
  - `label="Followers"` in `mingla-business/app/(tabs)/home.tsx`
  - `Your brands` in `mingla-business/app/(tabs)/account.tsx`
  - `brand.stats.events` or `brand.stats.followers` in `BrandSwitcherSheet.tsx`
  - `` `@${brand.slug}` `` or equivalent slug-as-handle construction in `PublicBrandPage.tsx`

Suggested verification commands:

```bash
cd mingla-business
PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0768
PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/jest publicEventsService.test socialPreview.test --runInBand
PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/tsc --noEmit
```

If `npm`/`npx` is still absent from PATH, use local binaries directly and record the exact commands.

Manual QA gates:

1. Home with a selected brand:
   - `Followers` is absent.
   - `Active events` remains truthful.
   - No new fake metric appears.
2. Account with at least one brand:
   - `Your brands` card is absent.
   - Settings still renders.
   - If a current brand is selected, `Brand profile` opens `/brand/{currentBrandId}`.
3. Brand switcher:
   - Rows show brand identity and active state.
   - No event/follower counts appear.
   - Switch, create, and delete affordances still work.
4. Public brand page:
   - No `@brandSlug` or route username is visible.
   - Physical brand with public address shows address only.
   - Popup brand shows no slug/handle subline.
   - Upcoming/Past/About tabs and share still work.
5. ORCH-0767 compatibility:
   - Empty real brand still renders `No upcoming events yet`.
   - Missing slug still renders not-found.

## Implementation Order

1. Update Home KPI block.
2. Update Account section and add count-free current-brand profile route if needed.
3. Update BrandSwitcherSheet row copy.
4. Update PublicBrandPage identity subline and stats hardening.
5. Add strict-grep/package test script.
6. Run targeted tests and TypeScript.
7. Produce implementation report with exact file list and before/after behavior.

## Rollback

Rollback is app-only. Revert the affected component/test/script/package changes. No Supabase rollback is involved.

Do not roll back by restoring stub metrics or widening public data exposure.

## Acceptance Criteria

- Home no longer shows `Followers`.
- Account no longer shows `Your brands`.
- BrandSwitcherSheet rows no longer show event/follower counts.
- PublicBrandPage no longer shows `@{brand.slug}` or equivalent route username.
- Current brand profile remains reachable without a count-based brand list.
- ORCH-0767 empty-brand behavior remains compatible.
- Focused regression guard, public-brand tests, and TypeScript pass.
