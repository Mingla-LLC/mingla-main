# Implementation Report: Business Web Restoration Wave (ORCH-1092)

> Date: 2026-06-06
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
> Status: reworked and verified for automated/export gates; signed-in phone Chrome/Safari remains a tester manual gate

## 1. Layman Summary

Business Web static Home now opens the next approved phone-browser routes: Hub Events, Marketing overview, Marketing Composer, and Account settings. Payout account remains safely shelled because it still needs a generated secure session, and the Composer schedule flow now uses browser-native date/time controls on web instead of the native picker that could enter the web route.

## 2. Request And Context

- **Request:** Implement the bounded ORCH-1092 wave: guard first, reopen only proven route families, preserve ORCH-1091 cache guards, keep payout shelled, and avoid backend/provider changes.
- **Source:** Investigation and spec listed above.
- **Affected surfaces:** Business Web phone browsers and desktop web compatibility for the same routes.
- **Related artifacts:** `INVESTIGATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`, `CLOSE_ORCH-1091_BUSINESS_WEB_MOBILE_CACHE_INVALIDATION.md`, ORCH-1087/1088/1089 guard scripts.

## 3. Scope

- **In scope:** Static Home relinks for Account, Hub Events, Marketing overview, Composer shell; web schedule-picker split; guard and Jest coverage; provider-neutral payout copy.
- **Out of scope:** Payout account generated-session route, Hub Experiences, Hub Trips, Ari, Scanner, buyer checkout, Supabase, edge functions, migrations, provider payloads, deploy/merge/reap/OTA.
- **Assumptions:** Exported Expo Web chunks are the correct local proof target before phone-browser QA; phone Chrome/Safari runtime must be independently tested by tester on a preview or local export server.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry gate | No open BLOCK; WARNs factored and acknowledged on main commit `c2dcc4366`. |
| `public/home.html` | Static Home route source | Non-Create routes were shelled before this wave. |
| `vercel.json` | Rewrite/cache contract | `/home` precedes catch-all; web JS cache header remains must-revalidate. |
| `scripts/inject-mobile-blur-css.mjs` | ORCH-1091 script guard | Preboot, chunk recovery, blur-kill, and `?v=orch1091` markers preserved. |
| `scripts/ci/orch-1087/1088/1089*.mjs` | Existing guard chain | Needed marker-aware allow rules for ORCH-1092 relinks. |
| `app/(tabs)/hub/events.tsx` | Reopened Hub route | Uses Events list/filter/share/manage; no eager forbidden native imports found. |
| `app/(tabs)/marketing/index.tsx` | Reopened Marketing route | Overview has loading/error/empty/populated states and opens composer. |
| `app/(tabs)/marketing/campaigns/compose.tsx` | Reopened Composer route | Imports `SchedulePickerSheet`; rich editor remains web-split. |
| `app/(tabs)/account.tsx` | Reopened Account route | Has brand loading/error/empty/settings/sign-out/brand switcher states. |
| `src/components/marketing/ComposerV2/SchedulePickerSheet.tsx` | Schedule blocker | Direct native DateTimePicker import was the route-family blocker. |
| `src/components/brand/BrandPaymentsView.tsx` | Payout copy | Existing account-management path creates a session; visible payout copy needed neutral wording. |

## 5. Blast Radius

- **Direct changes:** Business Web static Home, route guard scripts, marketing schedule picker split, payout copy, package test script.
- **Cascade changes:** ORCH-1087/1088/1089 guards now allow only ORCH-1092-marked direct relinks.
- **Parity surfaces:** Native iOS/Android schedule behavior preserved through `SchedulePickerSheet.native.tsx`.
- **Cache impact:** No change to Expo web output, async routes, Vercel rewrites, or ORCH-1091 injection.
- **State boundaries:** No React Query/Zustand/data-shape changes.
- **Auth/RLS/security:** No backend, Supabase, RLS, or provider mutations.
- **Deploy path:** Merge through PR to `main`; deploy web only from merged `main`.

## 6. Old To New Receipts

### `mingla-business/public/home.html`

- **Before:** Hub Events, Marketing overview, Compose blast, Account settings, and Payout account all used hash shells.
- **After:** Hub Events opens `/hub/events`; Marketing overview opens `/marketing`; Compose opens `/marketing/campaigns/compose`; Account settings opens `/account`; Payout account remains `#payout-account`.
- **Why:** Restores bounded phone-browser handoffs while avoiding sessionless payout management.
- **Approx lines changed:** 5 anchor/copy rows.

