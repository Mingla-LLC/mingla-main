# IMPLEMENTATION ORCH-0978 IMPLEMENT-4

Status: implemented and verified
Date: 2026-05-27
Skill: Codex `implementor-mingla`
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`

## Layman Summary

Cover-video uploads no longer fail just because Cloudinary omits a duration field in the eager callback. The webhook now falls back to the job's trim window, writes truthful duration failure codes, and upload-intent asks Cloudinary to cap processed output duration with `du_<seconds>` as defense-in-depth. No client code, migrations, Supabase config, deploys, or PRs were touched.

## Comms Ledger

- COMMS-0002 WARN factored: the new backend test file is appended to `ORCH_0978_BACKEND_ALLOWLIST` in the same test commit.
- COMMS-0003 WARN factored: new Cloudinary behavior assumptions include source comments with Cloudinary docs URLs.
- COMMS-0004 WARN factored: no intake/ID assignment occurred in this implementation.

## Commits

1. `96695e027` - `ORCH-0978 IMPLEMENT-4 step 1: webhook processed-duration fallback + error-code split + eager du_ defense-in-depth`
2. `fbec6bada` - `ORCH-0978 IMPLEMENT-4 step 2: duration-fallback Deno tests + ORCH_0978_BACKEND_ALLOWLIST extension`

## Files Read

- `Mingla_Artifacts/prompts/IMPLEMENTOR_IMPLEMENT_4_ORCH-0978.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` section `SPEC AMENDMENT 6`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_PROCESSED_DURATION_INVALID.md`
- `supabase/functions/event-cover-video-webhook/index.ts`
- `supabase/functions/_shared/eventCoverVideo.ts`
- `supabase/functions/event-cover-video-upload-intent/index.ts`
- `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts`
- `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

## Change Receipts

| Contract | Implemented |
|---|---|
| Split old processed-duration code | `_shared/eventCoverVideo.ts` now returns `processed_duration_missing`, `processed_duration_nonpositive`, or `processed_duration_over_cap`; the old literal is removed from active source. |
| Fallback to job trim | Webhook job select now includes `trim_start_ms,trim_end_ms`; `eagerDurationOrFallback` falls back to `trim_end_ms - trim_start_ms` only when provider duration is absent/non-numeric. Numeric zero remains a real provider value and is rejected as nonpositive. |
| Missing duration remains missing | Webhook passes `durationMs: durationMs ?? undefined` into validation so missing provider duration plus missing trim writes `processed_duration_missing`, not a null-to-zero nonpositive failure. |
| Diagnostic fallback log | Webhook emits `stage: "duration_fallback_to_job_trim"` with `jobId`, `fallbackDurationMs`, and `publicId` when fallback is used. |
| Cloudinary `du_` defense-in-depth | Upload-intent eager chain now includes `du_${durationBudgetSeconds}` with the Cloudinary transformation docs URL in source. |
| Strict-grep C6/C7 | ORCH-0978 guard enforces `eagerDurationOrFallback` plus `trim_end_ms`, requires the three new codes, and rejects the old literal under `supabase/functions` and `mingla-business/src`. |
| Deno regression | New `duration-fallback.test.ts` covers T-AMEND6-01 through T-AMEND6-05 using the captured Cloudinary payload from the investigation. |
| ORCH-0863 allowlist | `duration-fallback.test.ts` is appended to `ORCH_0978_BACKEND_ALLOWLIST`. |

## Spec Traceability

| Success Criterion | Evidence |
|---|---|
| SC-1 missing-duration happy path | T-AMEND6-01 passes; writes ready update with `processed_duration_ms=12000` and captured eager `secure_url`. |
| SC-2 fallback diagnostic log | T-AMEND6-01 captures `duration_fallback_to_job_trim`. |
| SC-3 genuine over-cap | T-AMEND6-03 writes `processed_duration_over_cap`. |
| SC-4 missing duration and missing trim | T-AMEND6-04 writes `processed_duration_missing`. |
| SC-5 nonpositive | T-AMEND6-05 writes `processed_duration_nonpositive`. |
| SC-6 eager `du_` and guards | ORCH-0978 strict-grep C6/C7 pass. |
| SC-7 deploy | Not performed by implementor; orchestrator owns batch deploy and verify-first-call probe. |
| SC-8 old literal dead | Dead-literal gate returns zero matches in active/tracked source. |

## Invariants And Guards

- Webhook `verify_jwt = false` preserved: no `supabase/config.toml` touch.
- No client touches in scoped commits: zero-touch diff check is empty for `app-mobile/**`, `mingla-business/src/**`, `mingla-admin/**`, `supabase/config.toml`, and `supabase/migrations/**`.
- No migration and no `supabase db push`.
- No edge deploy and no PR open.
- IMPLEMENT-3 seam preserved: `handleEventCoverVideoWebhook` and `recoverJobIdFromPayload` remain exported and job-id recovery tests pass.
- `processed_duration_invalid` is dead in active source.

## Verification Gates

### Deno Check

Command:

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-webhook/index.ts supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts supabase/functions/_shared/eventCoverVideo.ts supabase/functions/event-cover-video-upload-intent/index.ts
```

Output:

```text
Check supabase/functions/event-cover-video-webhook/index.ts
Check supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts
Check supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts
Check supabase/functions/_shared/eventCoverVideo.ts
Check supabase/functions/event-cover-video-upload-intent/index.ts
```

### Deno Test

Command:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts
```

Output:

```text
running 5 tests from ./supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts
T-AMEND6-01 falls back to job trim for fixture-faithful Cloudinary payload ...
------- output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- output end -----
T-AMEND6-01 falls back to job trim for fixture-faithful Cloudinary payload ... ok (7ms)
T-AMEND6-02 uses Cloudinary float-second duration without fallback warning ...
------- output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- output end -----
T-AMEND6-02 uses Cloudinary float-second duration without fallback warning ... ok (1ms)
T-AMEND6-03 writes over-cap code for genuine provider over-duration ...
------- output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- output end -----
T-AMEND6-03 writes over-cap code for genuine provider over-duration ... ok (1ms)
T-AMEND6-04 writes missing code when provider duration and trim fallback are absent ...
------- output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- output end -----
T-AMEND6-04 writes missing code when provider duration and trim fallback are absent ... ok (1ms)
T-AMEND6-05 writes nonpositive code for zero provider duration ...
------- output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- output end -----
T-AMEND6-05 writes nonpositive code for zero provider duration ... ok (0ms)
running 5 tests from ./supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts
ORCH-0978 webhook recovers job_id from eager public_id when context is absent ...
------- post-test output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- post-test output end -----
ORCH-0978 webhook recovers job_id from eager public_id when context is absent ... ok (3ms)
ORCH-0978 webhook keeps context job_id precedence over public_id fallback ...
------- post-test output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- post-test output end -----
ORCH-0978 webhook keeps context job_id precedence over public_id fallback ... ok (0ms)
ORCH-0978 webhook rejects malformed public_id without a UUID last segment ...
------- post-test output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- post-test output end -----
ORCH-0978 webhook rejects malformed public_id without a UUID last segment ... ok (1ms)
ORCH-0978 webhook rejects missing context and missing public_id ...
------- post-test output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
[event-cover-video-webhook] {"publicId":null,"hasContext":false,"stage":"job_id_extraction_failed"}
----- post-test output end -----
ORCH-0978 webhook rejects missing context and missing public_id ... ok (1ms)
ORCH-0978 webhook preserves legacy pipe-delimited context job_id ...
------- post-test output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- post-test output end -----
ORCH-0978 webhook preserves legacy pipe-delimited context job_id ... ok (0ms)

ok | 10 passed | 0 failed (134ms)
```

### Strict-Grep ORCH-0978

Command:

```bash
node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs
```

Output:

```text
OK   [C1] CoverPicker client picker cap is 29 seconds
OK   [C2] Cloudinary-pipeline constant is 29_000
OK   [C3] Storage-pipeline constant is 29_000
OK   [C4] DB migration pins both video duration constraints to 29000
OK   [C5] Upload-intent public_id template and webhook public_id parser remain aligned
OK   [C6] Webhook duration fallback remains tied to job trim columns
OK   [C7] Processed-duration validation uses discrete codes and the old literal is dead
```

### Strict-Grep ORCH-0863

Command:

```bash
node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Output:

```text
# ORCH-0863 strict-grep gate - Marketing Hub Phase B
OK   [C1: overview-no-dollar] no '$' literal in Overview route
OK   [C2: overview-no-revenue] no 'revenue' substring in Overview route
OK   [C3: overview-no-opened] no 'Opened' funnel-card label literal
OK   [C4: starter-pack-guard] defense-in-depth guard present (3 assertNotStarterPack calls)
OK   [C5: compose-template-param] useLocalSearchParams includes 'template?: string'
OK   [C6: overview-service-exists] getMarketingOverview export present
OK   [C7: no-new-backend-files] zero touches under supabase/migrations/ or supabase/functions/ (98 files changed total)
# All checks PASS
```

### Whitespace

Command:

```bash
git diff --check HEAD~2..HEAD
```

Output: empty, exit 0.

### Zero-Touch Verification

Command:

```bash
git diff --name-only HEAD~2..HEAD -- 'app-mobile/**' 'mingla-business/src/**' 'mingla-admin/**' 'supabase/config.toml' 'supabase/migrations/**'
```

Output: empty, exit 0.

### Dead Literal

Command:

```bash
/opt/homebrew/bin/timeout 20s rg "processed_duration_invalid" supabase/ mingla-business/src/ mingla-admin/ app-mobile/
```

Output: empty, exit 1 (`rg` no matches). The timeout wrapper was used because this worktree has pre-existing untracked dependency folders under `app-mobile/node_modules` and `mingla-admin/node_modules`; the command completed before timeout.

Tracked-source cross-check:

```bash
git ls-files supabase mingla-business/src mingla-admin app-mobile | xargs rg -n "processed_duration_invalid"
```

Output: empty, exit 1 (`rg` no matches).

## Fails-On-Revert Proof

PASS on fixed code at product commit `96695e027` plus test commit `fbec6bada`:

```text
ok | 5 passed | 0 failed (15ms)
```

Temporary revert diff:

```diff
diff --git a/supabase/functions/event-cover-video-webhook/index.ts b/supabase/functions/event-cover-video-webhook/index.ts
index 8bf6094c8..c91514663 100644
--- a/supabase/functions/event-cover-video-webhook/index.ts
+++ b/supabase/functions/event-cover-video-webhook/index.ts
@@ -81,10 +81,7 @@ const eagerDurationOrFallback = (
   // Reference: https://cloudinary.com/documentation/upload_images#notification_url
   // The job's trim window is the authoritative source: upload-intent enforced the cap
   // before upload, and the eager transformation now also enforces du_<seconds>.
-  const start = typeof job.trim_start_ms === "number" ? job.trim_start_ms : 0;
-  const end = typeof job.trim_end_ms === "number" ? job.trim_end_ms : null;
-  if (end === null || end <= start) return null;
-  return end - start;
+  return null;
 };
```

FAIL with fallback removed:

```text
running 5 tests from ./supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts
T-AMEND6-01 falls back to job trim for fixture-faithful Cloudinary payload ...
------- output -------
[event-cover-video-webhook] {"hasSignature":true,"hasTimestamp":true,"stage":"webhook_received"}
----- output end -----
T-AMEND6-01 falls back to job trim for fixture-faithful Cloudinary payload ... FAILED (5ms)
T-AMEND6-02 uses Cloudinary float-second duration without fallback warning ... ok (0ms)
T-AMEND6-03 writes over-cap code for genuine provider over-duration ... ok (0ms)
T-AMEND6-04 writes missing code when provider duration and trim fallback are absent ... ok (0ms)
T-AMEND6-05 writes nonpositive code for zero provider duration ... ok (0ms)

ERRORS

T-AMEND6-01 falls back to job trim for fixture-faithful Cloudinary payload => ./supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts:173:6
error: Error: expected ready update; received failed update with failure_code=processed_duration_missing failure_message=Processed video duration was missing from the provider callback.
      throw new Error(
            ^
    at readyUpdate (file:///Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts:158:13)
    at file:///Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts:183:17

FAILED | 4 passed | 1 failed (12ms)
```

PASS restored:

```text
running 5 tests from ./supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts
T-AMEND6-01 falls back to job trim for fixture-faithful Cloudinary payload ... ok (7ms)
T-AMEND6-02 uses Cloudinary float-second duration without fallback warning ... ok (0ms)
T-AMEND6-03 writes over-cap code for genuine provider over-duration ... ok (0ms)
T-AMEND6-04 writes missing code when provider duration and trim fallback are absent ... ok (0ms)
T-AMEND6-05 writes nonpositive code for zero provider duration ... ok (0ms)

ok | 5 passed | 0 failed (15ms)
```

Post-restore `git diff -- supabase/functions/event-cover-video-webhook/index.ts` output: empty.

## Current Worktree Notes

Pre-existing dirty/untracked files remain in the worktree and were not touched or staged by this implementation: `app-mobile/tsconfig.json`, `mingla-business/tsconfig.json`, untracked prior ORCH reports/runtime screenshots, and untracked dependency folders. Scoped commit diff for IMPLEMENT-4 is exactly:

```text
M	.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
M	.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs
M	supabase/functions/_shared/eventCoverVideo.ts
M	supabase/functions/event-cover-video-upload-intent/index.ts
A	supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts
M	supabase/functions/event-cover-video-webhook/index.ts
```

## Deploy Notes

Implementor did not deploy. Orchestrator should batch redeploy all six event-cover-video functions from this worktree after REVIEW and close promotion authorization:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]"
for fn in event-cover-video-webhook event-cover-video-upload-intent event-cover-video-source-uploaded event-cover-video-status event-cover-video-apply event-cover-video-cancel; do
  /Users/sethogieva/bin/supabase functions deploy "$fn" --project-ref gqnoajqerqhnvulmnyvv
done
```

Then verify versions and run the webhook first-call probe expecting HTTP 403 `missing_signature`.

## Downstream

Hand back to Claude `mingla-orchestrator` for REVIEW, commit-hash verification, dependency walk, batch redeploy, verify-first-call probe on webhook v122, and routing to tester live-fire T-AMEND6-06 on iOS sim. After tester PASS, pause for Seth physical iPhone T-1/T-2/T-3, then CLOSE with `[deploy]` tag, EAS OTA, PR, squash merge, and worktree reap.
