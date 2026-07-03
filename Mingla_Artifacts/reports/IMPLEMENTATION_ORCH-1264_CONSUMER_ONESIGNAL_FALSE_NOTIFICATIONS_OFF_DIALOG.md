# IMPLEMENTATION — ORCH-1264 [consumer false "notifications turned off / Open Settings" dialog]

## 1. Summary

Returning users of the CONSUMER app (`app-mobile/`) were seeing a false iOS native dialog
("notifications turned off — Open Settings") even though their notifications were ON. On-device
diagnostics (ORCH-1264 DIAG build) proved the trigger: `OneSignal.User.pushSubscription.optIn()`,
fired on every auth event inside `loginToOneSignal()`, ran against OneSignal's STALE cached
permission ("off") and popped OneSignal's native `fallbackToSettings` dialog. The DIAG build never
showed the popup because it called `OneSignal.Notifications.getPermissionAsync()` immediately before
`optIn()` — that read refreshes OneSignal's permission cache to the true OS value, so `optIn()` sees
"on" and never falls back.

The fix ports exactly that one read into production: immediately before `optIn()`, call
`getPermissionAsync()` (a pure read, no prompt), self-guarded so a read failure never disrupts login
or skips `optIn()`. `optIn()` still runs (subscription still registers; the legit iOS prompt still
appears for not-determined users) and the ORCH-1243 `syncPushPermissionTag()` still runs after
`optIn()`. All diagnostic scaffolding was stripped; `app/index.tsx` is byte-identical to `origin/main`.

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-1 | Add `getPermissionAsync()` immediately before `optIn()` in `loginToOneSignal`, self-guarded (never throws) | ✓ | orch-1264 closing commit (PR head) |
| SC-2 | Keep `syncPushPermissionTag()` AFTER `optIn()` (ORCH-1243 preserved) | ✓ | orch-1264 closing commit (PR head) |
| SC-3 | Do NOT skip/gate `optIn()`; do NOT change `requestPermission(false)`, ATT ordering, or ORCH-1260 IAM pause | ✓ | orch-1264 closing commit (PR head) |
| SC-4 | Strip ALL diagnostic code (`__osDiag`, `osDiagPush`, calls, `[ORCH-1264-DIAG]` console lines) from `oneSignalService.ts` | ✓ | orch-1264 closing commit (PR head) |
| SC-5 | Strip diagnostic overlay from `app/index.tsx`; restore `export default Sentry.wrap(AppContent)`; diff vs `origin/main` EMPTY | ✓ | orch-1264 closing commit (PR head) |
| SC-6 | Zero matches for DIAG symbols across `app-mobile/` | ✓ | orch-1264 closing commit (PR head) |
| SC-7 | `git diff origin/main --stat -- app-mobile/` shows ONLY `oneSignalService.ts` + the new test | ✓ | orch-1264 closing commit (PR head) |
| SC-8 | Regression test asserts `getPermissionAsync()` before `optIn()`; real fails-on-revert | ✓ | orch-1264 closing commit (PR head) |

## 3. Files changed

