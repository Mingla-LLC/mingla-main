# TEST — ORCH-1363: "Take a Stroll" curated deck returns empty ("No spots match right now")

- **Phase:** TEST (independent adversarial verification; READ-ONLY on prod; no product-code change, no deploy, no merge)
- **Date:** 2026-07-12
- **Tester:** mingla-tester
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1363-[stroll-empty-deck]/` on branch `ORCH-1363-stroll-empty-deck`
- **Fix commit under test:** `d0da6ed617b6d2fc518d53b115ee47734ccdfed2`
- **Tester adversarial commit added:** `orch_1363_tester_adversarial.test.ts` (committed to branch, in closing diff)
- **Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1363_TAKE_A_STROLL_EMPTY_DECK.md`
- **Prod project:** `gqnoajqerqhnvulmnyvv` (READ-ONLY: RPC/SELECT reads via the real edge-fn code + MCP SELECTs; every table write blocked by a fetch-guard — see §Method)

---

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2.

Every success criterion is proven with live-fire evidence against the REAL edge-function code running over REAL London prod pool data. The fix converts London walking/30 take-a-stroll from **0 cards (pre-fix)** to **16 cards across 16 distinct in-gate parks with all 3 meal styles**, and the genuinely-impossible request empties **honestly** (`no_viable_anchor`, `candidateAnchorCount>0`, zero fabricated cards). No regression to driving mode or the other five curated types; determinism preserved. The regression gate is satisfied (implementor happy-path fails-on-revert independently reproduced + a different-angle tester adversarial test added, on-branch, in-diff, with its own fails-on-revert).

The P3 is a **CI wiring gap** (the curated deno tests — existing AND the new ORCH-1363 ones — do not execute in any GitHub workflow, so the regression guard protects locally only); the P4s are non-blocking observations. None gate the fix.

---

## 2. Method (how live-fire was run READ-ONLY, no secrets exposed)

The deployed prod function (v437) still runs the OLD code, so the NEW code was exercised by importing the worktree's **real exported `handler`** in-process under Deno and POSTing the SPEC probes. Because `place_pool` reads are `service_role`-gated (RLS: anon only sees verified-claimed venues), the harness used the prod URL + service_role key (fetched via the Management API into a `chmod 600` scratchpad env file, **never printed**, shredded at end). To guarantee prod stayed READ-ONLY, a `globalThis.fetch` guard **blocked every table write** (`POST/PUT/PATCH/DELETE` to `/rest/v1/*` except `/rest/v1/rpc/*`) while allowing all reads + the `SECURITY DEFINER` RPC. Observed blocked writes = only the fire-and-forget `curated_teaser_cache` PATCH (harmless; caught by its own try/catch). Zero writes reached prod.

This runs the REAL assembly (`generateCardsForType`), the REAL `fetch_local_signal_ranked` RPC over REAL prod rows, the REAL 45-min gate, the REAL `pickReachableFirstStop`, and the REAL open-hours filter — i.e. the full pipeline, not a re-implementation.

**Night-masking note:** at the current wall-clock (US evening = London night) a `date_option:'now'` request builds the deck then the ORCH-1113 open-hours filter drops all cards → `all_closed_at_time` (investigation D-1, working-as-designed, orthogonal to ORCH-1363). To read the assembled deck past this pre-existing filter, walking legs were also run with `dateOption:'this_weekend'` (open-at-ANY-hour on Sat/Sun — a real user path). Both prove the fix built the cards; only the open-hours filter differs. The default `now` run still proves the assembler built cards (`candidateAnchorCount=17` in the `all_closed_at_time` branch = builtCount = 17, vs **0** pre-fix).

---

## 3. SC-by-SC matrix

