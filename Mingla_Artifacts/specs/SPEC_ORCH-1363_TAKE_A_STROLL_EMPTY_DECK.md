# SPEC — ORCH-1363: "Take a Stroll" curated deck returns empty ("No spots match right now")

- **Phase:** SPEC (contract only — NO product-code change, NO migration, NO deploy)
- **Date:** 2026-07-12
- **Author:** mingla-forensics
- **Source of truth:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1363_TAKE_A_STROLL_EMPTY_DECK.md` (PROVEN / CONFIRMED, live-fired against PROD)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1363-[stroll-empty-deck]/` on branch `ORCH-1363-stroll-empty-deck`
- **Scope file (single):** `supabase/functions/generate-curated-experiences/index.ts` (+ one new hermetic test file). NO mobile touch required (proven in §3, Surface table + §4.Component).

---

## 1. Executive summary

Selecting the **Take a Stroll** curated vibe returns zero cards with the copy **"No spots match right now"** for users near several live cities on the default preference (**walking, 30-min**). The deck is not empty for lack of parks — London alone has 384 reachable scenic parks and 2,275 casual-food places. It is empty because of a **selection bug** in the curated deck assembler.

In `generate-curated-experiences/index.ts`, the STANDARD (non-reverse-anchor) branch pins the first stop of every combo to `available[0]` — the single top-`scenic`-ranked nature place. Take-a-Stroll's stop-1 category is the constant `nature` anchor across all three combos, so **every combo picks the same top park**. When that one park fails the post-assembly travel-time gate (`firstStop.travelTimeFromUserMin > travelConstraintValue * 1.5`, index.ts:1160-1166), the standard branch simply `continue`s with **no mechanism to try the next candidate** → 0 cards → `emptyReason:'pool_empty'`. The ORCH-0677 `failedAnchorIds` skip that would advance past a dead pick exists **only** for reverse-anchor types (guarded by `hasReverseAnchor`). London proof: top scenic = Queen Mary's Rose Gardens @ 48.7-min walk (past the 45-min gate); St James's Park @ 11-min walk sits unused. Driving mode (tiny travel times) builds 10 cards; walking builds 0.

**The fix (approved design):**
1. **Core** — at the first-stop pick, pre-filter `available` to places reachable within the same gate the post-assembly check enforces, then take the top-ranked reachable one. Fall through to today's `available[0]` only when none are reachable. Uses cheap local math (`estimateTravelMinutes`/`haversineKm`, already imported) — zero API cost.
2. **Truthfulness** — when first-stop candidates existed but none passed the gate, the standard-branch empty verdict becomes `no_viable_anchor` (matching the reverse-anchor branch and the mobile copy contract) instead of the hard-coded `pool_empty`.
3. **Deck quality** — the fix operates on the already-deduped, rank-descending `available` list, so card-to-card park rotation and the 3-meal-combo cycle are preserved.

---

## 2. Scope & non-goals

### In scope
- `supabase/functions/generate-curated-experiences/index.ts` — the STANDARD-branch first-stop selection (index.ts:1119-1124) and the standard-branch empty-summary verdict (index.ts:1228-1235), plus one new small exported pure helper in the same file.
- One new hermetic Deno test file: `supabase/functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts`.

### Non-goals (explicitly NOT touched — and why)
- **Supply / seeding / `admin-seed-places`** — supply is proven healthy in every live market (investigation §8); this is not a supply problem.
- **`fetch_local_signal_ranked` RPC / any migration / scoring migrations** — the RPC's INNER JOIN on `scenic` drops zero places (investigation Q3); no schema change is warranted.
- **`get-companion-stops`** — that builds the in-card stroll ROUTE panel, not the deck (investigation §7). Out of scope.
- **The 45-min travel gate value (`travelConstraintValue * 1.5`)** — unchanged. The fix aligns selection to the existing gate; it does not move the gate.
- **The combos, the ranking signals, the fetch radius (`radiusKmForConstraint(...,1.0)`, index.ts:890)** — unchanged. (F-2 flagged the radius↔gate mismatch as a design smell; the pre-filter neutralizes it at selection time without touching the radius.)
- **Determinism** — no `Math.random` may enter selection. The pre-filter is pure and order-preserving; collab decks stay reproducible.
- **The reverse-anchor branch** — already protected by ORCH-0677 `failedAnchorIds` (decision in §4.A). NOT modified.
- **ORCH-1364 (romantic thinness)** — out of scope; do not fold in. (Investigation D-3 noted romantic thins to 1 card at London walking/30; that is a separate resilience item.)

