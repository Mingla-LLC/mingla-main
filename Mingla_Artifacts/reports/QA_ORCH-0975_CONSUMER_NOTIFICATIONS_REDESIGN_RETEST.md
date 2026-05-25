# QA Retest — ORCH-0975 [Consumer notifications redesign]

**Tester:** Codex `tester-mingla` parity mirror  
**Date:** 2026-05-25  
**Mode:** RETEST  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0975-[consumer-notifications-redesign]/`  
**Branch:** `ORCH-0975-consumer-notifications-redesign`  
**Rework commit under test:** `a97ace856 fix(app-mobile): route board card messages to chats`  
**Prior QA:** `Mingla_Artifacts/reports/QA_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`  
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`

## Verdict

**CONDITIONAL PASS.**

F-1 is fixed and the three local gates pass. The earlier iOS pan-down FAIL call was too strict: the Maestro `assertNotVisible: "Notifications"` selector also matches the persistent top-bar notification bell after the sheet closes, so it is not a valid sheet-closed assertion. Seth also manually verified on iOS that pan-down closes the sheet. Android remains unverified because the local emulator hit a System UI ANR, so this should not route back to implementor unless Android reproduces a real sheet defect on a healthy emulator/device.

| ID | Severity | Finding | Evidence | Required rework |
|---|---:|---|---|---|
| F-2 | P2 | Android runtime gate is still unverified because the emulator hit a System UI ANR during consumer app launch. | Pixel_8_Pro `emulator-5554` booted; `com.mingla.app.v2` was installed; launch via `exp+mingla://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8098` reached bundling but showed `System UI isn't responding`. Screenshots: `android-system-ui-anr-on-launch.png`, `android-system-ui-anr-after-wait.png`. | Re-run on a healthy emulator/device before CLOSE, or have orchestrator explicitly accept this as an environment-only manual gate. |
| F-3 | P4 | Original iOS pan-down automation used an ambiguous selector. | `Notifications` is both the sheet header and the persistent top-bar bell accessibility label in `GlassTopBar.tsx`, so `assertNotVisible: "Notifications"` is invalid after close. Seth manually verified iOS pan-down closes the sheet. | Future runtime automation should assert sheet-only text such as `Stay caught up`, or use a sheet-specific testID/accessibility label. |

Severity counts: **P0: 0 / P1: 0 / P2: 1 / P3: 0 / P4: 1**.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before tester work. Acked COMMS-0002 (N/A no backend touch), COMMS-0003 (N/A no external API touch), and COMMS-0004 (N/A no intake) in the anchor ledger.

## Scope Retested

| Gate | Result | Evidence |
|---|---|---|
| F-1 board-card message category | PASS | `NotificationsSheet.tsx:51-75` checks `type === 'board_card_message'` before the generic `board_card_*` sessions branch, so row 18 maps to `messages`. |
| Strict-grep | PASS | `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` passed C1/C2/C3. |
| Implementor regression | PASS | `cd app-mobile && node src/components/__tests__/NotificationsSheet.test.tsx` passed. |
| Tester adversarial regression | PASS | `cd app-mobile && node src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx` passed. |
| Whitespace diff | PASS | `git diff --check` exited 0. |
| Rework commit forbidden-surface guard | PASS | `git diff a97ace856^ a97ace856 -- app-mobile/src/hooks/useNotifications.ts app-mobile/package.json app-mobile/package-lock.json app-mobile/yarn.lock app-mobile/pnpm-lock.yaml app-mobile/app.config.ts app-mobile/eas.json app-mobile/ios app-mobile/android .github/workflows .github/scripts/strict-grep \| wc -l` returned `0`. |
| Branch forbidden package/native/hook guard | PASS | `git diff main...HEAD -- app-mobile/src/hooks/useNotifications.ts app-mobile/package.json app-mobile/package-lock.json app-mobile/yarn.lock app-mobile/pnpm-lock.yaml app-mobile/app.config.ts app-mobile/eas.json app-mobile/ios app-mobile/android \| wc -l` returned `0`. |
| Registry rows untouched by rework | PASS | `git diff a97ace856^ a97ace856 -- .github/workflows .github/scripts/strict-grep \| wc -l` returned `0`; the ORCH-0975 registry addition remains from the original implementation, not the F-1 rework. |
| PR state untouched | PASS | `gh pr view ORCH-0975-consumer-notifications-redesign ...` returned `no pull requests found for branch "ORCH-0975-consumer-notifications-redesign"`. |
| iOS simulator runtime | PASS WITH NOTE | Sheet opened on iPhone 17 Pro simulator; post-pan failure was due an ambiguous `Notifications` selector that also matches the top-bar bell. Screenshot after pan shows sheet header/content gone. |
| Android emulator runtime | UNVERIFIED | Consumer app installed, emulator System UI ANR blocked app interaction; see F-2. |
| Physical iPhone parity | PASS BY OPERATOR ATTESTATION | Seth reported on 2026-05-25 that pan-down closes the sheet on iOS. |

