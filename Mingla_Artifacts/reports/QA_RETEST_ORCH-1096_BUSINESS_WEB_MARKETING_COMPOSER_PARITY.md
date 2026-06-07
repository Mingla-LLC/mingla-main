# QA Retest Report: ORCH-1096 Business Web Marketing Composer Parity

Date: 2026-06-07
Tester: tester+codex
Mode: RETEST
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]`
Branch: `ORCH-1096-business-web-marketing-composer-parity`
Commit tested: `011dae2b54642cdc4fda47e38e5a3552524e8bb1`
Verdict: PASS

## Executive Verdict

ORCH-1096 is ready for orchestrator close from the tester side. The two previous P1 failures are fixed: past/current schedule times are rejected before review and again before confirm/submit with visible copy `Pick a send time in the future.`, and a pending draft autosave no longer fires a draft-only `status=eq.draft` PATCH after scheduling.

The unchanged route guardrails also remain green. Phone compose still runs through the inline preboot composer with `expoScripts=0`, desktop compose remains Expo-owned, native/provider modules stay quarantined from the browser runtime, provider-neutral payout copy remains protected, and the ORCH-1091 through ORCH-1095 route guards remain green through the full chained test.

Physical iPhone Safari was unavailable: `xcrun xctrace list devices` reported `Seth's iPhone (26.5)` under `Devices Offline`. Because the P1 fixes were verified by source, regression tests, local phone-browser runtime proof, and physical Android Chrome with clean logcat, this is a residual manual smoke gate rather than a blocker.

## Ledger / Guardrails Factored

- Relevant OPEN ledger warnings to ALL/ORCH-1096/tester were factored: no deploy/PR/merge/reap/OTA, no backend/provider/schema mutation, preserve provider-neutral payout copy, preserve native-module quarantine, preserve ORCH-1091/1092/1093/1094/1095 route protections, and treat source truth from the ORCH worktree rather than stale anchor state.
- The anchor ledger was not edited or committed per Seth's dispatch.
- No product code, backend, provider, schema, deployment, PR, merge, reap, or OTA action was performed.

## P1 Retest Findings

No P0/P1 findings remain.

### P1-1 Retest: Past/current schedule times rejected

Result: PASS.

Evidence:
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:213-222` defines `scheduledDateValue()` and `scheduledTimeIsFuture()` with `date.getTime() > Date.now()`.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:384-392` returns `Pick a send time in the future.` when scheduled mode is not in the future.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:513-520` re-runs validation during confirm and returns the user to composer with the same error before submit.
- Regression tests: `mingla-business/src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts:78-93` pins before-review and before-confirm validation.
- Local browser proof: `2000-01-01 00:01` produced `reviewOpened=false` and visible alert `Pick a send time in the future.`. A review opened for `2030-01-01 10:01`, then after advancing `Date.now()` past that time, confirm produced `reviewOpened=false`, `composerVisible=true`, and alert `Pick a send time in the future.` with no scheduled PATCH.

### P1-2 Retest: No draft-only autosave PATCH after schedule

Result: PASS.

Evidence:
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:224-232` clears pending autosave timers and blocks autosave while submitting or after success.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:402-413` cancels prior timers before scheduling a new autosave and uses `saveDraft(false, { autosave: true })`.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:429-431` blocks autosave when `autosaveBlocked()` is true and clears any pending timer before explicit draft save.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:522-537` cancels autosave before submit and again after success.
- Regression tests: `mingla-business/src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts:95-125` pins autosave cancellation, submit blocking, post-success blocking, and CI guard coverage.
- Local browser proof: after successful schedule, waited 1300ms, longer than the old 800ms autosave timer. Observed one scheduled PATCH and `draftPatchAfterSchedule=0`; success copy remained `Campaign scheduled for Jan 1, 10:10 AM.` and no draft-save error replaced it.
- Physical Android Chrome proof: after successful schedule on Samsung A72, waited 1300ms and observed `draftPatchAfterSchedule=0`.

## Commands Run

### Worktree / commit confirmation

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/
git status --short --branch
git rev-parse HEAD
git branch --show-current
git log -1 --oneline
```

Result excerpt:

```text
## ORCH-1096-business-web-marketing-composer-parity...origin/ORCH-1096-business-web-marketing-composer-parity
011dae2b54642cdc4fda47e38e5a3552524e8bb1
ORCH-1096-business-web-marketing-composer-parity
011dae2b5 ORCH-1096: fix composer schedule rework
```

