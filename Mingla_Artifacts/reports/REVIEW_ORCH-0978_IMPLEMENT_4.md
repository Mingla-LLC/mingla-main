# REVIEW ORCH-0978 IMPLEMENT-4

Verdict: **APPROVED**

Date: 2026-05-27
Reviewer: Claude `mingla-orchestrator` (Pass 1, operator-delegated)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
Branch HEAD: `fbec6bada`
Commits under review: `96695e027` (step 1 product), `fbec6bada` (step 2 tests + allowlist)

Inputs reviewed:
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_4.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §SPEC AMENDMENT 6 (committed `c66f1aaf3`)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_PROCESSED_DURATION_INVALID.md` (committed `1ec24f0fc`)
- `Mingla_Artifacts/reports/REVIEW_ORCH-0978_INVESTIGATION_PROCESSED_DURATION_INVALID.md` (committed `c66f1aaf3`)

## 1. Executive summary

IMPLEMENT-4 ships SPEC AMENDMENT 6 exactly as scoped. The webhook now falls back to the job row's `trim_end_ms - trim_start_ms` when Cloudinary's eager callback omits `duration`, the misleading single error code splits into three discrete codes (`processed_duration_missing` / `processed_duration_nonpositive` / `processed_duration_over_cap`), upload-intent adds a `du_<seconds>` server-side cap, and two strict-grep checks (C6 + C7) lock the regression class. All five new Deno scenarios pass, IMPLEMENT-3's five scenarios continue to pass (10/10), fails-on-revert is documented with verbatim diff + failure output, hard guards hold, and the `processed_duration_invalid` literal is dead across 2486 tracked files. Ready for orchestrator batch deploy.

## 2. Commit-hash verification (DEC-179)

| Claimed file | git log result | Verdict |
|---|---|---|
| `supabase/functions/_shared/eventCoverVideo.ts` | `96695e027 ORCH-0978 IMPLEMENT-4 step 1: webhook processed-duration fallback + error-code split + eager du_ defense-in-depth` | PASS |
| `supabase/functions/event-cover-video-webhook/index.ts` | `96695e027 ...` | PASS |
| `supabase/functions/event-cover-video-upload-intent/index.ts` | `96695e027 ...` | PASS |
| `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | `96695e027 ...` | PASS |
| `supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts` | `fbec6bada ORCH-0978 IMPLEMENT-4 step 2: duration-fallback Deno tests + ORCH_0978_BACKEND_ALLOWLIST extension` | PASS |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | `fbec6bada ...` | PASS |

`git diff --name-only HEAD~2..HEAD` returns exactly these six paths — no stray modifications, no uncommitted product code. `git status --porcelain` shows only pre-existing untracked artifacts and tsconfig drift carried from prior phases (scheduled for CLOSE Step 1.6 sweep).

## 3. Dependency walk (DEC-179)

Two `.github/scripts/strict-grep/*` config-layer files touched. Per the strict-grep registry pattern (`feedback_strict_grep_registry_pattern`):