## Command Evidence

| Command | Result |
|---|---|
| `git log --oneline -8 --decorate` | HEAD is `a97ace856` on `ORCH-0975-consumer-notifications-redesign`. |
| `git diff --name-status a97ace856^ a97ace856` | Rework commit touched only implementation report, `NotificationsSheet.tsx`, and tester adversarial test. |
| `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` | PASS. |
| `cd app-mobile && node src/components/__tests__/NotificationsSheet.test.tsx` | PASS. |
| `cd app-mobile && node src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx` | PASS. |
| `git diff --check` | PASS. |
| `adb install -r /Users/sethogieva/Desktop/mingla-main/app-mobile/android/app/build/outputs/apk/debug/app-debug.apk` | Existing consumer package present after emulator restart: `package:com.mingla.app.v2`. |
| `xcrun devicectl list devices` | `No devices found.` |

## iOS Simulator Detail

Device: iPhone 17 Pro, iOS 26.4, UDID `17091E60-C3B6-4167-980D-60C348E177F6`.

Metro was started from this ORCH worktree on port `8098` with `npx expo start --dev-client --port 8098 --localhost --clear`; the installed consumer app was opened via `exp+mingla://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8098`.

The sheet can open: Maestro flow `orch0975-ios-launch-notifications` completed `Launch app`, `tapOn point 91%,10%`, and `assertVisible "Notifications"`. The later `assertNotVisible "Notifications"` failure is not reliable because `GlassTopBar.tsx` gives the home-screen bell the same accessibility label. A stronger flow with `stopApp`, fresh `launchApp`, `tapOn point 91%,10%`, `assertVisible "Notifications"`, and `swipe 50%,14% -> 50%,96%` produced the same selector failure, but the screenshot after pan shows the sheet header/content removed.

Seth manually verified that pan-down closes the sheet on iOS. Treat iOS pan-down as PASS with a note that future automation needs a sheet-only selector.

## Android Emulator Detail

Device: Pixel_8_Pro AVD, `emulator-5554`.

The emulator initially had only `com.sethogieva.minglabusiness`; tester installed the consumer dev build from the existing anchor APK and verified `package:com.mingla.app.v2`. After emulator restart, the package remained installed. Launch via the ORCH-0975 Metro URL reached `LaunchState: COLD` / `Activity: com.mingla.app.v2/.MainActivity`, but the emulator entered a System UI ANR while bundling. No sheet-open or pan-down evidence is valid from Android.

## Hard Guards

Preserved:

- `app-mobile/src/hooks/useNotifications.ts` stayed untouched.
- `app-mobile/package.json`, lockfiles, app config, EAS config, and native `ios`/`android` surfaces stayed untouched.
- The F-1 rework commit did not mutate workflow registry rows or strict-grep files.
- No PR was opened or modified for this branch.

## Remaining Gate

No implementor rework is required from this retest. Before CLOSE, re-run or manually accept the Android gate on a healthy emulator/device:

1. Re-run:
   - `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs`
   - `cd app-mobile && node src/components/__tests__/NotificationsSheet.test.tsx`
   - `cd app-mobile && node src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx`
   - Android emulator open + pan-down close on a healthy emulator with `com.mingla.app.v2`
2. If Android is green, route to CLOSE.
3. If Android fails with a real sheet defect, route back to implementor with the Android evidence only.

## Routing

Route to Codex `orchestrator-mingla` for CLOSE only if Seth accepts the Android emulator gap as environment-only or after Android is re-run green on a healthy emulator. Do not route to implementor for the iOS pan-down finding.
