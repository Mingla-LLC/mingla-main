# ORCHESTRATOR REVIEW (Claude) — META-ORCH-1009 Sub-E [business-app supply-side onboarding feeder]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
**Branch:** `META-ORCH-1009-Sub-E-business-app-supply-feeder`
**Commit under review:** `79fc59133` (Codex implementation, IMPLEMENT + 4 reworks, committed by orchestrator to protect WIP)
**Diff scope:** 67 files, +7648 / −305 vs `origin/main`
**Prior QA:** `QA_RETEST_*.md` = CONDITIONAL PASS, blocked on authenticated-sim hero-video smoke.

## VERDICT: NEEDS WORK (do not close as-is)

The strong half is genuinely solid and well-tested: hero-video ×1.15 boost, the `ai_signal_scores` 6-key shape with correct `prompt_version='v4'`, the sole-owner + ORCH-0863 allowlist updates, the schema migration, and the category-gate removal for universal authoring. But the sub's **named primary purpose — repairing the menu-parser funnel collapse — is only half-implemented**, two of the eight Gemini stages are collapsed/fabricated, and two mandated artifact amendments are missing. No path was ever exercised end-to-end because the migration is unapplied.

This review supersedes any Codex self-review for the Claude-side gate. Per the REVIEW protocol, an APPROVED verdict requires labeled commit-hash + dependency-walk sections; both are below, and the verdict is NEEDS WORK regardless.

---

## Commit-hash verification

| Claimed deliverable | Committed? | Evidence |
|---|---|---|
| Implementation present at a real commit on the branch | YES | HEAD `79fc59133`; 67-file diff vs origin/main |
| Working tree clean (no uncommitted scoped product code) | YES | only gitignored `node_modules` real-dir pollution remains; all scoped files committed |
| Migration file committed | YES | `supabase/migrations/20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql` |
| New edge fn committed | YES | `supabase/functions/run-business-place-authoring-pipeline/index.ts` (+ `__tests__`) |

## Dependency walk (config-layer + invariant changes)

| Changed surface | Consumer impact | Status |
|---|---|---|
| `.github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs` | CI gate — new writer must be allowlisted | ALLOWLIST UPDATED (`:44`) ✅ but **header comment still claims single writer** (`:6`) ❌ |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | CI gate — new backend files | `META_ORCH_1009_SUB_E_BACKEND_ALLOWLIST` added (`:1134-1148`, spread `:1249`) ✅ |
| `supabase/functions/_shared/signalScorer.ts` | consumer ranker reads hero-video boost + ai scores | ×1.15 boost wired, cap ≤100, `DEFAULT_EXPECTED_PROMPT_VERSION='v4'` matches pipeline `PROMPT_VERSION='v4'` ✅ |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | SPEC §10.1 mandated amending `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` to name 2nd writer | **0 lines changed** ❌ |
| `Mingla_Artifacts/DECISION_LOG.md` | SPEC §10.1 mandated DEC-099/DEC-181 amendment | **0 lines changed** ❌ |

---

## Per-requirement findings (file:line evidence)

| # | SPEC requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 1a | Extend proposal TTL beyond 24h | ✅ YES | `parse-restaurant-menu/index.ts:13` + `parse-play-activities/index.ts:16`: `HUB_EXPIRY_HOURS = 24*7` | none |
| 1b | Recurring expiry sweeper (SPEC §5.3: pg_cron 15-min) | ⚠️ PARTIAL | DB fn `expire_agent_pending_actions` (migration:489-507); one-shot backfill (migration:517); client hides expired via `experienceGenerationService.ts:96` `.gt("expires_at", now)` | **NO `cron.schedule` in migration.** Rows go stale again after deploy; only client-side hiding. |
| 1c | Replace HTTP-410 "Ask Ari" dead-end with in-Hub regenerate (SPEC §11.4) | ❌ NO | `agent-confirm-action/index.ts:139` STILL returns `410 EXPIRED "...Ask Ari to propose it again."`; file **not in the Sub-E diff at all** | The headline bug the sub exists to fix is untouched in code. Mitigation is client row-hiding only; no regenerate CTA. |
| 2 | place_pool authoring write path | ✅ YES (deviation) | `run-business-place-authoring-pipeline/index.ts:359-392` inserts row; `:371` `fetched_via:"business_authored"`; `:377-378` `is_claimed/claimed_by`; migration adds enum + 5 cols + nullable gpid + partial unique idx | Writes via **service-role** (`:902,907`), no direct-predicate owner-UPDATE RLS (SPEC §6.1). Defensible but a silent deviation vs `[[rls-returning-owner-gap]]`. |
| 3 | 8 discrete Gemini stages, Flash, docs cited | ⚠️ PARTIAL / collapsed | `GEMINI_MODEL="gemini-2.5-flash"` (`:11`); docs URL (`:4-5`); one `callGeminiForEvaluations` returns `{bio, photo_analysis, facets, evaluations}` | **Stage 3 photo analysis sends NO image bytes** (`:492` passes only text JSON) → aesthetic/dedupe **fabricated from metadata**, not vision. **Stage 7 Google cross-validation absent.** Uses `responseMimeType:"application/json"`, not the `responseSchema`/function-calling structured-output the SPEC §7 cited. |
| 4a | Stage 6 writes `ai_signal_scores` 6-key shape, `prompt_version='v4'` | ✅ YES | `buildAiSignalScores` (`:535-571`) emits 6 keys; `PROMPT_VERSION="v4"` (`:12`) matches `signalScorer.ts:21`; write at `:625` | Throws `gemini_missing_signal` if any active signal absent (`:559`) — brittle but contract-faithful. |
| 4b | New writer in `ALLOWED_WRITER_FILES` | ✅ YES | `i-ai-signal-scores-column-sole-owner.mjs:44` | none |
| 4c | Amend invariant header + DEC-099/DEC-181 (SPEC §10.1) | ❌ NO | gate header `:6` still "Only run-place-intelligence-trial writes"; INVARIANT_REGISTRY + DECISION_LOG 0 lines changed | Stale invariant prose; future sessions will read the wrong single-writer rule. |
| 5 | Bouncer B-codes → plain-English + one-tap-fix in Hub | ⚠️ PARTIAL | `coachingForReasons` maps B3/B4/B5/B6/B8 (`index.ts:147-197`); `DeckReadinessCard.tsx` renders + fix button; mounted `hub/_layout.tsx:168` + `home.tsx:512` | **B9-B12 NOT mapped** (the codes most likely to block real venues — child-venue, fast-food, chain) → generic fallback. Only top reason shown; SPEC §8.5 "keep the rest visible in a compact list" unmet. |
| 6 | Hero-video ×1.15 boost, cap ≤100 | ✅ YES | `signalScorer.ts`: `place.business_hero_video_present===true ? Math.min(100, rawAiScore*1.15) : rawAiScore`; tests T-E1/E2/E3 pass | Cleanest part. |
| 7 | New edge fns in orch-0863 allowlist (COMMS-0002) | ✅ YES | `orch-0863-...mjs:1134-1148` + `:1249` | none |
| 8 | Category gates removed (universal authoring, I-BRAND-UNIVERSAL-AUTHORING) | ✅ YES | `parse-restaurant-menu`/`parse-play-activities` 403 gates removed; `agentTools.ts` venue-category throw removed | none |

