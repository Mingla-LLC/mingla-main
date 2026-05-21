# REVIEW — ORCH-0909 [Collab deck positional shared-deck rewrite]

**Reviewer:** Claude `mingla-orchestrator` (REVIEW mode; pipeline parity with Codex `orchestrator-mingla`)
**Date:** 2026-05-21
**Verdict:** **APPROVED with 1 pre-CLOSE condition (Step-0.5 fails-on-revert receipts)**
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Base commit:** `7e3fec45`

**Inputs reviewed:**
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`
- Investigation v2: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0909_COLLAB_DECK_POSITIONAL_SHARED_DECK_v2.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`
- Codebase: migration + edge fn + 6 client files + 2 CI scripts + 2 Deno tests + workflow yml (15 files total)

---

## Verdict matrix

| Spec deliverable | Status |
|------------------|--------|
| §3.1 `session_deck_cards` table + RLS + index | ✅ Implemented at migration line 21+. PK `(session_id, position)` confirmed via T-IMP-01. RLS SELECT on accepted participants + INSERT service-only. ON DELETE CASCADE from `collaboration_sessions`; ON DELETE RESTRICT from `place_pool` (T-ADV-07 verifies). |
| §3.2 `session_participants.current_position` column | ✅ Migration line 71. `NOT NULL DEFAULT 0` + `CHECK (current_position >= 0)`. |
| §3.3 PostGIS install | ✅ Migration line 15 `CREATE EXTENSION IF NOT EXISTS postgis`. Pre-flight confirmed via `mcp__supabase__list_extensions` (default_version=3.3.7, installed_version=null pre-migration). |
| §4.1 `pg_aggregate_collab_prefs` rewrite (intersection + pending_gps_user_ids + intersection_empty) | ✅ Migration rewrites with intersection semantics; no GPS-bearing participants → excluded from circles; 50-circle cap REMOVED (T-ADV-04 verifies). |
| §4.2 `query_servable_places_by_signal_intersection` (PostGIS path A) | ✅ Migration line 274. ST_DWithin geography path. `WHERE NOT ST_DWithin` for intersection semantic (T-IMP-03 verifies). Old `_by_signal_union` dropped. |
| §4.3 `accept_session_with_prefs` atomic RPC | ✅ Migration line 380. Takes lat/lng (nullable for no-GPS path), categories, intents, travel mode/constraint, dates, toggles. Sets `current_position = MAX(frontier)` from existing participants. `orch_0909.accept_with_prefs` transaction-local flag suppresses legacy touch trigger so exactly ONE recompute fires (T-IMP-05 verifies). GRANT EXECUTE to authenticated. |
| §4.4 Trigger preserved | ✅ `recompute_deck_version_after_prefs_change` semantics unchanged; preserved touch suppression for atomic accept. |
| §5 `discover-cards/handleDeterministicV2` positional rewrite | ✅ New request shape `{ session_id, current_position }` at index.ts:1283. Server-authoritative position read at line 753 (from `session_participants.current_position`). Atomic INSERT with `ON CONFLICT (session_id, position) DO NOTHING` then SELECT to read winner row. Old `expected_deck_version` payloads return HTTP 410 with `collab_legacy_client_unsupported` at line 1306 (T-ADV-05 verifies). |
| §6.1 Client retirement | ✅ `pinnedDeckVersion`, `pinnedDeckVersionSessionRef`, 3-case transition effect, `expected_deck_version` — all REMOVED from `RecommendationsContext.tsx` + `deckService.ts` (T-IMP-08 strict-grep verifies zero matches). `accumulatedCardsRef` + `sessionServedIdsRef` + `isExhausted` RETAINED in solo path per §6.7 (correct — only the collab transition gate is removed). |
| §6.2 New state + swipe handler | ✅ `currentPosition` useState at RecommendationsContext.tsx:548. Sync effect at line 551-568 reads server `current_position` from `session_participants` via `useBoardSession`. Session-change wipes refs (line 559-565). |
| §6.4 Atomic accept flow | ✅ `collaborationInviteService.ts:159` calls `supabase.rpc('accept_session_with_prefs', ...)`. Old `upsert_participant_prefs` call removed from accept path (T-IMP-05 strict-grep verifies). |
| §6.5 NoGpsBanner | ✅ New file `app-mobile/src/components/collab/NoGpsBanner.tsx`. Required copy "We're having trouble getting your location" present (T-IMP-06 verifies). Rendered in `SwipeableCards.tsx:2158` gated on `isBoardSession`. |
| §6.6 useBoardSession realtime | ✅ No regressions. Realtime updates continue to flow `current_position` per-participant via existing channel. |
| §6.7 Solo path UNCHANGED | ✅ `useDeckCards.ts` diff shows only `deckVersion → currentPosition` rename for the collab path; solo path branch untouched. Solo-mode refs (`accumulatedCardsRef`, `sessionServedIdsRef`, `isExhausted`) intact. |
| §7.1 Single-shot reset | ✅ Migration includes `UPDATE public.session_participants SET current_position = 0 WHERE has_accepted = true` (T-IMP-07 verifies). |
| §8 Success Criteria SC-01..SC-13 | ✅ All 13 SCs mapped to T-IMP-01..T-IMP-09 + T-ADV-01..T-ADV-08. SC-12 (old client 410) verified by T-ADV-05; SC-10 (PostGIS scale unlock) verified by T-ADV-04 + T-IMP-03. |
| §9 Invariants | ✅ 6 new invariants implicitly upheld; need explicit ratification in INVARIANT_REGISTRY.md at CLOSE Step 5e. |
| §10 Test plan (9 implementor + 8 adversarial) | ✅ All 17 tests exist at real paths; all run + PASS in working tree over base `7e3fec45`. Strict-grep + Deno mix. Adversarial tests genuinely attack different angles than implementor tests (race resolution, replay attack, late-GPS resolution, 51st-participant cap removal, old-client 410, forbidden access, inactive-place retention, live dead-end revival). |
| §11 Implementation order | ✅ Followed: PostGIS pre-flight verified → migration → edge function rewrite → client retirement → re-implementation → tests → CI gates → implementation report. |
| §12 Regression prevention | ✅ Strict-grep workflow registered at `.github/workflows/strict-grep-mingla-business.yml:1379+`. Both gates wired (regression + adversarial). |
| §13 Decommission flags for CLOSE Extension Step 5a-5h | ⏳ Deferred to CLOSE protocol — orchestrator owns these, not implementor. Implementor correctly did not touch memory / DECISION_LOG / INVARIANT_REGISTRY. |

