# QA: ORCH-1089 Business Web Signed-In Event Creator Wizard Parity

Date: 2026-06-06  
Tester: Codex `tester-mingla`  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1089-[business-web-event-creator-signedin-wizard]`  
Branch: `ORCH-1089-business-web-event-creator-signedin-wizard`  
Implementation under test: `d0b5b9070`  
Verdict: CONDITIONAL PASS

## Verdict

ORCH-1089 is conditionally acceptable for orchestrator review, but it is not a production PASS. Source, export, recovery paths, and mocked signed-in Step 1 boot are verified. Full real-account Step 1-7 on Android Chrome/Safari or equivalent Chromium/WebKit remains unverified because no Android device and no real business credentials/session were available.

I did not implement, deploy, merge, reap, or OTA. COMMS-0015, COMMS-0018, and COMMS-0021 were factored; I added `tester+codex (ORCH-1089 QA...)` acknowledgements to those ledger entries on anchor `main` in commit `c89c00fed`.

## Findings

### P2-1 Conditional release gate: real-account Step 1-7 is unverified

Evidence:

- `adb devices -l` returned exactly:

```text
List of devices attached
```

- No real business account credentials/session were available.
- Playwright Chromium with mocked Supabase/session data reached `/event/d_.../edit?step=0` and rendered real Step 1 with no errors, but Supabase was intercepted, so this is not production auth/RLS/persistence proof.

Required gate before production deploy:

1. Use a real Business Web account with a recoverable current brand.
2. On Android Chrome if a device is attached, otherwise Playwright Chromium mobile fallback, open static Home and tap Create event.
3. Confirm `/event/create -> /event/{draftId}/edit?step=0`, then complete Steps 1-7 enough to prove basics, date/time, location recovery, cover provider/color path, free ticket save, toggles, and preview.
4. Repeat on Safari or Playwright WebKit mobile.
5. Confirm no blank route, spinner loop, hidden dock, keyboard blocker, native-module page error, or provider-specific paid-ticket copy.

## Claim Table

| Claim / requirement | Status | Evidence |
|---|---:|---|
| Static Home Create reopened only with ORCH-1089 marker | Verified | `mingla-business/public/home.html:461` has `href="/event/create"` and `data-orch-1089-create-reopened="true"`; browser static probe saw marker count 1. |
| Other static Home actions remain shell/hash safe | Verified | `npm run test:orch-1089` runs ORCH-1087/1088 guards first; source guard checks Hub/Ari/Marketing/Account/payout route hrefs stay closed. |
| `/event/create` keeps bounded terminal states and one draft mint | Verified | `app/event/create.tsx:137-185`; test guard found one `createDraft(currentBrandId)` behind `startedRef`. |
| Current-brand query failures classify as retryable brand errors | Verified | `src/hooks/useCurrentBrandRecovery.ts:49-58` blocks `dataReady` on query errors; `:125-129` returns `CURRENT_BRAND_QUERY_ERROR`; Jest passed. |
| Web missing-draft edit path avoids full tabs Home | Verified | `app/event/[id]/edit.tsx:260-269` sets bounded recovery on web; `:497-513` Back to Home uses `/home#hub-events`; forbidden `router.replace("/(tabs)/home" as never)` absent from this file. |
| Missing-draft web static-safe recovery works after export | Verified | Chromium Pixel 5 and WebKit iPhone 13 rendered "We could not load this draft... Back to Home" with no page errors. |
| Unsigned `/event/create` recovery works after export | Verified | Chromium Pixel 5 and WebKit iPhone 13 rendered "Sign in to create an event... Back to Home" with no page errors. |
| Provider-neutral seller/payout copy preserved | Verified | ORCH-1089 guard pins `Connect a bank` and rejects static `Stripe account`; remaining Stripe hits are comments or intentional Stripe-management surfaces outside this route. |
| No `web.output`, `asyncRoutes`, Vercel, migration, or edge-function changes | Verified | Changed-file scan found none of `app.json`, `app.config.ts`, `metro.config.js`, `vercel.json`, `supabase/functions`, or `supabase/migrations`. |
| Mocked signed-in Step 1 claim | Verified with caveat | Playwright Chromium Pixel 5 fixture reached `/event/d_mq1sj0mgy3j678/edit?step=0`; body included real Step 1 wizard copy; no errors. |
| Full real-account Step 1-7 path | Unverified | Blocked by missing physical device and missing real credentials/session. |

## Platform Matrix

| Surface | Result | Evidence |
|---|---:|---|
| Physical Android Chrome | UNVERIFIED | `adb devices -l` had no device rows. |
| Playwright Chromium mobile | CONDITIONAL PASS | Static Home reopen, unsigned recovery, missing-draft recovery, and mocked signed-in Step 1 boot verified; full real Step 1-7 unverified. |
| Playwright WebKit mobile | CONDITIONAL PASS | Static Home reopen, unsigned recovery, and missing-draft recovery verified; full signed-in Step 1-7 unverified. |
| Real iPhone Safari | UNVERIFIED | No real Safari device/session available. |
| Business native iOS/Android | N/A | No intended native behavior change; native edit fallback remains native hub/events route. |
| Admin / consumer / backend | N/A | No touched admin, consumer, migration, RLS, edge-function, or provider payload files. |

## Commands Run

