# QA — ORCH-0996 [Discover cold-open latency]

- **Date:** 2026-05-29
- **Mode:** TARGETED (adversarial regression + independent code verification)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-0996-[discover-cold-open]/` on branch `ORCH-0996-discover-cold-open`
- **Under test:** commits `61ed534c5` (cold-open latency: immediate first fetch, full-signature in-memory events cache, parallel location, memoized genre/`t`, first-row image prefetch) + `a0dcc9a5f` (REWORK 1: resolved-city seed for instant re-open)
- **Branch point:** main `f094946...` / ORCH-0994 `2a30c8edc`

## Verdict: **PASS**

- P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 1 (praise)
- The implementation does NOT reintroduce the ORCH-0839-A C-1 cross-filter leakage. The cache key includes every server-read facet, the network fetch always runs (never short-circuits), the seed is paint-first only, and the user-set city wins over the GPS-seeded city. ORCH-0839-A CI gate stays 5/5 PASS.

### Sim-gate exemption
The change under test is a **pure-logic TypeScript utility** (`discoverEventsCache.ts` — cache-key construction, freshness math, fetch-mode decision, resolved-city seed) plus its wiring in `DiscoverScreen.tsx`. The behavioral contract being regressed (key uniqueness, never-short-circuit, mode decision, seed staleness) is fully exercised by deterministic unit tests with no RN/runtime dependency. Per Phase 0.A exemptions (type/logic-only, no new UI surface), source-level verification + unit-level proof is sufficient for THIS QA scope. The live cold-open A/B *timing* on a logged-in device (does re-open paint instantly vs. skeleton) remains the implementor-noted manual eyeball for Seth on the Galaxy A72 reproducer — that is a perceived-latency confirmation, not a correctness gate, and does not block this verdict.

---

## Adversarial regression test

- **Path:** `app-mobile/src/utils/__tests__/discoverEventsCache.adversarial.test.ts` (NEW — tester-authored, 6 cases)
- **Runner:** `/Users/sethogieva/.deno/bin/deno test --allow-env --no-check src/utils/__tests__/discoverEventsCache.adversarial.test.ts`
- **Different angle from the implementor's happy-path suite:** the implementor proves the nominal contract (one segment change misses, order-independence, a TTL boundary). This suite attacks the **leakage + staleness EDGES** — the failure class that forced ORCH-0839-A to delete the prior cache.

### Cases
- **ADV-1a** — Each ORCH-0824 facet alone (partyTypes / vibeTags / musicGenres) *and* date *and* genre, changed in isolation, produces a key that MISSES the base slot. Asserts the actual `readDiscoverCache(...) === null` (the leakage path), not merely key inequality.
- **ADV-1b** — A **superset** array (`["afro","house"]`) must not be served the **subset** (`["afro"]`) slot's cards. (Inverse of the implementor's order-independence case — proves broader queries don't collide onto narrower ones.)
- **ADV-1c** — **Separator-injection:** delimiter-bearing facet values (`partyTypes:["a|b"]` vs `partyTypes:["a"],vibeTags:["b"]`; `cityName:"A,B"` vs `cityName:"A",segment:"B"`) must not collapse two distinct signatures onto one key, and a cross-read under the colliding-looking key returns null. (Classic under-specified-key failure door.)
- **ADV-2a** — **Moved-city staleness:** when GPS resolves to a different city (Raleigh→Durham), the new authoritative city keys differently and the Durham query MISSES — the seeded/cached Raleigh cards are never cross-served as Durham's authority.
- **ADV-2b** — Same-city GPS jitter still maps to ONE events slot (coord rounding does not fragment a single city into many slots).
- **ADV-3** — `decideDiscoverFetchMode` full truth table including the adversarial 4th row `{hasUsableQuery:false, hasFiredInitial:true}` → `"skip"` (usable-query is the dominant gate; a stale fired-flag can't resurrect a query-less fetch).

### Run output
```
running 6 tests from ./src/utils/__tests__/discoverEventsCache.adversarial.test.ts
ADV-1 each ORCH-0824 facet alone misses the base slot (no C-1 leakage) ... ok
ADV-1 a SUPERSET array must not be served the SUBSET's cached cards ... ok
ADV-1 separator-injection: delimiter-bearing facet values must not collide two distinct signatures ... ok
ADV-2 moved-city: new authoritative city keys differently — old cards cannot be cross-served ... ok
ADV-2 same-city tiny GPS jitter still keys to the SAME city slot (coord-rounding does not fragment) ... ok
ADV-3 decideDiscoverFetchMode full truth table (skip dominates no-query) ... ok
ok | 6 passed | 0 failed
```

### Combined with implementor suite
```
deno test ... discoverEventsCache.test.ts discoverEventsCache.adversarial.test.ts
ok | 15 passed | 0 failed (86ms)   # 9 implementor + 6 adversarial
```

### Fails-on-revert (the C-1 regression)
Simulated the exact ORCH-0839-A C-1 failure: reverted `buildDiscoverCacheKey` to an **under-specified key** that drops the three ORCH-0824 facets (partyTypes/vibeTags/musicGenres) — the precise under-specification that caused cross-filter leakage. Result:
```
FAILED | 3 passed | 3 failed
  ✗ ADV-1 each ORCH-0824 facet alone misses the base slot (no C-1 leakage)
  ✗ ADV-1 a SUPERSET array must not be served the SUBSET's cached cards
  ✗ ADV-1 separator-injection: ... distinct signatures
