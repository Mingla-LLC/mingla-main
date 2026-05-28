# IMPLEMENTATION ORCH-0978 IMPLEMENT-6

Status: implemented and verified

Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`

## Summary

Implemented SPEC AMENDMENT 8 Option A: generous source acceptance and tight processed persistence for event cover videos.

- Client source acceptance now uses `EVENT_COVER_SOURCE_CEILING_MS = 33_000` while preserving the native trimmer target `videoMaxDuration: 29`, the 29s diagnostic log, and the "Please trim to 29 seconds first." toast.
- Upload intent now uses `SOURCE_CEILING_MS = 33_000` for raw source validation and clamps `trim_end_ms` to `MAX_DURATION_MS` before validation, DB insert, and Cloudinary `du_`.
- New migration `20260730000001_orch_0978_video_cap_generous_source.sql` raises `event_cover_video_jobs` trim-window and processed-duration constraints from `<= 29000` to `<= 30000`.
- ORCH-0978 strict-grep now enforces C4/C10/C11 for the 30000 DB cap, 33000 source cap, dead old edge ceiling, and client source>processed relationship.
- ORCH-0863 backend allowlist includes the new migration in the same product commit.

## Commits

- Commit 1 product fix: `5d714a1d24c06a5558c9860675ed2516a470927f`
- Commit 2 tests + report: this commit

Commit 1 subject includes `[TEST-MOD-APPROVED ORCH-0978]` because the existing Deno duration boundary test contract changed from 29250/29251 to 33000/33001 per SPEC AMENDMENT 8.

## Spec Traceability

- `mingla-business/src/services/eventCoverVideoProcessingService.ts`: added `EVENT_COVER_SOURCE_CEILING_MS = 33_000`; left `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`.
- `mingla-business/src/components/ui/CoverPicker.tsx`: changed the rejection gate from `EVENT_COVER_MAX_VIDEO_DURATION_MS + 250` to `EVENT_COVER_SOURCE_CEILING_MS`; preserved `videoMaxDuration: 29`, `[ORCH-0978-TRIM]`, and toast copy.
- `supabase/functions/event-cover-video-upload-intent/index.ts`: replaced `EFFECTIVE_TRIM_CEILING_MS` with `SOURCE_CEILING_MS = 33_000`; added `rawTrimEndMs` and `Math.min(rawTrimEndMs, MAX_DURATION_MS)` before `validateTrimRange` and insert.
- `supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql`: added pre-flight guard for rows above 30000, drop/re-add constraints at 30000, and post-verify guards for stale 29000 and missing 30000 constraints.
- `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`: revised C4 and added C10/C11.
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`: appended the migration to `ORCH_0978_BACKEND_ALLOWLIST`.
- Tests: `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` and `mingla-business/src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts`.

## Database Probes

Read-only production probe before migration handoff:

```sql
select
  count(*) filter (where (trim_end_ms - trim_start_ms) > 30000 or (processed_duration_ms is not null and processed_duration_ms > 30000)) as rows_exceeding_30000,
  count(*) filter (where (trim_end_ms - trim_start_ms) > 29000 or (processed_duration_ms is not null and processed_duration_ms > 29000)) as rows_exceeding_29000,
  max(trim_end_ms - trim_start_ms) as max_trim_window_ms,
  max(processed_duration_ms) as max_processed_duration_ms
from public.event_cover_video_jobs;
```

Result: `rows_exceeding_30000=0`, `rows_exceeding_29000=0`, `max_trim_window_ms=15520`, `max_processed_duration_ms=15520`.

Read-only source-duration constraint probe:

```sql
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.event_cover_video_jobs'::regclass
  and pg_get_constraintdef(oid) ilike '%source_duration_ms%'
order by conname;
```

Result: zero rows. No existing `source_duration_ms` constraint blocks 33000.

Migration history precheck:

- `/Users/sethogieva/bin/supabase migration list --linked` succeeded.
- No remote-only versions were present.
- New migration appears as local-only `20260730000001`, which is expected before operator `db push`.

## Verification

Passed:

- `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`
- `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-upload-intent/index.ts`
- `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/event-cover-video-upload-intent/`
- `npx jest src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts --runInBand`
- `git diff --check`

Note: `deno test supabase/functions/event-cover-video-upload-intent/` without `--allow-env` failed on Deno env permission before tests ran; rerun with the required env permission passed all 4 tests.

Existing broad `eventCoverMedia.test.ts` is stale against prior ORCH-0876/EventCoverMedia ownership changes and fails unrelated assertions when run directly. IMPLEMENT-6 adds a focused CoverPicker regression instead of modifying that unrelated broad suite.

## Regression Coverage And Fails-On-Revert Receipts

- Edge source boundary: `SOURCE_CEILING_MS` accepts 33000 and rejects 33001 with `duration_over_cap` and `ceilingMs=33000`. Reverting to `EFFECTIVE_TRIM_CEILING_MS = 29_250` fails the new boundary test and strict-grep C10.
- Edge clamp: `sourceDurationMs=31000, trimEndMs=31000` persists `source_duration_ms=31000`, `trim_end_ms=30000`, and produces `du_30`. Removing the clamp fails the clamp test and strict-grep C10.
- Normal trim: `sourceDurationMs=29400, trimEndMs=29400` persists `trim_end_ms=29400`, proving the clamp does not truncate normal iOS trims below 30s.
- Client source ceiling: focused Jest test proves 30500 is within the 33000 source ceiling, 34000 is rejected, `videoMaxDuration: 29` remains, and the old `EVENT_COVER_MAX_VIDEO_DURATION_MS + 250` gate is dead.
- DB cap: strict-grep C4 reads the new migration and fails if either constraint is not `<= 30000`.

## Deploy Notes

Do not run `db push` from implementor. Operator applies the migration after orchestrator REVIEW using:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase db push --linked
```

After that, orchestrator redeploys only `event-cover-video-upload-intent`. `_shared/eventCoverVideo.ts` was not touched, so the prior batch-redeploy rule does not apply.

## Downstream

Return to orchestrator REVIEW for commit-hash verification and dependency walk. Then operator DB push, orchestrator upload-intent redeploy and curl probe, tester live-fire RETEST, Seth physical-iPhone re-check, and orchestrator CLOSE.