### `SchedulePickerSheet.tsx` and `SchedulePickerSheet.native.tsx`

- **Before:** Shared schedule sheet statically imported `@react-native-community/datetimepicker`.
- **After:** Web sheet uses hidden browser-native `input type="date"` and `input type="time"` triggered from the visible pills; native keeps the original DateTimePicker implementation in `.native.tsx`.
- **Why:** Keeps native picker behavior while preventing the native picker module from entering the reopened web composer route.
- **Approx lines changed:** Web implementation replaced; native file added from prior implementation.

### Guard and test files

- **Before:** ORCH-1087/1088/1089 scripts rejected every non-Create static Home direct route.
- **After:** Prior guards allow only ORCH-1092-marked routes; new `orch-1092-business-web-restoration-wave.mjs` checks relink markers, payout shell, provider-neutral copy, ORCH-1091 cache/script markers, source imports, and exported route chunks.
- **Why:** Encodes the new restoration contract without weakening cache/header/script guards.
- **Approx lines changed:** 3 existing scripts updated; 1 new script and 1 Jest test added.

### `BrandPaymentsView.tsx`

- **Before:** Account-management card said “Stripe account alerts,” “Stripe account management,” and “Opening Stripe...”.
- **After:** User-facing payout-management copy says “payout account alerts,” “payout account management,” and “Opening...”.
- **Why:** Preserve provider-neutral payout copy while leaving internal Stripe session logic untouched.
- **Approx lines changed:** 3 user-facing strings.

## 7. Implementation Details

- **Architecture decisions:** Kept Expo Web and static Home; did not create a parallel web app or touch backend/provider code.
- **Data flow:** No data flow changes.
- **Mutation/query behavior:** No query keys, invalidations, or mutations changed.
- **State handling:** Schedule sheet still seeds from `initialIso` and returns local ISO on Continue.
- **Error handling:** Payout direct route remains blocked; account-management errors still show an inline retry message.
- **Copy/accessibility:** Reopened anchors keep existing visible labels; web schedule inputs carry `aria-label`s.
- **Analytics/notifications/realtime:** Not touched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Guard extension first | New ORCH-1092 guard and existing guard updates | `npm run test:orch-1092` | PASS |
| Account settings reopened | `/account` relink with `data-orch-1092-account-reopened` | Guard + Jest + export grep | PASS |
| Hub Events reopened | `/hub/events` relink with `data-orch-1092-hub-events-reopened` | Guard + chunk scan | PASS |
| Marketing overview reopened | `/marketing` relink with marker | Guard + Jest | PASS |
| Composer shell reopened | `/marketing/campaigns/compose` relink with marker | Guard + Jest + compose chunk scan | PASS |
| Payout account not sessionless | Kept `#payout-account` shell | Guard + Jest | PASS |
| Hub Experiences/Trips remain closed | Kept hash shells | Guard + Jest | PASS |
| ORCH-1091 cache/script guards preserved | No rewrite/header/injection changes | `test:orch-1092` and export test | PASS |
| Provider-neutral payout copy | Static Home and payout-management copy preserved/updated | Jest + source grep | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Comms ledger entry gate | Yes | Yes | Acknowledged active WARNs on main commit `c2dcc4366`. |
| Worktree-per-ORCH | Yes | Yes | Product/report edits made in ORCH-1092 worktree after accidental anchor edits were immediately reverted. |
| No deploy/merge/reap/OTA | Yes | Yes | None performed. |
| Regression tests move with behavior | Yes | Yes | `test:orch-1092` and focused Jest test added. |
| ORCH-1091 cache/header/script guards | Yes | Yes | Header and injection markers checked before and after export. |
| Provider-neutral payout copy | Yes | Yes | No static Home provider-specific payout copy. |

## 10. Parity Check

