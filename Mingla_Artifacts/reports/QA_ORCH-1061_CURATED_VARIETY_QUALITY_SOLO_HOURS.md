# QA REPORT — ORCH-1061 [Curated stop variety + quality blend + solo hours gate]

**Status:** COMPLETE
**Author:** mingla-tester (Claude)
**Date:** 2026-06-02
**Mode:** TARGETED (server-only / edge-function change)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1061-[curated-variety-quality]/` on branch `ORCH-1061-curated-variety-quality`
**Implement commits:** `aba3d22b7` (logic) + `b62753063` (lint-clean tests/report)
**Test commit (this phase):** `fec7d3f9e` (adversarial deno tests + QA)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1061_CURATED_VARIETY_QUALITY_SOLO_HOURS.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1061_CURATED_VARIETY_QUALITY_SOLO_HOURS.md`

---

## VERDICT: PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 (pre-existing, inherited — not introduced by this ORCH) | **P4:** 2 (praise)
- **Regression tests:** implementor = `orch_1061_blend_and_rotation.test.ts` + `curatedStopHours.test.ts` (15 tests, happy-path, implementor fails-on-revert cited at base `ab839a953`); tester = `orch_1061_blend_rotation.adversarial.test.ts` + `curatedStopHours.adversarial.test.ts` (10 tests, adversarial — different angles). Both sides present in `git diff origin/main...HEAD --name-only`.
- **Sim evidence:** EXEMPT — backend/edge-function-only change (Phase 0.A exemption). No client code changed. The live new-behavior smoke is a POST-DEPLOY operator-assisted step (edge fns not yet deployed; prod still runs old logic). See §6.

---

## 1. Comms ledger

Read on entry. Acknowledged **COMMS-0002** (ORCH-0863 strict-grep backend allowlist — my two adversarial filenames are already in the `ORCH_1061_BACKEND_ALLOWLIST` block at gate lines 1345 + 1347; the gate runs GREEN, C7 reports 0 offenders) and **COMMS-0003** (external-API docs — N/A; this ORCH introduces no external-API enum/payload/endpoint; PART 1A/1B are pure arithmetic, PART 2 parses internally-stored hours strings). No new ledger entry needed — no cross-ORCH discovery.

---

## 2. Independent test results (re-run, not trusted from the report)

Runner: Deno 2.7.14 (`/Users/sethogieva/.deno/bin/deno`), `--allow-read --allow-env --no-check`.

| Suite | Tests | Result |
|---|---|---|
| `orch_1061_blend_and_rotation.test.ts` (implementor happy) | 10 | 10 passed |
| `curatedStopHours.test.ts` (implementor happy) | 5 | 5 passed |
| `orch_1061_blend_rotation.adversarial.test.ts` (tester) | 5 | 5 passed |
| `curatedStopHours.adversarial.test.ts` (tester) | 5 | 5 passed |
| `discover-cards/__tests__/` regression (T-2-06) | 48 | 48 passed |
| **TOTAL (single combined run)** | **73** | **73 passed / 0 failed** |

- `deno check` clean on `_shared/curatedStopHours.ts`, `generate-curated-experiences/index.ts`, `discover-cards/index.ts`, and both new adversarial test files.
- `deno lint` clean on both new adversarial test files.
- `deno lint` is NOT a CI gate for `supabase/functions/` (baseline `no-explicit-any` house style); `deno check` is the real type gate and passes.

### 2.1 Tester adversarial coverage (different angle than implementor)

