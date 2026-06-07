# QA Report: ORCH-1094 Business Web Core Parity Wave

Date: 2026-06-07
Skill: tester-mingla (Codex parity mirror)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]`
Branch: `ORCH-1094-business-web-core-parity-wave`
Tested head: `fa47ee149419fd33b9a3fcf407959fa0663ffb9b`

## Verdict

CONDITIONAL PASS.

The static route contract, route guard contract, fresh export, injector repairs, regression chain, signed-out recovery, physical signed-out Android Chrome smoke, and desktop/mobile browser smoke all pass. The condition is a release/manual gate, not a code rework finding: a real signed-in physical Android Chrome session and a real signed-in iPhone Safari session were not available in this tester pass, so signed-in data-bearing phone behavior remains unverified.

## Findings

| Severity | Finding | Evidence | Required action |
|---|---|---|---|
| P2 | Signed-in physical phone behavior remains unverified for the newly approved core routes. | Physical Android `R58R54YV7JT` was available but Chrome was signed out; no safe authenticated business web credentials/session were available. No physical iPhone or booted iOS simulator was available. Playwright iPhone 13 and desktop smoke passed signed-out route recovery, but this is not equivalent to signed-in data flow proof. | Before close/deploy, run signed-in Android Chrome and signed-in iPhone Safari smoke for `/event/create`, `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account`; confirm no blank page/OOM and sane first screen/data recovery. |
| P2 | Campaign schedule/date interaction is source- and route-smoke verified, not signed-in interaction verified. | `npm run test:orch-1094` confirms the composer route chunk exists and prior ORCH-1092 test confirms web-native schedule controls; signed-out route recovery loads. No authenticated composer interaction was possible. | Include one signed-in mobile browser interaction on compose: open campaign composer, focus subject/body, open schedule/date controls, return without crash. |

No P0/P1 release blockers were found in the independently verified source/export/browser evidence.

## Claim Table

| Claim | Result | Evidence |
|---|---|---|
| Static Home links approved core routes directly. | Verified | `public/home.html` contains `/event/create`, `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, `/account` with `data-orch-1094-core-route` markers. `npm run test:orch-1094` passed. |
| `/hub/experiences`, `/ari`, and `/connect-account-management` remain blocked/protected. | Verified | `_layout.tsx` and injector maps keep all three as `blocked`; static Home uses hash shell links rather than direct route hrefs; Playwright and physical Android showed protected recovery for `/hub/experiences`. |
| No sessionless payout management route is exposed. | Verified | Static Home keeps `#payout-account` shell copy with `generated secure session`; no `href="/connect-account-management"` in source or dist. |
| Provider-neutral seller entry copy is preserved. | Verified with scoped caveat | Static Home and core route tests reject `Stripe account`, `Connect Stripe`, and `Payments & Stripe` in seller entry copy. Deeper authenticated Stripe/tax internals still use Stripe-specific copy by design and were not changed by ORCH-1094. |
| ORCH-1091/1092/1093 protections remain intact. | Verified | Chained `npm run test:orch-1094` ran ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, ORCH-1093 self-test, and ORCH-1093 bundle gate successfully. |
| Fresh export plus injector works. | Verified | `rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs` completed; injector logged successful mobile chunk recovery/preboot/blur-kill injection. |
| Route chunk evidence exists. | Verified | Test output recorded `phoneBoot=2884933`, `__common=1881778`, deferred route chunks for all six approved routes, and blocked routes excluded from static direct links. |
| Oversized `__common` is accepted only under ORCH-1094 physical/proof contract. | Verified as conditional | ORCH-1093 self-test now proves oversized deferred payload can still fail without proof, and the live gate passes approved ORCH-1094 routes with route chunk proof. Physical signed-in proof remains the manual condition. |
| Injector repairs `index-... 2.js` duplicate and missing `_layout` chunks. | Verified | Temporary export-copy simulation passed: `index-ac9f69540137b2c1083ddc8d4981837a 2.js -> index-ac9f69540137b2c1083ddc8d4981837a.js`; `_layout-8e48e6f98503f04b7b79c89547e789de.js recreated`. |
| Signed-out recovery works. | Verified | Playwright iPhone 13 and desktop approved routes showed sign-in recovery, not protected recovery. Physical Android Chrome `/hub/events` showed signed-out ready-route recovery. |
| Signed-in physical/mobile browser behavior works. | Unverified | No authenticated physical Android/iPhone business web session was available. Implementation report had the same gap; tester did not close it. |

## Platform Matrix