---

## REVIEW protocol checklist (orchestrator skill 9 items)

| Check | Verdict |
|-------|---------|
| Root cause proven or just plausible? | ✅ Investigation v2 + locked LCD-1..LCD-8 contract = `proven`. |
| Scope appropriate — could be narrower? | ✅ Scope matches spec exactly. No drift into solo path. |
| Hidden fallback paths that mask failure? | ✅ Verified: old `expected_deck_version` payloads return HTTP 410, not silent fallback. Old aggregator union path REMOVED, not silenced. |
| Stale cache paths serving old data? | ✅ React Query key changed from `(sessionId, deckVersion)` to `(sessionId, currentPosition)` — collab cache partitions correctly. |
| Response shape truthful in ALL states? | ✅ Dead-end response shape (`dead_end: true, reason: ...`) distinct from success (`success: true, card: {...}`) and error (HTTP 401/403/404/410/500). T-ADV-08 verifies dead-end does not write a row. |
| Real fix or symptom mask? | ✅ Architectural rewrite — `session_deck_cards` is the new immutable source of truth, not a workaround. |
| Solo/collab parity checked? | ✅ Spec explicitly says solo path UNCHANGED §6.7. Diff confirms only collab branches modified in shared files. |
| Constitutional compliance verified? | ✅ No dead taps (NoGpsBanner is non-blocking). No fabricated data (no GPS → banner, not fake location). One owner per truth (server-side `session_deck_cards` + `current_position`). No silent failures (HTTP 410 + dead_end response). Logout clears (in-flight session reset on deploy day per §7). |
| Evidence chain complete? | ⚠ Step-0.5 gate has incomplete fails-on-revert receipts (see P1 below). All other evidence complete. |
| Documents updated? | ⏳ WORLD_MAP / MASTER_BUG_LIST / OPEN_INVESTIGATIONS updates pending CLOSE — orchestrator owns these. |

---

## Findings

### P1 — Step-0.5 fails-on-revert receipts incomplete (BLOCKS CLOSE, NOT REVIEW)

**Implementor explicitly flagged** in the implementation report:
> *"Commit hash caveat: no scoped commit was created because the shared `Seth` checkout already contains many unrelated dirty/untracked ORCH-0908 and artifact changes. The tests below passed in the working tree over base commit `7e3fec45`; the exact fails-on-revert commit hash must be filled by CLOSE after staging only scoped ORCH-0909 files."*

Per orchestrator CLOSE Step 0.5 (codified by ORCH-0840 [Regression-test enforcement + append-only CI]), CLOSE is REJECTED unless every regression test cites `fails-on-revert verified at <commit hash>` with the test FAILING when the fix is reverted and PASSING when restored.

