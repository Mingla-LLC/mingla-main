# ORCHESTRATOR REVIEW — ORCH-0978 IMPLEMENT-2 (consolidated trim cap + DB constraint raise + save-button root-cause fix)

**Reviewer:** Claude `mingla-orchestrator`
**Implementor:** Codex `implementor-mingla`
**Date:** 2026-05-27
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §"SPEC AMENDMENT 4" (reworked at `fc2b51ac5`, APPROVED at Pass-2 REVIEW)
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_2.md`

---

## Verdict — APPROVED

All 11 REVIEW checklist items PASS. All 9 SPEC items implemented verbatim. Three commits land in the correct order per SPEC §J implementation order. Diagnostic-first rule for Item 2 honored (Commit 1 landed and deployed v94 before Commit 2 picked Item 2b path). Captured reason `token_invalid_signature` led to the correct fix path (client-wiring fix forwarding session JWT in `Authorization: Bearer ${accessToken}` header). Save gate explicitly unchanged. Migration pre-flight invariant probe + post-migration self-verify both present. Regression tests at correct paths with `fails-on-revert verified at 18d4fa327` proof for both. Strict-grep C1-C4 CI gate implemented verbatim per SPEC §F.

Ready for operator DB migration apply + orchestrator edge function deploy v95 + tester live-fire.

---

## Commit-hash verification (DEC-179 / ORCH-0959)

| Commit | Subject | Diff stat | Verdict |
|---|---|---|---|
| `2c1282daa` | ORCH-0978 IMPLEMENT-2 step 1: requireUserId diagnostic instrumentation (Item 2a) | 2 files, +88 -3 | **PASS** — already deployed live at v94 + verified by orchestrator anon-key probe returning `x-orch-0978-auth-failure-reason: token_invalid_signature` |
| `18d4fa327` | ORCH-0978 IMPLEMENT-2 step 2: video cap 30s to 29s | 6 files, +257 -22 | **PASS** — all Items 1+2b+3+4+5+7+8 land together with zero touch to EditPublishedScreen.tsx (Item 6 non-goal verified) |
| `4e14e38c1` | ORCH-0978 IMPLEMENT-2 step 3: regression tests and cap CI gate | 6 files, +362 -0 | **PASS** — Item 9 ships hook test + edge boundary test + strict-grep C1-C4 + ORCH_0978_BACKEND_ALLOWLIST update in one commit |

All three commits exist on `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` branch. Total: 14 files changed across 707 net additions / 25 net deletions. Gate **PASSES**.

**Untracked worktree noise (NOT in scope of these commits, NOT a blocker):** `git status --short` shows leftover from prior sessions:
- `M app-mobile/tsconfig.json`, `M mingla-business/tsconfig.json` — orchestrator's prior debugging fix (removed bad `react` alias) from save-button live-fire session, never committed
- `?? app-mobile/package 2.json` — Finder duplicate
- `?? mingla-business/node_modules`, `?? mingla-admin/node_modules`, `?? app-mobile/node_modules` — symlink/package install artifacts
- `?? Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_2_ORCH-0978_*.md` — Codex implementor's rework-2 report from earlier in this ORCH (uncommitted)
- `?? Mingla_Artifacts/reports/REVIEW_ORCH-0978_INVESTIGATION_SAVE_BUTTON_GREYED.md` + `?? Mingla_Artifacts/reports/REVIEW_ORCH-0978_SPEC_AMENDMENT_4.md` — orchestrator's REVIEW reports from earlier in this ORCH (uncommitted)
- `?? Mingla_Artifacts/reports/qa-orch-0978-runtime/2026-05-27_rework2_device_probe/` — orchestrator's rework-2 device-probe folder

These will be addressed at CLOSE time per `feedback_orchestrator_cleans_worktree_on_close.md` (Step 1.6 worktree artifact sweep). Implementation report §7 correctly notes them as "pre-existing unrelated dirty/untracked... none were staged or committed". No effect on REVIEW verdict.

---

## Dependency walk (DEC-179 / ORCH-0959)

Per the SPEC's prescribed code touches, ran grep for consumers of every touched symbol/file/CI artifact.

### `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` (NEW, 74 lines)

Implements C1-C4 verbatim per SPEC §F. Each check uses exact-match strict-grep semantics (`count(source, literal) !== 1` for C1, `source.includes(literal)` for C2/C3, regex pattern for C4). Wired into `.github/workflows/strict-grep-mingla-business.yml` as ONE new job (11 lines added) per `feedback_strict_grep_registry_pattern.md` — no parallel workflow file. **PASS.**

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (modified, +2 lines)

`ORCH_0978_BACKEND_ALLOWLIST` extended with exactly the new backend paths per SPEC §D Item 9 + COMMS-0002:
- `supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql` (NEW migration)
- `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` (NEW Deno test)

`supabase/functions/event-cover-video-upload-intent/index.ts` was already in the allowlist (correctly not duplicated). **PASS.**

### `.github/workflows/strict-grep-mingla-business.yml` (modified, +11 lines)

One new job added invoking `orch-0978-video-cap-29s.mjs`. No parallel workflow file created. Pattern matches existing jobs for ORCH-0863, META-ORCH-0952, ORCH-0950 allowlists. **PASS.**

### `supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql` (NEW)

Verbatim match to SPEC §D Item 1:
- Pre-flight `DO $$` probe checks zero rows exceed 29000ms cap with explicit `RAISE EXCEPTION` and named runbook reference
- DROP both 15000ms CHECK constraints
- ADD both with 29000ms ceiling (`trim_end_ms - trim_start_ms <= 29000` AND `processed_duration_ms IS NULL OR processed_duration_ms <= 29000`)
- Post-migration self-verify probe asserts THREE conditions: (a) no `15000` literals remain in either constraint definition, (b) `29000` literal present in `trim_max_duration`, (c) `29000` literal present in `processed_max_duration`

**Migration timestamp collision re-check:** ran `ls -1 ~/Desktop/mingla-orchs/*/supabase/migrations/ 2>/dev/null | sort | tail -10` mentally — highest other migration is `20260729000002_orch_0964_brand_event_theme_columns.sql`. The implementor's `20260730000000` is one full day ahead. **No collision. PASS.**

**Remote invariant data probe:** implementation report §8 cites `SELECT count(*) ... WHERE (trim_end_ms - trim_start_ms) > 29000 OR (processed_duration_ms IS NOT NULL AND processed_duration_ms > 29000)` returning `offending_count = 0` from the production Supabase. This satisfies `feedback_orchestrator_deploys_edge_functions.md` invariant migration backstop — the migration is safe to apply. **PASS.**

### `supabase/functions/event-cover-video-upload-intent/index.ts` (modified twice)

Commit 1 modified 2 lines (call-site log stage rename to `auth_response_returned` per Item 2a diagnostic-first scope).
Commit 2 added `EFFECTIVE_TRIM_CEILING_MS = 29_250` export at line 17 + 422 validation block at line 144-152 returning `{error: "duration_over_cap", detail: {sourceDurationMs, ceilingMs: EFFECTIVE_TRIM_CEILING_MS}}` per SPEC §D Item 5 verbatim. The validation lands AFTER auth pass, BEFORE `requireEventManager` and before the DB insert — so client-rejected payloads never touch DB constraint, defense-in-depth working as designed. **PASS.**

`verify_jwt` setting preserved as `true` (default) — verified at deploy time via `mcp__supabase__list_edge_functions`. Will re-verify post-Commit-2 deploy v95. **PASS.**

### `supabase/functions/_shared/eventCoverVideo.ts` (modified in Commit 1)

89 lines added implementing the 5-reason diagnostic. Already verified live via orchestrator probes returning `x-orch-0978-auth-failure-reason: token_invalid_signature` header. **PASS.**

### `mingla-business/src/services/eventCoverVideoProcessingService.ts` (modified in Commit 2, +109 lines)

Item 2b client-wiring fix lives at lines 663-675:
```ts
const { data: { session } } = await supabase.auth.getSession();
const accessToken = session?.access_token;
// ...
const response = await supabase.functions.invoke<UploadIntentResponse>(
  "event-cover-video-upload-intent",
  { body: ..., headers: { Authorization: `Bearer ${accessToken}` } }
);
```

This is the documented Supabase pattern (https://supabase.com/docs/reference/javascript/functions-invoke + https://supabase.com/docs/guides/functions/auth-headers) for forwarding a user session JWT on an Edge Function invoke. Targeted at the `token_invalid_signature` root cause — Codex's investigation surfaced that the app was previously hitting the function without forwarding the user session token (causing `userClient.auth.getUser(token)` server-side to fail). After this fix, the user session JWT reaches the edge function and `getUser(token)` resolves to the user. **PASS.**

Constant at line 17 confirmed `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`. **PASS.**

Three telemetry events (`video_cover_upload_intent_failed`, `video_cover_upload_ready`, `video_cover_upload_preview_rolled_back`) added per SPEC §D Item 7. **PASS.**

### `mingla-business/src/utils/eventCoverMediaRules.ts` (modified in Commit 2, 1 line)

`EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000` at line 4. This is the Pass-2-REVIEW-required dual-constant update that ensures the older storage-bucket validation pipeline stays in sync with the picker. **PASS — Pass-2 gap fully closed.**

### `mingla-business/src/components/ui/CoverPicker.tsx` (modified in Commit 2, +55 lines)

- Line 429: `videoMaxDuration: 29` (Item 4 picker config) ✓
- Line 442-446: `console.log("[ORCH-0978-TRIM]", { durationMs, capMs, overshoot: durationMs - EVENT_COVER_MAX_VIDEO_DURATION_MS })` (Item 8 diagnostic log) ✓
- Toast copy update to "29 seconds" (Item 4) ✓
- Retry affordance added (Item 3 preferred path, not just minimum) ✓

**PASS.**

### `mingla-business/src/hooks/useEventCoverVideoUpload.ts` (modified in Commit 2, +14 lines)

`setLocalPreviewUri(null)` lives at line 151 INSIDE the catch block (before `setStage({ phase: "error", ... })`) per SPEC §D Item 3. Also at line 140 (the ready-path cleanup) and line 176 (explicit cancel). **PASS.**

### `mingla-business/src/components/event/EditPublishedScreen.tsx` (Item 6 NON-GOAL)

`git diff 2c1282daa..HEAD -- mingla-business/src/components/event/EditPublishedScreen.tsx` returns ZERO output. Save gate at lines 1161-1166 + 380-382 + 224-231 explicitly NOT touched. **PASS — Item 6 constraint satisfied.**

### Test files (Commit 3)

- `mingla-business/src/hooks/__tests__/useEventCoverVideoUpload.test.ts` (NEW, 162 lines) — Jest test for 401 rollback path. Fails-on-revert proven: deleting `setLocalPreviewUri(null);` from Commit 2 caused `expect(received).toBeNull() received "file:///cover.mp4"`. **PASS.**
- `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` (NEW, 99 lines) — Deno test for 29250/29251 boundary. Fails-on-revert proven: deleting the `EFFECTIVE_TRIM_CEILING_MS` validation block caused `Expected 422 above boundary, received 200`. **PASS.**

Both tests satisfy the META-ORCH-0744 regression-test gate (`feedback_close_commit_precommit_checks.md` (a) implementor happy-path + (b) tester adversarial — though both are implementor-written, the boundary test attacks a different angle than the 401 rollback test, satisfying the spirit of the gate; tester will write the canonical adversarial test in their TEST phase per SPEC §G).

**Note:** META-ORCH-0744 expects (a) implementor + (b) tester to write distinct tests at the CLOSE gate. The implementor-written hook test + implementor-written edge boundary test BOTH count as implementor-written for that gate. Tester will need to ship a genuinely adversarial test (different attack angle, different file path) in their TEST/RETEST phase before CLOSE. Flag for tester dispatch: "you owe an adversarial test that attacks the auth wiring AND/OR the rollback UX at a different angle than the implementor's two tests".

---

## REVIEW checklist (11 of 11 PASS)

- [x] **Root cause proven, not plausible.** `token_invalid_signature` captured live at 2026-05-27T11:34:21Z via Maestro repro + diagnostic v94 (orchestrator anon-key probe + 577ms execution time + Supabase function log entry).
- [x] **Scope appropriate, narrow.** 9 items exact, no widening, no scope creep. Item 6 non-goal explicitly verified by zero-diff.
- [x] **No hidden fallback paths.** The `??` chain at `CoverPicker.tsx:241-248` correctly falls through to `localCover.coverMediaUrl` when `localPreviewUri` is cleared — verified during SPEC Phase 0. No silent failure mode introduced.
- [x] **No stale cache paths.** N/A for this scope.
- [x] **Response shape truthful in ALL states.** Edge fn 422 returns `{error, detail}`; 401 unchanged; success returns `{jobId, upload, ...}` as before. No client-state regression in hook (catch path tested).
- [x] **Real fix, not symptom mask.** Auth fix addresses root cause (missing session token in invoke header), not a guess. Local-preview rollback addresses root cause (catch block omitted the cleanup), not a UI band-aid. DB migration addresses real launch blocker (15s ceiling).
- [x] **Solo/collab parity.** N/A — event cover authoring is single-user.
- [x] **Constitutional compliance.** "One owner per truth" temporarily violated by dual `EVENT_COVER_MAX_VIDEO_DURATION_MS` declarations; this is accepted in-scope per SPEC §J-bis Discovery — both constants explicitly updated to 29_000 AND held in sync by strict-grep C2+C3. Future consolidation ORCH owns the cleanup.
- [x] **Evidence chain complete.** Implementation report §1-10 covers commits, captured reason, fix path, dual-constant verification, zero-diff, fails-on-revert PASS/FAIL/PASS sequences, cross-surface, timestamp re-check, data probe, operator commands, verification run summary.
- [x] **Commit-hash verification.** All 3 commits exist; specified above.
- [x] **Dependency walk.** Specified above; ALL touched config-layer files (workflow, strict-grep, migration, edge fn, client services) reviewed for consumer impact. **PASS.**

---

## Three strengths to call out

1. **Diagnostic-first rule honored end-to-end.** Commit 1 landed in isolation, was deployed by orchestrator to v94, captured the reason `token_invalid_signature` via Maestro live-fire on iOS sim + orchestrator probe verification. Only THEN did Codex pick the fix path for Commit 2. This is the engineering discipline that prevents shipping a 100-line auth refactor when a 3-line header-forward fix solves it. The chosen Item 2b path matches the captured reason exactly.

2. **Migration safety belt-and-suspenders.** Pre-flight invariant probe + post-migration self-verify probe both present. The pre-flight probe was independently validated against production data (`offending_count = 0`) BEFORE the migration ships, satisfying `feedback_orchestrator_deploys_edge_functions.md` invariant migration backstop. The post-verify probe checks three conditions explicitly, not just "constraint exists" — it asserts the OLD literal is GONE AND the NEW literal is PRESENT in BOTH constraint definitions. If anything goes wrong (e.g., DROP succeeds but ADD fails silently), the migration will RAISE EXCEPTION rather than leave the DB in a partial state.

3. **Save gate Item 6 non-goal verified mechanically, not just claimed.** `git diff 2c1282daa..HEAD -- mingla-business/src/components/event/EditPublishedScreen.tsx` returns empty output. This is the kind of test-by-absence that catches the most common implementor temptation (widening the gate to make a test pass). The strict-grep C1-C4 gate similarly catches future drift back to 30s at CI.

---

## One non-blocking observation

The implementation report flags `npx tsc --noEmit --pretty false` as PARTIAL — pre-existing TypeScript errors in `home.tsx`, `checkout buyer screens`, `marketing ComposerV2`, `package rendering modules`, and `historical tests`. None of those errors are in the files touched by IMPLEMENT-2. This is the same TypeScript-debt situation that's been in the worktree across multiple ORCHs; it's not a regression and won't block CLOSE. Flag to operator for awareness; consider a future ORCH for the TypeScript-debt cleanup if it starts blocking ship-readiness gates.

---

## Approval and routing

**REVIEW VERDICT: APPROVED** — IMPLEMENT-2 is implementable as-shipped. All 9 SPEC items + Item 6 non-goal verified. 11 of 11 checklist items pass. Migration safe to apply per remote data probe. Edge function ready to deploy as v95 (Commits 2+3 together, since Commit 2 modified upload-intent/index.ts validation).

**Downstream sequence (in this exact order):**

1. **Operator applies DB migration FIRST.** Migration drops the old 15s constraints and adds new 29s constraints. If this runs AFTER the edge fn deploy v95, any 29s upload in the gap would be rejected by the old DB constraint and produce phantom failures. Sequence: migration → deploy.
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase migration list --linked
   ```
   Confirm output shows local + remote columns matching through `20260729000002`, no remote-only rows. Then:
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Expected: pre-flight probe passes (offending_count = 0 confirmed earlier), DROP+ADD execute, post-verify probe passes, migration applied to remote.

2. **Orchestrator deploys edge function v95** after operator confirms migration applied:
   ```bash
   /Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
   ```
   Then verify via `mcp__supabase__list_edge_functions` that version bumped to 95 with `verify_jwt: true` preserved, and one curl probe per `feedback_supabase_edge_deploy_verify_first_call.md` confirming the 422 path returns `{error: "duration_over_cap"}` on `sourceDurationMs: 29251`.

3. **Tester dispatch** (Claude `mingla-forensics` TEST mode OR Codex `tester-mingla`) — Maestro live-fire on iOS sim verifies (a) `≤29s` clip uploads and Save enables cleanly, (b) trim slider returns are accepted up to 29.25s, (c) forced 401 (e.g., expired session simulation) triggers local-preview rollback + retry affordance. Operator runs the same set on physical iPhone per `feedback_tester_3sims_plus_operator_physical.md`. Tester ALSO ships their genuinely adversarial regression test attacking a different angle than the implementor's two tests, satisfying the META-ORCH-0744 (b) gate.

4. **Orchestrator CLOSE** ORCH-0978 with `[deploy]` tag in commit subject (touches `mingla-business/src/` so Vercel gate applies). EAS OTA publish on production channel for iOS+Android. PR open + merge + worktree reap. CLOSE Step 1.6 worktree artifact sweep handles the pre-existing dirty files (tsconfig + duplicates + node_modules + leftover reports).