| Surface | Result | Notes |
|---|---|---|
| Desktop Chromium local export | PASS | `/home` and all approved routes rendered signed-out recovery without console/page errors in local rewrite server smoke. |
| iPhone Safari-equivalent Playwright | PASS for signed-out/protected behavior; signed-in unverified | iPhone 13 emulation passed `/home`, all approved routes, and blocked routes. This is browser-emulation evidence, not physical iPhone proof. |
| Physical Android Chrome | PASS for signed-out/protected behavior; signed-in unverified | Device `R58R54YV7JT` loaded local export through `adb reverse tcp:51094 tcp:51094`. `/hub/events` showed sign-in recovery; `/hub/experiences` showed protected recovery. |
| Physical iPhone Safari | UNVERIFIED | No physical iPhone was connected and no booted iOS simulator was available. |
| Backend/Supabase/provider | N/A | ORCH-1094 made no DB, RLS, edge, migration, Stripe/provider, deploy, merge, OTA, or reap changes. |

## Commands Run

### Ledger acknowledgement

From anchor `/Users/sethogieva/Desktop/mingla-main`:

```bash
sed -n '1,220p' /Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md
git diff --check -- COMMS_LEDGER.md
git add COMMS_LEDGER.md
git commit -m "COMMS-1094: acknowledge QA warnings"
git push origin main
```

Result:

```text
[main 50d76dcbb] COMMS-1094: acknowledge QA warnings
1 file changed, 11 insertions(+), 11 deletions(-)
main -> main
```

