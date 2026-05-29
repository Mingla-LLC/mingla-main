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
