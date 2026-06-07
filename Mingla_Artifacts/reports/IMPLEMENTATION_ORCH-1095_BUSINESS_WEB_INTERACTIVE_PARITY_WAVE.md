# Implementation - ORCH-1095 Business Web Interactive Parity Wave

Date: 2026-06-07

Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]`

Branch: `ORCH-1095-business-web-interactive-parity-wave`

Status: implemented and verified

## REWORK - Android Chrome OOM Fix

### Failing Evidence That Drove Rework

The first implementation promoted `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account` from signed-in static Home redirects to interactive Expo routes. That was not enough: physical Samsung A72 Chrome at `http://127.0.0.1:4175/hub/events` still rendered blank, and logcat showed `V8 javascript OOM (Ineffective mark-compacts near heap limit)`, then `SIGSEGV`, `CrRendererMain`, and a Chrome sandbox renderer crash around 2026-06-07 10:02. DevTools could connect to the tab but `Runtime.enable` / `Runtime.evaluate` timed out because the renderer was wedged.

Read-only bundle evidence explained why route promotion failed: the route chunks were small, but `__common-b67ad3b25f9b0b99f672555814dbe8fb.js` stayed 1,882,297 bytes raw and the root layout statically imported signed-in boot services/hooks including `AuthProvider`, `useCurrentBrandRecovery`, `useBrand`, push/notification routing, AppsFlyer, Mixpanel, RevenueCat, OneSignal wrappers, and Stripe mode handshake. The real blocker was the shared signed-in mobile boot path, not the five route chunks.

### Rework Architecture

The injected mobile preboot now has a deterministic ORCH-1095 lightweight route entry for the five target signed-in phone routes. On Android/iOS phone browsers, before any Expo script is appended, the loader checks the route and Supabase web session; for `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account`, it renders a real lightweight business surface and returns without loading Expo root/common JS.

The lightweight entry keeps the real URL and uses the existing public Supabase URL/anon key plus the stored user access token to fetch route-specific state:

- `/hub/events`: current brand, event list from `business_management_events_view`, trip exclusion probe from `events`, empty state, and "Build a new event" action.
- `/hub/trips`: current brand, trip rows from `events` where `event_type='trip'`, empty state, and "Open trip tools" action back to stable Home.
- `/marketing`: 30-day campaign count and recent campaigns from `marketing_campaigns`, plus "New campaign".
- `/marketing/campaigns/compose`: subject/body fields and a return-to-Marketing action.
- `/account`: signed-in email, current brand, and owned brand list from `brands`.

Signed-out target routes still render bounded recovery at the same URL. `/home` remains static/fast, `/`, `/auth`, and `/auth/callback` still render auth/welcome normally, and `/hub/experiences`, `/ari`, and `/connect-account-management` remain blocked.

Final orchestrator retry tightened the lightweight shell so it does not create new unpromoted direct-entry taps. Rows/actions that would have pointed to non-promoted direct URLs such as `/trip/create`, `/brand/<id>`, campaign details, event edit, or account edit now route to stable Home anchors, while the already-promoted `/event/create` entry remains available.

### Changed Files In Rework

| File | Rework purpose |
|---|---|
| `mingla-business/scripts/inject-mobile-blur-css.mjs` | Added the pre-Expo lightweight route entry and Supabase-backed route-specific rendering for the five target routes. |
| `mingla-business/scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs` | Added assertions that the export/source contain the lightweight route-entry marker, pre-Expo return path, current-brand lookup, route-specific Supabase data sources, and no new unpromoted direct-entry taps. |
| `mingla-business/src/utils/__tests__/orch_1095_business_web_interactive_parity_wave.test.ts` | Added Jest coverage proving target phone routes use lightweight signed-in entry before Expo boot and keep unpromoted deeper links on stable anchors. |
| `Mingla_Artifacts/reports/evidence/orch-1095-rework/*` | Added physical Android screenshots and logcat evidence. |

### Old-To-New Receipts

Before rework:

- Target routes were marked `interactive`, but Android Chrome still loaded the full Expo root/common signed-in boot.
- `/hub/events` stayed blank on physical Samsung A72 and crashed the renderer after roughly 15 seconds.
- Automated guards proved route chunks were small but did not prevent the heavy signed-in boot from loading.

