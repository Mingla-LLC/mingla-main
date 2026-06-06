# Implementation Report: Business Web Signed-In Route OOM (ORCH-1093)

> Date: 2026-06-06
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
> Status: implemented, partially verified

## 1. Layman Summary

Signed-in Mingla Business web routes now avoid forcing phone browsers to load the whole app shell before the first useful screen. Tab-global search/command UI and route action sheets are lazy-loaded, unsafe phone direct-entry routes fail closed with deliberate recovery, and the post-export web HTML now defers Expo boot scripts behind an ORCH-1093 mobile route guard while preserving Expo Web, `web.output`, async web routes, ORCH-1091 recovery/cache behavior, and ORCH-1092 native-module quarantine.

The automated bundle guard passes, but physical Android Chrome and mobile Safari proof were not available in this run, so no route is labeled fully restored.

## 2. Request And Context

- **Request:** Implement ORCH-1093 to make signed-in business web mobile-browser route entry fast/stable without stripping the app or abandoning Expo Web.
- **Source:** User dispatch, spec commit `5a57e78f5`, investigation report, and runtime proof report.
- **Affected surfaces:** `mingla-business` Expo Web export, business web route entry, web tab layout, route action-sheet loading, generated `dist/index.html` post-processing, ORCH-specific CI guards.
- **Related issues/artifacts:** `INVESTIGATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`, `RUNTIME_PROOF_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`, ORCH-1091 and ORCH-1092 guards.

## 3. Scope

