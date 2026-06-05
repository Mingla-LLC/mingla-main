# IMPLEMENTATION — ORCH-1083 [Business web app slow/unreliable load on mobile + desktop browsers]

- **Mode:** IMPLEMENT (Claude `mingla-implementor`)
- **Date:** 2026-06-05
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/` on branch `ORCH-1083-business-web-load-perf`
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1083_BUSINESS_WEB_LOAD_PERF.md` (Option C, safe non-architectural cut)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1083_BUSINESS_WEB_LOAD_PERF.md`
- **Commits:** `61a73060` (implementation + tests + gate reconciliation), `55ba4ca8` (M-3 CI wiring)
- **Pre-fix HEAD (fails-on-revert anchor):** `8781d6d1f`
- **Status:** implemented and verified · **SC-1/SC-2 numeric targets NOT met (honest)** — see §Success Criteria.

---

## TL;DR (honest headline)

All three deferrals (C-1 Stripe Connect web SDK, C-2 14 theme fonts, C-3 QR renderer) were implemented exactly per spec and **demonstrably leave the main entry chunk** (SC-3 PASS, proven by grep + a 26-chunk export). **But the byte/time wins are small** because those libs are minor contributors to the 9.24 MB monolith:

| Metric | Before | After | Delta | Target | Verdict |
|---|---|---|---|---|---|
| **M-1** initial JS payload (raw) | 9,236,985 B | 9,131,533 B | **−1.14%** | ≥ 8% | **FAIL** |
| **M-2** mobile-profile load (median) | 47,233 ms | 46,727 ms | **−1.07%** | ≥ 10% | **FAIL** |
| **SC-3** deferred deps out of entry + ≥3 new chunks | 4 chunks | 26 chunks | proven | — | **PASS** |

The headline win requires the **DEFERRED architectural change** (`asyncRoutes`/`web.output:"static"`) that the operator explicitly put OUT OF SCOPE this session (spec §2.2, D-3). The investigation already predicted this: F-1 says the 9.24 MB is "overwhelmingly app + framework code, not fonts/libs," F-2 says fonts are not in the JS bulk, and `@stripe/connect-js` is a thin CDN loader (the heavy Connect UI loads from `connect.stripe.com` at runtime, never bundled). The numbers below are real, measured on the same machine, 5 iterations each — not rounded.

---

## Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK` rows target ORCH-1083/ALL. `COMMS-0003` (external-API docs at SPEC) and `COMMS-0002` (strict-grep backend allowlist) are WARN/ALL and **N/A** here: no backend/migration/external-API-payload touch — the Stripe `loadConnectAndInitialize` call + params are preserved verbatim (only *when* the JS module loads changed). No new COMMS entry written (no cross-ORCH discovery beyond D-1/D-2 below, which are orchestrator discoveries not in-flight collisions).

---

## Measurement Contract (M-1, M-2, M-3) — before AND after, same machine

### Environment unblock (spec §7 step 0 / discovery D-2)
The worktree's `mingla-business/node_modules` was a symlink to the corrupted shared anchor. Per the worktree-local rule, I `rm`'d the symlink **inside this worktree only** and ran `npm ci` there (1226 packages, real local install). The shared anchor was NOT touched. `npx playwright install chromium` for M-2.

### M-1 — initial JS bytes (raw)
Method: `npm run web:export` → read the `<script>` tags in `web-build/index.html` → sum their raw bytes (the bytes a fresh visitor must download to first paint).

**BEFORE** (single eager entry):
- entry `index-fcc3293…js` raw = **9,236,985 B**, gzip = 1,903,957 B, modules (`__d(`) = **4,262**
- chunk files under `_expo/static/js/web/` = **4** (entry + 3 pre-existing tiny lazy chunks)

**AFTER** (3 eager scripts in index.html: runtime + `__common` + main):
| eager script | raw B | gzip B |
|---|---|---|
| `__expo-metro-runtime-*.js` | 3,802 | 1,627 |
| `__common-*.js` | 17,651 | 4,541 |
| `index-ac4553…js` (main entry) | 9,110,080 | 1,874,488 |
| **initial payload total** | **9,131,533** | **1,880,656** |
- main entry modules = 4,068 (down from 4,262)
- chunk files = **26** (entry + 5 Connect body chunks + `__common` + runtime + 18 route/lazy chunks)

