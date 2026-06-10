# IMPLEMENTATION — ORCH-1107: Companion-stops + Picnic-grocery off Google onto scored place_pool

**Date:** 2026-06-10 · **Skill:** mingla-implementor (Claude) · **Branch:** `ORCH-1107-companion-picnic-place-pool` · **Worktree:** `~/Desktop/mingla-orchs/ORCH-1107-[companion-picnic-place-pool]/` · **Commit:** `7eda94e2521c20f977c9180a31fcb7f299f488c7` (amended in REWORK to carry the hermetic test) · **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1107_COMPANION_PICNIC_OFF_GOOGLE_ONTO_PLACE_POOL.md` (binding, with SPEC AMENDMENT 1).

> **REWORK (orchestrator REVIEW = NEEDS WORK, 2026-06-10).** The single defect was a NON-HERMETIC regression test: on a clean `deno test --allow-all <path>` with NO ambient env, the static SUT imports ran `createClient(SUPABASE_URL ?? '', …)` at module load and threw `supabaseUrl is required` before any test ran (the prior "14/0 green" only held because the shell had ambient Supabase env). FIX (option A): the test now sets dummy `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ORCH_TEST_NO_SERVE` BEFORE the SUT modules load and DYNAMICALLY `await import(...)`s them (static imports hoist, so they had to become dynamic). The two approved edge functions and the C7 allowlist are UNCHANGED; only the test file was updated and the commit re-amended. Test now passes deterministically with ZERO ambient env (verified under `env -i`).

---

## 1. Summary

Take-a-Stroll (companion stops) and Picnic-Dates (grocery stop) were the only consumer-runtime Google dependency: both edge functions called `batchSearchPlaces` → live Google Places `places.googleapis.com/v1/places:searchNearby`, read `GOOGLE_MAPS_API_KEY`, did no `place_pool` read, and returned raw Google results with a hardcoded Unsplash placeholder image.

Both functions now source from the scored, servable `place_pool` via the `query_servable_places_by_signal` RPC — the same RPC `discover-cards` uses (per SPEC Amendment 1, which superseded the original `fetch_local_signal_ranked` choice). The RPC enforces `is_servable` + `is_active` + `place_scores.score >= p_filter_min` + real `stored_photo_urls` + a haversine radius, so the three serving gates come for free. The Google API-key read, the 500 "not configured" guard, the `batchSearchPlaces` import, and the Unsplash placeholder are all deleted. The client contract is unchanged — same response shape, new source. When the RPC returns 0 rows, the existing graceful-empty body is returned (`strollData: null` / `picnicData: null`) — no Google fallback, no throw.

---

## 2. SPEC success-criteria coverage

All satisfied at commit `7eda94e2`.

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | `grep GOOGLE_MAPS_API_KEY` over both functions → zero | ✓ | grep exit 1 (no match) — §“Grep proofs” below |
| SC-2 | No `googleapis.com` reference in either function | ✓ | grep exit 1 (no match) |
| SC-3 | Both functions call `query_servable_places_by_signal` | ✓ | grep shows the RPC call in each `index.ts` |
| SC-4 | companion: `p_signal_id='casual_food'`, `p_filter_min=120`, `p_radius_m=maxDistance` (default 500), `p_limit=10`, sort by `signal_score` desc, top 1 | ✓ | `buildCompanionRpcParams` + `findCompanionStops`; test CP-01/CP-02 |
| SC-5 | picnic: `p_signal_id='groceries'`, same geo/limit pattern | ✓ | `buildGroceryRpcParams` + `findGroceryStore`; test GR-01 |
| SC-6 | Row → existing client shape (id, name, location, address, rating, reviewCount, imageUrl, placeId, type) | ✓ | `mapServableRowToCompanionStop` / `mapServableRowToGroceryStore`; test CP-03/GR-02 |
| SC-7 | `imageUrl = stored_photo_urls[0]`; Unsplash placeholder deleted | ✓ | test CP-03/CP-04/GR-02; grep `unsplash.com` exit 1 |
| SC-8 | Removed `GOOGLE_MAPS_API_KEY` read + 500 guard + unused `batchSearchPlaces` import from both | ✓ | grep; test NG-01 |
| SC-9 | Graceful empty on 0 rows (`strollData:null` / `picnicData:null`), no Google fallback, no throw | ✓ | handler branch retained; test NG-03 |
| SC-10 | Client untouched (`stopReplacementService`, `ExpandedCardModal`, `CompanionStopsSection`) | ✓ | diff is backend-only (4 files, all under `supabase/functions/` + the gate) |
| SC-11 | Happy-path regression test green + fails-on-revert (HERMETIC) | ✓ | 14/14 pass with ZERO ambient env (`env -i`); revert → CP-04/NG-01 FAIL; restore → pass |
| SC-12 | `deno check` clean on both files | ✓ | §Gates |
| SC-13 | C7 no-new-backend-files gate passes (allowlist added same commit, COMMS-0002) | ✓ | gate `# All checks PASS` (4 files changed) |