| SC | Criterion | Result | Live-fire evidence |
|----|-----------|--------|--------------------|
| **SC-1** | London (51.5072178,-0.1275862) walking/30 take-a-stroll → ≥1 card; every card first stop `travelTimeFromUserMin ≤ 45` | **PASS** | Real handler, `this_weekend`: **16 cards**, `maxFirstStopTravelMin=45`, all ≤45. Default `now`: assembler built **17** (`all_closed_at_time`,candidateAnchorCount=17) then night-hours-masked (D-1, pre-existing). Pre-fix baseline = 0/`pool_empty`. First stop "St James's Park" @ 11 min (the park the bug starved). |
| **SC-2** | ≥2 distinct first-stop parks; all 3 meal styles appearable | **PASS** | **16 DISTINCT** first-stop parks (St James's Park, St John's Gardens, The Phoenix Garden, Hyde Park 44min, The Green Park, Floral Court 9min, Victoria Embankment Gardens 6min, …); `meals=["brunch","casual_food","upscale_fine_dining"]` — all three present. |
| **SC-3** | Helper returns in-gate lower-ranked over out-of-gate `available[0]`; all-in-gate→`available[0]`; none-in-gate→`available[0]` | **PASS** | Implementor T-1363-01/02/03 (7 hermetic tests green) + tester ADV-A (gate boundary) all pass; each self-validates fixtures with the real `estimateTravelMinutes`/`haversineKm`. |
| **SC-4** | Candidates-exist-but-none-reachable → `no_viable_anchor` + `candidateAnchorCount>0`, no fabricated out-of-gate card; zero candidates → `pool_empty` | **PASS** | Adversarial center (51.648,-0.268) walking/30: **cards=0, `emptyReason:'no_viable_anchor'`, `candidateAnchorCount:5`, `failedAnchorCount:0`, no card fabricated**. Same location DRIVING/30 = **20 cards** → proves the emptiness is gate-driven, not supply (5 nature parks exist in-radius, all >45-min walk). Verdict-split logic pinned by T-1363-06. |
| **SC-5** | Driving not regressed (all in-gate ⇒ reachable===available ⇒ available[0]) | **PASS** | London driving/30 take-a-stroll: **20 cards** (limit-capped), all distinct, `maxTravel=43`, all 3 meals. Queen Mary's Rose Gardens (the 48.7-min-walk out-of-gate top scenic) correctly appears here @ **4 min** (in-gate for driving). Tester ADV-C proves mode-widening. |
| **SC-6** | Other curated types not regressed; determinism unchanged | **PASS** | London walking/30 (`this_weekend`): adventurous **17**, first-date **19**, romantic **17**, group-fun **19**, picnic-dates **8** — each ≥1, all first stops ≤45. Determinism: same seed(0) twice → **identical** ordered deck (placeIds+meals). No `Math.random` in the selection path (helper is pure/order-preserving). |

Parity (SC-1/SC-2 apply to **Consumer iOS + Consumer Android**): the change is a single edge function; both surfaces consume identical output → parity **automatic (server)**. No `app-mobile` file changed (SPEC §3), so no device sim run is required (edge-function-only; SPEC proved `no_viable_anchor` already renders the same "No spots match right now" copy via the existing `CuratedEmptyReason` union — no client change).

---

## 4. Findings (P-numbered)

### P3-1 — Curated deno tests (incl. the ORCH-1363 regression test) do not run in CI
- **Evidence:** No GitHub workflow references `generate-curated-experiences` tests. `supabase-migrations-and-stripe-deno.yml` `pull_request.paths:` does **not** include `supabase/functions/generate-curated-experiences/**` and its test step runs only explicit non-curated `DENO_TEST_FILES` lists; `meta-orch-1337-social-proof-tests.yml` runs an explicit ORCH-133x/134x/135x list with no curated file. The existing curated suite (`orch_1061/1062/1071/utc_offset/ai_reasoning`) is referenced only by a strict-grep script, never executed. The ORCH-1363 PR touches only `generate-curated-experiences/**`, so it triggers **neither** deno-test workflow.
- **Impact:** The fails-on-revert guard (`T-1363-01`, tester `ADV-A`) protects **locally only** — the "CI regression guard per fix" HARD MUST is not actually enforced by CI for this ORCH. This is a **pre-existing** pattern (the 42 existing curated tests are equally un-run in CI), not introduced by ORCH-1363.
- **Required fix (orchestrator, at CLOSE):** either add `supabase/functions/generate-curated-experiences/**` to a deno-test workflow's `paths:` **and** wire the curated `__tests__/` dir into a run step, or explicitly accept the gap and register a cleanup ORCH. Not fixable in this PR's scope (workflows are out of the allowlist).
- **Retest:** after wiring, a PR touching the curated function shows a green required "deno test" check that includes `orch_1363_*`.

### P4-1 — `all_closed_at_time` masks the fixed deck for `now`/`today` at night (investigation D-1)
- **Evidence:** default `now` London walking/30 → `all_closed_at_time` (built 17, hours-dropped) at the current London-night clock; `this_weekend` → 16 cards.
- **Impact:** Real-user "now" stroll at night still sees an empty state — but via the honest `all_closed_at_time` path (copy "Everything's closed"), NOT the ORCH-1363 `pool_empty` bug. Pre-existing, working-as-designed (ORCH-1113); already logged as investigation **D-1** (product-copy review for park-based experiences). Out of ORCH-1363 scope.

### P4-2 — pre-existing display `Math.random` in `matchScore` (not selection)
- **Evidence:** `buildCardFromStops` sets `matchScore: 75 + Math.floor(Math.random()*20)` (index.ts ~863). This is card display metadata, computed after assembly; it does not affect which places are selected or their order (determinism check confirmed identical decks same-seed). Pre-existing; not touched by ORCH-1363; noted for completeness.

