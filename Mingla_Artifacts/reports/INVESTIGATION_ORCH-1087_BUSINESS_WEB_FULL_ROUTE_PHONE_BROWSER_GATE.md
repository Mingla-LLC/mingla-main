# INVESTIGATION - ORCH-1087 Business Web Full-Route Phone-Browser Gate

Date: 2026-06-05 / 2026-06-06 UTC
Mode: INVESTIGATE-THEN-SPEC, no product-code edit
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1087-[business-web-route-gate]`
Branch: `ORCH-1087-business-web-route-gate`

## Executive Result

**NEEDS-WORK.** Static `/home` is production phone-browser safe, but the static Home actions still lead into full Expo/RN-web routes that are not launch-safe on Android Chrome.

The production phone run proves:

| Route | Runtime result on physical Android Chrome | Classification |
|---|---|---|
| `/home` | First paints the static Home shell, no Expo scripts, usable. | `PASS_NOW` |
| `/event/create` | First paints but remains on `Finishing sign-in...` after 12s. | `FIX_REQUIRED` + `NEEDS_CREDENTIAL_OR_DATA` |
| `/hub/events` | Chrome renderer OOM, shows `Aw, Snap!`. | `STATIC_SHELL_REQUIRED` |
| `/hub/experiences` | Chrome renderer OOM, shows `Aw, Snap!`. | `STATIC_SHELL_REQUIRED` |
| `/hub/trips` | Chrome renderer OOM, shows `Aw, Snap!`. | `STATIC_SHELL_REQUIRED` |
| `/ari` | App error boundary; console shows `TypeError: c.Easing.bezier is not a function`. | `FIX_REQUIRED` |
| `/marketing` | Chrome renderer OOM, shows `Aw, Snap!`. | `STATIC_SHELL_REQUIRED` |
| `/marketing/campaigns/compose` | Chrome renderer OOM, shows `Aw, Snap!`. | `STATIC_SHELL_REQUIRED` |
| `/account` | Chrome renderer OOM, shows `Aw, Snap!`. | `STATIC_SHELL_REQUIRED` |
| `/connect-account-management` | First paints clear invalid-link copy because no session params were supplied. | `NEEDS_CREDENTIAL_OR_DATA` + `STATIC_SHELL_REQUIRED` from static Home |

Recommended first implementor slice: **build a phone-browser static route firewall for every static Home deep link, and fix the Ari `Easing.bezier` web shim only if Ari remains linked as a full route.** Do not try to make all full RN-web surfaces complete in one PR.

## Comms Ledger And Prior Evidence

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` first. Acknowledged open `ALL` WARN rows COMMS-0002/0003/0004/0011/0012/0013/0015/0016/0018/0019/0021 as `mingla-forensics+codex (ORCH-1087 route gate ...)`.

Carry-forward constraints:

- COMMS-0015/0018: no deploy from this worktree; any web deploy must be from merged `main`.
- COMMS-0003: external/provider specs must cite canonical docs.
- COMMS-0021: seller copy must stay provider-neutral: `Payout account`, `Connect bank`, `Payments & Bank`.

Prior required artifacts read:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1085_BUSINESS_WEB_CODE_SPLITTING.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1085_BUSINESS_WEB_MOBILE_SIGNIN_HOME.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1085_MOBILE_WEB_HOME_TABS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1085_MOBILE_WEB_HOME_CI_HARDENING.md`

Current source read:

- `mingla-business/public/home.html`
- `mingla-business/vercel.json`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
- `mingla-business/src/diagnostics/chunkReloadGuard.ts`
- Route and dependency sources named below.

## Android Device And Environment

Physical phone:

- Device: Samsung Galaxy A72, `SM-A725F`, ADB serial `R58R54YV7JT`
- Android: 14
- Screen: `1080x2400`, density `450`
- Browser: Chrome `148.0.7778.215`
- CDP user agent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36`
- Probe host: `https://business.usemingla.com`

Chrome's own support docs describe `Aw, Snap` as a page-load crash state and explicitly include low memory / device memory pressure as a cause: https://support.google.com/chrome/answer/95669 . Chromium's OOM investigation docs also identify Chrome crash reports tagged as out-of-memory from crash stacks and OOM-related function names: https://chromium.googlesource.com/chromium/src/+/125.0.6422.112/docs/memory/oom.md .

## Commands And Evidence Files

Commands/probes run:

```bash
adb devices -l
adb -s R58R54YV7JT forward tcp:9222 localabstract:chrome_devtools_remote
curl -s http://127.0.0.1:9222/json/version
adb -s R58R54YV7JT shell dumpsys package com.android.chrome | rg 'versionName|versionCode'
adb -s R58R54YV7JT shell getprop ro.product.model
adb -s R58R54YV7JT shell getprop ro.build.version.release
adb -s R58R54YV7JT shell wm size
adb -s R58R54YV7JT shell wm density
curl -I -s https://business.usemingla.com/home
curl -I -s https://business.usemingla.com/event/create
adb -s R58R54YV7JT logcat -c
# Node/CDP route probe: navigated each production route, waited 12s, evaluated DOM,
# captured ADB screenshots, then grepped logcat for OOM / renderer-death markers.
```

