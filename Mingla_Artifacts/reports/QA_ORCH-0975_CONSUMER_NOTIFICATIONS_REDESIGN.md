# QA — ORCH-0975 [Consumer notifications sheet redesign]

**Tester:** Codex `tester-mingla` parity mirror  
**Date:** 2026-05-25  
**Mode:** TARGETED  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0975-[consumer-notifications-redesign]/`  
**Branch:** `ORCH-0975-consumer-notifications-redesign`  
**Base implementation hash:** `4f220a10903173fa7ad9713a97ed3cb304de71b5` (origin) / local review-pass `b53f2cd9f` on top  

## Verdict

**FAIL.**

Release is blocked by one implementation mismatch against the authoritative addendum matrix:

| ID | Severity | Finding | Evidence | Required rework |
|---|---:|---|---|---|
| F-1 | P1 | `board_card_message` renders under the Plans/Sessions bucket instead of Chats. The addendum row 18 explicitly maps `board_card_message` to **Chats**, but `getFilterCategory()` returns `sessions` for every `board_card_*` type before the messages branch can run. | Addendum row 18: `Mingla_Artifacts/specs/SPEC_ORCH-0975_ADDENDUM_PER_TYPE_MATRIX.md:122`. Current helper: `app-mobile/src/components/NotificationsSheet.tsx:51-72`. Tester adversarial test fails at `app-mobile/src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx:109-114`. | Change `getFilterCategory()` so `board_card_message` maps to `messages` while `board_card_saved/voted/rsvp` remain `sessions`; rerun implementor + tester tests and visual QA. |

Severity counts: **P0: 0 / P1: 1 / P2: 3 / P3: 0 / P4: 2**.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before tester work. Acked COMMS-0002 (N/A no backend touch), COMMS-0003 (N/A no external API touch), and COMMS-0004 (N/A no intake) in the anchor ledger.

## Inputs Read In Required Order

1. `Mingla_Artifacts/reports/REVIEW_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`
2. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`
3. `Mingla_Artifacts/specs/SPEC_ORCH-0975_ADDENDUM_PER_TYPE_MATRIX.md`
4. `Mingla_Artifacts/specs/SPEC_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`
5. `Mingla_Artifacts/design/DESIGN_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`

## Test Manifest

| Layer | Files / surfaces inspected |
|---|---|
| Component | `app-mobile/src/components/NotificationsSheet.tsx`, `app-mobile/src/components/HomePage.tsx` |
| Hook/cache guard | `app-mobile/src/hooks/useNotifications.ts` bit-identical check |
| Fixtures/tests | `NotificationsSheet.test.tsx`, `NotificationsSheet.tester-adversarial.test.tsx`, `__fixtures__/notificationsFixtures.ts` |
| Tokens/locales | `app-mobile/src/constants/designSystem.ts`, 29 `app-mobile/src/i18n/locales/*/notifications.json` files |
| CI | `.github/scripts/strict-grep/orch-0975-notifications-sheet.mjs`, `.github/workflows/strict-grep-mingla-business.yml` |
| Runtime parity | iPhone 17 Pro simulator, iPhone 17 Pro Max simulator fallback, Android Pixel_8_Pro emulator, physical iPhone operator attestation requirement |

## Claim Verification

| Implementor claim | Result | Evidence |
|---|---|---|
| Uses `@gorhom/bottom-sheet`, no RN `Modal` | PASS | Strict-grep C1 passed; source imports `BottomSheet`, `BottomSheetSectionList`. |
| Filter chips removed | PASS | Strict-grep C2 passed across 29 locale files; no notification filter chip render path found. |
| Category labels exist across locales | PASS | Strict-grep C3 passed across 29 locale files. |
| `useNotifications.ts` untouched | PASS | `git diff main -- app-mobile/src/hooks/useNotifications.ts ... | wc -l` returned `0`. |
| Native/package config untouched | PASS | Same diff command over package/native config returned `0`. |
| Implementor regression passes | PASS | `cd app-mobile && node src/components/__tests__/NotificationsSheet.test.tsx` exited 0. |
| Tester adversarial coverage | FAIL | New tester test exits 1 on current code due F-1. |
| Visual parity complete | UNVERIFIED | iOS/Android/physical live-fire did not complete; see parity matrix. |

## Command Evidence

| Command | Result |
|---|---|
| `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` | PASS |
| `cd app-mobile && node src/components/__tests__/NotificationsSheet.test.tsx` | PASS |
| `cd app-mobile && node src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx` | FAIL: `board_card_message` must resolve to Chats/messages |
| `git diff main -- app-mobile/src/hooks/useNotifications.ts app-mobile/package.json app-mobile/app.config.ts app-mobile/eas.json app-mobile/ios app-mobile/android \| wc -l` | `0` |
| `cd app-mobile && npx tsc --noEmit 2>&1 \| rg "NotificationsSheet\|NotificationsModal\|notificationsFixtures\|HomePage" || true` | PASS: no ORCH-0975 file hits |
| `git diff --check` | PASS |

