# SPEC - ORCH-1085 [Business web code-splitting]

- **Mode:** SPEC only. No implementation, no deploy, no OTA, no merge, no reap.
- **Date:** 2026-06-05
- **Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1085-[business-web-code-splitting]/` on branch `ORCH-1085-business-web-code-splitting`
- **Surface:** `mingla-business/` Expo Router web export on Vercel, primarily `business.usemingla.com` mobile browser boot.
- **Required output:** this file.
- **Decision status:** `PASS - ready for Seth approval`, with hard stop before implementation.

## 1. Outcome And User Goal

Seth's user-facing goal is simple: Mingla Business web must boot reliably and quickly on phones, including public buyer links, not just desktop Safari. ORCH-1083 proved the current symptom is not a data-fetch bug, a Vercel compression bug, or a broken fallback; it is an architecture problem. `web.output:"single"` plus no route-level async loading makes every human route pay for one 9.24 MB JavaScript app before first paint.

The spec below is the architecture cure contract. It does not repeat ORCH-1083's safe Phase 1 deferrals. It requires route-level code splitting via Expo Router `asyncRoutes:{web:true}` as the recommended first plan, validates it against all deep-link/share-preview hazards, and reserves `web.output:"static"` as a higher-risk fallback only after Seth explicitly approves the dynamic-route and hydration trade-offs.

## 2. Phase 0 And Evidence Read

### 2.1 Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. Open WARN entries to `ALL` were acknowledged in the anchor ledger with `mingla-forensics+codex (ORCH-1085 SPEC - factored; no implement/deploy/OTA/merge/reap; later release only from merged main per COMMS-0015/0018)`.

Hard carry-forward:

- **COMMS-0015:** any later web deploy must happen only after the PR is merged to `main`, source is verified on `origin/main`, and deploy is run from merged main. Never deploy from this worktree as the durable release source.
- **COMMS-0018:** same class for backend/source drift: source must be reconciled onto `main` before deployment. ORCH-1085 touches web build architecture, so Vercel release must be from merged `main`.

### 2.2 Prior artifacts and code read

Required inputs read:

- `Mingla_Artifacts/prompts/SPEC_ORCH-1085_BUSINESS_WEB_CODE_SPLITTING.md`
- ORCH-1083 investigation/spec/implementation from sibling worktree:
  - `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/Mingla_Artifacts/reports/INVESTIGATION_ORCH-1083_BUSINESS_WEB_LOAD_PERF.md`
  - `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/Mingla_Artifacts/specs/SPEC_ORCH-1083_BUSINESS_WEB_LOAD_PERF.md`
  - `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1083_BUSINESS_WEB_LOAD_PERF.md`
  - `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/mingla-business/playwright/orch-1083-load-perf.config.ts`
  - `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/mingla-business/playwright/orch-1083-load-perf.spec.ts`
- Current ORCH-1085 worktree files:
  - `mingla-business/app.json`
  - `mingla-business/app.config.ts`
  - `mingla-business/vercel.json`
  - `mingla-business/scripts/inject-mobile-blur-css.mjs`
  - `mingla-business/app/+html.tsx`
  - `mingla-business/src/diagnostics/chunkReloadGuard.ts`
  - `mingla-business/api/public-event.js`, `public-brand.js`, `public-trip.js`
  - `mingla-business/api/og-event.js`, `og-brand.js`, `og-trip.js`
  - route inventory under `mingla-business/app/`
  - `mingla-business/src/services/businessNotificationRouting.ts`
  - `mingla-business/src/config/routes.ts`
- Memories read:
  - `feedback_worktree_per_orch_workflow.md`
  - `feedback_ship_verify_merge_before_reap.md`
  - `feedback_vercel_deploy_gate.md`
  - `feedback_anon_buyer_routes.md`
  - `reference_worktree_web_export_needs_clear.md`

Important dependency note: ORCH-1083's implementation branch currently contains the reusable harness and Phase 1 artifacts, but commit `61a73060` is not an ancestor of this ORCH-1085 worktree HEAD. Before ORCH-1085 implementation, either rebase ORCH-1085 onto the merged ORCH-1083 state or port the exact ORCH-1083 harness files from the ORCH-1083 branch. Do not invent a new measurement standard.

### 2.3 Official docs cited for changed config behavior

- Expo web output targets: Expo says `single` outputs a SPA with one `index.html`, while `static` outputs separate HTML files for every app route. Source: https://docs.expo.dev/guides/publishing-websites/ .
- Expo static rendering: `web.output:"static"` uses `expo export --platform web`, creates static route HTML, and dynamic routes do not work arbitrarily without generated known params or another handler. It also says static output is not a SPA and does not need SPA-style redirects. Source: https://docs.expo.dev/router/web/static-rendering/ .
- Expo async routes: Expo says `asyncRoutes` can enable production bundle splitting, is alpha, wraps routes in Suspense, has caveats, and does not support native production apps yet. Source: https://docs.expo.dev/router/web/async-routes/ .
- Expo Router plugin properties: `asyncRoutes` accepts boolean/string/object platform settings, and production is currently web-only and disabled on native. Source: https://docs.expo.dev/versions/latest/sdk/router/ .
- Vercel rewrites: Vercel rewrites route a request to a different destination without changing the URL, and `vercel.json` is the official configuration location. Source: https://vercel.com/docs/routing/rewrites .
- Vercel conditional routing: Vercel `vercel.json` supports `has` conditions on headers in routing rules, but `has` does not yet work locally with `vercel dev` and does work when deployed. Source: https://vercel.com/docs/project-configuration/vercel-json .

## 3. Proven Current State

### 3.1 Root cause dependency on ORCH-1083

ORCH-1083 proved the live production app was serving:

- one `index.html` shell of 1,379 bytes;
- one JavaScript file of 9,237,629 bytes raw, about 1.84 MB gzip and 1.80 MB brotli;
- 4,262 Metro modules in that single file;
- the same shell and same JS hash for `/marketing`, `/auth/login`, public routes, and SPA fallback routes;
- no route-level chunks for normal Expo Router routes.

ORCH-1083 Phase 1 then safely deferred Stripe Connect web SDK pages, theme fonts, and QR rendering. The measured result was honest and small:

- initial JS raw: 9,236,985 bytes to 9,131,533 bytes, a 1.14 percent reduction;
- mobile-profile first root child median: 47,233 ms to 46,727 ms, a 1.07 percent improvement;
- chunks increased and the deferrals structurally worked, proving the safe cut was correct but not the cure.

Conclusion: more selective lazy imports will not deliver the phone-boot outcome. The remaining cost is the route tree, framework, shared root layout, and app-level code all still pulled into the initial entry. ORCH-1085 must split routes.

### 3.2 Current config truth

Current `mingla-business/app.json`:

```json
"web": {
  "output": "single",
  "favicon": "./assets/images/favicon.png"
},
"plugins": [
  "expo-router"
]
```

`mingla-business/app.config.ts` filters optional native plugins and adds native config/plugins, but does not override `web.output` or add `expo-router` `asyncRoutes`.

Current `mingla-business/vercel.json`:

- build command: `npx expo export -p web && node scripts/inject-mobile-blur-css.mjs`;
- output directory: `dist`;
- crawler/share-preview bot UA rewrites for `/e/:brandSlug/:eventSlug`, `/t/:brandSlug/:tripSlug`, and `/b/:brandSlug`;
- explicit OG image rewrites for `/og/event/:eventId.png`, `/og/brand/:brandSlug.png`, `/og/trip/:tripId.png`;
- `/stripe-onboarding-return` rewrite to `/stripe-onboarding-return.html`;
- final SPA catch-all `{ "source": "/(.*)", "destination": "/" }`;
- immutable cache header for `/_expo/static/(.*)`;
- `.well-known` content-type headers.

Current `mingla-business/scripts/inject-mobile-blur-css.mjs` injects a `<style id="mingla-mobile-web-no-blur">` into `dist/index.html` after export. It is needed because `app/+html.tsx` is ignored under `web.output:"single"` but would become active under static rendering. The script intentionally fails open today.

Current `mingla-business/src/diagnostics/chunkReloadGuard.ts` listens for chunk-load error strings and auto-reloads once with a 10 second sessionStorage cooldown. This was aspirational under the monolith and becomes genuinely load-bearing once route chunks exist.

## 4. Scope, Non-Goals, And Assumptions

### 4.1 Scope

ORCH-1085 implementation, if approved, may change:

- `mingla-business/app.json` or `mingla-business/app.config.ts` only to add Expo Router web async route config and, if Seth approves fallback Plan B, change web output mode.
- `mingla-business/vercel.json` only as required to preserve deep links, OG/share-preview rewrites, immutable `_expo/static` cache, `.well-known` headers, and SPA/static fallback behavior.
- `mingla-business/scripts/inject-mobile-blur-css.mjs` only as required to preserve the mobile blur-crash mitigation across the selected output mode.
- `mingla-business/app/+html.tsx` only if static output is selected or if the implementor proves the blur-kill needs to move from post-export injection to root HTML.
- `mingla-business/src/diagnostics/chunkReloadGuard.ts` and the root error/loading surface only to make chunk-fetch failure recovery user-visible, non-looping, and testable.
- ORCH-1083 measurement harness files under `mingla-business/playwright/` and bundle budget/test scripts.

### 4.2 Non-goals

- No Supabase migrations, RLS, RPC, edge functions, Stripe payload changes, Paystack changes, or backend deploy.
- No native iOS/Android build architecture change. `asyncRoutes` must be configured web-only.
- No rewrite of checkout, public event/brand/trip data fetching, notification routing, auth boot, or Stripe Connect flows beyond validating direct-route boot.
- No SEO redesign. The goal is mobile boot reliability while preserving existing share-preview behavior.
- No Vercel deploy, Expo OTA, PR merge, or reaping in this phase.

### 4.3 Assumptions

- ORCH-1083 Phase 1 is accepted context, but ORCH-1085 implementation must confirm whether those commits are on its base. If not, rebase or port the exact harness before measuring.
- `asyncRoutes:{web:true}` on Expo Router 6.0.23 is intended to split route bundles in production web, but Expo labels the feature alpha, so success is a validation result, not an assumption.
- Dynamic public routes (`/b/:brandSlug`, `/e/:brandSlug/:eventSlug`, `/t/:brandSlug/:tripSlug`, `/checkout/*`, `/o/:orderId`, and business authenticated dynamic routes) must continue to resolve from arbitrary links.
- Current bot/share-preview behavior is production-critical and must be preserved before any byte win counts as success.

## 5. Options Matrix

| Option | Config shape | Expected win | Risk | Vercel impact | Recommendation |
|---|---|---:|---|---|---|
| A. `asyncRoutes:{web:true}` with `web.output:"single"` | Keep `web.output:"single"`. Change Expo Router plugin to `["expo-router", { "asyncRoutes": { "web": true, "android": false, "ios": false, "default": false } }]`. | High initial-JS reduction if route chunks actually split. | Expo alpha caveats; chunk fetch failures become real; first navigation to a route can show Suspense/loading. | Lowest. Existing SPA catch-all and bot rewrites can remain if validated. | **Recommended first plan.** |
| B. `web.output:"static"` only | Set `web.output:"static"`, no asyncRoutes at first. | Potentially better first contentful paint from static HTML; route HTML output. | Highest dynamic-route risk; Expo docs warn dynamic routes do not arbitrarily work without static params/handlers; previous META-ORCH-0952 static output caused hydration mismatch. | High. Existing catch-all likely must change or be replaced route-by-route. | **Do not start here. Use only after Seth approves risk.** |
| C. Combined `web.output:"static"` plus `asyncRoutes:{web:true}` | Static route HTML plus route-linked async chunks. | Potentially best for known static pages. | Highest complexity: alpha async routes plus static dynamic-route caveats plus Vercel rewrite changes. | Highest. Must prove dynamic routes, OG endpoints, blur-kill, and fallback from scratch. | **Fallback/research track only.** |
| D. No-go rollback | Keep `web.output:"single"`, remove asyncRoutes/static changes. | Returns to known monolith plus ORCH-1083 Phase 1 only. | Performance problem remains. | Existing behavior preserved. | **Rollback if A/B/C fail validation.** |

Recommended plan: implement Option A first. It targets the actual monolith while preserving the SPA routing shape that currently protects dynamic routes. Option B/C only proceed if Option A fails to materially split initial JS or if Seth explicitly chooses SEO/static HTML gains over the higher dynamic-route and hydration risk.

## 6. Route And Deep-Link Contract

### 6.1 Routes that must work as arbitrary direct browser URLs

Business/authenticated routes:

- `/`, `/auth`, `/home`, `/hub`, `/hub/events`, `/hub/experiences`, `/hub/trips`, `/marketing`, `/marketing/campaigns`, `/marketing/campaigns/compose`, `/account`
- `/brand/:id`, `/brand/:id/edit`, `/brand/:id/listing`, `/brand/:id/payments`, `/brand/:id/payments/onboard`, `/brand/:id/pricing-defaults`, `/brand/:id/scanners`, `/brand/:id/team`, `/brand/:id/blasts`
- `/event/:id`, `/event/:id/edit`, `/event/:id/preview`, `/event/:id/guests`, `/event/:id/orders`, `/event/:id/scanner`, `/event/:id/door`, `/event/:id/blasts`
- `/trip/:id`, `/trip/:id/edit`
- `/experience/:id`, `/experience/:id/edit`
- `/partner/earnings`, `/partner/brands`
- `/notifications`, `/venue/create`, `/venue/deck-readiness`

Buyer/anonymous routes that share the host and must never become auth-gated:

- `/b/:brandSlug`
- `/e/:brandSlug/:eventSlug`
- `/t/:brandSlug/:tripSlug`
- `/exp/:brandSlug/:experienceSlug`
- `/checkout/:eventId`, `/checkout/:eventId/buyer`, `/checkout/:eventId/payment`, `/checkout/:eventId/confirm`
- `/checkout-trip/:tripEventId`, `/checkout-trip/:tripEventId/buyer`, `/checkout-trip/:tripEventId/intake`, `/checkout-trip/:tripEventId/payment`, `/checkout-trip/:tripEventId/confirm`
- `/checkout-experience/:experienceEventId`, `/checkout-experience/:experienceEventId/buyer`, `/checkout-experience/:experienceEventId/payment`, `/checkout-experience/:experienceEventId/confirm`
- `/o/:orderId`

Stripe/return routes:

- `/connect-onboarding`, `/connect-account-management`, `/connect-partner-onboarding`, `/connect-partner-account-management`, `/connect-tax-registrations`
- `/stripe-onboarding-return`
- `mingla-business://...` native deep links parsed by `businessNotificationRouting.ts` remain native-routing scope; web changes must not alter those strings.

### 6.2 Deep-link success criteria

- Direct navigation to every route family above returns HTTP 200 and a nonblank first render.
- Anonymous buyer routes stay outside `(tabs)` and do not route through a new auth gate.
- Authenticated routes can show the existing signed-out welcome/login surface when unauthenticated, but cannot show blank white while route chunk loads.
- Route chunks for deep-linked routes load without console errors under cold cache.
- For Option A, the existing `/(.*)->/` SPA fallback remains the default unless validation proves Expo/Vercel now needs a more specific destination such as `/index.html`. The fallback must remain last, after bot rewrites and `/stripe-onboarding-return`.
- For Option B/C, do not rely on `/(.*)->/` to paper over missing static dynamic routes. Static output validation must prove dynamic route requests map to working generated files or intentionally route to the SPA shell without breaking Expo's static output model. If arbitrary dynamic public routes cannot be proven, Option B/C is a no-go.

## 7. Vercel Contract

### 7.1 Existing behavior to preserve

`vercel.json` rule ordering must remain semantically:

1. Explicit OG image rewrites:
   - `/og/event/:eventId.png -> /api/og-event?eventId=:eventId`
   - `/og/brand/:brandSlug.png -> /api/og-brand?brandSlug=:brandSlug`
   - `/og/trip/:tripId.png -> /api/og-trip?tripId=:tripId`
2. Bot-UA share-preview rewrites for public pages:
   - `/e/:brandSlug/:eventSlug -> /api/public-event?...` when UA matches configured bot/crawler regex
   - `/t/:brandSlug/:tripSlug -> /api/public-trip?...` when UA matches configured bot/crawler regex
   - `/b/:brandSlug -> /api/public-brand?...` when UA matches configured bot/crawler regex
3. `/stripe-onboarding-return -> /stripe-onboarding-return.html`
4. Final human fallback, currently `/(.*) -> /`

Vercel docs confirm rewrites preserve the browser URL and are configured in `vercel.json` (https://vercel.com/docs/routing/rewrites). Vercel docs also confirm `has` header conditions are supported in deployed routing, with a local `vercel dev` limitation (https://vercel.com/docs/project-configuration/vercel-json). Therefore production/preview validation must use an actual Vercel deploy or an equivalent hosted environment for the bot-UA rules; local-only testing is insufficient.

### 7.2 Validation commands for Vercel behavior

Implementation must add a script or Playwright/request test that, against a locally served export where possible and a Vercel preview after merge-ready build where required, proves:

- Human UA:
  - `GET /b/test-brand` returns the Expo app shell or static HTML and loads client route.
  - `GET /e/test-brand/test-event` returns the Expo app shell or static HTML and loads client route.
  - `GET /t/test-brand/test-trip` returns the Expo app shell or static HTML and loads client route.
- Bot UA:
  - `curl -A "facebookexternalhit/1.1" /e/:brandSlug/:eventSlug` returns the HTML from `/api/public-event`, including OG tags or rendered preview title.
  - `curl -A "Twitterbot/1.0" /t/:brandSlug/:tripSlug` returns `/api/public-trip` HTML.
  - `curl -A "Slackbot-LinkExpanding 1.0" /b/:brandSlug` returns `/api/public-brand` HTML.
- OG PNG endpoints:
  - `/og/event/:eventId.png`, `/og/brand/:brandSlug.png`, `/og/trip/:tripId.png` return `content-type: image/png` and nonzero bytes.
- Fallback:
  - a known non-route such as `/__orch1085_unknown_route_probe` returns the intended not-found route or SPA shell with a visible not-found screen, not a Vercel 404 and not raw API output.

### 7.3 Option-specific Vercel rules

Option A:

- Keep `outputDirectory:"dist"` and build command unless export output changes.
- Keep existing `/(.*)->/` fallback after validating all route/deep-link probes.
- Keep immutable `_expo/static` header. Hashed chunks must remain cacheable.

Option B/C:

- Re-evaluate `/(.*)->/`. Expo static rendering docs say static output is not a SPA and does not need SPA-style redirects (https://docs.expo.dev/router/web/static-rendering/). If static output is selected, the implementor must propose the exact Vercel fallback rules before changing them.
- Dynamic public routes are no-go unless one of these is proven:
  - `generateStaticParams` covers the tested dynamic routes and the product accepts finite pre-generation; or
  - Vercel rewrites selected human dynamic routes to a valid SPA/static shell without causing React hydration mismatch; or
  - Option B/C is abandoned in favor of Option A.
- Bot-UA API rewrites must remain before human fallback/static routing.

## 8. Build, Export, And Post-Export Contract

### 8.1 Required export command

For local validation in per-ORCH worktrees:

```bash
cd mingla-business
npx expo export -p web --clear --output-dir web-build-orch1085
```

Reason: `reference_worktree_web_export_needs_clear.md` documents that per-ORCH worktrees with symlinked `node_modules` can emit degenerate "No routes found" bundles unless `--clear` is passed. Do not judge ORCH-1085 from an uncleared export.

For Vercel production build:

```bash
npx expo export -p web && node scripts/inject-mobile-blur-css.mjs
```

may remain for Option A if `dist` output is preserved. If implementation uses `--clear` in the Vercel build command, it must explain build-time impact and prove Vercel still emits the expected files.

### 8.2 Expo config requirements

Option A required config:

```json
{
  "expo": {
    "web": {
      "output": "single"
    },
    "plugins": [
      [
        "expo-router",
        {
          "asyncRoutes": {
            "web": true,
            "android": false,
            "ios": false,
            "default": false
          }
        }
      ]
    ]
  }
}
```

If `app.config.ts` currently spreads `config.plugins` and adds more plugins, the implementor must verify the final resolved Expo config contains exactly one Expo Router plugin entry and that the asyncRoutes object survives dynamic config resolution. A config-print check is required:

```bash
cd mingla-business
npx expo config --type public | rg -n "asyncRoutes|expo-router|output"
```

Pass condition: `web.output` remains `single`, and the Expo Router plugin includes `asyncRoutes.web:true`.

Option B/C required config, only after Seth approval:

```json
"web": { "output": "static" }
```

and any asyncRoutes option must remain web-only.

### 8.3 Mobile blur-crash workaround

The mobile blur-kill is non-negotiable. The implementation must prove one of these:

- Option A: `scripts/inject-mobile-blur-css.mjs` still injects `<style id="mingla-mobile-web-no-blur">` into the served `dist/index.html`, and a direct `curl` of the served root contains the marker before any app JS.
- Option B/C: `app/+html.tsx` static root HTML includes the blur-kill for every generated page, and either the inject script remains harmless/idempotent across all relevant generated HTML files or is replaced by a script that injects the marker into every generated HTML file. Do not leave only one route protected.

Validation commands:

```bash
rg -n "mingla-mobile-web-no-blur|backdrop-filter:none|backdrop-filter: none" dist web-build-orch1085
curl -s <served-url> | rg "mingla-mobile-web-no-blur"
curl -s <served-url>/b/<brandSlug> | rg "mingla-mobile-web-no-blur"
curl -s <served-url>/e/<brandSlug>/<eventSlug> | rg "mingla-mobile-web-no-blur"
```

For Option B/C, every generated public and root HTML file must contain the marker. Any missing marker is a FAIL because it reopens the ORCH-0964 mobile browser crash vector.

### 8.4 Asset and chunk path contract

- All JS chunks must live under `/_expo/static/js/web/` or the Expo-emitted equivalent.
- Vercel immutable cache header must continue to match the chunk path.
- `index.html` or route HTML must reference chunks by absolute paths that work on direct dynamic routes, not relative paths that break under `/brand/:id` or `/checkout/:id`.
- Cache validation must include one cold-cache and one warm-cache run.

## 9. Runtime Failure Handling Contract

### 9.1 Chunk-fetch failure recovery

Existing `chunkReloadGuard.ts` must be upgraded from aspirational to validated:

- It must detect common route chunk failures:
  - `ChunkLoadError`
  - `Failed to fetch dynamically imported module`
  - `error loading dynamically imported module`
  - `Importing a module script failed`
- It must auto-reload at most once within the cooldown window.
- It must never loop on repeated chunk failures.
- After the one reload has already been attempted, the user must see a recoverable error screen, not blank white. The ErrorBoundary or route-level fallback copy must say plainly that the app update could not load and offer a Reload button.
- It must preserve `sessionStorage` failure tolerance. If `sessionStorage` is unavailable, skip auto-reload and surface the recoverable UI.

### 9.2 Nonblank loading states

Because Expo async routes use Suspense around routes, every high-value direct route family must have a nonblank route-loading state:

- root/login/auth;
- public brand/event/trip/experience pages;
- checkout buyer/payment/confirm routes;
- business dashboard/marketing/hub/event/brand pages;
- Stripe Connect pages.

Expo docs say custom `SuspenseFallback` exports do not work with async routes in the current alpha (https://docs.expo.dev/router/web/async-routes/). Therefore the implementor may not rely solely on custom route `SuspenseFallback` exports. The validation must prove what users actually see during throttled chunk loading, and if Expo's alpha fallback is blank for a critical route, the implementation must add a supported wrapper/fallback at a parent layout or mark Option A as no-go.

### 9.3 Offline and stale-deploy behavior

Validation must simulate:

- stale `index.html` pointing to a removed/blocked chunk;
- offline after initial shell loaded;
- flaky chunk request returning 404 or connection failure;
- warm cache after successful load.

Pass condition:

- first failure reloads once;
- second failure within cooldown shows recoverable UI;
- no reload loop;
- no blank page longer than 2 seconds after the error is detected;
- console logs include a diagnostic marker that tester can grep, for example `[chunkReloadGuard]`.

## 10. Measurement Plan

Reuse the ORCH-1083 harness as the before/after standard:

- current source of harness if not yet merged: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/mingla-business/playwright/orch-1083-load-perf.config.ts`
- expected destination after rebase/port: `mingla-business/playwright/orch-1083-load-perf.config.ts`
- spec: `mingla-business/playwright/orch-1083-load-perf.spec.ts`

### 10.1 Before baseline

Before any ORCH-1085 config change:

1. Ensure ORCH-1083 Phase 1 is present or explicitly record that the branch is measuring pre-Phase-1 main.
2. Run local export with `--clear`.
3. Record:
   - all `<script>` tags in root/direct route HTML;
   - initial JS raw bytes;
   - initial JS gzip bytes;
   - initial JS brotli bytes if available;
   - count and raw/gzip sizes of all `/_expo/static/js/web/*` files;
   - module count in eager/entry chunks (`__d(` count where applicable);
   - mobile-profile `/auth/login` first root child median over at least 5 runs;
   - public route `/b/:slug` and `/e/:brand/:event` first root child median over at least 3 runs.

### 10.2 After measurement

After Option A:

- initial eager JS must be materially smaller than the ORCH-1083 Phase 1 result.
- route chunks must exist for route families. Minimum proof:
  - `/auth` or `/auth/index` route chunk;
  - public brand/event/trip chunks;
  - checkout chunks;
  - marketing chunks;
  - business brand/event/trip chunks.
- slow-3G/mobile-profile first root child must improve on `/auth/login` and at least one public buyer route.

Hard numeric success criteria:

- Initial eager raw JS must reduce by at least 30 percent from the ORCH-1083 Phase 1 post-cut baseline of 9,131,533 bytes, or the implementation is not the architecture cure.
- Stretch target: at least 50 percent reduction in eager raw JS.
- `/auth/login` mobile-profile first root child median must improve by at least 25 percent from ORCH-1083 Phase 1's 46,727 ms median, or the implementor must prove the bottleneck moved from JS parse to another named layer.
- Public buyer route mobile-profile first root child median must improve by at least 25 percent on one seeded `/b` or `/e` route.

If Option A creates chunks but misses the byte/time target, do not proceed to static mode automatically. Return NEEDS-STEERING with measured results and a recommendation for Option B/C or rollback.

### 10.3 Measurement commands

```bash
cd mingla-business
rm -rf web-build-orch1085-before web-build-orch1085-after
npx expo export -p web --clear --output-dir web-build-orch1085-before
ORCH_1083_LABEL=before ORCH_1083_ITERS=5 ORCH_1083_PORT=43185 npx playwright test -c playwright/orch-1083-load-perf.config.ts
```

Repeat after changes with `web-build-orch1085-after` or the harness path adjusted to serve the selected output directory. The implementation report must include raw tables, not just percentages.

## 11. Test Matrix

### 11.1 Repo-running tests to add or update

The implementation commit must include automated tests in the same scoped GitHub commit/push as the feature. Required tests:

1. **Config invariant test:** assert resolved Expo config has `asyncRoutes.web:true`, native async routes false/default false, and selected `web.output`. This can be a node script or Jest test.
2. **Bundle split budget test:** after export, assert initial eager raw JS is below the approved ceiling, there are route chunks, and selected route chunk names/manifest entries exist. This should extend or replace ORCH-1083's M-3 script.
3. **Vercel rewrite static test:** parse `mingla-business/vercel.json` and assert:
   - bot rewrites for `/e`, `/t`, `/b` remain before catch-all;
   - `/og/*` rewrites remain;
   - `/stripe-onboarding-return` remains;
   - final fallback remains only in the approved shape for the selected option.
4. **Blur-kill export test:** export output contains `mingla-mobile-web-no-blur` in every served HTML file required by the selected option.
5. **Chunk reload guard test:** unit or browser test that injects a synthetic chunk error and proves one reload attempt max, then recoverable UI/no loop.
6. **Browser direct-route test:** Playwright against exported build for:
   - `/auth`;
   - `/marketing`;
   - `/b/:brandSlug`;
   - `/e/:brandSlug/:eventSlug`;
   - `/t/:brandSlug/:tripSlug`;
   - `/checkout/:eventId`;
   - `/brand/:id`;
   - an unknown path.
7. **Share-preview request test:** request-level test for bot UAs and OG PNG endpoints. Vercel `has` must also be manually tested on preview/prod because Vercel documents local `has` limitations.

### 11.2 Manual gates

Manual tester gates required before PASS:

- iPhone Safari or physical phone browser, cold cache, direct load:
  - `https://business.usemingla.com/auth`
  - one public `/b/:slug`;
  - one public `/e/:brandSlug/:eventSlug`;
  - one checkout route if seeded.
- Chrome mobile throttling smoke:
  - route transition from `/auth` to `/marketing`;
  - route transition from `/marketing` to a campaign subroute;
  - reload while chunk download is throttled.
- Share-preview:
  - paste `/e`, `/b`, and `/t` links into a bot/share-preview-capable tool or curl bot UA and verify metadata HTML;
  - fetch `/og/event`, `/og/brand`, `/og/trip` PNGs.
- Vercel preview:
  - confirm `[deploy]` preview/build gate behavior if this is a web release path;
  - confirm `has` header rewrites on a deployed URL, not only local.

### 11.3 Cross-surface impact

Touched:

- Business Web preview/production: primary.
- Buyer/anonymous Web on the same `mingla-business` host: validation surface because public routes share the bundle and Vercel routing.

Explicitly not in scope:

- Consumer iOS.
- Consumer Android.
- Business iOS runtime behavior, except confirming no config makes native production async routes active.
- Business Android runtime behavior, same.
- Admin Web.
- Supabase/backend.

## 12. Implementation Order

1. Rebase or verify base includes ORCH-1083 Phase 1 and harness. If not, port the harness from the ORCH-1083 branch before measuring.
2. Capture ORCH-1085 before baseline using `--clear` export and ORCH-1083 Playwright harness.
3. Add Expo Router web-only `asyncRoutes` in the resolved app config. Keep `web.output:"single"`.
4. Run export with `--clear`; inspect generated chunks and eager HTML scripts.
5. Add or update automated config/bundle/rewrite/blur/chunk-recovery tests.
6. Validate direct routes and Vercel rewrites locally where possible.
7. Deploy only to a preview through the approved PR/review process if needed for Vercel `has` validation. No production deploy from the worktree.
8. If Option A passes, return implementation report with evidence and route to tester.
9. If Option A fails, stop. Return measured NEEDS-STEERING. Do not switch to static in the same implementation unless Seth pre-approves that path.
10. Only after PR merge to `main`, verified source on `origin/main`, and approved close/deploy sequence, allow Vercel production deploy from merged main. COMMS-0015/0018 apply.

## 13. Rollback Plan

Rollback is config-only for Option A:

- remove Expo Router `asyncRoutes` config;
- keep `web.output:"single"`;
- keep Vercel config unchanged;
- keep ORCH-1083 Phase 1 deferrals and tests;
- rebuild from merged main with `[deploy]` only after rollback PR merges.

Rollback validation:

- export returns to known monolith shape;
- direct dynamic routes still work with SPA fallback;
- bot-UA rewrites still work;
- blur-kill marker still present;
- chunk reload guard does not loop if chunks disappear because fewer dynamic chunks exist.

Option B/C rollback is larger:

- restore `web.output:"single"`;
- restore `/(.*)->/` final fallback;
- restore post-export blur injection to `dist/index.html`;
- remove or revert any static-specific route/HTML rewrite changes;
- rerun full direct-route and bot-UA test matrix.

## 14. Open Questions For Seth

1. **Approve Option A first?**
   - Recommended default: **Yes.** It targets the actual bundle problem while keeping the current SPA/deep-link/Vercel shape.
2. **What byte/time threshold is good enough to ship Option A?**
   - Recommended default: ship only if eager raw JS drops at least 30 percent and mobile-profile first root child improves at least 25 percent. Anything lower returns for steering.
3. **If Option A fails, should ORCH-1085 proceed to static output or stop for a separate static-output spike?**
   - Recommended default: **stop for separate approval.** Static output has known dynamic-route and hydration risk, including historical META-ORCH-0952 failure context.
4. **Should public buyer routes get priority in measurement over authenticated business routes?**
   - Recommended default: **yes, measure both.** Public routes are likely the highest mobile traffic; business routes are Seth's reported business-web pain.
5. **Should the final production deploy be allowed before ORCH-1083 Phase 1 is merged?**
   - Recommended default: **no.** ORCH-1085 should build on merged main containing ORCH-1083 or explicitly include the ORCH-1083 accepted changes in its PR.

## 15. Seth Approval Checklist

Seth should approve ORCH-1085 implementation only if all are true:

- [ ] I approve Option A first: `asyncRoutes:{web:true}` while keeping `web.output:"single"`.
- [ ] I understand Expo labels async routes alpha and require validation before production.
- [ ] I do not approve automatic switch to `web.output:"static"` unless Option A evidence comes back and I approve the higher-risk static plan.
- [ ] I approve the numeric gate: at least 30 percent eager raw JS reduction and at least 25 percent mobile-profile first-render improvement, or return for steering.
- [ ] I require deep links, public buyer routes, bot-UA share previews, OG PNG endpoints, mobile blur-kill, chunk recovery, and SPA fallback to pass before any production deploy.
- [ ] I require deploy/OTA only from merged `main`, never from this ORCH worktree.

## 16. Recommended Implementor Handoff After Seth Approval

Codex `implementor-mingla`, implement ORCH-1085 [business web code-splitting] from `Mingla_Artifacts/specs/SPEC_ORCH-1085_BUSINESS_WEB_CODE_SPLITTING.md` in working tree `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1085-[business-web-code-splitting]/` on branch `ORCH-1085-business-web-code-splitting`. Implement Option A only unless Seth explicitly approves static output: add Expo Router web-only `asyncRoutes`, keep `web.output:"single"`, preserve Vercel bot-UA rewrites/OG endpoints/`/(.*)->/` fallback/mobile blur-kill/chunk recovery, reuse or port the ORCH-1083 Playwright harness, and ship repo-running regression tests in the same scoped commit. Hard guards: no deploy, no OTA, no merge, no reap; later release only from merged `main` per COMMS-0015/0018. Expected output is `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1085_BUSINESS_WEB_CODE_SPLITTING.md` plus code/tests; downstream routing is tester QA after implementation evidence returns.

## 17. Completion Self-Check

- Proven current state and ORCH-1083 dependency included: yes.
- Options matrix included: yes.
- Route/deep-link contract included: yes.
- Vercel contract included, with bot-UA rewrites and catch-all: yes.
- Build/export/post-export contract included, with mobile blur CSS: yes.
- Runtime chunk failure handling included: yes.
- Measurement plan based on ORCH-1083 harness included: yes.
- Test matrix with automated and manual gates included: yes.
- Rollback and deploy-source rule included: yes.
- Open questions and recommended defaults included: yes.
- External official docs cited inline: yes.
- Hard stop before implementation: yes.
