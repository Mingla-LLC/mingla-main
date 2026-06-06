# QA - ORCH-1092 Business Web Restoration Wave Retest 2

Date: 2026-06-06
Mode: RETEST / SPEC-COMPLIANCE / BUSINESS WEB RUNTIME SMOKE
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]`
Branch: `ORCH-1092-business-web-restoration-wave`
Second rework commit: `028f98937`

## Verdict

CONDITIONAL PASS.

The remaining P1 from the first retest is fixed. A fresh export now opens `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, and `/account` in an unsigned mobile Chromium profile and shows visible signed-out recovery plus `Return to Home`; no blank root, page crash, page error, or request failure occurred on those four route probes. The prior fixed guard also did not regress: `test:orch-1092` parses `dist/index.html`, inspects eager boot chunks including `__common`, runs the unsigned mobile Chromium smoke when `dist/` exists, and the fresh export/inject/test chain passed.

The condition is the original signed-in business-session manual gate: useful first screens and core interactions for Events, Marketing overview, Composer, and Account still require a real signed-in business browser session before production close/deploy.

## Findings

No P0/P1 blockers remain.

### P2 - Signed-in useful first screens remain a manual gate

Evidence: this retest intentionally verified unsigned recovery using a clean mobile Chromium profile. No valid signed-in business session fixture was available in the worktree, so signed-in Events, Marketing overview, Composer subject/body/schedule/review, and Account settings interactions remain unverified runtime gates.

Required close condition: Seth/orchestrator should run the signed-in phone Chrome and iPhone Safari smoke listed below before production deploy. If those signed-in routes blank, crash, infinite-spin, or fail the listed core interactions, route back to implementor for rework.

## Retest Inputs Read

- `Mingla_Artifacts/specs/SPEC_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`, especially section 18
- `Mingla_Artifacts/reports/QA_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/reports/QA_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE_RETEST.md`
- Rework source: `mingla-business/app/_layout.tsx`, `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs`, `mingla-business/src/utils/__tests__/orch_1092_business_web_restoration_wave.test.ts`

## Code Evidence

### Outer signed-out recovery

`mingla-business/app/_layout.tsx` now defines the reopened route set and storage check:

- Lines 116-121: `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`
- Lines 123-151: `sb-*-auth-token` localStorage detection
- Lines 153-191: visible `Sign in to open <route>.` and `Return to Home`
- Lines 529-548: outer web-only recovery runs before `ErrorBoundary`, `QueryClientProvider`, `AuthProvider`, and `KeyboardRoot`

This directly addresses the first retest failure where the recovery lived too deep in the provider tree and could blank before committing.

### Guard regression

`mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs` verifies:

- Lines 63-73: parses script `src` values from `dist/index.html`
- Lines 89-122: starts a local `dist/` server with `/home -> home.html`, app routes -> `index.html`, and must-revalidate JS headers
- Lines 124-166: mobile Chromium unsigned runtime smoke for all four reopened routes
- Lines 352-381: requires ORCH-1091 injected markers, inspects eager boot chunks, and requires `__common`
- Lines 411-413: runs the runtime smoke when `dist/index.html` exists

`mingla-business/src/utils/__tests__/orch_1092_business_web_restoration_wave.test.ts` pins the source contract for markers, payout shell/provider-neutral copy, schedule split, route-family imports, media quarantine, and the outer recovery/storage check.

## Command Evidence

### Required source command

Command:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
npm run test:orch-1092
```

Result: PASS.

Key output:

```text
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
ORCH-1089 signed-in Event Creator wizard PASS.
ORCH-1092 business web restoration wave PASS.
Test Suites: 3 passed, 3 total
Tests: 20 passed, 20 total
```

### Required fresh export command

Command:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1092
```

Result: PASS.

Key output:

```text
Web Bundled 547ms index.js (2152 modules)
web bundles (128)
Exported: dist
[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
ORCH-1089 signed-in Event Creator wizard PASS.
ORCH-1092 business web restoration wave PASS.
Test Suites: 3 passed, 3 total
Tests: 20 passed, 20 total
```

Expo emitted a Sentry config warning only; it did not fail the export or tests.

## Independent Runtime Evidence

I independently started a local export server equivalent to the guard contract and opened the four reopened routes in a clean mobile Chromium Pixel 5 profile.

