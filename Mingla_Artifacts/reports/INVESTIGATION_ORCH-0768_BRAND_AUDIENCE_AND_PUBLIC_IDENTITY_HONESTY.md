# Investigation — ORCH-0768 — Brand Audience Counts And Public Identity Honesty

## Verdict

ORCH-0768 is a confirmed product-trust and no-fabricated-data issue across Mingla Business brand surfaces.

The operator's requested removals are supported by current code evidence:

- Home renders a `Followers` KPI from `currentBrand.stats.followers`.
- Account renders a `Your brands` section whose rows show `brand.stats.events` and `brand.stats.followers`.
- BrandSwitcherSheet repeats the same count copy.
- PublicBrandPage renders the route slug as `@{brand.slug}` under the public brand name.

The deeper source-of-truth problem is that `Brand.stats` is not a durable `brands` table fact. Real server-backed brand reads default stats to zero, while legacy stub brands still carry invented non-zero metrics. That makes any UI that displays `brand.stats.events`, `brand.stats.followers`, `brand.stats.rev`, or `brand.stats.attendees` without an explicit aggregate source vulnerable to false or inflated copy.

## Findings

### F1 — Confirmed Bug / Invariant Violation — Home shows an audience metric with no durable source

**Symptom:** The Home dashboard displays `Followers`.

**Broken step:** Business Home -> populated brand dashboard -> KPI grid.

**Evidence:**
- `mingla-business/app/(tabs)/home.tsx:407-419` renders `KpiTile label="Followers"` with `currentBrand.stats.followers`.
- `mingla-business/src/services/brandMapping.ts:82-87` defines `EMPTY_BRAND_STATS` with `followers: 0`.
- `mingla-business/src/services/brandMapping.ts:224` maps durable `brands` rows with `options.stats ?? EMPTY_BRAND_STATS`.
- `mingla-business/src/services/brandsService.ts:116-129` calls `mapBrandRowToUi(row, { role: "owner" })` without passing aggregate stats.
- Legacy stub brands still carry non-zero follower values in `mingla-business/src/store/brandList.ts:50-206`.

**Six-field proof:**

| Field | Proof |
|---|---|
| File/line | `home.tsx:407-419`, `brandMapping.ts:82-87,224`, `brandsService.ts:116-129`, `brandList.ts:50-206` |
| Exact code/schema | Home reads `currentBrand.stats.followers`; real brand mapping defaults followers to zero; stubs define 412-2418 followers. |
| Current behavior | Depending on data path, Home can show legacy fake followers or a zero audience metric that is not backed by any followers product/system. |
| Expected behavior | Per operator decision, Home must not show `Followers` or any replacement fake audience metric. |
| Causal chain | `useCurrentBrand()` -> `useBrand()` -> `brandsService.getBrand()` -> `mapBrandRowToUi(...EMPTY_BRAND_STATS)` or legacy stub cache -> Home renders `stats.followers` as a KPI. |
| Verification step | Open Home with a selected brand; current build renders `Followers`. After fix, `rg "label=\"Followers\" mingla-business/app mingla-business/src` should not find active Home UI, and runtime Home should show no Followers KPI. |

**Invariant impact:** Violates README Constitution #2 (`One owner per truth`) and #9 (`No fabricated data`) because there is no follower-domain owner behind this KPI.

### F2 — Confirmed Bug / Invariant Violation — Account `Your brands` rows expose false brand event/follower counts

**Symptom:** Account shows `Your brands`, and rows say e.g. `{events} events · {followers} followers`.

**Broken step:** Account tab -> brand list rows.

**Evidence:**
- `mingla-business/app/(tabs)/account.tsx:166-198` renders the `Your brands` card.
- `mingla-business/app/(tabs)/account.tsx:188-190` displays `brand.stats.events` and `brand.stats.followers`.
- `mingla-business/src/services/brandsService.ts:116-129` maps server brand rows without event/follower aggregate stats.
- `mingla-business/src/store/brandList.ts:59,95,124,206` carries legacy hardcoded `stats.events` and `stats.followers` values; for example Sunday Languor has `stats.events: 6`, but the same stub object contains four finance event rows at `brandList.ts:161-196`, illustrating that this is a curated stub counter rather than current event truth.

**Six-field proof:**

| Field | Proof |
|---|---|
| File/line | `account.tsx:166-198`, `brandsService.ts:116-129`, `brandMapping.ts:82-87,224`, `brandList.ts:59,95,124,206` |
| Exact code/schema | Account renders `brand.stats.events` and `brand.stats.followers`; real brand reads do not compute those stats; stub brands hardcode them. |
| Current behavior | Account can show invented legacy counts or zeros that do not reflect real event state. |
| Expected behavior | Per operator decision, Account must not render the `Your brands` section. If a brand-profile entry remains, it must not show event/follower counts. |
| Causal chain | Account uses `useBrandList()` -> React Query `useBrands()`/legacy shim -> `Brand.stats` -> row text; no aggregate query or event count source is involved. |
| Verification step | Open Account with brands. Current build renders `Your brands`; after fix it should be absent, and `rg "Your brands|stats.events.*followers|followers" mingla-business/app/(tabs)/account.tsx` should find no active row copy. |

