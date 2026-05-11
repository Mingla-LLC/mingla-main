# ORCHESTRATION ORCH-0776 — Event Cover Video Deploy And Test Handoff

Date: 2026-05-11
Owner: Codex `orchestrator-mingla`
Status: deployed, retest handoff ready
Working tree: `.worktrees/orch-0776-event-cover-video-processing-speed/`

## Plain-English Summary

ORCH-0776 rework removed the broken `processed_at` write that made a successful Cloudinary callback fail against the live database. The six event-cover video Edge functions are now deployed together so tester can run the real iOS, Android, and Web journey against the same deployed backend contract.

## Inputs Reviewed

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS.md`
- Prior FAIL report: `Mingla_Artifacts/reports/QA_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS.md`
- Worktree: `.worktrees/orch-0776-event-cover-video-processing-speed/`

## Deploy Preconditions

- No new ORCH-0776 migration was added in the rework.
- The implementation report records `processed_at` was removed instead of adding a `processed_at` migration.
- Deno check was rerun immediately before deploy for all six functions and returned clean.

Command:

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/event-cover-video-upload-intent/index.ts \
  supabase/functions/event-cover-video-source-uploaded/index.ts \
  supabase/functions/event-cover-video-status/index.ts \
  supabase/functions/event-cover-video-webhook/index.ts \
  supabase/functions/event-cover-video-apply/index.ts \
  supabase/functions/event-cover-video-cancel/index.ts
```

## Deploy Commands Run

```bash
/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-source-uploaded --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-status --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-apply --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-cancel --project-ref gqnoajqerqhnvulmnyvv
```

## Deploy Result

All six deploy commands exited successfully.

Post-deploy function list showed:

| Function | Status | Version | Updated At UTC |
| --- | --- | ---: | --- |
| `event-cover-video-upload-intent` | ACTIVE | 13 | 2026-05-11 04:52:14 |
| `event-cover-video-source-uploaded` | ACTIVE | 1 | 2026-05-11 04:52:16 |
| `event-cover-video-status` | ACTIVE | 13 | 2026-05-11 04:52:17 |
| `event-cover-video-webhook` | ACTIVE | 13 | 2026-05-11 04:52:19 |
| `event-cover-video-apply` | ACTIVE | 13 | 2026-05-11 04:52:21 |
| `event-cover-video-cancel` | ACTIVE | 13 | 2026-05-11 04:52:22 |

Command:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv
```

## Tester Handoff

Created retest prompt:

- `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS.md`

Expected output:

- `Mingla_Artifacts/reports/QA_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS_RETEST.md`

## Hard Guards

- No checkout, Stripe, or ORCH-0777 scope.
- No Giphy/Pexels.
- No raw phone video as public cover URL.
- No fake Cloudinary processing percentage.
- Do not weaken tests.
- Do not close ORCH-0776 until live-fire parity returns PASS or an explicitly accepted CONDITIONAL PASS.