| Test | Angle attacked (distinct from happy-path) |
|---|---|
| T-1A-02 | Pure-nearest would have **decisively lost** — nearest candidate is the **worst** (on-top, lowest rank/rating), proving the blend changed the pick, not just tie-broke. 3-element realistic pool. |
| T-1A-04 | The **full** tie-break chain — every rung exercised individually (`_rankScore` dominates rating+reviews; rating beats review_count; review_count; lexicographic id final arbiter; total-tie stability) + end-to-end order-independence through `selectBlendedStop`. |
| T-1B-03 | Proves rotation is the **FOOD slot, NOT the anchor** — anchor constant across the whole list (5 seeds), all 3 foods appear, adjacent foods differ. Attacks the "accidentally rotated nature" failure. |
| T-1B-05 | Start offset follows the locked `seed % groupCount` formula (independently predicted), across 7 seeds, plus **negative/NaN seed coercion** determinism (collab-agg defense). |
| T-1B-06 | Source-grep: NO `Math.random(` call in `buildDeterministicComboList`/`mainActivitySlotIndex`/`selectBlendedStop`/`tieBreakWins` (comment-stripped); `shuffle()` deleted; comboList built by the deterministic builder. (I-COLLAB-DECK-DETERMINISM) |
| T-2-03 | Honest-unknown across **every** no-data shape (absent / empty object / null / string / empty-periods-array / missing-day-text / ALWAYS_OPEN). Attacks the "fabricate closed" failure (Constitution #9). |
| T-2-04 | D-1 periods CLOSED detection + **boundary correctness** (open at 09:00, closed at 17:00 half-open) + **wrong-day** closed + legacy `_periods` + explicit "Closed" text. Fails-on-revert. |
| T-2-04b | A **downstream** stop closed at projected arrival (after dwell+travel accumulation) drops the card; control proves no over-pruning. |
| T-2-05 | Single source of truth — neither consumer redefines the cascade; both import the shared module. |
| T-2-01 | Solo handler **wiring** fails-on-revert — the load-bearing `cards = filterCuratedByStopHours(...)` call + start-time source + empty-summary fallback. |

---

## 3. Fails-on-revert proofs (performed BY the tester, this phase)

I independently reverted each of the two highest-risk production changes, ran the dependent test, observed FAIL, restored, observed PASS. Production code is byte-identical to HEAD afterward (verified `git status --short` shows ONLY the two new untracked/committed adversarial test files; no production file modified).

### 3.1 T-2-04 — D-1 periods-shape fix (`_shared/curatedStopHours.ts`)

- **Revert method:** in-place edit — deleted Path A (`periods`) + Path B (`_periods`) blocks from `isStopOpenAtHour`, leaving the pre-fix text-only reader. Backup `/tmp/curatedStopHours.ts.bak`; base HEAD = `aba3d22b7`.
- **Reverted run:** `T-2-04 ... FAILED` + `T-2-04b ... FAILED` — `AssertionError: D-1: periods-shape stop closed at 18:00 must read CLOSED (pre-fix: false-OK open)`. With Path A/B gone, the closed periods-shape stop falls through to honest-unknown → OPEN → card NOT dropped (the exact bug).
- **Restored run:** `4 passed | 0 failed`. `git diff --stat` on the file = empty (byte-identical).

### 3.2 T-2-01 — solo `filterCuratedByStopHours` wiring (`generate-curated-experiences/index.ts`)

- **Revert method:** in-place edit — replaced the handler line `cards = filterCuratedByStopHours(cards, curatedUtcNow);` with `void curatedUtcNow;` (the solo gap as it existed pre-ORCH). Backup `/tmp/gce-index.ts.bak`.
- **Baseline (real wiring):** `T-2-01 ... ok`.
- **Reverted run:** `T-2-01 ... FAILED` — `AssertionError: solo handler must call cards = filterCuratedByStopHours(cards, ...) — removing this reverts the solo gap`.
- **Restored run:** `5 passed | 0 failed`. `git status --short` confirms no production file modified.

(The implementor additionally cited fails-on-revert for T-1A-01 + T-2-01 at base `ab839a953` in the implementation report §4 — I did not re-run those, but independently proved the two highest-risk cases above.)

---

## 4. Production-diff independent confirmations (re-read `git show aba3d22b7`)

| Required confirmation | Result | Evidence |
|---|---|---|
| (a) First non-optional stop selection UNCHANGED | CONFIRMED | `index.ts:915-918` — `isFirstMainStop ? available[0] : selectBlendedStop(...)`. PART 1A touches only the `else` (post-anchor) branch in both the standard (`clampedRadius`) and reverse-anchor (`3000`) call sites. |
| (b) No request-time `Math.random` in ordering/selection path (I-COLLAB-DECK-DETERMINISM) | CONFIRMED | `selectBlendedStop`, `tieBreakWins`, `buildDeterministicComboList`, `mainActivitySlotIndex` are pure; `shuffle()` deleted. The 3 remaining `Math.random` uses (tagline pick L621, card `id` suffix L637, cosmetic `matchScore` L657) are display/identity-noise, do NOT affect deck ordering/place selection — carved out by spec §5.5 and verified by T-1B-06. **Net improvement to determinism** (the shuffle was the only ordering randomness; it's gone). |
| (c) Every preserved gate (spec §7) still fires | CONFIRMED | filterMin + G3 photo → `signalRankFetch.ts` NOT in the diff (untouched). Fine-dining ≥'bougie' floor → `index.ts:898` inside the `available` filter BEFORE selection. Per-stop budget → `index.ts:895`. Travel constraint ×1.5 → `index.ts:955`. Dedup (`comboUsedIds`/`globalUsedPlaceIds`/`failedAnchorIds`) → `index.ts:768/775/796/810/823/853`. Reverse-anchor failed-anchor cycle → `index.ts:860/870`. Empty→summary → preserved + extended for hours-empty. |
| (d) Hours cascade in EXACTLY ONE file | CONFIRMED | `function isStopOpenAtHour`/`filterCuratedByStopHours`/`parseHoursText`/`parseSingleRange`/`hourInRanges` defined ONLY in `_shared/curatedStopHours.ts`. `discover-cards` imports all 8 symbols; `generate-curated` imports `filterCuratedByStopHours`. No duplicate defs (verified by grep + tester T-2-05). |

---

## 5. Constitution scan (14 rules)

| Rule | Verdict | Note |
|---|---|---|
| #2 One owner per truth | PASS | Hours cascade now single-source in `_shared/curatedStopHours.ts`. |
| #3 No silent failures | PASS | Filter is pure; no swallowed catches added. |
| #6 (single source of truth, per spec usage) | PASS | One parser shared by curated + `filterByDateTime`. |
| #9 No fabricated data | PASS | Honest-unknown → OPEN (never fabricate closed); `isOpenNow` stays null when unknown. Verified by adversarial T-2-03. |
| #13 Exclusion consistency | PASS | Solo + collab now share the SAME hours cascade; generation/serving aligned. |
| Others (#1,#4,#5,#7,#8,#10,#11,#12,#14) | N/A | No UI / state / auth / currency / hydration / dead-tap surface touched (server-only). #7: no `[TRANSITIONAL]` dead code — `selectClosestHighestRated` + `shuffle()` were DELETED, not left dangling. |

---

## 6. Cross-platform / forward-compat assessment

**Affected surfaces:** Consumer iOS + Consumer Android only (shared edge fn, zero client code). Parity automatic.

### 6.1 Payload-forward-compat (source-verifiable, HIGH confidence)

The change adds three additive top-level fields to the curated card: `utcOffsetMinutes`, `lat`, `lng` (`buildCardFromStops`, from the first main stop).

- `app-mobile/src/types/curatedExperience.ts` `CuratedExperienceCard` is a plain TS `interface` consumed from JSON. It does NOT declare the new fields, but TS interfaces are structurally open at runtime — extra JSON keys are ignored.
- `app-mobile/src/services/deckService.ts` consumes `response.cards` by reading named fields. **No runtime schema validation** (verified: zero `zod`/`safeParse`/`Object.keys`-iteration/`assertCurated` in deckService) → unknown top-level keys cannot crash the parser or renderer.
- `utcOffsetMinutes` already exists at the STOP level (`CuratedStop.utcOffsetMinutes`) — the concept is familiar; only the card top-level is new.
- The client already sends `datetimePref` + `batchSeed` (confirmed at the deckService call site), so PART 1B/PART 2 inputs require no client change.

**Conclusion:** the additive fields are forward-compatible with the existing mobile parser. **Confidence: HIGH** (this is type/serialization source-reasoning under the backend-only exemption, not a UI/runtime behavior claim).

### 6.2 Live new-behavior smoke — POST-DEPLOY operator-assisted (NOT faked)

The new behavior (quality-blended stops, deterministic rotation, solo hours filtering) only manifests once `generate-curated-experiences` + `discover-cards` are DEPLOYED. The orchestrator deploys post-merge; the tester must NOT deploy. Prod currently runs the OLD logic, so a sim run today would only confirm the existing deck renders (a regression check against unchanged prod behavior), not the new behavior. Per the simulator-repro rule, source-only reasoning caps at "suspected" for runtime — so I am explicitly marking the live new-behavior verification as a **post-deploy operator step**, NOT claiming a sim repro I did not perform.

**Recommended post-deploy smoke (for the orchestrator/operator):** after deploying both edge fns, open a curated deck on an iOS sim AND an Android emulator; confirm (1) the deck still renders with no crash, (2) consecutive cards of the same intent show different main activities (rotation), (3) at a late `datetimePref` (e.g. 23:00) curated cards with closed stops are pruned (solo hours gate). Also eyeball that collab curated decks are not OVER-pruned (the D-1 fix now actually filters collab periods-shape rows — implementation report §8 flagged this expected behavior change on the collab path).

---

## 7. Findings

### P3-01 (PRE-EXISTING, inherited — NOT introduced by this ORCH) — `filterCuratedByStopHours` does not advance the day across midnight
`filterCuratedByStopHours` (`_shared/curatedStopHours.ts:206-219`) advances `currentHour` cumulatively but never advances `localDay`. A multi-stop curated plan that crosses local midnight evaluates the later stop's hours against the START day. This is extracted **byte-for-behavior** from the original `discover-cards` implementation (spec §6.2 mandates verbatim extraction) — it is PRESERVED behavior, not a regression. The overnight wraparound IS handled within a single day (`closeH += 24`), so the typical evening outing is correct; only a plan spanning past 24:00 into the next calendar day is affected. **Recommendation:** out of scope for ORCH-1061 (would change behavior the spec locked as a pure move); register as a future hardening ORCH if curated plans routinely cross midnight. Does NOT block.

### P4-01 (praise) — Tie-break determinism is textbook
`tieBreakWins` gives a fully-ordered, pool-independent arbiter (down to lexicographic `google_place_id`), so `selectBlendedStop` is order-independent — exactly what the collab-determinism contract needs. Verified order-independent in T-1A-04.

### P4-02 (praise) — `import.meta.main` testability guard
Exporting `handler` + guarding `serve(handler)` behind `import.meta.main` (matching check-launch-city) made the pure helpers unit-testable without booting the HTTP server, with zero production behavior change (entry module → `import.meta.main` true). Clean, idiomatic.

---

## 8. Spec success-criteria compliance (independently verified)

All 17 SCs (SC-1A-1..4, SC-1B-1..6, SC-2-1..7) verified PASS — each backed by a re-run test (happy and/or adversarial) listed in §2, plus the production-diff confirmations in §4. The implementor's §3 traceability table is accurate; I re-ran every cited test rather than trusting the table.

---

## 9. /goal self-assessment (machine-verified, not honor-system)

1. **Every independent test green — paths + output captured** — YES. 73/73 in a single combined run (§2); output captured.
2. **`deno check` clean + lint clean on touched files** — YES. `deno check` green on all 3 production files + both adversarial tests; `deno lint` clean on both adversarial tests (the real CI gate for edge fns is `deno check`). Output captured.
3. **Both regression tests in `git diff origin/main...HEAD --name-only`; adversarial attacks a different angle; implementor fails-on-revert at a cited commit** — YES. All four test files present in the diff (§verified); adversarial angles distinct (§2.1); implementor fails-on-revert cited at `ab839a953`; tester independently proved fails-on-revert for the two highest-risk cases at HEAD `aba3d22b7` (§3).
4. **UI/runtime platform legs at `proven`** — N/A by exemption. Backend/edge-function-only change (Phase 0.A exemption); zero client code. Forward-compat assessed source-only at HIGH confidence (§6.1); live new-behavior smoke explicitly deferred to a POST-DEPLOY operator step, not faked (§6.2).
5. **Zero open P0 and zero open P1** — YES. 0 P0, 0 P1. The single P3 is pre-existing inherited behavior the spec locked as a verbatim move.

All five clauses hold → **PASS**.

---

## 10. Discoveries for orchestrator

- **D-1 fix changes the COLLAB path too** (not just solo): before this ORCH the collab curated-hours filter was a near-no-op (text-only reader vs periods-shape data). After deploy, collab curated decks will now correctly drop closed-on-arrival cards that previously slipped through. Expected + correct, but it IS a real behavior change on the collab path — the post-deploy smoke (§6.2) should confirm collab decks are not over-pruned.
- **Deploy ordering:** both `generate-curated-experiences` AND `discover-cards` must be redeployed together (the new `_shared/curatedStopHours.ts` bundles into both). No `supabase db push` (zero migrations).
- **Pre-existing midnight-rollover behavior** (P3-01) preserved verbatim — candidate for a future hardening ORCH, not a blocker here.

---

## 11. Routing

Route back to **mingla-orchestrator (CLOSE)**: rebase onto current `origin/main`, run the pre-merge gate (all required checks green incl. ORCH-0863 strict-grep, mergeable CLEAN, not BEHIND), `--squash` merge, confirm `origin/main` advanced to the squash commit + content probe, THEN deploy `generate-curated-experiences` + `discover-cards` from updated main (per COMMS-0015 / ship-verify-merge-before-reap), THEN run the post-deploy smoke (§6.2), THEN reap.
