# INVESTIGATION — ORCH-1083 [Business web app slow/unreliable load on mobile + desktop browsers — perf regression]

- **Mode:** INVESTIGATE (investigation only — no fixes, no spec, no build-config changes)
- **Date:** 2026-06-05
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/` on branch `ORCH-1083-business-web-load-perf`
- **Surface:** `mingla-business/` Expo Router app, web export to Vercel at `https://business.usemingla.com`
- **Confidence:** HIGH on the primary root cause (live production bundle measured directly). MEDIUM/`probable` on the *exact* mobile-Safari failure mode (no device farm in this environment — see Finding R-1 and §Failure Honesty).

---

## 1. Symptom Summary

| | Expected | Actual (reported by Seth) |
|---|---|---|
| Mobile web (phone browser) | Loads fast + reliably | Does **not** load on a phone browser; renders on desktop Safari (login screen screenshot) |
| Blasts tab (Marketing Hub) | Loads quickly | Takes a long time to load |
| General | Fast, efficient, reliable on ALL browsers + ALL devices | "We did an optimization a while back and everything was good but I don't know what changed." |

**Reproduction:** Always (architectural, not intermittent). Confirmed by direct measurement of the deployed production bundle (below).

---

## 2. Headline Evidence — the live production bundle is one 9.24 MB monolith

Fetched directly from production (`business.usemingla.com`), 2026-06-05:

| Artifact | Size | Notes |
|---|---|---|
| `index.html` (served for EVERY route) | **1,379 bytes** | Empty `#root` div + ONE `<script defer>` tag |
| `/_expo/static/js/web/index-3b6a3d97a26dcb9113d8a5a303fd710d.js` (raw) | **9,237,629 bytes (≈8.81 MiB / 9.24 MB)** | The entire app |
| same, gzip (`Accept-Encoding: gzip`) | **1,931,986 bytes (≈1.84 MiB)** | wire transfer |
| same, brotli (`Accept-Encoding: br`) | **1,884,112 bytes (≈1.80 MiB)** | wire transfer (Vercel default) |
| Metro module count in the bundle (`__d(` calls) | **4,262 modules** | all eagerly bundled |

**There is exactly ONE JavaScript file.** Verified that `/marketing`, `/auth/login` (and the SPA fallback `/(.*) → /`) all return the identical 1,379-byte shell pointing at the **same** `index-3b6a3d97…js`. There are **no per-route chunks** under `/_expo/static/js/web/`. Code-splitting is not happening at all in production.

**Mechanism:** the HTML shell paints nothing — `#root` is empty. The browser must (1) download 1.8 MB compressed, (2) decompress to 9.24 MB, (3) parse + compile 9.24 MB of JS, (4) instantiate 4,262 modules, (5) boot the React tree + AuthProvider, **before the first pixel of the login screen appears.** On a phone this is the failure surface.

---

## 3. Investigation Manifest (files read, in trace order)

| File | Why |
|---|---|
| `COMMS_LEDGER.md` (anchor) | Phase 0 mandatory — no BLOCK entries for ORCH-1083/ALL; WARN process rules only |
| `mingla-business/app.json` | web output mode → `web.output: "single"`; `expo-router` plugin has NO `asyncRoutes` |
| `mingla-business/app.config.ts` | dynamic config — does NOT set `web.output` or `asyncRoutes` (so app.json wins) |
| `mingla-business/vercel.json` | build command (`npx expo export -p web`), SPA rewrite `/(.*) → /`, immutable cache on `/_expo/static` |
| `mingla-business/metro.config.js` | no async-route config; workspace aliases; web zustand-CJS + Stripe-Connect native stub |
| `mingla-business/app/_layout.tsx` | root provider tree; `useFonts(MINGLA_THEME_FONTS)` (14 fonts) at module top; analytics deferred post-interaction |
| `mingla-business/src/diagnostics/chunkReloadGuard.ts` | "code-split JS chunks" claim is aspirational — config produces no chunks |
| `mingla-business/src/theme/themeFonts.ts` | 14 `@expo-google-fonts/*` families eagerly imported (ORCH-0964) |
| `mingla-business/app/(tabs)/marketing/index.tsx` | Blasts/Marketing overview route — documents the "4-8s web auth-bootstrap window" |
| `mingla-business/app/(tabs)/marketing/campaigns/index.tsx` | Blasts campaigns list route |
| `mingla-business/src/hooks/marketing/useMarketingOverview.ts`, `useCampaigns.ts` | Blasts data hooks — single query each, gated on auth, 30s stale |
| `mingla-business/src/context/AuthContext.tsx` | bootstrap: `AUTH_BOOTSTRAP_TIMEOUT_MS = 3000`; getSession Promise.race |
| `mingla-business/src/config/queryClient.ts` | retry:2, capped backoff (ORCH-0964) |
| `mingla-business/app/+html.tsx` + `scripts/inject-mobile-blur-css.mjs` | ORCH-0964 mobile-web compositor-crash mitigation (blur-kill) |
| Live `business.usemingla.com` index.html + bundle | direct production measurement (gzip/br/raw) |
| Expo docs (async-routes) + WebKit memory research | external verification (URLs cited) |