---

## 3. Files changed

| File | Type | ~Lines |
|------|------|--------|
| `supabase/functions/get-companion-stops/index.ts` | modify | ~ +95 / −75 (net ~ +20; Google path removed, RPC path + 2 exported helpers + serve-seam added) |
| `supabase/functions/get-picnic-grocery/index.ts` | modify | ~ +90 / −95 (net ~ −5; Google search/filter block removed, RPC path + 2 exported helpers + serve-seam added) |
| `supabase/functions/__tests__/orch_1107_companion_picnic_place_pool.test.ts` | new (hermetic in REWORK) | +210 |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | modify | +12 (ORCH_1107_BACKEND_ALLOWLIST const + union spread) |

`git diff --name-only origin/main...HEAD` returns exactly these four. The untracked SPEC file under `Mingla_Artifacts/specs/` is orchestrator-owned and intentionally NOT staged.

---

## 4. Data-model changes applied

None. No migration, no schema/RLS/index change. The `query_servable_places_by_signal` RPC already exists and is in production use by `discover-cards`.

---

## 5. Edge functions touched

| Function | Change | `verify_jwt` to preserve |
|----------|--------|--------------------------|
| `get-companion-stops` | Google→RPC re-source | No `config.toml` `[functions.*]` override present → default (`verify_jwt = true`). Unchanged by this ORCH — code path untouched; only the data source changed. |
| `get-picnic-grocery` | Google→RPC re-source | Same — default, unchanged. |

Note: these functions read no auth header in their bodies and use the service-role client for the RPC (matching the prior `supabaseAdmin` usage), so the JWT posture is identical pre/post. Edge deploy is orchestrator/operator-owned from MERGED main — see §11.

---

## 6. Regression tests added

**Path:** `supabase/functions/__tests__/orch_1107_companion_picnic_place_pool.test.ts` (14 Deno tests).

Coverage: companion RPC params (CP-01/02), companion row→shape + imageUrl-from-`stored_photo_urls[0]` + null-on-no-photos (CP-03/04), grocery RPC params (GR-01), grocery row→shape + distance + types (GR-02), handler 400 validation wiring (HW-01/02), and per-function source guards — zero Google references / sources only the RPC / graceful-empty branch present (NG-01/02/03 × 2 functions).

**Run command (HERMETIC — no env exports required).** The test is now self-contained: it sets dummy `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ORCH_TEST_NO_SERVE` at the very top, THEN dynamically `await import(...)`s the two SUT modules so `createClient()` constructs after the env exists (static ES imports hoist above body code, so the imports had to become dynamic). It passes on a clean invocation with zero ambient Supabase env:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1107-[companion-picnic-place-pool]"
~/.deno/bin/deno test --allow-all \
  supabase/functions/__tests__/orch_1107_companion_picnic_place_pool.test.ts