### Assumptions
- `categoryPlaces[catId]` is returned **rank-descending** by `fetchSinglesForSignalRank` (top `scenic` first). The `.filter()` at index.ts:1099-1108 preserves that order, so `available` and any order-preserving subset of it are rank-descending. (Confirmed: investigation F-1 evidence + the RPC orders by rank signal.)
- Every fetched place row carries numeric `.lat` / `.lng` (the same fields `buildCardStop` reads as `card.lat`/`card.lng`, index.ts:737-741, and the reverse-anchor branch reads as `anchor.lat ?? 0`, index.ts:1032).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

The bug is server-side (one edge function). Both affected surfaces consume the identical `generate-curated-experiences` output, so parity is **automatic** (shared server code).

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **YES** | Take-a-Stroll returns ≥1 card at London walking/30 (first stop within the gate); genuinely-impossible requests show the honest empty state, not a fabricated card | none (server-only) | Automatic (server) |
| 2 | Consumer Android (`app-mobile/` Android) | **YES** | Same as iOS | none (server-only) | Automatic (server) |
| 3 | Buyer/anonymous Web | Not covered | No curated deck exists on this surface | — | — |
| 4 | Business iOS | Not covered | No curated deck on business | — | — |
| 5 | Business Android | Not covered | No curated deck on business | — | — |
| 6 | Admin Web (adjacent) | Not covered | No curated deck | — | — |
| 7 | Business Web preview (adjacent) | Not covered | No curated deck | — | — |

**Mobile-copy decision (step 2 verification — no mobile touch needed):** The consumer empty-copy branch renders `all_closed_at_time` → "Everything's closed right now" and **every other reason** (`pool_empty`, `no_viable_anchor`, `pipeline_error`) → the generic "No spots match right now" (`SwipeableCards.tsx:2513-2518`; `RecommendationsContext.tsx` passes `curatedEmptyReason` through unchanged; `CuratedEmptyReason` union already includes `no_viable_anchor`, `curatedExperience.ts:67`). Therefore switching the standard-branch verdict from `pool_empty` → `no_viable_anchor` renders the **same sensible** "No spots match right now" copy with **no client change**. The verdict change is a truthfulness/telemetry alignment (standard branch now speaks the same honest language as the reverse-anchor branch); it does not alter any rendered string. **No `app-mobile` file is in the allowlist.**

---

## 4. Layered specification

Only the **Edge function** layer is affected. Database, Service, Hook, Component (mobile), and Realtime layers are unaffected (see §3).

### 4.A — Core fix: reachability pre-filter at the first-stop pick

**Locus:** `supabase/functions/generate-curated-experiences/index.ts:1119-1124` (STANDARD branch first non-optional stop).

**New exported pure helper** (add adjacent to `selectBlendedStop`, same file — keeps the change single-file and makes the logic hermetically testable, mirroring the existing exported-helper test pattern):

```
// ORCH-1363: pick the highest-RANKED first stop that is REACHABLE from the user
// within the same gate the post-assembly travel check enforces (travelConstraintValue*1.5).
// `available` MUST already be rank-descending + deduped (caller passes the filtered list).
// If NONE are reachable, returns available[0] (today's behavior) so a genuinely-
// impossible request still ends honestly via the post-assembly gate + no_viable_anchor.
// PURE: local haversine + travel-estimate math only. No Math.random. No I/O.
export function pickReachableFirstStop(
  available: any[],
  userLat: number,
  userLng: number,
  travelMode: string,
  travelConstraintValue: number,
): any | null {
  if (available.length === 0) return null;
  const gateMin = travelConstraintValue * 1.5;
  const reachable = available.filter((p) =>
    estimateTravelMinutes(haversineKm(userLat, userLng, p.lat ?? 0, p.lng ?? 0), travelMode) <= gateMin
  );
  return (reachable.length > 0 ? reachable : available)[0];
}
```

**Before (index.ts:1121-1124):**
```
const isFirstMainStop = stops.filter(s => !s.optional).length === 0;
const place = isFirstMainStop
  ? available[0]
  : selectBlendedStop(available, prevLat, prevLng, clampedRadius);
```

