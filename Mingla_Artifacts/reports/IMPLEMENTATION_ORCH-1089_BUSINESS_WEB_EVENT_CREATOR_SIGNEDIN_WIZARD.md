# IMPLEMENTATION - ORCH-1089 Business Web Signed-In Event Creator Wizard Parity

Date: 2026-06-06
Status: implemented, partially verified
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1089-[business-web-event-creator-signedin-wizard]/`
Branch: `ORCH-1089-business-web-event-creator-signedin-wizard`

## Summary

ORCH-1089 reopens the static Business Home `Create event` action to the real `/event/create` route with `data-orch-1089-create-reopened="true"`. The implementation keeps the real Step 1-7 Event Creator wizard, preserves the ORCH-1088 no-session and missing-draft recovery paths, hardens current-brand recovery so failed brand/account queries become retryable brand errors, and prevents web missing-draft exits from navigating into full tabs Home.

The strongest local signed-in fixture proved `/event/create -> /event/d_.../edit?step=0` reaches real Step 1 on a Pixel 5 Chromium profile with mocked Supabase auth/brand/account reads. Full real-account Step 1-7 completion on physical Android Chrome and Safari remains a tester gate because no Android device or live business credential fixture was available in this implementation session.

## Files Changed

- `mingla-business/package.json`
- `mingla-business/public/home.html`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/scripts/ci/orch-1087-static-route-firewall.mjs`
- `mingla-business/scripts/ci/orch-1088-event-creator-phone-parity.mjs`
- `mingla-business/scripts/ci/orch-1089-signedin-event-creator-wizard.mjs`
- `mingla-business/src/hooks/useCurrentBrandRecovery.ts`
- `mingla-business/src/utils/currentBrandRecoveryErrors.ts`
- `mingla-business/src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts`
- `mingla-business/src/utils/__tests__/orch_1089_signedin_event_creator_wizard.test.ts`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`

## Spec Traceability

| Spec requirement | Implementation |
|---|---|
| Add `test:orch-1089` first | Added `npm run test:orch-1089`, source guard, and Jest regression before runtime proof. |
| Fix web missing-draft exit away from `/(tabs)/home` | Missing draft now sets the bounded recovery UI on web; non-web exits keep the native-safe destination. The edit-route publish fallback also uses `safeEventsExitRoute()`. |
| Harden `useCurrentBrandRecovery` query-error classification | Added pure query-error helper and returns `CURRENT_BRAND_QUERY_ERROR` when `useBrands` or `useCreatorAccount` fails. Default-brand-save warning is preserved. |
| Preserve real Step 1-7 wizard | No step files were removed or replaced. ORCH-1089 guard pins all seven step imports and key web-safe controls. |
| Prove signed-in route behavior as far as possible | Mocked Supabase signed-in fixture reached `/event/d_.../edit?step=0` and rendered Step 1 with no page errors. |
| Relink static Home Create only after proof | `public/home.html` now links Create to `/event/create` with `data-orch-1089-create-reopened="true"`. Other static Home actions remain hash-shell links. |
| Preserve provider-neutral copy | Guards assert no static `Stripe account` copy and Step 7 / paid-publish copy remains `Connect a bank`. |
| No `web.output`, `asyncRoutes`, Vercel rewrites, migrations, deploy/merge/OTA | None touched. |

## Cross-Surface Matrix

| Surface | Result |
|---|---|
| Business Web phone browser | Primary target. Static Home Create reopens; `/event/create` no-session recovery, mocked signed-in Step 1 boot, and missing-draft recovery verified locally. |
| Business Web desktop | Existing real wizard path preserved; no desktop-only route change. |
| Business iOS native | No intended behavior change; edit-route native fallback remains native tab route via `safeEventsExitRoute()`. |
| Business Android native | No intended behavior change; same as iOS native. |
| Consumer iOS / Android | Not touched. |
| Buyer / anonymous Web | Not touched. |
| Admin Web | Not touched. |
| Backend schema/RLS/provider payloads | Not touched; no migrations or provider payload changes. |

## Old-To-New Receipts

| Area | Before | After |
|---|---|---|
| Home Create | `href="#create-event"` + shell copy blocked phone browsers. | `href="/event/create"` with `data-orch-1089-create-reopened="true"`. |
| Missing draft | A signed-in missing draft branch scheduled `router.replace("/(tabs)/home" as never)`. | Web shows bounded recovery and `Back to Home` uses `/home#hub-events`; native keeps the native-safe events tab. |
| Current-brand recovery | Brand/account query errors could leave `isError=false`, allowing false `no_brand` UX. | Query errors return retryable brand-data error copy and drive `/event/create` `brand_error`. |
| ORCH gates | ORCH-1087/1088 treated any Create relink as forbidden or only ORCH-1088-marked. | Older guards allow only an explicit ORCH-1089 reopen marker while keeping every other static route firewalled. |

## Regression Coverage

`npm run test:orch-1089` now runs:

```text
npm run test:orch-1088
node scripts/ci/orch-1089-signedin-event-creator-wizard.mjs
npx jest src/utils/__tests__/orch_1089_signedin_event_creator_wizard.test.ts --runInBand
```

