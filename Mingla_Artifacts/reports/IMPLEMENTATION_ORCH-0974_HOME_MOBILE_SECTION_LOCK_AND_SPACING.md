# IMPLEMENTATION — ORCH-0974 [Home (mingla-business mobile) section lock + spacing]

**Status:** implemented, partially verified  
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0974-[home-mobile-section-lock-and-spacing]/`  
**Branch:** `ORCH-0974-home-mobile-section-lock-and-spacing`  
**Implementation commit:** `0d95a5da0` (`ORCH-0974: lock mobile home upcoming pane`)  
**Fails-on-revert commit:** `3e638c926` (`ORCH-0974 verification: revert lock pane expectations`)  
**Restore commit:** `60ff97b0d` (`Revert "ORCH-0974 verification: revert lock pane expectations"`)

## Summary

Implemented the approved mobile-business Home layout contract: the populated mobile path now has a fixed dashboard zone containing the KPI hero/live hero, Active Events KPI, and the "Upcoming / See all" section header, followed by a single scrolling `FlatList` for upcoming items. The precise spacing contract is encoded in styles: `mobileKpiStack.gap: spacing.sm` (8px), `mobileSectionHeaderRow.paddingTop: spacing.lg` (24px), `mobileSectionHeaderRow.paddingBottom: spacing.md` (16px), and `mobileUpcomingContent.paddingBottom: spacing.xl * 4` (128px).

## Files Changed

| File | Change |
|---|---|
| `mingla-business/app/(tabs)/home.tsx` | Split the mobile path into desktop, mobile-empty, and mobile-populated branches; added `FlatList`, `useWindowDimensions`, lock-pane markers, mobile lock/list styles, small-phone ladder placement, and moved populated pull-to-refresh onto the FlatList. |
| `mingla-business/src/components/home/UpcomingListItem.tsx` | New memoized row component for draft, trip, and event/experience upcoming items, preserving existing roles, labels, and row presentation. |
| `mingla-business/app/(tabs)/__tests__/home.orch_0974.test.tsx` | New T-01..T-06 regression file covering lock structure, spacing, empty path refresh, and ladder-card placement. |
| `.github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` | New strict-grep invariant gate for single mobile populated scroll surface, style presence, spacing, FlatList refresh, and extracted row component. |
| `.github/workflows/strict-grep-mingla-business.yml` | Added one registry-pattern job: `ORCH-0974: Home mobile lock pane`; did not touch branch-protection required checks. |
| `Mingla_Artifacts/...ORCH-0974...` | Committed the investigation, approved spec, review, and screenshot evidence alongside implementation artifacts. |

## Spec Traceability

- SPEC §3.2 layout: implemented the outer `mobileBody`, `lockedZone`, and `FlatList` split under the populated mobile branch markers.
- SPEC §4.1 component extraction: implemented `UpcomingListItemProps` with draft/trip/event handlers and sales summary input.
- SPEC §5 spacing: implemented all concrete spacing tokens exactly as named.
- SPEC §6 state matrix: empty branch remains a single `ScrollView`; populated no-live and live states share one locked/list structure; live + small-phone ladder carve-out renders after the `FlatList`.
- SPEC §10 gate: implemented one script and one workflow job in the existing strict-grep registry.
- SPEC §12 guards: no touched files under `app-mobile/`, `mingla-admin/`, `mingla-marketing/`, `supabase/`, or `packages/`; no dependencies, migrations, edge functions, RPCs, or external APIs.

## UI/UX Pro Max Pre-Flight

Invoked `ui-ux-mingla`/UI-UX Pro Max before editing with query: `react native mobile dashboard fixed header scrolling list spacing hierarchy accessibility`, design-system target `Mingla Business mobile Home locked KPI dashboard`.

Applied findings:
- Keep the business dashboard operational and scan-first, not decorative.
- Use existing Mingla tokens instead of introducing a new visual language.
- Use a clear, mathematical vertical hierarchy: tight KPI grouping, stronger section boundary, then list rhythm.
- Preserve accessibility roles/labels on all interactive rows and actions.

## RN Version Check

`mingla-business/package.json` declares `"react-native": "0.81.5"`, which is above the RN 0.71 floor named by the spec. The implementation still uses `ItemSeparatorComponent` for the 8px inter-card gap, so the lock/list contract does not depend on `contentContainerStyle.gap`.

## Verification

| Gate | Result | Evidence |
|---|---:|---|
| `node .github/scripts/strict-grep/orch-0965-home-uses-upcoming-hook.mjs` | PASS | ORCH-0965 tri-kind upcoming ownership preserved. |
| `node .github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` | PASS | Lock-pane strict-grep gate passes. |
| `cd mingla-business && npx jest 'app/\\(tabs\\)/__tests__/home.orch_0974.test.tsx' --runInBand` | PASS | T-01..T-06 pass after restore commit `60ff97b0d`. |
| `cd mingla-business && npx eslint 'app/(tabs)/home.tsx' 'src/components/home/UpcomingListItem.tsx' 'app/(tabs)/__tests__/home.orch_0974.test.tsx'` | PASS | 0 errors, 0 warnings after import de-dupe. |
| `cd mingla-business && npx tsc --noEmit --pretty false` | FAIL, pre-existing unrelated | Fails on existing checkout/playwright/package/shared-package errors; no reported errors in ORCH-0974 files. |
| DIAG marker reap | PASS | `rg "[ORCH-0974-DIAG]"` outside the spec returned zero implementation markers. |

## Fails-On-Revert Receipt

Verification commit `3e638c926` temporarily reverted the three minimum contract points:
- Replaced the mobile populated `<FlatList>` token with `<ScrollView>` to prove T-01 catches the old single-scroll-surface shape.
- Reverted `mobileSectionHeaderRow.paddingBottom` from `spacing.md` to `0` to prove T-02 catches the header/card breathing-room regression.
- Removed the `!isSmallPhoneWithLiveHero` locked-zone guard to prove T-05 catches the large-phone ladder placement contract.

Running the ORCH-0974 Jest file at `3e638c926` failed T-01, T-02, and T-05 as required. Restore commit `60ff97b0d` reverted the verification breakage and the suite passed again.

## Screenshots / Device Eyeball

Pre-implementation investigation screenshots committed:
- `Mingla_Artifacts/reports/screenshots/orch-0974/ios-sim-current-state.png`
- `Mingla_Artifacts/reports/screenshots/orch-0974/ios-sim-after-swipe-up.png`

Post-implementation native eyeball was attempted but is **not verified**. `npx expo start --port 8092 --dev-client` bundled iOS and Android successfully, but launching the installed dev clients opened Expo Router's default "Welcome to Expo / Start by creating a file in the app directory" screen instead of the Mingla Business app shell. Captured blocker evidence:
- `Mingla_Artifacts/reports/screenshots/orch-0974/ios-17-pro-max-runtime-blocked-expo-router-welcome.png`
- `Mingla_Artifacts/reports/screenshots/orch-0974/ios-se-3rd-gen-runtime-blocked-expo-router-welcome.png`
- `Mingla_Artifacts/reports/screenshots/orch-0974/pixel-6-runtime-blocked-expo-router-welcome.png`

Because the real Home screen did not load, the iPhone 17 Pro Max, iPhone SE 3rd gen, and Pixel 6 visual checks remain a tester/manual gate.

## Before / After Code-Diff Overview

Before:
- The populated mobile path lived inside one outer `ScrollView`.
- KPI hero, Active Events, section header, and list items participated in the same scroll surface.
- The list body used an inert nested `ScrollView` on mobile and the populated pull-to-refresh lived on the outer scroll.
- The section header had no explicit bottom padding before the first card.

After:
- Desktop path remains isolated in its existing scroll/pane structure.
- Mobile empty path remains a single refreshable `ScrollView`.
- Mobile populated path uses `mobileBody -> lockedZone + FlatList`.
- Pull-to-refresh on populated mobile is on the `FlatList`.
- Upcoming item rendering is extracted into `UpcomingListItem`.
- Strict-grep guards the markers and spacing from regressing.

## Risks / Follow-Up Gates

- Native visual verification is still required because the local dev-client launch currently opens the Expo Router welcome fallback instead of the Mingla Business app shell.
- Tester should run the spec's adversarial A-01..A-05 suite, with minimum fails-on-revert for A-01.
- Orchestrator review should perform the requested commit-hash verification and dependency walk, especially because this branch also contains earlier inherited work relative to `origin/main`.

## Deploy Notes

No migrations, Supabase functions, external APIs, or Stripe surfaces touched. Close routing still needs Vercel `[deploy]` because `mingla-business/src/` changed, plus EAS OTA for iOS and Android after tester approval per the approved spec.
