# TEST REPORT ORCH-0770 — Full Phone Video Transcode + Compression Runtime Gate

## Verdict: BLOCKED / UNVERIFIED FOR RUNTIME

The ORCH-0770 webhook/security rework passes static, deploy, schema, and negative webhook verification. The previous P1 blockers are fixed: the Cloudinary webhook is no longer blocked by Supabase gateway JWT auth, timestamp-aware Cloudinary signature verification is present, Cloudinary secrets are configured by name, and the plaintext credential artifact is ignored/removed from git visibility.

This is **not close-ready** because the required real organiser runtime journey was not executed in this Codex tester session. I did not create a real event-cover video job through the app/device, wait for a real Cloudinary callback, capture `event_cover_video_jobs` row data, or verify public browser playback of a processed MP4 URL. That remains the release gate before ORCH-0770 can pass.

## P0/P1 Findings

No current P0/P1 code/deployment blockers found in the focused webhook rework.

The remaining blocker is verification scope, not a proven code failure: real device/browser runtime evidence is still required.

## Deployment / Config Evidence

### Migration Applied

Command:

```bash
/Users/sethogieva/bin/supabase migration list --linked | tail -50
```

Relevant output:

```text
20260515000012 | 20260515000012 | 2026-05-15 00:00:12
```

Remote schema dump evidence confirms `public.event_cover_video_jobs` exists remotely with the expected constraints and SELECT policy:

```text
CREATE TABLE IF NOT EXISTS "public"."event_cover_video_jobs"
CONSTRAINT "event_cover_video_jobs_processed_max_bytes" CHECK ((("processed_bytes" IS NULL) OR ("processed_bytes" <= 26214400)))
CONSTRAINT "event_cover_video_jobs_processed_max_duration" CHECK ((("processed_duration_ms" IS NULL) OR ("processed_duration_ms" <= 15000)))
CONSTRAINT "event_cover_video_jobs_processed_mime_mp4" CHECK ((("processed_mime_type" IS NULL) OR ("processed_mime_type" = 'video/mp4'::"text")))
CREATE POLICY "Event managers can read event cover video jobs" ON "public"."event_cover_video_jobs" FOR SELECT TO "authenticated"
```

### Edge Functions Deployed

Command:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv
```

Relevant output:

```text
event-cover-video-cancel        ACTIVE | VERSION 1 | 2026-05-09 16:54:44
event-cover-video-upload-intent ACTIVE | VERSION 1 | 2026-05-09 16:54:45
event-cover-video-status        ACTIVE | VERSION 1 | 2026-05-09 16:54:45
event-cover-video-apply         ACTIVE | VERSION 1 | 2026-05-09 16:54:46
event-cover-video-webhook       ACTIVE | VERSION 2 | 2026-05-09 17:08:05
```

### Edge Secrets Present

Command:

```bash
/Users/sethogieva/bin/supabase secrets list --project-ref gqnoajqerqhnvulmnyvv
```

Relevant names present:

```text
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_CLOUD_NAME
CLOUDINARY_URL
EVENT_COVER_VIDEO_PROVIDER
```

I did not print or validate secret values.

### Webhook Gateway No Longer Blocks Cloudinary

Unsigned probe:

```bash
curl -sS -i -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/event-cover-video-webhook" \
  -H 'Content-Type: application/json' \
  --data '{"ping":true}'
```

Relevant output:

```text
HTTP/2 403
x-deno-execution-id: f4faa573-3e94-40a0-8db2-fc1ea81e472a
{"error":"forbidden","detail":"missing_signature","message":"Cloudinary signature is missing."}
```

This proves the request reaches function code. It is no longer failing at Supabase gateway `401 UNAUTHORIZED_NO_AUTH_HEADER`.

Invalid signed probe with current timestamp:

```bash
HTTP/2 403
{"error":"forbidden","detail":"invalid_signature","message":"Cloudinary signature is invalid."}
```

Signature without timestamp:

```bash
HTTP/2 403
{"error":"forbidden","detail":"missing_timestamp","message":"Cloudinary timestamp is missing."}
```

## Code Evidence

- `supabase/config.toml:21-25` configures `[functions.event-cover-video-webhook] verify_jwt = false`.
- `supabase/functions/_shared/eventCoverVideo.ts:146-210` implements `verifyCloudinaryNotificationSignature`.
- `supabase/functions/_shared/eventCoverVideo.ts:200` signs `rawBody + timestamp + apiSecret`.
- `supabase/functions/event-cover-video-webhook/index.ts:30-49` gates the old shared-secret fallback behind `EVENT_COVER_VIDEO_ALLOW_SHARED_SECRET_FALLBACK === "true"` and otherwise requires Cloudinary signature headers.
- `supabase/functions/event-cover-video-webhook/index.ts:114-121` validates processed derivatives before marking jobs ready.
- `supabase/functions/event-cover-video-upload-intent/index.ts:126-135` requests Cloudinary eager MP4/H.264/AAC output with duration trim and bitrate clamp.
- `mingla-business/src/services/eventCoverVideoProcessingService.ts:3-8` encodes the product contract: final 25 MB, max 15 seconds, source cap 500 MB, source duration cap 5 minutes.
- `mingla-business/src/components/event/CreatorStep4Cover.tsx:320-326` uses the video picker without `videoMaxDuration`, preserving app-owned trim.
- `mingla-business/src/components/event/CreatorStep4Cover.tsx:360-366` sends over-15-second videos into the trim confirmation path.
- `mingla-business/src/components/event/PublicEventPage.tsx:413-459` avoids known unsafe legacy raw video URLs and places the audio control with safe-area offset.

## Static Gate Outputs

### ORCH-0770 Guard + TypeScript

Command:

```bash
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0770
```

Output:

```text
> mingla-business@1.0.0 test:orch-0770
> node ../.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs && npx tsc --noEmit