```text
sed -n '1,240p' COMMS_LEDGER.md
rg -n "COMMS-0015|COMMS-0018|COMMS-0021|ORCH-1089|tester\\+codex \\(ORCH-1089" COMMS_LEDGER.md
git diff --name-status origin/main...HEAD
git diff --name-only origin/main...HEAD | rg '(^mingla-business/(app\\.json|app\\.config|metro\\.config\\.js|vercel\\.json)|^supabase/functions|^supabase/migrations)' || true
rg -n "web\\.output|asyncRoutes|vercel|rewrite|Stripe account|Connect Stripe|Payments & Stripe|router\\.replace\\(\\\"/\\(tabs\\)/home\\\" as never\\)|data-shell-link=\\\"create-event\\\"|data-orch-1089-create-reopened|href=\\\"/event/create\\\"" mingla-business app-mobile supabase .github || true
cd mingla-business && npm run test:orch-1089
cd mingla-business && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1089
adb devices -l
```

Key output:

```text
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
ORCH-1089 signed-in Event Creator wizard PASS.
Tests: 14 passed, 14 total

Web Bundled 593ms index.js (2166 modules)
Exported: dist
[mobile-blur-fix] injected mobile preboot + blur-kill into dist/index.html <head>.
```

## Browser Evidence

Static Home was served with `python3 -m http.server 8100 --directory dist`; SPA routes were served with `npx serve dist -l 8099 --single`.

Chromium Pixel 5:

```json
{
  "home": { "href": "/event/create", "markerCount": 1 },
  "clickedUrl": "http://127.0.0.1:8100/event/create",
  "createBody": "Sign in to create an event. Your browser session is not available on this route. Sign in again Back to Home",
  "missingBody": "We could not load this draft. Refresh, return to Home, or use desktop/the app if this phone browser cannot restore the draft. Back to Home"
}
```

WebKit iPhone 13:

```json
{
  "home": { "href": "/event/create", "markerCount": 1 },
  "clickedUrl": "http://127.0.0.1:8100/event/create",
  "createBody": "Sign in to create an event. Your browser session is not available on this route. Sign in again Back to Home",
  "missingBody": "We could not load this draft. Refresh, return to Home, or use desktop/the app if this phone browser cannot restore the draft. Back to Home"
}
```

Mocked signed-in Chromium Pixel 5:

```json
{
  "finalUrl": "http://127.0.0.1:8099/event/d_mq1sj0mgy3j678/edit?step=0",
  "hasStep1": true,
  "hasRecovery": false,
  "bodyExcerpt": "1 Basics 2 When 3 Where 4 Cover 5 Tickets 6 Settings 7 Preview 1/7 ORCH 1089 Brand · Step 1 of 7 Server draft STEP 1 OF 7 Basics Name, format, and category Event name Format In person Online Hybrid Party Type * Birthday Party Rooftop Party Club Night House Par",
  "errors": []
}
```

The plain static server returns 404 for `/event/create` after clicking from `home.html`, which is expected because it is not the SPA server. SPA route checks used `npx serve --single`.

## Regression Coverage

Coverage is acceptable for source and recovery contracts:

- `test:orch-1089` runs ORCH-1085/1087/1088 first.
- The ORCH-1089 source guard fails if Home Create loses the marker, other static Home routes reopen, Step 1-7 imports are removed, web edit-route missing-draft recovery regresses to `/(tabs)/home`, brand query-error classification is removed, or provider-neutral Step 7 copy regresses.
- Jest covers the current-brand query-error helper and key source-order contracts.

Fail-on-revert assessment:

- Reverting the edit-route fix reintroduces the forbidden `router.replace("/(tabs)/home" as never)` in `app/event/[id]/edit.tsx`, failing CI/Jest.
- Reverting query-error classification removes `brandsQuery.isError`, `creatorAccount.isError`, or `CURRENT_BRAND_QUERY_ERROR`, failing CI/Jest.
- Reverting Home Create reopen fails ORCH-1089's marker/link assertions.

Coverage gap:

- No committed full Playwright Step 1-7 automation with a real or durable test fixture exists. Because credentials/device access were external to this session, this remains a manual release gate rather than a code rework blocker.

## Deploy Readiness

- No migration, edge function, provider payload, Vercel rewrite, `web.output`, or `asyncRoutes` change is present.
- Do not deploy from this ORCH worktree.
- Per COMMS-0015/0018, deploy only after PR merge to clean `main`, and only after the real-account Step 1-7 gate above is completed or explicitly accepted by Seth/orchestrator.

## Orchestrator Follow-Up — 2026-06-06

Post-QA PR pipeline status:

- PR #393 opened: `[deploy] ORCH-1089 business web signed-in event creator wizard`.
- Branch was rebased onto current `origin/main`; stale branch-level `COMMS_LEDGER.md` diff was removed.
- CI repair commit `72cac4cb4` preserved the ORCH-1088 Home reopen marker while keeping the ORCH-1089 marker, so append-only test protection remains intact.
- Local gates after the repair: `node .github/scripts/test-append-only-check.js` PASS; `npm run test:orch-1089` PASS.
- GitHub gates observed after push: `Test files: append-only` PASS; `mingla-business: web build (expo export)` PASS; docs artifact regression PASS.
- Vercel status for `mingla-business` remained `Canceled by Ignored Build Step`, so no usable PR preview URL was produced.
- `adb devices -l` still showed no attached Android device rows, so physical Android Chrome proof remains unverified.

This does not change the verdict: ORCH-1089 remains CONDITIONAL PASS until the real signed-in phone-browser Step 1-7 walkthrough is completed or explicitly accepted as a post-merge production gate.
