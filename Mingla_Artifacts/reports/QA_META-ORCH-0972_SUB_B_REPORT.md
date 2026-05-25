# QA_META-ORCH-0972_SUB_B_REPORT

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]  
**Sub-scope:** Sub-B targeted verification with Phase 0.A live-fire gate  
**Tester:** Codex `tester-mingla` parity mirror  
**Date:** 2026-05-25  
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`  
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`  
**Baseline under test:** `3414ea6b8272a5cce864b474391781f8798ce5b3`  
**Adversarial test commit:** `411925909`  

## Verdict

**BLOCKED / UNVERIFIED — do not dispatch Sub-C yet.**

Sub-B source and automated regression gates are green, and iOS live-fire partially passed. The mandatory Phase 0.A live-fire gate did not fully pass across all three required surfaces: Android became unstable during create-flow execution and rendered Expo's default app screen, and web preview was only verified to the signed-out auth screen because no authenticated browser session or test credentials were available.

No product-code P0/P1 was proven in Sub-B source. The blocker is release-gate completeness: the required three-surface live-fire matrix is not fully evidenced.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry before other work. Acknowledged open WARN entries addressed to ALL:

- COMMS-0002 — backend strict-grep warning; factored, no backend files touched.
- COMMS-0003 — external API docs gate; N/A, no external API integration changed.
- COMMS-0004 — intake collision SOP; N/A for tester phase.

## Inputs Read

- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_B.md`
- `Mingla_Artifacts/reports/REVIEW_META-ORCH-0972_SUB_B.md`
- `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md`
- `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_COPY_INVENTORY.md`
- `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` §Sub-spec B

## Automated Verification

| Gate | Command | Result |
|---|---|---|
| Mandatory Sub-B Jest + tester adversarial test | `npx jest --runInBand __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx` from `mingla-business/` | PASS — 2 suites, 8 tests |
| Venue claim banner/service regression | `npx jest --runInBand src/services/__tests__/venueClaimService.test.ts` from `mingla-business/` | PASS — 1 suite, 4 tests |
| Admin production build | `npm run build` from `mingla-admin/` | PASS — Vite build completed with existing chunk-size/dynamic CSS warnings |
| Hard forbidden-path guard | `git diff --name-only fee178634..HEAD \| rg '(^supabase/|^\\.github/scripts/strict-grep/meta-orch-0972-|PublicBrandPage|publicEventsService|ExperienceMiniCard|useUpcomingFeed|EventMiniCard|TripMiniCard)'` | PASS — empty output |
| Deleted persona files | `find mingla-business/src/components/brand -maxdepth 1 \( -name 'PersonaPickerCards.tsx' -o -name 'PersonaForkSheet.tsx' -o -name 'TripBrandWizard.tsx' \) -print` | PASS — empty output |

## Adversarial Regression Test

**Path:** `mingla-business/__tests__/hooks/useHubVisibleTabs.test.tsx`  
**Commit:** `411925909`  
**Angle:** stale `@mingla/hub/lastTab` value points at a removed tab while only `getstarted` is visible.

The new test proves `deriveHubVisibleTabs({ events: 0, trips: 0, experiences: 0 })` returns `['getstarted']` and `pickHubInitialTab('experiences', ['getstarted'])` falls back to `getstarted`.

## Fails-On-Revert Re-Verification

Performed in throwaway worktree `/tmp/mingla-0972-revert-check`:

1. Added detached worktree at `3414ea6b8272a5cce864b474391781f8798ce5b3`.
2. Ran `git revert --no-commit 3414ea6b8272a5cce864b474391781f8798ce5b3`.
3. Restored only the two mandatory test files from `3414ea6b8272a5cce864b474391781f8798ce5b3`.
4. Ran `npx jest --runInBand __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx`.

**Result:** FAIL as expected.

Material failure proof:

- `BrandCreationFlow.test.tsx` failed because `src/components/brand/BrandCreationFlow.tsx` no longer exists under revert.
- `useHubVisibleTabs.test.tsx` failed TypeScript compile because `../../src/hooks/useHubTabs` no longer exists under revert.

This materially verifies the implementor's pre-amend `6633be066` fails-on-revert claim against the amended Sub-B commit.

## Phase 0.A Live-Fire Evidence

Evidence files:

- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/ios-offering-chooser.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/ios-event-create.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-home-recovered.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-default-expo-blocker.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/web-preview-auth-screen.png`

