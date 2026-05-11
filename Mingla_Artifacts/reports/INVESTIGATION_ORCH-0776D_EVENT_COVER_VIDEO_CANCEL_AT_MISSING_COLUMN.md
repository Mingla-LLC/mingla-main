# INVESTIGATION ORCH-0776D — Event Cover Video Upload Intent Live Root Cause Proven

Date: 2026-05-10
Investigator: orchestrator (live runtime forensics, post-0776C unblock)
Mode: INVESTIGATE / RUNTIME PROOF
Verdict: ROOT CAUSE PROVEN — DUAL BUG (schema drift + stale diagnostic deploy)

## Plain-English Verdict

Mingla Business Step 4 video cover upload fails because the Edge function
that prepares the secure Cloudinary upload tries to write to a database
column (`event_cover_video_jobs.cancelled_at`) that does not exist. That
UPDATE silently fails on every call, the existing active job row never gets
moved out of the way, and the new INSERT then collides with the per-event
partial unique index. The user sees `Could not prepare video upload`. The
column was simply never created when `event_cover_video_jobs` was introduced
by ORCH-0770.

A compounding visibility bug: the deployed v2 Edge function returns a bare
`{ error: "internal_error" }` with no `detail` field on insert failures,
which is why ORCH-0776B and ORCH-0776C had to investigate blind.

## Runtime Evidence (proven 2026-05-10 ~21:36 UTC)

### Client log (Metro, dev build)

```
[CreatorStep4Cover] picked cover asset
  eventId=09b4ece6-eabc-4734-8ce3-3a25d90417e4
  brandId=22a18413-bfbf-4087-9ba7-45f70deba0f3
  fileName=IMG_0155.MOV
  fileSize=17563491
  duration=15000
  mimeType=video/quicktime
  isAuthReady=true

[eventCoverVideoProcessingService] upload-intent-request
  requestId=mp0amfln-cgzfd8qj

[eventCoverVideoProcessingService] upload-intent-edge-error
  requestId=mp0amfln-cgzfd8qj

[eventCoverVideoProcessingService] edge-error-payload
  status=500
  error=internal_error
  detail=undefined
  message="Edge Function returned a non-2xx status code"

[CreatorStep4Cover] video processing error
  code=internal_error
  edgeStatus=500
  edgeError=internal_error
  edgeDetail=undefined
  phase=upload_intent
  rawMessage="Could not prepare video upload. Try again."
```

### Edge function access log (Supabase MCP `get_logs`, edge-function service)

```
POST | 500 | /functions/v1/event-cover-video-upload-intent
  execution_time_ms=740
  version=2 (deployment c16cbb55..._2)
  timestamp=1778449008897000
```

### Postgres error log (Supabase MCP `get_logs`, postgres service)

```
ERROR | duplicate key value violates unique constraint
       | "idx_event_cover_video_jobs_one_active_per_event"
       | timestamp=1778449008869000   (28 ms before the Edge 500)
```

### Index definition (DB introspection)

```sql
CREATE UNIQUE INDEX idx_event_cover_video_jobs_one_active_per_event
ON public.event_cover_video_jobs USING btree (event_id)
WHERE (status <> ALL (ARRAY['failed','cancelled','applied']));
```

### Table schema (DB introspection)

`event_cover_video_jobs` columns:

```
id, event_id, brand_id, requested_by, provider, status, apply_mode,
source_public_id, source_asset_id, source_mime_type, source_file_name,
source_bytes, source_duration_ms, trim_start_ms, trim_end_ms,
processed_public_id, processed_asset_id, processed_url, processed_mime_type,
processed_bytes, processed_duration_ms, processed_video_codec, processed_audio_codec,
failure_code, failure_message, provider_payload,
created_at, updated_at, completed_at, applied_at
```

**No `cancelled_at` column exists.** Only `completed_at` and `applied_at`.

### Stuck row (DB query)

```
id=d39903e0-5319-4eef-ab82-fbfc2194addb
event_id=09b4ece6-eabc-4734-8ce3-3a25d90417e4
status=source_uploading
source_file_name=IMG_0163.MOV
source_bytes=30094750
source_duration_ms=15000
created_at=2026-05-10 19:05:42.968337+00
updated_at=2026-05-10 19:05:43.008284+00
```

This row has been stuck for ~2.5 hours. Every subsequent upload-intent call
collides on the partial unique index because the cancel UPDATE that should
move it to `cancelled` silently fails.

### Deployed v2 Edge function (Supabase MCP `get_edge_function`)

The deployed v2 of `event-cover-video-upload-intent` contains:

```ts
if (insertError || !job) {
  console.error(...);
  return jsonResponse({ error: "internal_error" }, 500);   // ← NO detail
}
```

The local source has:

```ts
return jsonResponse(
  { error: "internal_error", detail: "job_insert_failed" },
  500,
);
```

The ORCH-0776C diagnostic-detail returns are committed to local but not yet
deployed.

## Root Cause Chain (6-field proof)

### RC-1 — Confirmed Bug A: `cancelled_at` column does not exist

1. **File/line:** `supabase/functions/event-cover-video-upload-intent/index.ts:183`
   and `supabase/functions/event-cover-video-cancel/index.ts:47`.
2. **Exact code:** cancel UPDATE writes `cancelled_at: new Date().toISOString()`.
3. **Current behavior:** PostgREST returns `42703 column "cancelled_at" does
   not exist`. The `cancelError` branch logs a warning and falls through; no
   rows get moved. Then the INSERT fires and trips the partial unique index.
