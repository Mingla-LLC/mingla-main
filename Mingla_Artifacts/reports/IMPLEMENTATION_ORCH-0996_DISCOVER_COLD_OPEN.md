# IMPLEMENTATION — ORCH-0996 [Discover/Events cold-open latency]

- **Date:** 2026-05-29
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-0996-[discover-cold-open]/` on branch `ORCH-0996-discover-cold-open`
- **Branched from:** main `2a30c8edc` (ORCH-0994 grid video covers already landed)
- **Status:** implemented and verified (logic + compile); live authenticated cold-open A/B needs Seth's sim login.
- **Surfaces affected:** Consumer iOS + Consumer Android (`app-mobile/`, shared code path → parity automatic). NOT business apps / admin / buyer-web (no Discover screen there).

---

## What changed (5 contract items)

### 1. Killed the 300ms debounce on the INITIAL fetch
**Before:** a single effect always wrapped the fetch in `setTimeout(fetchNightOutEvents, 300)`, so even the very first cold-open paid 300ms on TOP of the GPS + prefs + geocode + edge-fn waterfall.
**After:** the fetch-trigger effect splits into INITIAL vs FILTER-CHANGE via the pure helper `decideDiscoverFetchMode({ hasUsableQuery, hasFiredInitial })`:
- First usable query → `"immediate"` → fetch fires synchronously, NO debounce.
- Every subsequent filter/city/GPS change → `"debounced"` → keeps the 300ms coalesce so rapid pill taps don't thrash.
- No city AND no GPS → `"skip"`.

The helper is a pure exported function so the contract is unit-testable without mounting the RN screen; the component delegates to it.

### 2. Added caching (re-open paints instantly, revalidates in background)
**Before:** ORCH-0839-A removed the on-device cache; every open was cold.
**After:** new module `app-mobile/src/utils/discoverEventsCache.ts` — a **module-level in-memory** cache keyed by the **EXACT full query signature**. On mount we synchronously read the cache for the current signature and paint it immediately (suppressing the blocking skeleton only when the cached entry is fresh, TTL 3 min), then the network fetch runs and overwrites. The fetch ALWAYS runs — the cache never short-circuits it — so the server stays authoritative.

**Design choice (justified):** full React Query conversion was too broad/risky for one pass — the fetch has two divergent paths (merged vs GPS-only), post-fetch partition logic, and `tmError`/`fallbackActive` side-state, plus the ORCH-0824 stale-closure fix and ORCH-0828 empty-state-both-arrays invariant live in the imperative body. Converting all of that risked regressing those invariants. The tightly-scoped in-memory cache keyed by the full signature delivers paint-first re-opens with a small, auditable blast radius (the contract explicitly authorizes this fallback).

### 3. Parallelized the location chain
**Before:** the GPS effect `await`ed precise `getCurrentLocation()` (2-5s first open) before setting ANY coordinate, gating the whole fetch; it only fell back to last-known on throw/null.
**After:** the effect (a) seeds `deviceGps*` IMMEDIATELY from last-known/saved location (`useUserLocation`, no await) so the fetch can fire on the next render, and (b) resolves precise GPS in parallel, replacing the seed ONLY if precise GPS lands AND moved meaningfully (> ~0.005° ≈ 500m, far below the 50km search radius), which mints a refine refetch. A near-identical lock is ignored (no churn). A slow precise-GPS lock no longer blocks first paint.

### 4. Memoized genreFilterOptions + stabilized `t`
- `genreFilterOptions` is now `useMemo([selectedFilters.segment, t])` instead of a `.map()`+`t()` on every render.
- `t` removed from `fetchNightOutEvents`'s dependency array. The only translated string it used (the catch-block error) is mirrored into `fetchErrorTextRef`, kept current by a tiny effect. This stops an i18n re-render from churning the fetch callback identity → re-firing the fetch effect (the latent refetch the investigation flagged).

### 5. Prefetch first row of cover images
New effect: once results land, `ExpoImage.prefetch` the first 4 cover URIs (≈ first two rows of the 2-col grid) — business events first (they render above the TM grid, image-type only), then Ticketmaster cards — so the grid doesn't fade in cold.

---

## ORCH-0839-A rationale found + how this avoids regressing it

**Found in:** `Mingla_Artifacts/specs/SPEC_ORCH-0839-A_DISCOVER_HARDENING.md` (Decision B + F-4) and the protective comments at `DiscoverScreen.tsx`.

**The C-1 bug:** ORCH-0839-A removed an **AsyncStorage** cache because it was the source of **cross-filter leakage (C-1)** — its key was under-specified and its cache-hit predicate (`cached.venues.length > 0`, extended by ORCH-0835 with `businessEvents.length > 0`) **short-circuited the network**, so one filter set's results could be served for a different filter set. The removal is protected by CI gate `app-mobile/scripts/ci/orch-0839-a-mobile-cache-removed.mjs` (invariant I-PROPOSED-DISCOVER-NO-MOBILE-CACHE), which forbids the identifiers `NightOutCache` / `loadNightOutCache` / `saveNightOutCache` / `clearNightOutCache` / `nightOutCacheKey` / `cached.venues.length > 0` and requires the `ORCH-0839-A F-4 … skipCache` marker comment.

**How this implementation avoids re-introducing C-1 (three structural differences):**
1. **Full-signature key.** The cache key includes EVERY facet the server reads — city identity (name/lat/lng) + gps + date + segment + genre + partyTypes + vibeTags + musicGenres. Two distinct filter sets can never collide on a key, so one set's data can never be served for another. (Regression test asserts a segment change and a musicGenres change both MISS, never leak.)
2. **Never short-circuits.** The network fetch ALWAYS runs and overwrites; the cache is a paint-first hint, not an authority. The exact short-circuit mechanism that caused C-1 does not exist.
3. **In-memory only.** No AsyncStorage; no stale-on-disk surface across launches.

**CI gate stays green:** the new module uses entirely different identifiers and keeps the F-4 marker + `skipCache` no-op intact. Verified: `node scripts/ci/orch-0839-a-mobile-cache-removed.mjs` → 5/5 PASS.

---

## Files changed

### `app-mobile/src/utils/discoverEventsCache.ts` (NEW, ~145 lines)
**What it does now:** module-level in-memory full-signature cache (`buildDiscoverCacheKey`, `readDiscoverCache`, `writeDiscoverCache`, `isDiscoverCacheFresh`, TTL const) + the pure `decideDiscoverFetchMode` fetch-mode decision + test-only reset.
**Why:** contract items 1 + 2.

### `app-mobile/src/components/DiscoverScreen.tsx` (~258 lines changed)
**Before:** sequential GPS-await location resolve; single always-300ms-debounced fetch effect; `t` in fetch deps; unmemoized `genreFilterOptions`; no cache; no image prefetch.
**After:** parallel location seed+refine; split immediate/debounced fetch with synchronous cache paint; cache writes on both success branches; `t` removed from deps (ref-mirrored error string); memoized `genreFilterOptions`; first-row `ExpoImage.prefetch` effect.
**Why:** contract items 1-5.

### `app-mobile/src/utils/__tests__/discoverEventsCache.test.ts` (NEW, Deno test, 7 cases)
**Why:** Step 0.5 regression test (matches sibling `friendMenu.test.ts` Deno pattern).

---

## Regression Test

- **Path:** `app-mobile/src/utils/__tests__/discoverEventsCache.test.ts`
- **Runner:** `/Users/sethogieva/.deno/bin/deno test --allow-env --no-check src/utils/__tests__/discoverEventsCache.test.ts`
- **Passing run:** `ok | 7 passed | 0 failed (90ms)`
- **Coverage:**
  - (a) first usable query → `"immediate"` (NOT debounced); subsequent → `"debounced"`; no-query → `"skip"`.
  - (b) second mount same signature reads cached result; DIFFERENT filter set (segment change, musicGenres change) MISSES (no C-1 leakage); array pill ORDER does not fragment the key; stale entry past TTL reports not-fresh.
- **fails-on-revert verified at `2a30c8edcfa11607b5cbf6140b86b6bc36db5db0`:** reverting `decideDiscoverFetchMode` to always `return "debounced"` (the old always-300ms behavior) → test `ORCH-0996 (a) first usable query -> immediate` FAILS (`Actual: debounced / Expected: immediate`), `1 failed`. Fix restored → `7 passed`.

---

## Verification matrix

| Item | Evidence | Verdict |
|---|---|---|
| 1. Initial fetch not debounced | `decideDiscoverFetchMode` + unit test (immediate path), fails-on-revert | PASS |
| 2. Re-open paints from cache | full-signature cache + synchronous mount read + unit test | PASS |
| 3. Location chain parallelized | immediate last-known seed + parallel precise-GPS refine | PASS |
| 4. genreFilterOptions memoized + `t` stabilized | `useMemo` + `fetchErrorTextRef` + `t` removed from deps | PASS |
| 5. First-row image prefetch | `ExpoImage.prefetch(firstRowUris.slice(0,4))` effect | PASS |
| Filter behavior preserved (ORCH-0824 stale-closure) | all facets remain in fetch deps; only `t` removed | PASS |
| Skeleton/empty/error/no-match preserved | render-state guards untouched | PASS |
| ORCH-0839-A C-1 NOT reintroduced | full-signature key + never-short-circuit + in-memory; gate 5/5 PASS | PASS |
| `tsc --noEmit` touched files | clean (DiscoverScreen.tsx + discoverEventsCache.ts: 0 errors) | PASS |
| eslint production files | clean | PASS |
| Metro transform of DiscoverScreen subtree | 248 modules transformed, 0 errors | PASS |
| Live cold-open A/B time-to-first-card on sim | needs Seth's authenticated sim login | UNVERIFIED (manual) |

`tsc` note: the repo's full `tsc --noEmit` is not clean on baseline (Deno test files seen by tsc, `packages/phone-input` missing react types, board/payment pre-existing errors). NONE are in the touched files; this implementation adds zero new tsc errors.

---

## Parity / Cache safety / Regression surface

- **Parity:** shared `app-mobile/` code path → iOS + Android automatic.
- **Cache safety:** no React Query keys changed. New cache is independent, in-memory, full-signature-keyed; never persisted.
- **Regression surface to test:** (1) filter pills still refetch (date/segment/genre/partyTypes/vibeTags/musicGenres); (2) city switch refetches; (3) skeleton/empty/error/no-match in all combos; (4) pull-to-refresh; (5) backgrounding → foregrounding re-resolves GPS.

## Discoveries for Orchestrator
- None. (New invariant proposed: I-PROPOSED-DISCOVER-INMEM-CACHE-FULL-SIGNATURE — documented in the cache module header; orchestrator may register it.)

## Test first (for Seth)
- On a logged-in sim/device: open Discover cold, confirm cards appear noticeably faster; leave Discover and re-open → cards paint instantly then refresh.
- Toggle each filter and confirm results still change correctly.

---

# REWORK 1 — resolved-city seed for instant re-open

- **Date:** 2026-05-29
- **Built on:** prior ORCH-0996 commit `61ed534c5` (new commit on top).
- **Trigger:** QA verified live on a physical Android (Galaxy A72): open Discover → resolves to "Raleigh" via GPS reverse-geocode (~2-3s) + caches events; leave to another tab and return → at +350ms the SKELETON + "Set city" shows, NOT the cached Raleigh cards.

## Root cause (confirmed)

DiscoverScreen remounts fresh on every tab return (active-tab-only architecture). On remount `selectedCity` and `gpsDefaultCity` are both `null` until the async GPS→reverseGeocode chain re-runs. So on the FIRST post-remount render `effectiveCity` is `null` → the events-cache signature has `cityName=null` (and `gpsLat/Lng` not yet seeded) → `buildDiscoverCacheKey` produces a different key → `readDiscoverCache` MISSES the prior "Raleigh"-keyed entry. By the time the city re-resolves (~2-3s), the fresh network fetch is already in flight. **The expensive UN-cached step is the CITY RESOLUTION (GPS reverse-geocode), not the events fetch** — so the events cache built in the original pass could never be read on re-open until the slow thing it depends on re-ran.

## The fix — mechanism

A tiny module-level (process-lifetime, in-memory) **resolved-city cache** in `discoverEventsCache.ts`:

- `writeResolvedDiscoverCity(lat, lng, city)` — called when the authoritative `reverseGeocode` resolves; records the resolved `DiscoverCity` + a coord key rounded to 3 decimals (~110m).
- `readLastResolvedDiscoverCity()` — coords-agnostic; returns the most-recent resolved city. DiscoverScreen calls this **synchronously in the `useState` lazy initializers** for `gpsDefaultCity` AND `deviceGpsLat/Lng`, so on the very first post-remount render `effectiveCity` is non-null and the gps facets are populated → the events-cache key reproduces the prior entry's key → the events cache **HITS** and paints the prior cards immediately.
- `readResolvedDiscoverCity(lat, lng)` — coords-matched (~110m bucket). Once the device's actual coords are known, if the seeded city's coords don't match (user physically moved cities), the seed is dropped so the user isn't shown a stale city while the authoritative geocode runs.

**Why the seed approach (not the geocode-result approach):** I chose to cache the resolved `DiscoverCity` object and seed `gpsDefaultCity`+`deviceGps*` directly, rather than only memoizing `geocodingService.reverseGeocode`. Reason: memoizing only the geocode would still leave `gpsDefaultCity` `null` on the first synchronous render (the geocode call site is inside an `async` effect that runs AFTER first commit), so `effectiveCity` would still be `null` on render 1 and the events cache would still MISS that frame. Seeding state directly is the least-surface-area way to make `effectiveCity` and the gps facets known on render 1. (`geocodingService` already has its own 24h coords→city cache, so the authoritative re-geocode is itself fast/free on re-open anyway.)

Both the async `reverseGeocode` and the network events fetch **ALWAYS still run and overwrite** — the seed is a paint-first hint, never a short-circuit. This preserves the ORCH-0839-A C-1 leakage guard exactly as the events cache does: same never-short-circuit discipline, in-memory only, full-signature events key unchanged.

### Skeleton suppression on the first frame

Because the seeded city is known at `useState`-init time, the events-cache read is also done synchronously at mount (`initialEventsCacheSeed` memo) and used to lazy-init `nightOutCards` / `businessEvents` / `tmError` / `fallbackActive` / `nightOutLoading`. So there is **no one-frame skeleton flash** — a fresh remount with a fresh cached entry initializes with `nightOutLoading=false` and the prior cards already in state. The immediate fetch then revalidates underneath.

## Hard guards verified

- **User-set city still wins:** `effectiveCity = selectedCity ?? gpsDefaultCity`. The seed only fills the `gpsDefaultCity` slot; when preferences load, `selectedCity` overrides. Unchanged.
- **Always-overwrite preserved:** the reverseGeocode effect no longer early-returns on `gpsDefaultCity` being set; it geocodes each distinct coord once per mount (`geocodedCoordsRef`) and overwrites + persists the result. Network events fetch unchanged (still always runs).
- **Moved-user safety:** coords-matched read drops a stale seed when the device moved beyond the ~110m bucket.
- **Filter behavior (ORCH-0824 stale-closure):** untouched — all facets remain in the fetch deps; only the seed reads were added.
- **ORCH-0839-A CI gate:** `node scripts/ci/orch-0839-a-mobile-cache-removed.mjs` → 5/5 PASS (new identifiers don't trip the forbidden-list).

## Files changed (REWORK 1)

### `app-mobile/src/utils/discoverEventsCache.ts`
**Before:** events cache + `decideDiscoverFetchMode` only.
**Now:** adds the resolved-city cache — `writeResolvedDiscoverCity`, `readResolvedDiscoverCity` (coords-matched ~110m), `readLastResolvedDiscoverCity` (coords-agnostic bootstrap seed), `RESOLVED_CITY_COORD_PRECISION`, `ResolvedDiscoverCity`, `__resetResolvedDiscoverCityForTests`.
**Why:** make the resolved city available synchronously on remount.
**Lines changed:** ~95 added.

### `app-mobile/src/components/DiscoverScreen.tsx`
**Before:** `gpsDefaultCity`/`deviceGps*` init to `null`; events state init to empty/`loading=true`; reverseGeocode effect early-returned once `gpsDefaultCity` was set.
**Now:** `gpsDefaultCity` + `deviceGpsLat/Lng` lazy-init from `readLastResolvedDiscoverCity()`; `initialEventsCacheSeed` memo reads the events cache synchronously at mount and seeds `nightOutCards`/`businessEvents`/`tmError`/`fallbackActive`/`nightOutLoading`; reverseGeocode effect runs once per distinct coord (ref-guarded), drops a stale seed when coords don't match, and persists the authoritative result via `writeResolvedDiscoverCity`.
**Why:** instant paint on re-open without waiting for GPS reverse-geocode or the network.
**Lines changed:** ~70 changed/added.

### `app-mobile/src/utils/__tests__/discoverEventsCache.test.ts`
**Now:** +2 tests (9 total) — (c) prior-resolved coords seed the city synchronously so the events-cache key reproduces the prior entry and `readDiscoverCache` HITS; (c) coords-matched read respects the ~110m bucket (moved user not mis-seeded).

## Regression Test (REWORK 1)

- **Path:** `app-mobile/src/utils/__tests__/discoverEventsCache.test.ts`
- **Runner:** `/Users/sethogieva/.deno/bin/deno test --allow-env --no-check src/utils/__tests__/discoverEventsCache.test.ts`
- **Passing run:** `ok | 9 passed | 0 failed (144ms)`
- **fails-on-revert verified at `61ed534c5` (the prior ORCH-0996 commit):** stubbing `readLastResolvedDiscoverCity()` to `return null` (the pre-rework no-seed behavior) → test `ORCH-0996 REWORK 1 (c) prior-resolved coords seed city synchronously -> events cache HITS` FAILS (`AssertionError: fresh mount must synchronously seed the resolved city`), `8 passed | 1 failed`. Fix restored → `9 passed`.

## Completion condition

On remount with previously-resolved coords: `gpsDefaultCity` + `deviceGps*` are seeded synchronously → `effectiveCity` non-null on render 1 → the events cache HITS and cached cards paint without waiting for GPS reverse-geocode or the network (skeleton suppressed via synchronous events-cache seed). Behavior otherwise unchanged (selectedCity wins; geocode + fetch always overwrite; ORCH-0824/0839-A guards intact). Test passes with fails-on-revert. Committed.

**Live device A/B** (re-open paints the cached Raleigh cards instead of skeleton + "Set city") remains the manual confirmation for Seth on the Galaxy A72 reproducer — the logic + synchronous-seed mechanism + unit proof are in place; the on-device timing is the last eyeball.