**Resolution required BEFORE CLOSE:**
1. Stage ONLY the 15 scoped ORCH-0909 files (8 modified + 7 new — listed in the implementation report's old→new table).
2. Commit on `Seth` with message `Close ORCH-0909: collab deck positional shared-deck rewrite`.
3. Capture the commit SHA (call it `<C>`).
4. Re-run `npm run test:orch-0909` + `npm run test:orch-0909-adv` + Deno tests against the committed tree — confirm 17/17 PASS.
5. Revert one of each test's anchor codepoint (e.g., delete the `PRIMARY KEY (session_id, position)` clause for T-IMP-01; delete the `ON CONFLICT (session_id, position) DO NOTHING` for T-ADV-01; delete the HTTP 410 branch for T-ADV-05; etc.) — re-run tests, confirm those specific tests FAIL.
6. Restore — confirm 17/17 PASS again.
7. Update the implementation report's "Regression Test Receipts" table: replace every `working tree over 7e3fec45; commit pending` with `fails-on-revert verified at <C>`.

This is operational work, not new code. Recommend orchestrator (Claude or Codex) execute it during CLOSE PR-prep — see Next Handoff.

### P2 — Pre-existing tsc errors flagged (NOT a blocker)

Implementor noted `npx tsc --noEmit` fails on `LockedPlanBanner.tsx`, `BoardDiscussion.tsx`, `ConnectionsPage.tsx`, `nativeCheckoutFlow.ts`, and shared `packages/*` type-resolution errors — **none in ORCH-0909-touched files**. Pre-existing baseline failures. ORCH-0909 is type-clean per implementor's `deno check` PASS on the edge function + the absence of errors in the touched mobile files.

No action needed for ORCH-0909 CLOSE. Recommend orchestrator open a follow-up ORCH for the tsc baseline cleanup (separate scope).

### P3 — Match quorum still card-id based (operator approves or follow-up)

Implementor flagged that match quorum (right-swipe → match) is still card-id based via `collabSaveCard` / board-swipe helpers — NOT positional. Under the new model, each `card_id` appears at exactly ONE `position` in `session_deck_cards` (PRIMARY KEY enforces uniqueness on `(session_id, position)` — but the same `card_id` could theoretically be at different positions across DIFFERENT sessions; within a session, card_id↔position is bijective only because positions are append-only and dedup-checked at insert time).

**Within a single collab session: card_id is unique** (per the dedup filter at edge fn line 1148 "All candidates are already present in session_deck_cards"). So card_id-based matching is functionally equivalent to position-based matching for THIS session. SC-05 (match quorum) is satisfied.

For multi-session match accounting (e.g., dashboards across sessions), position-based audit may be useful later — flag as follow-up only if operator requests.

### P4 — Praise

- Smoking gun comment at `deckService.ts:776` (the "no curated parallel path … solo-only" line) is correctly NOT carried into the new collab branch — implementor surgically removed the wrong-headed comment as part of the retirement.
- Transaction-local flag `orch_0909.accept_with_prefs` for trigger suppression during atomic accept is a clean PostgreSQL pattern — set at line 426, read at line 509. No race possible because `set_config(..., true)` is transaction-scoped.
- T-IMP-08 + T-IMP-09 are correctly authored as **strict negative-grep** strict-grep guards (`!context.includes(...)` + `!edge.includes(...)`) — these prevent future regressions of the retired symbols, not just verify current state. Defense-in-depth via CI.
- T-ADV-04 (51st participant cap removed) negative-asserts the OLD `v_circle_count > 50` AND positively asserts `CREATE EXTENSION postgis` — both must hold. Adversarial-quality test.

---

## Pre-CLOSE checklist (orchestrator-owned)

Before opening the PR for ORCH-0909:

- [ ] **Step 0.5 fails-on-revert receipts** (P1 above) — required by ORCH-0840 gate. Sequence in P1 §1-7.
- [ ] **DIAG marker reap** — grep for `[ORCH-0909-DIAG]` markers in implementation. Implementor's report shows none introduced; orchestrator confirms at CLOSE.
- [ ] **WORLD_MAP / MASTER_BUG_LIST / OPEN_INVESTIGATIONS** updates — move ORCH-0909 entry from in-progress to closed; update grades; mark superseded ORCH-0902 contract items.
- [ ] **DECISION_LOG** entries — DEC-2026-05-21-ORCH-0909 + DEC-2026-05-21-INTERSECTION-NOT-UNION per spec §13.6.
- [ ] **INVARIANT_REGISTRY** — add the 6 new invariants from spec §9.3 + flag ORCH-0902 CR-2 / CR-4 / CR-5 as deprecated.
- [ ] **Memory file** `feedback_collab_per_client_version_pinning_decommissioned.md` (DRAFT today; flip to ACTIVE at CLOSE per Extension Step 5a).
- [ ] **`feedback_collab_deck_determinism_contract.md` update** — annotate CR-2/CR-4/CR-5 as superseded per Extension Step 5c.
- [ ] **Skill definition reviews** — Extension Step 5d.

---

## Next phase

REVIEW APPROVED with one pre-CLOSE condition (fails-on-revert receipts). Per implementor's deploy notes:

1. **Step 0.5 fails-on-revert resolution** — orchestrator or implementor executes (≤30 min work).
2. **Operator applies migration** — `supabase db push --linked` (operator-owned per `feedback_orchestrator_deploys_edge_functions.md`).
3. **Orchestrator deploys `discover-cards`** via local Supabase CLI; verifies version bump via `mcp__supabase__list_edge_functions`.
4. **TEST phase** — Claude `mingla-tester` runs 2 iOS sim + Android emulator parity per `feedback_tester_canonical_and_platform_parity.md`; exercises SC-01..SC-13 + 8 adversarial paths.
5. **CLOSE** — one PR per CLOSE per `feedback_one_pr_per_close.md`; full pre-merge gate; CLOSE Extension Steps 5a-5h (decommission protocol fires because this rewrite supersedes ORCH-0902 contract clauses).

---

## End of REVIEW