**After:**
```
const isFirstMainStop = stops.filter(s => !s.optional).length === 0;
const place = isFirstMainStop
  ? pickReachableFirstStop(available, lat, lng, travelMode, travelConstraintValue)
  : selectBlendedStop(available, prevLat, prevLng, clampedRadius);
```

**Binding requirements:**
- The gate expression MUST be **exactly** `travelConstraintValue * 1.5` and the travel estimate MUST be `estimateTravelMinutes(haversineKm(userLat, userLng, p.lat, p.lng), travelMode)` — byte-for-byte the same computation the post-assembly gate applies to `firstStop.travelTimeFromUserMin` (index.ts:1161 gate = `> travelConstraintValue * 1.5`; buildCardStop computes travel-from-user as `estimateTravelMinutes(haversineKm(userLat,userLng,lat,lng), travelMode)` at index.ts:740-741). Reachable (`<= gate`) is the exact complement of the post-gate reject (`> gate`), so a reachable pick is guaranteed to pass the post gate.
- Use the **user origin** `lat`/`lng` (the `generateCardsForType` params, index.ts:872-873) — NOT `prevLat`/`prevLng`. (They coincide for stop 1, but `lat`/`lng` is the correct, explicit source matching buildCardStop's `userLat`/`userLng`.)
- `estimateTravelMinutes` and `haversineKm` are already imported (index.ts:6). No new import, no external/API call.
- `available` is passed **as-is** (already deduped against `comboUsedIds` at index.ts:1099-1108 and rank-descending). The pre-filter is order-preserving, so `reachable[0]` = top-ranked reachable place. This preserves rotation (§4.C).
- Fall-through: when `reachable.length === 0`, return `available[0]` — identical to today's behavior so a genuinely-impossible request still assembles the top place, fails the post gate, and empties honestly (now as `no_viable_anchor` — §4.B).

**Reverse-anchor decision (assessed per dispatch):** the reverse-anchor first stop (the anchor, `anchorPlaces[0]`) is **already covered** by ORCH-0677 `failedAnchorIds`: when the anchor fails the post-assembly travel gate at index.ts:1164, it is added to `failedAnchorIds` and the next iteration's `anchorPlaces` filter (index.ts:1016-1017) advances to a different anchor. That advance mechanism already prevents the dead-pick loop for reverse-anchor types (invariant `I-CURATED-FAILED-ANCHOR-IS-USED`). **Decision: DO NOT add the reachability pre-filter to the reverse-anchor branch** — it is redundant with `failedAnchorIds`, and modifying the proven picnic-dates path would widen scope and risk the ORCH-0677 regression class. The pre-filter is applied to the STANDARD branch only.

**Defensive backstop:** the existing post-assembly travel gate (index.ts:1160-1166) is **kept unchanged** as a defense-in-depth check. It is now redundant on the happy path (a reachable pick always passes it) but remains the honest rejection path when `pickReachableFirstStop` falls through to an unreachable `available[0]`.

### 4.B — Truthfulness: honest empty verdict on the standard branch

**Locus:** `supabase/functions/generate-curated-experiences/index.ts:1228-1235` (standard-branch empty summary).

Today the standard branch hard-codes `emptyReason:'pool_empty', candidateAnchorCount:0, failedAnchorCount:0` regardless of whether first-stop candidates existed. Mirror the reverse-anchor branch's honest split (index.ts:1222-1227: `initialAnchorCount === 0 ? 'pool_empty' : 'no_viable_anchor'`).

**Add a first-stop candidate count** near the existing `initialAnchorCount` (index.ts:991-993), computed the same way (first combo, first non-optional slot):
```
const firstStopIdx = typeDef.stops.findIndex(s => !s.optional);
const initialFirstStopCount = !hasReverseAnchor && firstStopIdx >= 0
  ? (categoryPlaces[typeDef.combos[0][firstStopIdx]] || []).length
  : 0;
```

**Before (index.ts:1228-1235):**
```
} else {
  // Standard branch: empty means none of the categories had viable picks.
  summary = {
    emptyReason: 'pool_empty',
    candidateAnchorCount: 0,
    failedAnchorCount: 0,
  };
}
```

**After:**
```
} else {
  // ORCH-1363: honest verdict — if the first-stop category had candidates but
  // none assembled a gate-passing card, say no_viable_anchor (matches the
  // reverse-anchor branch + the mobile CuratedEmptyReason contract); pool_empty
  // only when the first-stop category had zero candidates.
  summary = {
    emptyReason: initialFirstStopCount === 0 ? 'pool_empty' : 'no_viable_anchor',
    candidateAnchorCount: initialFirstStopCount,
    failedAnchorCount: 0, // standard branch has no per-anchor failed set (see §4.A)
  };
}
```

**Binding requirements:**
- `firstStopIdx` for take-a-stroll = 0 (`stops[0]` = Nature, non-optional) → `typeDef.combos[0][0]` = `'nature'` → the count is the number of fetched scenic parks. This is the honest analog of `candidateAnchorCount`.
- `failedAnchorCount` stays `0` for the standard branch — there is no per-anchor failed set here (the approved design is the pre-filter, not a standard-branch failed set). Do NOT invent one.
- `no_viable_anchor` renders the same "No spots match right now" copy on mobile (§3), so this is a truthful-telemetry change with no client-visible string change.

### 4.C — Deck-quality guarantees (preserve + assert)

No code change beyond §4.A/§4.B; these are invariants the fix MUST preserve, and the implementor must assert them (§7, §9):

- **Card-to-card rotation intact.** Each combo iteration recomputes `available` from `comboUsedIds = new Set(globalUsedPlaceIds)` (index.ts:1002) plus prior picks, and a built card's stops are added to `globalUsedPlaceIds` (index.ts:1210-1213). Because `pickReachableFirstStop` filters (order-preserving) the already-deduped `available`, successive cards pick **different** reachable parks: card 1 = reachable park A + brunch, card 2 = reachable park B + casual_food, card 3 = reachable park C + fine_dining, …
- **3 meal combos cycle.** `combos = [['nature','brunch'], ['nature','casual_food'], ['nature','upscale_fine_dining']]` (index.ts:598-602); `buildDeterministicComboList` rotates the food slot (index 1) while the nature anchor (index 0) stays constant (`mainActivitySlotIndex('take-a-stroll') === 1`). The reachable first stop feeds each of the 3 meal styles a valid park.
- **Expected deck shape (London walking/30, post-fix):** ≥1 card; first stop of each card within the 45-min gate; ≥2 distinct first-stop parks across the deck; all 3 meal styles appearable. (Investigation live-fire: pre-fix walking = 0 cards, driving = 10; post-fix walking must be ≥1.)
- **Determinism preserved.** `pickReachableFirstStop` is pure and order-preserving; no `Math.random` enters selection. Collab decks remain reproducible.

---

## 5. Success criteria

- **SC-1** — At London `(51.5072178, -0.1275862)`, `travelMode:'walking'`, `travelConstraintValue:30`, `experienceType:'take-a-stroll'`, the deck returns **≥1** card, and every returned card's first stop has `travelTimeFromUserMin <= 45` (`30 * 1.5`). (Server behavior; identical on Consumer iOS + Android — parity automatic.)
- **SC-2** — In that same London deck, **≥2 distinct** first-stop parks appear across the cards (rotation intact), and across the deck **all three** meal styles (`brunch`, `casual_food`, `upscale_fine_dining`) can appear.
- **SC-3** — `pickReachableFirstStop(available, userLat, userLng, travelMode, travelConstraintValue)`, given a rank-descending list whose `available[0]` is out-of-gate and a lower-ranked entry is in-gate, returns the **in-gate** entry (not `available[0]`). Given all-in-gate, returns `available[0]` (top rank). Given none-in-gate, returns `available[0]` (honest fall-through).
- **SC-4** — When the first-stop category has candidates but none are reachable (genuinely-impossible request), the deck empties with `summary.emptyReason === 'no_viable_anchor'` and `summary.candidateAnchorCount > 0`, and **no card is fabricated** with an out-of-gate first stop. When the first-stop category has zero candidates, `summary.emptyReason === 'pool_empty'`.
- **SC-5** — Driving mode is **not regressed**: at London driving/30, the deck still builds its full set (all candidates in-gate ⇒ `reachable === available` ⇒ `available[0]` unchanged; investigation baseline = 10 cards).
- **SC-6** — Other curated types are **not regressed** at London walking/30 (adventurous, first-date, romantic, group-fun, picnic-dates each still build ≥1 card as in the investigation baseline). Determinism unchanged (same input → same deck).

---

## 6. Invariants

### Preserved
- **`I-CURATED-FAILED-ANCHOR-IS-USED` (ACTIVE, ORCH-0677)** — the reverse-anchor branch is untouched (§4.A decision); the `failedAnchorIds` advance mechanism and its 5 add-sites remain intact. Verified by the existing ORCH-0677 tests + `_lint_invariants.ts` continuing to pass.
- **`I-CURATED-EMPTY-IS-EXPLICIT-VERDICT` (ACTIVE)** — a `summary.emptyReason` is still emitted on every empty deck; §4.B refines the standard-branch value, it does not remove it.
- **`I-CURATED-HOURS-VIA-CANONICAL-READER` / ORCH-1113** — untouched; the `all_closed_at_time` path is unaffected.
- **`I-CURATED-REVERSEANCHOR-NEEDS-COMBOS` (ORCH-0677 D-1)** — untouched; `_lint_invariants.ts` still green.

### New (DRAFT — flips ACTIVE at CLOSE; orchestrator owns the flip)

**`I-PROPOSED-1363-STANDARD-FIRST-STOP-REACHABLE`** (chosen over generalizing `I-CURATED-FAILED-ANCHOR-IS-USED`, because the approved mechanism is a reachability **pre-filter**, not a standard-branch failed-set; a new invariant states the real contract honestly).

- **Rule:** In `generateCardsForType`, the STANDARD (non-reverse-anchor) branch's FIRST non-optional stop MUST be selected from the subset of the deduped, rank-descending `available` list whose estimated travel time from the user — `estimateTravelMinutes(haversineKm(userLat, userLng, p.lat, p.lng), travelMode)` — is `<= travelConstraintValue * 1.5` (the same gate the post-assembly travel check enforces). Only when NO candidate is reachable may it fall back to `available[0]`. The first-stop pick MUST NOT be a bare `available[0]` without the reachability pre-filter. The standard-branch empty verdict MUST be `no_viable_anchor` (not `pool_empty`) whenever the first-stop category had ≥1 candidate.
- **Enforcement (test-enforced):** the hermetic Deno test `supabase/functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts::T-1363-01` exercises the exported `pickReachableFirstStop` and FAILS when the pick is reverted to a bare `available[0]`. (Structural backstop, not the primary enforcement: reverting the fix requires deleting the exported helper, which the test import breaks at compile/collect time.)
- **Regression:** T-1363-01 (below) — PASS with the fix, FAIL on revert.
- **Severity if violated:** S2 (user-visible: a healthy-supply market silently returns an empty curated deck).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-1363-01** (fails-on-revert, implementor, PURE) | Top-ranked first-stop park is out-of-gate; a lower-ranked one is in-gate (modeled on real London: Queen Mary's @ 48.7-min walk as `available[0]`, St James's @ 11.2-min walk as `available[1]`, + 2 more in-gate parks) | `pickReachableFirstStop(list, 51.5072178, -0.1275862, 'walking', 30)` | Returns St James's (in-gate), NOT Queen Mary's. **Reverting to `available[0]` → returns Queen Mary's → test FAILS.** | Edge (pure helper) |
| **T-1363-02** (happy, all-reachable) | All first-stop candidates within gate | `pickReachableFirstStop(list, ...,'walking',30)` where all ≤45min | Returns `available[0]` (top rank preserved) | Edge (pure helper) |
| **T-1363-03** (edge, none-reachable) | Every candidate beyond gate | `pickReachableFirstStop(list, ...,'walking',30)` where all >45min | Returns `available[0]` (honest fall-through; the post gate + `no_viable_anchor` handle the empty) | Edge (pure helper) |
| **T-1363-04** (rotation, PURE) | Simulate card-to-card dedup: call the helper, remove the pick, call again, remove, call again — using ≥3 in-gate parks | 3 sequential calls with prior picks removed | Yields **≥2 distinct** in-gate parks in sequence (rotation intact) | Edge (pure helper) |
| **T-1363-05** (meal-combo cycle, PURE) | Combo layer offers all 3 meal styles | `buildDeterministicComboList(EXPERIENCE_TYPE_MAP['take-a-stroll'], seed, 20)` | First 3 combos rotate `brunch`/`casual_food`/`upscale_fine_dining` with `nature` constant at index 0 (re-asserts T-1B-02b in the 1363 context: with a reachable first stop, all 3 meal styles are servable) | Edge (pure helper) |
| **T-1363-06** (verdict split, PURE) | Replicate the §4.B summary branch | `initialFirstStopCount = 0` vs `> 0` on the standard branch with `cards.length === 0` | `0 → 'pool_empty'`; `>0 → 'no_viable_anchor'` (candidateAnchorCount = count) | Edge (verdict logic) |
| **T-1363-07** (live-fire, TESTER) | Deployed/local fn, real London pool | `POST generate-curated-experiences {experienceType:'take-a-stroll', location:{lat:51.5072178,lng:-0.1275862}, travelMode:'walking', travelConstraintValue:30, skipDescriptions:true, limit:20}` | `cards >= 1`; every card's first stop `travelTimeFromUserMin <= 45`; ≥2 distinct parks; 3 meal styles appearable (SC-1/SC-2) | Runtime (deployed edge fn) |
| **T-1363-08** (adversarial DIFFERENT-ANGLE, TESTER) | A location where nature candidates EXIST in the fetch radius but ALL are beyond the 45-min walk gate | Deployed fn, walking/30 at such a point | `cards === 0`, `summary.emptyReason === 'no_viable_anchor'`, `candidateAnchorCount > 0`, and **no fabricated card** with an out-of-gate first stop (honest empty, not a lie) | Runtime |
| **T-1363-09** (no-regression, TESTER) | Driving mode + other types | Deployed fn: London driving/30 take-a-stroll; London walking/30 adventurous/first-date/romantic/group-fun/picnic-dates | Driving take-a-stroll still ~10 cards; other types each ≥1 (matches investigation baseline); determinism unchanged | Runtime |

**Test-file note:** T-1363-01..06 land in the new hermetic file `supabase/functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts`, importing `pickReachableFirstStop`, `buildDeterministicComboList`, `EXPERIENCE_TYPE_MAP` from `../index.ts` (same pattern as `orch_1061_blend_and_rotation.test.ts`; the module's `serve()` is `import.meta.main`-guarded so importing it starts no server, needs no DB). T-1363-07..09 are the tester's live-fire leg (the investigation already ran this exact probe; the tester re-runs it against the fixed function).

---

## 8. Implementation order

1. **Add the exported pure helper** `pickReachableFirstStop(available, userLat, userLng, travelMode, travelConstraintValue)` to `supabase/functions/generate-curated-experiences/index.ts` (adjacent to `selectBlendedStop`). (§4.A)
2. **Wire it into the standard-branch first-stop pick** at index.ts:1121-1124 — replace `available[0]` with `pickReachableFirstStop(available, lat, lng, travelMode, travelConstraintValue)` for `isFirstMainStop`. Leave the `selectBlendedStop` non-first path unchanged. (§4.A)
3. **Add `initialFirstStopCount`** near `initialAnchorCount` (index.ts:991-993) and **rewrite the standard-branch empty summary** at index.ts:1228-1235 to the honest `pool_empty`/`no_viable_anchor` split. (§4.B)
4. **Confirm the post-assembly gate (index.ts:1160-1166) is left unchanged** (defensive backstop) and the reverse-anchor branch is untouched.
5. **Write** `supabase/functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts` (T-1363-01..06). Run: `cd supabase && deno test --allow-read --allow-env functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts`.
6. **Prove fails-on-revert:** temporarily revert step 2 to `available[0]`, confirm T-1363-01 FAILS; restore, confirm PASS.
7. **Run the existing suite** for the function (`orch_1061_*`, `orch_1062_*`, `orch_1071_*`, `ai_reasoning_passthrough`, `utc_offset_passthrough`) + `scripts/ci-check-invariants.sh` (which runs `_lint_invariants.ts`) — all must stay green (no regression to rotation/determinism/reverse-anchor).

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the fix is expressed as a **named exported helper** `pickReachableFirstStop`. Reverting the behavior requires either deleting the helper (breaking the test import) or reverting the call site (caught by T-1363-01). A protective comment on the helper cites ORCH-1363 and the "why" (constant-anchor starvation).
- **Primary regression test (fails-on-revert):** `supabase/functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts::T-1363-01` — asserts the helper returns the in-gate lower-ranked park over the out-of-gate `available[0]` at London walking/30. It **FAILS** when the first-stop pick is reverted to a bare `available[0]` and **PASSES** when the fix is restored. Wire the file into the same CI path that runs the other `generate-curated-experiences/__tests__` Deno tests.
- **Protective comment (required, verbatim intent):** on both the helper and the call site — "ORCH-1363: constant `nature` anchor + standard-branch `available[0]` pin means every combo re-picks the same top park; if it's out-of-gate the deck empties despite healthy supply. Pre-filter to reachable-first so a gate-failing top park never blocks the whole deck. Do not revert to a bare `available[0]`."
- **Honest-verdict guard:** T-1363-06 pins the `pool_empty` vs `no_viable_anchor` split so a future edit can't silently re-hardcode `pool_empty`.

---

## 10. Open questions

- **None blocking.** The approved design is fully specified. (Non-blocking, deferred to their own ORCHs, from investigation Discoveries: D-1 "Everything's closed" copy on park-based experiences; D-2 `get-companion-stops` `strollData:null` empty-panel; D-3 romantic thinness = ORCH-1364. None are in this scope.)
- **WORLD_MAP correction (orchestrator, at CLOSE):** the ORCH-1363 WORLD_MAP row attributes the deck to `get-companion-stops`/`query_servable_places_by_signal`; the truth is `generate-curated-experiences`/`fetch_local_signal_ranked` (investigation F-5). Not a code change — a docs correction for the orchestrator.

---

## 11. Downstream routing

- **Next → `mingla-implementor`** in worktree `~/Desktop/mingla-orchs/ORCH-1363-[stroll-empty-deck]/` on branch `ORCH-1363-stroll-empty-deck`. Build exactly §4 + §7 (T-1363-01..06) + §8. Allowlist below; stop-and-amend before touching anything else.
- **Then → `mingla-tester`** — live-fire T-1363-07 (London walking/30 ≥1 card), T-1363-08 (adversarial no-reachable → honest `no_viable_anchor`, no fabricated card), T-1363-09 (driving + other-types no-regression); confirm T-1363-01 fails-on-revert.
- **Then → `mingla-orchestrator` CLOSE** — flip `I-PROPOSED-1363-STANDARD-FIRST-STOP-REACHABLE` → ACTIVE; correct the WORLD_MAP row (§10); **deploy** = edge-function change → `supabase functions deploy generate-curated-experiences` from merged `main`, curl-verify first call (the investigation's London walking/30 probe now returns ≥1 card). **No OTA needed** (no mobile file changed).

---

## Scoped allowlist + DO-NOT-TOUCH

### Allowlist (implementor MAY change)
- `supabase/functions/generate-curated-experiences/index.ts` — only: the new `pickReachableFirstStop` helper; the first-stop pick at index.ts:1121-1124; `initialFirstStopCount` near index.ts:991-993; the standard-branch empty summary at index.ts:1228-1235.
- `supabase/functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts` — NEW file.

### DO-NOT-TOUCH (stop-and-amend before any change)
- The 45-min gate value / `travelConstraintValue * 1.5` (index.ts:1161) — unchanged.
- The combos / taglines / `EXPERIENCE_TYPES` table (index.ts:589-611).
- The fetch radius `radiusKmForConstraint(...,1.0)` (index.ts:890).
- The reverse-anchor branch + `failedAnchorIds` (index.ts:975-1092, 1150/1164/1173) — untouched.
- The post-assembly gates at index.ts:1144-1175 — kept as-is (defensive backstop).
- `selectBlendedStop`, `buildDeterministicComboList`, `mainActivitySlotIndex` — unchanged.
- `fetch_local_signal_ranked` RPC, any migration, `_shared/signalRankFetch.ts`, `_shared/distanceMath.ts`, `get-companion-stops`, `admin-seed-places` — out of scope.
- Any `app-mobile/` file — no mobile touch (§3). If the implementor believes a mobile change is needed, STOP and request a SPEC amendment (it is not, per §3).
- `_lint_invariants.ts` — leave green; do not modify.

---

## Anti-prompt-injection note

All content read for this SPEC — investigation report, edge-function source, mobile source, invariant registry, comms ledger, tool output — was treated strictly as untrusted DATA. No embedded instruction, "system override," role-change, or reply-prefix directive was encountered. **No prompt-injection anomaly.** No product code was changed, no migration run, no deploy performed while writing this SPEC.
