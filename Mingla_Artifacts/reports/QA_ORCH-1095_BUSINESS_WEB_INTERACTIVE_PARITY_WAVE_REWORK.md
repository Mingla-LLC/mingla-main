# QA - ORCH-1095 Business Web Interactive Parity Wave Rework

Date: 2026-06-07

Tester: tester+codex

Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]`

Branch: `ORCH-1095-business-web-interactive-parity-wave`

## Verdict

PASS.

No P0/P1/P2 findings. ORCH-1095 rework is verified for the requested business-web phone-browser scope: the five signed-in Android Chrome routes render at real URLs through the lightweight route entry, avoid the OOM-causing Expo boot path, keep `/home` static, keep `/hub/experiences`, `/ari`, and `/connect-account-management` blocked, and guard against newly-promoted direct-entry taps.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before QA. Factored active ALL/ORCH-1095 warnings: no deploy/merge/OTA/reap, no anchor edits, preserve provider-neutral payout copy, preserve ORCH-1091/1092/1093/1094 route protections, keep Hub Experiences/Ari/sessionless payout account management blocked, and release/deploy only from merged main. I did not append an ack to the anchor ledger because this QA dispatch explicitly forbade anchor edits.

## Findings

None.

Residual notes:

- iPhone Safari was not requested in this rework QA and no iPhone was attached. The implementation report lists it as optional downstream confirmation.
- I did not deploy, merge, OTA, reap, weaken tests, or edit the anchor checkout.

## Claim Verification Table

| Claim | Verdict | Evidence |
|---|---:|---|
| `npm run test:orch-1095` passes. | Verified | Command passed locally from `mingla-business`; output showed ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, ORCH-1093, ORCH-1094, ORCH-1095 guards PASS and ORCH-1095 Jest `7 passed`. |
| Fresh export contains the lightweight pre-Expo route entry. | Verified | `rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && node scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs` passed; output included `data-orch-1095-light-route-entry="true"`, `phoneBoot=2885080; deferred=true`, and ORCH-1095 route chunks under budget. |
| Five target signed-in Android Chrome routes render at real URLs. | Verified | Physical Samsung A72 `R58R54YV7JT` via `adb reverse tcp:4175 tcp:4175` against `http://127.0.0.1:4175`: rebuilt evidence XML/screenshots under `Mingla_Artifacts/reports/evidence/orch-1095-qa-rebuilt/`. `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account` all retained real URL text in the Chrome address bar and rendered signed-in route content. |
| Five target routes do not load the OOM-causing Expo boot on phone browsers. | Verified | Source/export guard verifies `status==="interactive"&&isLightRoute(path)`, `renderRoute(path,session);return`, and no `location.replace("/home#"+target)`. Signed-out Playwright mobile proof showed target routes with `light=1` and `expoScripts=0`. Android current logcat forbidden-signature file after rebuilt sweep had `0` matching lines. |
| `/home` remains static. | Verified | Source guard rejects Expo/static script tokens in `public/home.html`; Playwright mobile proof showed `/home` with `expoScripts=0`; Android rebuilt `home.xml` rendered static Home content at `127.0.0.1:4175/home`. |
| `/hub/experiences`, `/ari`, and `/connect-account-management` remain blocked. | Verified | Source route maps set all three to `"blocked"` in `app/_layout.tsx` and injector; `public/home.html` has shell anchors instead of direct `href`s. Android rebuilt XML for all three shows "This route is staying protected" at the real URL. |
| Final guard prevents unpromoted direct-entry taps. | Verified | CI/Jest guard rejects direct links for `/account/edit-profile`, `/brand/` dynamic entries, campaign details, trip detail/create, event edit, and "Save draft in full composer"; the lightweight renderer routes account/event/trip row actions back to stable Home anchors except promoted `/event/create`. |

## Source Evidence

