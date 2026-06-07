# QA Report: ORCH-1096 Business Web Marketing Composer Parity

Date: 2026-06-07
Tester: tester+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]`
Branch: `ORCH-1096-business-web-marketing-composer-parity`
Commit tested: `77eaa64eb`
Verdict: FAIL

## Executive Verdict

ORCH-1096 is not ready to ship. The implementation does restore a real phone-browser composer surface without full Expo boot, and Android Chrome did not OOM in the mocked signed-in flow, but a core schedule validation requirement fails: the phone runtime lets users review and submit a campaign scheduled in the past. The same runtime also leaves a durability risk where a pending draft autosave can fire after scheduling and attempt to update a now-scheduled row through the draft-only path.

Physical iPhone Safari was unavailable: `xcrun xctrace list devices` reported Seth's iPhone (iOS 26.5) as Offline. Because this QA already found a P1 blocker, the iPhone gate remains a retest requirement rather than the deciding blocker.

## Ledger / Guardrails Factored

- COMMS-0002/0003/0004/0011/0012/0013/0015/0016/0018/0019/0021 factored.
- No deploy, PR, merge, reap, OTA, backend, provider, or schema changes were made.
- Provider-neutral payout copy was checked by the ORCH-1096 guard and source inspection.
- The anchor ledger was acknowledged separately in `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`; anchor had unrelated dirty files, so this QA report and evidence stay in the ORCH worktree.

## P1 Findings

### P1-1: Phone schedule review accepts and submits past dates

Impact: A business user can choose January 1, 2000, open the review sheet, and schedule the campaign. That violates the spec requirement that schedule review cannot submit an invalid date.

Evidence:
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:362-369` only checks for missing or unparsable `state.scheduledFor`; it does not reject times in the past.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:470-480` converts the date/time inputs and opens review when the date parses.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:188-209` sends the parsed value to `marketing_campaigns` with `status: "scheduled"`.
- Browser proof, Pixel 5 mocked signed-in: setting `#orch1096-date` to `2000-01-01` and `#orch1096-time` to `00:01` produced `data-orch-1096-review=true`, review copy `When: Jan 1, 12:01 AM`, final success `Campaign scheduled for Jan 1, 12:01 AM`, and a PATCH body with `"scheduled_for": "2000-01-01T05:01:00.000Z"`.

Required rework:
- Reject schedule times at or before now with user-facing copy before review opens and again before confirm.
- Add automated ORCH-1096 coverage proving a past date cannot reach review or submit.

### P1-2: Pending autosave can fire after schedule and issue a draft-only update against a scheduled campaign

Impact: The user can see a successful schedule state followed by a misleading save error, or the runtime can make an unnecessary post-schedule mutation that real PostgREST/RLS will reject because the row is no longer `status=draft`.

Evidence:
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:379-385` starts an 800ms draft save timer from dirty changes.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:401-419` does not clear `saveTimer` when saving explicitly.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:494-506` schedules after `saveDraft(false)` but does not cancel pending draft timers or disable autosave after success.
- Source: `mingla-business/scripts/mobile-web-marketing-composer-runtime.js:168-184` updates drafts with `status=eq.draft`, so a post-schedule timer will return no row after the schedule PATCH succeeds.
- Runtime evidence: the Android Chrome mocked flow emitted draft PATCH calls before the schedule PATCH. The source path proves a still-pending timer after scheduling will hit the same draft-only endpoint and fail in real data if it fires after `status=scheduled`.

Required rework:
- Clear any pending `saveTimer` before explicit save/schedule and prevent autosave while `submitting` or after `activePanel === "success"`.
- Add regression coverage that scheduling does not issue a later `status=eq.draft` update and does not replace success copy with a draft-save error.

## Verified Pass Evidence

### Automated gates

Command:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
rm -rf dist
npx expo export -p web --output-dir dist > /tmp/orch1096-qa-export.log 2>&1
node scripts/inject-mobile-blur-css.mjs
npm run test:orch-1096
```

Result excerpt:

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
Tests: 4 passed
```

Export evidence:

```text
ORCH-1096 Expo composer chunk evidence compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
ORCH-1096 phone preboot evidence phoneBoot=2885080; composerRuntime=inline-preboot
```

### Local browser proof

Server:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
npx serve -s dist -l 4196
```

Signed-out Pixel 5 result:

```json
{
  "light": true,
  "composer": false,
  "expoScripts": 0,
  "text": "Mingla Business\nHome\nSign in to open Compose blast..."
}
```

Mocked signed-in Pixel 5 result:

```json
{
  "preview": true,
  "reviewPast": { "review": true, "when": "When: Jan 1, 12:01 AM" },
  "final": { "success": true, "expoScripts": 0, "composer": true }
}
```

The mocked signed-in path covered audience selection, subject/body input, personalization chip, event chip, template apply, preview, schedule picker, review, and schedule submit. It also exposed P1-1.

Desktop route proof:

```json
{
  "light": false,
  "composerRuntime": false,
  "expoScripts": 3,
  "text": "MINGLA BUSINESS\nSign in to open Compose blast...",
  "url": "/marketing/campaigns/compose"
}
```

This confirms desktop still uses the Expo route and is not replaced by the phone preboot runtime.

