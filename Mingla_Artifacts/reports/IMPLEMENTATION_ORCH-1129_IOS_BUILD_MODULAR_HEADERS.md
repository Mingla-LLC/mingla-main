# IMPLEMENTATION — ORCH-1129 · mingla-business iOS build: Google-pods modular headers

**Date:** 2026-06-12 · **Skill:** mingla-implementor (Claude) · **Class:** build-config only
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1129-[ios-build-modular-headers]` · branch `ORCH-1129-ios-build-modular-headers`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1129_IOS_BUILD_MODULAR_HEADERS.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1129_IOS_BUILD_MODULAR_HEADERS.md`
**Comms:** acked COMMS-0030 (WARN, to ALL) — this ORCH IS the fix for that team-wide iOS build break. Not resolved here (resolves on CLOSE after the GREEN cloud build).
**Status:** implemented and locally verified (SC-1/SC-2/SC-3/SC-5). **SC-4 (GREEN cloud iOS build) is the orchestrator/tester's gate — NOT provable locally.**

---

## 1. Summary

mingla-business iOS EAS builds have failed at the **Install pods** phase since ~2026-05-30 (COMMS-0030): the Google Sign-In pod chain pulls in the Swift pod `AppCheckCore`, which imports `GoogleUtilities` and `RecaptchaInterop` — ObjC pods with no module maps — and under static-libraries + New-Architecture CocoaPods refuses to integrate the Swift pod and aborts `pod install`.

The fix is a single targeted Expo config plugin (`withGooglePodsModularHeaders.js`) that injects `pod '<name>', :modular_headers => true` for exactly those three pods into the CNG-generated `Podfile`, immediately above `use_expo_modules!` (before pod resolution). It is registered in `app.config.ts` alongside the sibling `withIosFmtConsteval` plugin, and locked in by a strict-grep + behavior regression gate. No global `use_modular_headers!`, no `expo-build-properties`/`useFrameworks` change. Compile-time header-import change only — zero runtime/binary behavior change.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1 | Plugin exists, exports a function, and is registered in `app.config.ts` plugins array | ✓ PASS | `withGooglePodsModularHeaders.js` (`module.exports = withGooglePodsModularHeaders`); `app.config.ts` line carries `"./plugins/withGooglePodsModularHeaders"`. Gate T-1/T-2. Commit `0350212822da0e55de5d9b13cb3d8a19601c95f9` |
| SC-2 | `npx expo prebuild -p ios --no-install` yields a Podfile with all 3 `:modular_headers => true` lines INSIDE the target, ABOVE `use_expo_modules!` | ✓ PASS (local prebuild) | Podfile excerpt §6 (lines 23–30). Commit `0350212822da0e55de5d9b13cb3d8a19601c95f9` |
| SC-3 | Idempotent — re-running prebuild does not duplicate the block | ✓ PASS | Prebuild run TWICE; marker count = 1, GoogleUtilities directive count = 1. §6. Commit `0350212822da0e55de5d9b13cb3d8a19601c95f9` |
| SC-4 | **GREEN EAS iOS `development` cloud build clears Install pods** | ⏳ NOT PROVABLE LOCALLY — orchestrator/tester gate (T-6) | Local prebuild cannot reproduce the cloud-only `pod install` failure (INVESTIGATE F-4). Hand to tester/Seth: `eas build -p ios --profile development`. |
| SC-5 | No regression elsewhere — only the 2 files + test; no app-source/DB/edge changes | ✓ PASS | `git diff --stat` = `app.config.ts` (6 insertions) + 2 new files + the test. §3. Commit `0350212822da0e55de5d9b13cb3d8a19601c95f9` |

---

## 3. Files changed

| File | Change | Lines |
|------|--------|-------|
| `mingla-business/plugins/withGooglePodsModularHeaders.js` | **NEW** — the config plugin | +93 |
| `mingla-business/app.config.ts` | registration line + grouped comment after `"./plugins/withIosFmtConsteval"` | +6 |
| `mingla-business/src/__tests__/iosGooglePodsModularHeaders.gate.test.ts` | **NEW** — strict-grep + behavior regression gate (T-1..T-5b) | +183 |
| `Mingla_Artifacts/specs/SPEC_ORCH-1129_*.md`, `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1129_*.md` | forensics docs, committed on-branch (untracked in worktree) | (docs) |