```
The util was then restored **byte-identical** to the committed version (`diff` clean, `git status` clean). The adversarial suite genuinely fails when the C-1 under-specified key returns.
- **Revert anchor (HEAD under test):** `a0dcc9a5ff7751c7ff3befde9b88688a5af13e40`
- **Branch point (main):** `f094946...` (ORCH-0994 `2a30c8edc`)

---

## Independent code verification (read the actual code)

| Check | Result | Evidence |
|---|---|---|
| Cache key includes EVERY server-read facet | **PASS** | `DiscoverScreen.tsx:1224-1235` `cacheSignature` carries cityName/Lat/Lng, gpsLat/Lng, date, segment, genre, partyTypes, vibeTags, musicGenres. The merged request body `DiscoverScreen.tsx:1286-1302` reads exactly: city, segmentSlug, genreSlugs (←genre), localStartEndDateTime (←date), partyTypeSlugs, vibeTagSlugs, musicGenreSlugs. One-to-one match — no server facet missing from the key. |
| Fetch ALWAYS runs (never short-circuits) | **PASS** | `decideDiscoverFetchMode` returns immediate/debounced/skip purely on `hasUsableQuery`+`hasFiredInitial`, never on cache presence (`discoverEventsCache.ts:137-143`). The fetch-trigger effect reads the cache only to PAINT (`DiscoverScreen.tsx:1424-1437`, `1448-1457`) then unconditionally `void fetchNightOutEvents()` (`1439`, `1459`). `skipCache` is an explicit no-op (`void skipCache`, `1272`). Both fetch branches write the cache AFTER the network resolves (`1323`, `1351`). |
| ORCH-0839-A identifiers NOT reintroduced | **PASS** | `grep` for `NightOutCache / loadNightOutCache / saveNightOutCache / clearNightOutCache / nightOutCacheKey / cached.venues.length > 0` in `DiscoverScreen.tsx` → none in code. The names appear only inside a documentation comment in the new util (`discoverEventsCache.ts:28-30`), which the gate does not scan. |
| ORCH-0839-A CI gate still passes | **PASS** | `node scripts/ci/orch-0839-a-mobile-cache-removed.mjs` → **5/5 PASS** (T-C0..T-C4): DiscoverScreen free of all forbidden identifiers + the `cached.venues.length > 0` predicate, F-4 marker comment present, deleted ORCH-0835 check absent. |
| User-SET city wins over seeded GPS city | **PASS** | `effectiveCity = selectedCity ?? gpsDefaultCity` (`DiscoverScreen.tsx:1046`). The resolved-city seed only lazy-inits `gpsDefaultCity` (`1028-1041`); the reverseGeocode effect early-returns on `selectedCity` (`1134`). |
| Moved-user seed staleness handled | **PASS** | reverseGeocode effect drops the stale seed when the now-known coords don't match the ~110m bucket (`readResolvedDiscoverCity` → `setGpsDefaultCity(null)`, `1143-1146`); always re-geocodes + overwrites + persists (`1150-1172`). Seed is paint-first only; network/geocode stay authoritative. ADV-2a proves the events key follows the NEW city so old cards can't be cross-served. |
| Array set-semantics in key | **PASS** | `buildDiscoverCacheKey` sorts each array before joining (`discoverEventsCache.ts:73`) → pill order-independent; distinct SETS still distinct (ADV-1b proves superset≠subset). |

### tsc / lint (touched files)
- `tsc --noEmit` on `discoverEventsCache.ts` (isolated, strict, esnext) → **0 errors**. Implementor noted (and re-confirmed) the repo-wide `tsc` carries pre-existing baseline errors unrelated to these files (Deno test files seen by tsc, `packages/phone-input` missing react types, board/payment legacy errors); this ORCH adds zero new tsc errors in touched files.
- `eslint` on `discoverEventsCache.ts` → clean. On `discoverEventsCache.adversarial.test.ts` → only the project-conventional `import/no-unresolved` on the `https://deno.land/std@.../asserts.ts` URL, which is identical for the implementor's own `discoverEventsCache.test.ts` and the precedent sibling `friendMenu.test.ts`/`friendMenu.adversarial.test.ts`. eslint exits 0; Deno test files are outside the RN lint/CI graph by established convention. Unused-import warning fixed (removed unused `assert`).

