# QA - ORCH-1092 Business Web Restoration Wave Retest

Date: 2026-06-06
Mode: RETEST / SPEC-COMPLIANCE / BUSINESS WEB RUNTIME SMOKE
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]`
Branch: `ORCH-1092-business-web-restoration-wave`
Rework commit: `574d59a78b31b26d7c37ab56fbf78b5f7f63a039`

## Verdict

FAIL.

The exported eager-boot native/provider blocker from the first QA report is fixed: fresh export + injection + `npm run test:orch-1092` passed, `dist/index.html` now eagerly loads `__expo-metro-runtime`, `__common`, and `index` chunks that are clean for the forbidden native/provider module set, and the only exported Stripe Connect hit is isolated to a lazy `StripeConnectPages` route chunk. The remaining blocker is runtime: local mobile-browser proof for the reopened unsigned routes still did not render the intended signed-out recovery. Chromium showed an empty Expo root for `/hub/events` at 1s and 3s, then crashed the page target; the Home click smoke timed out waiting for `Sign in to open Hub Events.`

## Findings

### P1 - Signed-out reopened routes still fail the "not blank" browser gate

Spec impact: fails the explicit retest dispatch requirement to verify signed-out is not blank, and fails SPEC sections 4.B, 4.C, 4.D, 4.E, 6, and 9 for local/phone-browser proof before close.

Evidence:

- Source contains the intended signed-out recovery route list and fallback UI in `mingla-business/app/_layout.tsx:116-160`.
- Source gates that recovery on `Platform.OS === "web" && !loading && user === null && ORCH_1092_SIGNED_OUT_ROUTES.has(pathname)` in `mingla-business/app/_layout.tsx:250-261`.
- `AuthProvider` should fall through as anon after the 3s `getSession()` race timeout in `mingla-business/src/context/AuthContext.tsx:182-197`.
- The exported route layout chunk contains the recovery strings (`Sign in to open`, `Return to Home`), proving the code is bundled.
- Runtime proof failed:
  - Chromium Pixel 5 direct `/hub/events`: at 1s and 3s, `bodyText` was empty, `#root` had one child, and `#root.innerHTML` was `<div class="css-g5y9jx r-13awgt0"></div>`.
  - Chromium Pixel 5 static Home click to Events reached `/hub/events` but timed out after 25s waiting for `Sign in to open Hub Events.`
  - Chromium Pixel 5 after 12s on `/hub/events`: `page.evaluate: Target crashed`.
  - WebKit iPhone 12 diagnostic hung and had to be terminated; after termination it returned `page.evaluate: Target page, context or browser has been closed`.

Why this blocks release:

The rework specifically added a signed-out recovery branch to avoid the previous blank local-route result. The retest shows the local unsigned route still blanks/crashes before that recovery is visible, so the restored static Home links are not yet safe for unauthenticated phone-browser entry. A signed-in session was unavailable, so signed-in useful first-screen proof remains a manual gate, but unsigned recovery already fails independently.

Required rework:

1. Make the four reopened web routes render a visible recovery/error/sign-in state before any boot/auth/provider/brand work can leave `#root` empty.
2. Add a Playwright or equivalent runtime regression that opens `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, and `/account` with no stored session and asserts visible recovery text within a bounded timeout.
3. Re-run the exact source/export commands and local mobile Chromium/WebKit smoke before returning to tester.

## Verified Fixed Evidence

### Exported eager boot chunks

Command:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1092
```

Result: PASS. Expo emitted 128 web bundles; injection logged `mobile chunk recovery + preboot + blur-kill`; ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, strengthened ORCH-1092 guard, and six ORCH-1092 Jest checks passed.

Independent `dist/index.html` eager script inspection:

```text
__expo-metro-runtime-0c48b0beee2d3ce6030b475fcc5b1846.js clean
__common-bade1a263843bb5d6943459ee1a92391.js clean
index-673ede93709fe16629641db487c64add.js clean
```

Forbidden set checked: `expo-image-picker`, `expo-file-system`, `expo-file-system/legacy`, `@react-native-community/datetimepicker`, `react-native-keyboard-controller`, `@stripe/connect-js`, `@stripe/react-connect-js`, `react-native-video-trim`, `react-native-compressor`.

### Full exported web JS forbidden grep

Command:

```bash
rg -n "expo-image-picker|expo-file-system/legacy|expo-file-system|@react-native-community/datetimepicker|react-native-keyboard-controller|@stripe/connect-js|@stripe/react-connect-js|react-native-video-trim|react-native-compressor" dist/_expo/static/js/web/*.js
```

Result: one exported-hit family only:

```text
dist/_expo/static/js/web/StripeConnectPages-6dda120305b68cff49e7d6f9cbd18ec9.js
```

Classification: allowed lazy Stripe route chunk. It is not loaded by `dist/index.html`, static Home does not link to `/connect-account-management`, and payout remains shelled. The eager boot chunks and reopened route-token chunks are clean.

### Static Home reopen map and shell map

Verified in both `public/home.html` and `dist/home.html`:

| Static Home item | Result |
|---|---|
| Hub Events | Reopened to `/hub/events` with `data-orch-1092-hub-events-reopened="true"` |
| Marketing overview | Reopened to `/marketing` with `data-orch-1092-marketing-overview-reopened="true"` |
| Compose blast | Reopened to `/marketing/campaigns/compose` with `data-orch-1092-compose-shell-reopened="true"` |
| Account settings | Reopened to `/account` with `data-orch-1092-account-reopened="true"` |
| Payout account | Remains `#payout-account` shell with generated-session copy |
| Hub Experiences | Remains `#hub-experiences` shell |
| Hub Trips | Remains `#hub-trips` shell |
| Ari | Remains `#ari-assistant` shell |

Local Chromium static-shell smoke passed:

```text
Experiences path=/home hash=#hub-experiences hasCopy=true
Trips path=/home hash=#hub-trips hasCopy=true
Ari path=/home hash=#ari-assistant hasCopy=true
Payout path=/home hash=#payout-account hasCopy=true
```

Provider-neutral copy remains present: `Payout account`, `Requires a generated secure session`, and no static Home `Stripe account`, `Connect Stripe`, or `Payments & Stripe` hits.

### Platform quarantine wrappers

Verified source shape:

- Web stubs in `src/utils/platformImagePicker.ts` return denied/canceled results without importing `expo-image-picker`.
- Native implementations in `src/utils/platformImagePicker.native.ts` dynamically import `expo-image-picker`, preserving native source resolution.
- Web stubs in `src/utils/platformFileSystem.ts` return safe unavailable behavior without importing `expo-file-system`.
- Native implementations in `src/utils/platformFileSystem.native.ts` dynamically import `expo-file-system/legacy`, preserving native file reads/uploads.
- Cover picker/file reader helpers follow the same `.native` split pattern.

Source grep note: non-reopened or closed route-family files still contain forbidden-module strings in comments and native/closed source paths, such as event/trip creator DateTimePicker files and group-chat keyboard controller. The strengthened export proof is the decisive web check here: those modules did not enter eager boot chunks or the reopened route-token chunks.

## Claim Table

| Claim | Status | Evidence |
|---|---:|---|
| `npm run test:orch-1092` passes before export | VERIFIED | Command passed; ORCH-1085/1087/1088/1089 chain plus ORCH-1092 guard and Jest passed. |
| Fresh export + injection + `npm run test:orch-1092` passes | VERIFIED | Command passed after `rm -rf dist`; 128 web bundles emitted. |
| Eager boot chunks include `__common`, `__expo-metro-runtime`, and `index` and are clean | VERIFIED | Independent script parsed `dist/index.html`; all three eager chunks clean for the forbidden set. |
| All exported web JS is clean except allowed lazy Stripe route chunk | VERIFIED | `rg` hit only `StripeConnectPages-*.js`; classified as lazy/non-Home payout chunk. |
| Static Home reopen map is correct | VERIFIED | Source/export grep; Events/Marketing/Compose/Account reopened with markers; Experiences/Trips/Ari/Payout shelled. |
| Payout shell/provider-neutral copy preserved | VERIFIED | Source/export grep and shell click smoke. |
| Signed-out local route recovery is visible | REFUTED | Chromium `/hub/events` showed empty root and then page target crash; Home click timed out waiting for recovery text. |
| Signed-in useful first screens work | UNVERIFIED | No signed-in business session fixture was available. Manual phone gate remains. |
| Composer subject/body/schedule/review works | UNVERIFIED | Requires signed-in route content; not reachable in this unsigned local smoke. |

## Platform Matrix