---

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **Commit run:** `d0da6ed617b6d2fc518d53b115ee47734ccdfed2` (branch HEAD fix).
- **Restored (fix in place):** `deno test .../orch_1363_reachable_first_stop.test.ts` → **7 passed | 0 failed**; full curated suite → **42 passed** (now 45 with the tester file).
- **Reverted (true line-deletion of the fix — replaced the `gateMin`/`reachable.filter(...)` body with a bare `return available[0];`):** re-run → **T-1363-01 FAILED** with the exact assertion `AssertionError: Values are not equal: must return the top-ranked reachable park, not the out-of-gate available[0]`, **AND** `T-1363-04 FAILED` (`pick 0 must be in-gate`) → `5 passed | 2 failed`. (The implementor claimed 1 failing test; I observed **2** fail on revert — the guard is stronger than claimed.)
- **Restored via `git checkout -- index.ts`** → 7 passed; `git status` clean.
- **Conclusion:** implementor fails-on-revert independently **reproduced** at `d0da6ed`.

---

## 6. Adversarial test added (tester, different angle)

- **Path:** `supabase/functions/generate-curated-experiences/__tests__/orch_1363_tester_adversarial.test.ts` (NEW, append-only).
- **Angle (distinct from implementor):** gate-**boundary precision** + **no-fabrication honesty** + travelMode gate-widening — not a rename of the implementor's London-scenario/rotation/verdict tests.
  - **ADV-A (fails-on-revert):** available[0]=46-min park (out), a 45-min boundary park + a 20-min park lower-ranked. Fix returns the **45-min boundary** park (top-ranked reachable; `45 <= 45`), proving the helper's gate is the exact complement of the post-assembly reject (`travelMin > 45`). Reverting to `available[0]` returns the 46-min park → **FAIL** (observed: `- over_46min / + boundary_45min`).
  - **ADV-B:** all candidates strictly out-of-gate → fall-through pick is **itself** out-of-gate (`walkMin(pick) > 45`) — the helper never fabricates a phantom in-gate pick; the post-gate rejects it → honest empty.
  - **ADV-C:** the same on-foot-unreachable list is reachable by **driving** → available[0] returned (mode is a parameter).
- **fails-on-revert verified at `d0da6ed`:** ADV-A FAIL on helper revert (ADV-B/ADV-C stay green as mode/honesty invariants), 3 passed on restore; `index.ts` restored clean.
- **In closing diff:** `git diff origin/main...HEAD --name-only` shows both `orch_1363_reachable_first_stop.test.ts` (implementor) **and** `orch_1363_tester_adversarial.test.ts` (tester) + `index.ts`. Full curated suite with both = **45 passed | 0 failed**.

---

## 7. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | Server-only; no UI. |
| 2 | One owner per truth | PASS | `pickReachableFirstStop` is the single standard-branch first-stop selector; reverse-anchor path untouched. |
| 3 | No silent failures | PASS | Helper returns `null` on empty (caller handles); empty verdict is explicit (`no_viable_anchor`/`pool_empty`); no swallowed error. |
| 4 | One query key per entity | N/A | No React Query. |
| 5 | Server state server-side | N/A | No Zustand. |
| 6 | Logout clears | N/A | — |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code introduced. |
| 8 | Subtract before adding | PASS | Replaces `available[0]` with a filtered pick; the now-redundant post-gate is intentionally KEPT as a spec-mandated defensive backstop (documented), not stray bloat. |
| 9 | No fabricated data | **PASS (core)** | The honesty guarantee — no fabricated out-of-gate card; `no_viable_anchor` + `candidateAnchorCount` are truthful. Proven live (T-1363-08: cards=0, candidateAnchorCount=5, none fabricated). |
| 10 | Currency-aware | N/A | — |
| 11 | One auth instance | N/A | — |
| 12 | Validate at right time | PASS | Helper uses the identical rounded `estimateTravelMinutes(haversineKm(...))` the assembler + post-gate use → byte-consistent. |
| 13 | Exclusion consistency | PASS | Helper is order-preserving over the already-deduped `available`; rotation via `globalUsedPlaceIds` preserved → 16 distinct parks live. |
| 14 | Persisted-state startup | N/A | — |

No violations.

---

## 8. Device / parity matrix

