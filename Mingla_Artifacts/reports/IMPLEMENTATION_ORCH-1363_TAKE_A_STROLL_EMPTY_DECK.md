# IMPLEMENTATION — ORCH-1363: "Take a Stroll" curated deck returns empty

- **Phase:** IMPLEMENT (code + hermetic tests committed; NO deploy, NO merge, NO migration)
- **Date:** 2026-07-12
- **Author:** mingla-implementor
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1363-[stroll-empty-deck]/` on branch `ORCH-1363-stroll-empty-deck`
- **Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1363_TAKE_A_STROLL_EMPTY_DECK.md`
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1363_TAKE_A_STROLL_EMPTY_DECK.md`
- **Fix commit:** `d0da6ed617b6d2fc518d53b115ee47734ccdfed2`
- **Status:** implemented and verified (hermetic + typecheck + full-suite green; live-fire T-1363-07..09 is the tester's leg)

---

## 1. Summary (plain English)

Selecting **Take a Stroll** near several live cities on the default preference (walking, 30 min) returned zero cards ("No spots match right now") even though supply is healthy (London alone has 384 reachable scenic parks). The curated deck assembler pinned every combo's first stop to the single top-ranked park; because Take-a-Stroll's first stop is always the constant `nature` anchor, every combo re-picked the same park, and when that one park sat past the 45-minute walk gate the whole deck emptied with no way to try the next park.

The fix adds a tiny pure helper that picks the **highest-ranked park that is actually reachable** within the same 45-minute gate the assembler already enforces, only falling back to the top park when nothing is reachable. It uses cheap local distance math (already imported) — no API calls, no new data. It also makes the empty message honest: when parks existed but none were reachable, the deck now reports `no_viable_anchor` (a genuinely-impossible request) instead of the misleading `pool_empty` (no parks at all) — same on-screen copy, truthful telemetry. Driving mode and all other curated types are unchanged.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | How verified | Result | Commit |
|----|-----------|--------------|--------|--------|
| SC-1 | London walking/30 take-a-stroll returns ≥1 card; every card's first stop `travelTimeFromUserMin ≤ 45` | Helper guarantees a reachable pick (≤ gate) whenever any candidate is reachable; T-1363-01 asserts the in-gate pick + `walkMin(pick) ≤ 45`. Full runtime count is the tester's live-fire T-1363-07. | ✓ (helper proven; runtime = tester) | d0da6ed |
| SC-2 | ≥2 distinct first-stop parks across the deck; all 3 meal styles can appear | T-1363-04 (rotation: sequential picks with prior removed → 3 distinct in-gate parks, out-of-gate top-rank park never chosen); T-1363-05 (nature constant at index 0, first 3 combos rotate brunch/casual_food/upscale_fine_dining) | ✓ | d0da6ed |
| SC-3 | Helper returns in-gate lower-ranked over out-of-gate `available[0]`; all-in-gate → `available[0]`; none-in-gate → `available[0]` | T-1363-01 (out-of-gate top skipped), T-1363-02 (all-in-gate → available[0]), T-1363-03 (none-in-gate → available[0]) | ✓ | d0da6ed |
| SC-4 | Candidates-but-none-reachable → `no_viable_anchor` + `candidateAnchorCount > 0`, no fabricated out-of-gate card; zero candidates → `pool_empty` | T-1363-06 (verdict split replicating §4.B expression); post-assembly gate kept as backstop rejects the fall-through pick | ✓ (verdict logic; runtime honesty = tester T-1363-08) | d0da6ed |
| SC-5 | Driving mode not regressed (all candidates in-gate ⇒ reachable === available ⇒ available[0]) | T-1363-02 proves all-reachable → available[0] (driving = tiny travel times = all reachable). Runtime 10-card baseline = tester T-1363-09. | ✓ (logic; runtime = tester) | d0da6ed |
| SC-6 | Other curated types not regressed; determinism unchanged | Full existing suite green (42 passed); adversarial T-1B-06 (no Math.random in selection path) still green; reverse-anchor branch untouched | ✓ (source; runtime = tester T-1363-09) | d0da6ed |

Note: SC-1/SC-4/SC-5/SC-6 have a runtime leg owned by the tester (T-1363-07..09, deployed edge fn). The implementor-side logic and pure-helper behavior are fully proven here.

---

## 3. Files changed

| File | Δ | Nature |
|------|---|--------|
| `supabase/functions/generate-curated-experiences/index.ts` | +49 / −6 | 4 scoped changes (helper + call site + `initialFirstStopCount` + empty-summary split) |
| `supabase/functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts` | +209 (new) | 7 hermetic Deno tests (T-1363-01..06 + a defensive empty-list guard) |

Closing diff vs origin/main (`git diff origin/main...HEAD --name-only`) = exactly these two files.

---

## 4. Data-model changes applied

None. No migration, no schema, no RLS, no RPC change (per SPEC §2 non-goals).

---

## 5. Edge functions touched

| Function | Change | `verify_jwt` to preserve |
|----------|--------|--------------------------|
| `generate-curated-experiences` | selection-logic + empty-verdict (source only; NOT deployed here) | preserve existing value from `supabase/config.toml` — implementor did NOT alter it |

Deploy is orchestrator/operator-owned from MERGED `main` (SPEC §11): `supabase functions deploy generate-curated-experiences`, then curl the London walking/30 probe to confirm ≥1 card.

---

## 6. Regression tests added

- **Path:** `supabase/functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts` (7 tests, append-only new file).
- **Passing run (fix in place):** `7 passed | 0 failed`. Full function suite: `42 passed | 0 failed`.
- **fails-on-revert verified at `d0da6ed617b6d2fc518d53b115ee47734ccdfed2`.**

### Fails-on-revert evidence (true line deletion of the fix)

The fix that T-1363-01 guards is the reachability pre-filter inside the exported helper. T-1363-01 calls the helper directly, so the meaningful revert is deleting the filter body (per SPEC §7: "Reverting to `available[0]` → returns Queen Mary's → test FAILS"). Reverting only the call site would leave the helper intact and the pure test green; the true fix line is the filter.

Commands run (deno at `/Users/sethogieva/.deno/bin/deno`, PATH-exported):

1. Fix in place → PASS:
   `deno test --allow-read --allow-env functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts`
   → `T-1363-01 ... ok`; `7 passed | 0 failed`.

2. Reverted helper body to `if (available.length === 0) return null; return available[0];` (deleted the `gateMin` + `reachable = available.filter(...)` fix lines) → re-run:
   → `T-1363-01 (fails-on-revert): ... FAILED`
   → `error: AssertionError: Values are not equal: must return the top-ranked reachable park, not the out-of-gate available[0]`
   → `6 passed | 1 failed`.

3. Restored the fix from backup → re-run:
   → `T-1363-01 ... ok`; `7 passed | 0 failed`.

FAIL→PASS transition observed and recorded. (T-1363-04 additionally places the out-of-gate top-rank park at `available[0]` so rotation also demonstrates the fix skipping it card-to-card.)

---

## 7. Old → New receipts

### `supabase/functions/generate-curated-experiences/index.ts`

**Change A — new exported helper `pickReachableFirstStop` (adjacent to `selectBlendedStop`).**
- **Before:** no such helper existed.
- **After:** pure, order-preserving helper filters `available` to places whose `estimateTravelMinutes(haversineKm(userLat,userLng,p.lat,p.lng), travelMode) <= travelConstraintValue*1.5`, returns the top-ranked reachable, else `available[0]`; returns `null` on empty.
- **Why:** SPEC §4.A — the core fix. Byte-for-byte the same travel computation the post-assembly gate applies, so a reachable pick is guaranteed to pass the post gate.
- **Lines:** +27 (incl. protective comment).

**Change B — standard-branch first-stop pick.**
- **Before:** `const place = isFirstMainStop ? available[0] : selectBlendedStop(...)`.
- **After:** `const place = isFirstMainStop ? pickReachableFirstStop(available, lat, lng, travelMode, travelConstraintValue) : selectBlendedStop(...)`.
- **Why:** SPEC §4.A step 2 — advance past an out-of-gate top park instead of pinning it every combo. Uses user origin `lat`/`lng` (matches buildCardStop's `userLat`/`userLng`), NOT `prevLat`/`prevLng`.
- **Lines:** call-site 1 line + a 6-line protective comment.

**Change C — `initialFirstStopCount`.**
- **Before:** only `initialAnchorCount` existed (reverse-anchor only).
- **After:** added `firstStopIdx` + `initialFirstStopCount` (candidates for the first non-optional slot of combo 0 on the standard branch).
- **Why:** SPEC §4.B — feeds the honest empty verdict.
- **Lines:** +8.

**Change D — standard-branch empty summary.**
- **Before:** hard-coded `emptyReason:'pool_empty', candidateAnchorCount:0, failedAnchorCount:0`.
- **After:** `emptyReason: initialFirstStopCount === 0 ? 'pool_empty' : 'no_viable_anchor'; candidateAnchorCount: initialFirstStopCount; failedAnchorCount: 0`.
- **Why:** SPEC §4.B — truthful verdict mirroring the reverse-anchor branch; same rendered mobile copy (`no_viable_anchor` → "No spots match right now"), truthful telemetry.
- **Lines:** ~6 changed.

**Untouched (verified):** the 45-min gate value / `travelConstraintValue*1.5` (post gate line unchanged), the combos / `EXPERIENCE_TYPES`, the fetch radius `radiusKmForConstraint(...,1.0)`, the reverse-anchor branch + `failedAnchorIds`, the post-assembly gates (kept as defensive backstop), `selectBlendedStop`, `buildDeterministicComboList`, `mainActivitySlotIndex`.

---

## 8. Cross-surface impact table

| # | Surface | Affected | User-visible | Parity |
|---|---------|----------|--------------|--------|
| 1 | Consumer iOS | YES | Take-a-Stroll returns ≥1 card at walking/30 (first stop within gate); impossible requests show honest empty | Automatic (server) |
| 2 | Consumer Android | YES | Same as iOS | Automatic (server) |
| 3 | Buyer/anonymous Web | No | No curated deck on this surface | — |
| 4 | Business iOS | No | No curated deck on business | — |
| 5 | Business Android | No | No curated deck on business | — |
| 6 | Admin Web (adjacent) | No | No curated deck | — |
| 7 | Business Web preview (adjacent) | No | No curated deck | — |

Single edge function; both consumer surfaces consume identical output → parity automatic. No `app-mobile` change (SPEC §3 proved `no_viable_anchor` already renders the same copy; the union already includes it). No mobile touch = no OTA.

---

## 9. Smoke / gate results

- **`deno check` index.ts** → clean (`Check ... index.ts`).
- **`deno check` new test file** → clean.
- **New test file** → `7 passed | 0 failed`.
- **Full `generate-curated-experiences/__tests__` suite** → `42 passed | 0 failed` (my 7 + existing 35; ORCH-1061 rotation/determinism, ORCH-1062 override, ORCH-1071 front-load, adversarial no-Math.random, utc-offset all green).
- **fails-on-revert** → proven (§6): FAIL on helper revert, PASS restored.
- **`scripts/ci-check-invariants.sh`** → invariant-neutral (see §11 / Known issues). The FAIL set is IDENTICAL with and without my change (proven by stashing my two files and re-running). My change introduces ZERO new violations. No live-fire runtime performed by the implementor (tester's leg).

---

## 10. Invariant preservation

| Invariant | Preserved? | Evidence |
|-----------|-----------|----------|
| `I-CURATED-FAILED-ANCHOR-IS-USED` (ORCH-0677) | Y | reverse-anchor branch + `failedAnchorIds` untouched |
| `I-CURATED-EMPTY-IS-EXPLICIT-VERDICT` | Y | a `summary.emptyReason` is still emitted on every empty deck; §4.B refines the standard value |
| `I-CURATED-HOURS-VIA-CANONICAL-READER` (ORCH-1113) | Y | `all_closed_at_time` path unaffected |
| `I-CURATED-REVERSEANCHOR-NEEDS-COMBOS` (ORCH-0677 D-1) | Y (unchanged by me) | picnic combos untouched; this gate's baseline state is identical pre/post my change (see §11) |
| Determinism (no `Math.random` in selection) | Y | helper is pure/order-preserving; adversarial source-grep test green |
| `I-PROPOSED-1363-STANDARD-FIRST-STOP-REACHABLE` (DRAFT) | N/A — not yet wired into registry/lint (both DO-NOT-TOUCH); enforced by T-1363-01. Orchestrator flips ACTIVE at CLOSE. |

---

## 11. Known issues / deferred

- **`scripts/ci-check-invariants.sh` is red on the baseline (origin/main) in this local worktree**, independent of ORCH-1363. Stashing my two files and re-running produced the IDENTICAL FAIL set: `I-CURATED-REVERSEANCHOR-NEEDS-COMBOS` (picnic-dates has 1 combo), `I-TWO-PASS-BOUNCER-RULE-PARITY`, `I-DB-ENUM-CODE-PARITY` ("could not extract value sets"), `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS` (`trimCardPayload`), Google-Places-outside-allowed-surfaces, `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH`, `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE`. None are in files I touched; all are DO-NOT-TOUCH or out-of-scope. **My change is invariant-delta-zero.** This looks like a local-vs-CI discrepancy (e.g. the `I-DB-ENUM-CODE-PARITY` "could not extract value sets" reads like a parser/tooling quirk, and the picnic-dates single-combo shape is a long-standing state) — flagged for the orchestrator, NOT fixed here (out of scope).
- **No transitional/`[TRANSITIONAL]` code introduced.**
- **No DIAG markers added.**

---

## 12. Operator action required

- **No migration** (none in scope) → no `db push`.
- **Edge deploy (orchestrator/operator, from MERGED `main`):** `supabase functions deploy generate-curated-experiences` (preserve its existing `verify_jwt`), then curl the investigation's London walking/30 probe:
  `POST generate-curated-experiences {experienceType:'take-a-stroll', location:{lat:51.5072178,lng:-0.1275862}, travelMode:'walking', travelConstraintValue:30, skipDescriptions:true, limit:20}` → expect `cards >= 1`, every card's first stop `travelTimeFromUserMin <= 45`.
- **No OTA** (no mobile file changed).

---

## 13. Discoveries for Orchestrator

1. **`ci-check-invariants.sh` red baseline (see §11).** The invariant gate is failing on `main` locally with 7 unrelated invariants, one being the curated `I-CURATED-REVERSEANCHOR-NEEDS-COMBOS` (picnic-dates single-combo). The SPEC §6 asserted `_lint_invariants.ts` is "still green"; locally it is not, on baseline. Likely CI-vs-local or missing-merged-state discrepancy — recommend the orchestrator confirm the CI run is green before relying on this gate at CLOSE, and register a cleanup ORCH if the local baseline is genuinely red.
2. **DRAFT invariant `I-PROPOSED-1363-STANDARD-FIRST-STOP-REACHABLE` is not wired** into `INVARIANT_REGISTRY.md` or `_lint_invariants.ts` (both DO-NOT-TOUCH for the implementor). Enforcement is currently test-only via T-1363-01. Orchestrator owns the ACTIVE flip + any lint wiring at CLOSE.
3. **WORLD_MAP correction (already in SPEC §10):** the ORCH-1363 row attributes the deck to `get-companion-stops`/`query_servable_places_by_signal`; the truth is `generate-curated-experiences`/`fetch_local_signal_ranked`. Docs-only, orchestrator at CLOSE.
4. **Non-blocking, from the investigation (their own ORCHs):** D-1 "Everything's closed" copy on park-based experiences; D-2 `get-companion-stops` `strollData:null` empty-panel; D-3 romantic thinness = ORCH-1364. Not in this scope.

---

## Anti-prompt-injection note

All content read during implementation — SPEC, investigation, edge-function source, test files, comms ledger, invariant script/lint output, tool output — was treated strictly as untrusted DATA. No embedded instruction, "system override", role-change, or reply-prefix directive was encountered. **No prompt-injection anomaly.** No deploy, no migration, no merge performed. No file outside the SPEC allowlist was modified.