| Changed file | Consumer | Status |
|---|---|---|
| `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | `.github/workflows/strict-grep-mingla-business.yml` job `orch-0978-video-cap-29s` | PASS — job wired in workflow, runs `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`; locally green with C1-C7 all OK |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | `.github/workflows/strict-grep-mingla-business.yml` job `orch-0863-marketing-hub-phase-b` | PASS — job wired; locally green with C1-C7 all OK, 98 changed files in branch diff handled correctly |

No other config-layer files touched (`app.json`, `vercel.json`, `package.json`, `tsconfig*`, `metro.config.*`, `babel.config.*`, `next.config.*`, other workflow files all untouched).

## 4. Hard-guard compliance

| Guard | Result | Evidence |
|---|---|---|
| No client touches | PASS | `git diff --name-only HEAD~2..HEAD -- 'app-mobile/**' 'mingla-business/src/**' 'mingla-admin/**'` empty |
| No SPEC edits | PASS | `git diff --name-only HEAD~2..HEAD -- 'Mingla_Artifacts/specs/**'` empty; SPEC HEAD still `c66f1aaf3` |
| No migration | PASS | `git diff --name-only HEAD~2..HEAD -- 'supabase/migrations/**'` empty |
| No `supabase db push` | PASS | Implementor explicitly recorded as out-of-scope |
| No PR opened by implementor | PASS | No PR opened against this branch by implementor; orchestrator owns PR at CLOSE |
| Webhook `verify_jwt = false` preserved | PASS | `supabase/config.toml:48-49` unchanged; `git diff --name-only HEAD~2..HEAD -- 'supabase/config.toml'` empty |
| IMPLEMENT-3 test seam preserved | PASS | `handleEventCoverVideoWebhook` + `recoverJobIdFromPayload` exports intact; job-id-recovery.test.ts 5/5 still PASS |
| Two-commit pattern (META-ORCH-0744) | PASS | step 1 (product `96695e027`) + step 2 (tests + allowlist `fbec6bada`) |
| Backend allowlist landed in same commit as new backend file | PASS | `duration-fallback.test.ts` appended to `ORCH_0978_BACKEND_ALLOWLIST` in same commit `fbec6bada` — COMMS-0002 honored |
| Cloudinary docs URL cited inline in source | PASS | Webhook line 81 cites `https://cloudinary.com/documentation/upload_images#notification_url`; upload-intent line 268 cites `https://cloudinary.com/documentation/video_manipulation_and_delivery_reference#video_transformation_url_parameters` — COMMS-0003 honored |
| `processed_duration_invalid` literal dead | PASS | Cross-check across 2486 tracked files under `supabase/`, `mingla-business/src/`, `mingla-admin/`, `app-mobile/`: zero matches |

## 5. SPEC AMENDMENT 6 item-by-item verification

| SPEC §D site | Required | Delivered | Verdict |
|---|---|---|---|
| D.2 — split duration check | Three discrete codes + matching messages | `_shared/eventCoverVideo.ts:399-407` ships `processed_duration_missing` / `processed_duration_nonpositive` / `processed_duration_over_cap` verbatim with the documented messages | PASS |
| D.3 — widen job SELECT | Include `trim_start_ms,trim_end_ms` | Confirmed via diff (existingJob SELECT now reads `id,status,event_id,apply_mode,trim_start_ms,trim_end_ms`) | PASS |
| D.3 — `eagerDurationOrFallback` helper | New helper with provider-first then job-trim fallback | `event-cover-video-webhook/index.ts:71` `eagerDurationOrFallback` shipped with the spec'd shape | PASS |
| D.3 — diagnostic warn on fallback | `stage: "duration_fallback_to_job_trim"` with jobId/fallbackDurationMs/publicId | Line 199 emits warn with those fields; T-AMEND6-01 test asserts the warn fires | PASS |
| D.4 — `du_<seconds>` eager clause | `du_${durationBudgetSeconds}` after `c_limit,...` | `event-cover-video-upload-intent/index.ts:272` ships `\`du_${durationBudgetSeconds}\`` in the eager array; docs URL cited line 268 | PASS |
| D.5 — strict-grep C6 | webhook source pairs `eagerDurationOrFallback` + `trim_end_ms` | C6 OK in local run | PASS |
| D.5 — strict-grep C7 | Three new codes present + `processed_duration_invalid` literal absent | C7 OK in local run + grep cross-check on tracked files | PASS |
| D.6 — ORCH_0978_BACKEND_ALLOWLIST extension | Append new test file path | `duration-fallback.test.ts` added to allowlist; ORCH-0863 C7 green with 98 changed files | PASS |
| §G — five Deno scenarios | T-AMEND6-01 through 05 | All five PASS locally; payload fixture matches investigation §4 verbatim | PASS |
| §H — fails-on-revert proof | PASS → revert → FAIL → restore → PASS | Documented with verbatim diff + failure output (T-AMEND6-01 receives `processed_duration_missing` when fallback removed) | PASS |