---

## 4. Findings (classified)

### 🔴 ROOT CAUSE F-1 — `web.output: "single"` + no async routes ⇒ one 9.24 MB monolithic bundle that must fully parse before first paint

- **File + line:** `mingla-business/app.json:88` (`"output": "single"`) and `app.json:92` (`"expo-router"` plugin entry with **no** `asyncRoutes` option).
- **Exact code:**
  ```json
  "web": { "output": "single", "favicon": "./assets/images/favicon.png" },
  "plugins": [ "expo-router", ... ]   // ← no { "asyncRoutes": { "web": true } }
  ```
- **What it does:** Expo Router with `output: "single"` and `asyncRoutes` disabled statically `require()`s the entire `app/` route tree (107 route files) + all of `src/` (591 files) + react-native-web + every dependency into a single web entry. Production emits one `index-<hash>.js` of **9,237,629 bytes** (1.84 MB gzip / 1.80 MB br) containing 4,262 modules. `index.html` is a 1,379-byte shell with an empty `#root`.
- **What it should do (direction only):** ship a small initial bundle that paints the login/first screen quickly and lazy-loads route bundles on navigation (per-route code splitting), and/or split heavy/route-scoped dependencies out of the initial chunk.
- **Causal chain:** empty `#root` shell → browser downloads 1.8 MB compressed → inflates to 9.24 MB → parse+compile 9.24 MB + instantiate 4,262 modules → boot React + AuthProvider → **only then** first paint. On desktop (multi-GB heap, fast CPU) this completes in a few seconds → renders (matches Seth's desktop screenshot). On a phone (iOS Safari ~300–450 MB heap, slower JS parse) the same parse/compile/heap load crosses the device limit → very slow, unresponsive, or tab-terminated → "does not load." This is also why the **Blasts tab** is slow: it is inside the same monolith and cannot render until the whole bundle boots (and then waits on auth — see F-3).
- **Verification step (performed):** `curl` of `index.html` shows a single `<script src="/_expo/static/js/web/index-3b6a3d97…js" defer>`; `curl` of that file = 9,237,629 bytes raw / 1,931,986 gzip / 1,884,112 br; `/marketing` and `/auth/login` return the identical shell + same hash; zero sibling chunk files. Bundle contains 4,262 `__d(` module definitions. **(proven)**

### 🟠 CONTRIBUTING F-2 — 14 Google Font families eagerly loaded at root via `useFonts`

- **File + line:** `mingla-business/src/theme/themeFonts.ts:1-31` (14 `@expo-google-fonts/*` imports → `MINGLA_THEME_FONTS`); `mingla-business/app/_layout.tsx:364` (`useFonts(MINGLA_THEME_FONTS)` in `RootLayout`).
- **Exact code:** `export const MINGLA_THEME_FONTS = { Inter_500Medium, Poppins_500Medium, SpaceGrotesk_500Medium, PlusJakartaSans_500Medium, Manrope_500Medium, PlayfairDisplay_500Medium, DMSerifDisplay_400Regular, Fraunces_500Medium, Lora_500Medium, BebasNeue_400Regular, Anton_400Regular, Unbounded_500Medium, Caveat_500Medium, DancingScript_500Medium } as const;`
- **What it does:** Loads 14 font families at root before the app shell stabilizes. On web the TTF glyphs are **separate assets** (verified: NO `data:font/ttf;base64` payloads inlined in the JS bundle — 0 occurrences), so they do not bloat the 9.24 MB JS. But each adds a module wrapper to the bundle and `useFonts` adds 14 render-affecting font fetches during boot.
- **Why contributing not root:** the 9.24 MB is overwhelmingly app + framework code, not fonts. The fonts are theme-customization machinery (these families exist so brands can theme their public pages) loaded globally even on the authenticated business app where most are never used.
- **What it should do (direction only):** the public-page-only theme font set should not be eagerly loaded into the authenticated business-app boot path; load on demand per surface.
- **Verification:** `themeFonts.ts` lists 14 families; `package.json` declares 14 `@expo-google-fonts/*` deps; bundle has 0 inlined base64 font payloads; the 14 family paths appear in the bundle's `node_modules` references. **(proven that they are eagerly imported; weight contribution is module-wrapper + asset-fetch, not the JS bulk)**

### 🟠 CONTRIBUTING F-3 — Auth-bootstrap gate ("4-8s window") makes the Blasts tab feel slow even after the bundle loads

- **File + line:** `mingla-business/src/context/AuthContext.tsx:59` (`AUTH_BOOTSTRAP_TIMEOUT_MS = 3000`); `mingla-business/app/(tabs)/marketing/index.tsx:58-64` (comment: "the 4-8s web auth-bootstrap window"); `useMarketingOverview.ts:35-38` (`enabled = isAuthReady && accountId…`).
- **What it does:** Marketing/Blasts data queries are gated on `isAuthReady` (ORCH-1004). On web, `isAuthReady` flips only after the bundle boots AND `supabase.auth.getSession()` resolves (raced against a 3s timeout). So the Blasts tab shows a skeleton until: bundle parse (F-1) + getSession round-trip. The route's own data is cheap (single query, 30s stale, no N+1).
- **Why contributing not root:** the Blasts hooks (`useMarketingOverview`, `useCampaigns`) are clean — one query each, gated correctly, no pagination/virtualization problem, no heavy dependency imported by the route. The slowness is inherited from F-1 (bundle boot) plus the auth gate, NOT route-specific data work.
- **Verification:** read both hooks + both route files end-to-end; queries are single `useQuery` calls; the slowness comment is authored in the route file itself. **(proven — Blasts is not independently slow; it is downstream of F-1 + the auth gate)**

### 🟡 PROBABLE / characterized F-R1 — Mobile "does not load" is the bundle crossing the iOS-Safari memory/parse threshold (not a JS logic crash)

- **Why probable not proven:** I measured the bundle directly (proven) and the external WebKit memory research is authoritative (cited below), and Seth's first-hand report establishes the desktop-works / mobile-fails asymmetry — but I do **not** have a real mobile Safari / mobile Chrome device in this environment to capture the exact terminal state (white screen vs spinner-hang vs tab-reload-loop). Per the Always-Reproduce rule, source + measurement + external-doc reasoning caps this specific sub-claim at `probable`.
- **Evidence:** iOS Safari heap ≈ 300–450 MB; bundles >1–2 MB parsed cause slow parse, unresponsive UI, or tab termination; under memory pressure WebKit discards compiled JS and must recompile (thrash). A 9.24 MB raw bundle expands further once parsed into JS-heap objects. Desktop Safari has GBs of heap → it renders (matches the screenshot). (Sources cited in §6.)
- **Interaction with the auto-reload guard:** `src/diagnostics/chunkReloadGuard.ts` auto-reloads once on a `ChunkLoadError`. If mobile parse fails/aborts in a way that surfaces as a load error, this guard can trigger a reload — which re-downloads + re-parses the same 9.24 MB, plausibly producing the "needs reloading multiple times / never loads" feel on phones.

### 🔵 OBSERVATION F-O1 — ORCH-0964 already discovered an INDEPENDENT mobile-web hard-crash (compositor) and it is mitigated live

- **File + line:** `mingla-business/app/+html.tsx:6-21` + `mingla-business/scripts/inject-mobile-blur-css.mjs` (injects a `@media (max-width:767px) { backdrop-filter:none }` kill into `dist/index.html`).
- **What it documents:** stacked `backdrop-filter: blur()` (BlurView + glass surfaces) "hard-crash the MOBILE browser renderer … crash hits at ~34 DOM nodes" — a compositor-overload crash distinct from bundle size. The mitigation IS deployed (verified: the live `index.html` contains `<style id="mingla-mobile-web-no-blur">`).
- **Why it matters for this ORCH:** (a) it proves the mobile-web renderer is fragile and has TWO independent failure vectors (compositor blur + bundle size); (b) `+html.tsx` is **ignored under `web.output:"single"`** (per the script's own comment) — that is exactly why the blur-kill had to be injected post-build. This is a direct consequence of the single-output mode and reinforces F-1. A fix that changes output mode must preserve this blur-kill in the served HTML.

### 🔵 OBSERVATION F-O2 — No new dependencies were added since the "good optimization"; the bundle did not regress from a new library

- **Evidence:** `diff` of `package.json` dependencies between ORCH-0964 (PR #240, `f6c403367`) and HEAD → **zero added dependencies**. The commits since (ORCH-1001 white-page fix #254, META-ORCH-1002 #256, ORCH-1004 auth-readiness #257, ORCH-1005 removed 40 dead exports #259) were reliability/cleanup, not weight additions. The 14 fonts (F-2) landed earlier, in ORCH-0964 PR #220 (`6f70ae0de`), and `web.output:"single"` landed in META-ORCH-0952 PR #205 (`f62cfefb7`).
- **Implication:** the bundle has likely been ~this large since the single-output mode was adopted; the "everything was good" period was relative (ORCH-0964's reliability work — chunkReloadGuard + ErrorBoundary + retry bump — made the *failures recover* better, which felt like "good," but did not shrink the bundle). What "changed" is most plausibly **organic growth** of the always-monolithic bundle (more routes/components shipped between then and now) crossing the mobile threshold, not a single regressing commit. (See §"What Changed" below.)

---

## 5. Five-Layer Cross-Check

| Layer | Finding |
|---|---|
| **Docs** | Memory + comments claim the web app is "code-split JS chunks" (chunkReloadGuard header) and that an "optimization" made it good (ORCH-0964). **Contradiction:** the deployed artifact has zero chunks. The "good optimization" was reliability/recovery (ErrorBoundary, auto-reload, retry), not bundle reduction. |
| **Schema** | N/A (no DB in the load path; Blasts hooks are clean). |
| **Code** | `app.json` sets `output:"single"`, `expo-router` plugin has no `asyncRoutes` → monolithic by construction. Confirmed in source. |
| **Runtime** | Live: one 9.24 MB JS file (1.8 MB compressed), 4,262 modules, served for all routes via SPA fallback. Immutable cache header IS set on `/_expo/static` (repeat visits cached). |
| **Data** | The deployed bundle hash `index-3b6a3d97a26dcb9113d8a5a303fd710d.js` is the single source of truth for what ships; measured raw/gzip/br above. |

**Contradiction located:** the "code-split / optimized" narrative (Docs) vs the single-monolith reality (Runtime/Data). The Runtime/Data layer holds the truth.

---

## 6. External Research (Prime Directive 12 — cited)

- **Expo Router async routes (code-splitting on web) is opt-in and ALPHA.** Exact config:
  ```json
  "plugins": [[ "expo-router", { "asyncRoutes": { "web": true } } ]]
  ```
  Status: alpha ("early preview"). Caveats: "In development the runtime JS is lazily bundled so the HTML may not match the available JS"; "Custom SuspenseFallback exports do not work with async routes"; native production async routes unsupported. Source: https://docs.expo.dev/router/web/async-routes/ ; bundle-splitting via React Suspense per route confirmed in the Router v3 changelog https://expo.dev/changelog/2024-01-23-router-3
- **iOS Safari / WebKit memory limits** (mobile-failure mechanism): mobile heap ≈ 300–450 MB; large JS bundles (>1–2 MB parsed) → slow parse, unresponsive UI, tab termination; ~20% JS reduction can yield ~50%+ crash reduction; under memory pressure WebKit discards compiled JS (recompile thrash). Sources:
  - https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit
  - https://lapcatsoftware.com/articles/2026/1/7.html
  - https://www.xjavascript.com/blog/is-there-a-max-javascript-filesize-what-can-browsers-handle/

---

## 7. What Changed Since the "Good Optimization" (regression pinning)

| Commit | What it did | Effect on bundle |
|---|---|---|
| `f62cfefb7` META-ORCH-0952 (PR #205) | First set `web.output: "single"` | **Established the monolith** (root architecture) |
| `6f70ae0de` ORCH-0964 (PR #220) | Public-page theme customization + **14 Google fonts** + consumer brand screen | Added the eager 14-font theme machinery (F-2) |
| `f6c403367` ORCH-0964 (PR #240) | "web reliability overhaul" — chunkReloadGuard + outer ErrorBoundary + auto-reload + retry bump | **The "good optimization"** — improved failure *recovery*, NOT bundle size |
| `ddc581a0f` ORCH-1001 (#254) | white-page crash fix | reliability |
| `cf18f0713` META-ORCH-1002 (#256) | Android glass solid surfaces | minor |
| `3562c9b09` ORCH-1004 (#257) | auth-readiness gate on auth-scoped hooks | added the `isAuthReady` gate (F-3); reliability, slight perceived-latency cost |
| `1536888f0` ORCH-1005 (#259) | removed 40 dead exports | small reduction |

**Conclusion on "what changed":** there is **no single regressing commit that bloated the bundle.** The web app has been a single monolith since META-ORCH-0952. The "good" period was ORCH-0964's *recovery* improvements masking the underlying weight. Most likely the bundle has grown organically (routes/features added across dozens of ORCHs) until it crossed the mobile-Safari threshold, while desktop kept absorbing it. (Exact historical byte-size trend is not recoverable without re-exporting each commit, which the corrupted anchor node_modules currently blocks — see §Tooling note.)

---

## 8. Ruled-out / confirmed alternative causes (NON-bundle)

| Candidate | Verdict | Evidence |
|---|---|---|
| Broken SPA fallback (routes 404) | **RULED OUT** | `/marketing`, `/auth/login`, `/(.*)` all return HTTP 200 + the index shell. |
| Vercel build/deploy broken | **RULED OUT** | HTTP 200, valid `index.html`, valid hashed bundle, immutable cache headers present, brotli served. |
| Missing compression | **RULED OUT (good)** | Vercel serves brotli (1.80 MB) + gzip (1.84 MB). Compression is fine; the problem is *parse/execute* of the 9.24 MB decompressed payload, which compression does not help. |
| Auth/data-readiness regression (ORCH-1004 class) | **CONTRIBUTING, not root (F-3)** | Blasts hooks are gated correctly; the gate adds perceived latency but does not block first paint or cause the mobile non-load. |
| N+1 / heavy data fetch / missing virtualization on Blasts | **RULED OUT** | `useMarketingOverview` + `useCampaigns` each issue ONE query, 30s stale; lists are small `.map()` renders. |
| New heavy dependency added recently | **RULED OUT (F-O2)** | Zero dependencies added since ORCH-0964. |
| Render loop / blocking network before first paint | **PARTIAL** | Analytics SDKs are correctly deferred (`InteractionManager.runAfterInteractions`, `_layout.tsx:195-210`). The blocking work before first paint is the bundle parse itself (F-1), not a network call. |
| Mobile compositor blur crash (ORCH-0964) | **MITIGATED, separate vector (F-O1)** | The blur-kill `<style>` IS in the live HTML. A distinct, already-handled mobile failure mode — relevant only as a "preserve this" constraint for any output-mode change. |

---

## 9. Blast Radius

- **Every route on `business.usemingla.com`** pays the full 9.24 MB cost (SPA fallback serves the same bundle everywhere). Login, Home, Hub, Marketing/Blasts, Brand, Events, Partner, Checkout — all gated behind the single boot.
- **Public buyer pages** (`/b/{slug}`, `/e/{brand}/{event}`, `/t/{brand}/{trip}`) — these are the most SEO/share-sensitive and also the most mobile-trafficked (buyers open share links on phones). They have a crawler-only OG rewrite (`vercel.json` `has: user-agent bot`) to `/api/public-*`, but a **real human on a phone** hits the same 9.24 MB SPA. This is the highest-impact mobile surface.
- **Any fix that changes `web.output` or adds `asyncRoutes`** touches: the Vercel SPA rewrite (`/(.*) → /`), deep-link behavior, the post-build blur-kill injection (F-O1, which exists *because* of single-output), the crawler OG rewrites, and the chunkReloadGuard (which becomes genuinely load-bearing once chunks exist).

---

## 10. FIX DIRECTION OPTIONS (for orchestrator/operator decision — NOT a spec)

These are candidate directions with trade-offs. Several are combinable. **No fix is implied or approved by this report.**

### Option A — Enable per-route code splitting via `asyncRoutes: { web: true }`
- **What:** add `[ "expo-router", { "asyncRoutes": { "web": true } } ]` to `app.json` plugins. Metro splits each route into its own lazily-loaded chunk via React Suspense; initial bundle shrinks to the shell + first route + shared framework.
- **Pros:** largest single win on initial-load weight; native iOS/Android unaffected (web-only flag); keeps `output:"single"` (SPA model, rewrites, deep-links unchanged in shape).
- **Cons / risks:** **Expo flags this ALPHA** (https://docs.expo.dev/router/web/async-routes/) — must be validated hard before production. Caveats: custom SuspenseFallback exports don't work; chunkReloadGuard becomes load-bearing (transient chunk fetch failures now real); needs a route-transition loading state; must re-verify the post-build blur-kill (F-O1) and OG rewrites still hold. Requires a real browser TTI measurement pre/post.

### Option B — Switch `web.output` to `"static"` (per-route static HTML + hydration)
- **What:** `web.output: "static"` pre-renders each route to its own HTML file + splits JS per route; first paint can show server-rendered markup before hydration.
- **Pros:** better first-contentful-paint (real HTML, not an empty `#root`); better SEO/OG for human-and-crawler alike; natural code-splitting.
- **Cons / risks:** biggest architectural change — alters the Vercel routing model (the `/(.*) → /` SPA fallback would change), interacts with the existing crawler OG rewrites and `+html.tsx` (which is currently *ignored* under single — it would become active under static, so the blur-kill must move back into `+html.tsx` and the inject script retired or reconciled). Dynamic routes (`[id]`) need care (static export pre-renders known paths; unknown IDs need fallback or `server` output). Highest verification burden; most likely to surface deep-link / RN-web hydration edge cases. RN-web hydration mismatches are a known source of bugs.

### Option C — Lazy-load heavy + route-scoped dependencies out of the initial chunk (works with or without A/B)
- **What:** dynamic-`import()` the heaviest, non-boot-critical libs so they leave the initial bundle: Stripe (`@stripe/connect-js`, `@stripe/react-connect-js`, `@stripe/stripe-react-native` — checkout/connect only), Lottie (`@lottiefiles/dotlottie-react`, `lottie-react-native`), QR (`react-native-qrcode-svg`), camera/video-trim, and the **14-font theme set (F-2)** — load the public-page theme fonts only on public/theme surfaces, not at business-app root.
- **Pros:** incremental, low-architecture-risk, no output-mode change, no Vercel/rewrite/deep-link impact; directly attacks the bytes that aren't needed at login. Pairs well with A.
- **Cons / risks:** smaller per-item wins; requires touching many call sites; needs care that route-scoped Stripe stays out of native startup (already partly handled via the metro native-stub). The font change must not regress public-page theming.

### Option D — Auth-bootstrap perceived-latency polish for Blasts (F-3) — secondary
- **What:** allow the first paint of the app shell (and a Blasts skeleton) without waiting on the full auth round-trip; tune the 3s `AUTH_BOOTSTRAP_TIMEOUT_MS` / `isAuthReady` gate so the shell appears faster.
- **Pros:** improves the *perceived* Blasts speed specifically.
- **Cons / risks:** does NOT fix the mobile non-load (that's F-1); changing the auth gate risks reintroducing the ORCH-1004 "renders empty-state during bootstrap" bug — must be done carefully with the I-DISABLED-QUERY-IS-LOADING invariant intact. Lowest priority; only meaningful AFTER F-1 is addressed.

### Recommended sequencing for operator consideration (decision, not spec)
1. **Measure first:** capture a real mobile-browser TTI + a memory profile against the current 9.24 MB bundle (Playwright is configured at `mingla-business/playwright.config.ts`) so any fix has a before/after number. (Could not run a real browser TTI in this investigation environment — see Tooling note.)
2. **Option C** (lazy heavy deps + de-globalize the 14 fonts) is the lowest-risk first cut with no routing/SEO impact.
3. **Option A** (asyncRoutes web) is the highest-leverage next step but its ALPHA status demands a hard validation pass (deep-links, OG, blur-kill, chunk-fetch failure recovery) before production.
4. **Option B** (`static`) only if the team wants the SEO/FCP win and is willing to absorb the Vercel-routing + hydration + OG-rewrite reconciliation cost.
5. **Option D** is a polish follow-on, after F-1 is materially reduced.

**Cross-cutting constraints any fix MUST preserve:** the mobile blur-kill in served HTML (F-O1); the crawler OG rewrites in `vercel.json`; deep-link routing for `/b`, `/e`, `/t`, `/connect-*`, `/checkout`; the immutable cache headers on `/_expo/static`; native iOS/Android must be untouched (web-only changes).

---

## 11. Tooling note (why the local export could not be re-run)

Per the worktree-web-export memory rule, a local `expo export -p web --clear` was attempted to measure the bundle. The worktree's `node_modules` is a **symlink** to the anchor (`/Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules`), and the anchor's `node_modules` is currently **corrupted**: its `.bin` directory has only 1 entry plus stray macOS-duplicate `node_modules/.bin 2` and `.bin 3` directories (the `* [0-9]` duplicate-ref hazard), and `@expo/json-file`'s `json5.parse` throws `TypeError: json5_1.default.parse is not a function` at config-parse — the export dies before Metro even bundles. This is a **local environment problem, not a code regression.** I therefore measured the **deployed production bundle directly** (more authoritative for this symptom, since the complaint is about the live site). A clean `npm ci` in the worktree would be required to reproduce the export locally; it was not necessary because the production measurement is definitive.

---

## 12. Discoveries for Orchestrator

- **D-1 (env):** the shared anchor `mingla-business/node_modules` is corrupted (`json5.parse` TypeError + duplicate `.bin 2`/`.bin 3` dirs). Any session needing a local web export or `eas update` from this anchor/symlinked worktrees will fail at config-parse until a clean `npm ci`. Recommend a one-time anchor `node_modules` rebuild.
- **D-2 (architecture):** `app/+html.tsx` is dead under `web.output:"single"` (Expo ignores it) — the mobile blur-kill survives only via the post-build inject script. If output mode ever changes, `+html.tsx` reactivates and the two blur-kill sources must be reconciled (currently both define the same `@media` rule — harmless duplication today, a footgun on output-mode change).
- **D-3 (public surface):** the highest-value mobile surface is the public buyer pages (`/b`, `/e`, `/t`) — humans open share links on phones and hit the full 9.24 MB SPA. Whatever fix lands, prioritize these for the before/after mobile measurement.

---

## 13. Confidence

- **F-1 (root cause): HIGH / `proven`** — deployed bundle measured directly (9.24 MB raw / 1.84 MB gz / 1.80 MB br, one file, 4,262 modules, zero chunks, same bundle for all routes); config confirmed in source (`output:"single"` + no `asyncRoutes`).
- **F-2, F-3, F-O1, F-O2: HIGH / `proven`** in their scoped claims (file-confirmed).
- **F-R1 (exact mobile-Safari terminal failure mode): MEDIUM / `probable`** — measurement + authoritative WebKit memory docs + operator's desktop-vs-mobile report, but no real mobile-browser repro in this environment. A device/Playwright-mobile run would lift this to `proven`.

---

## 14. Completion Condition self-check

1. Root cause six fields + ≥2 candidates with non-causes disproven — ✅ (F-1 full six fields; §8 disproves SPA/Vercel/compression/N+1/new-dep/render-loop).
2. Pipeline traced backward (symptom→bundle→config) + forward (config→served artifact→mobile terminal state) — ✅.
3. Journey mapped (login/Blasts intent → empty shell → 9.24 MB boot → auth gate → render or mobile-fail) + divergence named — ✅.
4. External research with URLs (Expo async-routes alpha + WebKit memory) — ✅.
5. Pertinent files read in full — ✅.
6. DB-object latest-migration rule — N/A (no DB in the load path; Blasts hooks confirmed clean).
7. Live UI/runtime repro — measured the deployed bundle directly (proven); mobile terminal-state capped at `probable` with the blocker named (no device farm here) per the Always-Reproduce rule.