## Tester Adversarial Test

Added `app-mobile/src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx`.

Attack angle: **SC-28 Constitution #9 + 25-type matrix adversarial coverage**, not the implementor happy path. It extends coverage for the remaining 17 notification types, asserts all 25 active types have type-matched icon fallback, asserts no fabricated avatar/location/name paths, and enforces addendum row 18 (`board_card_message` = Chats).

Current result: **FAIL** on F-1.  
Fails-on-revert anchor: `d2fca61b37c8e328e31340281b05fed59e1fd86b`.  
Revert-simulation evidence: temporarily removed `app-mobile/src/components/NotificationsSheet.tsx` to simulate reverting the implementation file introduced by `d2fca61b3`; `cd app-mobile && node src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx` exited `1` with `ENOENT`, then the file was restored and `git status` showed no product-file drift. Because the test already fails on current implementation, CLOSE cannot accept this as a green regression gate until F-1 is fixed and the test passes on current code.

## Success Criteria Map

| SC | Result | Evidence |
|---|---|---|
| SC-01 | PARTIAL | Bottom-sheet source/static gate passes; runtime open not completed. |
| SC-02 | PARTIAL | Handle styles present; runtime grab-target not verified. |
| SC-03 | UNVERIFIED | Pan-down handle gesture requires runtime/physical live-fire. |
| SC-04 | PARTIAL | `BottomSheetSectionList` present; content-at-top gesture not runtime-verified. |
| SC-05 | PARTIAL | `BottomSheetBackdrop pressBehavior="close"` present; tap not runtime-verified. |
| SC-06 | PARTIAL | Close button source present; tap not runtime-verified. |
| SC-07 | PASS | No filter chip state/render path; strict-grep C2 green. |
| SC-08 | PASS | Header title/subtitle/new-count source and locales present. |
| SC-09 | PASS | `unreadCount > 0` gates new-count pill. |
| SC-10 | PASS | Combined action pill source present. |
| SC-11 | PASS | `showMarkAllRead`, `showClearAll`, `showActionRow` guard zero/empty states. |
| SC-12 | PASS | Grouping consumes full `notifications` list; no category filtering. |
| SC-13 | FAIL | Board-card message category pill will render Plans instead of Chats. Other card chrome source checks pass. |
| SC-14 | PASS | Five actionable types present in `ACTIONABLE_TYPES`. |
| SC-15 | PASS | Existing actionable/non-actionable press behavior preserved in source. |
| SC-16 | PASS | Empty state source present. |
| SC-17 | PASS | Skeleton card source present. |
| SC-18 | PASS | Error state + Try Again source present. |
| SC-19 | PASS | Offline banner source present. |
| SC-20 | UNVERIFIED | iOS visual runtime blocked before sheet could be opened. |
| SC-21 | UNVERIFIED | Android runtime blocked: emulator available, consumer Mingla app not installed. |
| SC-22 | FAIL | `getFilterCategory()` does not return the addendum-correct category for every active type. |
| SC-23 | PASS | 29 notification locale files have no `filters` and include `categoryLabels`. |
| SC-24 | PASS | `useNotifications.ts` bit-identical vs main. |
| SC-25 | PASS | HomePage changed to `NotificationsSheet`; no hook/config changes. |
| SC-26 | PASS | Strict-grep gate passes on branch. |
| SC-27 | PASS WITH NOTE | Implementor test passes; its console string still cites stale `818b5f8b746e` as noted by REVIEW O-6. |
| SC-28 | FAIL | Tester adversarial test exists and fails current implementation on F-1. |
| SC-29 | PASS | Action error state retained in source. |
| SC-30 | PASS | No location row, no inferred names, no actor lookup, zero-unread controls hidden in source. |
| SC-31 | PASS SOURCE / UNVERIFIED RUNTIME | Touch targets/hitSlop present in source; runtime a11y sizing not verified. |
| SC-32 | PASS SOURCE / UNVERIFIED RUNTIME | Accessibility labels present in source; screen-reader pass not run. |
| SC-33 | PASS | Rename/blame path accepted by REVIEW; `NotificationsSheet.tsx` exists with shim. |
| SC-34 | PASS | `NotificationsModal` re-export and props alias present. |
| SC-35 | PASS | EAS OTA-eligible diff guard returned 0. |
| SC-36 | FAIL | Tester 25-type matrix uncovered row 18 category mismatch. |
| SC-37 | PASS | Bold split limited to explicit data fields; no username/title parsing. |
| SC-38 | PASS | No location-chain helper/row in source; body-only deferral comment present. |