`git diff --stat` (code) shows only `app.config.ts | 6 ++++++` modified; the plugin + test are new. No app source, DB, RLS, migration, edge fn, `package.json`/lockfile, or `eas.json` touched.

---

## 4. Data-model changes applied

None. Build-config only — no tables, columns, constraints, indexes, or RLS.

## 5. Edge functions touched

None. No `verify_jwt` to preserve.

---

## 6. Local prebuild proof (SC-2 + SC-3)

`cd mingla-business && rm -rf ios && npx expo prebuild -p ios --no-install` → `✔ Finished prebuild`. Generated `ios/Podfile`, lines 23–32:

```
23: target 'Business' do
24:   # ORCH-1129 modular headers: GoogleSignIn 9.x → AppCheckCore (Swift) needs module maps for
25:   # these non-modular deps under static libraries. Injected by
26:   # plugins/withGooglePodsModularHeaders.js.
27:   pod 'GoogleUtilities', :modular_headers => true
28:   pod 'RecaptchaInterop', :modular_headers => true
29:   pod 'AppCheckCore', :modular_headers => true
30:   use_expo_modules!
31:
32:   if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] == '1'
```

All 3 directives land **inside `target 'Business' do`**, **immediately ABOVE `use_expo_modules!`** (primary anchor) — exactly as SC-2 requires. OQ-1 (anchor confirmation) resolved: the SDK 54 Podfile contains `use_expo_modules!` inside the app target; primary anchor used.

**Idempotency (SC-3):** prebuild run a SECOND time → `ORCH-1129 modular headers` marker count = **1**; `pod 'GoogleUtilities', :modular_headers => true` count = **1**. No duplication (marker guard works). Generated `ios/` removed afterward (gitignored — `git check-ignore ios` = `ios`); NOT committed.

---

## 7. Regression test (fails-on-revert)

**Path:** `mingla-business/src/__tests__/iosGooglePodsModularHeaders.gate.test.ts` — marked `[TEST-MOD-APPROVED ORCH-1129]` (append-only; new file).

6 tests, all PASS:
- **T-1** — `app.config.ts` registers `"./plugins/withGooglePodsModularHeaders"` (strict-grep).
- **T-2** — plugin source carries `:modular_headers => true` + the template line + all 3 pod names.
- **T-3** — drives the REAL exported plugin (via a mocked `withDangerousMod` capturing the inner callback) against a CNG-shaped fixture Podfile → all 3 pods injected ABOVE `use_expo_modules!`, inside the target.
- **T-4** — idempotent: applying twice → marker + GoogleUtilities directive appear exactly once.
- **T-5** — fail-soft: no anchor → Podfile returned unchanged, no throw.
- **T-5b** — missing Podfile → no throw, returns cfg.

