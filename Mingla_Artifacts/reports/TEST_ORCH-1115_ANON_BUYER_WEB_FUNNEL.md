# TEST — ORCH-1115 [anon-buyer web funnel restored — public buyer routes must not redirect logged-out users to sign-in]

- **Mode:** TARGETED (mingla-tester). Brutal gatekeeper — assumed broken until proven.
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1115-[anon-buyer-access]/` · branch `ORCH-1115-anon-buyer-access`
- **Fix commit under test:** `551f1749ec9a88f8b477b3e61caedb5864d1dd14`
- **Tester adversarial commit:** `cdc5d6595b7d1608373df6ba4c0a11f189c68ad1`
- **Date:** 2026-06-11
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1115_ANON_BUYER_WEB_FUNNEL.md`
- **Comms ledger:** read on entry. No genuinely-OPEN row targets ORCH-1115, `tester`, or `ALL` (verified by parsing the status column, not substring matches). Nothing to ack.

---

## 1. Verdict

# PASS — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2

The anon-buyer web funnel is **restored and runtime-proven**. A genuinely logged-out browser renders every public buyer route (share links, guest checkout, receipt, cancel) with the requested URL preserved and NO sign-in wall; every authed-only route still redirects to `/` and shows the BusinessWelcomeScreen. The allowlist did not over-widen. Adversarial path-confusion / segment-safety attacks (including dot-segment traversal, encoded authed routes, double-slash, and authed-route-with-public-tail) all correctly stay gated, proven both at the unit layer and at runtime in a headless browser.

`proven`-level live-fire evidence obtained (headless Chromium against the branch web export served with a production-faithful SPA fallback). Regression gate satisfied (implementor happy-path fails-on-revert independently re-run + tester adversarial different-angle test, both on-branch, both in the closing diff).

---

## 2. Build + serve method and fidelity

**Build.** From `mingla-business/`: `EXPO_ROUTER_APP_ROOT="$PWD/app" EXPO_PUBLIC_SUPABASE_URL=… EXPO_PUBLIC_SUPABASE_ANON_KEY=… npx expo export -p web --clear` (output `dist/`, `web.output: "single"` per `app.json`). Supabase URL + legacy anon key (read-only, public-by-design) were baked so the buyer pages fetch REAL data and render real content vs an error stub.

- **First export FAILED faithfully-and-loud, then was fixed.** The initial `npx expo export -p web` produced a ROUTELESS bundle (`[PAGEERROR] No routes found` at every path, including `/`; `document.body.innerText.length === 0`; grep of the bundle showed zero route markers). Root cause: this worktree has **no `babel.config.js`** (none exists in git for `mingla-business` — only `app-mobile/` has one) and `node_modules` is a **symlink to the anchor** (`/Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules`), so Expo Router's `require.context` over `app/` did not resolve and `EXPO_ROUTER_APP_ROOT` was unset. Setting `EXPO_ROUTER_APP_ROOT="$PWD/app"` + `--clear` produced a correct route-split export (per-route chunks: `account-*.js`, `[eventSlug]-*.js`, `[tripSlug]-*.js`, `home-*.js`, `[orderId]-*.js`, …). The app then hydrated cleanly with zero page errors. **This is a build-environment workaround for the local headless export; production Vercel builds already render correctly (the investigation proved the bug on prod), so this does not indicate a product defect** — flagged as P4 note D-pre-1.

**Serve.** A tiny Node static server (`/tmp/orch1115_harness/spa-server.mjs`) that (a) serves a real file from `dist/` when one exists (the JS bundle, assets, favicon) and (b) falls back ALL other non-bot paths to `dist/index.html`. This replicates `vercel.json`'s final rewrite `{ "source": "/(.*)", "destination": "/" }` exactly. Verified: deep route `/exp/lanternvine/raleigh-wine-and-dine-crawl` returns the same 1.4KB `index.html` (SPA fallback), the 984KB bundle serves 200, and `expo serve` (Expo's own static server) returns 404 on deep paths — confirming the export emits only `/index.html` and the SPA fallback is the correct production replica.