## Constitution Map

| # | Principle | Result | Evidence |
|---|---|---|---|
| 1 | No dead taps | PARTIAL | Handlers wired in source; runtime taps unverified. |
| 2 | One owner per truth | PASS | Hook/server state untouched. |
| 3 | No silent failures | PASS | `actionErrors` inline error path retained. |
| 4 | One query key per entity | PASS | `useNotifications.ts` untouched. |
| 5 | Server state server-side | PASS | No Zustand/AsyncStorage notification storage added. |
| 6 | Logout clears everything | PASS | No new persisted state. |
| 7 | Label temporary | PASS | No transitional hack found; v1 deferrals documented. |
| 8 | Subtract before adding | PASS | Filters/RN Modal removed structurally. |
| 9 | No fabricated data | PASS for data honesty; FAIL adjacent visual mapping | No fabricated names/locations; F-1 is category truth mismatch for one type. |
| 10 | Currency-aware | N/A | No currency. |
| 11 | One auth instance | N/A | No auth change. |
| 12 | Validate at right time | N/A | No validation flow. |
| 13 | Exclusion consistency | N/A | No generation/serving rule. |
| 14 | Persisted-state startup | PASS | No persisted-state changes. |

## Parity / Live-Fire Matrix

| Surface | Requirement | Result | Evidence |
|---|---|---|---|
| iOS Simulator: iPhone 17 Pro | Mandatory | BLOCKED | Device `17091E60-C3B6-4167-980D-60C348E177F6` booted with Mingla installed, but system Apple Account Verification alert blocked app interaction. Screenshot: `Mingla_Artifacts/reports/qa-orch-0975-screenshots/ios17pro-blocked-apple-account-alert.png`. |
| iOS Simulator fallback: iPhone 17 Pro Max | Additional evidence | PARTIAL | Metro on `8093` served current JS bundle; app loaded, but session landed in "Trouble signing in" and Maestro `tapOn "Notifications"` timed out before opening the sheet. Screenshots: `ios17promax-live-app-session-error.png`, `ios17promax-maestro-notifications-timeout.png`. |
| Android Emulator: Pixel_8_Pro | Mandatory | BLOCKED | Emulator booted as `sdk_gphone64_arm64`, but only `com.sethogieva.minglabusiness` was installed; consumer app `com.mingla.app.v2` was absent. No Android sheet runtime possible without installing a consumer dev build. |
| Physical iPhone | Mandatory | NOT RUN | Operator attestation was not collected because the branch already has a P1 static/spec failure and simulator parity did not reach the sheet. Re-run after F-1 fix. |

## Visual QA Matrix: 25 Types

| Type | Expected bucket/archetype | Result |
|---|---|---|
| `friend_request_received` | Social / A | PASS source |
| `friend_request_accepted` | Social / A | PASS source |
| `pair_request_received` | Social / A | PASS source |
| `pair_request_accepted` | Social / A | PASS source |
| `paired_user_saved_card` | Social / A | PASS source |
| `paired_user_visited` | Social / A | PASS source |
| `collaboration_invite_received` | Plans / B | PASS source |
| `collaboration_invite_accepted` | Plans / A | PASS source |
| `collaboration_invite_declined` | Plans / A | PASS source |
| `session_member_joined` | Plans / A | PASS source |
| `session_member_left` | Plans / A | PASS source |
| `board_card_saved` | Plans / A | PASS source |
| `board_card_voted` | Plans / A | PASS source |
| `board_card_rsvp` | Plans / A | PASS source |
| `direct_message_received` | Chats / A | PASS source |
| `board_message_received` | Chats / A | PASS source |
| `board_message_mention` | Chats / A | PASS source |
| `board_card_message` | Chats / A | **FAIL — renders Plans/Sessions by helper order** |
| `calendar_reminder_tomorrow` | System / C | PASS source |
| `calendar_reminder_today` | System / C | PASS source |
| `visit_feedback_prompt` | System / C | PASS source |
| `holiday_reminder` | System / C | PASS source |
| `trial_ending` | System / C | PASS source |
| `referral_credited` | System / C | PASS source |
| `weekly_digest` | System / C | PASS source |

## CLOSE Routing

Do **not** route to CLOSE yet. Route to implementor for one bounded rework:

1. Fix `getFilterCategory()` so `board_card_message` maps to `messages` before the `board_card_*` sessions branch.
2. Re-run:
   - `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs`
   - `cd app-mobile && node src/components/__tests__/NotificationsSheet.test.tsx`
   - `cd app-mobile && node src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx`
3. Re-run parity on iOS simulator, Android emulator with consumer app installed, and physical iPhone pan-down operator attestation.

Expected retest artifact: update this QA report or create `QA_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN_RETEST.md` after rework.
