# IMPLEMENTATION REWORK ORCH-0770 — Cloudinary Webhook + Secret Hardening

## Verdict

PASS for focused rework.

The `event-cover-video-webhook` endpoint is no longer blocked by Supabase gateway JWT verification, Cloudinary notification signatures now include `X-Cld-Timestamp`, focused Deno coverage was added, the ORCH-0770 strict guard was hardened, and the plaintext Cloudinary credential artifact was removed from the workspace and ignored.

## Files Changed

- `.gitignore`
- `.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs`
- `supabase/config.toml`
- `supabase/functions/_shared/eventCoverVideo.ts`
- `supabase/functions/_shared/eventCoverVideo.test.ts`
- `supabase/functions/event-cover-video-webhook/index.ts`

## Signature Algorithm Implemented

Cloudinary webhook verification now requires:

- `x-cld-signature`
- `x-cld-timestamp`
- `CLOUDINARY_API_SECRET`

The expected signature is:

```text
sha1(exact_raw_request_body + x-cld-timestamp + CLOUDINARY_API_SECRET)
```

The function rejects missing signatures, missing timestamps, invalid timestamps, stale/future timestamps outside the tolerance window, missing API secret, and invalid signatures. It does not log secrets or full signed payload material.

## Webhook Gateway Auth

`supabase/config.toml` now includes:

```toml
# ORCH-0770: Cloudinary is a third-party webhook sender and cannot provide
# Supabase user JWTs. The gateway is public; the function authenticates
# requests with Cloudinary's signed notification headers.
[functions.event-cover-video-webhook]
verify_jwt = false
```

This is intentional: the Supabase gateway must let Cloudinary reach the function, and the function itself authenticates the callback with Cloudinary's signed headers.

## Shared Secret Fallback

`EVENT_COVER_VIDEO_WEBHOOK_SECRET` fallback remains, but it is now gated by:

```text
EVENT_COVER_VIDEO_ALLOW_SHARED_SECRET_FALLBACK=true
```

Reason: this keeps a non-Cloudinary operations/test path available without allowing production Cloudinary verification to be bypassed accidentally. If the allow flag is not explicitly set, the function uses Cloudinary signature verification only.

## Secret Hygiene

Actions taken:

- Added `.gitignore` rule for `Mingla_Artifacts/cloudinary_details.md`.
- Removed the local plaintext `Mingla_Artifacts/cloudinary_details.md` file from the workspace.
- Did not print or copy the credential value into this report.

Recommendation: rotate the Cloudinary API secret after this rework because credential material was previously pasted into a local artifact and chat context.

## Verification

### Deno Check

Command:

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-webhook/index.ts
```

Output:

```text
PASS: command completed with no output.
```

### Deno Signature Tests

First run without env permission confirmed the shared helper imports env-backed constants:

```text
NotCapable: Requires env access to "EVENT_COVER_FINAL_MAX_BYTES", run again with the --allow-env flag
```

Final command:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts
```

Output:

```text
5 passed, 0 failed
```

Coverage proves:

- documented Cloudinary body + timestamp + secret passes;
- old body + secret signature fails;
- missing timestamp fails;
- stale timestamp fails;
- invalid signature fails.

### ORCH-0770 Business Guard

Command:

```bash
cd mingla-business && npm run test:orch-0770
```

Output:

```text
> mingla-business@1.0.0 test:orch-0770
> node ../.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs && npx tsc --noEmit

[orch-0770] event cover video processing guard passed
```

### Deploy

Command:

```bash
/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv
```

Output:

```text
Bundling Function: event-cover-video-webhook
Deploying Function: event-cover-video-webhook (script size: 81.48kB)
Deployed Functions on project gqnoajqerqhnvulmnyvv: event-cover-video-webhook
You can inspect your deployment in the Dashboard: https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/functions
```

Function list readback:

```text
event-cover-video-webhook | ACTIVE | VERSION 2 | 2026-05-09 17:08:05
```

### Remote Unsigned Webhook Smoke

Command:

```bash
curl -sS -i -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/event-cover-video-webhook" \
  -H 'Content-Type: application/json' \
  --data '{"ping":true}'
```

Result:

```text
HTTP/2 403
access-control-allow-headers: authorization, x-client-info, apikey, content-type, x-cld-signature, x-cld-timestamp
x-deno-execution-id: ...
```

Body:

```json
{"error":"forbidden","detail":"missing_signature","message":"Cloudinary signature is missing."}
```

This is the expected post-fix behavior. The request reaches function code and is rejected by Mingla's Cloudinary signature verifier. It is no longer blocked by Supabase gateway `401 UNAUTHORIZED_NO_AUTH_HEADER`.

## Next Step

Return to `$tester` with:

`Mingla_Artifacts/prompts/TESTER_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`