| Surface | Result | Evidence |
|---|---:|---|
| Business Web source/export | PASS for former native/provider blocker | Required commands passed; eager chunks clean; only lazy Stripe chunk hit. |
| Chromium Pixel 5 local export | FAIL | Static Home shells passed; reopened unsigned route `/hub/events` stayed empty and then target crashed. |
| WebKit iPhone 12 local export | FAIL/UNVERIFIED | Diagnostic hung on reopened route and had to be killed; no visible recovery proof. |
| Signed-in phone Chrome/Safari | MANUAL GATE | No signed-in business session fixture available in this worktree. |
| Native iOS/Android | N/A source-preserved | Web restoration only; `.native` picker/filesystem splits preserve native resolution by source. |
| Admin/Supabase/provider | N/A | No admin, DB, edge, migration, deploy, or provider payload changes. |

## Commands Run

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
npm run test:orch-1092
```

Result: PASS.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/mingla-business"
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1092
```

Result: PASS.

```bash
node <inline parser for dist/index.html eager script srcs>
```

Result: `__expo-metro-runtime`, `__common`, and `index` eager chunks clean.

```bash
rg -n "expo-image-picker|expo-file-system/legacy|expo-file-system|@react-native-community/datetimepicker|react-native-keyboard-controller|@stripe/connect-js|@stripe/react-connect-js|react-native-video-trim|react-native-compressor" dist/_expo/static/js/web/*.js
```

Result: only `StripeConnectPages-*.js`, classified as allowed lazy Stripe route chunk.

```bash
node <inline local export server on port 4192>
```

Result: served `http://localhost:4192`; `/home` mapped to `dist/home.html`, unknown app routes mapped to `dist/index.html`, and web JS served with must-revalidate cache headers.

```bash
node <inline Playwright Chromium Pixel 5 static-shell smoke>
```

Result: Experiences, Trips, Ari, and Payout shells remained on `/home` hash routes and showed expected shell copy.

```bash
node <inline Playwright Chromium Pixel 5 reopened-route smoke>
```

Result: failed. Static Home click reached `/hub/events` but timed out waiting for `Sign in to open Hub Events.`

```bash
node <inline Playwright Chromium Pixel 5 direct-route diagnostic>
```

Result: at 1s and 3s, body text was empty and root was `<div class="css-g5y9jx r-13awgt0"></div>`; after 12s, `page.evaluate: Target crashed`.

```bash
node <inline Playwright WebKit iPhone 12 direct-route diagnostic>
```

Result: hung and was terminated; returned `page.evaluate: Target page, context or browser has been closed`.

## Regression Coverage Assessment

Regression coverage for the old exported native-module blocker is now adequate:

- The ORCH-1092 guard parses `dist/index.html`.
- It requires eager boot chunks to exist.
- It inspects `__common`.
- It rejects the forbidden native/provider module set in eager boot chunks.
- It scans web source for static picker/filesystem imports outside `.native` files.

Regression coverage for the remaining runtime blank-state blocker is not adequate:

- Jest checks only prove the signed-out recovery source exists.
- No repo-running browser test proves the recovery actually renders in an unsigned mobile browser profile.
- The bug would currently return despite the source/Jest checks, because local Chromium still blanks/crashes before visible recovery.

## Manual Phone Gates

These remain required after rework fixes the unsigned local route blank:

1. Phone Chrome signed in to a valid business session: open `http://localhost:4192/home` or the branch preview Home, then tap Events, Marketing overview, Compose blast, and Account settings.
2. Confirm each reaches a useful first screen, then refresh, Back to Home, and reopen without blank page, stale chunk loop, infinite spinner, or native-module error.
3. Composer: type subject/body, open schedule, choose date/time, open review/preview shell, and verify visible save/error handling.
4. Payout: confirm static Home remains shelled and never opens `/connect-account-management`.
5. Repeat on iPhone Safari or Playwright WebKit mobile after the unsigned recovery is fixed.

## Downstream Routing

Route back to Codex `implementor-mingla` for bounded rework. Required output: fix the reopened unsigned route blank/crash so `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, and `/account` render visible recovery with no stored session; add a repo-running browser/runtime regression or equivalent; preserve the now-fixed eager chunk quarantine; rerun `npm run test:orch-1092`, fresh export + injection + `npm run test:orch-1092`, and mobile-profile smoke; then produce an updated implementation report and return to tester for retest.