Evidence files:

- `Mingla_Artifacts/reports/orch-1087-phone-evidence/android-chrome-route-probes.json`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/android-chrome-logcat-grep.txt`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/home-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/event-create-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/hub-events-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/hub-experiences-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/hub-trips-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/ari-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/marketing-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/marketing-campaigns-compose-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/account-adb.png`
- `Mingla_Artifacts/reports/orch-1087-phone-evidence/connect-account-management-adb.png`

## Static Home Route Map

Source: `mingla-business/public/home.html`.

| Static Home location | Link target | Source lines | Meaning |
|---|---:|---:|---|
| Topbar Account | `/account` | 397 | Full Expo account route |
| Primary Create event | `/event/create` | 431 | Full Expo event create route |
| Open Hub | `#hub` | 438 | Static in-page tab, safe |
| Hub Events | `/hub/events` | 452 | Full Expo Hub route |
| Hub Experiences | `/hub/experiences` | 459 | Full Expo Hub route |
| Hub Trips | `/hub/trips` | 466 | Full Expo Hub route |
| Open Ari | `/ari` | 484 | Full Expo Ari route |
| Marketing overview | `/marketing` | 498 | Full Expo Marketing route |
| Compose blast | `/marketing/campaigns/compose` | 505 | Full Expo Composer route |
| Account settings | `/account` | 519 | Full Expo account route |
| Payout account | `/connect-account-management` | 526 | Web-only Stripe embedded management route, requires session params |

`mingla-business/vercel.json:46-49` serves `/auth/callback` and `/home` as static HTML before the SPA fallback. Everything else in the table falls through to the Expo app shell.

## Route Findings

### F-1 `/home` is launch-safe today

Classification: `PASS_NOW`.

Evidence:

- Production `/home` returned HTTP 200, `content-type: text/html`, Vercel HIT, `content-length: 17355`.
- Android Chrome route probe: `document.title = "Home | Mingla Business"`, `expoScripts = 0`, load event around 320ms.
- Screenshot shows the branded static Home shell with Home/Hub/Ari/Blast/Account tabs.

Impact: the ORCH-1085 protected signed-in landing path holds.

### F-2 `/event/create` does not reach the creator outcome

Classification: `FIX_REQUIRED` + `NEEDS_CREDENTIAL_OR_DATA`.

Evidence:

- Source `mingla-business/app/event/create.tsx:86-104` waits for auth readiness, current-brand recovery, persisted draft-store hydration, and current brand, then creates a local draft and redirects to `/event/{d_id}/edit?step=0`.
- Android Chrome production probe after 12s showed only `Finishing sign-in...`; no redirect to the edit wizard happened.
- The test phone had enough static `/home` localStorage to show `Signed in`, but the full Expo `AuthContext` route did not complete auth readiness in this probe.

Impact: the user taps `Create event` from Home and sees a spinner, not the event creator. The full authoring route still needs a known signed-in account/current-brand fixture before deeper editor parity can be proven.

### F-3 Hub route family crashes Android Chrome

Classification: `STATIC_SHELL_REQUIRED` for `/hub/events`, `/hub/experiences`, `/hub/trips`.

Evidence:

- Production screenshots for all three routes show Chrome `Aw, Snap!`.
- `android-chrome-logcat-grep.txt` contains repeated `V8 javascript OOM`, `CrRendererMain`, and `onServiceDisconnected (crash or killed by oom)` lines during the Hub route window.
- Source `app/(tabs)/hub/events.tsx:29-85` mounts share modal, lifecycle sheets, server draft/event hooks, business event hooks, list-card status, and manage actions.
- Source `app/(tabs)/hub/experiences.tsx:17-28` imports `ActivitiesSnapInput`, `MenuSnapInput`, `OfferingManageSheet`, `ShareModal`, and review/list cards. `ActivitiesSnapInput.tsx:7-9` and `MenuSnapInput.tsx:7-9` import `expo-document-picker`, `expo-file-system/legacy`, and `expo-image-picker`.

Impact: the static Home Hub tab can lure a phone-browser user into renderer death. This violates the Phase 3 bar: no static Home route should lead to an unproven crash-prone browser route.

### F-4 `/ari` has a specific web-shim crash

Classification: `FIX_REQUIRED`.

Evidence:

- Android Chrome route probe reached the app boundary: `Something broke. We're on it. Try again. Get help`.
- Console error: `TypeError: c.Easing.bezier is not a function` in `ari-*.js`.
- Source `metro.config.js:198-201` aliases web `react-native-reanimated` to `src/shims/reactNativeReanimatedWebStub.js`.
- Source `reactNativeReanimatedWebStub.js:7-14` defines `linear`, `cubic`, `in`, `out`, `inOut`, but not `bezier`.
- Source `AriOrb.tsx:21-30,56-57` imports Reanimated `Easing` and computes `const PREMIUM_EASING = Easing.bezier(...)` at module load. `AiDisclosureModal.tsx:19-24,62-67` also calls `Easing.bezier`.

Six-field root cause proof:

- File/line: `mingla-business/src/shims/reactNativeReanimatedWebStub.js:7-14`; `mingla-business/src/components/ari/AriOrb.tsx:56-57`.
- Exact code: web stub omits `Easing.bezier`; Ari calls `Easing.bezier(0.4, 0.0, 0.2, 1)`.
- Current behavior: `/ari` throws before rendering the chat screen and shows the root error boundary.
- Expected behavior: `/ari` should render Ari's empty state or an explicit phone-browser degraded contract.
- Causal chain: Metro aliases Reanimated to the shim on web, Ari imports Reanimated Easing, missing shim method throws during module evaluation, route chunk fails, ErrorBoundary renders fallback.
- Verification step: add a web regression that imports the Ari route or `AriOrb` through the web Metro alias and assert it renders without `Easing.bezier` error; production Android Chrome `/ari` should no longer show the error boundary.

### F-5 Marketing and Account routes still OOM

Classification: `STATIC_SHELL_REQUIRED` for `/marketing`, `/marketing/campaigns/compose`, `/account`.

Evidence:

- Production screenshots show Chrome `Aw, Snap!` for account and the marketing family.
- Logcat shows repeated route-window `V8 javascript OOM` + `CrRendererMain` crashes.
- Source `marketing/index.tsx:36-45` enters authenticated marketing overview data hooks.
- Source `marketing/campaigns/compose.tsx:36-111` imports modal/keyboard handling, SmartScrollView, composer header/footer, audience picker, review sheet, sent confirmation, `ComposerV2Editor`, schedule sheet, marketing service calls, template hooks, and web keyboard shortcuts.
- Source `SchedulePickerSheet.tsx:16-18` imports `@react-native-community/datetimepicker` with no static phone-browser shell.
- Source `richEditor.tsx:57-64` imports Tiptap web editor packages.
- Source `account.tsx:21-52` imports brand deletion/switcher sheets, UniversalCreatorSheet, auth, partner status, partner links, and brand-list state.

Impact: these routes cannot be launch-approved as full phone-browser routes. Composer also has known source hazards after the page becomes reachable.

### F-6 `/connect-account-management` renders, but the static Home handoff is wrong

Classification: `NEEDS_CREDENTIAL_OR_DATA` + `STATIC_SHELL_REQUIRED` from static Home.

Evidence:

- Production Android Chrome renders `Invalid management link` and says the link is missing a required parameter.
- Source `connect-account-management.web.tsx:19-30` lazy-loads Stripe Connect body; the route is web-only and expects session/query context.
- Static Home links directly to `/connect-account-management` at `public/home.html:526`, with no `session`, `account_id`, or generated account-session payload.

Impact: this is not a crash, but it is a dead user journey from the static Account tab. The phone shell should either show explicit unsupported/degraded copy or route to a server-generated/session-backed action after the account flow is proven.

## Non-Causes Eliminated

- Not a Vercel 404 for these routes: `curl -I` on `/event/create` returns HTTP 200 and the Expo shell.
- Not a missing static `/home` deploy: production `/home` is current and renders with zero Expo scripts.
- Not only a network/chunk 404: the probe did not capture network 404s; Chrome renderer OOM lines explain the `Aw, Snap` routes.
- Not a provider-copy regression in static Home: `Payout account` copy is already neutral per COMMS-0021.

## Honest Non-Evidence

- Mobile Safari was not available in this environment. Safari must remain a manual gate.
- The Android probe did not complete authenticated end-to-end business actions because the full Expo auth/session path did not prove a fresh usable account/current-brand fixture on `/event/create`.
- Back/refresh/re-entry was not exhaustively proven for every deep route. Direct re-entry was tested for every listed route; crash routes need no further back/refresh proof before being classified unsafe.
- The OOM route windows were mapped by route order and timestamps, not by a browser-provided per-route crash ID.

## Affected Surfaces

Touched/in scope:

- Business Web production / preview on phone browsers.
- Signed-in static Home and every Home tab/action that hands off into full Expo/RN web.

Explicitly not in scope:

- Business iOS native app.
- Business Android native app.
- Consumer iOS/Android.
- Admin Web.
- Backend schema/data repair.
- Product-code implementation, deploy, OTA, merge, or worktree reap.

## Readiness Conclusion

`/home` passes, but the full route gate does not. The launch-safe path is to stop static Home from sending phone-browser users into known crashing RN-web routes until each family has either a proven lightweight shell, a fixed web implementation, or launch-approved unsupported copy.