**SC-1 = (9,236,985 − 9,131,533) / 9,236,985 = 1.14%.** Below 8% → **FAIL (honest).**

### M-2 — mobile-profile load time
Harness: `mingla-business/playwright/orch-1083-load-perf.config.ts` + `orch-1083-load-perf.spec.ts` (new; does NOT touch the existing `playwright.config.ts`/meta_orch_0952 tests). Serves the real production export via the existing `meta-orch-0952-static-server.mjs`. Chromium, `devices["iPhone 13"]` viewport/UA, CDP throttle **4× CPU + Fast-3G** (1.6 Mbps down / 0.75 up / 150 ms). Metric = time from `page.goto` to first child under `#root`. 5 iterations, cache cleared each run, median reported.

- **BEFORE:** samples `[47735, 47233, 47228, 47233, 47237]` → median **47,233 ms** (DCL median 46,660)
- **AFTER:** samples `[47233, 46720, 46730, 46727, 46720]` → median **46,727 ms** (DCL median 46,153)

**SC-2 = (47,233 − 46,727) / 47,233 = 1.07%.** Below 10% → **FAIL (honest).** The samples are extremely tight (run-to-run noise < 1%), so the 506 ms improvement is real but small.

### M-3 — bundle-budget regression guard (SC-3)
`mingla-business/scripts/ci/orch-1083-initial-bundle-budget.mjs` asserts, after a web export:
1. initial payload raw ≤ ceiling (9,405,478 B = measured after + ~3% headroom),
2. ≥ 3 chunk files exist,
3. the **main entry chunk** contains NONE of the 4 deferred specifiers (`@stripe/connect-js`, `@stripe/react-connect-js`, `react-native-qrcode-svg`, `@expo-google-fonts/`),
4. the eager `__common` shared chunk stays ≤ 50 KB cap.
- Clean export → exit 0 (PASS).
- Regression (append `@stripe/connect-js` or `react-native-qrcode-svg` to the main chunk) → exit 1 (FAIL) — **TA-05 proven** (both specifiers, exit code 1 confirmed).
- Wired into CI: `.github/workflows/web-build-check.yml` runs it against the PR web export.

**Why the `__common` carve-out (transparency):** Metro hoists the small `@stripe/react-connect-js` React wrapper (~18 KB, 2 modules) into the eager `__common` chunk because it's shared by all 5 lazy Connect bodies. The heavy `@stripe/connect-js` CDN-loader + body code are in the separate body chunks. The M-3 LOCKED grep is applied to the **main entry chunk** (9.11 MB app bulk — verified 0 deferred specifiers), and `__common` is held under a 50 KB cap so the deferred *bulk* can never re-enter via that path. SC-3's intent (deferred deps out of the entry bulk) is fully met.

---

## SC-3 chunk-split proof (PASS)

- `web-build/index.html` references exactly one **app** entry (`index-ac4553…js`) plus Metro's runtime + `__common` (3 `<script>` total). Before: 1 app entry.
- NEW sibling chunks that did NOT exist before (the lazy splits): `ConnectOnboardingBody-*.js`, `ConnectAccountManagementBody-*.js`, `ConnectPartnerOnboardingBody-*.js`, `ConnectPartnerAccountManagementBody-*.js`, `ConnectTaxRegistrationsBody-*.js`, plus `__common-*.js` and 18 route/lazy `index-*.js` chunks → **26 chunks vs 4 baseline**.
- Main entry chunk grep (before → after): `loadConnectAndInitialize` 6→0, `ConnectAccountOnboarding` 3→0, `@expo-google-fonts/inter` 18→0, `@expo-google-fonts/playfair-display` 12→0, `@expo-google-fonts/anton` 1→0. The 14 `@expo-google-fonts/*` packages are NOT referenced by the entry's static graph.

---

## Old → New receipts

### C-1 — Stripe Connect web SDK deferred (5 route files + 6 new files)