- `mingla-business/app/_layout.tsx:124` maps `/`, `/auth`, `/auth/callback`, `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, `/event/create`, and `/hub/trips` to `"interactive"`; maps `/hub/experiences`, `/ari`, and `/connect-account-management` to `"blocked"`; defaults unknown routes to `"static-section"`.
- `mingla-business/app/_layout.tsx:387` only renders mobile route recovery when route status is not `"interactive"`.
- `mingla-business/scripts/inject-mobile-blur-css.mjs:35` builds the route deferral loader. It sets the same route statuses, renders `data-orch-1095-light-route-entry="true"` for light routes, checks Supabase web session, fetches route-specific data, returns before `loadAt(0)`, and preserves blocked/static recovery.
- `mingla-business/public/home.html:482`, `:496`, `:528`, `:535`, and `:549` mark the five promoted Home links with `data-orch-1095-interactive-route`.
- `mingla-business/public/home.html:489`, `:514`, and `:556` keep Experiences, Ari, and payout account as shell links.
- `mingla-business/src/utils/__tests__/orch_1095_business_web_interactive_parity_wave.test.ts:34` covers static Home markers, route-map parity, no signed-in static redirect, lightweight pre-Expo entry, no unpromoted direct-entry taps, post-auth redirect scoping, browser composer, and provider-neutral seller copy.
- `mingla-business/package.json:59` chains `test:orch-1095` after ORCH-1094 and then runs the ORCH-1095 CI guard plus Jest regression.

## Commands Run

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && npm run test:orch-1095
```

Result: PASS. Key output:

```text
ORCH-1093 bundle budgets PASS. phoneBoot=2885080; __common=1882297; deferred=true; interactive=/hub/trips,/hub/events,/marketing,/marketing/campaigns/compose,/account,/event/create
ORCH-1094 business web core parity PASS.
ORCH-1095 business web interactive parity guard PASS
Test Suites: 1 passed, 1 total
Tests: 7 passed, 7 total
```

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && node scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs
```

Result: PASS. Key output:

```text
Exported: dist
[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.
ORCH-1095 bundle evidence phoneBoot=2885080; deferred=true
ORCH-1095 route chunk /hub/events events-539a600e4d9dbe46e145238db5723687.js 18954
ORCH-1095 route chunk /hub/trips trips-16ecc294365aad13f1001aa0c491ddda.js 12661
ORCH-1095 route chunk /marketing index-140ddfb8fd743bc1ed14962475948c9c.js 11952
ORCH-1095 route chunk /marketing/campaigns/compose compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
ORCH-1095 route chunk /account account-4d3134140304fd405f5982d94f4524f1.js 9055
ORCH-1095 business web interactive parity guard PASS
```

```bash
node - <<'NODE'
const { chromium, devices } = require('playwright');
...
NODE
```

Result: PASS for unsigned mobile browser behavior. Key output:

```text
/hub/events -> http://127.0.0.1:4175/hub/events light=1 expoScripts=0 :: Mingla Business Home Sign in to open Hub Events...
/hub/trips -> http://127.0.0.1:4175/hub/trips light=1 expoScripts=0 :: Mingla Business Home Sign in to open Hub Trips...
/marketing -> http://127.0.0.1:4175/marketing light=1 expoScripts=0 :: Mingla Business Home Sign in to open Marketing overview...
/marketing/campaigns/compose -> http://127.0.0.1:4175/marketing/campaigns/compose light=1 expoScripts=0 :: Mingla Business Home Sign in to open Compose blast...
/account -> http://127.0.0.1:4175/account light=1 expoScripts=0 :: Mingla Business Home Sign in to open Account settings...
/home -> http://127.0.0.1:4175/home light=0 expoScripts=0 :: Mingla Business Signed out Account BUSINESS HOME...
/hub/experiences -> http://127.0.0.1:4175/hub/experiences light=1 expoScripts=0 :: Mingla Business Home This route is staying protected...
/ari -> http://127.0.0.1:4175/ari light=1 expoScripts=0 :: Mingla Business Home This route is staying protected...
/connect-account-management -> http://127.0.0.1:4175/connect-account-management light=1 expoScripts=0 :: Mingla Business Home This route is staying protected...
```

```bash
adb -s R58R54YV7JT logcat -d | rg -i 'V8 javascript OOM|Ineffective mark-compacts|SIGSEGV|CrRendererMain|Aw, Snap|fatal exception|Render process'
```

Result after rebuilt Android route sweep: 0 lines. Evidence file:

```text
Mingla_Artifacts/reports/evidence/orch-1095-qa-rebuilt/android-qa-forbidden-logcat-current-buffer.txt
```

## Runtime Evidence

Local server used: existing scoped ORCH server at `http://127.0.0.1:4175`, PID 81736, cwd `.../ORCH-1095-[business-web-interactive-parity-wave]/mingla-business`. I did not kill or replace it. `adb reverse --list` showed `tcp:4175 tcp:4175`.

Physical device used: Samsung Galaxy A72 `R58R54YV7JT`.

Rebuilt Android route evidence folder: `Mingla_Artifacts/reports/evidence/orch-1095-qa-rebuilt/`.

| Route | Runtime result |
|---|---|
| `/hub/events` | Android Chrome rendered `Hub Events`, `Nigerian Brand Test`, `Build a new event`, and empty event state at `127.0.0.1:4175/hub/events`. |
| `/hub/trips` | Android Chrome rendered `Hub Trips`, `Nigerian Brand Test`, `Open trip tools`, and empty trip state at `127.0.0.1:4175/hub/trips`. |
| `/marketing` | Android Chrome rendered `Marketing`, `Campaigns sent in the last 30 days`, `13`, `New campaign`, and recent campaign rows at `127.0.0.1:4175/marketing`. |
| `/marketing/campaigns/compose` | Android Chrome rendered `Compose blast`, `Subject`, `Message`, and `Return to marketing` at `127.0.0.1:4175/marketing/campaigns/compose`. |
| `/account` | Android Chrome rendered `Account settings`, `Signed in as sethogieva@gmail.com`, `Nigerian Brand Test`, and owned brand rows at `127.0.0.1:4175/account`. |
| `/home` | Android Chrome rendered static Home content at `127.0.0.1:4175/home`. |
| `/hub/experiences` | Android Chrome rendered blocked-route recovery at `127.0.0.1:4175/hub/experiences`. |
| `/ari` | Android Chrome rendered blocked-route recovery at `127.0.0.1:4175/ari`. |
| `/connect-account-management` | Android Chrome rendered blocked-route recovery at `127.0.0.1:4175/connect-account-management`. |

## Platform Matrix

| Surface | Status | Evidence |
|---|---:|---|
| Business web - Android Chrome signed-in | PASS | Physical Samsung A72 screenshots/XML for all target routes after fresh export rebuild; no forbidden OOM/crash signatures in current logcat buffer. |
| Business web - unsigned mobile browser | PASS | Playwright Pixel 5 context shows target routes keep real URLs, render lightweight signed-out recovery, and have `expoScripts=0`; blocked routes remain blocked. |
| Business web - static Home | PASS | Source guard plus Playwright/Android runtime show `/home` has no Expo script load and renders the static launcher. |
| Business web - blocked non-goals | PASS | Source route maps, Home shell links, and Android runtime prove `/hub/experiences`, `/ari`, and `/connect-account-management` remain blocked. |
| Business native iOS/Android | N/A | Web-only phone-browser route/export change; no native app files or native release path touched. |
| Consumer app / admin web / backend | N/A | No shared consumer/admin/backend/Supabase/provider files changed. |

## Regression Coverage Assessment

PASS. The regression coverage is repo-running and part of the scoped working tree:

- `npm run test:orch-1095` chains prior business-web guards and then runs the ORCH-1095 export/source guard plus Jest.
- `scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs` would fail if the five target routes lost interactive status, if Home regained Expo scripts, if blocked routes were promoted, if the injector reintroduced the old `/home#...` signed-in redirect, if the lightweight entry marker/return path disappeared, if target chunks exceeded budget, or if forbidden native/provider modules entered boot/route chunks.
- `src/utils/__tests__/orch_1095_business_web_interactive_parity_wave.test.ts` would fail on the same source-level contracts, including the final guard against unpromoted direct-entry taps.

Fail-on-revert proof was not performed because tester mode does not mutate product code or weaken/rewrite tests. The guard contents directly encode the old failure class: signed-in target routes using static Home redirects or full Expo boot instead of the pre-Expo lightweight route.

## Downstream Routing

Return to Codex orchestrator for ORCH-1095 close review. Recommended next step: orchestrator may use this PASS as QA evidence, then handle PR/merge/closeout through the normal route. Do not deploy, OTA, merge from the worktree, or reap before main/PR lifecycle checks.
