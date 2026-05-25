# QA — ORCH-0974 [Home (mingla-business mobile) section lock + spacing]

**Tester:** Codex `tester-mingla` parity mirror  
**Date:** 2026-05-25  
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0974-[home-mobile-section-lock-and-spacing]/`  
**Branch:** `ORCH-0974-home-mobile-section-lock-and-spacing`  
**Input HEAD:** `84bf01d62`  
**QA HEAD before report commit:** `35c8a92d6`  
**Implementation commit:** `0d95a5da0`  
**Tester adversarial commit:** `3a9477ce2`  
**Tester fails-on-revert commit:** `809ebab1e`  
**Tester restore commit:** `35c8a92d6`

## Verdict

**CONDITIONAL PASS.**

The code and automated gates satisfy the ORCH-0974 contract: the populated mobile Home path is `lockedZone + FlatList`, the section header has the required 16px bottom breathing room, the 8px KPI gap and 24px zone boundary are present, populated pull-to-refresh remains on the FlatList and invalidates `brandKeys.all`, `eventOrdersKeys.all`, and `upcomingKeys.all`, and the iPhone-SE-class live-hero/rung-4 ladder carve-out is encoded and regression-tested.

The only release condition is visual/runtime: `npx expo start --port 8092 --dev-client` still opens Expo Router's welcome fallback instead of the Mingla Business shell on iPhone 17 Pro Max, iPhone SE 3rd gen, and Android. This matches the pre-existing ORCH-0971 worktree live-fire blocker called out in the dispatch. Operator must eyeball SC-1..SC-9 and SC-11 ladder matrix on a real iPhone after EAS OTA / TestFlight before treating the user-touchable Home UI as fully verified.

## Findings

| Severity | Finding | Status | Evidence |
|---|---|---|---|
| P2 | Native visual smoke remains blocked by ORCH-0971: dev client opens Expo Router welcome fallback, so SC-1..SC-9 cannot be visually proven in this worktree. | Conditional gate | Screenshots: `qa-ios-17-pro-max-dev-client.png`, `qa-ios-se-3rd-gen-dev-client-final.png`, `qa-android-pixel-8-pro-dev-client.png`. Metro bundled iOS and Android successfully before fallback. |
| P2 | Static web export mounts at `<768px`, but unauthenticated static Chromium lands on the auth screen, not Home. SC-1/SC-2 are mechanically verified by source/tests but not visually measured in web Home. | Conditional gate | `npx expo export -p web` exported `dist`; `npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=10000 http://127.0.0.1:8093 ...` captured `qa-web-static-390x844-after10s.png` showing the auth screen. |

No P0/P1 blockers found.

## Commands Run

| Command | Result |
|---|---|
| `npx jest 'app/\(tabs\)/__tests__/home.orch_0974.test.tsx' --runInBand` | PASS, 6/6 T-01..T-06 |
| `npx jest 'app/\(tabs\)/__tests__/home.orch_0974.adversarial.test.tsx' --runInBand` | PASS, 5/5 A-01..A-05 |
| `npx jest 'app/\(tabs\)/__tests__/home.orch_0974.test.tsx' 'app/\(tabs\)/__tests__/home.orch_0974.adversarial.test.tsx' --runInBand` | PASS, 11/11 |
| `npx eslint 'app/(tabs)/__tests__/home.orch_0974.adversarial.test.tsx'` | PASS |
| `node .github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` | PASS |
| `node .github/scripts/strict-grep/orch-0965-home-uses-upcoming-hook.mjs` | PASS |
| `npx expo start --port 8092 --dev-client` | Bundled iOS + Android; blocked by Expo Router welcome fallback |
| `npx expo export -p web` | PASS, exported `dist` |
| `npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=10000 http://127.0.0.1:8093 ...` | PASS, static app mounted auth screen |

## Success Criteria Mapping

| SC | Verdict | Evidence |
|---|---|---|
| SC-1 locked KPI hero + Active Events + header do not translate on list flick | CONDITIONAL PASS | Source structure proves the locked zone is outside the FlatList: `home.tsx:787-937`, with locked zone at `789-895` and FlatList at `897-929`. T-01 and strict-grep pass. Native visual flick is deferred because dev client falls back to Expo Router welcome. |
| SC-2 16px breathing room above first card | PASS mechanically, visual deferred | `mobileSectionHeaderRow.paddingBottom: spacing.md` at `home.tsx:1042`; T-02 passes. Native/web Home visual measurement deferred. |
| SC-3 KPI hero to Active Events gap is 8px | PASS | `mobileKpiStack.gap: spacing.sm` at `home.tsx:1033-1035`; T-03 passes. |
| SC-4 Active Events to Upcoming header zone boundary is >=24px | PASS | `mobileSectionHeaderRow.paddingTop: spacing.lg` at `home.tsx:1041`; T-02 passes. |
| SC-5 pull-to-refresh still invalidates brand/event-orders/upcoming keys from the upcoming list | PASS | FlatList has `refreshControl` at `home.tsx:924-927`; `handleRefresh` invalidates all three keys at `home.tsx:154-161`; A-01 passes and fails-on-revert at `809ebab1e`. |
| SC-6 empty-state branch unchanged/no lock | PASS | Empty mobile branch remains a ScrollView with `emptyCol` at `home.tsx:736-785`; T-04 and A-03 pass. |
| SC-7 draft/trip/event/experience list variants preserved via `UpcomingListItem` | PASS | FlatList renders `UpcomingListItem` at `home.tsx:897-910`; A-05 snapshots draft/trip/event branch tokens in `UpcomingListItem.tsx`. |
| SC-8 iPhone-SE-class live hero + rung-4 ladder renders below FlatList | PASS mechanically, visual deferred | `isSmallPhoneWithLiveHero` at `home.tsx:383-384`; locked placement at `790-792`; foot placement at `931-934`; T-06 and A-04 pass. Native SE visual deferred by Expo fallback. |
| SC-9 desktop wide path unchanged | PASS | Desktop branch remains separate at `home.tsx:409-735`; T-09-equivalent happy test T-01/T-04 source split and strict-grep pass. No desktop visual runtime requested beyond source/gate. |
| SC-10 exactly one scrollable surface on mobile populated path | PASS | Populated mobile block has one `<FlatList>` and zero `<ScrollView>` tokens; T-01 and strict-grep pass. |
| SC-11 ORCH-0965 `HomeNextActionCard` condition preserved | PASS | Condition preserved in locked and footer placements: `home.tsx:790` and `931`; A-04 covers rung 1-4 × live/no-live × small/large matrix. |
| SC-12 no dependencies/backend/supabase/external API touched | PASS | Branch diff for ORCH-0974 code/test/report scope touches `mingla-business` UI/test artifacts, strict-grep, workflow, and Mingla artifacts only. COMMS-0003/0002 are N/A for this frontend QA. |