[orch-0770] event cover video processing guard passed
```

### Jest Media Tests

Command:

```bash
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" npx jest eventCoverMediaService.test eventCoverMedia.test --runInBand
```

Output:

```text
PASS src/services/__tests__/eventCoverMediaService.test.ts
PASS src/components/ui/__tests__/eventCoverMedia.test.ts

Test Suites: 2 passed, 2 total
Tests:       27 passed, 27 total
Snapshots:   0 total
Time:        1.02 s
Ran all test suites matching /eventCoverMediaService.test|eventCoverMedia.test/i.
```

Note: Watchman emitted an existing recrawl warning before the pass.

### Deno Edge Function Check

Command:

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/event-cover-video-upload-intent/index.ts \
  supabase/functions/event-cover-video-status/index.ts \
  supabase/functions/event-cover-video-webhook/index.ts \
  supabase/functions/event-cover-video-apply/index.ts \
  supabase/functions/event-cover-video-cancel/index.ts
```

Output:

```text
Check supabase/functions/event-cover-video-upload-intent/index.ts
Check supabase/functions/event-cover-video-status/index.ts
Check supabase/functions/event-cover-video-webhook/index.ts
Check supabase/functions/event-cover-video-apply/index.ts
Check supabase/functions/event-cover-video-cancel/index.ts
```

### Deno Signature Tests

Command:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts
```

Output:

```text
running 5 tests from ./supabase/functions/_shared/eventCoverVideo.test.ts
Cloudinary notification signature accepts body + timestamp + secret ... ok (1ms)
Cloudinary notification signature rejects old body-only payload ... ok (0ms)
Cloudinary notification signature rejects missing timestamp ... ok (0ms)
Cloudinary notification signature rejects stale timestamp ... ok (0ms)
Cloudinary notification signature rejects invalid signature ... ok (0ms)

ok | 5 passed | 0 failed (6ms)
```

## Runtime Test Matrix

| Case | Status | Evidence |
|---|---:|---|
| Image/GIF regression control | UNVERIFIED | Requires app runtime picker upload; static code keeps image picker on `mediaTypes: ["images"]` and image/GIF path uses existing storage upload, but I did not perform a fresh picker upload. |
| Short phone video under 15s | UNVERIFIED | Source caps and Cloudinary intent path are present in code; no real phone video job was created in this tester session. |
| Long phone video trim | UNVERIFIED | Trim UI path exists in code; no real long-video selection/trim/process was executed. |
| Published event replacement safety | UNVERIFIED | Code suggests `published_manual` waits for `Save changes`, but no live event replacement was tested. |
| Browser playback and audio control | UNVERIFIED | Public page avoids unsafe legacy raw videos and exposes audio control; no processed public event URL was opened and played in browser. |
| Provider-not-configured honesty | UNVERIFIED | Copy and edge response exist; I did not remove provider secrets in a safe non-production runtime. |

## Data Proof

No successful processed runtime job was created during this tester pass, so the required job-row proof is still missing:

- `event_cover_video_jobs.id`
- `status`
- `apply_mode`
- `source_mime_type`
- `source_bytes`
- `source_duration_ms`
- `trim_start_ms`
- `trim_end_ms`
- `processed_url`
- `processed_mime_type`
- `processed_bytes`
- `processed_duration_ms`

This is the main reason the verdict is `BLOCKED / UNVERIFIED FOR RUNTIME` rather than `PASS`.

## Secret Hygiene

`git status --short -- Mingla_Artifacts/cloudinary_details.md .gitignore` does not show `Mingla_Artifacts/cloudinary_details.md`; `.gitignore` is modified to ignore it. The active editor tab may still reference the old file path, but git visibility is now protected.

Security recommendation remains: rotate the Cloudinary API secret because credential material existed in local/chat context before this rework.

## Recommendation

Do not close ORCH-0770 yet.

Next step is operator-assisted runtime QA:

1. Use `mingla-business` on the signed-in device/simulator.
2. Create or edit an event with an image/GIF cover and verify no hue fallback.
3. Upload a real phone video under 15 seconds and capture the job row after processing.
4. Upload a long phone video, trim to 15 seconds or less, and capture the job row after processing.
5. Open the public event URL in browser and prove the cover uses the processed MP4 URL, plays/loops, is not black, and audio mute/unmute is reachable.
6. Retest published-event replacement and `Save changes` behavior.

If those pass, return to `$orchestrator` for close review. If any fail, return to `$orchestrator` with the runtime logs/job row/public URL so rework can be scoped to the proven failing layer.
