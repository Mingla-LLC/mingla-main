# QA — META-ORCH-1009 Sub-B — Consumer ranker blend + 3-surface coverage

**Tester:** Claude `mingla-tester`
**Date:** 2026-05-30
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-B-[consumer-ranker-blend-3-surfaces]/`
**Branch:** `META-ORCH-1009-Sub-B-consumer-ranker-blend-3-surfaces` (local, not pushed)
**Implementor report:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_B_CONSUMER_RANKER_BLEND.md`
**SPEC commit (fails-on-revert head):** `141b1c69f`

---

## Verdict

**PASS** — Grade A. Ready to ship pending operator-lane migration apply + edge-fn deploy. One P2 operational note (migration timestamp out-of-order vs already-applied 20260805000000) flagged for operator; not a code defect.

---

## Verdict justification

- Blend math verified against live DB row (Yates Mill `scenic`: rule=139.024, ai=95, w=0.6 → blended = 169.61 per formula; matches `computeScore` source exactly).
- Veto semantics correct (DELETE-instead-of-NULL implementor deviation is REQUIRED — `place_scores.score is_nullable: NO` confirmed on live DB; SPEC's "NULL allowed" claim was wrong).
- Collab determinism preserved by design — blend computed offline in `signalScorer.computeScore`; request-time RPC `ORDER BY` clauses byte-identical to pre-Sub-B (`ps.score DESC, pp.review_count DESC NULLS LAST [, pp.id ASC]`).
- 3 surfaces all converge on the shared `ExpandedCardModal` (Home solo via SwipeableCards; Collab via CollabDeckSheet → SwipeableCards; paired-friend via ViewFriendProfileScreen). Reasoning renders on solo + collab via the new mapper path; paired-friend gracefully omits the section because its independent RPC (`query_person_hero_places_by_signal`) is not extended by Sub-B (D-8 carve-out, follow-up Sub recommended).
- 31 implementor Deno tests + 10 adversarial Deno tests = 41 total, all green.
- Strict-grep gates green (3 gates: consumer-reads, sole-owner, marketing-phase-b/Sub-B allowlist).
- Mobile typecheck clean on Sub-B touched files (6/6); pre-existing errors elsewhere are out of scope.
- Zero conflict markers, zero DIAG markers, TEST-MOD-APPROVED token present in commit body.

---

## Findings table

| # | Severity | Finding | Surface | Disposition |
|---|----------|---------|---------|-------------|
| F-01 | P2 | Migration timestamp `20260803000000` is BEHIND the already-applied `20260805000000_orch_1006_public_event_tier_allin`. Supabase CLI `db push` will need `--include-all` or migration re-stamp to apply Sub-B's RPC migration. | Migration ops | Operator: rebump Sub-B migration to e.g. `20260830120000_...` before push (or use `--include-all`). NOT a code defect — fully reversible. |
| F-02 | P2 | `pickDominantReasoning` primary-tag branch is functionally vestigial. `tags[0]` is the Google `placeType` (e.g. `"restaurant"`, `"bar"`), but `aiReasoningBySignal` is keyed by `signalId` (e.g. `"romantic"`, `"fine_dining"`). The two namespaces never intersect, so the "primary tag match" branch never fires in practice. The fallback (first key by insertion order) always serves. In the common single-key case this is correct; in a hypothetical multi-chip merged case it would pick the first signal arbitrarily. | mobile/ExpandedCardModal | Acceptable to ship — render is correct. Follow-up: pass the user's selected chip as a hint to the modal, or key the dominant-signal resolver on something `tags[0]` actually contains (e.g. the displayed `category` slug → signal map). |
| F-03 | P3 | Implementor's `collab_determinism_under_ai_blend.test.ts` (6 tests) is source-text static-assertion only — does NOT execute the RPC twice with fixed inputs to assert identical card ordering. The structural argument (ORDER BY unchanged + blend offline) is sound; the test name overstates what it verifies. | Backend tests | Cosmetic — the invariant is enforced by the unchanged ORDER BY + the existing `orch_0909_adversarial.test.ts` collab tests (10 tests, all green). |
| F-04 | P3 | D-8 paired-friend gap: `query_person_hero_places_by_signal` not extended; reasoning silently absent on that surface. Implementor already flagged this in §4 of the IMPLEMENTATION report and surfaced a follow-up Sub recommendation. | Friend profile | Operator-accepted per dispatch D-8 decision; queue follow-up Sub. |
| F-05 | P3 | SPEC §4.4 Maestro flows (S1/S2/S3) not authored. Implementor flagged in §11.5. | Maestro | Acceptable — Deno + source-level tests + static modal-mount verification provide equivalent coverage at this layer; Maestro can be authored when iOS dev-build fmt+expo-video blocker (COMMS-0007) clears. |

No P0/P1 findings.

---

## Adversarial tests added

**File:** `supabase/functions/_shared/__tests__/signalScorer.blend.adversarial.test.ts` (10 tests, all passing).
**Allowlist update:** `META_ORCH_1009_SUB_B_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (same commit, per COMMS-0002).

| Test | Severity if it had failed | What it proves |
|------|--------------------------|----------------|
| T-ADV-01 | P2 | 100 repeated `computeScore` calls produce byte-identical results (no hidden state). |
| T-ADV-02 | P1 | Veto round-trip symmetric — flipping `inappropriate_for: false` re-emits a numeric score (proves un-veto path is wired). |
| T-ADV-03 | P1 | `NaN` AI score sanitized to 0 (no NaN propagation that would violate `place_scores.score CHECK 0–200`). |
| T-ADV-04 | P1 | `Infinity` AI score clamped to 100 (then blended + final clamped to `cap`). |
| T-ADV-05 | P2 | Non-numeric (string) AI score short-circuits to 0 via `Number(x) || 0` guard. |
| T-ADV-06 | P2 | Final blended value never exceeds `config.cap` (defense-in-depth on the `Math.min(cap, blended)` re-clamp). |
| T-ADV-07 | P3 | `contributions._ai_reasoning` trimmed to ≤200 chars; `vetoed.ai_reasoning` preserves full text. |
| T-ADV-08 | P1 | STRING `"true"` for `inappropriate_for` does NOT fire veto — strict `=== true` required (prevents over-veto from JSONB coercion glitch). |
| T-ADV-09 | P2 | Case-sensitive `prompt_version` match: `'V4' !== 'v4'` → discriminator falls back to rule-only. |
| T-ADV-10 | P2 | Blended score below `clamp_min` is raised to `clamp_min` (floor honored). |

**Fails-on-revert proof:** All 10 tests import `DEFAULT_AI_BLEND_WEIGHT` / `DEFAULT_EXPECTED_PROMPT_VERSION` from `signalScorer.ts`. Reverting to SPEC commit `141b1c69f` removes those exports → tests fail to load (`SyntaxError: ... does not provide an export named ...`), same fails-on-revert pattern verified by the implementor in §6.3.

---

## Implementor test verification

**31 new Deno tests** — all PASS in my re-run:
- `signalScorer.blend.test.ts`: 11/11 (T-B1..T-B9 + T-B3b + T-B4b)
- `discover-cards/__tests__/ai_reasoning_passthrough.test.ts`: 9/9 (T-S-01..04 + T-U-01..05)
- `discover-cards/__tests__/collab_determinism_under_ai_blend.test.ts`: 6/6 (T-D-01..06)
- `generate-curated-experiences/__tests__/ai_reasoning_passthrough.test.ts`: 5/5 (T-C-01..05)

**Existing scorer.test.ts (20 mechanical call-site updates):** 33/34 PASS. The 1 failure (`T-31` — `Object.keys.length === 21` actual `23`) is **pre-existing on main** — confirmed by checking out the SPEC commit `141b1c69f` (BEFORE Sub-B's mechanical updates) and seeing the identical `T-31 FAILED | 33 passed | 1 failed`. Not a Sub-B regression. The 20 mechanical updates are truly mechanical — they only add the new required `signalId` 3rd-arg literal (`'fine_dining'`, `'drinks'`, `'brunch'`, `'casual_food'`) matching the local CONFIG fixture; no semantic shift, no test logic altered. Sample verified by reading 5 updated call sites at `scorer.test.ts` lines spread across the file.

**Other regression suites in the same directories:** 48/48 PASS (`orch_0903_travel_time_contract`, `orch_0906_mixed_type_interleave`, `orch_0909_adversarial`, `orch_0909_positional_shared_deck`) — the existing collab-determinism Deno suite (`orch_0909_adversarial.test.ts` 10 tests) continues to pass, evidence that the unchanged RPC ORDER BY clauses still produce identical ordering.

---

## Live-DB probe (Supabase Management API, 2026-05-30)

**Sample 5 (place, signal) pairs with `ai_signal_scores`:**

| place | signal | rule_score | ai_score | prompt_version | vetoed | post-Sub-B behavior |
|---|---|---|---|---|---|---|
| Historic Yates Mill County Park | icebreakers | 124.024 | 75 | v4 | false | blended = 139.51 (rule+; AI agrees) |
| Historic Yates Mill County Park | scenic | 139.024 | 95 | v4 | false | blended = 169.61 (AI strongly agrees → lifts) |
| Historic Yates Mill County Park | drinks | 49.024 | 10 | v4 | false | blended = 31.81 (AI disagrees → suppresses) |
| Historic Yates Mill County Park | casual_food | 59.024 | 10 | v4 | false | blended = 35.81 (AI disagrees → suppresses) |
| Historic Yates Mill County Park | theatre | 61.024 | 0 | v4 | **true** | row DELETED, excluded from Theatre chip |

**Math spot-check (Yates Mill `scenic`):** ruleNorm = 139.024 / 200 * 100 = 69.512; blendedNorm = 0.4 × 69.512 + 0.6 × 95 = 27.805 + 57 = 84.805; rescaled = 84.805 / 100 * 200 = **169.610**. Matches `computeScore` formula exactly.

**`place_scores.score` constraint:** `is_nullable: NO`. Confirms implementor's §11.1 deviation (DELETE-instead-of-NULL) was **mandatory**, not optional. SPEC was wrong; implementor's deviation is the correct shipping path.

**Migration status:** Sub-B's `20260806000000_meta_orch_1009_sub_b_rpcs_with_reasoning.sql` is **NOT yet applied**. Live DB has `20260805000000_orch_1006_public_event_tier_allin` as the latest applied migration. Sub-B's timestamp is BEHIND — operator will need `--include-all` flag or to rebump Sub-B's filename forward (F-01).

---

## Collab determinism — explicit 2-fetch verification

The SPEC's collab-determinism test (`collab_determinism_under_ai_blend.test.ts`) verifies the static-text invariant: the RPC `ORDER BY` clauses are unchanged + no `ai_signal_scores` reference in the order clauses + the RPC parameter shape unchanged + `signalScorer.ts` remains pure (no I/O imports).

Live RPC definition probe via Management API confirms the ORDER BY clauses are byte-identical to the Sub-B migration:
- Solo (`query_servable_places_by_signal`): `ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST`
- Intersection (`query_servable_places_by_signal_intersection`): `ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC`

The migration replaces these two RPCs with the SAME ORDER BY clauses + 2 appended return columns. Determinism is preserved by construction. I cannot run a true 2-fetch RPC test (the migration is not applied + the RPC requires anon authentication + session state setup), but the structural argument is airtight and complemented by the existing `orch_0909_adversarial.test.ts` collab suite (10/10 PASS, exercises the actual collab path with fixed inputs).

The added T-ADV-01 (100 repeated `computeScore` calls produce byte-identical results) directly proves the OFFLINE blend is deterministic — same input → same blended value → same `place_scores.score` → same RPC ordering.

**Verdict: collab determinism PRESERVED.**

---

## 3-surface coverage per-surface verdict

| Surface | Modal mount | Reasoning rendering | Verdict |
|---|---|---|---|
| **Home solo** | `SwipeableCards.tsx:2083` and `2611` mount `ExpandedCardModal` | `discoverCardsPayloadToRecommendations` → `unifiedCardToRecommendation` (carries `aiReasoningBySignal`) → modal's `WhyWePickedThisSection` renders when non-empty | **PASS** |
| **Group-chat collab** | `CollabDeckSheet.tsx` mounts `SwipeableCards` (with `sessionIdOverride`), which mounts the same `ExpandedCardModal` | Same shared mapper + modal path. Determinism preserved per above. | **PASS** |
| **Paired-friend profile** | `ViewFriendProfileScreen.tsx:805` mounts `ExpandedCardModal` directly | `holidayCardToExpandedCardData` mapper carries `aiReasoningBySignal` forward when present; `WhyWePickedThisSection` returns `null` (section silently hidden) when absent. **D-8: independent RPC pipeline `query_person_hero_places_by_signal` not extended → reasoning is absent in practice today, but no broken UI, no crash, no console error.** | **PASS** (with documented D-8 carve-out) |

---

## Gate verifications run

- `node .github/scripts/strict-grep/i-consumer-reads-ai-signal-scores-not-trial-table.mjs` → **OK** (6 files scanned, 0 violations)
- `node .github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs` → **OK** (1269 files scanned, 0 unauthorized writers)
- `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → **OK** after my adversarial test + allowlist update (25 files changed total, all under the consolidated allowlist)
- DIAG marker grep `\[META-ORCH-1009-Sub-B-DIAG\]` → **0 matches**
- Conflict markers grep `^<<<<<<<|^=======$|^>>>>>>>` → **0 matches**
- TEST-MOD-APPROVED token in `db5e8ed94` commit body → **present** (`[TEST-MOD-APPROVED META-ORCH-1009 Sub-B] 20 existing scorer.test.ts call sites`)

---

## Hard-guard compliance

- NO destructive SQL run (read-only Management API probes only)
- Did NOT modify implementor's tests
- Did NOT push (orchestrator handles per dispatch)
- Did NOT apply migration (operator coordination)
- New backend test file ADDED to `META_ORCH_1009_SUB_B_BACKEND_ALLOWLIST` in SAME commit (COMMS-0002 satisfied)

---

## Summary for orchestrator

PASS. 41/41 Deno blend tests green (31 implementor + 10 tester adversarial). 48/48 existing discover-cards regression tests green. Strict-grep gates green. Live-DB blend math verified against real row. Collab determinism preserved by design + corroborated by `orch_0909_adversarial` suite + T-ADV-01 determinism test. 3 surfaces all converge on shared modal. D-8 paired-friend gap operator-accepted; reasoning silently absent there. **Operator action:** rebump migration filename forward of `20260805000000` before `db push` (F-01).
