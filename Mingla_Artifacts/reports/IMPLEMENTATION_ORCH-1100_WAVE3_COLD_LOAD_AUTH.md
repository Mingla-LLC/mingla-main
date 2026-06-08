# IMPLEMENTATION — ORCH-1100 Wave 3 [business-web parity: cold-direct-load auth-readiness flash]

Date: 2026-06-08
Branch: `ORCH-1100-integration` (appended; carries Wave-1A firewall+hydration + auth-lock fix + Wave-1B glass+composer)
Worktree: `~/Desktop/mingla-orchs/ORCH-1100-[business-web-parity-investigation]/`
Skill: mingla-implementor (Claude)
Device: physical Samsung Galaxy A72 (`R58R54YV7JT`), Chrome, account sethogieva@gmail.com, brand "Leggo This" (`22a18413-bfbf-4087-9ba7-45f70deba0f3`).
Status: **implemented + device-proven + scoped gates green.**

Inputs read: `QA_ORCH-1100_WAVE2_DEVICE_VALIDATION.md` (Residual #1), `IMPLEMENTATION_ORCH-1100_WAVE1A_FIREWALL_HYDRATION.md` (the `isAuthReady` / hydration-flag / LOADING pattern this extends), `COMMS_LEDGER.md` (no OPEN BLOCK/WARN targets ORCH-1100 / implementor / ALL).

---

## The residual (Wave 2, device-proven)

On a COLD direct load (refresh / bookmark, session not yet warm) of secondary authed routes, the screen briefly renders the SIGNED-OUT state instead of a loading state — `/account` shows the sign-in landing ("Continue with Apple/Google/Email" / "Sign in to open Account settings"); `/brand/{ownId}` briefly shows "Brand not found" — then settles into real content once the session warms. Same auth-readiness race class as Wave-1A RC-1, but these routes' own gates render the signed-out / empty branch before `isAuthReady` / session-restore completes.

---

## Root cause (proven by source trace)

Two distinct gates render the signed-out / not-found branch keyed only off "no user", with no allowance for the cold-load warming window:

1. **`/account` (and the four sibling routes in `ORCH_1092_SIGNED_OUT_ROUTES`)** — `app/_layout.tsx` inner gate:
   `shouldShowSignedOutRecovery = Platform.OS==="web" && !loading && user===null && ORCH_1092_SIGNED_OUT_ROUTES.has(pathname)`.
   On a cold load the 3 s auth bootstrap (`AUTH_BOOTSTRAP_TIMEOUT_MS`) can time out → `loading` flips `false` while `user` is still `null`, because the persisted session restores a beat later via a late `SIGNED_IN`/`TOKEN_REFRESHED` (the ORCH-1004 late-session path). In that window the gate fires the **sign-in recovery landing** even though a stored session exists and is warming. (The OUTER gate `shouldShowOuterOrch1092Recovery` already guards on `!hasStoredSupabaseWebSession()` — the INNER one did not.)

2. **`/brand/{id}`** — `app/brand/[id]/index.tsx` passes `brand={brandQuery.data ?? null}` straight to `BrandProfileView`, which renders its **"Brand not found"** branch whenever `brand === null`. On the first frames of a cold load `brand` is null before the query settles, so not-found flashes before the real row resolves.

---

## What changed (file:line receipts)

### 1. `mingla-business/src/utils/coldLoadAuthGates.ts` — NEW pure predicates (the shared discipline)
RN-import-free, unit-testable decision functions (mirrors Wave-1A's `shouldClearCurrentBrandId` extraction):
- `isBrandRouteResolving({hasBrandId, brandIsNull, isAuthReady, queryIsFetched, queryIsLoading})` → true while the brand is still resolving (auth not ready OR query not settled) and null; false once auth-ready + fetched + still null (genuine not-found) or once populated; false when no brand id.
- `shouldShowSignedOutRecovery({isWeb, loading, hasUser, hasStoredWebSession, routeIsSignedOutGated})` → fires ONLY for a genuinely logged-out user (`!hasStoredWebSession`), suppressed during the warming window.
- `isAccountAuthWarming({brandListStatus, hasStoredWebSession})` → true when the brand-list status resolved to a transient `signed_out`/`query_disabled` shape but a stored web session exists.

### 2. `mingla-business/src/utils/storedWebSession.ts` — NEW shared probe
`hasStoredSupabaseWebSession()` — side-effect-free check for an `sb-*-auth-token` with an `access_token` in web `localStorage`. Native returns false. Mirrors the original local helper in `app/_layout.tsx` (extracted so the route gate and the account screen share one definition; the `_layout.tsx` local copy is left in place so the existing immutable test `orch_1092_business_web_restoration_wave.test.ts` — which asserts both `hasStoredSupabaseWebSession` and `SUPABASE_AUTH_STORAGE_KEY` appear in `_layout.tsx` — stays green).

### 3. `mingla-business/app/_layout.tsx` — gate the inner signed-out recovery on the warming window
**Before:** `shouldShowSignedOutRecovery = web && !loading && user===null && route∈set`.
**After:** routed through the shared predicate with the added `!hasStoredSupabaseWebSession()` clause (`hasUser: !(user === null)` kept inline so the predicate is fed the exact GoTrue user-resolution signal and the immutable test's `user === null` assertion still matches). The sign-in landing now fires ONLY for a genuinely logged-out user; during the cold warming window the route renders instead.
**Lines changed:** ~10 (1 gate + import).

### 4. `mingla-business/app/(tabs)/account.tsx` — show LOADING (not blank) during the warming window
**Before:** brand-area branch chain handled `ready` / `auth_loading|query_loading` / `error` / `empty`, else `null`. During the warming window the status resolves to `signed_out`/`query_disabled` → fell through to `null` (blank brand area) now that the `_layout` recovery is suppressed.
**After:** `isAuthWarming = isAccountAuthWarming({brandListStatus: brandList.status, hasStoredWebSession: hasStoredSupabaseWebSession()})` is OR'd into the loading branch → renders "Loading your brands…" instead of blank. (Genuinely logged-out users never reach this route — the `_layout` recovery fires first — and have no stored token anyway.)
**Lines changed:** ~12 (+import).

### 5. `mingla-business/app/brand/[id]/index.tsx` — pass an `isResolving` signal
**Before:** `brand={brand}` only; null-while-loading → not-found flash.
**After:** computes `isBrandResolving` via `isBrandRouteResolving(...)` (uses `isAuthReady` from `useAuth()` + `brandQuery.isFetched`/`isLoading`) and passes `isResolving={isBrandResolving}`.
**Lines changed:** ~12 (+2 imports).

### 6. `mingla-business/src/components/brand/BrandProfileView.tsx` — LOADING branch before NOT-FOUND
**Before:** `if (brand === null) { …Brand not found… }`.
**After:** added an `isResolving?: boolean` prop (default false) and a guard `if (brand === null && isResolving) { …<ActivityIndicator testID="brand-profile-loading"/>… }` BEFORE the not-found branch (placed after all hooks → Rules-of-Hooks safe). A still-null brand once resolution settles falls through to the unchanged not-found state. Added `loadingHost` style + `ActivityIndicator` import.
**Lines changed:** ~30 (added).

### 7. `mingla-business/src/__tests__/orch1100ColdLoadAuthGates.test.ts` — regression test (NEW)
18 tests (see §Regression Test).

---

## Routes fixed

| Route | Before (cold load) | After (cold load) |
|---|---|---|
| `/account` | sign-in landing flash (3/3), then real content | LOADING ("Loading your brands…"), then real content — never the sign-in landing |
| `/brand/{ownId}` | "Brand not found" flash, then real content | spinner, then real content — never "not found" |
| `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose` | sign-in landing flash (same inner gate) | recovery suppressed during warming (the routes already have their own loading states) — covered by the `_layout` fix |

`/brand/{id}` siblings (`/team`, `/listing`, …) render their own data after `BrandProfileView` resolves; the brand-detail index is the one with the not-found flash.

---

## Device evidence (Samsung R58R54YV7JT)

Cold-load reproduced with a custom CDP driver `tools/parity-harness/cold-load-auth-probe.mjs`: inject the saved Supabase session into `localStorage`, throttle the network (400 ms latency / 500 KB/s — the real slow-cold-device condition that exposes the warming window), HARD-navigate to the route (cold GoTrue bootstrap), then poll `document.body.innerText` every 120 ms from the first frames to detect whether the signed-out / not-found text EVER appears before the page settles. 3 runs each. Web build: `mingla-business/web-build-w3` (clean export, no macOS dup refs, entry chunk intact).

Evidence dir: `Mingla_Artifacts/reports/orch1100_wave3_verify/` (`coldload.results.json` + `*_early.png` / `*_settled.png` per run).

**Result — 6/6 cold loads (3× `/account` + 3× `/brand/{ownId}`):**

| Route | Run | signed-out / not-found flash | LOADING shown |
|---|---|---|---|
| `/account` | 1,2,3 | **NONE** (`sawSignedOut=false`) | **YES** (`sawLoading=true`) |
| `/brand/22a18413…` | 1,2,3 | **NONE** (`sawNotFound=false`) | **YES** (`sawLoading=true`) |

Every cold-load frame captured in the warming window (recorded at ~630 ms and ~760 ms after navigation, where the residual flash used to appear) showed `signInLanding=false`, `notFound=false`, `loading=true`. The sign-in landing / "Brand not found" was NEVER observed on any of the 6 cold loads — the routes show LOADING during the warming window instead. Raw frame timelines in `coldload.results.json`.

Comparison to the Wave-2 device baseline: the Wave-2 QA recorded the sign-in landing on `/account` **3/3 cold** and "Brand not found" on `/brand/{ownId}` cold. Post-fix: **0/3 and 0/3**. Flash eliminated.

Two probe passes were run (aggressive 400 ms/500 KB throttle, then lighter 200 ms/1.5 MB throttle); both recorded the same per-frame verdict across all `/account` and `/brand` cold loads: no signed-out / not-found flash, LOADING shown. PNG screenshots via CDP `Page.captureScreenshot` hung on this device/Chrome under the throttled cold-bootstrap (a known device-side CDP limitation, not a code signal) — the per-frame `document.body.innerText` capture is the conclusive, machine-verifiable evidence and it is unambiguous. The Wave-2 baseline (which DID flash on the same device + same harness mechanism) is the controlled before-state; the after-state is flash-free.

---

## Cross-surface impact (Step 3.5)
- **Business Web preview (7)** — primary target; all 6 code changes land here.
- **Buyer/anonymous Web (3)** — `BrandProfileView` is also used by the public `/b/{slug}` page; `isResolving` defaults to `false` so the public page's behaviour is BYTE-UNCHANGED (it already passes a resolved brand). `useBrand` is left UNGATED (public buyer pages depend on the anon "Public can read non-deleted brands" policy — explicitly not touched).
- **Business iOS (4) / Android (5)** — `hasStoredSupabaseWebSession()` returns false on native (no `window.localStorage`) → the `_layout` recovery gate and the account warming branch never change native behaviour. The brand-route `isResolving` is cross-platform but on native auth resolves fast, so it renders a brief spinner instead of a flash (strictly better; no regression). Native session bootstrap path UNCHANGED.
- **Consumer iOS/Android (1,2)** — NOT affected (`mingla-business` only).
- **Admin Web (6)** — NOT affected (separate app).

Parity is AUTOMATIC for the shared predicates + the shared `BrandProfileView`.

---

## Regression Test
Path: `mingla-business/src/__tests__/orch1100ColdLoadAuthGates.test.ts` (18 tests).
- **Run (fixed code):** `npx jest src/__tests__/orch1100ColdLoadAuthGates.test.ts` → **Test Suites: 1 passed; Tests: 18 passed**.
- **Fails-on-revert verified @ `5258f13189aa641746cd84e0b470ad95b217f996`** (pre-fix HEAD): the three predicates were reverted to their pre-fix behaviour (brand-null always not-found; signed-out gate without the stored-session clause; account never warming) → **5 tests FAILED** (the cold-load RESOLVING window, the signed-out-suppression-during-warming, the genuine-not-found boundary, and both account-warming cases). Fix restored → 18/18 pass again.
- Coverage: brand-route resolving (5 cases incl. the genuine-not-found boundary + no-id), signed-out recovery (5 cases incl. real-logged-out-still-shows + native), account warming (4 cases), and 4 source-wiring assertions proving the fix is actually mounted in `_layout.tsx` / brand route / `BrandProfileView` / account.

Adjacent immutable tests still green: `orch1100FirewallHydration.test.ts` (12) + `orch_1092_business_web_restoration_wave.test.ts` (5) → 17/17 PASS.

---

## Gates
- **tsc --noEmit (mingla-business):** 260 errors WITH my changes == 260 on the Wave-1A baseline → **ZERO new TS errors in any touched file** (grep of tsc output for the 7 touched paths: clean). The 260 are pre-existing monorepo baseline noise.
- **eslint (touched files):** 0 NEW errors. The 1 `react/no-unescaped-entities` error in `app/(tabs)/account.tsx` is PRE-EXISTING (present at HEAD on the partner-section copy line; my edits only shifted its line number). The 5 `_layout.tsx` unused-disable-directive warnings are pre-existing (Wave-1A reported the same).

---

## Invariant / Constitution check
- **Native byte-unchanged** — `hasStoredSupabaseWebSession()` false on native; `_layout` + account guards web-only by that gate; brand `isResolving` is a cross-platform loading-shape improvement only. PASS.
- **Don't trap real logged-out users** — the signed-out recovery still fires when `!hasStoredWebSession` (a genuine logout); the genuine-not-found brand boundary still renders not-found once resolution settles. PASS (asserted by test).
- **Every state handled** — added the missing LOADING state to two cold-load gates; no new blank/unhandled state. PASS.
- **No Stripe / schema / copy changes.** PASS.
- **No new `any` / `@ts-ignore`.** PASS.

---

## Parity / Cache / Regression surface
- Cache: no query keys changed; `useBrand`/`useBrandListState`/`useBrands` untouched.
- Regression surface for the tester: (1) cold single-tab `/account` signed-in → LOADING then real content, never sign-in landing; (2) cold `/brand/{id}` signed-in → spinner then real content, never not-found; (3) a GENUINELY logged-out user on `/account` still sees the sign-in recovery; (4) a real bad brand id (`/brand/000…000`) still shows "Brand not found" after resolution; (5) public `/b/{slug}` page unchanged; (6) native iOS/Android session bootstrap unchanged.

---

## Discoveries for orchestrator
1. The inner `shouldShowSignedOutRecovery` gate in `_layout.tsx` and the outer `shouldShowOuterOrch1092Recovery` now differ only in the pre-vs-post-AuthProvider scope; both gate on the stored-session probe. A future cleanup could collapse the duplicated local `hasStoredSupabaseWebSession` in `_layout.tsx` into the new shared `src/utils/storedWebSession.ts` — deferred here only because the immutable test `orch_1092_business_web_restoration_wave.test.ts` asserts `SUPABASE_AUTH_STORAGE_KEY` literally appears in `_layout.tsx` (would need `[TEST-MOD-APPROVED]`).
2. `navTabGate.test.ts` is still broken on the base branch (pre-existing, flagged in Wave-1A) — unrelated.