- **In scope:** ORCH-1093 lazy boundaries, mobile web route-entry fail-closed safety, failing-first guard script, chained ORCH-1092 compatibility, implementation report.
- **Out of scope:** Deploy, OTA, merge, worktree reap, reopening `/hub/experiences`, `/ari`, payout management, and claiming restoration without physical Android Chrome plus mobile Safari proof.
- **Assumptions:** Post-export injection is part of the production web path and remains required after `npx expo export -p web`.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry check | Open `ALL` warnings were acknowledged before implementation. |
| `Mingla_Artifacts/specs/SPEC_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md` | Implementation contract | Binding budgets, route status, lazy boundary, and guard requirements. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md` | Root-cause evidence | Eager tab-global UI/action sheets and direct-route boot payload were the main risks. |
| `Mingla_Artifacts/reports/RUNTIME_PROOF_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md` | Runtime baseline | Baseline eager script payload exceeded phone-browser-safe route-entry goals. |
| `mingla-business/app/_layout.tsx` | Root route safety | Existing ORCH-1092 recovery could be extended for ORCH-1093 route states. |
| `mingla-business/app/(tabs)/_layout.tsx` | Tab-global UI | Static global search and command palette imports were first-entry risks. |
| `mingla-business/app/(tabs)/hub/*.tsx`, `account.tsx`, `marketing/_layout.tsx` | Route action sheets | Share/manage/switch/create/delete sheets were statically imported before first paint. |
| `mingla-business/scripts/inject-mobile-blur-css.mjs` | Post-export production path | ORCH-1091 markers could be preserved while deferring Expo scripts. |
| `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs` | Chained guard | It expected static Expo script tags and needed to inspect deferred script URLs too. |

## 5. Blast Radius

- **Direct changes:** Business web route entry, generated-web script loading, route-global UI/action-sheet import timing, ORCH-1093 guard.
- **Cascade changes:** ORCH-1092 guard now supports static or ORCH-1093-deferred boot scripts for inspection.
- **Parity surfaces:** Native business app keeps command palette host as a null stub and lazy search still opens on demand. Buyer/public/admin code was not edited.
- **Cache impact:** ORCH-1091 `?v=orch1091`, `orch1091-js-cache-bust`, chunk recovery, and Vercel JS `must-revalidate` checks are preserved.
- **State boundaries:** No query keys, invalidations, persisted data shapes, Supabase auth storage, or RLS changed.
- **Auth/RLS/security:** No backend/auth/RLS edits. ORCH-1092 signed-out safety and ORCH-1093 fail-closed safety remain route-entry gates only.
- **Deploy path:** Business web export plus `node scripts/inject-mobile-blur-css.mjs`; no deploy performed.

## 6. Old To New Receipts

### `mingla-business/app/(tabs)/_layout.tsx`

- **Before:** Tabs root statically imported `CommandPalette` and `GlobalSearchSheet`.
- **After:** Tabs root imports lightweight hosts; `GlobalSearchSheet` loads only when opened, and desktop `CommandPalette` loads only after Cmd/Ctrl+K opens it.
- **Why:** Keep tab-global UI out of phone direct-route entry.
- **Approx lines changed:** 28.

### `mingla-business/src/components/ui/CommandPaletteHost.tsx`, `CommandPaletteHost.web.tsx`, `GlobalSearchSheetHost.tsx`, `CommandPalette.web.tsx`

- **Before:** Command palette installed its own keydown listener and was statically imported by tabs; global search was statically mounted.
- **After:** Hosts own the lightweight open-state subscription/listener and lazy import the heavy bodies only when needed.
- **Why:** Preserve behavior while moving non-first-paint UI into lazy boundaries.
- **Approx lines changed:** 3 new files plus a small command-palette listener removal.

### `mingla-business/app/(tabs)/hub/trips.tsx`

- **Before:** Share and offering manage sheets were static route-entry imports.
- **After:** `ShareModal` and `OfferingManageSheet` lazy-load when their state opens; manage action construction stays pure and first-paint safe.
- **Why:** Keep QR/share/manage bodies out of `/hub/trips` route entry.
- **Approx lines changed:** 108.

### `mingla-business/app/(tabs)/hub/events.tsx`

- **Before:** `ShareModal`, `EndSalesSheet`, and `EventManageMenu` were static imports.
- **After:** Each body lazy-loads only when opened.
- **Why:** Keep event manage/share/end-sales UI out of `/hub/events` first paint.
- **Approx lines changed:** 110.

### `mingla-business/app/(tabs)/account.tsx`, `hub/_layout.tsx`, `marketing/_layout.tsx`

- **Before:** Brand switcher/delete and creator sheets were static imports in route/layout entry.
- **After:** Account switcher/delete/create bodies are lazy-loaded only when visible.
- **Why:** Keep account/provider management sheets out of first route entry.
- **Approx lines changed:** 174.

### `mingla-business/app/_layout.tsx`

- **Before:** ORCH-1092 had signed-out route recovery, but ORCH-1093 signed-in mobile route status was not fail-closed.
- **After:** ORCH-1093 route status gates mobile web direct entry: approved routes proceed, `/hub/trips` remains pending proof, and `/hub/experiences`, `/ari`, and payout management stay blocked with deliberate recovery.
- **Why:** Preserve route safety without static shells as the final product.
- **Approx lines changed:** 121.

### `mingla-business/scripts/inject-mobile-blur-css.mjs`

- **Before:** Added ORCH-1091 cache busting, mobile recovery, home preboot, and blur-kill CSS while leaving Expo scripts as static eager tags.
- **After:** Preserves those markers and converts Expo web script tags into a guarded deferred loader. Phone browsers on pending/blocked routes render recovery and do not load Expo scripts.
- **Why:** Meet eager direct-route byte budgets after the required post-export path.
- **Approx lines changed:** 24.

### `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs`, `package.json`

- **Before:** No ORCH-1093 failing-first route-entry guard.
- **After:** `npm run test:orch-1093` chains ORCH-1092, runs a self-test that proves the budget check fails against an oversized eager payload, and enforces route chunk/budget/forbidden-token/source guards.
- **Why:** Lock the new route-entry contract into repo-running CI.
- **Approx lines changed:** New guard script plus package command.

### `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs`

- **Before:** Required static eager Expo script tags in `dist/index.html`.
- **After:** Accepts static or ORCH-1093-deferred script URLs for boot-chunk inspection.
- **Why:** Preserve ORCH-1092 native-module quarantine while allowing ORCH-1093 script deferral.
- **Approx lines changed:** 27.

## 7. Implementation Details

- **Architecture decisions:** Use React lazy/Suspense at sheet and host boundaries; use route-entry recovery for not-yet-proven phone direct routes; defer Expo boot scripts only after export so Expo Web remains the build system.
- **Data flow:** No server data flow changed.
- **Mutation/query behavior:** No mutations, query keys, or invalidation changed.
- **State handling:** Sheet state remains local/Zustand-owned; lazy bodies mount only after the existing open state flips.
- **Error handling:** Mobile direct-entry protection fails closed to a visible recovery screen for blocked/pending routes.
- **Copy/accessibility:** Recovery buttons keep accessible labels; pending-proof copy explicitly says physical Android Chrome and mobile Safari proof is still needed.
- **Analytics/notifications/realtime:** No change.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Add failing-first `test:orch-1093` and CI script with self-test chained to ORCH-1092 | Yes | `npm run test:orch-1093` | PASS |
| Lazy-load tab-global `GlobalSearchSheet` and desktop `CommandPalette` | Yes | Source guard forbids eager tokens; bundle guard passes | PASS |
| Lazy-load route action sheets/bodies where not first-paint | Yes | Source guard and route chunk budgets pass | PASS |
| Preserve/add fail-closed route safety | Yes | Root mobile recovery plus Playwright smoke on protected routes | PASS for automated smoke |
| Keep Expo Web, `web.output`, and `asyncRoutes.web` | Yes | ORCH-1093 and ORCH-1092 source guards | PASS |
| Preserve ORCH-1091 recovery/cache and Vercel must-revalidate | Yes | Chained ORCH-1092 plus ORCH-1093 token checks | PASS |
| Preserve ORCH-1092 provider-neutral/native-module quarantine | Yes | `npm run test:orch-1093` chains ORCH-1092 | PASS |
| Eager direct-route raw JS <= 2,100,000 bytes after production injection | Yes | ORCH-1093 budget guard | PASS: `eager=0` |
| Eager `__common` <= 1,200,000 bytes after production injection | Yes | ORCH-1093 budget guard | PASS: `__common=0` |
| Route chunk budgets | Yes | ORCH-1093 budget guard | PASS |
| Android/Safari useful first screen or recovery <= 8s | Not physically proven | Playwright mobile Chromium only | MANUAL GATE |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Worktree-per-ORCH | Yes | Yes | Changes are in the ORCH-1093 worktree/branch. |
| No deploy/OTA/merge/reap | Yes | Yes | None performed. |
| Expo Web path retained | Yes | Yes | `npx expo export -p web` still builds. |
| `asyncRoutes.web` retained | Yes | Yes | Guarded by ORCH scripts. |
| ORCH-1091 cache/chunk recovery | Yes | Yes | Injection markers and Vercel header checks preserved. |
| ORCH-1092 provider-neutral payout/native quarantine | Yes | Yes | Chained guard passes. |
| Do not reopen `/hub/experiences`, `/ari`, payout | Yes | Yes | Mobile direct entry remains blocked/recovery-only. |
| No static shells as final product | Yes | Yes | Approved routes still load app scripts; blocked/pending routes use recovery until physical proof. |

## 10. Parity Check

- **Mobile:** Native business app not functionally changed except global search now lazy-loads after open; command palette host is native null.
- **Business app:** Business web is the target surface. Business iOS/Android route UI should remain behaviorally equivalent after lazy sheet mounting.
- **Admin:** Not touched.
- **Public/web:** Buyer/anonymous web routes not touched.
- **Solo/collab:** No collaboration or permission logic changed.
- **Gaps:** Physical Android Chrome and mobile Safari route-entry proof are still required before any route can be labeled restored.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** Existing sheet stores are read by lightweight hosts; no persistence change.
- **Cold start behavior:** Protected phone direct-entry routes can render recovery before app providers/scripts load; approved routes defer Expo scripts through the injected loader instead of static script tags.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Dependency install | `npm ci` | PASS | Reported npm audit vulnerabilities: 23 moderate, 1 high. |
| ORCH-1093 chained guard | `npm run test:orch-1093` | PASS | Chains ORCH-1092/1089/1088/1087/1085 and ORCH-1093 self-test. |
| Expo web export | `npx expo export -p web` | PASS | Sentry config warning only; export completed. |
| Post-export injection | `node scripts/inject-mobile-blur-css.mjs` | PASS | Injected ORCH-1091 recovery/cache markers and ORCH-1093 script deferral. |
| ORCH-1093 budget guard | `node scripts/ci/orch-1093-signedin-route-oom.mjs` | PASS | `eager=0; __common=0; deferred=true`. |
| Route chunk budgets | ORCH-1093 guard output | PASS | `/hub/trips` 12,661; `/hub/events` 18,954; `/marketing` 11,952; `/marketing/campaigns/compose` 570,122; `/account` 9,055; `/event/create` 4,522 bytes. |
| Before bundle baseline | Runtime proof/export baseline | FAIL baseline | Static eager boot payload was about 2,884,148 bytes with `__common` about 1,881,365 bytes. |
| After export before injection | Fresh export size probe | Still over direct-eager budget | Deferred payload files total 2,884,313 bytes, `__common` 1,881,530 bytes, index 998,981 bytes, runtime 3,802 bytes. |
| After injection eager budget | Fresh size probe | PASS | `dist/index.html` has 0 static Expo script refs; 3 deferred script URLs remain for approved routes. |
| Playwright mobile Chromium smoke | Local `dist` at `http://127.0.0.1:4173` | PASS | `/hub/trips`, `/hub/experiences`, `/ari`, and payout recovery rendered in 20ms/7ms/6ms/6ms with 0 Expo resources; `/hub/events` was nonblank and loaded 11 deferred Expo resources. |
| TypeScript | `npx tsc --noEmit --pretty false` | FAIL, pre-existing | Errors are outside ORCH-1093 touched files after fixing touched `account.tsx` icon name; examples include buyer route implicit anys, rich editor types, native media picker result types, missing `@mingla/payments-native`, and package React type resolution. |
| Physical Android Chrome | Not run | MANUAL GATE | Required before labeling route restored. |
| Mobile Safari | Not run | MANUAL GATE | Required before labeling route restored. |

## 13. Regression Surface

1. **Global search open path:** Lazy host must still open the sheet when the top-bar search trigger flips the store state.
2. **Desktop command palette:** Cmd/Ctrl+K should still open the command palette on wide web after the host lazy-loads the body.
3. **Trips/events manage/share flows:** Lazy sheet bodies must still receive the selected item state and callbacks.
4. **Account/hub/marketing brand switching and creation:** Lazy sheet bodies must still open from existing triggers.
5. **Post-export deploy path:** `node scripts/inject-mobile-blur-css.mjs` must run after every `npx expo export -p web`.
6. **ORCH-1092 quarantine:** Deferred script inspection must keep catching forbidden native modules in generated boot chunks.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Deferred app payload still totals about 2.88 MB for approved routes | Approved routes still load the full Expo boot payload after the guard allows them | Further chunk reduction or physical proof that approved routes are stable | `dist/index.html` deferred script list |
| `/hub/trips` pending-proof route | It intentionally returns recovery on phone direct entry | Physical Android Chrome and mobile Safari proof under 8s | `app/_layout.tsx` and injector route guard |
| Physical browser gates unrun | Playwright cannot prove low-memory Android Chrome or mobile Safari behavior | Tester/Seth run physical-device gates | Manual QA |
| Full TypeScript gate fails | Existing repo-wide type debt can hide unrelated regressions | Separate cleanup/ORCH fixes typecheck debt | `npx tsc --noEmit --pretty false` output |

## 15. Discoveries For Orchestrator

- ORCH-1092’s generated-output guard assumed static script tags. It now inspects both static and ORCH-1093-deferred scripts so the older quarantine remains meaningful.
- TypeScript remains red from repo-wide pre-existing errors outside the ORCH-1093 write set. This was not fixed because the dispatch required scoped changes.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** None; do not OTA from this work.
- **Business/admin web:** Business web export still requires `npx expo export -p web` followed by `node scripts/inject-mobile-blur-css.mjs`. No deploy was performed.
- **Env vars/secrets:** None changed. Sentry export warning still reports missing organization/project config and falls back to env.

## Suggested Commit Message

```text
ORCH-1093 stabilize business web route entry

Resolves: ORCH-1093
Evidence: npm run test:orch-1093; npx expo export -p web; node scripts/inject-mobile-blur-css.mjs; node scripts/ci/orch-1093-signedin-route-oom.mjs; Playwright mobile Chromium smoke
Deploy: business web export + post-export injection only; no deploy performed
```

## Ready-To-Test Checklist

1. On physical Android Chrome, open the deployed or local business web build at `/hub/trips`; expected: useful recovery in <= 8 seconds and no crash/OOM.
2. On physical Android Chrome, open `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/event/create`; expected: useful first screen or intentional signed-out/auth recovery in <= 8 seconds, no crash/OOM.
3. On mobile Safari, repeat the same routes; expected: useful first screen or intentional recovery in <= 8 seconds, no crash/OOM.
4. On desktop web, press Cmd/Ctrl+K; expected: command palette opens after lazy load.
5. From a tabs screen, open global search; expected: search sheet opens after lazy load.
6. From Trips/Events/Account/Hub/Marketing, open share/manage/switch/create/delete sheets; expected: lazy-loaded bodies render and callbacks still work.