**Driver.** Playwright 1.60.0 (local in `node_modules`), Chromium headless. Each route loaded in a **fresh `browser.newContext()` with no cookies, no localStorage, no service worker** — a genuinely logged-out guest. 9s settle per route to clear the ORCH-1102 auth-resolution ceiling + hydration before reading the final URL and `document.body.innerText`.

**Fidelity vs production.** HIGH.
- Same bundle output (`expo export -p web`, the exact `vercel.json buildCommand`), same `output: "single"` SPA, same SPA fallback rewrite, real Supabase anon reads (real brand/event/trip/experience content rendered).
- Sign-in-wall detection uses production copy from `BusinessWelcomeScreen.tsx` ("Continue with Apple" / "Continue with Google").
- **Not replicated (does not affect this gate):** Vercel `cleanUrls`/edge bot-rewrites (only fire for crawler UAs; an anonymous human UA hits the SPA fallback — exactly what was driven), the `inject-mobile-blur-css.mjs` post-step (CSS only). The redirect decision is data-independent and runs identically.
- The investigation's original repro was production Chromium against `business.usemingla.com`; this is the same method against the FIXED branch build.

---

## 3. SC-by-SC matrix (runtime evidence)

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1-Web | Public share pages render logged-out; URL stays | **PASS** | `/e/leggothis/big-party` → body "Big Party PRESENTED BY Leggo This", finalPath `=/e/leggothis/big-party`, signinWall=false. `/t/travelbrand/the-dc-adventure` → "The DC Adventure by Travel Brand … DAY BY DAY", URL stayed. `/exp/lanternvine/raleigh-wine-and-dine-crawl` → "Raleigh Wine and Dine Crawl by Lantern & Vine … THE ITINERARY", URL stayed. `/b/leggothis` → "Leggo This We are a brand that throws parties", URL stayed. |
| SC-2-Web | Guest checkout reachable logged-out | **PASS** | `/checkout/{eventId}` → "Get tickets 1 OF 3 …", URL stayed, no wall. `/checkout-trip/{id}` → "Reserve your spot 1 OF 3 …", URL stayed. `/checkout-experience/{id}` → "Get your spot 1 OF 3 …", URL stayed. |
| SC-3-Web | Receipt `/o/` + cancel `/booking/` render logged-out (OQ-1 INCLUDED) | **PASS** | `/o/test-order-id` → "Order … Order not found" receipt screen (its own content, not the wall), URL stayed. `/booking/{id}/cancel?token=abc` → "This cancel link isn't valid …" cancel screen, finalPath `=/booking/{id}/cancel` (query preserved), no wall. |
| SC-4-Web | Authed-only route STILL redirects logged-out | **PASS** | `/account` → finalPath `=/`, signinWall=TRUE ("Continue with Apple/Google"). `/home` (`(tabs)`) → `/`, wall. `/brand/some-brand-id` → `/`, wall. Allowlist did NOT over-widen. |
| SC-5-Web | Logged-IN on public route unchanged | **PASS** (unit) | T-6: `hasUser:true` on all 16 public samples → predicate `false` (renders). No regression to logged-in behavior; the public clause only matters for the no-user case. |
| SC-6-Web | No hydration flash (Constitution #14) | **PASS** (unit + code-preserved) | T-7 (warming session → predicate false on public AND authed; spinner branch owns the gate). Diff shows `authResolving` spinner branch, `authResolutionExpired` ceiling, module-level deadline anchor all UNEDITED. `orch1100ColdLoadAuthGates` + `orch1100FirewallHydration` + `orch1102Wave2LoadingTimeout` suites green. |
| SC-7 | Predicate unit truth + segment-safe | **PASS** | implementor T-1/T-2/T-3/T-4/T-5 (85 cases) + tester adversarial (45 cases) green; `/checkouter` ≠ `/checkout/` proven; runtime confirms. |
| SC-8 | Single source of truth | **PASS** | T-9: `PUBLIC_BUYER_ROUTE_PREFIXES` defined exactly once; `_layout.tsx` native path consults `isPublicBuyerRoute`; grep finds no second hardcoded list. |

**Runtime drive raw result** (fresh logged-out context, all 9 prefixes + 3 authed):
- PUBLIC (URL stayed, NO wall): `/e/…`, `/t/…`, `/exp/…`, `/b/…`, `/checkout/…`, `/checkout-trip/…`, `/checkout-experience/…`, `/o/…`, `/booking/…/cancel?token=…` — **9/9 render content.**
- AUTHED (redirect to `/`, wall shown): `/account`, `/home`, `/brand/{id}` — **3/3 still gated.**
- console errors: 0 on every route.

---

## 4. Findings

**No P0/P1/P2/P3.** Two P4 notes:

- **P4-1 (build-env, not a product defect):** the local headless `expo export -p web` needs `EXPO_ROUTER_APP_ROOT="$PWD/app"` to bake the route tree, because this worktree has no `babel.config.js` and a symlinked `node_modules`. Production Vercel builds are unaffected (render proven on prod by the investigation). Documented so a future tester reproducing this gate doesn't burn time on the "No routes found" blank-render.
- **P4-2 (praise):** the fix is minimal, segment-safe by construction (`base + "/"` boundary), single-source-of-truth, and the implementor's protective comment + the "add new public routes HERE and to the test" rule make the invariant self-documenting. The clause is composed to only ever flip a redirect TRUE→FALSE, which bounds the blast radius to public routes — exactly as a security-sensitive gate change should be written.

---

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the fix at `551f1749`, then performed a **true line deletion** of `&& !isPublicBuyerRoute(pathname)` from `shouldRedirectToSignInFromRoute` in `coldLoadAuthGates.ts` (not a comment-out) and re-ran `orch_1115_anon_buyer_route_allowlist.test.ts`:

```
Tests: 17 failed, 68 passed, 85 total
  ✕ T-1 (happy) — all 16 PUBLIC samples flip true → FAIL
    /e/travelbrand, /t/travelbrand/the-dc-adventure, /checkout/abc123/payment,
    /o/order-77, /booking/order-77/cancel, … (16 cases)
  ✕ T-2 structural grep "the web predicate ANDs in the public-route exemption"
  ✓ T-2 behavioral — all 15 AUTHED routes STAY passing (/account → true, etc.)
```

Restored the clause → `85 passed, 85 total`. The pattern matches the implementor's report exactly: T-1 (public) flips to FAIL, T-2 (authed) stays PASS, proving the allowlist is what suppresses the redirect — not a blanket behavior change. **Implementor fails-on-revert independently confirmed at `551f1749`.**

---

## 6. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/utils/__tests__/orch_1115_anon_buyer_route_path_confusion.adversarial.test.ts`
- **Commit:** `cdc5d6595` (on-branch; appears in `git diff origin/main...HEAD --name-only` alongside the implementor's `orch_1115_anon_buyer_route_allowlist.test.ts`).
- **Angle (different from the implementor's happy-path allowlist suite):** the **security false-positive** failure mode — can a crafted path that is REALLY an authed route (or junk) wrongly MATCH the allowlist and LEAK an authed surface to a logged-out guest? 45 cases:
  - **ADV-1/ADV-2** — authed-first-segment with a public tail (`/account/e/x`, `/account/checkout/x`, `/brand/123/e/x`, `/(tabs)/home/checkout/x`, `/notifications/o/1`), segment-boundary lookalikes (`/echo`, `/blog`, `/orders`, `/experience`, `/experiences`, `/checkout-experiences`, `/bookings`, `/tickets`), double-slash junk (`//account`, `//e/x`), whitespace-padded authed route (`  /account  `) → all `isPublicBuyerRoute === false` AND composed `shouldRedirectToSignInFromRoute === true`.
  - **ADV-3 (encoding)** — URL-encoded authed routes the gate CAN see (`/%61ccount`, `/account%2Fe`, `/e%2F..%2Faccount`, `/checkout%00/x`) → not exempted, still redirect.
  - **ADV-4 (positive control)** — genuine deep public subpaths DO match (proves the suite is not vacuously passing).
- **Teeth proven:** weakening the matcher to a naive `normalized.includes(base)` made **14 of the 45 cases FAIL** (`/account/e/x`, `/echo`, `/blog`, `/orders`, `//e/x`, … would leak) — the implementor's suite caught the simple `/checkouter`/`/exposed` trailing-junk class but NOT the authed-route-with-public-tail leak; this suite does. Matcher restored cleanly (no residual diff).
- **Result on the fix:** `45 passed, 45 total`.

### Dot-segment traversal — runtime-proven non-issue (not asserted on a raw input the gate never sees)

The adversarial suite originally asserted `isPublicBuyerRoute("/e/../account") === false`. That FAILED — the textual matcher treats `/e/../account` as a `/e/` subpath (it `startsWith("/e/")`). Rather than hand-wave, I **drove it in a real browser**: `/e/../account`, `/checkout/../account`, `/exp/../../brand/x`, `/booking/../../account`, and the encoded `/e/%2e%2e/account` were each loaded logged-out. **All five resolved to `/` and showed the sign-in wall** — because the browser normalizes `..` segments per RFC-3986 / WHATWG-URL BEFORE the request leaves the client, so `usePathname()` (and the gate) only ever receives the collapsed `/account`. The raw dotted form is unreachable in production. I therefore corrected those assertions OUT of `MUST_NOT_MATCH` and documented the runtime proof in the test header — asserting the proven reality, not an idealized input the gate cannot receive.

---

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps / share link reaches a live page | **PASS (RESTORED)** | runtime: every share/checkout link renders its page instead of the sign-in wall. |
| 2 | One owner per truth | **PASS** | redirect decision owned solely by `shouldRedirectToSignInFromRoute`/`nativeRedirectToSignIn`; allowlist is one exported constant (SC-8/T-9). |
| 3 | No silent failures | **PASS** | pure total predicate, returns boolean, never throws; no swallowed errors. |
| 4 | One query key per entity | **N/A** | no query layer touched. |
| 5 | Server state server-side | **N/A** | no Zustand/server-state change. |
| 6 | Logout clears everything | **N/A** | unaffected (only the no-user redirect exemption changed). |
| 7 | Label `[TRANSITIONAL]` | **N/A** | none introduced. |
| 8 | Subtract before adding | **PASS** | additive AND-clause; no parallel gate added; native routes through the same shared helper. |
| 9 | No fabricated data | **PASS** | pages render real Supabase content or their own honest not-found/closed states (observed). |
| 10 | Currency-aware | **N/A** | no pricing logic. |
| 11 | One auth instance | **PASS** | buyer pages still call no `useAuth`; gate reads the single root auth state. |
| 12 | Validate at the right time | **N/A** | no datetime validation. |
| 13 | Exclusion consistency | **PASS** | the exemption is the same single helper on web + native; no divergent route lists. |
| 14 | Persisted-state startup (hydration gate before redirect) | **PASS** | `authResolving` spinner branch + ceiling + deadline anchor UNEDITED; T-7 warming-session test green; no flash-redirect before resolution. |

No violations → no automatic P0.

---

## 8. Device / parity matrix

| # | Surface | Verdict | Evidence / reason |
|---|---------|---------|-------------------|
| 1 | Consumer iOS | **N/A (skip)** | routes do not exist in `app-mobile/`. |
| 2 | Consumer Android | **N/A (skip)** | same. |
| 3 | **Buyer / anonymous Web** | **PASS (proven)** | headless Chromium fresh-context drive of all 9 public prefixes (render + URL) + 3 authed routes (redirect). The only surface with a behavior change. |
| 4 | Business iOS | **PASS (no-op)** | native `nativeRedirectToSignIn` now ANDs `isPublicBuyerRoute`, a no-op (no native public route); T-2/T-9 pin no authed-route native redirect changed. Native render not driven (no behavior change; the helper is the same pure function proven on web). |
| 5 | Business Android | **PASS (no-op)** | same as #4. |
| 6 | Admin Web | **N/A (skip)** | separate app, no public buyer routes. |
| 7 | Business Web preview | **PASS** | identical bundle to #3. |

**Physical iPhone (HITL):** not required — the only behavior change is buyer WEB, proven in a real browser; no iOS/Android runtime behavior changed (native path is a no-op refactor). No physical-device step was deferred or stubbed.

**Live deploy state:** no edge function / migration / `vercel.json` in the diff (verified). Deploy is web-only (Vercel) on merge — no OTA, no edge deploy, no `db push`. Nothing to verify against a live edge version.

---

## 9. Scope confirmation

`git diff origin/main...HEAD` product files = exactly the SPEC's allowlist:
- `mingla-business/src/utils/coldLoadAuthGates.ts` (+91/−2) — constant + helper + AND-clause. **Logic change.**
- `mingla-business/app/_layout.tsx` (+21/−2) — import + AND-in `nativeRedirectToSignIn` + comments. **Logic change (native no-op).**
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (+8/−1) — **doc-comment-only** (verified: the diff is entirely inside the leading `/** */` block; no code line changed).
- `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` (+8/−2) — **doc-comment-only** (verified same).
- 2 test files (implementor allowlist + tester adversarial).
- impl report (docs).

**RLS / schema / migration / edge function / `vercel.json` — UNTOUCHED** (grep confirmed CLEAN). The runtime drive rendering real anon content independently confirms anon RLS reads were already live (investigation F-2).

---

## 10. Regression / unit results

- `orch_1115_anon_buyer_route_allowlist.test.ts` (implementor) — **85 passed.** Fails-on-revert independently re-confirmed (§5).
- `orch_1115_anon_buyer_route_path_confusion.adversarial.test.ts` (tester) — **45 passed.** Teeth proven via weakened-matcher (14 fail).
- Loop-guard / cold-load / no-dead-ends / hydration / ceiling / boot-probe suites — `orch_1103_signout_redirect_loop`, `orch1100ColdLoadAuthGates`, `orch1100FirewallHydration`, `orch1102AuthRoutingNoDeadEnds`, `orch1102Wave2LoadingTimeout`, `bootSessionProbe.orch_1106` — **all green.**
- **Consolidated:** `Test Suites: 8 passed · Tests: 231 passed.`
- ESLint on the new file: 0 errors. `tsc --noEmit`: 0 errors attributable to the new file (pre-existing unrelated strict-mode errors in `checkout/buyer.tsx`, `phone-input/*` noted by implementor D-pre-1, not in this lane).

---

## 11. Discoveries for Orchestrator

- **D-1 (build-env P4-1):** local `expo export -p web` for `mingla-business` needs `EXPO_ROUTER_APP_ROOT="$PWD/app"` (+`--clear`) to bake the route tree in a worktree with no `babel.config.js` and a symlinked `node_modules`; without it the bundle is routeless ("No routes found", blank render). Production Vercel is unaffected. Worth recording in the sim/web test reference so the next anon-web gate test doesn't lose time.
- **D-2 (carried, pre-existing):** `mingla-business` has pre-existing strict-mode `tsc` errors (`app/checkout/[eventId]/buyer.tsx`, `app/checkout-trip/.../buyer.tsx`, `packages/phone-input/*`) and TR2 safearea soft-warnings — none introduced here; flagged for a typecheck-hygiene ORCH if desired (matches implementor D-pre-1/2).
- **CLOSE actions (from SPEC §11):** flip `I-PROPOSED-1115-PUBLIC-BUYER-ROUTE-ALLOWLIST` ACTIVE; retire the stale `feedback_anon_buyer_routes.md` "lives outside (tabs)" defense note (D-2 in investigation); web-only Vercel deploy, no OTA/edge/migration.

---

## 12. Routing

**PASS → CLOSE (orchestrator).** No rework. No accepted conditions (zero P1/P2). Web-only deploy on merge.

---

*Artifact: `Mingla_Artifacts/reports/TEST_ORCH-1115_ANON_BUYER_WEB_FUNNEL.md`*