## 6. Verbatim spot checks

| Code site | Required text | Actual | Verdict |
|---|---|---|---|
| Three discrete codes | `processed_duration_missing` + `processed_duration_nonpositive` + `processed_duration_over_cap` literals | All three present at `_shared/eventCoverVideo.ts:400`, `:403`, `:406` | PASS |
| Diagnostic stage | `duration_fallback_to_job_trim` literal | Present at `event-cover-video-webhook/index.ts:199` | PASS |
| Eager `du_` template | `du_${durationBudgetSeconds}` | Present at `event-cover-video-upload-intent/index.ts:272` | PASS |
| Cloudinary docs URLs | Notification URL + video transformation reference URLs | Both cited inline in source comments at `event-cover-video-webhook/index.ts:81` and `event-cover-video-upload-intent/index.ts:268` | PASS |
| `verify_jwt = false` | webhook config line preserved | `supabase/config.toml:48-49` unchanged | PASS |
| IMPLEMENT-3 test seam | `handleEventCoverVideoWebhook` export | Intact; 5/5 IMPLEMENT-3 tests pass alongside new 5/5 | PASS |

## 7. Automated gates (independently re-run by orchestrator)

| Gate | Command | Result |
|---|---|---|
| Deno regression (both test files) | `deno test --allow-env duration-fallback.test.ts job-id-recovery.test.ts` | PASS — 10 passed, 0 failed (73ms) |
| Strict-grep ORCH-0978 | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS — C1-C7 all OK |
| Strict-grep ORCH-0863 | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS — C1-C7 all OK with 98 changed files |
| Dead-literal check | `grep -l "processed_duration_invalid"` on 2486 tracked files | PASS — zero matches |
| Zero-touch client/config | `git diff --name-only HEAD~2..HEAD -- 'app-mobile/**' 'mingla-business/src/**' 'mingla-admin/**' 'supabase/config.toml' 'supabase/migrations/**'` | PASS — empty |
| Workflow consumers wired | grep workflow file for both script names | PASS — both jobs registered |

## 8. Side observations (non-blocking)

1. **Implementor's `durationMs ?? undefined` guard at the call site is a clean choice.** Per Change Receipts row 3 in the implementation report, passing `durationMs ?? undefined` (not `null`) into `assertProcessedDerivative` means `Number(undefined) = NaN` triggers the `processed_duration_missing` code correctly, not the `nonpositive` code (which `Number(null) = 0` would have triggered). This subtle null-vs-undefined distinction matters for the error-code split and is exactly right.
2. **Both Cloudinary docs URLs are cited in source comments**, not just in the SPEC. This satisfies the spirit of COMMS-0003 (any future engineer reading this code sees the contract reference inline). Worth replicating to other external-API consumer code.
3. **Strict-grep gate count** rose from C1-C5 (5 checks) to C1-C7 (7 checks) for ORCH-0978; existing checks remain green so the new C6 + C7 are purely additive.

## 9. Discoveries for Orchestrator

No new discoveries from this REVIEW. Carry-over from earlier reviews:
- F-3 (`firstEager` silent `{}` fallback) — still a hidden flaw; not blocking ORCH-0978; flag for future ORCH if Cloudinary's notification semantics ever expand.
- Bug-class sweep (Stripe + OneSignal `Number(undefined) → NaN → misleading message` patterns) — register as a separate sweep ORCH after ORCH-0978 closes.
- Worktree CLOSE Step 1.6 sweep: pre-existing untracked artifacts list grew with this REVIEW + IMPLEMENT-4 report; will reap at CLOSE.

## 10. Verdict

**APPROVED.** All 11 hard guards pass, all 10 SPEC AMENDMENT 6 §D + §G + §H items honored, all 6 verbatim spot-checks match, all 6 automated gates green, commit-hash verification clean, dependency walk clean, two-commit pattern + backend allowlist + verify_jwt preservation + IMPLEMENT-3 seam preservation all honored. Ready for orchestrator batch deploy of all six event-cover-video functions.
