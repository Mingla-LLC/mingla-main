# INVESTIGATE — ORCH-1125: cold deep-link to a public trip crashes "No QueryClient set"

**Phase:** INVESTIGATE (forensics). No fix proposed; root cause proven with evidence.
**Date:** 2026-06-12
**Dispatched scope (as written):** buyer/anon **Web** (`mingla-business` `/t/{brandSlug}/{tripSlug}`); confirm `/e/` `/exp/` + native.
**Corrected scope (evidence-driven):** the defect is in the **consumer NATIVE app (`app-mobile`)**, NOT mingla-business web. The dispatch mis-attributed the surface; the ORCH-1117 TEST report (Discovery #3) that originated this ORCH explicitly names `app-mobile`.

---

## 1. Symptom summary (expected vs actual)

| | Expected | Actual |
|---|---|---|
| **Cold deep-link to a public trip** (`com.mingla.app.v2://t/{brand}/{trip}`) opened directly in the **consumer native app** (fresh process, NOT in-app navigation) | Trip detail screen renders (anon-tolerant fetch by slug) | App throws **"No QueryClient set, use QueryClientProvider to set one"** and hits the error boundary. First-touch buyers arriving from a shared trip link see a crash. |
| In-app navigation (deck → trip sheet, or Home → trip) | Works | Works — the provider is already mounted because `/` (Home) rendered first. |

This is the exact anon trip-share → checkout funnel that ORCH-1114 (share button) + ORCH-1115 (anon web funnel) just restored — but the break is on the **native** consumer side, not web.

---

## 2. ROOT CAUSE (CONFIRMED — source proven; runtime proven by the originating tester)

**The React Query provider is mounted on the `/` (Home) ROUTE, not at the root layout — so every OTHER cold-routed deep-link renders OUTSIDE the provider.**

- `app-mobile/app/_layout.tsx` is the expo-router root layout. It wraps the app in `GestureHandlerRootView` → `StripeNativeProvider` → `<Stack/>`. **It contains NO `QueryClientProvider` anywhere** (verbatim file read, 124 lines; grep for `QueryClient` in `app-mobile/app/` returns ONLY `index.tsx`).
- `app-mobile/app/index.tsx` is the `/` route (`export default Sentry.wrap(App)`, line 2750). Its `App()` mounts `<PersistQueryClientProvider client={queryClient}>` (line 2725) wrapping `<AppContent/>`. **The provider is route-scoped to Home** — it is a SIBLING route of `/t/…`, never an ancestor.
- On a **cold launch to `/`**: `_layout` → `<Stack/>` → `index` route → `PersistQueryClientProvider` mounts → all children get a client. Works.
- On a **cold deep-link to `/t/[brandSlug]/[tripSlug]`**: `_layout` → `<Stack/>` → the `t/…` route renders directly; `index.tsx` never mounts → **no ancestor provider** → the route's first `useQuery` throws "No QueryClient set."

### Causal chain (every link read verbatim)

1. `app-mobile/app/t/[brandSlug]/[tripSlug].tsx` (route, 41 lines) renders `<ConsumerTripDetailScreen brandSlug tripSlug seed={null} … />`. Its own header comment states the cold-open path: *"no seed → ConsumerTripDetailScreen's useConsumerTripDetail fetches the trip by slug."*
2. `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx:201` calls `useConsumerTripDetail(...)`.
3. `app-mobile/src/hooks/useConsumerTripDetail.ts:16` imports `useQuery` from `@tanstack/react-query`; line 302 `const query = useQuery<ConsumerTripDetail, Error>({...})`.
4. `useQuery` reads the QueryClient off React context. No ancestor `QueryClientProvider` exists on the `/t/` cold-route tree → it throws.

**The dispatch's LEAD is CONFIRMED for `app-mobile`** ("provider mounted in `index.tsx` not root `_layout.tsx`") — and was REFUTED for `mingla-business` (see §4). The lead came verbatim from the ORCH-1117 tester's Discovery #3, which correctly named `app-mobile`.

### Six-field evidence

1. **Symptom:** "No QueryClient set, use QueryClientProvider to set one" RedBox/error-boundary on cold deep-link to a native trip route.
2. **Layer:** Code (provider placement) → Runtime (throw on mount).
3. **Probe:** `grep -rn 'QueryClientProvider\|PersistQueryClientProvider' app-mobile/app --include='*.tsx'`; verbatim read of `app-mobile/app/_layout.tsx`, `app/index.tsx` (2693–2745), `app/t/[brandSlug]/[tripSlug].tsx`, `src/screens/Trip/ConsumerTripDetailScreen.tsx`, `src/hooks/useConsumerTripDetail.ts`.
4. **Evidence:**
   - `app/_layout.tsx` — `return (<GestureHandlerRootView>…<StripeNativeProvider>…<Stack screenOptions={{headerShown:false}}/>…)`. No QueryClientProvider present (full file read).
   - `app/index.tsx:2725` — `<PersistQueryClientProvider client={queryClient} persistOptions={…}><AppContent/></PersistQueryClientProvider>`, INSIDE `function App()` (line 2697) which is the default-exported `/` route.
   - `app/t/[brandSlug]/[tripSlug].tsx:28` — renders `<ConsumerTripDetailScreen … seed={null} …/>`.
   - `src/hooks/useConsumerTripDetail.ts:302` — `useQuery<ConsumerTripDetail, Error>({ … })`.
5. **Mechanism:** Provider is a child of the `/` route, not the root layout → a cold deep-link that routes straight to a sibling route (`/t/`, `/b/`, `/brand/`) renders the route's `useQuery` with no QueryClient in context → throw.
6. **Severity:** **CONFIRMED ROOT CAUSE.**

**Confidence:** `probable→confirmed`. Source chain is airtight and deterministic. The **runtime repro was already captured by the ORCH-1117 tester** (TEST_ORCH-1117 Discovery #3 + screenshot `native_trip_detail_04.png`, cited: cold-opening `com.mingla.app.v2://t/{brand}/{trip}` throws "No QueryClient set"). My own sim attempt was blocked by a known environment limitation (§5) — that caps MY independent runtime layer at `probable`, but the originating tester's device evidence + the deterministic source make the overall verdict **confirmed**.

---

## 3. BLAST RADIUS — native (`app-mobile`)

`app-mobile` has exactly **three** top-level deep-linkable routes that are SIBLINGS of `/` (i.e. render outside the Home-scoped provider on a cold route). **All three crash the same way** because each renders a screen whose data hook calls `useQuery`:

| Route file | Renders | Data hook | `useQuery`? | Cold deep-link verdict |
|---|---|---|---|---|
| `app/t/[brandSlug]/[tripSlug].tsx` | `ConsumerTripDetailScreen` | `useConsumerTripDetail` (`useConsumerTripDetail.ts:302`) | YES | **CRASHES** (the reported symptom) |
| `app/b/[slug].tsx` | `ConsumerBrandProfileScreen` | `useBrandBySlug` (`useBrandBySlug.ts:405`) | YES | **CRASHES** (same defect; not yet reported) |
| `app/brand/[slug].tsx` | `ConsumerBrandProfileScreen` | `useBrandBySlug` (`useBrandBySlug.ts:405`) | YES | **CRASHES** (alias of `/b/`) |

**The blast radius is WIDER than the reported trip symptom: every native public deep-link route (`/t/`, `/b/`, `/brand/`) crashes on cold open.** Any deep-link to a brand profile from a share link is equally broken. (`app-mobile` has NO standalone `/e/` or `/exp/` routes — events/experiences surface inside the deck/sheet, which mounts under `/` and thus inside the provider; they are not cold-deep-link routes.)

---

## 4. CROSS-SURFACE — `mingla-business` web is NOT affected (REFUTED + runtime-proven clean)

The dispatch's primary scope (`mingla-business` web `/t/`) does **NOT** have this defect. `mingla-business` is structured CORRECTLY — the provider IS at the root layout.

- `mingla-business/app/_layout.tsx:666` — `<QueryClientProvider client={queryClient}>` wraps `<AuthProvider>` → `<KeyboardRoot>` → `<RootLayoutInner/>`, and `RootLayoutInner` renders `<Stack/>` (line 620). So **every** route — cold or warm — is wrapped. (Lines 646–680 read verbatim.)
- `mingla-business/index.js` is a 28-byte stub `import "expo-router/entry";` — there is no `mingla-business/index.tsx` provider; the dispatch lead's "provider in `index.tsx`" does not apply to web.

**Runtime proof (production, genuine cold load):** drove headless Chrome (`playwright-core` + system Chrome) with a FRESH browser context (no prior in-app nav) against `https://business.usemingla.com` for all three public route types. `web.output:"single"` (SPA, no SSR pre-render — confirmed in `app.json:88`).

| Cold-loaded prod URL | pageErrors | "No QueryClient" / boundary console | Rendered? |
|---|---|---|---|
| `/t/travelbrand/the-dc-adventure` (trip) | NONE | NONE | YES — full trip detail + tiers + refund ladder |
| `/e/paystack-ng-test-1076/paystack-ng-test-event-1076` (event) | NONE | NONE | YES — event page ("Booking unavailable…") |
| `/exp/lanternvine/raleigh-wine-and-dine-crawl` (experience) | NONE | NONE | YES — experience detail |

All three web routes cold-load clean. **Web is RULED OUT.** Verified the current `_layout.tsx` provider placement is the same on every active worktree (`grep -c QueryClientProvider` = 4 refs on all) — no in-flight branch regresses it.

---

## 5. Repro evidence (native sim) — environment-blocked, named blocker

- Booted iPhone 17 Pro sim (`17091E60-…`) has `com.mingla.app.v2` installed as an **expo-dev-client** build (loads JS from Metro).
- Started an `app-mobile` Metro on port 8088 (the running 8081 Metro serves `mingla-business`, left untouched for the parallel session).
- **Blocker:** a dev-client build intercepts ALL `com.mingla.app.v2://…` URLs to its **launcher** (the "Development Servers" picker — screenshot `/tmp/sim_raw_scheme.png`) and the `expo-development-client/?url=…` form always boots `/` first. Neither path can cold-route expo-router directly to `/t/` — so the dev-client environment CANNOT reproduce a true cold-route-to-`/t/`. A genuine cold-route repro requires a **release/standalone build** (TestFlight/production), where the scheme passes the deep path to expo-router as `initialURL`.
- This is exactly the build the ORCH-1117 tester used when they captured the "No QueryClient" RedBox (`native_trip_detail_04.png`). Their device evidence + the deterministic source chain stand as the runtime proof; my independent sim attempt is honestly capped at `probable` by this named blocker, not failed.

---

## 6. Five-Truth-Layer reconciliation

| Layer | Finding |
|---|---|
| **Docs** | `app/t/[…].tsx` header asserts the cold-open path works ("no seed → useConsumerTripDetail fetches by slug"). The doc assumes a QueryClient is present — it isn't on a cold route. **Doc ⟂ Code contradiction.** |
| **Schema** | N/A — pure client provider-tree wiring; no DB/RLS involvement. |
| **Code** | Provider mounted on the `/` route (`index.tsx:2725`), not the root layout (`_layout.tsx`). `/t/`, `/b/`, `/brand/` are sibling routes that call `useQuery` outside it. **This IS the bug.** |
| **Runtime** | Cold-route to `/t/` → `useQuery` throws "No QueryClient set" → error boundary. (Tester device-proven; my sim blocked by dev-client launcher interception.) Warm (in-app) works because `/` mounted the provider first. |
| **Data** | N/A. |

**Contradiction that IS the bug:** the code places the provider at route scope while the docs/UX contract assume app-global scope. The root layout (which wraps every route) is the only correct provider home.

---

## 7. Invariant impact

- `mingla-business` already encodes the correct pattern — `app/_layout.tsx:649–654` carries an ORCH-0964 comment: *"top-level ErrorBoundary ABOVE the provider tree… a throw in QueryClientProvider… previously escaped… blanked the whole app white."* The web side learned to put the provider at root; **`app-mobile` never did.** No registered invariant currently forbids route-scoped providers in `app-mobile` — a candidate NEW invariant (e.g. `I-PROPOSED-RQ-PROVIDER-AT-ROOT-LAYOUT`: the React Query provider MUST be mounted in the root `_layout.tsx` so every cold-routed deep-link is wrapped) is flagged here for the SPEC to formalize. (Flagged only — not pre-decided.)
- The provider in `index.tsx` is `PersistQueryClientProvider` and carries a non-trivial pre-mount gate (Android 2MB CursorWindow cache-size guard + `cacheReady` state + `AnimatedSplashScreen` interplay, `index.tsx:2697–2745`). Hoisting the provider to root must preserve that persistence gate + splash sequencing — this is the real constraint for SPEC, NOT a bare `<QueryClientProvider>` swap.

---

## 8. Minimal correct fix shape (direction only — NOT a spec, NOT code)

Hoist the React Query provider from the `/` route to the **root layout** so every route (cold deep-link or warm) is wrapped:

- Move the `PersistQueryClientProvider` (with its `cacheReady` size-guard gate and `persistOptions`/`shouldDehydrateQuery` config) OUT of `app-mobile/app/index.tsx`'s `App()` and INTO `app-mobile/app/_layout.tsx`, wrapping `<Stack/>` (above or around `StripeNativeProvider`, matching the `mingla-business` root-layout ordering).
- Preserve: the Android cache-size pre-clear gate, the `AnimatedSplashScreen`/`splashDone` sequencing, and the existing `queryClient`/persister singletons. The Home route then consumes the ambient provider instead of owning it.
- This single hoist fixes all three native deep-link routes (`/t/`, `/b/`, `/brand/`) at once. No web change (web is already correct).

SPEC owns the exact placement, the splash/persistence-gate reconciliation, and the fails-on-revert regression test (e.g. a structural test asserting `QueryClientProvider` lives in `_layout.tsx` and a cold-route render test for `/t/` that throws when the provider is reverted to `index.tsx`).

---

## 9. Discoveries for orchestrator

- **D-1 (scope correction):** ORCH-1125 as dispatched targets `mingla-business` web; the real defect is `app-mobile` native. SPEC/IMPLEMENT must retarget to `app-mobile`. Web `/t/` `/e/` `/exp/` are clean (runtime-proven on prod).
- **D-2 (blast radius wider than reported):** `/b/[slug]` and `/brand/[slug]` native deep-links crash identically — any brand-profile share link is broken on cold open, not just trips. The fix covers all three for free; the success criteria should test all three.
- **D-3 (native build needed to verify):** a true cold-route repro/verification requires a release/standalone `app-mobile` build (dev-client intercepts the scheme to its launcher). TEST phase should plan a standalone/TestFlight build or a structural+unit gate, since the sim dev-client cannot drive a raw cold deep-link.

---

## 10. Confidence & recommended next phase

- **Confidence:** **CONFIRMED root cause** (deterministic source chain across route → screen → hook → `useQuery`, provider proven route-scoped to `/`; runtime captured by the originating ORCH-1117 tester on a build that cold-routes). My independent sim repro was environment-blocked (dev-client launcher interception) — a named, honest blocker that caps only my own runtime re-proof at `probable`, not the overall verdict.
- **Recommended next phase:** **SPEC** — scope = hoist the `PersistQueryClientProvider` (with its cache-size gate + splash sequencing intact) from `app-mobile/app/index.tsx` to `app-mobile/app/_layout.tsx`; cover `/t/`, `/b/`, `/brand/`; web untouched; add a fails-on-revert structural + cold-route regression test; verify on a standalone native build.