### Physical Android Chrome proof

Device:

```text
Samsung A72 R58R54YV7JT
Chrome/148.0.0.0, viewport 384x718
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
  "light": true,
  "composer": true,
  "expoScripts": 0,
  "success": true,
  "width": 384,
  "height": 718,
  "text": "Mingla Business\nHome\nCompose blast\nCampaign scheduled for Jun 8, 12:30 PM..."
}
```

Mutation evidence:

```json
{
  "method": "PATCH",
  "path": "marketing_campaigns",
  "body": {
    "status": "scheduled",
    "scheduled_for": "2026-06-08T16:30:00.000Z",
    "channel_payload": {
      "kind": "email",
      "subject": "Template Subject",
      "body_html": "Template body {first_name}",
      "body_text": "Template body {first_name}",
      "embedded_events": []
    }
  }
}
```

Crash/OOM grep:

```bash
adb -s R58R54YV7JT logcat -d | rg -i "V8 javascript OOM|Ineffective mark-compacts|SIGSEGV|Aw, Snap|fatal exception|Render process gone|Render process|CrRendererMain" > Mingla_Artifacts/reports/orch-1096-qa-evidence/android_chrome_a72_crash_oom_grep.txt || true
wc -l Mingla_Artifacts/reports/orch-1096-qa-evidence/android_chrome_a72_crash_oom_grep.txt
```

Result: `0`.

Note: physical screenshot capture through Chrome CDP timed out, and `adb screencap` captured Chrome's visible tab rather than the DevTools-controlled tab, so no screenshot is used as QA evidence. The CDP DOM/runtime result and zero-line crash/OOM log are the physical Android evidence.

## Security / Durability Review

- Authenticated writes use Supabase REST with anon key plus the stored user access token; RLS policies require `auth.uid()` or sufficient brand role for audiences/campaigns.
- No backend/provider/schema changes were present in the implementation diff.
- Native module quarantine passed the ORCH-1096 source/export guard for `react-native-pell-rich-editor`, `react-native-webview`, native DateTimePicker, Stripe Connect packages, and related native-only modules.
- Provider-neutral payout copy guard passed for the runtime.
- UI injection from template body did not execute in the local mock (`window.__bodyXss` stayed `0`) because `tokenStringToEditorHtml` escapes stored body HTML before rendering. Residual risk remains for pasted/linked rich HTML in outgoing `body_html`; the current desktop composer also stores rich HTML, so this is not a new standalone fail without a broader marketing sanitizer contract.

## Platform Matrix

| Surface | Result | Evidence |
|---|---|---|
| Phone web signed-out | PASS | Pixel 5 local proof: light recovery, no composer, `expoScripts=0`. |
| Phone web mocked signed-in | FAIL | Workflow renders, but past date review/submit succeeds. |
| Physical Android Chrome | FAIL overall / PASS OOM | Real composer success with `expoScripts=0`; logcat OOM/crash grep `0`; same code path has P1 schedule validation defect. |
| Physical iPhone Safari | UNVERIFIED | `xcrun xctrace list devices` showed Seth's iPhone (26.5) Offline. Retest required after rework. |
| Desktop browser | PASS smoke | `light=false`, `composerRuntime=false`, `expoScripts=3`; desktop route remains Expo-owned. |

## Claim Table

| Claim | Verdict | Evidence |
|---|---|---|
| Phone compose is no longer the old ORCH-1095 stripped shell | Verified | Source branch calls `renderMarketingComposerRoute`; guard rejects old Subject/Message-only shell. |
| Phone compose avoids full Expo boot | Verified | Pixel/Android `expoScripts=0`; guard reports `composerRuntime=inline-preboot`. |
| Existing ORCH-1091/1093/1094/1095 protections remain | Verified | `npm run test:orch-1096` chains and passes ORCH-1085 through ORCH-1095. |
| Schedule review cannot submit invalid date/body/audience | Refuted | Past date reached review and scheduled PATCH. |
| Draft/schedule writes use authenticated Supabase/RLS-compatible paths | Partially verified | REST calls use user bearer token and existing RLS tables; autosave-after-schedule durability risk remains. |
| Provider-neutral payout copy preserved | Verified | ORCH-1096 guard checks forbidden copy; no payout files changed. |
| Physical iPhone Safari verified | Unverified | Device offline. |

## Regression Coverage Assessment

The added `test:orch-1096` is useful but insufficient. It proves the old shell was replaced and catches native/provider quarantine regressions, but it does not exercise the behavioral failures found here:

- no past-date rejection test,
- no post-schedule autosave cancellation test,
- no fail-on-revert proof beyond the implementation report's pre-change token failure,
- no automated browser test asserting schedule validation and mutation ordering.

Because the failing behavior is in a core phone-browser send/schedule path, this is a FAIL rather than a conditional pass.

## Downstream Recommendation

Route back to implementor for bounded rework. Retest must rerun fresh export/inject, `npm run test:orch-1096`, local signed-out and mocked signed-in browser proof, physical Android Chrome OOM/logcat proof, and physical iPhone Safari when the device is online. Do not deploy, merge, PR, reap, OTA, or touch backend/provider/schema from this worktree.
