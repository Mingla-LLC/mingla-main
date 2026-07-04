# INVESTIGATION — META-ORCH-1235 — business web "freezes on a loading screen (reload fixes it)"

**Angle:** RUNTIME REPRO (drive a real Chromium browser, catch the hung state)
**Surface:** business.usemingla.com (`mingla-business/`), web
**Status:** REPRODUCED with concrete runtime evidence. Smoking gun captured.
**Date:** 2026-06-26

---

## TL;DR

- **DID reproduce — yes.** The exact freeze (a permanent orange `ActivityIndicator`
  on an otherwise-empty screen) was caught on the **`/brand/[id]` brand-profile
  route**. Screenshot: `META-ORCH-1235_FREEZE_brand_profile_spinner.png`.
- **The single most-likely hung async:** `useBrand(brandId)` →
  `getBrand(brandId)` → `GET /rest/v1/brands?select=*&id=eq.<id>&deleted_at=is.null`
  (issued by `src/hooks/useBrands.ts`). When that request **hangs (never resolves
  AND never errors)**, the React Query stays `fetchStatus:"fetching"` /
  `isFetched:false` **forever**, so the brand-profile gate
  `isBrandRouteResolving(...)` stays `true` and renders a spinner with **no
  timeout/ceiling backstop**. The root `_layout` auth gate HAS a 7 s ceiling; the
  per-screen brand gate does **not**.
- **Why "reload fixes it":** the spinner is purely resolve-gated. A fresh load
  re-issues the read; on a healthy response it settles in <1 s and the screen
  renders. Proven: an 8 s-delayed-then-success read → screen renders normally at
  ~8 s, `inflight=0`.
- **A clean ERROR does NOT freeze** — it degrades to "Brand not found" after
  React Query's `retry:2`. Only a **hung (pending, never-settling)** read produces
  the permanent spinner. This matches a GoTrue navigator-lock / auth-warm stall or
  a silently-dropped socket (the META-ORCH-1232 family), not a normal 4xx/5xx.

---

## Environment / method

- Worktree `orch-1235-[bizweb-loading-freeze]`, `npx expo start --web --clear`
  on `http://localhost:8099`. Booted with `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=
  pk_live_placeholder` (backend `stripe-mode` returns `{mode:"live",
  publishablePrefix:"pk_live_"}`, so `pk_live_` matches → no StripeModeMismatch).
- Auth: minted a real reviewer session via the `reviewer-signin` edge fn
  (`appreview@usemingla.com` + bypass code), injected the full Supabase session
  object into `localStorage["sb-gqnoajqerqhnvulmnyvv-auth-token"]` via Playwright
  `addInitScript` (seeded user `8313d091-2a34-44fc-985d-9cefb5d80781`, brand
  `The Party Block` = `655ba0ef-537f-4720-bff6-805b39d9d9d2`).
- Drove Chromium (Playwright) through cold-load → home → account → brand profile
  → payments → events. To provoke the race I intercepted ONLY `supabase.co`
  requests (bundle served at full speed) and selectively **delayed / hung / errored**
  specific calls. This is the correct way to model a slow/stalled API on an
  otherwise-fast page (a blunt CDP `emulateNetworkConditions` throttles the Metro
  dev bundle too and only produces a false "bundle never downloaded" artifact —
  discarded).

## What did NOT freeze (and why that matters)

The pre-authenticated reload path is **very robust** because of ORCH-1204
synchronous web-session hydration: `AuthProvider` reads the stored session
synchronously from `localStorage` at mount and sets `loading=false` + `user` on
first paint. As a result:

| Scenario (with a valid stored session) | Result |
|---|---|
| 30× cold reload, fast network | 0/30 froze; content < 1 s; spinner never even shown |
| 1.5–4 s delay on **every** Supabase call | 0/20 froze (sync hydration paints first) |
| `/auth/v1/token` + `/auth/v1/user` hung 60 s | 0/10 froze |
| First `/rest/v1` read hung 60 s | 0/10 froze |
| Fresh **sign-in via UI** (email→OTP reviewer code), clean / hung-rest / all-delayed | 0/15 froze; lands on home (degraded "Create brand" shell if brand read is hung — actionable, not a spinner) |
| `/brand/[id]/payments` with all rest hung | shows "Payments / Brand not found" (degraded, not a spinner) |
| `/(tabs)/hub/events` with all rest hung | shows "Create brand / No events yet" (degraded shell, not a spinner) |

The root auth spinner (`AuthResolvingScreen` in `app/_layout.tsx`) is well
defended (3 s bootstrap race + 7 s hard ceiling). The freeze is **not** there.

## The freeze (REPRODUCED)

**Route:** `/brand/655ba0ef-537f-4720-bff6-805b39d9d9d2` (brand profile — the
target of the brand switcher / "open a brand" flow).

**Trigger:** hang the brand-detail read
`GET /rest/v1/brands?select=*&id=eq.<id>&deleted_at=is.null` (never respond).

