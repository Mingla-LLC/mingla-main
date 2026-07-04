# INVESTIGATION — App Store Rejection 2.1a: "unable to edit profile, activity indicator spins indefinitely"

Mode: INVESTIGATE (read-only forensics). Surface: `mingla-business/` NATIVE iOS. iPad Air / iPadOS 26.5.
Reviewer signs in via the ORCH-1220 bypass (`appreview@usemingla.com` + secret code → `reviewer-signin` edge fn → `setSession`).

---

## VERDICT (one line)

The profile screens gate their entire render on `if (isLoading / isResolving) return <ActivityIndicator/>`, fed by **un-timed Supabase reads with NO per-screen timeout or ceiling backstop**. When a read stalls (never resolves *and* never rejects — reliably reproducible on Apple's proxied/throttled review network), the flag stays `true` forever and the screen spins with no escape. The business app is **missing the `withTimeout`/`Promise.race` settle-guarantee** that app-mobile has (`mingla-business/src/utils/withTimeout.ts` does not exist); the only timeout anywhere is the auth *boot* gate.

---

## The two "profile" surfaces a reviewer hits (fix is identical for both)

### PRIMARY (literal "Edit profile" menu item) — `app/account/edit-profile.tsx:280`
```
if (isLoading) {            // line 280
  return <ActivityIndicator size="large" color={accent.warm} />   // full-screen gate
}
```
- `isLoading` comes from `useCreatorAccount()` — `src/hooks/useCreatorAccount.ts:54`.
- queryFn (`useCreatorAccount.ts:59-70`): `supabase.from("creator_accounts").select(...).eq("id",userId).maybeSingle()` — **no timeout / no AbortSignal**.
- Reached via Account tab → Settings → "Edit profile" (`app/(tabs)/account.tsx:141-143, 381-385`).
- Note: React Query is **v5.100.6**, so `isLoading = isPending && isFetching` (verified in `node_modules/@tanstack/query-core/build/modern/queryObserver.js:310`). A *disabled* query is `isLoading:false` → renders the form, NOT a spinner. So this screen can ONLY hang while the query is **enabled and genuinely fetching-but-never-settling** — i.e. a stalled read, not an auth-gate problem.
- Has an `isError` branch (`:296`) with a Retry CTA — but a promise that never rejects never reaches it (`retry:2` fires on rejection only).

### STRONG SECONDARY (the reproduced + screenshotted "Brand" profile) — `app/brand/[id]/index.tsx:187` → `src/components/brand/BrandProfileView.tsx:476`
```
if (brand === null && isResolving) {                 // BrandProfileView.tsx:476
  return <... TopBar title="Brand" ...><ActivityIndicator .../> // :483
}
```
- `isResolving = isBrandRouteResolving(...)` — `src/utils/coldLoadAuthGates.ts:28-44`:
  `return !isAuthReady || !queryIsFetched || queryIsLoading;` (when brand is null).
- `useBrand(brandId)` (`src/hooks/useBrands.ts`) is **UNGATED** (`enabled = brandId !== null`) → `getBrand` (`src/services/brandsService.ts:672`) does **three un-timed reads**: `brands` maybeSingle THEN `Promise.all([getEventCountsByBrandIds, aggregateBrandStatsByBrandIds])`. Any one stalling wedges `isFetched=false` → `isResolving=true` forever.
- **This is the exact code path in `META-ORCH-1235_FREEZE_brand_profile_spinner.png`** ("Brand" TopBar + centered orange spinner over an empty body). META-ORCH-1235 REPRODUCED it live by hanging `GET /rest/v1/brands?...` (request pending 20,049 ms, never returned) — screen spun forever, no error.

Reached via Account tab → "Your brands" → tap the brand (the reviewer account is seeded with brand "The Party Block"; the 1235 repro used seeded user `8313d091-…`, brand `655ba0ef-…`).

---

## Why it is deterministic for the reviewer (and intermittent for us)

- Apple review runs behind a proxy/VPN that deep-inspects and can **stall a long-lived HTTP/2 stream** → a `fetch` that neither resolves nor rejects → React Query stays `fetchStatus:"fetching"` / `isFetched:false` indefinitely. Reliable on their network, rare on ours ⇒ "reviewer hits it every time, we can't repro."
- `queryClient` (`src/config/queryClient.ts:31-48`): `retry:2` fires only on a *rejected* promise; a never-settling promise is never retried, never errored. No `networkMode` set (defaults `"online"`), no query timeout.
- **No data-layer settle-guarantee exists.** `src/utils/withTimeout.ts` — the guard app-mobile ships and uses (ConnectionsPage, AccountSettings 45s, useForegroundRefresh 8s) — **does not exist in mingla-business**. The ONLY timeout in the whole app is in `AuthContext.tsx` (3s boot race + 7s ceiling) and it does not cover data reads.

### Native aggravators worth flagging (secondary)
1. `coldLoadAuthGates.ts:43` has a **sticky `!isAuthReady`** term: whenever brand is null, the brand-profile spins on `!isAuthReady` even after the brand read has already settled.
2. The 7s hard ceiling on the boot `loading` gate is **web-only** (`AuthContext.tsx:248` `if (Platform.OS === "web")`). On native the post-`getSession()` awaited chain — `getUser()` probe (`:349`), `ensureCreatorAccount` (`:395`), `tryRecoverAccountIfDeleted` (`:404`) — runs with **no timeout** before `setLoading(false)` (`:424`). If any stalls on Apple's network, `loading` sticks true → the native **boot** spinner spins forever (a third, distinct infinite-spinner surface on iPad). The 3s bootstrap race only covers `getSession()`, not this chain.

---

## The precise fix

Convert every stalled read into the error/not-found/retry UI these screens **already have**, by giving the reads a settle-guarantee:

1. **Add `mingla-business/src/utils/withTimeout.ts`** (mirror app-mobile: `Promise.race` against a ~12-15s timeout that rejects) and wrap the queryFns feeding the gates:
   - `useCreatorAccount` queryFn (`useCreatorAccount.ts:59`) → on timeout it rejects → `retry:2` → `isError` → the existing Retry branch (`edit-profile.tsx:296`) renders instead of spinning.
   - `getBrand` + its `Promise.all` stats reads (`brandsService.ts:672-687`) → timeout → `isFetched:true`(error) → BrandProfileView falls through to its not-found/retry state (`:495`) instead of spinning.
   - Ideally the same wrapper on all authed reads (systemic).
2. **Make `isBrandRouteResolving` time-bounded / drop the sticky `!isAuthReady`** so "fetching > N s with a valid session" degrades to an actionable error, not a permanent spinner (`coldLoadAuthGates.ts:43`).
3. **De-gate the native hard ceiling** (`AuthContext.tsx:248`, currently `Platform.OS === "web"` only) and/or put a per-call timeout on the `getUser()` probe, so the boot `loading` gate is also bounded on native — closes the iPad boot-spinner variant.
4. (Minor) set an explicit `networkMode` and consider `retry` on transient errors after the timeout lands.

Highest-value single change that kills the reviewer's infinite spinner on BOTH profile surfaces: **wrap the profile/brand reads in a bounded timeout** so the spinner can convert to the already-built error / not-found / retry UI.

---

## Evidence index (file:line)
- `app/account/edit-profile.tsx:280` (isLoading spinner), `:296` (isError+Retry branch — unreachable on a hang)
- `src/hooks/useCreatorAccount.ts:49-71` (enabled = isAuthReady && userId; un-timed maybeSingle)
- `app/brand/[id]/index.tsx:52-58, 187` (isResolving wiring)
- `src/components/brand/BrandProfileView.tsx:476-491` (brand===null && isResolving → spinner; matches the FREEZE screenshot), `:495` (not-found branch)
- `src/utils/coldLoadAuthGates.ts:28-44` (isBrandRouteResolving; sticky `!isAuthReady`)
- `src/hooks/useBrands.ts` (`useBrand` UNGATED) + `src/services/brandsService.ts:672-687` (getBrand: 3 un-timed reads)
- `src/config/queryClient.ts:31-48` (retry-on-reject-only, no networkMode, no timeout)
- `src/context/AuthContext.tsx:248` (web-only 7s ceiling), `:349/:395/:404` (un-timed awaited chain), `:424` (setLoading false)
- `src/services/supabase.ts:113-127` (native uses default processLock — no Web-Locks deadlock class on native)
- `src/utils/withTimeout.ts` — **absent** (app-mobile has it; business does not)
- REPRO artifact: `Mingla_Artifacts/reports/META-ORCH-1235_FREEZE_brand_profile_spinner.png` + `INVESTIGATION_META-ORCH-1235_RUNTIME_REPRO.md`