| Surface | Required coverage | Result | Evidence |
|---|---|---|---|
| iOS simulator | Empty-brand home/hub chooser; brand creation skip-address + skip-cover; Event/Trip/Experience creator routing; hub populated tabs; admin tabs | PARTIAL | iOS dev-client loaded this branch from Metro. Brand creation Step 1 → Step 4 worked. Skip-address and skip-cover worked. Step 4 OfferingChooser rendered. Event selection routed to event creator. Trip/Experience route live-fire and hub/admin live-fire were not completed before Android/web blockers made the gate non-passable. |
| Android emulator | Same business-app checklist | BLOCKED / UNVERIFIED | Emulator booted after manual foreground start. App loaded the branch Home screen after dismissing a System UI ANR. During create-flow attempt, the app later rendered Expo's default "Welcome to Expo / Start by creating a file in the app directory" screen, so Android create-flow evidence is not trustworthy. |
| Web preview | Same business-app checklist where applicable | BLOCKED / UNVERIFIED | Expo web served on `http://localhost:8081`; headless Chrome reached the signed-out Mingla Business auth screen. No authenticated browser session or test credentials were available, so Home/Hub/create/admin runtime paths were not live-fired on web. |
| Admin web | Venue Claims Pending/Verified/Rejected tabs | SOURCE + BUILD PASS, LIVE-FIRE UNVERIFIED | `ClaimsPage.jsx` has Pending review / Verified / Rejected tabs and dispatches to `listPendingClaims`, `listVerifiedClaims`, `listRejectedClaims`; `adminClaimsService.js` filters `claim_status` and no longer filters `.eq("kind", "physical")`. Admin build passed. Browser live-fire was not completed. |

## Findings

### P1 — Mandatory three-surface live-fire gate is incomplete

Sub-C dispatch is blocked because the required Phase 0.A matrix does not have complete PASS evidence for iOS, Android, and web preview. iOS produced useful partial proof, but Android and web did not complete the requested flows.

**Required retest:** rerun Phase 0.A with stable authenticated sessions on iOS simulator, Android emulator, and web preview. Capture either Maestro output or screenshots for: empty-brand Home and Hub chooser, skip-address + skip-cover brand creation, Event/Trip/Experience route selection, populated-only hub tabs, and Admin Venue Claims tab switching.

### P2 — OfferingChooser icon choice drifts from locked design

SPEC B.1.a says the three buttons use Calendar / Map / Sparkles. `OfferingChooser.tsx` uses `calendar`, `compass`, and `sparkle`. This is not the blocker, but it is a small design-lock mismatch to resolve before close if the locked icon names are considered exact rather than representative.

## Non-Blocker Notes

- `useBrandOfferingCounts` uses three direct `events` count queries instead of the spec's future `pg_brand_offering_counts` RPC. The Sub-B review accepted this as a transitional choice because Sub-C owns the RPC; no DB or migration touch was allowed in Sub-B.
- Metro logged existing warnings, including the known Stripe React Native `forwardRef` dev warning and route warning for `eventCardStatus.ts`. No Sub-B-specific crash was proven from those logs.

## Retest Contract

To convert this to PASS, tester must produce a new report showing:

1. iOS simulator: all Ready-To-Test checklist items 1-4 complete.
2. Android emulator: all Ready-To-Test checklist items 1-4 complete with no Expo default-screen fallback.
3. Web preview: authenticated Home/Hub/create runtime paths and admin Venue Claims tab switching complete.
4. Mandatory Jest suites still pass at HEAD with the adversarial test.
5. Hard guards still show no DB, migrations, edge functions, forbidden public-page files, forbidden strict-grep scripts, or Brand.kind reintroduction.

## Downstream Routing

Do not dispatch Sub-C yet. Route back to tester after the authenticated web session and stable Android emulator/dev-client state are available; if the Expo default-screen issue reproduces on a clean Android dev-client launch, route to `implementor-mingla` only with that Android finding isolated and reproducible.
