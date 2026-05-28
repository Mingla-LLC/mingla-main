# ORCHESTRATOR REVIEW — ORCH-0978 IMPLEMENT-6 [video cover source/processed cap]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-28
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Under review:** commits `5d714a1d2` (product fix) + `1f471e1c6` (tests + report) from implementor+codex
**Against:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0978_IMPLEMENT_6_KEYFRAME_OVERSHOOT.md`, SPEC AMENDMENT 8, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_6.md`

## VERDICT: APPROVED

Zero P0, zero P1. Two non-blocking notes (P2/P3) + one Discovery. Routes to operator DB push → orchestrator edge redeploy → tester live-fire RETEST.

---

## Commit-hash verification

Every claimed-changed file confirmed committed on the per-ORCH branch (no modified-but-uncommitted files):

| File | Commit | Verified |
|---|---|---|
| `mingla-business/src/services/eventCoverVideoProcessingService.ts` | `5d714a1d2` | ✅ `EVENT_COVER_SOURCE_CEILING_MS = 33_000` added; `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000` unchanged |
| `mingla-business/src/components/ui/CoverPicker.tsx` | `5d714a1d2` | ✅ check → `> EVENT_COVER_SOURCE_CEILING_MS`; `videoMaxDuration: 29`, `[ORCH-0978-TRIM]` log, toast copy all preserved |
| `supabase/functions/event-cover-video-upload-intent/index.ts` | `5d714a1d2` | ✅ `SOURCE_CEILING_MS = 33_000` (old `EFFECTIVE_TRIM_CEILING_MS` removed); clamp `Math.min(rawTrimEndMs, MAX_DURATION_MS)` placed before `validateTrimRange` + insert |
| `supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql` | `5d714a1d2` | ✅ pre-flight (>30000) + drop/re-add both at `<= 30000` + post-verify (no 29000, both 30000) |
| `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | `5d714a1d2` | ✅ C4 → new migration + `<= 30000`; C10 + C11 added |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | `5d714a1d2` | ✅ new migration appended to `ORCH_0978_BACKEND_ALLOWLIST` (same commit per COMMS-0002) |
| `supabase/functions/.../__tests__/duration-cap.test.ts` | `1f471e1c6` | ✅ 33000/33001 boundary + clamp test (31000→trim_end_ms=30000, du_30) + normal-trim test (29400 not clamped) |
| `mingla-business/.../__tests__/CoverPicker.videoSourceCeiling.test.ts` | `1f471e1c6` | ✅ static source-grep of client ceiling (see P2-01) |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_6.md` | `1f471e1c6` | ✅ |

`[TEST-MOD-APPROVED ORCH-0978]` marker present on commit `5d714a1d2` subject (the duration-cap.test.ts boundary assertion changed). **CLOSE NOTE:** ensure the squash-merge commit message carries the marker forward so the append-only/TEST-MOD gate reads it on the merged commit.

## Dependency walk (config-layer changes)

Config-layer files touched: 2 strict-grep `.mjs` scripts, 1 new migration, 1 edge function with an exported-constant rename.

| Changed key/value | Consumers checked | Compatibility |
|---|---|---|
| `EFFECTIVE_TRIM_CEILING_MS` removed, renamed → `SOURCE_CEILING_MS` | `grep -rn EFFECTIVE_TRIM_CEILING_MS supabase/ mingla-business/src/` → **ZERO refs**. `duration-cap.test.ts` imports the new `SOURCE_CEILING_MS`. | ✅ No dangling import / build break |
| `EVENT_COVER_SOURCE_CEILING_MS` new export | Consumed by `CoverPicker.tsx:65,442` + the Jest test; defined in the service. | ✅ |
| `orch-0978-video-cap-29s.mjs` `migrationPath` → `20260730000001` | Runner = `strict-grep-mingla-business.yml` (existing job, same script invocation). New migration exists in the commit; C4 reads it and asserts 30000. | ✅ No workflow change needed |
| `ORCH_0978_BACKEND_ALLOWLIST` += new migration | ORCH-0863 `no-new-backend-files` C7 gate. | ✅ New migration now allowlisted |
| New migration timestamp `20260730000001` | Highest across all worktrees was `20260730000000` (verified). | ✅ No collision |

## Spec compliance (SPEC AMENDMENT 8, Option A)

All §E layered-spec items implemented exactly; §I two-commit landing honored; §B non-goals respected (`_shared/eventCoverVideo.ts` NOT touched → only `upload-intent` redeploys, no batch redeploy; `videoMaxDuration` stays 29; `EVENT_COVER_MAX_VIDEO_DURATION_MS` stays 29_000). Option A (cap 30000 + migration) implemented as directed — the migration aligns the edge `assertProcessedDerivative` cap (30000) with the DB constraint (now 30000), closing the 1s mismatch that motivated the decision.

