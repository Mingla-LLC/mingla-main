# ORCH-1096 Rework Implementation Report: Business Web Marketing Composer Parity

## Status

Implemented and verified for the two scoped P1 QA findings.

This rework fixes only the QA-requested P1s from `QA_ORCH-1096_BUSINESS_WEB_MARKETING_COMPOSER_PARITY.md`: phone schedule review now rejects send times at or before the current moment before review opens and again before confirm/submit, and pending draft autosave timers are cancelled before explicit save/schedule so a draft-only PATCH cannot race after a successful schedule.

## Scope Guardrails

- No deploy, PR, merge, reap, OTA, backend, provider, or schema changes.
- Anchor `COMMS_LEDGER.md` was read and factored but not edited or committed per Seth's rework instruction.
- Preserved ORCH-1091 cache/chunk recovery, ORCH-1092 provider-neutral payout/native-module quarantine, ORCH-1093 route OOM protections, ORCH-1094 core route restoration, and ORCH-1095 interactive-route protections through the chained `test:orch-1096` gate.
- Provider-neutral payout copy remained untouched.

## Cross-Surface Matrix

| Surface | Scope | Evidence |
|---|---|---|
| Business Web phone `/marketing/campaigns/compose` | Touched. Fixed schedule validation and autosave cancellation in the preboot composer runtime. | Local Pixel/Chromium proof plus ORCH-1096 guard/Jest. |
| Business Web desktop `/marketing/campaigns/compose` | Not in scope. Desktop still uses the Expo route. | ORCH-1096 guard and prior desktop route distinction remain intact. |
| Business native iOS/Android | Not in scope. Native schedule/editor splits not edited. | Native/provider quarantine guard still passes. |
| Consumer iOS/Android/Web | Not in scope. No consumer files touched. | No consumer code changes. |
| Admin Web | Not in scope. | No admin code changes. |
| Backend/Supabase/provider | Not in scope. | No migrations, functions, provider, or schema edits. |

## Changed Files

- `mingla-business/scripts/mobile-web-marketing-composer-runtime.js`
  - Added `scheduledDateValue()` and `scheduledTimeIsFuture()` so schedule validation rejects invalid, current, and past scheduled times.
  - Added visible copy: `Pick a send time in the future.`
  - Re-runs DOM sync + validation in `confirmSchedule()` so a time that becomes stale while the review panel is open cannot submit.
  - Added `cancelPendingAutosave()` and `autosaveBlocked()` to clear timers before explicit saves/schedules and block autosave while submitting or after success.
  - The autosave timer now calls `saveDraft(false, { autosave: true })`, allowing explicit schedule saves to proceed while blocked autosaves stop.
- `mingla-business/scripts/ci/orch-1096-business-web-marketing-composer-parity.mjs`
  - Added ORCH-1096 guard coverage for future-time validation, user-facing past-time copy, autosave cancellation, autosave block state, and schedule-confirm cancellation.
- `mingla-business/src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts`
  - Added regression tests for P1-1 schedule-time rejection before review and before confirm.
  - Added regression tests for P1-2 autosave cancellation/no post-success autosave path.
  - Added test coverage proving the ORCH-1096 CI guard pins both regressions.
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1096_BUSINESS_WEB_MARKETING_COMPOSER_PARITY.md`
  - This report.

## Old-To-New Receipts

### P1-1: Past schedule accepted

- Old behavior from QA: `2000-01-01 00:01` opened review and submitted a scheduled PATCH.
- New behavior: the same input does not open review and renders visible alert copy: `Pick a send time in the future.`
- Regression proof: the new Jest and CI guard tests would fail on the old runtime because it did not contain `scheduledTimeIsFuture()`, `date.getTime() > Date.now()`, or `Pick a send time in the future.`

### P1-2: Draft autosave could race after schedule

- Old behavior from QA: a pending 800ms draft autosave timer could fire after scheduling and hit the draft-only `status=eq.draft` PATCH path.
- New behavior: explicit save/schedule clears any pending autosave, autosave is blocked while `state.submitting`, and autosave is blocked after `activePanel === "success"`.
- Regression proof: the new Jest and CI guard tests would fail on the old runtime because it did not contain `cancelPendingAutosave()`, `autosaveBlocked()`, or `saveDraft(false, { autosave: true })`.

## Automated Verification

Focused Jest:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
npx jest src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts --runInBand
```

Result:

```text
PASS src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts
Tests: 7 passed, 7 total
```

Focused CI guard:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
node scripts/ci/orch-1096-business-web-marketing-composer-parity.mjs
```

Result:

```text
ORCH-1096 Expo composer chunk evidence compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
ORCH-1096 phone preboot evidence phoneBoot=2885080; composerRuntime=inline-preboot
ORCH-1096 business web Marketing Composer parity guard PASS
```

Fresh export/inject plus full chained guard:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
rm -rf dist
npx expo export -p web --output-dir dist > /tmp/orch1096-rework-export.log 2>&1
node scripts/inject-mobile-blur-css.mjs
npm run test:orch-1096
```

Result:

```text
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
ORCH-1089 signed-in Event Creator wizard PASS.
ORCH-1092 business web restoration wave PASS.
ORCH-1093 signed-in route OOM PASS.
ORCH-1094 business web core parity PASS.
ORCH-1095 business web interactive parity guard PASS
ORCH-1096 business web Marketing Composer parity guard PASS
PASS src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts
Tests: 7 passed, 7 total
```

Fresh export evidence:

```text
ORCH-1096 Expo composer chunk evidence compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
ORCH-1096 phone preboot evidence phoneBoot=2885080; composerRuntime=inline-preboot
```

## Local Browser Proof

Served from:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
npx serve -s dist -l 4196
```

Mocked signed-in Pixel/Chromium result:

```json
{
  "pastResult": {
    "reviewOpened": false,
    "alert": "Pick a send time in the future."
  },
  "success": "Campaign scheduled for Jun 8, 12:30 PM.",
  "expoScripts": 0,
  "draftPatchAfterSchedule": 0,
  "calls": [
    { "method": "POST", "table": "marketing_campaigns", "status": "draft" },
    { "method": "PATCH", "table": "marketing_campaigns", "query": "status=in.(draft,scheduled)", "status": "scheduled" }
  ]
}
```

The browser proof waited 1200ms after the scheduled PATCH, longer than the old 800ms autosave timer, and observed zero post-schedule `status=eq.draft` PATCH calls.

## Residual Risks

- Physical iPhone Safari remains a tester gate from the original QA because the device was offline during prior testing and this rework did not use a physical iPhone.
- This rework uses source/guard and local mocked-browser proof for the race; tester should still retest with real phone browser timing because UI event timing is the original failure mode.
- No backend-side schedule-time invariant was added because backend/schema changes were explicitly out of scope.

## Tester Handoff

Retest only the two P1 findings plus the unchanged ORCH-1096 guardrails:

1. Run fresh export/inject and `npm run test:orch-1096`.
2. In a mocked or real phone-browser signed-in flow, set schedule to `2000-01-01 00:01`; review must not open and visible copy must say `Pick a send time in the future.`
3. Open review with a future time, wait until that time is at or before now if feasible or manually force a stale scheduled value before confirm; confirm must reject with the same future-time copy.
4. Schedule a future campaign immediately after making dirty edits; wait at least 1200ms after success and verify no later draft-only `status=eq.draft` PATCH fires and success copy is not replaced by a save error.
5. Reconfirm phone compose still uses `expoScripts=0`, desktop compose still uses the Expo route, provider-neutral payout copy remains intact, and ORCH-1091/1092/1093/1094/1095 protections remain green.