**Captured frozen state** (`brandgate_hangbrand_*.json`, screenshot
`META-ORCH-1235_FREEZE_brand_profile_spinner.png`):
- UI: a "Brand" TopBar + back button, and a **centered orange ActivityIndicator
  spinning forever** over an empty body. (The cookie consent card at the bottom is
  an unrelated overlay.) This is exactly the reported "stuck on a loading screen".
- **Pending requests at freeze (still in-flight, never returned):**
  - `GET /rest/v1/brands?select=*&id=eq.655ba0ef-...&deleted_at=is.null` — **20 049 ms, pending**
  - `GET /rest/v1/brands?select=*&account_id=eq.8313d091-...&deleted_at=is.null` — **19 914 ms, pending**
- **Console:** clean — `[auth] bootstrap-ready`, `INITIAL_SESSION hasUser:true`,
  `boot-session-probe: session valid`. (The `resolution-hard-ceiling` warn fires
  on the auth gate but is harmless here — auth resolved; the wedge is downstream.)
  No unhandled promise rejection; no error. The async is simply **never settling**.
- **`getSession()` / session in the frozen tab:** RESOLVES fine —
  `localStorage` session present, `user` set, auth fully ready. The freeze is
  **purely** the brand-detail query, not auth.

**Proof the spinner is resolve-gated (the "reload fixes it" mechanism):**
- `delaybrand` 8 s (slow-then-**succeed**) → spinner clears at ~8 s, full
  "The Party Block" profile renders, `inflight=0`. STUCK=false.
- `errbrand` (read always **errors**, connection reset) → after React Query
  `retry:2` the query becomes `isFetched:true` → gate flips false → screen shows
  "Brand not found" (degraded, **not** a permanent spinner). NB: also exposed a
  secondary **brand-read retry storm** (≈24 `brands` reads fired in 25 s — the
  realtime `orders` channel + RQ refetch + retry backoff compounding).

## Root cause (code path)

1. `app/brand/[id]/index.tsx` computes
   `isBrandResolving = isBrandRouteResolving({ hasBrandId, brandIsNull,
   isAuthReady, queryIsFetched: brandQuery.isFetched, queryIsLoading })` and passes
   it to `BrandProfileView` as `isResolving` → renders the spinner.
2. `isBrandRouteResolving` (`src/utils/coldLoadAuthGates.ts`) returns `true`
   whenever the brand is null and `!queryIsFetched`. A **hung** query never sets
   `isFetched=true`, so this is `true` indefinitely.
3. `useBrand` (`src/hooks/useBrands.ts`) → `getBrand` (`src/services/brandsService.ts:731`)
   is a plain `await supabase.from("brands").select(...).maybeSingle()` with **no
   `AbortSignal` / no timeout**, followed by a SECOND `await Promise.all([
   getEventCountsByBrandIds, aggregateBrandStatsByBrandIds])` — either await can
   hang and wedge `isFetched`.
4. **No per-screen ceiling exists.** The root `_layout` has
   `AUTH_RESOLUTION_HARD_CEILING_MS=7000` + `isAuthResolutionExpired`; the
   brand-profile (and any `isBrandRouteResolving`-gated) screen has nothing — a
   hung read is a permanent spinner.

**Most-likely real-world trigger** for the hang (vs. a clean 4xx/5xx, which would
degrade to not-found): a stalled fetch during the auth-warm / GoTrue
navigator-lock window or a silently dropped HTTP/2 stream — the same family as
META-ORCH-1232 (queries firing before/around JWT attach; locks self-healing late).
On web that produces a request that neither resolves nor rejects → exactly the
`fetchStatus:"fetching"` wedge captured here.

## Recommended fix direction (for the SPEC phase — not implemented here)

- Add a **bounded timeout / AbortSignal** to `getBrand` (and the sibling
  brand/stats reads), OR a **per-screen resolution ceiling** mirroring the
  `_layout` `AUTH_RESOLUTION_HARD_CEILING_MS` pattern, so a hung brand read
  surfaces a retry/error state instead of an infinite spinner.
- Cap the brand-read **retry storm** seen under persistent error (realtime channel
  + RQ refetch + retry backoff compounding) — secondary, but real.
- Consider making `isBrandRouteResolving` time-bounded (treat
  "fetching > N s with a valid session" as a recoverable error, not "still
  resolving").

## Artifacts (in scratchpad unless noted)

- `META-ORCH-1235_FREEZE_brand_profile_spinner.png` — **the smoking-gun screenshot** (committed in reports/)
- `brandgate_hangbrand_*.json` — frozen capture (pending reqs, console, probe)
- `brandgate_hangallrest_*payments.json`, `*_events.json` — degraded (not-frozen) comparisons
- `repro2.mjs` / `repro3.mjs` / `signin.mjs` / `brandgate.mjs` — Playwright harnesses
- `freezes3_delay.json`, `signin_*.json` — non-repro logs for the robust paths