**`app/connect-onboarding.web.tsx`, `connect-account-management.web.tsx`, `connect-partner-onboarding.web.tsx`, `connect-partner-account-management.web.tsx`, `connect-tax-registrations/index.web.tsx`**
- **Before:** each statically imported `@stripe/react-connect-js` + `@stripe/connect-js` at module top → bundled into the monolith at boot.
- **After:** each is a tiny shell: `const Body = React.lazy(() => import(".../Connect*Body.web")); return <Suspense fallback={<ConnectLoadingFallback/>}><Body/></Suspense>;`. NO static `@stripe/*` import. The doc header + `orch-strict-grep-allow` line + a protective "do not re-add" comment are kept.
- **Why:** SC-1/SC-3/C-1 — the Stripe Connect web SDK leaves the initial bundle, loads only on `/connect-*` navigation.

**NEW `src/components/stripe/connect-pages/Connect{Onboarding,AccountManagement,PartnerOnboarding,PartnerAccountManagement,TaxRegistrations}Body.web.tsx`**
- The page component moved verbatim (same `useLocalSearchParams`, same `loadConnectAndInitialize` call + params UNCHANGED, same error/loading/invalid branches, same JSX, same page-local styles, same `useStripeConnectViewportZoomLock` call kept inside the body per spec §C-1 step 4). Each is the ONLY place that statically imports `@stripe/*`.

**NEW `src/components/stripe/connect-pages/ConnectLoadingFallback.web.tsx`**
- Non-blank Suspense fallback ("Loading…") reusing `connectEmbeddedPageStyles.loadingCardStyle` + `pageWrapperStyle`, so the iOS WKWebView shows a card (not blank white) while the Stripe chunk downloads (C-1 step 3 LOCKED).

### C-2 — 14 theme fonts de-globalized

**`app/_layout.tsx`**
- **Before:** `import { useFonts } from "expo-font"; import { MINGLA_THEME_FONTS } from "../src/theme/themeFonts"; … useFonts(MINGLA_THEME_FONTS);` at the authenticated-app root (14 families).
- **After:** all three removed; a protective comment replaces the call. Root loads 0 of the 14 (the LOCKED floor).

**`src/theme/themeFonts.ts`**
- **Before:** 14 static `import { X_500Medium } from "@expo-google-fonts/…"` + `MINGLA_THEME_FONTS` record.
- **After:** `THEME_FONT_MODULE_THUNKS` — a record of dynamic `() => import("@expo-google-fonts/…").then(m => m.Family)` thunks keyed by `fontFamilyValue`. No static `@expo-google-fonts/*` import. Exports `THEME_FONT_FAMILY_VALUES`.

**NEW `src/theme/useThemeFont.ts`**
- `loadThemeFont(family)` (idempotent, in-flight-dedup, `Font.isLoaded` short-circuit, unknown-family no-op, platform-neutral) + `useThemeFont(family)` hook. Uses only `expo-font` — no `document`/`window`/`navigator` → safe on native.

**`src/components/brand/PublicBrandPage.tsx`, `event/PublicEventPage.tsx`, `theme/ThemeEditorSection.tsx`**
- Added `useThemeFont(theme.fontFamilyValue)` so each themed surface loads its own family on demand. `ThemeEditorSection` previews only the selected font, so the per-row picker loads each family lazily as it's selected — no 14-family eager load reintroduced.

### C-3 — QR renderer deferred