After rework:

- Target routes still stay on their real URLs and no longer redirect to `/home#...`.
- Phone browsers render `data-orch-1095-light-route-entry="true"` and return before `loadAt(0)` appends Expo scripts for the five target routes.
- Signed-in Android Chrome renders real brand/campaign/route state without loading the OOM-causing Expo boot.

### Physical Android Evidence

Device: Samsung Galaxy A72 `R58R54YV7JT`

Server: `http://127.0.0.1:4175` via `adb reverse tcp:4175 tcp:4175`

Route wave:

| Route | Result | Evidence |
|---|---|---|
| `/hub/events` | Rendered signed-in "Hub Events" with `Nigerian Brand Test` and empty event state. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-hub-events.png` |
| `/hub/trips` | Rendered signed-in "Hub Trips" with `Nigerian Brand Test` and empty trip state. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-hub-trips.png` |
| `/marketing` | Rendered signed-in Marketing with 13 campaigns sent and recent campaign rows. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-marketing.png` |
| `/marketing/campaigns/compose` | Rendered signed-in Compose blast with subject/body fields. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-marketing-compose.png` |
| `/account` | Rendered signed-in Account settings with Seth email and real brand list. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-account.png` |
| `/hub/events` final retry | Rendered on rebuilt export after 12s. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-final-hub-events.png` |
| `/hub/trips` final retry | Rendered "Open trip tools" tightened action on rebuilt export after 12s. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-final-hub-trips.png` |
| `/marketing` final retry | Rendered on rebuilt export after 12s. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-final-marketing.png` |
| `/marketing/campaigns/compose` final retry | Rendered "Return to marketing" tightened action on rebuilt export after 12s. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-final-marketing-compose.png` |
| `/account` final retry | Rendered on rebuilt export after 12s. | `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-final-account.png` |

Logcat evidence file: `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-route-wave-logcat.txt`
Final retry OOM-only logcat file: `Mingla_Artifacts/reports/evidence/orch-1095-rework/android-final-logcat-oom-only.txt`

Forbidden-signature grep after the full route wave:

```text
V8 javascript OOM=0
Ineffective mark-compacts=0
SIGSEGV=0
CrRendererMain=0
Aw, Snap=0
fatal exception=0
Render process=0
```

### Rework Verification Commands

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs
```

Result: PASS; export succeeded and injector reported `[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.`

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && npm run test:orch-1095
```

Result: PASS. The chain passed ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, ORCH-1093, ORCH-1094, and ORCH-1095 checks. ORCH-1095 now includes seven Jest tests, including the lightweight signed-in route-entry regression and the unpromoted direct-entry tap guard.

## Outcome

The signed-in phone-browser preboot contract now distinguishes `interactive`, `static-section`, and `blocked` route behavior. The five ORCH-1095 target routes are `interactive` in both the root layout and injected preboot loader, so they no longer use the old signed-in `/home#...` static-section redirect. Static `/home` remains Expo-free and still acts as the post-auth launcher/fallback, while `/hub/experiences`, `/ari`, and `/connect-account-management` remain blocked/protected.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` first. Factored active ALL warnings, especially no deploy/merge/reap/OTA from an ORCH worktree, preserve provider-neutral payout copy, do not approve Hub Experiences/Ari/sessionless payout account management, and release/deploy only from merged main. I did not edit the anchor ledger because this dispatch explicitly forbids anchor edits.

## Changed Files