## A-01..A-05 Results

| Test | Result | Evidence |
|---|---|---|
| A-01 FlatList refresh invalidates `brandKeys.all`, `eventOrdersKeys.all`, `upcomingKeys.all` | PASS | `home.orch_0974.adversarial.test.tsx:77-94`; fails when FlatList refreshControl is removed. |
| A-02 populated empty upcoming list renders `ListEmptyComponent` GlassCard | PASS | `home.orch_0974.adversarial.test.tsx:96-104`. |
| A-03 empty brand path does not render ladder card | PASS | `home.orch_0974.adversarial.test.tsx:106-113`. |
| A-04 ladder condition matrix preserved | PASS | `home.orch_0974.adversarial.test.tsx:115-152`. |
| A-05 draft/trip/event list branch extraction snapshot | PASS | `home.orch_0974.adversarial.test.tsx:154-223`. |

### Fails-On-Revert Receipt

- Tester test commit: `3a9477ce2` (`ORCH-0974: add QA adversarial tests`).
- Intentional break commit: `809ebab1e` (`ORCH-0974 verification: remove FlatList refresh control`).
- At `809ebab1e`, `npx jest 'app/\(tabs\)/__tests__/home.orch_0974.adversarial.test.tsx' --runInBand` failed A-01 with expected substring `refreshControl=` missing from the FlatList block.
- Restore commit: `35c8a92d6` (`Revert "ORCH-0974 verification: remove FlatList refresh control"`).
- After restore, A-01..A-05 passed and the combined T/A suite passed 11/11.

## Runtime Smoke Evidence

| Surface | Attempt | Result |
|---|---|---|
| iPhone 17 Pro Max simulator | `npx expo start --port 8092 --dev-client`, Expo CLI `i`, screenshot | Blocked by Expo Router welcome fallback. Screenshot: `Mingla_Artifacts/reports/screenshots/orch-0974/qa-ios-17-pro-max-dev-client.png`. |
| iPhone SE 3rd gen simulator | Booted `ORCH-0974 iPhone SE 3rd gen`, launched `com.sethogieva.minglabusiness`, opened dev URL, screenshot | Blocked by Expo Router welcome fallback. Screenshot: `Mingla_Artifacts/reports/screenshots/orch-0974/qa-ios-se-3rd-gen-dev-client-final.png`. |
| Android emulator | Expo CLI `a` against `Pixel_8_Pro`, screenshot via `adb exec-out screencap -p` | Blocked by Expo Router welcome fallback. Screenshot: `Mingla_Artifacts/reports/screenshots/orch-0974/qa-android-pixel-8-pro-dev-client.png`. |
| Static web `<768px` | `npx expo export -p web`; served `dist` on `127.0.0.1:8093`; Playwright Chromium 390×844 | App mounted to auth screen after 10s. Home not reachable without seeded auth. Screenshot: `Mingla_Artifacts/reports/screenshots/orch-0974/qa-web-static-390x844-after10s.png`. |

## Discoveries

No new cross-ORCH discovery requiring a COMMS entry. The native fallback is the known ORCH-0971 live-fire infrastructure blocker. Static web auth gating is expected for an unauthenticated static mount and does not imply a Home implementation defect.

## Required Close Conditions

1. Orchestrator rebases this branch onto `origin/main`, resolving the expected ORCH-0973 `home.tsx` conflict without losing either lane.
2. Orchestrator reruns T-01..T-06, A-01..A-05, `orch-0974-home-mobile-lock-pane.mjs`, and `orch-0965-home-uses-upcoming-hook.mjs` after the rebase.
3. Operator visually verifies on real iPhone post-EAS-OTA/TestFlight: SC-1..SC-9 and SC-11 ladder matrix, especially iPhone-SE-class live hero + rung-4 action placement.
4. Orchestrator opens the close PR with Vercel `[deploy]` tag and runs EAS OTA for iOS and Android.
