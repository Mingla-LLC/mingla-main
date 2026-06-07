# ORCH-1096 Implementation Report: Business Web Marketing Composer Parity

## Status

Implemented and partially verified.

The phone-browser `/marketing/campaigns/compose` route now renders a real bounded Marketing Composer workflow instead of the stripped Subject/Message shell. Automated guards, fresh web export/injection, local browser proof, and physical Android Chrome proof passed. Physical iPhone Safari proof was not possible in this implementation turn because the available iPhone was offline/unreachable, so that remains an explicit tester manual gate.

## Scope Guardrails Honored

- No Supabase migrations.
- No edge function deploys.
- No backend/provider/API contract changes.
- No web deploy, PR, merge, reap, or OTA.
- ORCH-1091 cache busting, ORCH-1093 route chunk quarantine, ORCH-1094 static Home restoration, ORCH-1095 blocked-route protections, and native-module quarantine stayed covered by the chained test suite.
- No provider-specific payout copy was introduced.

## Changed Files

- `mingla-business/package.json`
  - Added `test:orch-1096`.
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
  - Injects the bounded ORCH-1096 composer runtime into the phone preboot loader.
  - Routes phone `/marketing/campaigns/compose` to `renderMarketingComposerRoute(...)`.
  - Leaves other light routes and blocked-route recovery behavior intact.
- `mingla-business/scripts/mobile-web-marketing-composer-runtime.js`
  - New phone-browser composer runtime.
  - Uses existing Supabase REST data contracts for `brands`, `marketing_campaigns`, `marketing_audiences`, `marketing_templates`, `events_with_master_date_view`, and `orders`.
  - Supports audience selection/creation, templates, personalization chips, event chips, editable body, preview, draft save/update, schedule picker, review, submitting, success, loading, empty, and error states.
- `mingla-business/scripts/ci/orch-1096-business-web-marketing-composer-parity.mjs`
  - New guard rejecting the old stripped shell and checking runtime, route, chunk, cache, and native/provider quarantine evidence.
- `mingla-business/src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts`
  - Source-level tests for the ORCH-1096 route contract, runtime workflow markers, ORCH-1095 protections, and native/provider quarantine.
- `Mingla_Artifacts/reports/orch-1096-evidence/android_chrome_a72_scheduled.png`
  - Physical Android Chrome screenshot after completing the mocked signed-in schedule flow.
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1096_BUSINESS_WEB_MARKETING_COMPOSER_PARITY.md`
  - This report.

## Failing-Before Evidence

Command:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
npm run test:orch-1096
```

Result before implementation:

- Existing ORCH-1085 through ORCH-1095 chain passed.
- ORCH-1096 failed as intended with:

```text
ORCH-1096 business web Marketing Composer parity FAIL:
- scripts/inject-mobile-blur-css.mjs missing required token: mobile-web-marketing-composer-runtime.js
```

This proved the new guard rejected the current stripped-shell implementation before the runtime was added.

## Automated Verification

Final command:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
rm -rf dist
npx expo export -p web --output-dir dist >/tmp/orch1096-export.log 2>&1
node scripts/inject-mobile-blur-css.mjs
npm run test:orch-1096
```

Final result:

- Fresh export and injection completed.
- `ORCH-1085 mobile-web sign-in PASS.`
- `ORCH-1087 static route firewall PASS.`
- `ORCH-1088 event creator phone parity PASS.`
- `ORCH-1089 signed-in Event Creator wizard PASS.`
- `ORCH-1092 business web restoration wave PASS.`
- `ORCH-1093 signed-in route OOM PASS.`
- `ORCH-1094 business web core parity PASS.`
- `ORCH-1095 business web interactive parity guard PASS.`
- `ORCH-1096 business web Marketing Composer parity guard PASS.`
- Jest `orch_1096_business_web_marketing_composer_parity.test.ts`: 4 tests passed.

Fresh export/chunk evidence from the final run:

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

Local Pixel 5 signed-out proof:

```json
{
  "light": true,
  "composer": false,
  "expoScripts": 0,
  "text": "Mingla Business\nHome\nSign in to open Compose blast...."
}
```

Local Pixel 5 mocked signed-in proof:

```json
{
  "light": true,
  "composer": true,
  "expoScripts": 0,
  "preview": true,
  "reviewText": true,
  "oldShellOnly": false,
  "url": "/marketing/campaigns/compose"
}
```

The mocked signed-in local flow covered audience selection, subject/body entry, personalization chip insertion, event chip insertion, template apply, preview, schedule date/time, review, and confirm schedule.

Desktop Chromium proof:

```json
{
  "light": false,
  "composerRuntime": false,
  "expoScripts": 3,
  "text": "MINGLA BUSINESS\nSign in to open Compose blast...",
  "url": "/marketing/campaigns/compose"
}
```

This confirms desktop still loads the Expo route instead of the phone preboot runtime.

## Physical Android Chrome Proof

Device:

```text
Samsung A72 R58R54YV7JT
```

Setup:

```bash
adb reverse tcp:4196 tcp:4196
adb shell am start -a android.intent.action.VIEW -d http://127.0.0.1:4196/marketing/campaigns/compose com.android.chrome
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