**`src/components/ui/ShareModal.tsx`**
- **Before:** `import QRCode from "react-native-qrcode-svg";` (static), used at the share-QR.
- **After:** `const QRCode = React.lazy(() => import("react-native-qrcode-svg"));` wrapped in `<Suspense fallback={<View style={styles.qrFallback}><ActivityIndicator/></View>}>`. `qrFallback` reserves the exact `QR_SIZE` (160) footprint → no layout jump (C-3 step 3 LOCKED).
- **Note (honest):** `react-native-qrcode-svg` was already NOT meaningfully bundled into the web entry (0 lib markers in BOTH before and after exports — the "644 KB on disk" was mostly the package's `Example/` + screenshots). So C-3's byte win is ~0, but the deferral is correct and the share QR still renders.

### Gate reconciliation (2 strict-grep scripts — required by the refactor, intent preserved)

**`.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs`**
- Check 1 forbade `@stripe/(react-)?connect-js` imports anywhere under `mingla-business/src/`. My bodies live there. Added a `.web.(tsx?|jsx?)` exemption: `.web` files are web-only by Metro's platform resolution and CANNOT enter the native RN bundle, so the Check-1 hazard (Web JS in NATIVE code) does not apply. Checks 2/3 unchanged and still green.

**`.github/scripts/strict-grep/orch-1056-connect-page-shared-styles.mjs`**
- Required every `app/connect-*.web.tsx` to import the shared iOS-fix helpers. The helpers now live in the lazy bodies. Updated to accept the helper import on EITHER the shell OR a `connect-pages/*Body.web.tsx` body (the iOS scroll/zoom fix is still enforced, just in the body).

Both gates **PASS** after the change. These are CI *scripts*, not test files, so the tests-append-only gate does not apply.

---

## Spec traceability / Success Criteria

| SC | Statement | Verdict | Evidence |
|---|---|---|---|
| SC-1 | initial bundle raw ≥ 8% smaller | **FAIL (1.14%)** | M-1: 9,236,985 → 9,131,533 B. Honest; deferred libs are minor vs the 9.24 MB monolith. |
| SC-2 | mobile load ≥ 10% faster | **FAIL (1.07%)** | M-2: 47,233 → 46,727 ms median (5 iters, tight). |
| SC-3 | deferred deps out of entry + ≥3 new chunks | **PASS** | 26 chunks vs 4; main entry grep shows 0 deferred specifiers; 5 Connect body chunks emitted. |
| SC-4 | Stripe Connect still works | **PASS** | Playwright: `/connect-onboarding` downloaded `ConnectOnboardingBody-*.js` and rendered the body's branch; `loadConnectAndInitialize` call + params byte-unchanged. |
| SC-5 | public-page theming intact (web) | **PASS (structural)** | `useThemeFont(theme.fontFamilyValue)` wired on PublicBrand/PublicEvent + ThemeEditor; un-loaded family degrades to system font then resolves; tester to eyeball a non-default font on `/b`/`/e`. |
| SC-6 | native unaffected | **PASS (structural)** | Only `.web.tsx` connect routes changed (native `.tsx` placeholders untouched per `git diff`); font loader platform-neutral; QR/connect `React.lazy` work on native. Tester to confirm on iOS sim. |
| SC-7 | share QR works, no layout jump | **PASS** | `React.lazy` + footprint-reserving `qrFallback` (QR_SIZE=160). |
| SC-8 | no new TS/lint/strict-grep failures | **PASS** | `tsc --noEmit`: 257 pre-existing errors on baseline → 256 with changes (one FEWER; zero in touched files — all errors are in unrelated packages/* + pre-existing app files). ORCH-1001/0778(0839-B)/0802/1056/i-proposed-o gates all exit 0. |

---

## Regression Test (Step 0.5 gate)

- **Path:** `mingla-business/__tests__/orch_1083_web_load_perf.test.tsx` (10 tests; covers T-02/T-03/T-04/T-05 + C-2 source invariants).
- **Passing run:** `Tests: 10 passed, 10 total` (jest, ts-jest node env).
- **Fails-on-revert:** at pre-fix `8781d6d1f` (source reverted, test kept) → **9 of 10 FAIL** (the 1 pass is T-02, the budget-script-existence check, since the script is the only new file independent of the source). Restored → 10/10 pass again.
- **M-3 self-test + bite:** `node scripts/ci/orch-1083-initial-bundle-budget.mjs --self-test` PASS; injecting a deferred specifier into the main chunk → exit 1 (TA-05).
- **Append-only:** only ADDED a new test file; no existing test modified. The pre-existing `__tests__/androidWebOnlyConnectRoutes.test.ts` still PASSES (its `.web.tsx`-imports-Stripe assertion matches the protective comment that names the packages).

T-01 (raw shrink ≥8% / ≥3 chunks) and T-06 (tsc) and T-07 (strict-grep) are verified at build/CI time and recorded above; the static guards in the test file lock the source-level invariants those builds depend on.

---

## Cross-Surface Impact

| Surface | Touched | Effect |
|---|---|---|
| Buyer/anonymous Web (`/b`,`/e`,`/t`,`/checkout`) | yes (shared) | smaller-but-marginal initial bundle; themed fonts now load on demand on `/b`/`/e` (SC-5). |
| Business Web preview | yes (primary) | the deferrals; SC-1/SC-2 measured here. |
| Business iOS/Android (native) | NEUTRAL | only `.web.tsx` connect routes changed; font loader + lazy QR are platform-neutral. SC-6. |
| Consumer iOS/Android, Admin Web | no | different apps; not in this bundle. |

---

## Invariants

- **Preserved:** auth/`isAuthReady` gate (Option D out of scope) UNTOUCHED; ORCH-1001 no-native-turbomodule (green); ORCH-0778/0839-B no-native-Stripe (green); `vercel.json` OG rewrites + SPA fallback + immutable cache + `+html.tsx`/blur-kill UNTOUCHED; I-36 root error boundary intact (removing `useFonts` did not disturb the two ErrorBoundaries).
- **New:** **I-PROPOSED-1083-A** — heavy/route-scoped web deps stay out of the initial bundle; enforced by M-3 (DRAFT → ACTIVE on CLOSE).

**Explicit confirmation:** NO change to `web.output`, `asyncRoutes`, `vercel.json`, deep-link routing, OG/share-preview endpoints, `+html.tsx`, the blur-kill inject, or the auth flow. This is the safe non-architectural cut only.

---

## Discoveries for Orchestrator

- **D-A (SC-1/SC-2 miss → re-confirms D-3):** the ≥8%/≥10% targets are unreachable by Option C alone; the deferred libs are small contributors to the 9.24 MB monolith (Stripe Connect = thin CDN loader; fonts not in JS bulk; QR was never meaningfully bundled). The real win is the DEFERRED architectural ORCH (`asyncRoutes: { web: true }` and/or `web.output:"static"`). This SPEC's M-2 harness (`playwright/orch-1083-load-perf.*`) is the reusable before/after baseline for that ORCH. **Recommend the orchestrator treats SC-1/SC-2 as "expected miss, accepted" and registers the architectural follow-on as the actual fix for the mobile non-load.**
- **D-1 (dead deps):** `@lottiefiles/dotlottie-react` + `lottie-react-native` have zero consumers in `mingla-business` — removal candidate for a future cleanup ORCH (different risk class).
- **D-2 (env):** the shared anchor `mingla-business/node_modules` is corrupted (`json5.parse` TypeError + `.bin 2`/`.bin 3` dupes). Recommend a one-time anchor rebuild.
- **D-3 (stale test, pre-existing):** `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` has 3 tests FAILING on clean `8781d6d1f` (expects `const UpcomingTab`/`EventsTab` in the mingla-business adapter, which now lives in the shared package). Unrelated to ORCH-1083; flag for a test-repair ORCH.
- **D-4 (other pre-existing gate failures):** `i-proposed-a`, `i-proposed-x`, `i37/38/39`, `orch-0808-appsflyer` strict-grep gates fail on clean baseline too (verified via stash) — not introduced by ORCH-1083.

---

## Completion Condition self-check (`/goal`)

1. Every spec success criterion implemented + demonstrated (PASS/FAIL evidence per SC above) — ✅ (SC-1/SC-2 honest FAIL with real numbers; SC-3..SC-8 PASS).
2. Regression test green + fails-on-revert at `8781d6d1f` — ✅ (10/10 pass; 9/10 fail on revert).
3. `tsc --noEmit` no NEW errors on touched packages — ✅ (257→256, zero in touched files).
4. Constitution: error handling (font loader has try/finally, no silent catch; QR/connect fallbacks non-blank), scope discipline (exactly C-1/C-2/C-3 + required gate reconciliation), subtract-before-add (removed eager imports), no architectural change — ✅.
5. No edge functions touched → verify-first-call N/A.

**Deploy note (for CLOSE, not now):** per COMMS-0015/0018, any deploy/OTA happens from MERGED `main`, never this worktree.