```
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

**Fails-on-revert proof (true line deletion, NOT comment-out):**
- Deleted the `"./plugins/withGooglePodsModularHeaders"` registration line from `app.config.ts` AND the `MODULAR_PODS.map(...)` directive-build line from the plugin → re-ran gate → **4 of 6 tests FAILED** (T-1 registration, T-2 directive, T-3 + T-4 behavior). Restored both files from backup → **6/6 PASS** again.
- `fails-on-revert verified at 34862397bf623be628e27dde11e8cf79ef12070c` (HEAD at the time of the deletion/restore cycle; the fix commit is `0350212822da0e55de5d9b13cb3d8a19601c95f9`).

---

## 8. Old → New receipts

### mingla-business/plugins/withGooglePodsModularHeaders.js (NEW)
**Before:** did not exist. Fresh iOS pod installs aborted on the AppCheckCore Swift-pod / non-modular-deps conflict.
**Now:** an idempotent, fail-soft `withDangerousMod` config plugin injects `:modular_headers => true` for `GoogleUtilities`, `RecaptchaInterop`, `AppCheckCore` above `use_expo_modules!` on every prebuild/cloud build, so CocoaPods generates the module maps it needs.
**Why:** SC-1/SC-2/SC-3; fixes COMMS-0030 team-wide iOS build break.
**Lines:** +93.

### mingla-business/app.config.ts
**Before:** plugins array ended at `"./plugins/withIosFmtConsteval"`; the new plugin never ran during prebuild.
**Now:** `"./plugins/withGooglePodsModularHeaders"` registered immediately after `withIosFmtConsteval`, grouping all iOS Podfile-affecting plugins, with a comment explaining the COMMS-0030 break.
**Why:** SC-1 (plugin must be registered to run).
**Lines:** +6.

### mingla-business/src/__tests__/iosGooglePodsModularHeaders.gate.test.ts (NEW)
**Before:** no gate; a future build-config edit could silently drop the plugin and re-break all iOS builds.
**Now:** strict-grep + real-behavior regression gate locks the plugin file, the 3 directives, and the registration; fails on revert.
**Why:** §9 + proposed invariant `I-PROPOSED-IOS-GOOGLE-PODS-MODULAR-HEADERS`.
**Lines:** +183.

---

## 9. Cross-surface impact table

| # | Surface | Affected | Reason / parity |
|---|---------|----------|-----------------|
| 1 | Consumer iOS (`app-mobile/`) | NO | Different app, out of dispatch scope. Will hit the SAME break → DISC-1129-A (parallel fix, manual parity). |
| 2 | Consumer Android | NO | No CocoaPods. |
| 3 | Buyer/anon Web | NO | Web export has no pods phase. |
| 4 | **Business iOS** | **YES** | iOS EAS builds (dev/preview/production) clear Install pods. Automatic parity — single CNG Podfile path for all iOS profiles. |
| 5 | Business Android | NO | Gradle, not CocoaPods. |
| 6 | Admin Web | NO | Not RN/iOS. |
| 7 | Business Web preview | NO | Web export, no pods. |

---

## 10. Gate output

- **Jest gate:** 6/6 PASS (above).
- **Typecheck (`npx tsc --noEmit`):** ZERO errors in ORCH-1129 files (`app.config.ts`, the test, the plugin). The 30 `packages/phone-input/*` errors are PRE-EXISTING on origin/main (confirmed by checking out origin/main and re-running → same 30) and out of scope — NOT introduced here.
- **ESLint** (plugin + test + app.config.ts): 0 errors, 0 warnings.
- **`git diff --stat`:** `app.config.ts | 6 ++++++` only; 2 new files + test untracked-then-added.

---

## 11. Known issues / deferred

- No `[TRANSITIONAL]` markers introduced.
- **SC-4 cloud gate is unmet by design** — local prebuild succeeds even on the broken state (the failure is cloud/static-library-only), so only a real `eas build -p ios --profile development` clearing Install pods proves the fix. Owned by tester/Seth.

---

## 12. Operator action required

- **No migration.** No `db push`.
- **No edge-function deploy.**
- **Cloud build gate (SC-4 / T-6):** run from MERGED main (or this branch for pre-merge proof):
  ```bash
  cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1129-[ios-build-modular-headers]/mingla-business" && eas build -p ios --profile development
  ```
  Success = the build log no longer contains `cannot yet be integrated as static libraries` / `pod install exited with non-zero code: 1`, and reaches the compile/archive phase. (OQ-2: `development` profile recommended — cheapest + what ORCH-1119 needs next.)
- **On CLOSE:** merge to main (unblocks team-wide iOS builds + ORCH-1119's device build), resolve COMMS-0030, flip `I-PROPOSED-IOS-GOOGLE-PODS-MODULAR-HEADERS` ACTIVE.

---

## 13. Discoveries for orchestrator

- **DISC-1129-A (already flagged in spec):** `app-mobile/` (consumer) uses google-signin too and will hit the identical break on its next fresh iOS build. Out of this ORCH; register the parallel fix (same plugin pattern under `app-mobile/plugins/`).
- **Pre-existing (out of scope):** `packages/phone-input/*` has 30 TS errors (`implicitly any`, `Cannot find module 'react'`) under the mingla-business tsconfig on origin/main. Not introduced here; flag for a separate cleanup ORCH if the business tsconfig is meant to type-check that package.
- **COMMS-0030 acked** (WARN, to ALL / this ORCH): this implementation IS the fix; left OPEN — resolves on CLOSE after the GREEN cloud build.