- `app-mobile/src/services/oneSignalService.ts` — +15 lines (fix only; diag reverted to `origin/main` first).
- `app-mobile/src/services/__tests__/oneSignalService.orch1264.test.ts` — NEW (+~95 lines) regression test.
- `app-mobile/app/index.tsx` — reverted to `origin/main` (net zero diff; not in the closing diff).
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1264_...md` — this report.

## 4. Data-model changes applied

None. Pure client-side service ordering change.

## 5. Edge functions touched

None.

## 6. Regression tests added

- Path: `app-mobile/src/services/__tests__/oneSignalService.orch1264.test.ts`
- Style: repo-standard node:assert SOURCE-assertion with comment-stripping (app-mobile has no
  jest/RTL runner and `oneSignalService.ts` uses extensionless relative imports the Node test
  runner cannot resolve — same convention as `orch_1187_posthog_native_consumer.test.ts`). It
  isolates `loginToOneSignal`'s body (bounded to the next top-level function so the separate
  `syncPushPermissionTag` read cannot mask a revert) and asserts the order
  `login → getPermissionAsync → optIn → syncPushPermissionTag`.
- Run: `node app-mobile/src/services/__tests__/oneSignalService.orch1264.test.ts`
- **fails-on-revert verified** by TRUE LINE-DELETION of the pre-optIn `getPermissionAsync` block:
  PASS (exit 0) with fix → FAIL (exit 1, `AssertionError`: "loginToOneSignal must call
  OneSignal.Notifications.getPermissionAsync() ... before optIn") after deletion → PASS (exit 0)
  after restore, file byte-identical to the fixed version.

## 7. Old → New receipt

### app-mobile/src/services/oneSignalService.ts
- **What it did before:** `loginToOneSignal()` called `OneSignal.login()` then immediately
  `OneSignal.User.pushSubscription.optIn()`. `optIn()` could run against OneSignal's stale
  permission cache and pop the native "notifications turned off" dialog for a returning user whose
  iOS notifications were ON.
- **What it does now:** Between `login()` and `optIn()` it calls
  `OneSignal.Notifications.getPermissionAsync()` (pure read, no prompt) inside its own try/catch, so
  OneSignal's cache is reconciled to true OS permission before `optIn()` runs — the native fallback
  dialog can no longer fire on a stale/denied cache. `optIn()` and the post-`optIn`
  `syncPushPermissionTag()` are unchanged.
- **Why:** ORCH-1264 — proven on-device root cause (the DIAG overlay showed `optIn` fired without any
  preceding permission read; adding the read is exactly what suppressed the popup in the DIAG build).
- **Lines changed:** +15.

### app-mobile/app/index.tsx
- **What it did before (on the DIAG branch):** rendered a diagnostic overlay (`OsDiagOverlay` /
  `AppRootWithDiag`) and imported `__osDiag`.
- **What it does now:** reverted to `origin/main` — `export default Sentry.wrap(AppContent)`, no diag.
- **Why:** diagnostic scaffolding must not ship; the fix does not touch this file.
- **Lines changed:** 0 net vs `origin/main`.

## 8. Cross-surface impact

| Surface | Affected? | Notes |
|---------|-----------|-------|
| Consumer iOS | YES | Primary target — the false native dialog no longer fires on returning-user auth. Parity automatic (shared service). |
| Consumer Android | YES (benign) | `getPermissionAsync()` is a harmless read on Android; no dialog behavior change (Android has no iOS fallbackToSettings). Same shared code path. |
| Buyer/anon Web | NO | OneSignal service not on the anon web path. |
| Business iOS | NO | `mingla-business/` has its own OneSignal path; untouched. |
| Business Android | NO | Same. |
| Admin Web (adjacent) | NO | No OneSignal. |
| Business Web preview (adjacent) | NO | Untouched. |

Parity is automatic across consumer iOS/Android (single shared `oneSignalService.ts`). No manual
parity mirror required.

## 9. Smoke result

- Regression test: PASS with fix, FAIL on true line-deletion, PASS on restore (see §6).
- `tsc --noEmit` (app-mobile): ZERO errors referencing the two touched files (repo has a large
  pre-existing baseline unrelated to this change; the added `getPermissionAsync()` call mirrors the
  already-present, type-clean usage in `syncPushPermissionTag`).
- On-device runtime confirmation of the popup's disappearance is the tester's job on a physical iOS
  device with a returning account (consumer OTA is frozen — COMMS-0047 — so this ships in the next
  consumer native build, not via `eas update`). Labeled: implemented, statically verified; runtime
  popup-absence to be device-confirmed by the tester.

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code. Consumer OTA is frozen (COMMS-0047) — verification and shipping ride the
  next consumer native build, not an OTA.

## 11. Operator action required

- None for backend (no migration, no edge deploy).
- Route to REVIEW → tester. Tester writes the adversarial test and device-confirms the false dialog
  is gone on a returning iOS account.

## 12. Discoveries for Orchestrator

- None. Scope was exactly the two-file clean-up + one-line-class fix.