- **Mobile:** Native iOS/Android schedule picker behavior preserved through `.native.tsx`; no native app behavior otherwise changed.
- **Business app:** Business Web static Home and route chunks changed.
- **Admin:** Not touched.
- **Public/web:** Buyer/public routes not touched; Business Web only.
- **Solo/collab:** Not touched.
- **Gaps:** Real phone Chrome/Safari smoke not run in this session; remains tester gate.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Static Home remains static; ORCH-1091 preboot/chunk recovery/cache-bust markers verified.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Focused ORCH-1092 guard | `node scripts/ci/orch-1092-business-web-restoration-wave.mjs` | PASS | Source + optional dist checks. |
| Focused ORCH-1092 Jest | `npx jest src/utils/__tests__/orch_1092_business_web_restoration_wave.test.ts --runInBand` | PASS, 4 tests | Home markers, payout shell/copy, schedule split, source imports. |
| Full source chain | `npm run test:orch-1092` | PASS | ORCH-1085/1087/1088/1089 + ORCH-1092 chain passed. |
| Fresh export | `rm -rf dist && npx expo export -p web --output-dir dist` | PASS | Sentry config warning only; 128 web bundles emitted. |
| Post-export injection + full chain | `node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1092` | PASS | Injection logged mobile chunk recovery + preboot + blur-kill. |
| Exported chunk scan | `rg` over `compose-*.js`, `events-*.js`, `account-*.js` | PASS | No forbidden native/provider module hits; chunk sizes: compose 570302, events 18456, account 8582 bytes. |
| TypeScript sanity | `npx tsc --noEmit --pretty false` | FAIL, unrelated existing repo errors | No new ORCH-1092 files in error list. Examples: pre-existing `account.tsx` icon name, checkout implicit anys, package type resolution, rich editor type issues. |
| Browser smoke | Browser plugin attempted | NOT RUN | Node/browser-control runtime was not exposed after tool discovery; phone/manual gates remain. |

## 13. Regression Surface

1. Static Home route firewall: direct relinks could accidentally expand beyond approved routes.
2. Marketing Composer schedule path: web/native platform resolution must keep native DateTimePicker out of web.
3. Payout account: sessionless `/connect-account-management` must remain blocked.
4. ORCH-1091 cache recovery: web JS cache-bust and chunk recovery must stay present after export.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Phone Chrome/Safari runtime smoke not run | Automated source/export proof does not prove real phone route rendering, auth state, back/refresh, or keyboard/schedule behavior | Tester runs phone Chrome and iPhone Safari smoke on preview or local export server | Spec §6 |
| TypeScript repo pass remains red | Existing repo-wide TS failures can hide future regressions if not addressed by a broader cleanup | Separate TS debt ORCH or scoped typecheck target | `npx tsc --noEmit` output |
| Payout account still shelled | Users cannot jump directly from static Home to payout management | Future generated-session route/button with provider-doc-compliant tests | Static Home payout shell |

## 15. Discoveries For Orchestrator

- No cross-ORCH discovery requiring a new COMMS entry.
- Existing repo-wide `npx tsc --noEmit` failures remain outside this wave; recommend orchestrator decide whether to track separately if not already covered.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** None.
- **Business/admin web:** Do not deploy from this worktree. Merge PR to `main`, verify `origin/main` contains the squash commit and changed files, then deploy Business Web from merged `main` only.
- **Env vars/secrets:** None.

## 17. FAIL-QA Rework - 2026-06-06

### Rework Outcome

The P1 exported-boot blocker is fixed by real quarantine, not allowlisting. `test:orch-1092` now parses `dist/index.html`, follows the eager boot scripts, requires `__common` to be inspected, and fails if any eager boot chunk contains the forbidden native/provider module set. A stale pre-rework export reproduced QA's failure exactly: `__common-d9f97e2fbdb5d37a3cce7b864b0d8057.js` contained `expo-image-picker`.