### Source/artifact inspection

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git show --stat --oneline HEAD
sed -n '1,260p' Mingla_Artifacts/specs/SPEC_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md
sed -n '1,260p' Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md
rg -n "hub/experiences|connect-account-management|data-orch-1094|hub/trips|Stripe|Connect bank" ...
```

Result: branch and tested head matched the handoff; changed files were scoped to business web route guards, static Home, CI scripts/tests, and implementation evidence.

### Fresh export, injector, and regression chain

From `mingla-business`:

```bash
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1094
```

Result excerpt:

```text
Exported: dist
[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
ORCH-1089 signed-in Event Creator wizard PASS.
ORCH-1092 business web restoration wave PASS.
ORCH-1093 self-test PASS.
ORCH-1093 deferred false-pass self-test PASS.
ORCH-1093 bundle budgets PASS. phoneBoot=2884933; __common=1881778; deferred=true; approved=/hub/trips,/hub/events,/marketing,/marketing/campaigns/compose,/account,/event/create
ORCH-1094 bundle evidence phoneBoot=2884933; __common=1881778; deferred=true
ORCH-1094 route chunk /event/create create-285c84b67ccbda12c0b293d15a34f037.js 4522
ORCH-1094 route chunk /hub/events events-539a600e4d9dbe46e145238db5723687.js 18954
ORCH-1094 route chunk /hub/trips trips-16ecc294365aad13f1001aa0c491ddda.js 12661
ORCH-1094 route chunk /marketing index-140ddfb8fd743bc1ed14962475948c9c.js 11952
ORCH-1094 route chunk /marketing/campaigns/compose compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
ORCH-1094 route chunk /account account-4d3134140304fd405f5982d94f4524f1.js 9055
ORCH-1094 business web core parity PASS.
```

Sentry org/project warning appeared during export because local Sentry env is not configured; it did not block export.

### Injector adversarial repair simulation

From `mingla-business`, using a temporary copy under `/tmp`:

```bash
TMP=$(mktemp -d /tmp/orch1094-injector.XXXXXX)
cp -R dist "$TMP/dist"
node - "$TMP" "$PWD/scripts/inject-mobile-blur-css.mjs" <<'NODE'
# simulated duplicate index chunk and missing _layout chunk, then reran injector
NODE
rm -rf "$TMP"
```

Result:

```text
index duplicate repair PASS: index-ac9f69540137b2c1083ddc8d4981837a 2.js -> index-ac9f69540137b2c1083ddc8d4981837a.js
missing _layout repair PASS: _layout-8e48e6f98503f04b7b79c89547e789de.js recreated
```

### Local Playwright browser smoke

Started a local rewrite server on `http://127.0.0.1:51094` serving `dist/home.html` for `/home`, static assets directly, and `dist/index.html` for app routes.

Result excerpt:

```text
PASS iPhone13-mobile /home ... errors=0
PASS iPhone13-mobile /event/create ... Sign in to create an event ... errors=0
PASS iPhone13-mobile /hub/events ... Sign in to open Hub Events ... errors=0
PASS iPhone13-mobile /hub/trips ... Sign in to open Hub Trips ... errors=0
PASS iPhone13-mobile /marketing ... Sign in to open Marketing overview ... errors=0
PASS iPhone13-mobile /marketing/campaigns/compose ... Sign in to open Compose blast ... errors=0
PASS iPhone13-mobile /account ... Sign in to open Account settings ... errors=0
PASS iPhone13-mobile /hub/experiences ... This route is staying protected ... errors=0
PASS iPhone13-mobile /ari ... This route is staying protected ... errors=0
PASS iPhone13-mobile /connect-account-management ... This route is staying protected ... errors=0
PASS desktop /home ... errors=0
PASS desktop /event/create ... errors=0
PASS desktop /hub/events ... errors=0
PASS desktop /hub/trips ... errors=0
PASS desktop /marketing ... errors=0
PASS desktop /marketing/campaigns/compose ... errors=0
PASS desktop /account ... errors=0
```

### Physical Android Chrome signed-out smoke

Commands:

```bash
adb devices
adb reverse tcp:51094 tcp:51094
adb shell am start -a android.intent.action.VIEW -d "http://127.0.0.1:51094/home" com.android.chrome
adb shell am start -a android.intent.action.VIEW -d "http://127.0.0.1:51094/hub/events" com.android.chrome
adb shell am start -a android.intent.action.VIEW -d "http://127.0.0.1:51094/hub/experiences" com.android.chrome
adb exec-out screencap -p > Mingla_Artifacts/reports/orch-1094-qa-evidence/android-*.png
adb shell uiautomator dump /sdcard/window.xml
adb exec-out cat /sdcard/window.xml > Mingla_Artifacts/reports/orch-1094-qa-evidence/android-*.xml
adb reverse --remove tcp:51094
```

Result excerpt:

```text
List of devices attached
R58R54YV7JT	device
hub_events TEXT: Business | MINGLA BUSINESS | Sign in to open Hub Events. | This phone-browser route is ready, but it needs a business session before it can load your brand data. | 127.0.0.1:51094/hub/events
hub_experiences TEXT: Business | MINGLA BUSINESS | This route is staying protected. | This phone-browser route is not ready for direct entry yet, so Mingla is sending you back to the stable Home launcher. | Return to Home | 127.0.0.1:51094/hub/experiences
```

Evidence files:

- `Mingla_Artifacts/reports/orch-1094-qa-evidence/android-home.png`
- `Mingla_Artifacts/reports/orch-1094-qa-evidence/android-home.xml`
- `Mingla_Artifacts/reports/orch-1094-qa-evidence/android-hub_events.png`
- `Mingla_Artifacts/reports/orch-1094-qa-evidence/android-hub_events.xml`
- `Mingla_Artifacts/reports/orch-1094-qa-evidence/android-hub_experiences.png`
- `Mingla_Artifacts/reports/orch-1094-qa-evidence/android-hub_experiences.xml`

## Regression Coverage Assessment

ORCH-1094 adds `mingla-business/scripts/ci/orch-1094-business-web-core-parity-wave.mjs` and `test:orch-1094`, and updates prior route gates so the suite encodes the new approved-route contract. The regression suite would have failed before implementation because `/hub/trips`, `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, and `/account` were not all approved in both the root layout and injector maps, and because static Home lacked the full ORCH-1094 direct-route marker set.

Fail-on-revert proof was not performed by mutating the branch, but the implementor recorded an actual old-contract failure for ORCH-1087 forbidding `/hub/trips`. Tester independently verified the live suite now chains the prior protections and the new ORCH-1094 guard.

## Deploy and Backend Readiness

No deploy is authorized by this QA report. No backend, Supabase, RLS, migration, edge function, Stripe/provider payload, OTA, merge, or reap action was performed.

Future web release must come only after merge to main per COMMS-0015. If a close/deploy proceeds on this conditional verdict, the close owner must record acceptance of the signed-in physical Android/iPhone manual gate or rerun QA after Seth provides authenticated browser sessions.

## Downstream Recommendation

Route to orchestrator for conditional-close review only if Seth accepts the residual physical signed-in phone gate. Otherwise route to tester retest after Seth provides:

1. A signed-in business web session or credentials for physical Android Chrome.
2. A physical iPhone Safari session, or a booted iOS simulator plus explicit acceptance that Safari-equivalent simulator proof is enough for this wave.
3. Permission to run the same local export server URL, `http://127.0.0.1:51094`, against those sessions.