```text
UNSIGNED_ROUTE /hub/events ok=true failures=none url=http://127.0.0.1:<port>/hub/events
UNSIGNED_ROUTE /marketing ok=true failures=none url=http://127.0.0.1:<port>/marketing
UNSIGNED_ROUTE /marketing/campaigns/compose ok=true failures=none url=http://127.0.0.1:<port>/marketing/campaigns/compose
UNSIGNED_ROUTE /account ok=true failures=none url=http://127.0.0.1:<port>/account
```

Each route showed the expected exact copy:

- `/hub/events`: `Sign in to open Hub Events.` plus `Return to Home`
- `/marketing`: `Sign in to open Marketing overview.` plus `Return to Home`
- `/marketing/campaigns/compose`: `Sign in to open Compose blast.` plus `Return to Home`
- `/account`: `Sign in to open Account settings.` plus `Return to Home`

No `pageerror` or `requestfailed` events were captured.

## Chunk Evidence

### Eager boot chunks

Independent `dist/index.html` parser output:

```text
EAGER_CHUNKS=__expo-metro-runtime-0c48b0beee2d3ce6030b475fcc5b1846.js,__common-bade1a263843bb5d6943459ee1a92391.js,index-673ede93709fe16629641db487c64add.js
__expo-metro-runtime-0c48b0beee2d3ce6030b475fcc5b1846.js forbidden_hits=none
__common-bade1a263843bb5d6943459ee1a92391.js forbidden_hits=none
index-673ede93709fe16629641db487c64add.js forbidden_hits=none
```

Forbidden set checked: `react-native-keyboard-controller`, `expo-camera`, `expo-image-picker`, `expo-file-system`, `expo-file-system/legacy`, `@react-native-community/datetimepicker`, `@stripe/connect-js`, `@stripe/react-connect-js`, `react-native-video-trim`, `react-native-compressor`.

### Reopened route chunks

Independent named chunk scan:

```text
account-09656f878188afbd951017283dcc5e78.js forbidden_hits=none
events-eed210884650e5b889b44c9f72f16ada.js forbidden_hits=none
index-2957a14113606a9af104238152505855.js forbidden_hits=none
compose-29ccf897b7bd01dd16f18dd2ab50da23.js forbidden_hits=none
```

The route-token scan also found `compose-29ccf897b7bd01dd16f18dd2ab50da23.js` via `SchedulePickerSheet`, with `forbidden_hits=none`.

### Stripe Connect isolation

Full exported JS scan found Stripe Connect only in the lazy Stripe route chunk:

```text
StripeConnectPages-6dda120305b68cff49e7d6f9cbd18ec9.js:@stripe/connect-js
```

Static Home does not link to `/connect-account-management`, so this lazy Stripe chunk is not part of the reopened Home route boot.

### Out-of-scope scanner chunk note

The same full exported JS scan found `expo-camera` in `index-b5a268c566f007161a8067a882ddcf28.js`, which is the scanner route chunk (`Scan tickets`, `CameraView`, `useCameraPermissions`). This is not eager, not a reopened ORCH-1092 route chunk, and Scanner is explicitly out of ORCH-1092 scope.

## Static Home / Shell Evidence

Verified in both `public/home.html` and `dist/home.html`:

```text
hub events direct=true
marketing direct=true
compose direct=true
account direct=true
experiences shell=true
trips shell=true
ari shell=true
payout shell=true
no connect direct=true
providerNeutral=true
```

Meaning:

- Hub Events reopens to `/hub/events` with `data-orch-1092-hub-events-reopened="true"`.
- Marketing overview reopens to `/marketing` with `data-orch-1092-marketing-overview-reopened="true"`.
- Compose blast reopens to `/marketing/campaigns/compose` with `data-orch-1092-compose-shell-reopened="true"`.
- Account settings reopens to `/account` with `data-orch-1092-account-reopened="true"`.
- Hub Experiences remains `#hub-experiences`.
- Hub Trips remains `#hub-trips`.
- Ari remains `#ari-assistant`.
- Payout account remains `#payout-account`; no direct `/connect-account-management` link exists.
- Static Home keeps `Payout account` / `generated secure session` copy and does not contain `Stripe account`, `Connect Stripe`, or `Payments & Stripe`.

## Claim Table