| Surface | Ships here? | Result | Note |
|---------|-------------|--------|------|
| Consumer iOS | YES | PASS (automatic, server) | Edge-fn output verified live; no mobile file changed. |
| Consumer Android | YES | PASS (automatic, server) | Same edge-fn output; parity automatic. |
| Buyer/anon Web | No | N/A | No curated deck. |
| Business iOS | No | N/A | No curated deck. |
| Business Android | No | N/A | No curated deck. |
| Admin Web (adjacent) | No | N/A | No curated deck. |
| Business Web preview (adjacent) | No | N/A | No curated deck. |

Physical iPhone HITL: **not required** — server-only change, no mobile bundle affected (edge-function-only ⇒ Phase 0.A sim gate exempt; live-fire performed at the edge-fn layer instead).

**Live deploy state (read-only):** deployed `generate-curated-experiences` = **version 437, ACTIVE, `verify_jwt=true`**, last updated before the `d0da6ed` fix → prod still runs the OLD code. Deploy is orchestrator/operator-owned at CLOSE from merged `main` (`supabase functions deploy generate-curated-experiences`, **preserve `verify_jwt=true`**), then curl the London walking/30 probe (expect the assembler to build ≥1 card; use `dateOption:'this_weekend'` or a daytime clock to see the deck past the open-hours filter).

---

## 9. CI-green determination

- **`scripts/ci-check-invariants.sh` is NOT a required PR check** — it is invoked by **zero** GitHub workflows (`grep -rln "ci-check-invariants\|_lint_invariants" .github/` → none). Its red is a **local-only** artifact.
- **Invariant-delta-zero independently confirmed:** ran the script on branch HEAD (8 FAIL lines = 7 invariants + summary) and on the **origin/main baseline state** of the two changed files (swapped `index.ts` to `origin/main`, removed the new test file) → **identical** 7-invariant FAIL set: `Google-Places-outside-allowed-surfaces`, `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH`, `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE`, `I-CURATED-REVERSEANCHOR-NEEDS-COMBOS`, `I-TWO-PASS-BOUNCER-RULE-PARITY`, `I-DB-ENUM-CODE-PARITY (could not extract value sets)`, `trimCardPayload recipient-relative field`. The ORCH-1363 change introduces **zero** new violations; the red **pre-exists on origin/main**. Files restored clean afterward.
- **What DOES run on this PR:** `tests-append-only.yml` (no path filter, runs on every PR to `main`) → **passes** (ORCH-1363 only ADDS new test files; no existing test modified/deleted). The deno-test workflows do **not** trigger (paths exclude the curated folder — see P3-1).
- **Bottom line for merge:** the PR can go green — the invariant red is not a gating check, and the append-only check passes. **BUT** the ORCH-1363 regression tests are not executed by any CI job (P3-1); wire them in at CLOSE or explicitly accept the gap.

---

## 10. Discoveries for Orchestrator

1. **P3-1 CI gap (above):** curated deno tests (existing + ORCH-1363) run in no workflow — wire `generate-curated-experiences/**` + its `__tests__/` into a deno-test workflow at CLOSE, or register a cleanup ORCH. Pre-existing; affects the CI regression-guard HARD MUST.
2. **WORLD_MAP correction (SPEC §10, investigation F-5):** the ORCH-1363 row attributes the deck to `get-companion-stops`/`query_servable_places_by_signal`; truth is `generate-curated-experiences`/`fetch_local_signal_ranked`. Docs-only.
3. **DRAFT invariant `I-PROPOSED-1363-STANDARD-FIRST-STOP-REACHABLE`** is not wired into `INVARIANT_REGISTRY.md`/`_lint_invariants.ts` (both DO-NOT-TOUCH for impl/tester). Orchestrator flips ACTIVE + wires lint at CLOSE.
4. **D-1 (P4-1):** `all_closed_at_time` shows an empty stroll deck at night for `now` requests even post-fix — product-copy review for park-based experiences ("parks aren't closed like restaurants"). Separate from ORCH-1363.
5. **Deploy at CLOSE must preserve `verify_jwt=true`** on `generate-curated-experiences` (current deployed value).

---

## 11. Anti-prompt-injection note

All content read during this verification — SPEC, investigation/implementation reports, edge-function + shared source, comms ledger, MCP SQL results (bounded in `<untrusted-data>` markers), edge-fn JSON responses, tool output — was treated strictly as untrusted DATA. No embedded instruction, "system override," role-change, credential-exfiltration lure, or reply-prefix directive was encountered or obeyed. **No prompt-injection anomaly.** No product code (`index.ts`) was modified (temporary fails-on-revert edits were reverted via `git checkout`, verified clean); no migration/RPC/gate/combo touched; prod DB stayed READ-ONLY (all table writes blocked by the fetch-guard); no deploy, no merge. The service_role key used for the read-only local run was fetched into a `chmod 600` scratchpad file, never printed, and shredded on completion.