## DB safety (invariant migration backstop)

Read-only production probe (in report §Database Probes): `rows_exceeding_30000=0`, `rows_exceeding_29000=0`, `max_trim_window_ms=15520`, `max_processed_duration_ms=15520`. The migration's pre-flight `RAISE EXCEPTION` guard would NOT abort (greenfield). No `source_duration_ms` constraint exists (probe returned zero rows) — the 33000 source ceiling is unconstrained at DB, enforced at the edge as specced.

**Migration already applied to remote (verified at REVIEW, 2026-05-28).** The implementor reported `20260730000001` as local-only at their run, but `supabase migration list --linked` at REVIEW shows it in BOTH Local and Remote columns, and a direct read-only `pg_constraint` probe against production confirms both constraints are live at the target value:
- `event_cover_video_jobs_trim_max_duration` = `CHECK (((trim_end_ms - trim_start_ms) <= 30000))`
- `event_cover_video_jobs_processed_max_duration` = `CHECK (((processed_duration_ms IS NULL) OR (processed_duration_ms <= 30000)))`

Operator (Seth) confirmed at REVIEW that he ran `supabase db push` between the implementor's return and this REVIEW. The constraint definitions match the migration body exactly, so the end state is correct. **Consequence: the "operator DB push" step is already complete — do NOT re-push.** The next actionable step is the edge redeploy.

## Regression-test gate (Step 0.5 — enforced at CLOSE, pre-checked here)

- **(a) Implementor happy-path + fails-on-revert:** the edge clamp test (`sourceDurationMs=31000, trimEndMs=31000` → `source_duration_ms=31000`, `trim_end_ms=30000`, eager `du_30`). Fails-on-revert is GENUINE (not grep-dependent): reverting the clamp leaves `trim_end_ms=31000`, which `validateTrimRange` rejects with 422, so the test's expected 200 + clamped insert fails. ✅
- **(b) Tester adversarial + fails-on-revert:** PENDING — owned by the tester at RETEST per SPEC §H. The boundary test (33000/33001) shipped here is implementor-written; the tester must add their own different-angle adversarial test during RETEST for the CLOSE gate.

Verification commands in the report all passed: both strict-grep scripts, `deno check`, `deno test --allow-env` (4/4), focused Jest, `git diff --check`.

## Constitutional compliance

| Rule | Result |
|---|---|
| #3 No silent failures | PASS — over-ceiling returns 422 with `{error, detail.ceilingMs}`; client toast surfaces |
| #8 Subtract before adding | PASS — `EFFECTIVE_TRIM_CEILING_MS` fully removed, not layered over |
| #9 No fabricated data | PASS — `source_duration_ms` keeps the raw value; `trim_end_ms` is the honest processed window |
| Scope discipline | PASS — `_shared` untouched, no `videoMaxDuration` change, no refactor sprawl |

## Findings

- **P2-01 (non-blocking) — client acceptance test is static source-grep, not behavioral.** `CoverPicker.videoSourceCeiling.test.ts` asserts source strings (it duplicates strict-grep C11) rather than rendering `pickVideoCover` with a mocked picker as SPEC §H T-AMEND8-03 envisioned. Accepted because: the edge clamp (the trust boundary) IS behaviorally tested; the client check is a trivial `if (durationMs > CONST)`; and the tester's live-fire RETEST (T-AMEND8-05, real trim on device) behaviorally exercises the client path. Tester should add a behavioral client-acceptance assertion at RETEST if cheap; otherwise accept.
- **P3-01 (non-blocking) — strict-grep C11 relationship clause is a hardcoded tautology.** `if (!(33_000 > 30_000))` can never fail. The real guard is the literal-string assertions (`EVENT_COVER_SOURCE_CEILING_MS = 33_000`, `SOURCE_CEILING_MS = 33_000`, C4's `<= 30000`), which DO pin the values. Cosmetic; a future cleanup could parse the values dynamically.
- **P4-01 (Discovery for orchestrator) — pre-existing stale test.** `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` is stale/failing from ORCH-0876 EventCoverMedia ownership changes, unrelated to this ORCH. The implementor correctly avoided modifying it and added a focused test instead. Register a follow-up cleanup ORCH; not blocking ORCH-0978.

## Next steps (post-APPROVED)

1. ~~Operator `supabase db push`~~ — ALREADY DONE (constraints verified live at 30000 on remote).
2. Orchestrator redeploy `event-cover-video-upload-intent` only + curl verify-first-call (expect 401, not 404). `_shared` untouched → no batch redeploy.
3. Tester live-fire RETEST (T-AMEND8-05; restart Business Metro first — offline) + tester adversarial regression test.
4. Seth physical-iPhone re-validation.
5. Orchestrator CLOSE with `[deploy]` tag + EAS OTA + PR + pre-merge gate + reap.