| Claim | Status | Evidence |
|---|---:|---|
| Remaining P1 unsigned recovery is fixed | VERIFIED | Independent mobile Chromium opened all four routes and found visible sign-in recovery plus `Return to Home`, with no page/request failures. |
| `npm run test:orch-1092` passes | VERIFIED | Required source command passed. |
| Fresh export + injection + `npm run test:orch-1092` passes | VERIFIED | Required export command passed after `rm -rf dist`. |
| Guard parses `dist/index.html` eager boot chunks | VERIFIED | Source lines 63-73 and 352-381; independent parser listed runtime, `__common`, and `index` chunks. |
| Guard runs mobile Chromium signed-out recovery smoke when `dist` exists | VERIFIED | Source lines 124-166 and 411-413; required export command passed with `dist`; independent probe reproduced explicit route evidence. |
| Eager chunks remain clean for forbidden modules | VERIFIED | Independent parser found zero forbidden hits in runtime, `__common`, and `index` eager chunks. |
| Only lazy Stripe route chunk has Stripe Connect | VERIFIED | Full exported JS scan found `@stripe/connect-js` only in `StripeConnectPages-*.js`; Home does not link payout/account-management direct. |
| Reopened route chunks are clean | VERIFIED | Account, Events, Marketing index, and Compose named chunks had zero forbidden hits. |
| Static Home map is correct | VERIFIED | Source/export map shows Events, Marketing, Compose, Account reopened; Experiences, Trips, Ari, Payout shelled. |
| Payout shell/provider-neutral copy preserved | VERIFIED | Source/export map and copy grep. |
| Signed-in useful first screens work | MANUAL GATE | Requires valid business session in phone Chrome/Safari. |
| Composer subject/body/schedule/review works | MANUAL GATE | Requires signed-in business session. |

## Platform Matrix

| Surface | Result | Evidence |
|---|---:|---|
| Business Web source/export | PASS | Required commands passed; eager and reopened chunks clean. |
| Chromium mobile unsigned local export | PASS | Four reopened routes showed signed-out recovery, no blank root/crash. |
| Signed-in phone Chrome | MANUAL GATE | Needs real business session. |
| Signed-in iPhone Safari | MANUAL GATE | Needs real business session or WebKit mobile fallback after session setup. |
| Native iOS/Android | N/A source-preserved | Web restoration only; native picker/filesystem splits preserve native resolution by source. |
| Admin/Supabase/provider | N/A | No admin, DB, edge, migration, deploy, or provider payload changes. |

## Regression Coverage Assessment

Regression coverage is adequate for the two prior P1s:

- The exported native-module blocker would be caught because `test:orch-1092` parses `dist/index.html`, requires `__common`, and checks every eager boot chunk for the forbidden module set.
- The unsigned blank/crash blocker would be caught because `test:orch-1092` starts a local export server and opens `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, and `/account` in mobile Chromium when `dist/index.html` exists.

Fail-on-revert proof was not performed because tester mode does not mutate product code and the required command pair plus independent runtime probe directly exercise the fixed contract.

## Remaining Manual Gates

Before production close/deploy, run from a preview or local export server with a real signed-in business session:

1. Phone Chrome: open `/home`, tap Events, Marketing overview, Compose blast, Account settings, and Payout account.
2. Confirm Events, Marketing, Compose, and Account reach useful signed-in first screens; refresh each route, return to Home, and reopen without blank page, stale chunk loop, infinite spinner, or native-module error.
3. Events: exercise filter plus share or manage-menu open/close.
4. Account: open Account and one settings or brand-switcher row, then return.
5. Marketing overview: open overview and tap New campaign if present.
6. Composer: type subject/body, open schedule, choose date/time, open review/preview shell, and confirm visible save/error handling.
7. Payout: confirm static Home remains shelled and never opens `/connect-account-management`.
8. Repeat on iPhone Safari or Playwright WebKit mobile with a valid signed-in session.

## Downstream Routing

Route to Codex `orchestrator-mingla` for CLOSE readiness review, not implementor rework. The remaining work is a signed-in manual browser gate and normal merge/deploy discipline: merge through PR to `main`, verify `origin/main` contains the squash commit and changed files, then deploy Business Web from merged `main` only. Do not deploy, merge, reap, OTA, or mutate Supabase from this ORCH worktree.