---

## Constitution spot-check (relevant rules)
- **#2 One owner per truth** — PASS. The cache is a paint-first hint; the server stays the single authority (network always overwrites). No competing owner of the card arrays.
- **#8 Subtract before adding** — PASS. Reuses the existing imperative fetch body; adds a small, auditable cache module rather than layering a second fetch path.
- **#9 No fabricated data** — PASS. Cache only ever holds real prior network results keyed to their exact query; a moved/changed query MISSES and refetches rather than fabricating.
- **#14 Persisted-state startup** — N/A (in-memory only, process-lifetime; no AsyncStorage, no hydration gate needed — this is precisely the property that avoids the C-1 stale-on-disk surface).

## P4 — praise
The full-signature-key + never-short-circuit + in-memory-only triad is the correct structural answer to C-1: it makes cross-filter leakage *impossible by construction* rather than guarding against it with a predicate. The `decideDiscoverFetchMode` extraction as a pure function is exactly the right testability move.

## Discoveries for orchestrator
- None. (Implementor proposes invariant `I-PROPOSED-DISCOVER-INMEM-CACHE-FULL-SIGNATURE`; orchestrator may register it — the adversarial suite is a ready CI anchor for it.)

## Regression-test gate (ORCH-0840)
1. Tester adversarial test committed, attacks a DIFFERENT angle (leakage/staleness edges) — ✅ `discoverEventsCache.adversarial.test.ts`, fails-on-revert proven against the C-1 under-specified key.
2. Implementor happy-path test exists, green, fails-on-revert cited by implementor at `2a30c8edc` (mode) / `61ed534c5` (seed) — ✅ `discoverEventsCache.test.ts`, 9/9.
3. Both files were ADDED on this branch (not on main) so they ship together in the closing PR. The cache test file is new in this branch → no `[TEST-MOD-APPROVED]` tag required (no test-file lines deleted).