| File | Purpose |
|---|---|
| `mingla-business/app/_layout.tsx` | Changed the mobile route status model from `approved` to `interactive` with fail-closed `static-section` default; kept signed-out recovery for the target routes and blocked recovery for non-goals. |
| `mingla-business/scripts/inject-mobile-blur-css.mjs` | Removed signed-in phone `/home#...` preboot redirects for ORCH-1095 targets; preserved ORCH-1091/1093 recovery markers and blocked-route recovery. |
| `mingla-business/public/home.html` | Added `data-orch-1095-interactive-route` receipts to the five target links while keeping Experiences/Ari/Payout as shells. |
| `mingla-business/scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs` | New CI guard for route map agreement, static Home markers, no static-section redirect for targets, blocked non-goals, provider-neutral copy, export markers, route chunk budgets, and forbidden native/provider modules. |
| `mingla-business/src/utils/__tests__/orch_1095_business_web_interactive_parity_wave.test.ts` | New Jest guard for the same source-level contract and post-auth redirect scoping. |
| `mingla-business/package.json` | Added `test:orch-1095`, chained after `test:orch-1094`. |
| `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs` | Updated older guard wording/check from `approved` to `interactive` so the regression chain matches the new route model. |
| `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs` | Updated OOM guard route statuses and source assertions to `interactive`. |
| `mingla-business/scripts/ci/orch-1094-business-web-core-parity-wave.mjs` | Updated core parity guard to preserve old safety checks without requiring the old static redirect. |

## Old-To-New Receipts

Before:

- Injector map labeled `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account` as `approved`.
- The same injector redirected signed-in phone users for those routes to `/home#hub`, `/home#marketing`, `/home#compose-blast`, or `/home#account`.
- Existing ORCH-1094 guard could pass while users only got static Home sections.

After:

- Root and injector maps label those five routes as `interactive`.
- Injector no longer contains `location.replace("/home#"+target)`.
- Unknown phone-browser routes default to `static-section`, and explicitly unsafe routes remain `blocked`.
- Static Home links carry ORCH-1095 interactive receipts.

## Bundle Evidence

