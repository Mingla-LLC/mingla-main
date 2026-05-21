# REVIEW — ORCH-0909 [Collab deck positional shared-deck rewrite] + ORCH-0906 [Collab deck single↔intent strict-1:1 alternation with per-pill round-robin, server-side merge] BUNDLE

**Reviewer:** Claude `mingla-orchestrator` (REVIEW mode; pipeline parity with Codex `orchestrator-mingla`)
**Date:** 2026-05-21
**Verdict:** **APPROVED.** Step 0.5 gate fully cleared. Ready for operator `supabase db push --linked` of the new amendment migration.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Bundle commit:** `18e6b7920a88f422f6451fab0493d229bef3cc39` (13 scoped files, +753/-127)
**Receipts commit:** `701e78e6` (4 amendment fails-on-revert receipts at `18e6b792`)
**Parent commit:** `2a9478eda05fe8ab06465dbfd9db00d3eeda59b3` (ORCH-0909 parent, 17 tests verified at this SHA)
**Parent receipts commit:** `a4193f5c`

**Inputs reviewed:**
- Parent spec: `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`
- Amendment spec: `Mingla_Artifacts/specs/SPEC_ORCH-0909_AMENDMENT_ORCH-0906_SINGLE_INTENT_INTERLEAVE.md`
- ORCH-0906 IA investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0906_SINGLE_INTENT_INTERLEAVE_FEASIBILITY.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` (updated to cover both scopes)
- Prior parent REVIEW: `Mingla_Artifacts/reports/REVIEW_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`
- Prior parent QA: `Mingla_Artifacts/reports/QA_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK_REPORT.md`
- Code: new migration + new helper + 2 modified edge functions + 1 modified client service + 3 modified CI scripts + 1 modified workflow + 1 new Deno test
- Independent test runs: regression 11/11 PASS, adversarial 10/10 PASS, Deno 23/23 PASS, resurrection gate PASS

---

## Verdict matrix (amendment scope only)

| Amendment deliverable | Status |
|------------------------|--------|
| §3.1 ALTER `session_deck_cards` (card_id nullable + card_type + curated_payload + pill_label + degraded_from + sdc_exactly_one_payload CHECK) | ✅ Implemented in NEW migration `20260703000000_orch_0906_session_deck_cards_mixed_type.sql` (NOT amended into the live `20260701000000` per REVIEW clarification ORCH-0906-REVIEW-1) |
| §3.2 NEW `session_curated_cache` table + RLS + index | ✅ In the same new migration |
| §4 `pg_aggregate_collab_prefs` delta = no change | ✅ Aggregator untouched (spec said no change needed) |
| §5.1 `generate-curated-experiences` accepts `excludePlacePoolIds` param | ✅ Verified: body destructure at line 1234; threaded through `generateCardsForType` → `fetchSinglesForSignalRank` via `signalRankFetch.ts:29,173,200` |
| §5.2 `fetchCuratedBatchInternal` in `discover-cards/index.ts` | ✅ Verified at edge fn line 662; signature includes `callerJwt` param |
| §6.1 NEW `_shared/mixedTypeInterleave.ts` with deterministic odd=single/even=curated | ✅ Verified file exists; T-IMP-11 strict-grep PASS asserting `position % 2 === 0` + per-pill independent rotation |
| §7.1 NEW `handleCuratedPosition` | ✅ Verified at edge fn line 1067 + 1386 |
| §7.2 D7 graceful-degrade | ✅ T-ADV-09 PASS verifies `degraded_from text NULL` column + `degraded_from_intent` + `exhausted_intent` + `all_pools_exhausted` in edge fn |
| §7.3 JWT forwarding | ✅ Verified at edge fn line 673: `Authorization: Bearer ${args.callerJwt}` — caller's user JWT, NOT service_role; preserves session-aware RLS |
| §7.4 Hydration delta — curated rows hydrate from `curated_payload` jsonb | ✅ Verified at edge fn line 893-894: `if (row.card_type === 'curated' && row.curated_payload) return row.curated_payload;` |
| §8 Client renderer reuse | ✅ Verified: `SwipeableCards.tsx` already routes `card.cardType === 'curated'` to `CuratedExperienceSwipeCard`; no new component needed |
| §9 SC-14..SC-18 | ✅ Mapped to 4 new tests (2 regression + 2 adversarial); all PASS at `18e6b792` with fails-on-revert verified |
| §10 2 new invariants | ⏳ Implementor did not write to `INVARIANT_REGISTRY.md` (correct — orchestrator-owned at CLOSE Step 5e) |
| §11 4 new regression tests (T-IMP-10/11/T-ADV-09/10) | ✅ All committed at `18e6b792`; fails-on-revert verified per receipts table in implementation report |
| §12 Implementation order delta (4 new sub-steps 3a-3d) | ✅ Followed: NEW migration → generate-curated extension → mixedTypeInterleave helper → discover-cards branch insert + comment deletion → CI gate + tests + report |
| §13.1 Delete `deckService.ts` "solo-only" comment | ✅ Verified: 0 grep hits for "no curated parallel path" or "that pattern is solo-only" in `deckService.ts` |
| §13.2 NEW strict-grep CI gate forbidding resurrection | ✅ `app-mobile/scripts/ci/orch-0906-no-resurrected-solo-only-comment-check.mjs` + workflow job registered at `.github/workflows/strict-grep-mingla-business.yml:1401-1410` |
| §13.3-13.5 Memory + invariant + DECISION_LOG updates | ⏳ Orchestrator-owned at CLOSE Step 5a-5h |

---

## REVIEW protocol checklist (orchestrator 9 items)

| Check | Verdict |
|-------|---------|
| Root cause proven or just plausible? | ✅ ORCH-0906 investigation `proven` for D2/D3/D5/D6/D8/D9; D4 worked example pinned; D7 graceful-degrade operator-locked; D1 sim repro `probable` with named blocker (deferred to TEST phase combined run) |
| Scope appropriate — could be narrower? | ✅ Amendment scope is exactly the spec; no creep. Implementor surgically separated ORCH-0908 dirty hunks from ORCH-0906 stage. |
| Hidden fallback paths that mask failure? | ✅ T-ADV-10 explicitly asserts curated internal 5xx surfaces as `pipeline_error` (NOT swallowed); `CuratedInternalInvocationError` class is the discriminant |
| Stale cache paths serving old data? | ✅ `session_curated_cache` lifecycle is ON DELETE CASCADE from sessions; `served_card_ids` accumulates to drive cross-batch exclude; no leak path |
| Response shape truthful in ALL states? | ✅ Success / dead-end / curated / single / degraded-from-intent / degraded-from-single / all_pools_exhausted all distinct response shapes; T-ADV-09 verifies the degraded flags |
| Real fix or symptom mask? | ✅ Architectural extension — adds the missing card-type branch server-side; matches operator's locked design (A1-A4 + D7) |
| Solo/collab parity checked? | ✅ Solo path UNCHANGED (verified — `deckService.ts:fetchDeck` solo branch + `generateCuratedExperiences` direct invocation by solo unchanged); collab now mirrors solo's mixed-type behavior server-side |
| Constitutional compliance verified? | ✅ No dead taps (curated cards render via existing `CuratedExperienceSwipeCard`); one owner per truth (`session_deck_cards` + `session_curated_cache` server-side); no silent failures (T-ADV-10); subtract before adding (deleted solo-only comments before adding new comments); no fabricated data (graceful-degrade uses real fallback cards, not faked) |
| Evidence chain complete? | ✅ All 21 tests have valid receipts; all amendment deliverables traced to code |
| Documents updated? | ⏳ Orchestrator-owned at CLOSE Step 1 (WORLD_MAP / MASTER_BUG_LIST / COVERAGE_MAP / PRODUCT_SNAPSHOT / PRIORITY_BOARD / AGENT_HANDOFFS / OPEN_INVESTIGATIONS) — not blocking for this REVIEW |

---

## Findings

### P4-1 (NOTE — praise) — Clean surgical hunk separation

Implementor (Codex) correctly identified the dirty-checkout problem and refused to bundle unrelated ORCH-0908 hunks. Orchestrator (Claude) then surgically staged via `git add -p` for `generate-curated-experiences` (sequence `n y y y y q` — skip hunk 1 ORCH-0908, stage hunks 2-5 ORCH-0906) AND sed-trim-then-add for the workflow file (delete ORCH-0908 chat-mention-mute job lines from working tree, stage, restore the lines). Net result: clean `18e6b792` bundle commit containing ONLY ORCH-0906 amendment + ORCH-0909-extension hunks. The ORCH-0908 dirty hunks remain unstaged in the working tree for a separate ORCH-0908 close path. Pattern worth replicating for any future "mid-flight dirty checkout" amendment cycle.

### P4-2 (NOTE — praise) — JWT forwarding is correct, NOT service_role

`fetchCuratedBatchInternal` at `discover-cards/index.ts:662-673` invokes `generate-curated-experiences` with `Authorization: Bearer ${args.callerJwt}` — the caller's user JWT. This is the correct choice because `generate-curated-experiences` calls `pg_aggregate_collab_prefs` which has SECURITY DEFINER + relies on `auth.uid()` for RLS-bound session-participant verification. Using service_role would have stripped the RLS bound and allowed cross-session aggregation leaks. Implementor caught this exactly right.

### P4-3 (NOTE — praise) — D7 graceful-degrade implementation matches operator intent

`degraded_from` jsonb column + `degraded_from_intent` / `degraded_from_single` / `exhausted_intent` / `exhausted_category` / `all_pools_exhausted` response flags give the client + analytics the full picture of WHICH side ran dry and at WHICH pill. The deck doesn't dead-end on one-type exhaustion; it falls through to the other type with a flag explaining the substitution. Matches operator's 2026-05-21 lock exactly.

### P4-4 (NOTE — praise) — `sdc_exactly_one_payload` CHECK constraint

The CHECK at migration line ~85 enforces `(card_type='single' AND card_id IS NOT NULL AND curated_payload IS NULL) OR (card_type='curated' AND card_id IS NULL AND curated_payload IS NOT NULL)`. Bulletproof against rows that accidentally end up with both payloads or neither. Database-level invariant enforcement matches the spec's positional-immutability requirement.

---

## Pre-CLOSE checklist (orchestrator-owned, post-tester-PASS)

1. **Operator runs `supabase db push --linked`** for migration `20260703000000_orch_0906_session_deck_cards_mixed_type.sql`.
2. **Orchestrator deploys BOTH** `discover-cards` AND `generate-curated-experiences` via local Supabase CLI (`/Users/sethogieva/bin/supabase functions deploy <name> --project-ref gqnoajqerqhnvulmnyvv`) — verify version bumps via `mcp__supabase__list_edge_functions`; preserve `verify_jwt=true` on both.
3. **Claude `mingla-tester` dispatch** for combined SC-01..SC-18 across iOS sim `F7ECAC25-2A98-4002-AD17-85AED17AB752` + iPhone 17 Pro Max sim `2C3312D9-EE52-4EBD-9704-15811D49A2EC` + Android emu per `feedback_tester_canonical_and_platform_parity.md`. This is where the previously-deferred D1 sim repro happens for both ORCHs in one combined run.
4. **CLOSE protocol** post-tester-PASS: Step 1 artifact sync (7 docs), Step 1.5 DIAG reap (none expected; verify zero `[ORCH-0909-DIAG]` + `[ORCH-0906-DIAG]` matches), Step 3 EAS OTA, Step 4 announce next dispatch, Steps 5a-5h Deprecation Extension MANDATORY (supersedes ORCH-0902 CR-2/CR-4/CR-5).
5. **PR Seth → main with operator-named bundle title**: `Close ORCH-0909 + ORCH-0906: collab deck positional shared-deck + single↔intent 1:1 interleave`. Full pre-merge gate: required GitHub checks GREEN, mergeable=CLEAN, reviewDecision=APPROVED, not BEHIND, operator confirmation in chat before `gh pr merge`.

---

## Next phase

REVIEW APPROVED. No FAIL / NEEDS WORK conditions. Bundle commit `18e6b792` + receipts commit `701e78e6` are staged and ready for the operator's DB push.

---

## End of REVIEW
