# QA - ORCH-1088 Business Web Event Creator Phone-Browser Parity

Date: 2026-06-06
Tester: tester+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1088-[business-web-event-creator-parity]`
Branch: `ORCH-1088-business-web-event-creator-parity`
Head verified: `2f9a25f78384d13bba8e70e521b6416f2a59e6ad`

## Verdict

PASS for the scoped ORCH-1088 safety/parity slice.

This branch proves the current contract: static Home's Create action remains shelled, `/event/create` no-session phone-browser entry reaches terminal recovery UI instead of an endless `Finishing sign-in...` state or crash, provider-neutral seller copy remains intact, and the Ari/Reanimated plus draggable-flatlist web shim blockers are covered by automated and runtime evidence.

This is not a PASS for reopening static Home Create or for full signed-in wizard parity. Static Home correctly stays closed until a later signed-in Android Chrome and Safari Step 1-7 wizard pass authorizes a separate reopen commit.

## Severity-Ranked Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

None blocking this scoped slice.

### P3 Low

1. Regression coverage is intentionally source-contract heavy rather than component-state exhaustive.
   Evidence: `src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts` reads source files and verifies required tokens plus callable shim exports. It would catch removal of `Easing.bezier`, `runOnUI`, the static Home shell markers, provider-neutral publish copy, and `/event/create` terminal-state source branches. It would not, by itself, fully simulate every AuthContext/current-brand/draft-hydration timing transition. The Playwright mobile-browser no-session runtime probe covers the active unbounded-spinner class for the current scope.

2. Physical Samsung A72 runtime proof could not be repeated in this session.
   Evidence: `adb devices` started the daemon successfully but returned no attached devices. Per the dispatch fallback, I used a Playwright Pixel 5/Chrome-shaped mobile browser probe against the local exported 8088 surface.

### P4 Notes

1. `/event/[id]/edit` direct no-session missing-draft entry was also sanity-probed and reaches bounded recovery after the 6s timeout.
   Evidence: Playwright probe of `/event/d_missing_orch1088/edit?step=0&orch1088nosession=qa` rendered `We could not load this draft.` and logged `[event/edit] missing-draft-timeout`.

2. Static Home runtime serving note: `npx serve dist -l 8088 --single` is appropriate for Expo SPA route fallback, but it did not serve `/home.html` content in this local setup. Static Home click behavior was verified from the exported `dist/home.html` file directly and source/CI guards also covered it.

## Claim Table

| Claim | Status | Evidence |
|---|---:|---|
| Static Home Create remains shelled and is not reopened to `/event/create`. | Verified | `public/home.html` has `href="#create-event"` and `data-shell-link="create-event"`; source check found no direct `/event/create` link; exported file click stayed static and showed event-creator shell copy. |
| Unsafe Home links stay blocked. | Verified | Source check found no direct `href` for `/hub/events`, `/hub/experiences`, `/hub/trips`, `/ari`, `/marketing`, `/marketing/campaigns/compose`, `/account`, or `/connect-account-management`; ORCH-1087 guard passed through `npm run test:orch-1088`. |
| `/event/create?orch1088nosession=1` or equivalent renders terminal recovery UI. | Verified | Playwright Pixel 5 probe of `http://127.0.0.1:8088/event/create?orch1088nosession=qa` rendered `Sign in to create an event.`, `Your browser session is not available on this route.`, `Sign in again`, and `Back to Home`. |
| `/event/create` no-session route is not an endless `Finishing sign-in...`. | Verified | Same Playwright result: `hasStuckFinishing=false`; body did not contain a spinner-only state after 7s. |
| `/event/create` no-session route does not show `Something went wrong`. | Verified | Same Playwright result: `hasSomethingWrong=false`; `pageerror` array was empty. |
| Ari `Easing.bezier` and draggable-flatlist `runOnUI` web errors are resolved for this route. | Verified | Runtime probe collected no page errors and no console/page matches for `Easing.bezier` or `runOnUI`; `src/shims/reactNativeReanimatedWebStub.js` exports `Easing.bezier` and `runOnUI`; `metro.config.js` aliases `react-native-reanimated` to that shim only for `platform === "web"`. |
| Phone-web cover upload degradation is honest. | Verified | `CoverPicker.tsx` disables image/video buttons when `isPhoneWeb`, shows copy that device uploads are desktop/app-only for now, and leaves GIF/stock tabs plus color cover preview paths reachable. |
| GIF, stock, and color cover paths remain reachable in source. | Verified | `CoverPicker.tsx` retains `TAB_DEFS` for `gif` and `stock`, `searchGiphyEventCovers`, `searchPexelsEventCovers`, provider grids, and `EventCoverMedia` hue fallback. |
| Provider-neutral seller copy remains intact. | Verified | `public/home.html` has `Payout account`; `StripeBlockedCard.tsx` defaults to `Connect bank`; `EventCreatorWizard.tsx` contains `Connect a bank to publish paid tickets.`; source check found no `Stripe account` in static Home. |
| Exported web bundle builds after the shim changes. | Verified | `npx expo export -p web` completed; output included `create-*.js` and `edit-*.js`; `node scripts/inject-mobile-blur-css.mjs` completed. |
| Automated ORCH gate passes before and after export. | Verified | Both required `npm run test:orch-1088` runs passed. |

