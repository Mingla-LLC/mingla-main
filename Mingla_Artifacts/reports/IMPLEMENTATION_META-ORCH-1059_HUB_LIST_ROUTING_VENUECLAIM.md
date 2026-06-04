# IMPLEMENTATION — META-ORCH-1059 Hub experiences: list render + tap routing + venue-claim → to-do

**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]` on branch `meta-orch-1059-experiences-business-parity`
**Pre-fix HEAD:** `d84a6c479facfd834555bd3d4f07b235d7eba680`
**Scope:** frontend-only (mingla-business), no migration. Three operator-reported fixes.

---

## Comms Ledger

Read on entry. No `BLOCK`/`OPEN` entries target `mingla-implementor` or META-ORCH-1059. COMMS-0014/0016 (experience checkout must route through `ticket-checkout-create`) are FYI context, not relevant to these three UI fixes (no checkout/edge work touched). No new cross-ORCH discovery to write.

---

## FIX 1 — Experiences list renders as a proper offering list

### Root cause
`app/(tabs)/hub/experiences.tsx` rendered each experience as a bare `GlassCard` with only `{title + status text-chip + description + capacity/intent meta}`. No cover thumbnail, no date subline, no price — so it read as a text block, not an offering row like the events / trips lists. The lightweight `getExperiencesByBrand` query only fetched `title/description/status/theme` (no cover, no date, no price columns), so the data for a proper card was never loaded.

### Fix
1. **Service** (`src/services/experiencesService.ts`): the list query now also selects `currency, cover_media_url, cover_media_type, whole_price_cents, is_recurring, is_multi_date` (still one query, no N+1). The mapper resolves three new `VenueExperience` fields: `coverMediaUrl`, `coverMediaType`, `dateSubline`, `priceLabel`.
2. **New pure helper** (`src/utils/experienceListSubline.ts`): converts the persisted `theme.experience_meta.when_draft` blob → ISO start strings + recurrence rule, then delegates to the existing `formatExperienceDateSubline` (the ONE subline owner used by the dashboard + preview). This makes the list show a correct date subline **including for drafts** (which have no materialised `event_dates`), without an N+1 fetch of every experience's dates.
3. **New component** (`src/components/experience/ExperienceListCard.tsx`): mirrors the polished `EventListCard` pattern — 76×92 cover (with hue fallback + DRAFT overlay) + status pill + title + date·venue subline + price + chevron tap-affordance. Android opaque-fill policy (META-ORCH-1002) applied.
4. **Render** (`experiences.tsx`): the populated list now maps to `<ExperienceListCard>`. Loading (`ActivityIndicator`) and empty (GlassCard + "Create experience" CTA) states unchanged. Dead helpers `formatExperienceMeta` + `experienceStatusChip` and their styles removed; dead imports (`VenueExperience`, `semantic`) dropped.

---

## FIX 2 — Tapping an experience opens the DASHBOARD, not edit

### Root cause
`src/utils/routeForEventRow.ts` mirrored event/trip behaviour for experiences: `status === "draft" ? /experience/{id}/edit : /experience/{id}`. So tapping a DRAFT experience jumped straight into the edit wizard instead of the dashboard.

### Fix
The experience branch now **always** returns `/experience/{id}` (dashboard), regardless of status. Event/trip routing is unchanged. The dashboard (`app/experience/[id]/index.tsx`) already surfaces draft state (HeroStatusPill renders "Draft") and already labels its Edit action **"Continue editing"** for drafts (line 241) → no dashboard change needed; it was already built for this.

### Strict-grep / test allowlist updates
- `src/utils/__tests__/routeForEventRow.test.ts`: replaced the stale `experience → /experience/coming-soon` case (which was already failing against the Sub-B helper) with four cases asserting draft/scheduled/live/ended all → `/experience/{id}`.
- `src/services/__tests__/eventType.filter.audit.test.ts`: the META-ORCH-1059 experience-routing block now asserts ALL experiences → `/experience/{id}` and that the branch never routes to `/edit` or `coming-soon`.
- `.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs` already allowlists `app/experience/[id]/*` (added in Sub-B) — no change needed; the helper itself remains the canonical owner.

---

## FIX 3 — Remove the venue-claim blue box from Hub → to-do row

### Root cause
`app/(tabs)/hub/_layout.tsx` rendered `<VenueClaimStatusBanner brand={currentBrand} />` (a blue "your venue claim is being reviewed" box) on every Hub screen — redundant with the brand-page venue listing.

### Fix
1. **Hub layout**: removed the `<VenueClaimStatusBanner>` render + its import. `useVenueClaimRefresh()` is KEPT (it keeps the brand's `claim_status` fresh, which now feeds the to-do row). Confirmed `VenueClaimStatusBanner` is referenced nowhere else (Hub-only removal; the component file is now orphaned — left in place, flagged as a discovery).
2. **To-do derivation** (`src/utils/businessTodos.ts`): added `venueClaimPending: boolean` + `venueListingRoute: string` inputs and a `venue_claim_review` row ("Venue claim under review" → routes to `/brand/{id}/listing`). It sits after the venue add/finish/get-live rows and before first-offering, and vanishes automatically when the claim resolves.
3. **Hook** (`src/hooks/useBusinessTodos.ts`): derives `venueClaimPending` by reusing the SAME `venueClaimBannerVariant` logic the banner used (`pending_review` + admin `follow_up` sub-state), from the brand's `claimStatus/claimFollowUpAt/rejectionReason`. Routes to `/brand/{id}/listing`.

---

## Old → New receipts

| File | Before | After |
|---|---|---|
| `src/utils/routeForEventRow.ts` | experience draft→`/edit`, else `/{id}` | experience ALWAYS→`/{id}` (dashboard) |
| `src/services/experiencesService.ts` | select title/desc/status/theme; map title/desc/intent/price-from-theme | + select cover/price/when cols; + map `coverMediaUrl/Type`, `dateSubline`, `priceLabel` |
| `src/utils/experienceListSubline.ts` | (new) | when_draft → ISO derivation → `formatExperienceDateSubline` |
| `src/components/experience/ExperienceListCard.tsx` | (new) | polished offering-card row (cover+pill+title+subline+price) |
| `app/(tabs)/hub/experiences.tsx` | inline GlassCard text block; dead helpers/styles | `<ExperienceListCard>` rows; dead code removed |
| `app/(tabs)/hub/_layout.tsx` | renders `<VenueClaimStatusBanner>` | banner removed; claim now a to-do row |
| `src/utils/businessTodos.ts` | no claim row | + `venueClaimPending`/`venueListingRoute` → `venue_claim_review` row |
| `src/hooks/useBusinessTodos.ts` | — | derives `venueClaimPending` via `venueClaimBannerVariant`; passes listing route |

---

## Tests + verification

### Regression tests (all PASS; fails-on-revert verified @ `d84a6c479`)
- `src/utils/__tests__/routeForEventRow.test.ts` — experience always→dashboard (draft/sched/live/ended). **Fails-on-revert**: reintroducing draft→`/edit` → +2 failures.
- `src/services/__tests__/eventType.filter.audit.test.ts` — branch never→`/edit`/`coming-soon`. (Same revert proof.)
- `src/utils/__tests__/experienceListSubline.test.ts` (new) — single/multi/recurring/ended/draft sublines. **Fails-on-revert**: stubbing isos→[] → 4 failures.
- `src/utils/__tests__/businessTodos.test.ts` — claim row appears when pending, vanishes when resolved, ordered after venue / before offering. **Fails-on-revert**: gating the push off → 3 failures.
- `src/services/__tests__/experiencesService.test.ts` — list query selects cover/price/when; mapper resolves subline+price+cover.

**Full touched + adjacent suite: 81/81 pass** (incl. `BusinessTodoToggle`, `DeckReadinessCard.sub_e`, `NoVenueDeckEntryCard.sub_e`, `hubExperiences.contract`, `metaOrch1059IntentsMultiAndHub`).

### TEST-MOD-APPROVED (existing tests modified with deletions)
- `routeForEventRow.test.ts` (3 del) + `eventType.filter.audit.test.ts` (10 del) — replaced stale `/experience/coming-soon` + draft→`/edit` assertions with the new dashboard-always contract. The other modified tests (`businessTodos`, two `sub_e`, `experiencesService`) are ADDITIONS-ONLY (new required input fields on `base` + new cases).

### tsc
`tsc --noEmit` on touched files: **0 errors in any file I touched**. (243 pre-existing repo-wide errors come from other sessions' in-flight `M` files — e.g. `packages/brand-rendering/PublicBrandPage.tsx` — and the abandoned-merge `UU` cruft; none reference my new symbols.)

### Device evidence
Physical Android `R58R54YV7JT` was NOT connected via adb this session (only `emulator-5554` present; the COMMS-0017 reservation for it is RESOLVED/expired). Verified on the **Android emulator** instead: Metro 8090 (this worktree's mingla-business, `--dev-client --clear`) → launched `com.sethogieva.minglabusiness` dev client → bundle compiled and the app ran with my changes, **no red-screen/crash** (screenshot `01_current.png` shows the Mingla Business login screen). Logged-in Hub UI (list render, tap→dashboard, venue-claim to-do) could not be exercised because sim login is operator-gated and the physical device is unplugged — **Seth must do the final on-device tap-through** (steps in the chat handoff). All three fixes are hot-reload-safe and fully covered by passing fails-on-revert tests.

---

## Cross-surface impact (Step 3.5)
- **Business iOS / Business Android** (`mingla-business/`): AFFECTED — all three fixes. Shared code path → automatic parity across iOS/Android.
- **Consumer iOS/Android, Buyer-anon Web, Admin Web**: UNAFFECTED — these surfaces don't render the business Hub experiences list / business to-do / business routing.
- **Business Web preview**: same shared components → fixes apply, but the device repro target is native.

---

## Discoveries for orchestrator
1. **Orphaned component**: `src/components/brand/VenueClaimStatusBanner.tsx` + its copy helpers are now referenced nowhere in active code (only `useVenueClaimRefresh` survives, intentionally). Candidate for deletion in a follow-up cleanup ORCH (left in place to avoid out-of-scope churn).
2. **Pre-existing strict-grep route violations (NOT mine)**: `i-proposed-tr2-route-by-event-type.mjs` exits 1 on 3 hardcoded routes in `app/(tabs)/home.tsx:354`, `app/accept-scanner-invitation.tsx:94`, `src/components/scanners/ScannerHome.tsx:119` — all files unmodified by this ORCH (other sessions' WIP on the shared branch). My `experiences.tsx` is clean. Flag for whoever owns those files; the gate will block the eventual PR until they're allowlisted/fixed.
3. **Pre-existing audit-test failures (NOT mine)**: `eventType.filter.audit.test.ts` has 3 unrelated failures in the `publicEventsService`/`tripsService` trip-query blocks (the worktree's `publicEventsService.ts` is another session's `M` file). My experience-routing assertions pass.
4. **Pre-existing tsc errors**: 243 repo-wide, from the abandoned-merge `UU` cruft + other sessions' `M` files. None in my touched files.

These pre-existing issues live in files this ORCH did not touch and were left untouched per the shared-anchor / scope-discipline rules.