**Navigation note:** Removing the `Your brands` card removes the only proven Account-tab direct route to `/brand/{id}` (`account.tsx:105-110,172-174`). The spec should preserve a no-count route to the current brand profile, preferably as a Settings nav row visible only when a current brand is selected.

### F3 — Confirmed Bug / Invariant Violation — BrandSwitcherSheet repeats the same false counts

**Symptom:** The top brand switcher displays per-brand event/follower counts.

**Broken step:** Tap TopBar brand chip -> switch mode -> brand row subtext.

**Evidence:**
- Home and Account both open BrandSwitcherSheet from TopBar: `home.tsx:294-295`, `account.tsx:162-164`.
- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:197-224` renders each brand row and displays `brand.stats.events` plus `brand.stats.followers`.
- `BrandSwitcherSheet.tsx:114-124` sets the selected brand and saves `default_brand_id`; the row does not need counts to perform the selection job.

**Six-field proof:**

| Field | Proof |
|---|---|
| File/line | `BrandSwitcherSheet.tsx:197-224`, `home.tsx:294-295`, `account.tsx:162-164` |
| Exact code/schema | `Text` row subcopy is `{brand.stats.events} events · {brand.stats.followers} followers`. |
| Current behavior | The same untrusted `Brand.stats` values appear in a still-active brand switcher even if Account's `Your brands` card is removed. |
| Expected behavior | Brand switcher rows should keep selection affordance but remove event/follower count copy, or replace it only with truthful non-aggregate metadata such as role/active state. |
| Causal chain | TopBar opens BrandSwitcherSheet -> sheet maps `useBrandList()` -> row reads `brand.stats` -> false counts repeat. |
| Verification step | Open brand switcher with multiple brands; current build shows event/follower subcopy. After fix, no switcher row shows event/follower counts. |

### F4 — Confirmed Bug / UX Gap — PublicBrandPage exposes route slug as public username/handle

**Symptom:** Public brand page shows `@{brand.slug}` under the brand name, or `@{brand.slug} · {address}` for physical brands.

**Broken step:** Public brand page -> identity header.

**Evidence:**
- `mingla-business/src/components/brand/PublicBrandPage.tsx:14-17` documents the old honesty model as showing `@slug`.
- `PublicBrandPage.tsx:198-205` builds `handleSubline` from `brand.slug`.
- `PublicBrandPage.tsx:309-310` renders `handleSubline` below `brand.displayName`.
- By contrast, server/social preview tests already assert no handle exposure: `mingla-business/server/__tests__/socialPreview.test.ts:111-152`.

**Six-field proof:**

| Field | Proof |
|---|---|
| File/line | `PublicBrandPage.tsx:198-205,309-310`; server test `socialPreview.test.ts:111-152` |
| Exact code/schema | `const handleSubline = showLocation ? \`@${brand.slug} · ${brand.address}\` : \`@${brand.slug}\`;` rendered as `handleLineCentered`. |
| Current behavior | Public visitors see a route slug formatted as a brand username/handle. |
| Expected behavior | Per operator decision, public brand page must not expose the brand username/route handle. Physical brand location may render only as location text, without `@slug`. |
| Causal chain | Public brand mapper returns `slug` for URL identity -> PublicBrandPage also reuses `slug` as display identity -> route username appears under brand name. |
| Verification step | Open `/b/{brandSlug}`. Current build renders `@{brandSlug}`. After fix, no visible `@{brandSlug}` or handleLine subline appears unless it is a real social link icon destination. |

### F5 — Production-Hardening Gap — Existing tests cover public preview handle hiding, but not the actual PublicBrandPage component or business Account/Home copy

**Evidence:**
- `mingla-business/server/__tests__/socialPreview.test.ts:143-152` checks crawler HTML does not contain `@test-stripe`.
- `mingla-business/src/services/__tests__/publicEventsService.test.ts:222-381` covers ORCH-0767 service and migration behavior.
- Search found no component tests for Home, Account, BrandSwitcherSheet, or PublicBrandPage active copy.
- Targeted command passed locally: `PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/jest publicEventsService.test socialPreview.test --runInBand` -> 2 suites / 16 tests PASS.
- TypeScript passed locally: `PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/tsc --noEmit` -> exit 0.
- Environment note: plain `npx`/`npm`/`node` were not on shell PATH; `/opt/homebrew/bin` had to be prepended.