## Platform Matrix

| Platform | Result | Evidence |
|---|---:|---|
| Business Web, desktop build/export | PASS | `npx expo export -p web` completed and wrote `dist`; post-export ORCH-1088 guard passed. |
| Business Web, mobile browser equivalent | PASS | Playwright Chromium with Pixel 5 profile against local 8088 verified terminal no-session recovery and no route-level JS errors. |
| Physical Android Chrome, Samsung A72 `R58R54YV7JT` | N/A with fallback | `adb devices` returned no devices in this session. No physical-device control was available, so Playwright mobile-browser equivalent was used per dispatch. |
| iOS Safari | N/A for this scoped branch | This branch did not reopen Create or claim full signed-in wizard parity; no iOS runtime leg was required for the no-session safety slice once the Android physical device was unavailable and Playwright covered browser runtime. Later reopen work still needs Safari proof. |
| Business native iOS/Android | N/A | Metro alias is web-only; no native app behavior changed. |
| Backend/schema/provider surfaces | N/A | No migration, RLS, edge function, Stripe, Paystack, Mapbox, Cloudinary, Giphy, or Pexels payload change was made. |

## Commands And Runtime Evidence

### Required Gate 1

Command:

```bash
cd mingla-business && npm run test:orch-1088
```

Result excerpt:

```text
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
PASS src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts
Tests: 8 passed, 8 total
```

### Required Gate 2

Command:

```bash
cd mingla-business && npx expo export -p web && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1088
```

Result excerpt:

```text
Web Bundled 10690ms index.js (2165 modules)
Exported: dist
[mobile-blur-fix] injected mobile preboot + blur-kill into dist/index.html <head>.
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
PASS src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts
Tests: 8 passed, 8 total
```

### Local Runtime Server

Command:

```bash
cd mingla-business && npx serve dist -l 8088 --single
```

Result:

```text
INFO  Accepting connections at http://localhost:8088
```

### `/event/create` Mobile-Browser Runtime Probe

URL:

```text
http://127.0.0.1:8088/event/create?orch1088nosession=qa
```

Result:

```json
{
  "url": "http://127.0.0.1:8088/event/create?orch1088nosession=qa",
  "title": "Business",
  "body": "Sign in to create an event.\nYour browser session is not available on this route.\nSign in again\nBack to Home",
  "hasSignInTerminal": true,
  "hasStuckFinishing": false,
  "hasSomethingWrong": false,
  "errors": [],
  "bezierOrRunOnUIErrors": [],
  "consoleSample": [
    "warning: [event/create] terminal-state {terminalState: signed_out, authStatus: signed_out, brandError: null}"
  ]
}
```

### Static Home Create Shell Probe

Source check result:

```json
{
  "createShell": true,
  "noCreateRoute": true,
  "blockedRoutesAbsent": [],
  "shellIntercept": true,
  "expoFree": true,
  "providerNeutral": true
}
```

Exported-file click result:

```text
Clicked dist/home.html Create event.
URL stayed on dist/home.html#create-event.
Body rendered: "The event creator is blocked on phone browsers until the full web workflow is proven stable..."
```

### Direct Edit Missing-Draft Sanity Probe

URL:

```text
http://127.0.0.1:8088/event/d_missing_orch1088/edit?step=0&orch1088nosession=qa
```

Result:

```json
{
  "body": "We could not load this draft.\nRefresh, return to Home, or use desktop/the app if this phone browser cannot restore the draft.\nBack to Home",
  "hasMissingRecovery": true,
  "hasLoadingOnly": false,
  "hasSomethingWrong": false,
  "errors": [],
  "relevantConsole": [
    "warning: [event/edit] missing-draft-timeout {idParam: d_missing_orch1088}"
  ]
}
```

### Physical Android Availability

Command:

```bash
adb devices
```

Result:

```text
* daemon started successfully
List of devices attached
```

No attached device was listed, so the physical Samsung A72 path was unavailable.

## Regression Coverage Assessment

The committed ORCH-1088 automated gate is repo-running and included in `mingla-business/package.json`:

```text
"test:orch-1088": "npm run test:orch-1087 && node scripts/ci/orch-1088-event-creator-phone-parity.mjs && npx jest src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts --runInBand"
```

Coverage strengths:

- Catches static Home Create reopening without `data-orch-1088-create-reopened`.
- Catches unsafe static Home direct route links from the ORCH-1087 blocked list.
- Catches static Home `Stripe account` copy regression.
- Catches removal of `/event/create` terminal-state source branches and required recovery copy.
- Catches removal of `ROUTE_BOOT_TIMEOUT_MS`, `DRAFT_HYDRATION_TIMEOUT_MS`, and terminal-state console warnings.
- Catches removal of the web Reanimated shim's `Easing.bezier` and `runOnUI` exports.
- Catches removal of phone-web cover-upload degradation and provider/color path source markers.
- Catches `Connect Stripe` returning to the shared paid publish card's user-facing source.

Coverage limitations:

- The Jest tests are mostly source-contract tests. They do not mount `EventCreateRoute` with mocked AuthContext/current-brand/draft hydration states, so they do not independently prove every timer branch by unit simulation.
- The shim test verifies callable exports by requiring the shim with mocked `react-native`, and the Playwright route probe verifies the no-session exported route at runtime. That combination is sufficient for the observed `Easing.bezier`, `runOnUI`, and no-session spinner regressions.
- Fail-on-revert proof was not performed because tester mode cannot edit product code and the branch already contains the required committed regression tests. Based on source inspection, reverting the shim additions would fail the source guard and Jest shim test; reverting the `/event/create` terminal-state additions would fail the source guard/Jest tests and the Playwright no-session route probe.

## Residual Risk

- Static Home Create is still intentionally closed. A later reopen commit must run a full signed-in Android Chrome and Safari wizard pass before changing `href="#create-event"` to a real route.
- Physical Android Chrome proof was not available in this QA session because no ADB device was attached.
- Full signed-in wizard parity remains unverified by this branch: Step 1-7, autosave to server id, refresh/re-entry, cover provider selection persistence, tickets, settings, preview, publish gating, and close/discard still need a separate runtime pass before reopen.
- Typecheck was not rerun in this QA pass because the implementation report already documents existing unrelated typecheck failures and the required dispatch commands did not include typecheck.

## Deploy/Merge Readiness

No deploy, merge, reap, OTA, backend, schema, RLS, edge-function, or provider action was performed.

This branch is safe to route to orchestrator for close of the scoped safety slice, with one explicit product constraint: do not tell users that phone-browser Create is reopened, and do not deploy a static Home Create link to `/event/create` until a later signed-in wizard parity ORCH passes.