Fresh export command:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs
```

Output summary:

- Export succeeded.
- Injector output: `[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.`
- Sentry warning only: missing Sentry org/project config, environment fallback.

`node scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs` after export:

```text
ORCH-1095 bundle evidence phoneBoot=2885080; deferred=true
ORCH-1095 route chunk /hub/events events-539a600e4d9dbe46e145238db5723687.js 18954
ORCH-1095 route chunk /hub/trips trips-16ecc294365aad13f1001aa0c491ddda.js 12661
ORCH-1095 route chunk /marketing index-140ddfb8fd743bc1ed14962475948c9c.js 11952
ORCH-1095 route chunk /marketing/campaigns/compose compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
ORCH-1095 route chunk /account account-4d3134140304fd405f5982d94f4524f1.js 9055
ORCH-1095 business web interactive parity guard PASS
```

Notes:

- All target route chunks are under the ORCH-1095 budgets.
- Phone boot remains above the older raw boot budget at 2,885,080 bytes, with `__common=1,882,297` reported by the ORCH-1093 guard. The REWORK fix avoids that boot entirely for the five target signed-in phone routes by rendering the lightweight route entry before Expo scripts are appended.

## Verification

Installed local dependencies in this ORCH worktree only:

```text
npm install
added 1226 packages, audited 1227 packages
24 vulnerabilities (23 moderate, 1 high)
```

Focused source/export guard:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && node scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs
```

Result: PASS with bundle evidence above.

Focused Jest guard:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && npx jest src/utils/__tests__/orch_1095_business_web_interactive_parity_wave.test.ts --runInBand
```

Result:

```text
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
```

Full chained ORCH regression:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && npm run test:orch-1095
```

Result: PASS. The chain passed ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, ORCH-1093, ORCH-1094, and ORCH-1095 checks. Export-aware output included:

```text
ORCH-1093 bundle budgets PASS. phoneBoot=2885080; __common=1882297; deferred=true; interactive=/hub/trips,/hub/events,/marketing,/marketing/campaigns/compose,/account,/event/create
ORCH-1094 business web core parity PASS.
ORCH-1095 business web interactive parity guard PASS
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
```

Typecheck:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && npx tsc --noEmit
```

Result: FAIL on pre-existing/shared repo-wide errors after the ORCH-1095 local narrowing issue was fixed. First errors were in checkout buyer files, Composer rich editor typings, native cover picker/file helpers, `@mingla/payments-native` resolution, old `DraftEvent.category` test fixtures, and shared packages. No remaining `app/_layout.tsx` ORCH-1095 type error appears.

Local exported route smoke:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]/mingla-business" && npx serve -s dist -l 4175
```

Playwright mobile signed-out route check against `http://127.0.0.1:4175`:

```text
/hub/events -> /hub/events :: MINGLA BUSINESS Sign in to open Hub Events. This phone-browser route is ready, but it needs a business session before it can load your brand data. Return to Home
/hub/trips -> /hub/trips :: MINGLA BUSINESS Sign in to open Hub Trips. This phone-browser route is ready, but it needs a business session before it can load your brand data. Return to Home
/marketing -> /marketing :: MINGLA BUSINESS Sign in to open Marketing overview. This phone-browser route is ready, but it needs a business session before it can load your brand data. Return to Home
/marketing/campaigns/compose -> /marketing/campaigns/compose :: MINGLA BUSINESS Sign in to open Compose blast. This phone-browser route is ready, but it needs a business session before it can load your brand data. Return to Home
/account -> /account :: MINGLA BUSINESS Sign in to open Account settings. This phone-browser route is ready, but it needs a business session before it can load your brand data. Return to Home
```

Blocked-route check:

```text
/hub/experiences -> /hub/experiences :: MINGLA BUSINESS This route is staying protected. This phone-browser route is not ready for direct entry yet, so Mingla is sending you back to the stable Home
/ari -> /ari :: MINGLA BUSINESS This route is staying protected. This phone-browser route is not ready for direct entry yet, so Mingla is sending you back to the stable Home
/connect-account-management -> /connect-account-management :: MINGLA BUSINESS This route is staying protected. This phone-browser route is not ready for direct entry yet, so Mingla is sending you back to the stable Home
```

I also tried a fake localStorage Supabase token. It proved the target URLs do not preboot-redirect to `/home#...`, but it is not valid signed-in interaction evidence because real route data requires a usable Supabase session and current-brand state.

## Physical Device Gates

Completed for this rework:

1. Physical Android Chrome signed-in smoke for all five target routes.
2. Android logcat check for `V8 javascript OOM`, `Ineffective mark-compacts`, `SIGSEGV`, `CrRendererMain`, `Aw, Snap`, `fatal exception`, and `Render process`.
3. Real signed-in account validation for current-brand/data terminal states:
   - Hub Events rendered current brand and empty event state.
   - Hub Trips rendered current brand and empty trip state.
   - Marketing rendered real campaign count and recent campaign rows.
   - Compose rendered subject/body fields.
   - Account rendered Seth email and real brand list.

Remaining optional cross-browser gate for tester/orchestrator: physical iPhone Safari signed-in smoke for the same five routes. The implementation path is phone-browser generic and not Android-specific, but I did not have an iPhone attached in this run.

## Cross-Surface Matrix

| Surface | Status |
|---|---|
| Business Web phone browsers | Touched; primary implementation and automated guards. |
| Business Web desktop | Should keep normal behavior; preboot phone checks are gated by phone detection. Desktop manual sanity still recommended. |
| Consumer iOS | Not in scope; no shared consumer files changed. |
| Consumer Android | Not in scope; no shared consumer files changed. |
| Buyer/anonymous Web | Not in scope; no buyer/public route behavior intentionally changed. |
| Business iOS native | Not in scope; route status/preboot changes are web/phone-browser behavior. |
| Business Android native | Not in scope; route status/preboot changes are web/phone-browser behavior. |
| Admin Web | Not in scope. |

## Non-Goals Preserved

- No backend, provider, Supabase, migration, RLS, RPC, edge function, deploy, merge, OTA, branch reap, or release action.
- Hub Experiences, Ari, and sessionless `/connect-account-management` remain blocked/protected.
- Static `/home` remains Expo-free and keeps shell panels.
- Post-auth `/`, `/auth`, and `/auth/callback` still route mobile web users to `/home`.
- Provider-neutral payout copy remains intact; no `Connect Stripe`, `Payments & Stripe`, or `Stripe account` regression in touched seller-facing surfaces.

## Downstream Recommendation

Route this to independent tester for independent QA. Android Chrome, the failure device/browser, now has signed-in physical no-OOM proof for all five target routes; tester should spot-check the same evidence and optionally add iPhone Safari confirmation before close.
