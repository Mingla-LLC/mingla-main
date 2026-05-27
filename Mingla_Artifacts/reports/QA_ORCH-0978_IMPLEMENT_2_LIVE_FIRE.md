# QA ORCH-0978 IMPLEMENT-2 LIVE-FIRE

Verdict: **FAIL**

Date: 2026-05-27
Tester side: Codex `tester-mingla`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
Test commit: `f1be7519d`

## Executive Finding

ORCH-0978 cannot close. The iOS simulator P0 success path reached the live upload pipeline with a real session JWT, live `event-cover-video-upload-intent` v95 returned 200, and Cloudinary source upload completed, but the processed preview never became ready. The app timed out into "Upload failed - try again"; the backing job remained `source_uploaded` with `processed_url = null`, and Supabase edge logs showed `event-cover-video-webhook` returning HTTP 400 for the same live-fire window.

This blocks PASS and made physical-iPhone verification intentionally not requested: the canonical physical pass cannot rescue a simulator P0 pipeline failure.

## Environment

| Item | Result |
| --- | --- |
| Worktree | `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` |
| Branch | `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` |
| iOS simulator | iPhone 17, UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752` |
| Metro | `RCT_METRO_PORT=8090 npx expo start --port 8090 --dev-client` |
| Business app state | Signed in, current brand restored to `22a18413-bfbf-4087-9ba7-45f70deba0f3` |
| Test event | `Vibes and Stuff`, event `09b4ece6-eabc-4734-8ce3-3a25d90417e4` |
| Edge deployment | `event-cover-video-upload-intent` v95, `verify_jwt: true` confirmed before live-fire |
| DB migration | Already applied; orchestrator-provided constraint probe showed both video constraints `<= 29000` |

## Test Results Matrix

| Test | Result | Evidence |
| --- | --- | --- |
| T-1 success path | **FAIL** | Navigated to Event -> Edit details -> Cover -> Upload video. Selected top-left rainbow `0:12` video and tapped Choose. App showed "Almost ready..." then timed out to "Your video is still processing. You can check again in a moment." plus "Upload failed - try again." Screenshots: `Mingla_Artifacts/reports/qa-orch-0978-runtime/live-fire-2026-05-27/orch-0978-rainbow-video-selected.png`, `.../orch-0978-after-rainbow-choose.png`, `.../after-rainbow-upload-wait-2m.png`. Live DB row `dde19eac-9810-4e0d-b8f6-63fe235fc5af` remained `status=source_uploaded`, `trim_end_ms=12000`, `processed_url=null`, `processed_duration_ms=null`, `failure_code=null`. Edge logs in the same window showed upload-intent 200, source-uploaded 200, status polling 200s, and webhook 400. Cloudinary eager async callbacks are expected to hit `eager_notification_url` per Cloudinary upload docs: https://cloudinary.com/documentation/upload_images#eager_transformations and https://cloudinary.com/documentation/upload_images#notification_url. |
| T-2 trim-cap boundary | **BLOCKED / PARTIAL** | A longer `1:00` video opened the native iOS trim screen and showed Apple's native "Video Too Long to Send" message before an app-level boundary assertion could be completed. Screenshot: `.../after-icloud-download-wait.png`. The required app-level "trim to ~30s then verify <=29.25s behavior" was not completed because T-1 exposed a P0 pipeline failure first. |
| T-3 rollback path | **NOT RUN** | Not executed as a sign-out/stale-session UI path because T-1 already failed the P0 upload pipeline. Supporting auth diagnostic control: `Authorization: Bearer <anon JWT>` returned HTTP 401 with `x-orch-0978-auth-failure-reason: token_invalid_signature`; evidence `.../t5-auth-diag-anon-control/summary.txt`. A malformed non-JWT is rejected by the Supabase gateway before function diagnostics, returning `UNAUTHORIZED_INVALID_JWT_FORMAT`; evidence `.../t5-auth-diag-control/summary.txt`. |
| T-4 Save gate non-regression | **PARTIAL PASS / BLOCKED** | Verified the no-patch baseline: Save remained disabled before a cover change and after the failed video pipeline. `git diff -- mingla-business/src/components/event/EditPublishedScreen.tsx` was empty, so the Save gate code was not touched by tester work. The positive "valid server-editable cover patch enables Save" half could not be proven because T-1 never produced a processed cover URL. |
| T-5 live edge 29251 validation | **PASS** | Real session JWT curl to live v95 with `sourceDurationMs=29251` returned HTTP 422 and body `{"error":"duration_over_cap","detail":{"sourceDurationMs":29251,"ceilingMs":29250}}`. The response had no `x-orch-0978-auth-failure-reason` header, proving successful auth by absence of the diagnostic header on this path. Evidence: `.../t5-live-edge-29251/summary.txt`, `headers.raw`, `body.json`. |

## Live-Fire Trace

1. Simulator opened the signed-in Business app on `Leggo This`.
2. Maestro opened `Vibes and Stuff` from Events.
3. Maestro opened the event menu, tapped `Edit details`, scrolled to `Cover`, and expanded it.
4. Maestro tapped `Upload video`; the native picker opened on Videos.
5. Initial tap hit the adjacent `1:00` asset and produced Apple's native too-long message. Cancelled back to the picker.
6. Tapped the top-left rainbow `0:12` asset, tapped `Choose`, and returned to the app.
7. App showed processing UI and disabled cover controls.
8. After over two minutes, app showed failure UI while the live DB job was still `source_uploaded`.

## Backend Evidence

Latest live-fire job:

```text
id=dde19eac-9810-4e0d-b8f6-63fe235fc5af
event_id=09b4ece6-eabc-4734-8ce3-3a25d90417e4
brand_id=22a18413-bfbf-4087-9ba7-45f70deba0f3
status=source_uploaded
source_public_id=event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/dde19eac-9810-4e0d-b8f6-63fe235fc5af
trim_start_ms=0
trim_end_ms=12000
processed_url=null
processed_duration_ms=null
failure_code=null
failure_message=null
created_at=2026-05-27 16:10:33.082496+00
updated_at=2026-05-27 16:10:34.716281+00
```

Supabase edge log sequence in the same window:

```text
event-cover-video-upload-intent v95 POST 200 at 2026-05-27 16:10:33Z
event-cover-video-source-uploaded v81 POST 200 at 2026-05-27 16:10:34Z
event-cover-video-status v93 repeated POST 200 from 16:10 onward
event-cover-video-webhook v120 POST 400 at 2026-05-27 16:10:41Z
```

The failing area is therefore downstream of upload intent auth and source upload, and at or before webhook processing of the eager transformation callback. Supabase Edge Functions request logs document HTTP status at the function boundary: https://supabase.com/docs/guides/functions/logging.

## Adversarial Regression Test

Path: `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`

New test: `fetches a fresh session token for each upload-intent retry`

Angle: stale-token / retry attack. This is different from the implementor's two tests because it verifies the client asks Supabase auth for a fresh session token on each retry and passes the current token in the `Authorization` header each time, instead of stale-replaying an old token or omitting the header.

Commit:

```text
f1be7519d ORCH-0978 QA adversarial regression: fresh JWT per upload-intent retry (fails-on-revert verified at 18d4fa327)
```

Fails-on-revert sequence:

| Phase | Command | Result |
| --- | --- | --- |
| PASS on fixed code | `CI=1 npx jest src/services/__tests__/eventCoverVideoProcessingService.test.ts --runInBand -t "fresh session token"` | PASS |
| FAIL with fix removed locally | Temporarily removed `headers: { Authorization: \`Bearer ${accessToken}\` }` from the upload-intent invoke path, then reran the same command | FAIL; assertion expected `headers: { Authorization: "Bearer first-session-jwt" }` but invoke received no headers |
| PASS after restore | Restored product code and reran the same command | PASS |

Full targeted Jest:

```text
CI=1 npx jest src/services/__tests__/eventCoverVideoProcessingService.test.ts src/hooks/__tests__/useEventCoverVideoUpload.test.ts --runInBand
PASS: 2 suites, 15 tests
```

## Automated Gates

| Gate | Result |
| --- | --- |
| `deno check supabase/functions/event-cover-video-upload-intent/index.ts supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` | PASS |
| `deno test --allow-env supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` | PASS; 29250 accepted, 29251 rejected |
| `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS; C1-C4 all green |
| `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS |
| `git diff --check` | PASS |
| `git diff -- mingla-business/src/components/event/EditPublishedScreen.tsx` | PASS; no diff |

## Surface Coverage

| Surface | Result |
| --- | --- |
| iOS Simulator | **FAIL**; P0 T-1 live-fire failed after upload/source path |
| Physical iPhone | **NOT RUN**; intentionally not requested because simulator P0 failure blocks PASS |
| Android | N/A; out of scope per SPEC §C because authoring source is shared |
| Buyer web | N/A; buyer web consumes processed URLs and does not author cover videos |

## Constitutional Check

| Rule | Result |
| --- | --- |
| Preserve user work | PASS; no unrelated dirty files reverted |
| Tester writes tests only | PASS; product-code edit was only temporary for fails-on-revert proof and restored before commit |
| No product code modifications retained | PASS |
| No SPEC modifications | PASS |
| No Save-gate widening | PASS |
| No `supabase db push` | PASS |
| No edge function redeploy | PASS |
| No PR open | PASS |
| Maestro default sim driver | PASS |
| No `osascript` | PASS |
| No CoreDevice / xctrace physical control | PASS |
| Physical iPhone requires operator | N/A because simulator P0 failed before operator step |
| Regression test included | PASS; `f1be7519d` |
| Evidence-backed verdict | PASS |

## Discoveries for Orchestrator

1. P0 launch blocker: the live source-upload path completes, but webhook processing returns HTTP 400 and the job remains `source_uploaded`, leaving the app in a user-visible failure state.
2. The app's timeout message is understandable but not enough for close: the backend did not transition the job to `ready` or `failed`, so retries may supersede stuck jobs without exposing the real webhook fault.
3. T-5 live edge boundary is good: v95 rejects 29251 with the expected body and successful-auth diagnostic absence.
4. The diagnostic header is present for a JWT-shaped anon-token auth failure handled inside the function, but malformed non-JWTs are rejected by Supabase before function code and therefore do not show the ORCH-0978 diagnostic header.
5. Pre-existing dirty/untracked files remain outside tester scope: `app-mobile/tsconfig.json`, `mingla-business/tsconfig.json`, existing untracked implementation/review reports, `app-mobile/node_modules`, `mingla-admin/node_modules`, and `app-mobile/package 2.json`.

## Operator-Actionable Items

1. Route back to implementor/forensics to investigate `event-cover-video-webhook` HTTP 400 for job `dde19eac-9810-4e0d-b8f6-63fe235fc5af`.
2. After webhook fix, rerun T-1 through T-5 on the simulator and then pause for Seth's physical-iPhone T-1/T-2/T-3 run.
3. Keep `[ORCH-0978-TRIM]` as intentional observability; do not reap it as a diagnostic marker.

## Confidence

Confidence: **High for FAIL**.

Reason: the failing simulator result is live-fire evidence across the actual picker, real session JWT, live edge function v95, Cloudinary source upload, live Supabase job state, and app UI. Confidence is not "proven pass" because physical iPhone testing was not executed and cannot be required after a simulator P0 failure.
