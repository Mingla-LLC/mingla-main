# QA - ORCH-1092 Business Web Restoration Wave

Date: 2026-06-06
Mode: TARGETED / SPEC-COMPLIANCE / WEB RUNTIME SMOKE
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]`
Branch: `ORCH-1092-business-web-restoration-wave`
Implementation commit: `8b0ee33ef730a281741680f02018ee1d4c51896e`

## Verdict

FAIL.

The implementation correctly adds the bounded static Home relinks, keeps payout shelled, preserves the SchedulePickerSheet native/web split, and passes the required source/export test commands. It does not meet the full ORCH-1092 release gate because exported app boot still eagerly loads forbidden Expo picker/filesystem modules through `__common`, and local mobile-browser smoke did not reach useful first screens for the reopened Expo routes.

## Findings

### P1 - Exported app boot still loads forbidden picker/filesystem modules through the eager common chunk

Spec impact: fails the native-module quarantine and exported-chunk inspection gate in SPEC sections 4.A, 4.E, 5, and 9.

Evidence:

- `dist/index.html` eagerly loads `/_expo/static/js/web/__common-d9f97e2fbdb5d37a3cce7b864b0d8057.js?v=orch1091` before route chunks.
- `rg -l "expo-image-picker|expo-file-system|expo-file-system/legacy" dist/_expo/static/js/web/*.js` returns `__common-d9f97e2fbdb5d37a3cce7b864b0d8057.js`.
- Context from `__common` includes the Expo ImagePicker module and Expo FileSystem legacy/new modules. It also includes `CoverPicker` and event-cover upload code that use those modules.
- The new guard only scans chunks that contain narrow route tokens (`ComposeCampaignRoute`, `MarketingOverviewRoute`, `EventsTab`, `AccountTab`, `SchedulePickerSheet`) and therefore misses `__common` entirely. Evidence: `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs:239-263`.

Why this blocks release:

ORCH-1092 exists to reopen static Home routes only after native-only web crash risks are quarantined. Even if these modules are existing bundle debt and did not crash in the headless run, the implementation claim "forbidden native modules are absent from reopened route chunks" is not proven, and the automated guard would not catch a regression in the eager boot chunk every reopened route depends on.

Required rework:

- Extend `test:orch-1092` to scan the eager app boot chunks loaded by `dist/index.html`, especially `__common`, not only route chunks containing route-name strings.
- Either quarantine the source path that pulls picker/filesystem modules into `__common`, or add an explicit ORCH-1092 allow reason with runtime evidence proving those exact modules cannot execute or crash on the reopened phone-browser routes.
- Re-run `rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1092`.

### P1 - Local mobile-browser smoke did not reach useful first screens for reopened Expo routes

Spec impact: fails the manual/browser proof gate in SPEC sections 4.B, 4.C, 4.D, 4.E, 6, and 9.

Evidence:

- I started a local export server that mirrors the critical rewrite: `/home` serves `dist/home.html`; unknown app routes fall back to `dist/index.html`.
- Chromium Pixel 5 profile from static Home:
  - Events clicked from Home Hub panel to `http://localhost:4192/hub/events`, but `document.body.innerText` was empty.
  - Account clicked from Home Account panel to `http://localhost:4192/account`, but `document.body.innerText` was empty.
  - Marketing clicked from Home Blast panel to `http://localhost:4192/marketing`, but `document.body.innerText` was empty.
  - Compose clicked from Home Blast panel to `http://localhost:4192/marketing/campaigns/compose`, but `document.body.innerText` was empty.
- Direct route inspection after 3.5 seconds for `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, and `/account` showed:
  - `rootChildren: 1`
  - `rootHTML: <div class="css-g5y9jx r-13awgt0"></div>`
  - `bodyText: ""`
  - no page errors or request failures.
- WebKit iPhone 12 profile showed the same blank route result for Events and Account during the Home-click smoke. Static shells did render correctly.

Notes:

This local smoke ran without a signed-in business session, so it cannot prove the signed-in production route is blank. But the implementation was accepted as a phone-browser restoration wave, and the local export proof did not show any useful first screen, loading copy, signed-out recovery, or bounded error state for the reopened routes.

Required rework or retest:

- Preferred: run a signed-in Chrome/Safari phone-browser smoke on a preview built from this branch after the chunk gate is fixed.
- If local export should support signed-in proof, provide a safe test account/session setup and rerun Events, Marketing, Compose, and Account including refresh/back/re-entry.
- The route smoke must show visible first screens and one core interaction per reopened route, including Composer subject/body/schedule/review shell.

### P2 - The ORCH-1092 source guard is too shallow for route-family import risk

Spec impact: regression coverage gap.

Evidence:

- The new guard scans only these files for static forbidden imports: `app/(tabs)/hub/events.tsx`, `app/(tabs)/marketing/index.tsx`, `app/(tabs)/marketing/campaigns/compose.tsx`, `app/(tabs)/account.tsx`, `SchedulePickerSheet.tsx`, `ShareModal.tsx`, `KeyboardRoot.tsx`, and `SmartScrollView.tsx`.
- It does not walk imported children, tab layouts, or eager common chunks.
- Example risk: reopened Account, Hub, and Marketing layouts all mount `UniversalCreatorSheet`, whose options still route to `/experience/create` and `/trip/create`. This is existing behavior, but it means reopened routes still expose entry points beyond the static Home reopen map unless runtime smoke proves the sheet path is acceptable.

Required rework:

- Treat the guard as a graph/export guard, not a single-file string scan.
- At minimum, include `(tabs)/hub/_layout.tsx`, `(tabs)/marketing/_layout.tsx`, shared top-bar/sheet dependencies, and every chunk loaded by a reopened route in the export proof.

## Verified Pass Evidence

### Static Home reopen map

Verified in `mingla-business/public/home.html`:

- `/event/create` remains reopened with ORCH-1088 and ORCH-1089 markers.
- `/hub/events` is reopened with `data-orch-1092-hub-events-reopened="true"`.
- `/marketing` is reopened with `data-orch-1092-marketing-overview-reopened="true"`.
- `/marketing/campaigns/compose` is reopened with `data-orch-1092-compose-shell-reopened="true"`.
- `/account` is reopened with `data-orch-1092-account-reopened="true"`.
- `/hub/experiences`, `/hub/trips`, `/connect-account-management`, and Ari remain static Home shells.

### Payout provider-neutral shell

Verified:

- Static Home payout stays `href="#payout-account"` with `data-shell-link="payout-account"`.
- Static Home says `Payout account` and `Requires a generated secure session`.
- No direct `/connect-account-management` Home link exists.
- `BrandPaymentsView.tsx` user-facing copy changed from Stripe-specific account-management copy to payout-account copy.

### SchedulePickerSheet split

Verified:

- `SchedulePickerSheet.tsx` is now the web implementation and contains browser-native `input type="date"` and `input type="time"`.
- `SchedulePickerSheet.tsx` does not import `@react-native-community/datetimepicker`.
- `SchedulePickerSheet.native.tsx` preserves the native DateTimePicker implementation.

Direct DOM input risk:

- The web implementation uses hidden DOM inputs from React Native Web JSX. This exported successfully and is acceptable as a web-only implementation pattern, but it still needs real phone-browser confirmation that tapping the visible pills reliably opens date/time controls on Chrome and Safari.

### ORCH-1091 cache/header/script guards

Verified:

- `vercel.json` still keeps `/home -> /home.html` before the catch-all.
- `vercel.json` still gives `/_expo/static/js/web/(.*)` `Cache-Control: public, max-age=0, must-revalidate`.
- `scripts/inject-mobile-blur-css.mjs` still carries `orch1091-js-cache-bust`, `?v=${JS_CACHE_BUST_PARAM}`, `mingla-mobile-web-chunk-recovery`, `mingla-mobile-web-home-preboot`, and `mingla-mobile-web-no-blur`.
- Fresh export plus injection produced `dist/index.html` with `?v=orch1091`, `data-orch1091-js-cache-bust`, chunk recovery, Home preboot, and blur-kill CSS.

## Claim Table

| Claim | Status | Evidence |
|---|---:|---|
| `npm run test:orch-1092` passes | VERIFIED | Command passed with ORCH-1085/1087/1088/1089 plus ORCH-1092 Jest all green. |
| Fresh export + injection + `npm run test:orch-1092` passes | VERIFIED | Command passed after `rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs`. |
| Static Home reopens only Events, Marketing, Compose, Account, and Create | VERIFIED | `public/home.html` source and `dist/home.html` show only those direct app hrefs. |
| Payout remains shelled and provider-neutral | VERIFIED | Static Home shell and source/Jest checks; no `/connect-account-management` Home href. |
| Hub Experiences/Trips/Ari remain closed | VERIFIED | Source and local Home shell smoke. |
| ORCH-1091 cache guards remain intact | VERIFIED | Source and post-export `dist/index.html` evidence. |
| Forbidden native modules are absent from reopened route boot chunks | REFUTED | `__common` eager app chunk contains `expo-image-picker`, `expo-file-system`, and `expo-file-system/legacy`; guard misses it. |
| Browser mobile route smoke reaches useful first screens | REFUTED/UNVERIFIED | Local Chromium/WebKit mobile profiles navigated to reopened routes but rendered empty Expo root without visible content in unsigned profile. |
| Composer subject/body/schedule/review shell works | UNVERIFIED | No signed-in route content rendered in local export; manual gate still required. |

## Platform Matrix

| Surface | Result | Evidence |
|---|---:|---|
| Business Web source/export | FAIL | Automated commands pass, but eager `__common` chunk violates native-module quarantine. |
| Chrome mobile profile | FAIL/UNVERIFIED | Static Home and shells render; reopened app routes show empty root in local unsigned export. |
| WebKit mobile profile | FAIL/UNVERIFIED | Static Home and shells render; reopened app routes show empty root in local unsigned export. |
| Native iOS | N/A source-preserved | Only `.native.tsx` schedule picker split touched; no native runtime test required for this web restoration except preserving source behavior. |
| Native Android | N/A source-preserved | Same as iOS. |
| Admin/Supabase/provider | N/A | No admin, schema, edge, migration, or provider payload changes. |

## Commands Run

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
npm run test:orch-1092
```

Result: PASS. ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092 guard, and ORCH-1092 Jest checks passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1092
```

Result: PASS. Expo emitted 128 web bundles. Injection logged `mobile chunk recovery + preboot + blur-kill`. Tests passed after export.

```bash
rg -l "expo-image-picker|expo-file-system|expo-file-system/legacy" dist/_expo/static/js/web/*.js
```

Result: `dist/_expo/static/js/web/__common-d9f97e2fbdb5d37a3cce7b864b0d8057.js`.

```bash
rg -l "@react-native-community/datetimepicker|react-native-keyboard-controller|@stripe/connect-js|@stripe/react-connect-js|react-native-video-trim|react-native-compressor" dist/_expo/static/js/web/*.js
```

Result: no DateTimePicker, keyboard-controller, video trim, or compressor hits in exported app chunks. `@stripe/connect-js` appears only in `StripeConnectPages-*.js`, which is not linked from static Home.

```bash
# Local custom export server:
# /home -> dist/home.html, unknown app routes -> dist/index.html, JS cache header must-revalidate.
node <inline static server on port 4192>
```

Result: server started at `http://localhost:4192`. Stopped after QA.

```bash
# Playwright mobile profiles, Chromium Pixel 5 and WebKit iPhone 12:
# static Home click smoke for Events, Marketing, Compose, Account, payout shell,
# Experiences shell, Trips shell, Ari shell; plus direct route inspection.
node <inline Playwright smoke script>
```

Result: static Home and shell routes rendered. Reopened app routes navigated but showed empty body/root in the unsigned local export profile.

## Regression Coverage Assessment

Regression tests exist and run in the repo:

- `test:orch-1092` composes the ORCH-1085/1087/1088/1089 guard chain.
- `orch_1092_business_web_restoration_wave.test.ts` checks Home markers, payout shell/copy, SchedulePickerSheet split, and a shallow source-import set.

Coverage gap:

- The tests would not catch forbidden native modules entering `__common`, even though `__common` is eagerly loaded by every app route.
- The tests do not prove signed-in browser rendering or Composer schedule interaction.
- Fail-on-revert proof was not performed because the export/chunk and runtime checks already found blockers.

## Manual Gates Before Close

These remain mandatory after rework:

1. From a signed-in phone Chrome session, open `http://localhost:4192/home` or the branch preview URL and tap Events, Marketing overview, Compose blast, Account settings, and Payout account.
2. Confirm Events, Marketing, Compose, and Account reach visible useful first screens.
3. Refresh each route, Back to Home, and reopen it; expected: no blank page, stale chunk loop, infinite spinner, or native-module error.
4. Composer: type subject/body, open schedule, choose date/time, continue to review/preview shell, and confirm visible save/error handling.
5. Payout: confirm static Home remains shelled and does not open `/connect-account-management`.
6. Repeat on iPhone Safari or Playwright WebKit mobile with a valid signed-in session.

## Downstream Routing

Route back to Codex `implementor-mingla` for bounded rework. Required output: update the ORCH-1092 implementation in the same worktree/branch, fix the exported common-chunk native-module gap or produce explicit approved allow evidence, strengthen the guard, rerun required source/export commands, and produce an updated implementation report. Then return to tester for retest.