The P1 local unsigned-route blank state is partially addressed in code with a narrow web-only signed-out recovery branch for `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, and `/account`. It renders after auth bootstrap when `user === null`, shows `Sign in to open <route label>.`, and returns to `/home`; signed-in sessions still flow to the real route. Local Playwright browser proof remained blocked because Chromium crashed the page target and WebKit/Chromium contexts closed before stable evaluation; tester should retest on a stable branch preview or real phone browser with a valid business session.

### Files Changed In Rework

| File / group | Change | Why |
|---|---|---|
| `scripts/ci/orch-1092-business-web-restoration-wave.mjs` | Added eager `dist/index.html` script parsing, `__common` inspection, all-web-source static picker/filesystem import scan, and expanded route-family source scan. | Closes the QA gap where route-token scans missed `__common`. |
| `src/utils/__tests__/orch_1092_business_web_restoration_wave.test.ts` | Added checks for media quarantine helpers and signed-out route recovery. | Encodes the new failure contract in repo-running tests. |
| `src/utils/platformImagePicker.*`, `src/utils/platformFileSystem.*` | Added web stubs and native implementations. | Keeps Expo picker/filesystem packages out of web boot while preserving native behavior. |
| `src/components/ui/coverPickerDeviceMedia.*`, `src/components/ui/coverPickerFileInfo.*` | Added CoverPicker-specific platform helpers. | Prevents CoverPicker media code from pulling picker/filesystem into web common chunks. |
| File readers: `eventCoverFileReader.*`, `brandCoverFileReader.*`, `creatorAvatarFileReader.*`, `brandAvatarFileReader.*` | Split native Expo filesystem reads from web `fetch(...).arrayBuffer()` readers. | Removes shared static `expo-file-system` imports from web bundle paths. |
| Picker call sites in account/profile, avatar, venue gallery, experience snap/photo, group chat, intake, and CoverPicker | Replaced direct `expo-image-picker` / filesystem imports with platform helpers. | Quarantines all non-native static picker/filesystem imports under `app/` and `src/`. |
| `app/_layout.tsx` | Added ORCH-1092 web-only signed-out recovery for the four reopened routes. | Ensures unsigned local route access has bounded recovery instead of an empty root in source contract. |

### Verification Receipts

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
npm run test:orch-1092
```

Result: PASS. ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, the strengthened ORCH-1092 guard, and six ORCH-1092 Jest checks passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1092
```

Result: PASS. Expo emitted 128 web bundles; injection logged `mobile chunk recovery + preboot + blur-kill`; the strengthened test passed after export.

```bash
rg -l "expo-image-picker|expo-file-system|expo-file-system/legacy" dist/_expo/static/js/web/*.js || true
```

Result: no output.

```text
dist/_expo/static/js/web/__expo-metro-runtime-0c48b0beee2d3ce6030b475fcc5b1846.js: clean
dist/_expo/static/js/web/__common-bade1a263843bb5d6943459ee1a92391.js: clean
dist/_expo/static/js/web/index-673ede93709fe16629641db487c64add.js: clean
```

The clean check above covers `expo-image-picker`, `expo-file-system`, `expo-file-system/legacy`, `@react-native-community/datetimepicker`, `react-native-keyboard-controller`, Stripe Connect web SDKs, `react-native-video-trim`, and `react-native-compressor` across every eager script loaded by `dist/index.html`.

### Browser Smoke Status

Local static Home and closed shell links rendered before the rework; after the rework, local browser automation became unstable:

- Chromium Pixel 5 route evaluation crashed with `page.evaluate: Target crashed`.
- Chromium/WebKit longer runs closed the page/context before evaluation.
- No signed-in session fixture was available in this worktree.

Therefore, browser proof is **blocked by local Playwright/browser instability**, not claimed as pass. Tester retest must verify a stable branch preview or local export server with signed-in Chrome/Safari: Events, Marketing overview, Compose, and Account should reach useful signed-in first screens; signed-out direct route access should show the new recovery screen; Payout, Hub Experiences, Hub Trips, and Ari must remain shelled.

### Remaining Risks

- The signed-in route first-screen proof is still pending independent tester verification.
- Native picker/filesystem behavior is preserved through `.native` splits by source/export proof, but native runtime was not re-smoked because this ORCH is Business Web scoped.
- Local Playwright instability limited runtime proof; use a stable preview/real phone for retest.

## Suggested Commit Message

```text
ORCH-1092: restore bounded business web routes

Resolves: ORCH-1092
Evidence: npm run test:orch-1092; expo export + inject + npm run test:orch-1092
Deploy: merge to main first, then deploy Business Web from merged main only
```

## Ready-To-Test Checklist

1. Start a local export server if using this worktree: `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business" && npx serve dist -s -l 4192`, then open `http://localhost:4192/home`.
2. Phone Chrome: tap Events, Marketing overview, Compose blast, and Account settings from static Home; each should reach a useful first screen without a blank page or native-module error.
3. Phone Chrome: tap Payout account; it should stay on the static shell and explain that payout management needs a generated secure session.
4. Phone Chrome Composer: type subject/body, open Schedule, choose date/time, open review/preview shell, then Back/refresh/re-enter.
5. Repeat the same smoke on iPhone Safari or Playwright WebKit mobile fallback before production release.