```

Passing output on a NO-ambient-env shell (`env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY …`) AND under a fully cleared environment (`env -i HOME=$HOME …`): `ok | 14 passed | 0 failed`.

Defect this REWORK fixed: previously the test STATICALLY imported the two `index.ts` modules. With no ambient env, the module-load `createClient(SUPABASE_URL ?? '', …)` at `get-companion-stops/index.ts:13:23` threw `error: (in promise) Error: supabaseUrl is required.` as an UNCAUGHT error before any test ran — so the orchestrator's independent clean run failed (`0 passed | 1 failed`), even though a shell with ambient Supabase env reported `14/0`. The fix is the dummy-env-then-dynamic-import pattern; a 50 ms `setTimeout` drain after the imports settles the Supabase client's construction-time timer so Deno's leak sanitizer does not attribute it to the first test.

**fails-on-revert verified at `7eda94e2521c20f977c9180a31fcb7f299f488c7`.** True line-edit of the core fix line in `get-companion-stops/index.ts` — `imageUrl: storedPhotos[0] ?? null` reverted to the old `imageUrl: storedPhotos[0] ?? "https://images.unsplash.com/photo-placeholder"` — caused **CP-04 and NG-01 to FAIL** (CP-04 = "no-stored-photos yields null imageUrl, no fabricated placeholder"; NG-01 = "ZERO Google/Unsplash references in source"); result `12 passed | 2 failed`. Restoring the fix returned the suite to `14 passed | 0 failed` under `env -i`. The test exercises the actual exported handler-helper logic, not a parallel re-implementation. (CP-03 passes in both states because its row carries photos, so the `?? unsplash` fallback branch is never reached — CP-04 + NG-01 are the load-bearing fails-on-revert cases.)

A test seam (`ORCH_TEST_NO_SERVE`) is present in both modules: `if (!Deno.env.get("ORCH_TEST_NO_SERVE")) serve(handleRequest);`. The test now SETS this flag itself (no longer requires it on the command line) so the dynamic import does not bind a listening socket. It does NOT alter edge-function runtime behavior (the env var is never set in production). The handler body is exported as `handleRequest(req)` so the 400-validation path is directly testable.

---

## 7. Old → New receipts

### get-companion-stops/index.ts
**What it did before:** Read `GOOGLE_MAPS_API_KEY`; on missing key returned 500 "Google Maps API key is not configured"; `findCompanionStops` called `batchSearchPlaces(... GOOGLE_API_KEY ...)` → live Google `searchNearby` across 9 companion types, merged raw results, hardcoded `imageUrl` to an Unsplash URL, sorted by rating, returned top 1 in the stroll-timeline shape.
**What it does now:** No Google key/guard/import. `findCompanionStops` calls `supabaseAdmin.rpc('query_servable_places_by_signal', { p_signal_id:'casual_food', p_filter_min:120, p_lat, p_lng, p_radius_m:maxDistance, p_limit:10 })`, sorts the returned servable rows by `signal_score` desc, maps the top 1 via `mapServableRowToCompanionStop` (`imageUrl = stored_photo_urls[0] ?? null`), and returns the identical stroll-timeline shape. 0 rows / RPC error → `[]` → existing `strollData:null` body. Handler extracted to exported `handleRequest`; `serve()` gated behind `ORCH_TEST_NO_SERVE`.
**Why:** SC-1..SC-9 — remove the only consumer-runtime Google dependency; serve from the scored, servable place_pool with real photos.
**Lines changed:** ~ +95 / −75.

### get-picnic-grocery/index.ts
**What it did before:** Read `GOOGLE_MAPS_API_KEY`; 500 guard on missing key; `findGroceryStore` called `batchSearchPlaces(... Google ...)`, filtered raw results to grocery-related types/keywords, hardcoded the Unsplash `imageUrl`, computed haversine distance, sorted by distance-then-rating, returned the closest in the picnic shape.
**What it does now:** No Google key/guard/import. `findGroceryStore` calls the RPC with `p_signal_id='groceries'` (same geo/limit pattern), maps rows via `mapServableRowToGroceryStore` (`imageUrl = stored_photo_urls[0] ?? null`; preserves the `types[]` + numeric `distance` fields the picnic shape carries), and keeps the prior closest-then-rating preference among the already-gated servable rows. 0 rows / RPC error → `null` → existing `picnicData:null` body. Handler extracted to exported `handleRequest`; `serve()` gated behind `ORCH_TEST_NO_SERVE`. The haversine `calculateDistance` helper is retained (now used by the mapper for the response `distance` field).
**Why:** SC-1..SC-9 — same de-Google + scored-pool re-source for Picnic Dates.
**Lines changed:** ~ +90 / −95.

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
**What it did before:** C7 `no-new-backend-files` flagged any `supabase/functions/**` or `supabase/migrations/**` file in the `origin/main...HEAD` diff not present in the union ALLOWLIST.
**What it does now:** Adds `ORCH_1107_BACKEND_ALLOWLIST` (the 2 edge fns + the 1 test) and spreads it into the union. C7 now PASSES on this ORCH's diff.
**Why:** SC-13 / COMMS-0002 — editing existing backend files still trips C7 (it flags modified, not just new); the spec directs adding this allowlist in the SAME commit.
**Lines changed:** +12.

---

## 8. Cross-surface impact

| Surface | Affected | Detail / reason |
|---------|----------|-----------------|
| Consumer iOS | YES | Take-a-Stroll / Picnic card expand now shows a servable, scored, real-photo place_pool spot instead of a raw Google result with an Unsplash placeholder. Shared backend — automatic parity. |
| Consumer Android | YES | Same as iOS — automatic parity (shared edge functions, client untouched). |
| Buyer / anonymous Web | NO | These edge functions serve the consumer deck-expand path only; not a buyer-web route. |
| Business iOS | NO | Not a business-app surface. |
| Business Android | NO | Not a business-app surface. |
| Admin Web (adjacent) | NO | No admin code touched. |
| Business Web preview (adjacent) | NO | No business code touched. |

Parity is automatic (single shared backend; no client changes).

---

## 9. Smoke result

- `deno check` clean on the test file (and on `get-companion-stops/index.ts`, `get-picnic-grocery/index.ts`, unchanged).
- Regression suite (HERMETIC): `14 passed | 0 failed` on a NO-ambient-env shell and under `env -i HOME=$HOME` (fully cleared environment) — no uncaught error.
- fails-on-revert at `7eda94e2`: reverting the companion `imageUrl` fix → `12 passed | 2 failed` (CP-04 + NG-01); restore → `14 passed | 0 failed`.
- C7 strict-grep gate: `# All checks PASS` (4 files changed, all allowlisted) — re-run after the REWORK amend.
- **Not run:** live device sim (iOS/Android) of the Take-a-Stroll / Picnic expand — this is backend-only and (per SPEC Amendment 1 operational note) will only return rows in a city once `run-signal-scorer` has populated `place_scores` there. Runtime device verification of the expand-card render is the tester's TEST phase (and depends on scorer-populated data, a separate operational task overlapping COMMS-0018 / META-ORCH-1062). Source + contract + RPC params are verified; the device render is **implemented, unverified** pending tester device-fire + scorer data.

### Grep proofs (from the worktree, post-commit)

```
$ grep -rn "GOOGLE_MAPS_API_KEY\|googleapis" supabase/functions/get-companion-stops supabase/functions/get-picnic-grocery
# (no output) exit=1   ← ZERO

$ grep -rni "images.unsplash.com\|unsplash.com" supabase/functions/get-companion-stops supabase/functions/get-picnic-grocery
# (no output) exit=1   ← placeholder URL gone

$ grep -rn "batchSearchPlaces" supabase/functions/get-companion-stops supabase/functions/get-picnic-grocery
# (no output) exit=1   ← import removed from both

$ grep -rn "query_servable_places_by_signal" supabase/functions/get-companion-stops supabase/functions/get-picnic-grocery
supabase/functions/get-companion-stops/index.ts:173:      "query_servable_places_by_signal",
supabase/functions/get-picnic-grocery/index.ts:192:      "query_servable_places_by_signal",
# present in BOTH
```

---

## 10. Known issues / deferred

- **`_shared/placesCache.ts` (`batchSearchPlaces`) is now orphaned.** After this change, no edge function imports it (only the helper definition + this test's negative-assertion string reference it). The SPEC explicitly says do NOT delete the shared helper. Left untouched. Flagged for the orchestrator as a possible future cleanup once confirmed truly dead.
- **Data dependency (NOT a code defect, per SPEC Amendment 1):** companion/picnic will return rows in a city only after `run-signal-scorer` has populated `place_scores` for that city. ORCH-1107 ships the correct code; data population is Seth's operational task (overlaps COMMS-0018 / META-ORCH-1062 scorer-invoke fix).
- **Test env requirement: NONE (fixed in REWORK).** The regression test is now hermetic — it sets the dummy env itself and dynamic-imports the SUT, so `deno test --allow-all <path>` passes with zero ambient env. No command-line env exports are required (this was the orchestrator's NEEDS-WORK defect).
- No `[TRANSITIONAL]` code. The `ORCH_TEST_NO_SERVE` seam is a permanent, production-inert test affordance, not transitional debt.

---

## 11. Operator action required

- **No migration.** Nothing to `db push`.
- **Edge-function deploy (orchestrator/operator-owned, from MERGED main — after REVIEW + TEST + merge):**
  - `get-companion-stops` (`verify_jwt` = default/true — preserve)
  - `get-picnic-grocery` (`verify_jwt` = default/true — preserve)
  - Deploy from merged `main`, NOT a worktree (clobber risk per memory rule).
- **Data:** run `run-signal-scorer` for the target launch cities so `place_scores` is populated, or companion/picnic will correctly return graceful-empty there.

---

## 12. Discoveries for Orchestrator

1. **`_shared/placesCache.ts` is now an orphan** (no remaining edge-function importer). Candidate for a future dead-code removal ORCH once confirmed unused program-wide. Not removed here (out of ORCH-1107 scope; SPEC said keep the shared helper).
2. **C7 flags MODIFIED backend files, not just new ones** — confirmed by reading the gate. Any ORCH that edits an existing `supabase/functions/**` file needs an allowlist entry, not only ORCHs that add new files. (Already handled here via `ORCH_1107_BACKEND_ALLOWLIST`; noting for general awareness.)
3. **No new COMMS entry written** — no cross-ORCH discovery beyond what COMMS-0002 (no-new-backend-files gate) and COMMS-0018 (scorer population) already cover, both of which were factored.

---

## Handoff

Route back to **mingla-orchestrator** for REVIEW, then **mingla-tester** dispatch. Working tree: `~/Desktop/mingla-orchs/ORCH-1107-[companion-picnic-place-pool]/` on branch `ORCH-1107-companion-picnic-place-pool`, commit `7eda94e2` (amended in REWORK; the regression test is now hermetic). Do NOT deploy/merge/close. The tester adds the adversarial test (e.g. RPC-error tolerance / 0-row graceful-empty through the live RPC mock, and device-fire of the expand-card render against scorer-populated data).
