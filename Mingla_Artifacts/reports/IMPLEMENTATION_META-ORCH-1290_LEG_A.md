# IMPLEMENTATION — META-ORCH-1290 LEG A (backend) [venue authoring: one-submission + score-on-approve + pitch consumer-facing]

**Phase:** IMPLEMENT (Leg A backend only — migrations, edge functions, CI gates). Legs B (business app) + C (consumer/public client) are separate.
**Worktree:** `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]` @ branch `orch-1290-venue-authoring-one-submission` (rebased on origin/main).
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1290_AUTHORING_ONE_SUBMISSION.md` (a58b3dc24) §Leg A + server test rows.
**Status:** `implemented and verified` for all Leg A code + gates, with ONE orchestrator-owned blocker: pinned append-only test **T-A6 now fails at runtime** (D-2 obsoletes its assertion; I am dispatch-barred from modifying it — see §Blockers).

---

## 1. Summary (plain English)

The venue authoring backend now (a) drafts the AI pitch at submit but computes the 16-signal scores ONLY when an admin approves, and (b) surfaces that pitch to consumers (swipe card + public page). Concretely: the pipeline's single Gemini call is split into a bio-DRAFT call at submit (no scores) and a 16-signal EVAL call at approve; a new `evaluate_signals` pipeline action (service-role only) runs the eval and is the sole business-path writer of `ai_signal_scores`; admin approve invokes it fail-close BETWEEN authored-apply and go-live and enforces the ≥5-gallery deck gate there; the pitch (`place_pool.generative_summary`) is added to `venue_public_view` and both servable-deck RPCs, and `discover-cards` maps it onto the card blurb. The retired ORCH-1285 CI gate is deleted; two new DRAFT gates are added.

---

## 2. SPEC success-criteria coverage

| SC | What | Verified | Commit |
|----|------|----------|--------|
| SC-1 (no scores pre-approve) | handleTier2 writes NO `ai_signal_scores` | ✓ behavioral test T-1290-1 + G-A gate (fails-on-revert proven) | `9d856a3` |
| SC-2 (scores on approve) | approve → `ai_signal_scores` (16, 6-key, v4) + `place_scores`; eval-fail → no flip/no scores | ✓ T-1290-2 (write shape) + T-1290A-1/2 (ordering + fail-close) | `9d856a3` / `d1f2b7d` |
| SC-10 (≥5-gallery gate at approve) | <5 gallery → not servable + GALLERY_MIN reason | ✓ T-1290A-3 | `d1f2b7d` |
| SC-11 (sole-owner) | only trial + pipeline write `ai_signal_scores` | ✓ `i-ai-signal-scores-column-sole-owner.mjs` green (1827 files, 0 unauthorized) | `9d856a3` |
| SC-8-Web (public pitch) | `venue_public_view.pitch` present, verified-only | ✓ SQL PITCH-1/2 (runtime-pending, see §Proof) + G-B(c) | `77a945a` |
| SC-9 (card pitch) | servable card renders pitch; empty → name-only | ✓ RPC returns `generative_summary`; discover-cards maps → `description`/`oneLiner`; G-B(a)(b) | `77a945a` / `d1f2b7d` |
| Gate retirement (1285) | 1285 gate + workflow job removed; durable route survives as Hub→Edit | ✓ file deleted, job removed, YAML parses | `77a945a` (file) / `1e1fd98` (job) |
| New gates G-A + G-B | added + self-test + workflow jobs (append) | ✓ G-A 4/4, G-B 8/8 self-test PASS + tree PASS | `1e1fd98` |

SC-3/4/5/6/7 are Leg B/C (client) — out of Leg A scope; the backend hooks they depend on (`evaluate_signals`, pitch draft staging, RPC/view pitch) are all in place.

---

## 3. Files changed (14 files, +1667 / −354)

| File | Δ | Commit |
|------|---|--------|
| `supabase/migrations/20261221000000_meta_orch_1290_venue_public_view_pitch.sql` | +56 (NEW) | `77a945a` |
| `supabase/migrations/20261221000001_meta_orch_1290_servable_rpcs_generative_summary.sql` | +247 (NEW) | `77a945a` |
| `supabase/migrations/__tests__/orch_1255_public_view_anon.test.sql` | +30 (extend, 0 del) | `77a945a` |
| `supabase/migrations/__tests__/meta_orch_1290_servable_rpc_pitch.test.sql` | +57 (NEW) | `77a945a` |
| `.github/scripts/strict-grep/i-proposed-1285-...mjs` | −162 (DELETE) | `77a945a` |
| `supabase/functions/run-business-place-authoring-pipeline/index.ts` | +595/−354 net | `9d856a3` |
| `.../run-business-place-authoring-pipeline/__tests__/meta_orch_1290_score_on_approve.test.ts` | +229 (NEW) | `9d856a3` |
| `supabase/functions/admin-review-venue-claim/index.ts` | +110/−~40 | `d1f2b7d` |
| `.../admin-review-venue-claim/__tests__/meta_orch_1290_score_on_approve.test.ts` | +159 (NEW) | `d1f2b7d` |
| `supabase/functions/discover-cards/index.ts` | +8/−2 | `d1f2b7d` |
| `supabase/functions/_shared/authoredApply.ts` | +9 (comments only) | `d1f2b7d` |
| `.github/scripts/strict-grep/i-proposed-1290-no-business-signal-scores-pre-approve.mjs` | +153 (NEW) | `1e1fd98` |
| `.github/scripts/strict-grep/i-proposed-1290-pitch-consumer-facing.mjs` | +172 (NEW) | `1e1fd98` |
| `.github/workflows/strict-grep-mingla-business.yml` | +34/−~14 | `1e1fd98` |

---

## 4. Data-model changes (write .sql only; NOT applied)

- **M1** `20261221000000_...venue_public_view_pitch.sql` — DROP+CREATE `venue_public_view` re-adding the current SELECT list VERBATIM + `pp.generative_summary AS pitch`. `security_invoker=false`, `WHERE claim_status='verified'`, `GRANT SELECT TO anon, authenticated` unchanged. No table/column/RLS change.
- **M2** `20261221000001_...servable_rpcs_generative_summary.sql` — DROP+CREATE `query_servable_places_by_signal` (solo) and `query_servable_places_by_signal_intersection` (collab) adding `generative_summary text` to `RETURNS TABLE` (after `primary_type`, before `signal_score`) + `pp.generative_summary` to the SELECT. **ORDER BY, three-gate WHERE, ai_reasoning/ai_score_raw, SECURITY DEFINER, SET search_path preserved BYTE-FOR-BYTE** (collab determinism, I-COLLAB-DECK-DETERMINISM). GRANTs re-issued to anon/authenticated/service_role on both (the intersection fn gains explicit grants — a safe superset of its PUBLIC-default EXECUTE; see §Deviations).
- Prefixes `20261221000000/…001` collision-scanned across origin/main + all `~/Desktop/mingla-orchs/*` worktrees — FREE (latest sibling = `20261210000000_orch_1278`).

---

## 5. Edge functions touched (deploy list — orchestrator owns deploy from MERGED main)

| Function | Change | verify_jwt to preserve |
|----------|--------|------------------------|
| `run-business-place-authoring-pipeline` | Gemini split + `evaluate_signals` action + `requireServiceRole` | not in config.toml → platform default (true); the fn does its own auth via `requireUser`/`requireServiceRole`. **Do not add a config.toml override.** service-role-key bearer is a valid JWT → passes verify_jwt AND the constant-time key check. |
| `admin-review-venue-claim` | invoke `evaluate_signals` fail-close + relocate gallery gate | platform default (true); its own admin auth via `is_admin_user`. Unchanged. |
| `discover-cards` | map `generative_summary` → card `description`/`oneLiner` | unchanged. |

CORS `x-client-info` (orch-1205) preserved on all three (pipeline uses `_shared/cors.ts` which includes it; admin-review + discover-cards CORS untouched).

---

## 6. Regression tests added (append-only) + fails-on-revert

- **Pipeline** `.../run-business-place-authoring-pipeline/__tests__/meta_orch_1290_score_on_approve.test.ts` (3 tests): T-1290-1 handleTier2 writes NO `ai_signal_scores` + stages the bio-draft; T-1290-2 `evaluate_signals` writes `ai_signal_scores` (v4, 6-key) + facets at approve; T-1290-3 `requireServiceRole` rejects a user token / accepts the service key. **3 passed.**
- **Admin** `.../admin-review-venue-claim/__tests__/meta_orch_1290_score_on_approve.test.ts` (3 tests): T-1290A-1 approve invokes `evaluate_signals` (pipeline) BEFORE `run-signal-scorer` then flips servable; T-1290A-2 eval failure → `signal_eval_failed` fail-close (no scorer, no flip); T-1290A-3 SC-10 <5-gallery does not flip / ≥5 flips. **3 passed.**
- **SQL** `orch_1255_public_view_anon.test.sql` PITCH-1/2 (pitch present + verified-only) + `meta_orch_1290_servable_rpc_pitch.test.sql` RPC-PITCH-1/2 (both RPCs return `generative_summary`).
- **fails-on-revert verified at `9d856a3874226b990976145482d78bb448b74a4c`** (pipeline) — re-inserting `ai_signal_scores: {...}` into `handleTier2`'s `place_pool.update` (true line insertion of the reverted write) → **G-A gate FAILS (exit 1) AND T-1290-1 FAILS**; line removed → both PASS. Core "no business scores pre-approve" behavior is revert-protected by both a runtime test and a strict-grep gate.

---

## 7. Old → New receipts

### run-business-place-authoring-pipeline/index.ts
**Before:** one `callGeminiForEvaluations` returned bio+facets+photo+16 evals+consistency; `handleTier2` computed `buildAiSignalScores` and wrote `ai_signal_scores` to `place_pool` at submit. No service-role path.
**Now:** `callGeminiForBioDraft` (submit, bio+facets only) + `callGeminiForSignalEval` (approve, 16 evals+facets) sharing `fetchGeminiCandidate`/`buildGeminiBasePrompt`; `handleTier2` runs bio-draft only and writes NO `ai_signal_scores`; new `evaluate_signals` action (router branch + `requireServiceRole` constant-time key check) runs the eval and writes `ai_signal_scores`+`photo_analysis`+AI-inferred facet columns at approve.
**Why:** D-2 (score on approve) + D-3 (pitch drafted at submit, scored at approve) + OQ-3 (invoke-pipeline, sole-owner unchanged).

### admin-review-venue-claim/index.ts
**Before:** approve = authored-apply → go-live (re-bounce + scorer). No signal eval; ≥5-gallery gate lived in the pipeline's retired confirm step.
**Now:** `approveGoLiveWithAuthoredApply(…, brandId?)` invokes `evaluate_signals` BETWEEN authored-apply and go-live (fail-close: eval error → `signal_eval_failed`, no flip/no scoring), and `runApproveGoLive(…, enforceBusinessGalleryGate?)` folds the ≥5-gallery gate into the go-live decision. Both new behaviors gate on the new trailing `brandId`/flag so pre-1290 callers (pinned 1263/1062 tests) are byte-identical.
**Why:** D-2 fail-close scoring at approve + D-1 gallery-gate relocation (SC-10), preserving I-1263 ordering + append-only pinned tests.

### discover-cards/index.ts
**Before:** `description: ''`, `oneLiner: null` hardcoded on every servable card.
**Now:** `description: (row.generative_summary ?? '')`, `oneLiner: (row.generative_summary ?? null)` — the edge fn supplies the full pitch text; the app clamps `oneLiner` to 2 lines (DESIGN). Absent → degrades to name-only.
**Why:** D-6 consumer-facing pitch.

### _shared/authoredApply.ts
**Before:** applied `generative_summary` from `confirmed_ai_outputs.sales_bio → tier1.description(≥20)`; facets from `confirmed_ai_outputs.facets`.
**Now:** unchanged behavior + comments noting confirm-step retirement makes `confirmed_ai_outputs.sales_bio`/`.facets` legacy (new venues fall through to `tier1.description`; facets are AI-inferred at approve by `evaluate_signals`).
**Why:** D-1/D-4 documentation of the confirm-removal path (no behavior change; T-C3c stays green).

---

## 8. Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Consumer iOS/Android | YES (Leg C wires render) | RPC + discover-cards now supply the pitch; card slots light up when Leg C ships. Backend-only here. |
| Buyer/anon Web (public page) | YES (Leg C render) | `venue_public_view.pitch` exposed; verified-only, anon-safe. |
| Business iOS/Android | NO (Leg B) | Wizard/listing are Leg B. |
| Admin Web | PARTIAL (verify-only) | Approve now triggers the eval; admin bundle already reads `ai_signal_scores` — tolerates "no scores until approve." No admin code change. |
| Business Web preview | NO (Leg B) | — |

Parity: pitch on card (RPC/edge) vs public page (view/service) are separate paths — both wired at the backend here; Leg C renders each.

---

## 9. Local-proof vs static-only

- **Locally verified (deno):** `deno check` on all 4 touched fns; pipeline suite 32 passed/1 failed (T-A6, §Blockers); admin suite 38 passed/0; discover-cards determinism + reasoning suites 15/0; both new behavioral files 6/0; G-A self-test 4/4 + tree PASS; G-B self-test 8/8 + tree PASS; sole-owner gate 0 unauthorized; append-only checker 4 passed/0; workflow YAML parses (ruby).
- **Static-only (needs a local prod-chain Postgres — NOT run in this session):** the two SQL complements (`orch_1255_public_view_anon.test.sql` PITCH-1/2, `meta_orch_1290_servable_rpc_pitch.test.sql` RPC-PITCH-1/2). They are written to run under `psql -v ON_ERROR_STOP=1` in one rolled-back transaction; the orchestrator/tester must run them against a local stack (the 1255/1263 dedup-scratch technique).

---

## 10. Blockers (orchestrator-owned) — pinned test T-A6 obsoleted by D-2

**T-A6** in `supabase/functions/run-business-place-authoring-pipeline/__tests__/orch_1263_stage_only_claim.test.ts:513-522` asserts the EXACT key-set of `handleTier2`'s stage payload **includes `ai_signal_scores`**. D-2 removes that write (mandated by §4.2.A + enforced by the G-A gate). The two are irreconcilable: `ai_signal_scores` cannot be both present (T-A6) and absent (D-2/G-A). Result: **T-A6 fails at runtime** (I verified: pipeline suite is 32 passed / 1 failed = T-A6).

I did **NOT** modify T-A6 — the dispatch HARD GUARD is "Existing append-only tests UNMODIFIED," and the append-only gate requires a `[TEST-MOD-APPROVED ORCH-NNNN]` token I am not authorized to self-issue. The test FILE is untouched (append-only checker is green); only the assertion is obsolete.

**Required orchestrator action (test-sync, not code):** authorize the one-line update to T-A6's expected array (remove `"ai_signal_scores",`) with a commit body citing `[TEST-MOD-APPROVED META-ORCH-1290]`, OR spawn a test-mod ORCH. Exact edit — in the sorted array at `orch_1263_stage_only_claim.test.ts:513`, delete the single element `"ai_signal_scores",`. After that, the pipeline suite is fully green. The spec's DECISION_LOG at CLOSE should note D-2 obsoletes T-A6.

---

## 11. Operator action required — ORDERED apply plan (orchestrator/operator)

1. **Migrations (Management API SQL, project `gqnoajqerqhnvulmnyvv` — NOT blind `db push`; history-drift):** apply in order:
   1. `20261221000000_meta_orch_1290_venue_public_view_pitch.sql`
   2. `20261221000001_meta_orch_1290_servable_rpcs_generative_summary.sql`
   - **Read-backs:** `SELECT pitch FROM venue_public_view LIMIT 1;` (column exists) and `SELECT generative_summary FROM query_servable_places_by_signal('x',0,0,0,1,'{}',1) LIMIT 0;` (column in the RETURNS TABLE for both RPCs). No guard/backfill in either migration → no pre-flight probe needed.
   - Copy-paste (if using CLI instead, from THIS worktree): `cd "/Users/sethogieva/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]" && /Users/sethogieva/bin/supabase db push --linked` — but Management-API-SQL is preferred per project_migration_history_drift.
2. **Edge deploys (from MERGED main):** `run-business-place-authoring-pipeline`, `admin-review-venue-claim`, `discover-cards`. Preserve each verify_jwt (none in config.toml → default; do NOT add overrides). Verify curls: (a) `evaluate_signals` with a WRONG bearer → 401 `Service role required`; (b) a user action (`get_authoring_context`) with a service-role bearer → still rejected by `requireUser`; (c) approve a ≥5-photo test venue → 200 with `go_live.servable=true`.
3. **Vercel `[deploy]`** rides the public-page/edge changes (Leg C client renders separately).
4. **NO** consumer/business `eas update` (COMMS-0052/0047 — both native changes ride their next native builds). Leg A ships via edge-deploy + Management-API migrations + Vercel only.
5. **CLOSE:** flip `I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE` + `I-PROPOSED-1290-PITCH-CONSUMER-FACING` DRAFT→ACTIVE; record the 1285 retirement supersede note; authorize the T-A6 test-sync (§10).

---

## 12. Discoveries for Orchestrator

- **D-A (T-A6):** see §10 — the sole blocker; a spec/append-only collision the spec author did not flag.
- **D-B (edit-cap left intact):** per §4.2.A's precise change-list I removed ONLY `ai_signal_scores` + `buildAiSignalScores` from `handleTier2`; I left the `RECOMMEND_EDIT_CAP` check + `business_recommend_edit_count` increment (OQ-4 retires the concept but §4.2.A does not instruct removal, and keeping it minimized the T-A6 blast). Consequence: the now-primary "Generate pitch with AI" action (run_tier2_pipeline/regenerate_sales_bio) still 429s after 4 runs — a UX wrinkle vs D-3 "regenerate anytime." Recommend a follow-up (Leg B/D or a small edge tweak) to lift the cap on the bio-draft action.
- **D-C (stage_status honesty):** `handleTier2`'s `signal_pre_evaluation: "complete"` diagnostic string is now slightly misleading (no signals scored at submit). Left unchanged (client-facing string, out of §4.2.A scope). Cosmetic.
- **D-D (intersection RPC grants):** the source `20260806000000` did NOT re-GRANT the intersection RPC after its DROP+CREATE (it relied on PUBLIC-default EXECUTE). M2 adds explicit anon/authenticated/service_role grants to it — a safe superset (matches the solo RPC + survives a future REVOKE FROM PUBLIC). No behavior regression.

## Deviations from the literal spec text (all preserve the binding behavior)

1. **Eval-invoke + gallery-gate gated on `brandId`/flag (not unconditional).** §4.2.B says "insert the eval inside `approveGoLiveWithAuthoredApply`" and "add the gallery gate to `runApproveGoLive`." Doing so UNCONDITIONALLY breaks pinned append-only tests (T-C3b asserts exactly 1 invoke on a 1-photo fixture; the 1062 adversarial tests flip servable on <5-gallery fixtures via the 3-arg `runApproveGoLive`). I added a trailing optional `brandId` (approve) + `enforceBusinessGalleryGate` (go-live) that DEFAULT to pre-1290 behavior; the real serve path passes them, so production behavior is exactly the spec's (eval between apply and go-live, fail-close, ≥5 gate) while every pinned test stays green. Verified: admin suite 38/0.
2. **`callGeminiForSignalEval` returns `facets`** (the spec's shorthand listed `{evaluations, photo_analysis?, consistency?}` but also mandated `evaluate_signals` write `gemini.facets ∩ FACET_COLUMNS`). I made the eval return facets so the explicit facet-column write is satisfiable — facets are AI-inferred at approve (§2 non-goal / OQ-7).

---

**Downstream:** back to **mingla-orchestrator** for REVIEW → **mingla-tester** (adversarial + live-fire on the business sim + the two SQL runtime complements + read-only prod OQ-5 check). Orchestrator owns: migration apply, edge deploy, the T-A6 test-sync authorization, DRAFT→ACTIVE invariant flips, CLOSE.
