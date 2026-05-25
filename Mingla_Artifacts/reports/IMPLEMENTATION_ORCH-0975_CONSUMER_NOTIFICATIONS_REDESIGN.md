# Implementation Report: Consumer Notifications Sheet Redesign (ORCH-0975)

> Date: 2026-05-25
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0975_ADDENDUM_PER_TYPE_MATRIX.md`, `Mingla_Artifacts/specs/SPEC_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`, `Mingla_Artifacts/design/DESIGN_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`
> Status: implemented, partially verified

## 1. Layman Summary

The consumer notification center has been rebuilt as a modern bottom sheet. Users now get a light premium sheet with pan-down close, explicit close button, new header copy, grouped chronological notifications, ringed avatar/icon cards, unread dots, category pills, and redesigned action buttons. The redesign intentionally does not fabricate unavailable actor/location data: v1 shows body text as-is and uses type icons when a real avatar URL is absent.

## 2. Request And Context

- **Request:** Implement ORCH-0975 end-to-end in the per-ORCH worktree.
- **Source:** User-dispatched implementor prompt with binding addendum, spec, and design artifacts.
- **Affected surfaces:** Consumer app iOS and Android through shared `app-mobile` React Native code.
- **Related issues/artifacts:** The addendum overrides the original spec for bold actor split, location row, and avatar resolution.

## 3. Scope

- **In scope:** Tokens, all notification locales, `NotificationsModal.tsx` rename/rewrite to `NotificationsSheet.tsx`, HomePage import/JSX, strict-grep gate, fixture file, regression test, and implementation report.
- **Out of scope:** `useNotifications.ts`, server notification writers, OneSignal payloads, backend functions, schema/RLS, package/native config changes, actor profile lookups, and location-chain parsing.
- **Assumptions:** The existing `@gorhom/bottom-sheet` v5 dependency remains available; tester performs iOS/Android simulator and physical iPhone pan-feel checks.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0975_ADDENDUM_PER_TYPE_MATRIX.md` | Authoritative override | 24/25 types expose only `data.deepLink`; v1 must not infer names/locations. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md` | Binding success criteria | Defines 35 original criteria, implementation order, gates, and routing. |
| `Mingla_Artifacts/design/DESIGN_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md` | Visual contract | Defines light sheet tokens, card geometry, states, accessibility, and bottom-sheet usage. |
| `app-mobile/src/components/NotificationsModal.tsx` | Existing implementation | RN Modal, filter chips, old card chrome, action behavior to preserve. |
| `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` | Bottom-sheet pattern | Used ref/index/effect, backdrop, `BottomSheetView`, and handle patterns. |
| `app-mobile/src/hooks/useNotifications.ts` | Hook contract | Left bit-identical. |
| `app-mobile/src/components/HomePage.tsx` | Caller | Only import and JSX component name changed. |
| `.github/workflows/strict-grep-mingla-business.yml` | CI registry | Added one modular ORCH-0975 job. |

## 5. Blast Radius

- **Direct changes:** Consumer notification UI and copy.
- **Cascade changes:** Locale namespace changes across 29 notification locale files; CI strict-grep registry gains one job.
- **Parity surfaces:** Shared mobile code covers iOS and Android; no business/admin/public web runtime change.
- **Cache impact:** None.
- **State boundaries:** React Query notification hook remains sole server-state owner.
- **Auth/RLS/security:** None.
- **Deploy path:** Pure JS/content change, EAS OTA eligible after close. No Vercel deploy tag.

## 6. Old To New Receipts

### `app-mobile/src/constants/designSystem.ts`

- **Before:** No light notification-sheet token namespace.
- **After:** Added `glass.notificationsSheet.*` tokens for canvas, handle, card shadow/border/unread bg, avatar rings, dots, and category pills.
- **Why:** Makes the light notification sheet explicit without mutating dark bottom-sheet tokens.
- **Approx lines changed:** +46.

### `app-mobile/src/i18n/locales/*/notifications.json`

- **Before:** `filters.*` locale namespace existed; no `header.subtitle`, `header.newCount`, or `categoryLabels.*`.
- **After:** All 29 files remove `filters`, add subtitle/new-count copy, update mark-all copy, and add Social/Plans/Chats/System labels.
- **Why:** Filter chip row is deleted and cards now carry category pills.
- **Approx lines changed:** 29 files modified.

### `app-mobile/src/components/NotificationsModal.tsx` -> `NotificationsSheet.tsx`

- **Before:** RN `Modal`, manual backdrop, horizontal filters, flat notification cards.
- **After:** `@gorhom/bottom-sheet` with `BottomSheetSectionList`, light sheet header, combined action pill, no filters, redesigned cards, body-only secondary line, explicit-name-only bold split, Option C icon fallback, states, and re-export shim.
- **Why:** Implements the visual and behavioral redesign while preserving server-state/action behavior.
- **Approx lines changed:** renamed/reworked from 1109 lines to 1229 lines.

### `app-mobile/src/components/HomePage.tsx`

- **Before:** Imported/rendered `NotificationsModal`.
- **After:** Imports/renders `NotificationsSheet`; local state names unchanged.
- **Why:** Caller points at the renamed component.
- **Approx lines changed:** 2 locations.

### `.github/scripts/strict-grep/orch-0975-notifications-sheet.mjs`

- **Before:** No ORCH-0975 gate.
- **After:** Adds C1 no RN Modal + bottom-sheet presence, C2 no notification locale filters, C3 categoryLabels exists across all notification locales.
- **Why:** Prevents regression to old sheet/filter structure.
- **Approx lines changed:** new file.

### `.github/workflows/strict-grep-mingla-business.yml`

- **Before:** No ORCH-0975 job.
- **After:** Registers `orch-0975-notifications-sheet`.
- **Why:** CI runs the new invariant gate.
- **Approx lines changed:** +12.

### `app-mobile/src/components/__tests__/__fixtures__/notificationsFixtures.ts`

- **Before:** No shared fixtures.
- **After:** Adds 8 fixtures from the addendum covering the three archetypes, read/unread, action buttons, and all category labels.
- **Why:** Regression and tester baseline.
- **Approx lines changed:** new file.

### `app-mobile/src/components/__tests__/NotificationsSheet.test.tsx`

- **Before:** No ORCH-0975 regression test.
- **After:** Adds app-mobile style Node assertion test covering SC-01..SC-35 plus SC-36/37/38 structurally.
- **Why:** App-mobile has no Jest test script; this follows existing source-level regression pattern.
- **Fails-on-revert anchor:** `d2fca61b37c8e328e31340281b05fed59e1fd86b`.
- **Fails-on-revert evidence:** Reverted `app-mobile/src/components/NotificationsSheet.tsx` to the pre-implementation state by `git rm` after `git checkout main -- src/components/NotificationsSheet.tsx` found no file; the regression failed with `ENOENT`, then restored from `HEAD` and passed again.
- **Approx lines changed:** new file.

## 7. Implementation Details

- **Architecture decisions:** Kept card inline in `NotificationsSheet.tsx`; split was optional. Used the repo's `Icon` wrapper and existing `ImageWithFallback`.
- **Data flow:** `notifications` are grouped directly; no filter state or derived filtered list remains.
- **Mutation/query behavior:** Existing accept/decline/card press behavior preserved; no React Query hook changes.
- **State handling:** Keeps local `failedImageIds` and `actionErrors`; bottom-sheet open/close driven by visible prop plus defensive ref calls.
- **Error handling:** Action errors still render inline; loading, empty, error, and offline states are redesigned.
- **Copy/accessibility:** Header subtitle/new-count and category labels are localized; close/action/card controls carry labels/hints.
- **Analytics/notifications/realtime:** No analytics, realtime, notification writer, or push payload changes.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-01..06 bottom sheet close paths | Yes | Source test + strict-grep; sim needed for gesture feel | Partial pending tester |
| SC-07 no filters | Yes | Source test, `rg "notifications:filters"`, strict-grep C2 | Pass |
| SC-08..11 header/action row | Yes | Source test and locale parse | Pass |
| SC-12 chronological grouping | Yes | Source test confirms grouping uses full list | Pass |
| SC-13 card chrome | Yes | Source test checks ring/dots/category/body structures | Partial pending visual QA |
| SC-14 actionable buttons | Yes | Source test covers five action types | Pass |
| SC-15 card behavior | Yes | Source test checks preserved mark/delete paths | Pass |
| SC-16..19 states | Yes | Source test checks state blocks | Pass |
| SC-20..21 iOS/Android layout | Code ready | Requires tester sim/emu | Pending tester |
| SC-22 category helper | Yes | Source test checks helper and 25 type registry | Pass |
| SC-23 locale contract | Yes | Strict-grep parses all 29 locales | Pass |
| SC-24 `useNotifications.ts` bit-identical | Yes | `git diff HEAD -- app-mobile/src/hooks/useNotifications.ts` empty | Pass |
| SC-25 HomePage touch | Yes | Diff is import + JSX component name only | Pass |
| SC-26 strict-grep gate | Yes | `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` | Pass |
| SC-27 implementor regression | Yes | `node src/components/__tests__/NotificationsSheet.test.tsx` | Pass |
| SC-28 tester adversarial | Not implementor-owned | Route to tester | Pending tester |
| SC-29..32 constitution/accessibility | Yes | Source test + code inspection | Partial pending device QA |
| SC-33 rename/blame | Git mv executed | `git diff -M1 --name-status` reports `R048` | Pass with low similarity |
| SC-34 re-export shim | Yes | Source test checks named export + type alias | Pass |
| SC-35 EAS OTA eligible | Yes | `git diff HEAD -- app-mobile/package.json app-mobile/app.config.ts app-mobile/eas.json app-mobile/ios app-mobile/android` empty | Pass |
| SC-36 fixture archetypes/types | Yes | Source test checks 8 fixtures + 25 icon registry entries | Pass |
| SC-37 bold split only explicit data name | Yes | Source test checks helper field order/no heuristics | Pass |
| SC-38 no location chain row | Yes | Source test checks no location helper/testID/data fields in component | Pass |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-PROPOSED-J Zustand no server snapshots | Yes | Yes | No Zustand/AsyncStorage changes. |
| I-38 touch target | Yes | Yes | Close/action buttons use dimensions or hitSlop; cards exceed 44pt. |
| I-39 accessibilityLabel | Yes | Yes | Close, header actions, card, and action buttons labelled. |
| RN color format | Yes | Yes | Hex/rgb/rgba only in new tokens/styles. |
| I-PROPOSED-ORCH-0975-NOTIFICATIONS-NO-RN-MODAL | Yes | Yes | Strict-grep C1. |
| I-PROPOSED-ORCH-0975-NOTIFICATIONS-NO-FILTER-CHIPS | Yes | Yes | Strict-grep C2 and no filter state/render path. |
| I-PROPOSED-ORCH-0975-NOTIFICATIONS-CATEGORY-LABELS-EXIST | Yes | Yes | Strict-grep C3 across all notification locales. |
| Constitution #9 no fabricated data | Yes | Yes | No location row, no title heuristics, icon fallback when avatar URL absent. |

## 10. Parity Check

- **Mobile:** Shared code implemented for iOS and Android; simulator/emulator verification pending tester.
- **Business app:** Not touched at runtime.
- **Admin:** Not touched at runtime.
- **Public/web:** Not touched.
- **Solo/collab:** Notification types for social/plans/chats/system all covered by fixtures/registry.
- **Gaps:** Physical iPhone pan-down feel and Android backdrop behavior need tester/operator live-fire.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Unchanged.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Comms ledger | Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`; acked applicable WARNs | Pass | COMMS-0002/0003/0004 acked as N/A for ORCH-0975. |
| Locale reference removal | `rg -n "notifications:filters" mingla-business app-mobile mingla-admin supabase` | Pass | No hits. |
| ORCH-0975 regression | `cd app-mobile && node src/components/__tests__/NotificationsSheet.test.tsx` | Pass | Fails-on-revert anchor `d2fca61b37c8e328e31340281b05fed59e1fd86b`; `git rm` pre-implementation simulation failed with `ENOENT`, restore from `HEAD` passed. |
| Strict-grep | `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` | Pass | C1/C2/C3 green across 29 locale files. |
| `useNotifications.ts` untouched | `git diff HEAD -- app-mobile/src/hooks/useNotifications.ts` | Pass | Empty diff. |
| EAS/native/package unchanged | `git diff HEAD -- app-mobile/package.json app-mobile/app.config.ts app-mobile/eas.json app-mobile/ios app-mobile/android` | Pass | Empty diff. |
| HomePage scope | `git diff HEAD -- app-mobile/src/components/HomePage.tsx` | Pass | Import path + JSX component name only. |
| Rename/blame signal | `git diff -M1 --name-status HEAD -- app-mobile/src/components/NotificationsModal.tsx app-mobile/src/components/NotificationsSheet.tsx` | Pass | Reports `R048`. |
| Full TypeScript | `cd app-mobile && npx tsc --noEmit` | Fail, existing repo issues | Includes pre-existing Deno test, BoardDiscussion, package path/type issues; no ORCH-0975 file hits after focused filter. |
| Focused TypeScript filter | `npx tsc --noEmit 2>&1 \| rg "NotificationsSheet|NotificationsModal|notificationsFixtures|HomePage" || true` | Pass | No ORCH-0975-related TypeScript errors. |
| Requested npm workspace Jest command | `npm test --workspace app-mobile -- NotificationsSheet` | Blocked | No root `package.json` / no npm workspace. |
| App-mobile npm test | `cd app-mobile && npm test -- NotificationsSheet` | Blocked | `app-mobile/package.json` has no `test` script. Existing app-mobile regression pattern is Node source assertions. |

## 13. Regression Surface

1. Notification open/close behavior: bottom-sheet gestures must be verified on iOS and Android.
2. Notification action buttons: accept/decline behavior reused but needs tester click-through.
3. Long translated copy: locale values are English fallbacks in all languages; tester should inspect overflow on narrow devices.
4. Avatar fallback: broken URL path should be visually checked for collab invite initials fallback.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| No location chain in v1 | Screenshot row is aspirational until writers expose structured place fields | ORCH-0976+ harmonizes notification payloads | `NotificationsSheet.tsx` body-row comment |
| No universal real avatars | 24/25 types show Ionicon fallback by design | ORCH-0976+ adds actor avatar data or lookup | Avatar block comment |
| App-mobile lacks Jest harness | Cannot run the exact requested Jest command without package/tooling changes that would violate OTA/package constraints | Separate tooling ORCH, if desired | Report verification table |
| Full `tsc --noEmit` fails repo-wide | Existing unrelated TS failures block full green gate | Separate cleanup ORCHs | Verification table |

## 15. Discoveries For Orchestrator

- App-mobile still has no standard `npm test` script/Jest harness, while several newer specs refer to Jest-style tests. Recommend a tooling decision: either codify Node source assertions as the app-mobile regression standard or register a dedicated test-harness ORCH.
- No new COMMS entry written; this affects process/tooling generally but does not block another known in-flight ORCH directly.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** Pure JS/content change; EAS OTA publish required at CLOSE after tester pass.
- **Business/admin web:** None.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
feat(app-mobile): redesign consumer notifications sheet

Resolves: ORCH-0975
Evidence: node src/components/__tests__/NotificationsSheet.test.tsx; node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs
Deploy: EAS OTA after review/test close; no Vercel deploy
```

## Ready-To-Test Checklist

1. Open the consumer app on iOS, tap the home bell, and confirm the bottom sheet opens with title, new-count pill, subtitle, action pill, and grouped cards.
2. Drag down on the handle and list-at-top; confirm the sheet closes smoothly while the x button also closes it.
3. Tap backdrop; confirm it closes.
4. Use fixture/live notifications covering social, plans, chats, and system; confirm pills, unread dots, icon/photo fallback, and body lines render without fabricated location rows.
5. Repeat on Android emulator and then on a physical iPhone for pan-down feel.