**Impact:** The server preview will stay clean, but the actual in-app/web public brand page can regress independently.

### D-0768-1 — Side Discovery — Other brand-profile aggregate KPIs still depend on `Brand.stats`

`mingla-business/src/components/brand/BrandProfileView.tsx:475-478` renders Events, Attendees, and GMV from `brand.stats`. This is adjacent to ORCH-0768 but broader than the operator's explicit Home/Account/public-username ask. Since server brand reads default `Brand.stats` to zero, this can also become stale or misleading for real brands until a proper aggregate owner exists.

Recommendation: keep ORCH-0768 focused on the reported Home, Account, switcher, and public identity surfaces. Register a follow-up if founder-view BrandProfile aggregate truth becomes launch scope.

### D-0768-2 — Side Discovery — Home has a hardcoded revenue delta

`mingla-business/app/(tabs)/home.tsx:399-404` renders `Last 7 days` with `currentBrand.stats.rev` and a hardcoded `delta="+18%"`. This is not the reported follower issue, but it is the same class of dashboard metric honesty risk. If implementor touches the Home KPI block, remove the hardcoded delta unless a real revenue comparison source is introduced.

## Five Truth Layers

| Layer | Current truth |
|---|---|
| Docs/history | Cycle 1 knowingly used stub metrics for Home/brand switcher. The report explicitly called the KPI grid `Active events / Followers` and marked stub data as a tradeoff. Later Cycle 17e-A moved brand reads to React Query/server state but preserved `Brand.stats` shape for compatibility. |
| Schema/RLS | `public.brands` does not contain follower, event-count, revenue, or attendee aggregate columns. ORCH-0767's local migration `20260515000008_orch_0767_public_brand_profile_view.sql` exposes only brand profile fields, not counts. `business_public_events_view` remains the public event-list source. |
| Code | Home, Account, BrandSwitcherSheet, and PublicBrandPage still render `Brand.stats` or `brand.slug` directly. Server brand mapping defaults stats to zero; legacy stub data hardcodes non-zero values. |
| Runtime/test evidence | Targeted ORCH-0767 public service/social preview tests pass locally, and TypeScript passes. No component-level regression test currently catches Home `Followers`, Account `Your brands`, BrandSwitcher count copy, or PublicBrandPage `@slug`. |
| Product decision | Operator explicitly requested removal of Home followers, Account `Your brands`, false event counts, and public brand username exposure. No current evidence shows a stronger product need to keep any of those displays. |

## Blast Radius

| Surface | Impact |
|---|---|
| Home | Remove `Followers` KPI; consider removing hardcoded revenue delta if touching KPI block. Keep `Active events` because it is derived from live/draft event stores via `buildBrandEventSummary`. |
| Account | Remove `Your brands` card. Preserve a no-count path to current brand profile to avoid a dead-end account/settings journey. |
| BrandSwitcherSheet | Remove event/follower subcopy from rows; keep switch/create/delete behavior. |
| PublicBrandPage | Remove visible slug/username subline; render physical location alone if it is public and non-empty. Keep public event tabs/list. |
| ORCH-0767 | Compatible but overlapping. ORCH-0767 introduces `business_public_brands_view` and sets public `stats.events` from public event rows. ORCH-0768 should not undo empty-brand rendering or event privacy. |
| Social preview/OG | Already avoids `@slug` in tests; no direct change required unless shared helpers are refactored. |
| Supabase | No new migration required for ORCH-0768. Counts should not be added to the public brand view for this fix. |
| Tests | Need component/static grep guards beyond current service/server tests. |

## Recommendation

Keep ORCH-0768 as a separate implementation contract from ORCH-0767, but coordinate execution if both are being implemented in the same dirty branch. ORCH-0767 is data-source/RLS repair for empty brand pages. ORCH-0768 is presentation honesty and navigation cleanup across Home, Account, BrandSwitcherSheet, and PublicBrandPage.

If ORCH-0767 has not been dispatched yet, append the PublicBrandPage no-username requirement to that implementor prompt to avoid conflicting edits. If ORCH-0767 implementation is already in progress or present locally, ORCH-0768 can layer on top with small component/test changes and no migration.

## Verification Performed

```bash
cd mingla-business
PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/jest publicEventsService.test socialPreview.test --runInBand
# PASS src/services/__tests__/publicEventsService.test.ts
# PASS server/__tests__/socialPreview.test.ts
# Test Suites: 2 passed, 2 total
# Tests: 16 passed, 16 total

PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/tsc --noEmit
# PASS exit 0
```

Plain `npx` failed in this shell because `node`/`npm`/`npx` were not on PATH. `/opt/homebrew/bin` supplied Node successfully.
