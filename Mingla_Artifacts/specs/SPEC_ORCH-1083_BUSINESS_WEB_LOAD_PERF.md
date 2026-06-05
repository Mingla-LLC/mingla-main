# SPEC — ORCH-1083 [Business web app slow/unreliable load on mobile + desktop browsers]

- **Mode:** SPEC (contract only — no implementation, no code in this file)
- **Date:** 2026-06-05
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/` on branch `ORCH-1083-business-web-load-perf`
- **Surface:** `mingla-business/` Expo Router app, web export → Vercel `https://business.usemingla.com`
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1083_BUSINESS_WEB_LOAD_PERF.md` (root cause F-1 PROVEN: one 9.24 MB monolithic web bundle, 4,262 modules, zero code-splitting under `web.output:"single"` + no `asyncRoutes`)
- **Operator decision (Seth, this session):** ship the SAFE, NON-ARCHITECTURAL first cut now (Option C). Per-route code-splitting (`asyncRoutes`) and a `web.output:"static"` rewrite are **DEFERRED to a separate future ORCH** with their own validation. They are **OUT OF SCOPE** here.
- **Comms ledger:** read on entry. No `BLOCK` rows target ORCH-1083/ALL. `COMMS-0003` (cite external-API docs at SPEC for any external API touched) and `COMMS-0002` (strict-grep backend allowlist) are WARN/ALL — **N/A here**: this SPEC touches NO backend files, NO migrations, and NO external-API payloads (the Stripe deferral preserves the EXISTING `loadConnectAndInitialize` call verbatim; we only change *when* the JS module loads, not any Stripe call/param). For the eventual CLOSE: `COMMS-0015/0018` — deploy/OTA from MERGED `main`, never from this worktree.

---

## 0. TL;DR — what this SPEC commits to

Three low-risk, no-routing-impact changes that remove eagerly-bundled weight from the **initial** web JS so the login/first screen paints before the whole app is parsed:

1. **C-1 — Defer the Stripe Connect web SDK** (`@stripe/react-connect-js` + `@stripe/connect-js`) out of the initial bundle. Six `connect-*.web.tsx` route files statically import these at module top; under `web.output:"single"` that pulls both SDKs into the monolith even though they are only ever used inside an `expo-web-browser` session on a `/connect-*` page. Move each page body behind `React.lazy(() => import(...))` + `<Suspense>` (the pattern already shipped in the 3 checkout `payment.tsx` routes).
2. **C-2 — De-globalize the 14 theme fonts.** `app/_layout.tsx` calls `useFonts(MINGLA_THEME_FONTS)` (14 `@expo-google-fonts/*` families) at the **root** of the authenticated business app, which uses **none** of them — they are only rendered on 3 public/theme surfaces. Stop loading all 14 at boot; load the needed family on-demand when a themed surface mounts (or, minimally, load only the default `Inter` family up front and the rest on demand).
3. **C-3 — Defer the client-side QR renderer** (`react-native-qrcode-svg`, 644 KB on disk) out of the boot path: it is imported statically by `ShareModal.tsx` and used only when a share/QR modal opens. Lazy-load the QR component.

Everything else from the investigation's Option C list is either already handled (Stripe native `.native` split, analytics deferral) or **not present** in the business web bundle (see §1 corrections). No `web.output`, no `asyncRoutes`, no Vercel rewrites, no `+html.tsx`/blur-kill, no OG/share endpoints, no auth flow, no native iOS/Android startup are touched.

**Measurement is a first-class deliverable:** the implementor MUST capture before AND after numbers for (a) initial JS bytes and (b) a mobile-profile load time, using a Playwright harness derived from the existing `mingla-business/playwright.config.ts`. Numeric success criteria below.

---

## 1. Investigation corrections / scope-narrowing (read before implementing)

The dispatch named several candidate heavy libs. Verified against the actual `mingla-business` web dependency graph:

| Candidate (from dispatch) | Verdict in `mingla-business` web bundle | Action |
|---|---|---|
| **Mapbox / maplibre GL renderer** | **NOT PRESENT.** No `mapbox-gl` / `maplibre-gl` in `node_modules`. Mapbox is used only as an **HTTP geocode service** (`src/services/mapboxGeocodeService.ts`) — plain `fetch`, ~no weight, no eager renderer. | **No change.** (Correction to the dispatch's assumption.) |
| **Stripe Connect web SDK** (`@stripe/connect-js` 196 KB + `@stripe/react-connect-js` 108 KB) | **EAGER.** Statically imported at module top of 6 `connect-*.web.tsx` route files → bundled into the monolith. Only used in an in-app-browser `/connect-*` session. | **C-1: defer.** |
| **Stripe native** (`@stripe/stripe-react-native`) | Already isolated: native checkout uses a `.native.ts` Metro platform split + `React.lazy` boundary in the checkout `payment.tsx` routes; web has a metro stub. | **No change.** |
| **Charting lib (recharts/victory/d3)** | **NOT PRESENT.** No charting dependency in `mingla-business`. Analytics tiles render plain numbers/`<Text>`. | **No change.** |
| **Giphy / Pexels** | **Lightweight HTTP services** (`giphyEventCoverService.ts`, `pexelsEventCoverService.ts`) — plain `fetch`, no SDK. Not worth a dynamic import (would add a network round-trip for no byte win). | **No change.** |
| **Lottie / dotLottie** (`@lottiefiles/dotlottie-react` 2.5 MB, `lottie-react-native` 520 KB) | **DEAD in `mingla-business`** — `grep` finds **zero** consumers in `src/`+`app/`. Metro tree-shakes unreferenced modules, so these are almost certainly NOT in the bundle today. | **No change** (not a boot-path win). Register **D-1** below as an orchestrator discovery (dead deps → removal candidate in a future cleanup ORCH; out of scope here — removing a `package.json` dep is a different risk class). |
| **QR** (`react-native-qrcode-svg` 644 KB) | **EAGER** via `ShareModal.tsx` static import; used only when the share modal opens. | **C-3: defer.** |
| **14 theme fonts** | **EAGER at root** (`useFonts(MINGLA_THEME_FONTS)`), unused by the authenticated app. | **C-2: defer.** |
| **Auth-bootstrap gate (F-3, "4-8s window")** | Investigation Option D. **OUT OF SCOPE** — touching the `isAuthReady` gate risks reintroducing the ORCH-1004 empty-state-during-bootstrap bug. Deferred to a future polish ORCH. | **No change.** |

**Net:** the SPEC commits to C-1, C-2, C-3. That is the complete, safe, non-architectural first cut.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (exactly this)
- **C-1** Defer `@stripe/connect-js` + `@stripe/react-connect-js` out of the initial web bundle via `React.lazy` extraction of the 6 connect page bodies.
- **C-2** Remove the 14-font `useFonts(MINGLA_THEME_FONTS)` call from `app/_layout.tsx` root; load themed fonts on-demand on the 3 surfaces that render them.
- **C-3** Defer `react-native-qrcode-svg` out of the boot path via `React.lazy` of the QR component in `ShareModal.tsx`.
- **Measurement contract** (§6): before/after initial-JS-bytes + mobile-profile load time via Playwright.
- **Regression tests** (§9) per the Step 0.5 gate.

### 2.2 Non-Goals (explicitly NOT in this SPEC, with reason)
- ❌ `web.output: "single" → "static"` change — **architectural; deferred to a future ORCH** (alters Vercel routing, OG rewrites, `+html.tsx`/blur-kill, hydration).
- ❌ `expo-router` `asyncRoutes: { web: true }` — **ALPHA + architectural; deferred to a future ORCH** (per-route chunks, chunkReloadGuard becomes load-bearing, deep-link/OG re-validation).
- ❌ Any change to `vercel.json` rewrites, the `/(.*) → /` SPA fallback, crawler OG rewrites, `/api/public-*` endpoints, deep-link routing for `/b` `/e` `/t` `/connect-*` `/checkout`, immutable cache headers.
- ❌ Any change to `app/+html.tsx` or the post-build mobile blur-kill inject (`scripts/inject-mobile-blur-css.mjs`).
- ❌ Any change to the auth flow / `AuthContext` / `isAuthReady` / `AUTH_BOOTSTRAP_TIMEOUT_MS` (F-3 / Option D deferred).
- ❌ Any native iOS/Android startup change. All three changes are web-bundle-shape changes that MUST be byte-neutral on native (no `.native` behavior change).
- ❌ Removing dead deps (`@lottiefiles/dotlottie-react`, `lottie-react-native`) — registered as discovery D-1 for a future cleanup ORCH.
- ❌ Any backend / migration / RLS / edge-function change. None touched.

### 2.3 Assumptions
- A-1: Metro production tree-shaking already drops the zero-consumer Lottie deps (verified zero consumers; not relied on for a success number).
- A-2: `expo-font@14.0.11` exposes `Font.loadAsync(record)` + `Font.isLoaded(family)` for on-demand loading (standard expo-font API for this SDK).
- A-3: On web, an un-loaded `fontFamily` string degrades gracefully to the browser default (no crash) — so deferring fonts cannot *break* a themed surface, only briefly fall back until loaded. The on-demand load eliminates the fallback.
- A-4: The 3 `React.lazy` checkout payment routes are the canonical, already-shipped deferral pattern; C-1 and C-3 replicate it exactly. The `evictEndedEvents` / `reapOrphanStorageKeys` `await import()` calls in `_layout.tsx` confirm dynamic `import()` is already used in this app's web build.
- A-5: The implementor will run the measurement on a real browser engine (Playwright Chromium/WebKit). The investigation could not (corrupted anchor `node_modules`, discovery D-2 below); the implementor MUST first `npm ci` a clean `node_modules` in the worktree (see §7 step 0).

---

## 3. Layer-by-layer contract

This is a frontend-only, web-bundle-shape SPEC. No DB / edge / service / hook / realtime layers are touched. The component/route layer is fully specified below with exact file:line anchors.

> **Notation:** line numbers are anchored to HEAD of branch `ORCH-1083-business-web-load-perf` at SPEC time. The implementor must re-confirm anchors before editing (files may shift by a few lines).

---

### C-1 — Defer the Stripe Connect web SDK (🔒 LOCKED mechanism, 🎨 OPEN naming)

**Problem (proven):** these 6 route files statically `import` `@stripe/react-connect-js` and/or `@stripe/connect-js` at module top. Under `web.output:"single"`, every route module is eagerly `require()`d into the one bundle → both SDKs (304 KB on disk, minified+module-wrapped in the bundle) load at app boot even though they are only used inside an `expo-web-browser` `/connect-*` session.

| # | File | Eager import site (line) |
|---|---|---|
| 1 | `mingla-business/app/connect-onboarding.web.tsx` | `38-41` (`ConnectAccountOnboarding, ConnectComponentsProvider, ConnectNotificationBanner` from `@stripe/react-connect-js`); `42` (`loadConnectAndInitialize` from `@stripe/connect-js`) |
| 2 | `mingla-business/app/connect-account-management.web.tsx` | `18-22` (react-connect-js); `23` (connect-js) |
| 3 | `mingla-business/app/connect-partner-onboarding.web.tsx` | `22-25` (react-connect-js); `26` (connect-js) |
| 4 | `mingla-business/app/connect-partner-account-management.web.tsx` | `23-26` (react-connect-js); `27` (connect-js) |
| 5 | `mingla-business/app/connect-tax-registrations/index.web.tsx` | `4-7` (react-connect-js); `8` (connect-js) |
| 6 | `mingla-business/app/connect-onboarding.web.tsx` (notification banner import counted with #1) | — |

(There are 5 distinct route files; #1 and #6 are the same file. The native sibling `.tsx` routes — e.g. `connect-account-management.tsx` line 5 — are placeholder native routes that do NOT import Stripe and need NO change.)

**🔒 LOCKED — required mechanism (per file):**

For each of the 5 connect `.web.tsx` route files:

1. **Extract the page body** (everything that statically references `@stripe/*` — the `loadConnectAndInitialize` call, the `Connect*` components, and the JSX that renders them, plus the local helpers/styles they need) into a NEW co-located module:
   - `mingla-business/app/connect-onboarding.body.web.tsx`
   - `mingla-business/app/connect-account-management.body.web.tsx`
   - `mingla-business/app/connect-partner-onboarding.body.web.tsx`
   - `mingla-business/app/connect-partner-account-management.body.web.tsx`
   - `mingla-business/app/connect-tax-registrations/index.body.web.tsx`

   (🎨 OPEN: exact filename suffix — `.body.web.tsx` is the recommended convention; the implementor MAY choose `Inner` / a `_components/` folder, as long as the extracted module is the ONLY place that statically imports `@stripe/*` and the route file does NOT.)

   **Important — `.body.web.tsx` must NOT be a routable file.** Expo Router treats files under `app/` as routes. A `.body.web.tsx` co-located next to a route is matched by `[name].body.web.tsx` and is NOT a valid route segment (Expo Router ignores files that aren't `index`/`[param]`/named segments only when they don't resolve to a path; a `.body` infix creates the route `/connect-onboarding.body`). To be safe, the extracted body MUST live where Expo Router will NOT register it as a navigable screen. **Required placement:** put the extracted bodies in `mingla-business/src/components/stripe/connect-pages/` (outside `app/`), NOT under `app/`. Final required paths:
   - `mingla-business/src/components/stripe/connect-pages/ConnectOnboardingBody.web.tsx`
   - `mingla-business/src/components/stripe/connect-pages/ConnectAccountManagementBody.web.tsx`
   - `mingla-business/src/components/stripe/connect-pages/ConnectPartnerOnboardingBody.web.tsx`
   - `mingla-business/src/components/stripe/connect-pages/ConnectPartnerAccountManagementBody.web.tsx`
   - `mingla-business/src/components/stripe/connect-pages/ConnectTaxRegistrationsBody.web.tsx`

   Each body module's **default export** is the existing page component (renamed to `*Body`), moved verbatim — same params reading via `useLocalSearchParams`, same `loadConnectAndInitialize` call (UNCHANGED — preserves COMMS-0003 external-API contract), same error/loading/invalid-link branches, same JSX.

2. **Rewrite each route file** (`app/connect-*.web.tsx`) to contain NO static `@stripe/*` import. It must:
   - `import React, { Suspense } from "react";`
   - declare `const Body = React.lazy(() => import("../src/components/stripe/connect-pages/Connect*Body.web"));` (path relative to the route file; the tax route is one level deeper).
   - default-export a tiny shell: `return <Suspense fallback={<ConnectLoadingFallback />}>{<Body />}</Suspense>;`
   - The shell may read NOTHING Stripe-related; the body reads its own params.

3. **`<Suspense fallback>` — 🔒 LOCKED behavior:** must render a minimal non-blank loading state so the in-app-browser session shows "Loading…" while the Stripe chunk downloads (do NOT use `fallback={null}` here — unlike the checkout payment routes where the parent already shows a header, these connect pages are full-bleed and a null fallback = blank white in the WKWebView). Reuse the existing `connectEmbeddedPageStyles.loadingCardStyle` (`src/components/stripe/connectEmbeddedPageHelpers.ts`) for visual consistency with the page's own "Initializing…" state.
   - 🎨 OPEN: the fallback copy ("Loading payouts…" / "Loading…") and whether it's a shared `ConnectLoadingFallback` component vs inline — implementor's craft, as long as it is non-blank and uses the existing helper styles.

4. **Constraint — `useStripeConnectViewportZoomLock()` and the ORCH-1056 scroll/zoom fix:** these live inside the page body and call `useStripeConnectViewportZoomLock` from `connectEmbeddedPageHelpers.ts`. They MUST remain inside the lazily-loaded body (they only matter once the Stripe UI renders). Do NOT hoist them into the route shell.

**Why this is safe (no architecture change):** `React.lazy` + dynamic `import()` is a pure JS code-split that Metro already supports under `web.output:"single"` WITHOUT `asyncRoutes` (proven: the 3 checkout payment routes ship it today, producing a chunk that loads on navigation). It does NOT change route registration, the SPA fallback, deep-links, or Vercel config. The `/connect-*` URL still resolves to the same route file; only the heavy body downloads on first render of that route.

**Outcome:** `@stripe/connect-js` + `@stripe/react-connect-js` leave the initial bundle and load only when a user actually opens a `/connect-*` page.

---

### C-2 — De-globalize the 14 theme fonts (🔒 LOCKED removal + on-demand load, 🎨 OPEN trigger placement)

**Problem (proven):**
- `mingla-business/app/_layout.tsx:35` — `import { useFonts } from "expo-font";`
- `mingla-business/app/_layout.tsx:42` — `import { MINGLA_THEME_FONTS } from "../src/theme/themeFonts";`
- `mingla-business/app/_layout.tsx:364` — `useFonts(MINGLA_THEME_FONTS);` inside `RootLayout()` — loads all 14 families at the root of the authenticated app.
- `mingla-business/src/theme/themeFonts.ts:1-31` — the 14 `@expo-google-fonts/*` imports + `MINGLA_THEME_FONTS` record.

**Verified:** the authenticated business app's design system uses NONE of these families (`grep fontFamily src/constants/designSystem*` → none of the 14). The 14 families render ONLY on these 3 surfaces, all via `theme.fontFamilyValue` (a string like `"Inter_500Medium"` from `FONT_FAMILY_MAP` in `@mingla/event-rendering/designTokens.ts:127-142`):
- `mingla-business/src/components/brand/PublicBrandPage.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/theme/ThemeEditorSection.tsx` (the editor preview + the slug picker, which previews each family)

The default theme font is `inter` → `Inter_500Medium` (`MINGLA_DEFAULT_THEME` in `designTokens.ts:74-78`).

**🔒 LOCKED — required changes:**

1. **Remove the eager root call.** Delete `useFonts(MINGLA_THEME_FONTS);` from `app/_layout.tsx:364` (and the now-unused `useFonts` import line 35 + `MINGLA_THEME_FONTS` import line 42 IF no longer referenced in `_layout.tsx`). The root layout MUST NOT load any of the 14 theme fonts.

2. **Add an on-demand theme-font loader.** Create `mingla-business/src/theme/useThemeFont.ts` (or a function `loadThemeFont(family: string)`), a thin wrapper over `expo-font`'s `Font.loadAsync` / `Font.isLoaded`, that:
   - given a `fontFamilyValue` (e.g. `"Inter_500Medium"`), looks it up in a `family → @expo-google-fonts/*` module map (the same 14 entries currently in `themeFonts.ts`, restructured so each family is **dynamically `import()`-able**, NOT statically imported into the boot path),
   - calls `Font.loadAsync({ [family]: <module> })` only if `!Font.isLoaded(family)`,
   - is idempotent (multiple surfaces requesting the same family load it once),
   - is a **no-op-safe** on every platform (web + native both go through `expo-font`).

   **🔒 The 14 `@expo-google-fonts/*` imports MUST become dynamic** — i.e. `themeFonts.ts` must no longer statically `import { Inter_500Medium } from "@expo-google-fonts/inter"` at module top (that's what pulls the font registration code into the boot bundle). Restructure to a map of `() => import("@expo-google-fonts/inter")` thunks keyed by the `FONT_FAMILY_MAP` family name, OR keyed by `ThemeFontSlug`. Each thunk resolves the family's font asset module on demand.

3. **Load on-demand at each of the 3 themed surfaces.** When a themed surface mounts and resolves its `ResolvedTheme`, call the loader for `theme.fontFamilyValue` so the correct family loads before/while that surface renders. 🎨 OPEN: exact hook placement (a `useThemeFont(theme.fontFamilyValue)` call at the top of `PublicBrandPage` / `PublicEventPage`, and per-slug in `ThemeEditorSection`'s preview) — implementor's craft, as long as: (a) the surface's themed text shows the correct family once loaded, (b) there is a graceful interim (system-font fallback for ≤ the load duration, no layout crash), and (c) `ThemeEditorSection`'s slug picker — which previews ALL 14 — loads each family lazily as it's previewed (do NOT re-introduce a 14-family eager load there; load per-row, or load the selected one + the few visible ones).

4. **Minimal-acceptable fallback (if the implementor judges full per-surface on-demand too risky for ThemeEditorSection):** at minimum, load ONLY the default `Inter_500Medium` family up front (1 family, not 14) via a single `Font.loadAsync` on the themed surfaces' first mount, and load the other 13 strictly on demand. This still removes 13/14 families from boot. The LOCKED floor is: **the root layout loads 0 of the 14; no more than 1 family (`Inter`) may be loaded before a themed surface is reached.**

**Why this is safe:** fonts are not in the JS bulk (investigation F-2: 0 inlined base64 font payloads), but the 14 static `@expo-google-fonts/*` imports add module wrappers to the boot bundle AND `useFonts` fires 14 render-affecting asset fetches during boot. Removing them shrinks the module count and eliminates 14 boot-time fetches on the login path. On-demand load preserves themed rendering exactly where it's needed. No public-page theming regresses (SC-5).

---

### C-3 — Defer the client-side QR renderer (🔒 LOCKED mechanism, 🎨 OPEN fallback)

**Problem (proven):**
- `mingla-business/src/components/ui/ShareModal.tsx:29` — `import QRCode from "react-native-qrcode-svg";` (static); used at `ShareModal.tsx:258` (`<QRCode … />`) only when the share modal is open.

(`TicketQrCarousel.tsx` already replaced its client QR with a server-generated data-URI per its own comment lines 68-76, and the `orch_0930_qr_carousel_mounted_guard.test.tsx` test asserts it does NOT import `react-native-qrcode-svg`. So `ShareModal` is the only eager consumer.)

**🔒 LOCKED — required mechanism:**
1. Remove the static `import QRCode from "react-native-qrcode-svg";` from `ShareModal.tsx`.
2. Introduce `const QRCode = React.lazy(() => import("react-native-qrcode-svg"));` (or a thin `LazyQRCode` wrapper component if `React.lazy` of a default-exported class component needs adapting — `react-native-qrcode-svg`'s default export is a component, so `React.lazy` applies directly).
3. Wrap the `<QRCode />` usage at line 258 in `<Suspense fallback={…}>`. 🎨 OPEN: the fallback (a sized placeholder box matching the QR's dimensions to avoid layout shift, or a small spinner) — implementor's craft; LOCKED requirement: the fallback MUST reserve the QR's footprint so the modal does not jump when the QR resolves.
4. The QR only renders inside the (already conditionally-mounted) share modal, so the chunk downloads only when a user opens share-with-QR. No behavior change to the share flow otherwise.

**Why this is safe:** identical `React.lazy` mechanism as C-1; no routing/architecture impact; 644 KB of SVG-QR code leaves the boot path.

---

## 4. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behavior demanded / reason not covered | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | ❌ | Different app; not the regression surface. | none | — |
| 2 | Consumer Android (`app-mobile/`) | ❌ | Same. | none | — |
| 3 | Buyer/anonymous Web (`mingla-business` public routes `/b` `/e` `/t` `/checkout`) | ✅ (indirect) | These humans hit the same monolith on phones (investigation D-3, highest mobile value). They benefit from the smaller initial bundle. **C-2 must not regress public-page theming** — the themed font must still render on `/b` `/e` (SC-5). | `PublicBrandPage.tsx`, `PublicEventPage.tsx` (on-demand font load) | shared code |
| 4 | Business iOS (`mingla-business` native) | ✅ (must be NEUTRAL) | C-1/C-2/C-3 are web-bundle-shape changes. On native: Stripe connect pages are `.web.tsx` (native siblings are placeholders — unaffected); fonts go through the same `expo-font` on-demand path (native must still render themed fonts); QR `React.lazy` works on native too. **Native behavior MUST be unchanged** (SC-6). | `_layout.tsx`, `themeFonts.ts`, `useThemeFont.ts`, `ShareModal.tsx` | shared code — verify no native regression |
| 5 | Business Android (`mingla-business` native) | ✅ (must be NEUTRAL) | Same as #4. | same | shared code |
| 6 | Admin Web (`mingla-admin/`) | ❌ | Separate Vite app; not in this bundle. | none | — |
| 7 | Business Web preview (dev/web build) | ✅ (primary) | The whole point: smaller initial JS, faster mobile-profile load (SC-1, SC-2). | all of the above | — |

**Manual-parity success criteria** (because native + web share code but must be verified separately): SC-5 (public web themed fonts render), SC-6 (native business app: Stripe onboarding, themed public pages, share-QR all still work). These are distinct gates the tester must hit per-surface.

---

## 5. Success Criteria (numbered, observable, testable)

### Measurement-based (the core of this ORCH)
- **SC-1 — Initial-bundle byte reduction (LOCKED target).** The production web export's **initial JS payload** (the bytes a fresh visitor must download to first paint = the `index-*.js` entry + anything it eagerly pulls, RAW uncompressed) MUST drop by **≥ 8%** vs the before-baseline, with a **stretch goal of ≥ 12%**. Baseline = 9,237,629 bytes raw (investigation §2). The deferred chunks (Stripe connect body chunks, QR chunk) MUST exist as SEPARATE files under `web-build/_expo/static/js/web/` (proving they left the entry), not folded back into the entry. Measured by §6 metric M-1.
  - Rationale for 8%: Stripe Connect SDK (~304 KB on disk → minified-in-bundle contribution) + QR (~644 KB on disk) + 14 font module wrappers, against a 9.24 MB raw entry, is realistically ~8-12% of the *raw* entry. The implementor reports the EXACT measured before/after; if the measured win is < 8%, that is a FAIL requiring investigation of why the chunks didn't split (most likely a residual static import path leaking the dep back into the entry).
- **SC-2 — Mobile-profile load-time improvement (LOCKED target).** On the Playwright mobile profile (§6 metric M-2: iPhone-class viewport + 4× CPU throttle + Fast-3G network), the time-to-first-meaningful-paint of the login screen (`/auth/login`) MUST improve by **≥ 10%** vs baseline, OR (if the device-class proxy is noisy) the **`DOMContentLoaded`-to-first-`#root`-child time** MUST improve measurably (report the number; ≥ 10% target). The implementor MUST capture before AND after with the SAME harness, same machine, ≥ 3 runs each (report median).
- **SC-3 — Chunk-split proof.** `web-build/index.html` still references exactly one entry `<script>`, AND there are now ≥ 2 NEW sibling chunk files under `_expo/static/js/web/` that did NOT exist in the baseline export (the Stripe + QR lazy chunks). The 14 `@expo-google-fonts/*` families are NOT referenced by the entry chunk's static `require` graph.

### Functional (no regression on any deferred feature)
- **SC-4 — Stripe Connect still works.** Opening each `/connect-*` page renders the embedded Stripe Connect component after a brief "Loading…" fallback; `loadConnectAndInitialize` is called with the unchanged params; the Done/onExit redirect still returns to the brand payments page / deep link. (Per-page: onboarding, account-management, partner-onboarding, partner-account-management, tax-registrations.)
- **SC-5 — Public-page theming intact (web).** A `/b/{slug}` or `/e/{brand}/{event}` page whose brand selected a non-default theme font renders that font (e.g. `Playfair Display`) correctly — after the on-demand load, the themed text shows the selected family, not the system fallback. The `ThemeEditorSection` slug picker previews each family.
- **SC-6 — Native unaffected.** On the business iOS app: Stripe onboarding opens and works, public themed pages render their fonts, the share modal's QR renders. No native startup regression.
- **SC-7 — Share QR works.** Opening the share modal renders the QR after its `Suspense` fallback; no layout jump (fallback reserved the footprint).
- **SC-8 — No new TS / lint / strict-grep failures.** `npx tsc --noEmit` clean in `mingla-business`; the ORCH-1001 native-turbomodule-in-web-bundle gate (`orch-1001-no-native-turbomodule-in-web-bundle.mjs`) still passes (C-1 must not pull native Stripe into web; it only touches `.web.tsx` + connect web SDK); the ORCH-0839-B no-native-stripe gate unaffected.

---

## 6. Measurement Contract (LOCKED — the implementor MUST capture before AND after)

The implementor runs ALL metrics on the **before** state (current HEAD, pre-change) and the **after** state (post-change), on the SAME machine, and records both in the implementation report.

### M-1 — Initial-JS-bytes (the headline metric for SC-1/SC-3)
1. From a clean worktree `node_modules` (`npm ci` — see §7 step 0): `cd mingla-business && npm run web:export` (produces `web-build/`).
2. Measure the entry chunk: read `web-build/index.html`, extract the single `<script src="/_expo/static/js/web/index-*.js">` filename, and record its **raw byte size** (`wc -c`) AND its gzip size (`gzip -c file | wc -c`) AND brotli if available.
3. Record the **module count** of the entry chunk (`grep -o '__d(' file | wc -l`).
4. List ALL files under `web-build/_expo/static/js/web/` with sizes — BEFORE there is 1; AFTER there must be ≥ 3 (entry + Stripe body chunk(s) + QR chunk).
5. **SC-1 pass = (before_entry_raw − after_entry_raw) / before_entry_raw ≥ 0.08.** Report the exact percentage.

> Note: gzip/brotli is reported for context, but SC-1 is judged on RAW bytes because the mobile-failure mechanism is parse/compile of the *decompressed* payload (investigation §2, §8 "Missing compression RULED OUT"). Compression does not change parse cost.

### M-2 — Mobile-profile load time (the metric for SC-2)
Extend the existing Playwright setup. Create `mingla-business/playwright/orch-1083-load-perf.config.ts` + a spec `orch-1083-load-perf.spec.ts` (do NOT modify the existing `playwright.config.ts` / `meta_orch_0952` tests):
1. **webServer:** reuse the existing pattern (`npm run web:export` then serve `web-build` via `playwright/meta-orch-0952-static-server.mjs`) so the test runs against the REAL production export, not dev.
2. **Mobile project:** one Playwright project using `devices["iPhone 13"]` (or `iPhone 14`) for the viewport + UA, with **CPU + network throttling via CDP** in a `beforeEach`:
   - `await client.send("Emulation.setCPUThrottlingRate", { rate: 4 })` (4× slowdown — phone-class CPU),
   - `await client.send("Network.emulateNetworkConditions", { offline:false, downloadThroughput: 1.6e6/8, uploadThroughput: 0.75e6/8, latency: 150 })` (Fast-3G-ish).
   - (CDP throttling is Chromium-only; use the `chromium` engine for M-2. WebKit is used for the functional SC-4/5/7 checks, not the timed metric.)
3. **Measured metric:** navigate to `/auth/login`; measure **the time from navigation start to the first child appearing under `#root`** (i.e. first React paint), via `performance` marks or a `page.waitForSelector("#root > *")` timed against `performance.timing.navigationStart` / a `Date.now()` taken at `page.goto` resolution. Capture `performance.getEntriesByType("navigation")[0]` (domContentLoaded, loadEventEnd) too.
4. Run **≥ 3 iterations**, report the **median** time, before and after.
5. **SC-2 pass = (before_median − after_median) / before_median ≥ 0.10**, OR a clearly-reported measurable improvement with the raw numbers if the proxy is noisy (the tester adjudicates; the obligation is to PRODUCE the before/after numbers, not to hit a noisy threshold by luck).

### M-3 — Bundle-budget assertion (regression guard, SC-3)
Add a lightweight assertion (a node script `mingla-business/scripts/ci/orch-1083-initial-bundle-budget.mjs`, OR a Playwright test) that, after a `web:export`, asserts:
- the entry chunk raw size is **≤ a budget ceiling** (set the ceiling to the measured AFTER size + a ~3% headroom margin, so future eager-import regressions fail CI),
- there are ≥ 3 chunk files under `_expo/static/js/web/`,
- the entry chunk does NOT statically reference `@stripe/connect-js` / `@stripe/react-connect-js` / `react-native-qrcode-svg` / the 14 `@expo-google-fonts/*` packages (grep the entry chunk for these specifiers; they must appear only in the split chunks).
🎨 OPEN: exact ceiling value (implementor sets from the real measurement); the grep-based "not in entry" assertion is 🔒 LOCKED.

---

## 7. Implementation Order (LOCKED sequence)

0. **Unblock the export (env fix — discovery D-2).** The worktree's `node_modules` is a symlink to the corrupted anchor. Per the worktree memory rules, `rm` the symlink and run a real `npm ci` in the worktree's `mingla-business/` so `expo export -p web` works. (Investigation §11 / discovery D-2: anchor `node_modules` has a `json5.parse` TypeError + `.bin 2`/`.bin 3` duplicate dirs.)
1. **Capture the BEFORE baseline** — run M-1 + M-2 on current HEAD, record numbers. (Must be done BEFORE any code change.)
2. **C-2 (fonts)** — lowest blast radius: restructure `themeFonts.ts` to dynamic thunks, add `useThemeFont`, remove the root `useFonts`, wire the 3 surfaces. Run `tsc`.
3. **C-3 (QR)** — `React.lazy` in `ShareModal.tsx`. Run `tsc`.
4. **C-1 (Stripe connect)** — extract the 5 bodies to `src/components/stripe/connect-pages/`, rewrite the 5 route shells, add `Suspense` fallbacks. Run `tsc` + the ORCH-1001/0839-B web-stripe gates.
5. **Re-export + capture the AFTER numbers** — run M-1 + M-2, compute SC-1/SC-2 deltas.
6. **Add M-3 budget guard** + the regression tests (§9).
7. **Functional verification** — SC-4/5/6/7 (web Playwright + native sim/device for SC-6).
8. Implementation report with before/after tables.

---

## 8. Invariants

### Preserved (must not break)
- **I-DISABLED-QUERY-IS-LOADING / ORCH-1004 auth-readiness** — UNTOUCHED (Option D out of scope). The auth gate stays exactly as-is.
- **ORCH-1001 — no native TurboModule in web bundle** (`orch-1001-no-native-turbomodule-in-web-bundle.mjs`) — C-1 must keep native Stripe out of web; verify the gate stays green.
- **ORCH-0839-B — mingla-business no native Stripe in checkout** — unaffected; C-1 touches only the Connect *web* SDK, not `@stripe/stripe-react-native`.
- **F-O1 mobile blur-kill** (post-build inject) + **vercel.json OG rewrites + SPA fallback + immutable cache** — UNTOUCHED.
- **I-36 ROOT-ERROR-BOUNDARY** — the two `ErrorBoundary`s in `_layout.tsx` stay; removing `useFonts` must not disturb them.

### New (this ORCH establishes)
- **I-PROPOSED-1083-A — Heavy/route-scoped web deps stay out of the initial bundle.** `@stripe/connect-js`, `@stripe/react-connect-js`, `react-native-qrcode-svg`, and the 14 `@expo-google-fonts/*` families MUST NOT be statically imported on the boot path; they load via `React.lazy`/dynamic `import()`/`Font.loadAsync` only when their feature is reached. Enforced by M-3's grep-the-entry-chunk assertion. (DRAFT → ACTIVE on CLOSE.)

---

## 9. Test Cases (Step 0.5 gate — implementor happy-path + tester adversarial)

### Implementor MUST ship (happy-path + the budget guard)
| Test | Scenario | Expected | Layer |
|---|---|---|---|
| T-01 | `web:export` after changes | entry chunk shrinks ≥ 8% raw; ≥ 3 chunk files exist | M-1 / build |
| T-02 | M-3 budget script | entry ≤ ceiling; entry chunk grep finds NONE of the 4 deferred specifiers; passes | CI script |
| T-03 | `useThemeFont(family)` unit | idempotent; calls `Font.loadAsync` once per family; no-op if already loaded | unit |
| T-04 | ShareModal renders QR | modal open → `Suspense` fallback → `<QRCode>` resolves | component |
| T-05 | Connect route shell | route file has NO static `@stripe/*` import; default export is the `Suspense`+`lazy` shell | static/lint |
| T-06 | `tsc --noEmit` (mingla-business) | clean | types |
| T-07 | ORCH-1001 + ORCH-0839-B web-stripe gates | still green | strict-grep |

### Tester's adversarial angle (what to attack)
| Test | Adversarial scenario | Pass condition |
|---|---|---|
| TA-01 | **A deferred feature still mounts and works** — open all 5 `/connect-*` pages (web Playwright, both Chromium + WebKit). | Each renders the embedded Stripe component after fallback; `loadConnectAndInitialize` called with unchanged params; Done redirect works. (SC-4) |
| TA-02 | **Themed public page (web)** — `/b/{slug}` / `/e/{…}` with a non-default theme font (e.g. `playfair_display`). | Themed text renders the SELECTED family after on-demand load, not the system fallback. No FOUT-induced layout crash. (SC-5) |
| TA-03 | **ThemeEditorSection picker** — open the theme editor, cycle through all 14 font slugs. | Each preview loads its family on demand; NO eager 14-family load reintroduced (verify via M-3 / network panel). |
| TA-04 | **Native parity** — business iOS sim/device: Stripe onboarding, a themed public page, share-modal QR. | All work; no startup regression. (SC-6) |
| TA-05 | **Budget assertion actually fails on regression** — temporarily re-add a static `@stripe/connect-js` import to a route file and re-export. | M-3 script must FAIL (proves the guard isn't a no-op). |
| TA-06 | **Measurement honesty** — re-run M-1/M-2 independently. | Tester's numbers corroborate the implementor's before/after within run-to-run noise; SC-1 ≥ 8% and SC-2 improvement are real, not folded-back chunks. |
| TA-07 | **Suspense fallback not blank** — throttle the connect chunk load (CDP) and observe `/connect-onboarding`. | A visible "Loading…" card shows during chunk download, NOT a blank white WKWebView. (C-1 step 3) |
| TA-08 | **Cold vs warm** — second visit (immutable cache) still works; the split chunks cache correctly. | No broken chunk fetch; chunkReloadGuard not falsely triggered. |

---

## 10. Regression Prevention
- **Structural safeguard:** M-3 budget + grep-the-entry assertion (run on every `web:export` / in CI) fails the build if any of the 4 deferred specifiers reappear in the entry chunk or the entry grows past the ceiling. This is the durable guard against the "organic re-bloat" failure mode (investigation §7: no single regressing commit; weight creeps in).
- **Protective comments:** each rewritten connect route shell + `themeFonts.ts` + `ShareModal.tsx` gets a one-line `// ORCH-1083: deferred out of the initial web bundle — do not re-add a static import (breaks the mobile boot budget). See SPEC §C-1/C-2/C-3.`
- **Test that catches recurrence:** TA-05 proves the guard bites.

---

## 11. Discoveries for Orchestrator
- **D-1 (dead deps):** `@lottiefiles/dotlottie-react` (2.5 MB) and `lottie-react-native` (520 KB) have ZERO consumers in `mingla-business/src`+`app`. They are almost certainly already tree-shaken out of the bundle (no boot-path win here), but they are dead `package.json` deps — a future cleanup ORCH should remove them (removing a dep is a different risk class, not folded into this perf SPEC).
- **D-2 (env):** the shared anchor `mingla-business/node_modules` is corrupted (`json5.parse` TypeError + `.bin 2`/`.bin 3` duplicate dirs) — blocks `expo export -p web` from the anchor/symlinked worktrees until a clean `npm ci`. Implementor must `npm ci` the worktree first (§7 step 0). Recommend a one-time anchor `node_modules` rebuild.
- **D-3 (deferred follow-on ORCH):** per-route code-splitting (`asyncRoutes: { web: true }`) and/or `web.output: "static"` are the HIGH-leverage architectural wins (investigation Options A/B) but are DEFERRED by operator decision this session. They need their own ORCH with hard validation of deep-links, OG rewrites, `+html.tsx`/blur-kill reactivation, chunkReloadGuard becoming load-bearing, and a mobile device-farm TTI pass. This SPEC's M-2 harness is reusable as their before/after baseline.

---

## 12. Completion Condition self-check (SPEC `/goal`)
1. Functional contract complete for every touched layer (route/component only; no DB/edge/service/hook/realtime) with exact file:line anchors — ✅ (§3 C-1/C-2/C-3).
2. UI surfaces: the only user-visible new surface is the `Suspense` fallbacks; their LOCKED behavior (non-blank, reuse existing helper styles, reserve footprint) + OPEN copy/structure are pinned — ✅ (C-1 step 3, C-3 step 3). No new full design surface → no `mingla-designer` pass required.
3. No-AI-slop / references: N/A — no new visual design surface; reuses existing `connectEmbeddedPageStyles`. Stated.
4. Every requirement tagged 🔒 LOCKED / 🎨 OPEN with a generous OPEN ceiling — ✅.
5. Cross-Surface Impact present (§4); success criteria observable/testable + per-surface manual-parity gates (SC-5/SC-6) — ✅.
6. Invariants named (§8); test cases happy/error/edge/adversarial (§9); implementation order (§7); regression prevention (§10) — ✅.
7. Zero hand-wave — every change has a file:line, a mechanism, and a numeric or grep-checkable success bar — ✅.
8. Architectural changes (asyncRoutes / static output) explicitly DEFERRED and OUT OF SCOPE — ✅ (§2.2, D-3).