### Fresh export, inject, and chained ORCH guard

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
rm -rf dist
npx expo export -p web --output-dir dist > /tmp/orch1096-retest-export.log 2>&1
node scripts/inject-mobile-blur-css.mjs
npm run test:orch-1096
```

Result excerpt:

```text
[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
ORCH-1089 signed-in Event Creator wizard PASS.
ORCH-1092 business web restoration wave PASS.
ORCH-1093 self-test PASS.
ORCH-1093 deferred false-pass self-test PASS.
ORCH-1093 bundle budgets PASS. phoneBoot=2885080; __common=1882297; deferred=true; interactive=/hub/trips,/hub/events,/marketing,/marketing/campaigns/compose,/account,/event/create
ORCH-1093 signed-in route OOM PASS.
ORCH-1094 business web core parity PASS.
ORCH-1095 business web interactive parity guard PASS
ORCH-1096 Expo composer chunk evidence compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
ORCH-1096 phone preboot evidence phoneBoot=2885080; composerRuntime=inline-preboot
ORCH-1096 business web Marketing Composer parity guard PASS
PASS src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts
Tests: 7 passed, 7 total
```

### Local browser runtime retest

Server:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
npx serve -s dist -l 4196
```

Result:

```text
Serving!
- Local:    http://localhost:4196
- Network:  http://172.20.17.113:4196
```

Playwright mocked signed-in phone/browser result:

```json
{
  "pastResult": {
    "reviewOpened": false,
    "alert": "Pick a send time in the future."
  },
  "reviewOpenedFuture": 1,
  "staleConfirm": {
    "reviewOpened": false,
    "composerVisible": true,
    "alert": "Pick a send time in the future."
  },
  "successResult": {
    "success": "Campaign scheduled for Jan 1, 10:10 AM.",
    "alert": "",
    "expoScripts": 0,
    "composer": true
  },
  "scheduledPatches": 1,
  "draftPatchAfterSchedule": 0,
  "calls": [
    { "method": "POST", "table": "marketing_campaigns", "status": "draft" },
    { "method": "PATCH", "table": "marketing_campaigns", "query": "status=in.(draft,scheduled)", "status": "scheduled" }
  ],
  "desktopResult": {
    "expoScripts": 3,
    "composerRuntime": false
  }
}
```

Desktop evidence confirms the desktop route remains Expo-owned while the phone route uses the inline preboot composer.

### Physical Android Chrome retest

Device availability:

```bash
command -v adb
adb devices
```

Result:

```text
/Users/sethogieva/Library/Android/sdk/platform-tools/adb
List of devices attached
R58R54YV7JT	device
```

Setup:

```bash
adb -s R58R54YV7JT reverse tcp:4196 tcp:4196
adb -s R58R54YV7JT forward tcp:9222 localabstract:chrome_devtools_remote
adb -s R58R54YV7JT logcat -c
adb -s R58R54YV7JT shell am start -a android.intent.action.VIEW -d http://127.0.0.1:4196/marketing/campaigns/compose com.android.chrome
```

CDP result:

```json
{
  "result": {
    "width": 384,
    "height": 718,
    "composer": true,
    "expoScripts": 0,
    "success": "Campaign scheduled for Jan 1, 12:30 PM.",
    "alert": ""
  },
  "draftPatchAfterSchedule": 0,
  "calls": [
    { "method": "POST", "table": "marketing_campaigns", "status": "draft" },
    { "method": "PATCH", "table": "marketing_campaigns", "query": "status=in.(draft,scheduled)", "status": "scheduled" }
  ]
}
```

Crash/OOM grep:

```bash
adb -s R58R54YV7JT logcat -d | rg -i "V8 javascript OOM|Ineffective mark-compacts|SIGSEGV|Aw, Snap|fatal exception|Render process gone|Render process|CrRendererMain" > Mingla_Artifacts/reports/orch-1096-retest-evidence/android_chrome_a72_crash_oom_grep.txt || true
wc -l Mingla_Artifacts/reports/orch-1096-retest-evidence/android_chrome_a72_crash_oom_grep.txt
```

Result:

```text
0 Mingla_Artifacts/reports/orch-1096-retest-evidence/android_chrome_a72_crash_oom_grep.txt
```

### Physical iPhone Safari availability

```bash
xcrun xctrace list devices 2>/dev/null | sed -n '1,80p'
```

Result excerpt:

```text
== Devices Offline ==
Seth's iPhone (26.5) (00008120-000E55393A69A01E)
```

## Platform Matrix

| Surface | Result | Evidence |
|---|---|---|
| Phone web signed-in local browser | PASS | Past time rejected before review, stale time rejected before confirm, success copy persisted, `draftPatchAfterSchedule=0`, `expoScripts=0`. |
| Physical Android Chrome | PASS | Samsung A72 rendered composer, `expoScripts=0`, scheduled successfully, `draftPatchAfterSchedule=0`, logcat crash/OOM grep `0`. |
| Physical iPhone Safari | RESIDUAL MANUAL GATE | Device offline. Based on source/test/local browser/Android evidence, this does not block PASS, but Seth should run one final Safari smoke when the device is online. |
| Desktop browser | PASS | Local browser proof: `expoScripts=3`, `composerRuntime=false`; desktop compose remains Expo-owned. |
| Native iOS/Android app | N/A | ORCH-1096 rework is business web only; native-module quarantine checked by source and guard. |
| Backend/Supabase/provider/schema | N/A | No backend/provider/schema changes in scope or performed. |

## Claim Table

| Claim | Retest Verdict | Evidence |
|---|---|---|
| P1-1 past/current schedule times are rejected before review | Verified | Source validation, Jest guard, local browser `reviewOpened=false`, visible copy `Pick a send time in the future.` |
| P1-1 stale scheduled time is rejected before confirm/submit | Verified | Source confirm validation, Jest guard, local browser fake-time proof returned to composer with same visible copy and no scheduled PATCH. |
| P1-2 no pending autosave/draft-only PATCH fires after scheduling | Verified | Source timer cancellation, Jest guard, local browser and physical Android `draftPatchAfterSchedule=0` after 1300ms. |
| Success copy is not replaced by draft save error | Verified | Local browser success remained `Campaign scheduled for Jan 1, 10:10 AM.` with no alert; Android success remained `Campaign scheduled for Jan 1, 12:30 PM.` |
| Fresh export/inject and `npm run test:orch-1096` pass | Verified | Full chained command passed. |
| Phone compose uses `expoScripts=0` | Verified | Local phone/browser and physical Android Chrome both reported `expoScripts=0`. |
| Desktop compose remains Expo-owned | Verified | Desktop local browser reported `expoScripts=3` and `composerRuntime=false`. |
| Native-module quarantine/provider-neutral copy/ORCH-1091-1095 guards remain green | Verified | `npm run test:orch-1096` chained ORCH-1085 through ORCH-1095 and ORCH-1096 guard; source inspection showed no forbidden native/provider tokens in browser runtime. |
| Physical Android Chrome OOM/logcat remains clean | Verified | Samsung A72 logcat crash/OOM grep file has 0 lines. |
| Physical iPhone Safari verified | Unverified residual | iPhone offline. Manual Safari smoke remains recommended when available. |

## Regression Coverage Assessment

Regression coverage is acceptable for close. The rework added repo-running Jest checks and CI guard checks for both original P1s:

- `phone schedule review rejects past or current scheduled times before review and confirm`
- `phone schedule cancels draft autosave and blocks post-schedule draft-only PATCH races`
- `ORCH-1096 CI guard pins past-date and autosave-race regressions`

Fail-on-revert proof was not performed by editing/reverting product code because tester mode forbids implementation edits. The tests directly assert the missing old-contract tokens and runtime structure that were absent in the prior fail report, and runtime browser proof independently exercises the behavior.

## Residual Risks

- Physical iPhone Safari remains unverified because the device is offline. Manual smoke: open `http://<Mac LAN IP>:4196/marketing/campaigns/compose` in Safari with the local server running, confirm phone composer renders, set a past schedule time and see `Pick a send time in the future.`, then schedule a future campaign and confirm success copy persists.
- No backend-side invariant was added to reject past scheduled times; backend/provider/schema changes were out of scope. The frontend now prevents the prior business-web phone path from reaching review/submit with stale or past times.

## Downstream Close Recommendation

Recommend PASS close for ORCH-1096. Orchestrator can close based on this report and the tested commit `011dae2b54642cdc4fda47e38e5a3552524e8bb1`, with the physical iPhone Safari check logged as a residual manual smoke gate when the device comes online. Do not deploy, merge, PR, reap, OTA, or touch backend/provider/schema from tester mode.