Physical Android signed-out proof:

```json
{
  "light": true,
  "composer": false,
  "expoScripts": 0,
  "text": "Mingla Business\nHome\nSign in to open Compose blast...",
  "width": 384,
  "height": 718,
  "ua": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36"
}
```

Physical Android mocked signed-in proof:

```json
{
  "light": true,
  "composer": true,
  "expoScripts": 0,
  "scheduled": true,
  "url": "/marketing/campaigns/compose",
  "width": 384,
  "height": 718
}
```

Android flow covered audience selection, subject/body entry, personalization chips, event chips, template apply, preview, schedule date/time, review, and confirm schedule.

Crash/OOM check:

- `adb logcat` grep found no matching lines for `V8 javascript OOM`, `Ineffective mark-compacts`, `SIGSEGV`, `CrRendererMain`, `Aw, Snap`, `fatal exception`, or `Render process`.

Screenshot:

- `Mingla_Artifacts/reports/orch-1096-evidence/android_chrome_a72_scheduled.png`

## Physical iPhone Safari Gate

Physical iPhone Safari was not verified in this turn.

Observed availability:

- `xcrun xctrace list devices` showed Seth's iPhone on iOS 26.5 as `Offline`.
- `ios_webkit_debug_proxy` was unavailable.
- The iPhone was not available through the accessible local device tooling.

Manual tester gate:

1. On physical iPhone Safari, open the locally served export at `/marketing/campaigns/compose`.
2. Sign in with a business account that has a brand, orders, events, audiences, and templates.
3. Verify the route renders the real composer, not only Subject/Message.
4. Select/create an audience, type subject/body, insert personalization and event chips, apply a template, preview, save draft, refresh/re-enter, schedule, review, and confirm.
5. Verify no clipped/overlapping text, all primary touch targets are at least 44px, keyboard interactions are usable, contenteditable deletion works around chips, loading does not spin beyond 8 seconds, and success/error states are honest.

## Data And Runtime Notes

- The phone runtime intentionally uses existing Supabase REST tables and browser fetch calls from the preboot shell instead of importing the full React route. This preserves the ORCH-1093/1095 phone route memory protection while making compose useful.
- Draft save creates or updates `marketing_campaigns` records with `status=draft`.
- Scheduling updates the draft to `status=scheduled` with `scheduled_for`.
- "Send now" is represented as immediate scheduled state in this bounded browser workflow; it does not introduce a new provider send path.
- Audience creation is limited to existing audience semantics and order-derived brand/event buyer queries.

## Residual Risks

- Physical iPhone Safari remains the main unverified surface.
- The desktop route was proven to keep loading Expo instead of the phone runtime, but a real signed-in desktop composer smoke test remains useful for tester confidence because desktop source was intentionally left untouched.
- Real production-like data may expose edge cases in audience/template/event availability; the runtime includes empty/error states, but tester should verify with a real seeded business account.

## Downstream Tester Handoff

Tester should use branch `ORCH-1096-business-web-marketing-composer-parity` in worktree `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/`.

Required tester output:

- `Mingla_Artifacts/reports/QA_ORCH-1096_BUSINESS_WEB_MARKETING_COMPOSER_PARITY.md`

Tester should independently rerun:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]/mingla-business
rm -rf dist
npx expo export -p web --output-dir dist
node scripts/inject-mobile-blur-css.mjs
npm run test:orch-1096
npx serve -s dist -l 4196
```

Tester should verify phone and desktop browser behavior, physical Android Chrome, and the explicit physical iPhone Safari manual gate. Tester must not deploy, merge, reap, OTA, or make backend/provider/schema changes.