4. **Expected behavior:** cancel UPDATE succeeds, moving prior active jobs to
   `status='cancelled'` so the partial unique index releases the slot for
   the new INSERT.
5. **Causal chain:** cancel UPDATE silently fails → stuck active row remains
   in `source_uploading` → INSERT trips `idx_event_cover_video_jobs_one_active_per_event`
   → function returns 500 → app shows `Could not prepare video upload`.
6. **Verification:** Postgres ERROR log shows constraint violation 28 ms
   before the Edge 500; schema introspection confirms column missing;
   `grep cancelled_at supabase/migrations/` returns zero hits for
   `event_cover_video_jobs`.

**Classification:** schema drift / data-integrity / S0 launch blocker.

### RC-2 — Confirmed Bug B: Deployed v2 strips error detail

1. **File/line:** deployed v2 of `event-cover-video-upload-intent/index.ts`
   (returns bare `{ error: "internal_error" }` on insert failure); deployed
   v2 of `_shared/eventCoverVideo.ts` (returns bare `internal_error` for
   `event_read_failed`, `role_check_failed`, `role_rank_failed`).
2. **Exact code (deployed):** `return jsonResponse({ error: "internal_error" }, 500);`
3. **Current behavior:** client `edgeError` payload reads `detail: undefined`
   and maps to generic `Could not prepare video upload.`
4. **Expected behavior:** each `internal_error` carries a `detail` slug
   so operator/dev tooling can name the failing gate without DB log access.
5. **Causal chain:** function returns bare error → client cannot tell which
   gate failed → three forensic passes (0776/0776B/0776C) burned cycles
   chasing the wrong end of the pipeline.
6. **Verification:** local source diff vs deployed bundle retrieved via
   `mcp__supabase__get_edge_function`. ORCH-0776C diagnostic-contract work
   is awaiting deploy.

**Classification:** production-hardening gap / UX gap.

## Blast Radius

Affected:

- `event-cover-video-upload-intent` (every Step 4 video pick collides on
  retry until the stuck row is cleared)
- `event-cover-video-cancel` (manual cancel also silently broken)
- Possibly any future code that updates `event_cover_video_jobs.cancelled_at`

Not affected:

- Image/GIF cover upload (different code path)
- Giphy/Pexels (not implemented)
- Ticket checkout (different table)
- Public playback (read-only)

## Immediate Operational Unblock (one-time data fix)

Mark the existing stuck row as cancelled so the very next upload-intent
attempt for event `09b4ece6` can succeed:

```sql
UPDATE event_cover_video_jobs
SET status = 'cancelled',
    failure_code = 'orch_0776d_manual_unblock',
    failure_message = 'Cancelled by orchestrator pending ORCH-0776D fix.',
    updated_at = now()
WHERE event_id = '09b4ece6-eabc-4734-8ce3-3a25d90417e4'
  AND status NOT IN ('failed','cancelled','applied');
```

This is a stopgap; the durable fix is ORCH-0776D below.

## Required Fix (ORCH-0776D dispatch — Codex `implementor-mingla`)

See `prompts/IMPLEMENTOR_ORCH-0776D_EVENT_COVER_VIDEO_JOBS_CANCEL_AT_AND_DETAIL_DEPLOY.md`.

Summary:

1. New migration `20260515000014_orch_0776d_event_cover_video_cancelled_at.sql`
   adding `cancelled_at timestamptz NULL`.
2. Transactional backfill of stuck rows in same migration.
3. Redeploy all five event-cover video edge functions so the ORCH-0776C
   diagnostic-detail returns are live.
4. Regression test: client maps `{error:"internal_error",detail:"job_insert_failed"}`
   to a distinct retryable message.
5. Strict-grep gate `orch-0776d-cancelled-at-schema.mjs` blocking future
   `cancelled_at` writes if the column is not declared in latest migration scan.

## Why Three Prior Forensic Passes Missed This

- ORCH-0776 root: investigated post-source-upload (wrong half of the pipeline).
- ORCH-0776A: source-upload progress UX (correct ship; never reached).
- ORCH-0776B: stale Edge deploy (real, but not sufficient).
- ORCH-0776C: blocked on missing `requestId` evidence.

This session closed the loop by capturing the requestId from Metro, matching
it to the Supabase Edge 500, then correlating with the Postgres ERROR 28 ms
earlier and the DB schema introspection. Memory `feedback_headless_qa_rpc_gap.md`
already codifies the pattern — runtime SQL behavior cannot be proved from
code reading alone.

## Confidence

- Bug A (missing column): HIGH — schema introspection + Postgres ERROR +
  Edge log line up at millisecond resolution.
- Bug B (stripped detail): HIGH — deployed v2 source retrieved via MCP and
  diffed against local.
- Stuck-row source: HIGH — direct DB query.
- Blast radius: HIGH — grep of `cancelled_at` writes across `supabase/functions/`
  returns exactly two callers (upload-intent, cancel).

## Cross-References

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776C_VIDEO_UPLOAD_INTENT_POST_DEPLOY_FAILURE.md`
  (prior pass — supersedes the "blocked on requestId" verdict)
- `Mingla_Artifacts/reports/DEPLOY_PROBE_ORCH-0776B_VIDEO_UPLOAD_INTENT_DIAGNOSTICS.md`
  (deploy probe that bumped functions to v2)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0776A_EVENT_COVER_UPLOAD_PROGRESS_AND_HONEST_PROCESSING.md`
  (source-upload progress; downstream of this fix)
- `Mingla_Artifacts/SESSION_BRIEF_EVENT_COVER_VIDEO_UPLOAD_RECOVERY.md`
  (session brief — root cause section now resolvable)