---

## Step 0.5 regression-test assessment

Tests exist on both sides and **all pass when run** (Deno 19/19 incl. hero-video T-E1/E2/E3; Jest 5/5; SQL schema assertions real). BUT they are weak:

- `run-business-place-authoring-pipeline/__tests__/stage_contract.test.ts` is a **source-string grep** (`Deno.readTextFile` + `assertStringIncludes`) — asserts the source *contains* substrings, not that the handler *behaves*. Would not catch a logic regression.
- `supabase/migrations/__tests__/sub_e_pending_action_expiry.test.sql` only asserts the function **exists + is SECURITY DEFINER** — does NOT assert SPEC §11.1 behavior (stale→expired flip, non-stale untouched, executed/failed/cancelled preserved). Core expiry behavior is untested.
- **No fails-on-revert cited** for the SQL/stage tests in any rework report.
- The CONDITIONAL-PASS sim smoke **could not have run truthfully**: migration is unapplied to the live DB (`place_pool` lacks the 5 new columns, `expire_agent_pending_actions` + `brand_place_pipeline_state` absent live), so no end-to-end write path was ever exercised.

Step 0.5 gate is **not yet satisfied** for close (behavioral tests + fails-on-revert + one real smoke required).

---

## Silent deviations / fabrication / skipped scope (flag for operator)

1. **Fabricated Stage-3 output** — `photo_analysis` written from a no-image Gemini call. Conflicts with the project's no-fabricated-data posture (Constitution rule 9).
2. **Skipped scope** — Stage 7 Google cross-validation; recurring pg_cron; the 410→regenerate replacement; B9-B12 coaching; multi-reason coaching list.
3. **Silent pipeline-state schema divergence** — SPEC §5.2 specified `tier1_completed_at`/`tier2_completed_at`/`bouncer_reasons text[]`/`last_error_code`/`last_error_message`; migration ships `readiness jsonb`/`coaching jsonb`/`bouncer_reason` (singular)/`last_started_at`/`last_error`. The schema test was written to the *implemented* shape, so it passes — divergence is invisible to CI.
4. **Stale invariant prose** — sole-owner gate header + DEC-099/DEC-181 not amended (SPEC §10.1 mandated).

---

## Recommended conditions before CLOSE

**Must-fix (genuine blockers — the sub's stated purpose):**
- C1. Recurring expiry sweeper (pg_cron schedule of `expire_agent_pending_actions`) OR an explicit operator-accepted decision to ship client-hiding only.
- C2. Replace the `agent-confirm-action:139` 410 "Ask Ari" dead-end with an in-Hub regenerate path (the headline funnel fix) OR operator-accepted descope with a tracked follow-up.
- C3. Amend `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` header + DEC-099/DEC-181 (SPEC §10.1) — cheap, do it.
- C4. Behavioral (not grep) test for the expiry flip + a Tier-2 behavioral test; cite fails-on-revert.
- C5. B9-B12 coaching coverage (or operator-accepted partial with tracked follow-up).

**Arguably-acceptable v1 descopes (need explicit operator sign-off, not silent):**
- D1. Stage-3 real image-bearing vision (currently fabricated from metadata).
- D2. Stage-7 Google cross-validation (currently absent).
- D3. Service-role writes instead of direct-predicate owner RLS.

**Hard gate regardless:**
- G1. Operator runs `db push` for the migration, THEN one authenticated-sim smoke proving a Tier-1/2 authoring run produces a `place_pool` row with `ai_signal_scores` + the deck-readiness coaching surface renders.

---

## Migration apply command (operator-gated, per protocol)

Run the safe-migration protocol first, then:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]"
/Users/sethogieva/bin/supabase migration list --linked   # confirm no remote-only drift
/Users/sethogieva/bin/supabase db push --linked          # add --include-all only if intentionally out-of-order
```

The latest applied remote migration before this is the ORCH-1006 pricing-switches set; `20260809000000` is monotonic-after, so a plain `db push` should apply cleanly. If `migration list` shows remote-only versions, STOP and reconcile before pushing.