It catches:

- Home Create not reopened or reopened without `data-orch-1089-create-reopened`.
- Reopening any non-Create static Home route.
- Static Home Expo bundle leakage or `Stripe account` copy regression.
- Removal of current-brand query-error classification.
- `/event/create` no-brand winning before brand-error recovery.
- Duplicate draft mint calls in `/event/create`.
- Web edit-route `/(tabs)/home` regressions.
- Removal of real Step 1-7 wizard wiring.
- Removal of Reanimated `bezier` / `runOnUI`, `Sheet.web` boundary, or phone-web cover-upload degradation.

Fail-on-revert note: reverting the missing-draft route fix reintroduces `router.replace("/(tabs)/home" as never)` and fails the ORCH-1089 guard/Jest. Reverting current-brand query classification fails both pure-helper assertions and source guards. Reverting the Home relink fails the ORCH-1089 guard.

## Verification

Passed:

```bash
cd mingla-business && npm run test:orch-1089
```

Summary:

```text
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
ORCH-1089 signed-in Event Creator wizard PASS.
ORCH-1088 Jest: 8 passed.
ORCH-1089 Jest: 6 passed.
```

Passed:

```bash
cd mingla-business && npx expo export -p web --output-dir dist
cd mingla-business && node scripts/inject-mobile-blur-css.mjs
cd mingla-business && npm run test:orch-1088
cd mingla-business && npm run test:orch-1089
```

Summary:

```text
Web Bundled 730ms index.js (2166 modules)
Exported: dist
[mobile-blur-fix] injected mobile preboot + blur-kill into dist/index.html <head>.
ORCH-1088 and ORCH-1089 gates passed against post-export dist.
```

Physical Android availability:

```bash
adb devices -l
```

Result:

```text
List of devices attached
```

No device rows were present.

## Browser Proof

Local servers:

- Static Home: `python3 -m http.server 8100 --directory dist`
- SPA routes: `npx serve dist -l 8099 --single`

Chromium Pixel 5 and WebKit iPhone 13 static Home:

```json
{
  "href": "/event/create",
  "markerCount": 1,
  "clickedUrl": "http://127.0.0.1:8100/event/create",
  "errors": []
}
```

Chromium Pixel 5 and WebKit iPhone 13 unsigned `/event/create`:

```json
{
  "body": "Sign in to create an event.\\nYour browser session is not available on this route.\\nSign in again\\nBack to Home",
  "errors": [],
  "consoles": ["warning: [event/create] terminal-state {terminalState: signed_out, authStatus: signed_out, brandError: null}"]
}
```

Chromium Pixel 5 and WebKit iPhone 13 missing-draft edit route:

```json
{
  "body": "We could not load this draft.\\nRefresh, return to Home, or use desktop/the app if this phone browser cannot restore the draft.\\nBack to Home",
  "errors": [],
  "consoles": ["warning: [event/edit] missing-draft-timeout {idParam: d_orch1089_missing}"]
}
```

Mocked signed-in Chromium Pixel 5 fixture:

```json
{
  "finalUrl": "http://127.0.0.1:8099/event/d_mq1s7zcvdrawgl/edit?step=0",
  "hasStep1": true,
  "hasRecovery": false,
  "errors": [],
  "bodyExcerpt": "1/7\\nORCH 1089 Brand · Step 1 of 7\\nServer draft\\nSTEP 1 OF 7\\nBasics\\nName, format, and category\\nEvent name...Description\\nContinue"
}
```

This fixture seeded the same `sb-gqnoajqerqhnvulmnyvv-auth-token` session shape used by static callback and intercepted Supabase auth/creator-account/brand/event/order reads. It proves local app routing, current-brand recovery, draft minting, route replacement, and real Step 1 wizard boot without mutating remote data.

## Partial / Manual Gates

- Physical Android Chrome was unavailable because `adb devices -l` returned no device rows.
- A real production/staging business account was not provided, so live Supabase auth/current-brand/draft persistence was not verified against remote data.
- Full Step 1-7 completion on Chromium/WebKit with real user interactions remains for tester. The implementation preserved and source-guarded all seven steps, and proved Step 1 boot with a signed-in fixture, but did not complete the whole wizard runtime flow.
- Safari proof used Playwright WebKit mobile for recovery/static Home paths; real iPhone Safari remains a tester gate.

## Deploy Notes

No deploy, merge, reap, OTA, migration, Supabase action, edge-function deploy, provider API change, `web.output`, `asyncRoutes`, or Vercel rewrite change was performed.

After tester PASS and orchestrator close/merge, web deployment should happen only from clean merged `main` with `[deploy]` per COMMS-0015/0018. No native OTA is required by this scoped web/static Home change unless orchestrator decides the shared JS route changes need native validation before release.

## Readiness

Ready for tester: yes, with a conditional verdict. Tester should independently verify the local/source gates and then run real-account mobile-browser Step 1-7 on Android Chrome and Safari before orchestrator deploys from merged `main`.
