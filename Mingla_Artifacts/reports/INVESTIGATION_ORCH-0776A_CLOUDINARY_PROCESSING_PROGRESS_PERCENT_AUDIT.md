# Investigation Report: Cloudinary Processing Progress / Percentage Audit (ORCH-0776A)

> Date: 2026-05-10  
> Source: Operator request after ORCH-0776 video-cover processing stall investigation  
> Confidence: High for documented Cloudinary capabilities and current repo code; Medium for Expo upload-task runtime behavior until tested on device against Cloudinary multipart upload.  
> Status: Root cause proven for missing real upload progress in current code; Cloudinary processing percentage unavailable in official docs reviewed.

## 1. Layman Summary

Mingla can show a real percentage while the phone is sending the video file to Cloudinary. That percentage comes from the phone upload transport counting bytes sent, not from Cloudinary.

Mingla cannot honestly show a real percentage for Cloudinary's compression/transcoding work based on the official Cloudinary docs reviewed. Cloudinary tells us useful states: upload accepted, eager processing finished, eager processing failed, and sometimes "not ready yet" when a delivery URL is requested while a derived asset is still being generated. It does not expose "37% transcoded" or similar progress for the async eager video job.

So the right user experience is:

1. Show real upload percentage during phone-to-Cloudinary transfer.
2. After upload reaches 100%, switch to an honest processing state: "Compressing browser-safe video..." with an indeterminate or staged bar, elapsed time, and a clear "we'll keep checking" message.
3. Finish at 100% only when Mingla receives Cloudinary's eager webhook or the status endpoint proves the processed MP4 is ready.

Do not invent a percentage during Cloudinary processing.

## 2. Scope

- **Feature / issue:** Event-cover video upload progress and Cloudinary processing progress.
- **Actor:** Organizer uploading a custom video cover from `mingla-business`.
- **Environment:** Expo/React Native business app, Supabase Edge Functions, Cloudinary upload/eager transformation flow.
- **Success definition:** Determine exactly what progress can be shown honestly and what ORCH-0776 should require.
- **Assumptions:** Mingla keeps the current direct-to-Cloudinary signed upload pattern.
- **Out of scope:** Giphy/Pexels, image/GIF upload, full implementation, Cloudinary billing/plan changes.

## 3. Intended Journey

`Step 4 cover -> choose video -> native picker returns trimmed video -> app requests upload intent -> app uploads source to Cloudinary -> Cloudinary async eager transcodes/compresses -> Cloudinary webhook updates Supabase job -> app applies/uses processed MP4 -> user sees saved cover`

Expected failure behavior:

- During source upload, users should see actual upload progress when bytes are measurable.
- During provider processing, users should see truthful waiting/progress copy, not a fake exact percentage.
- If webhook/status fails, the job should show actionable failed/still-processing state rather than a silent spinner.

## 4. Historical Context

- Checked `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_PROGRESS_STALL.md`.
- Checked `Mingla_Artifacts/specs/SPEC_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_STATUS_AND_PROGRESS.md`.
- Checked ORCH-0776A prompt in `Mingla_Artifacts/prompts/FORENSICS_ORCH-0776A_CLOUDINARY_PROCESSING_PROGRESS_PERCENT_AUDIT.md`.
- Current ORCH-0776 already says exact source upload progress may be used if technically available, while provider processing should be staged/indeterminate. This investigation confirms that direction and narrows the wording.

## 5. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 | Cloudinary Eager and Incoming Transformations docs | Provider docs | Verify async eager behavior and webhook semantics. |
| 2 | Cloudinary Notifications docs | Provider docs | Verify completion/failure notification capability. |
| 3 | Cloudinary Upload / chunked upload docs | Provider docs | Verify upload/chunk progress or state signals. |
| 4 | Cloudinary Admin API docs | Provider docs | Verify resource/derived metadata and API rate limits. |
| 5 | Cloudinary Transformation URL reference | Provider docs | Verify `423` pending behavior. |
| 6 | `mingla-business/src/services/eventCoverVideoProcessingService.ts` | Business app code | Verify current source upload transport and polling behavior. |
| 7 | `supabase/functions/event-cover-video-upload-intent/index.ts` | Edge/provider setup | Verify Cloudinary upload parameters. |
| 8 | `supabase/functions/event-cover-video-status/index.ts` | Edge status | Verify current status payload. |
| 9 | `supabase/functions/event-cover-video-webhook/index.ts` | Edge webhook | Verify terminal ready/failed handling. |
| 10 | `mingla-business/node_modules/expo-file-system/src/legacy/*` | Local dependency | Verify whether installed Expo FileSystem has upload progress primitives. |

## 6. Evidence Table

| Question | Evidence | Finding |
|---|---|---|
| Can Cloudinary process eager transformations async? | Cloudinary says `eager_async` generates eager transformations in the background and `eager_notification_url` notifies when generation is completed or failed: [Eager asynchronous transformations](https://cloudinary.com/documentation/eager_and_incoming_transformations). | Yes, async processing and completion/failure webhook are supported. |
| Does webhook include completion/failure, not percent? | Cloudinary Notifications docs say eager notification is sent after eager transformations finish, and failed transformations include failed status/reason: [Notifications](https://cloudinary.com/documentation/notifications). | Completion/failure state exists. No processing percentage is documented. |
| Can source upload use direct mobile upload? | Cloudinary React Native docs support direct mobile upload and signed upload via backend-generated signature: [React Native upload](https://cloudinary.com/documentation/react_native_image_and_video_upload). | Yes. Mingla's signed direct-upload pattern is compatible with Cloudinary's model. |
| Can upload progress be inferred from Cloudinary chunked responses? | Cloudinary chunked upload returns intermediate `done:false` responses and final `done:true`: [Chunked asset upload](https://cloudinary.com/documentation/upload_images). | Chunk-level upload state exists for chunked upload, but it is source upload progress, not processing progress. |
| Can derived asset readiness be probed by delivery URL? | Cloudinary Transformation Reference says a derived version may return `423` until ready: [Transformation URL reference](https://cloudinary.com/documentation/transformation_reference). | Pending/ready can be inferred in some delivery cases. It is still not a percent. |
| Can Admin API list derived resources? | Admin API says single-resource details include derived assets and derived cursors; transformation details can list derived assets: [Admin API](https://cloudinary.com/documentation/admin_api). | Admin API can confirm derived metadata after generation. It does not expose transcode percent. |
| Is Admin API safe to poll heavily? | Admin API is rate limited; free plan includes 500 hourly requests and paid plans begin at 2000 hourly: [Admin API usage limits](https://cloudinary.com/documentation/admin_api). | Poll sparingly server-side if used at all. Do not make it the primary progress engine. |
| Does current Mingla app have source upload byte progress? | `uploadEventCoverVideoSource()` builds `FormData` and calls plain `fetch(input.upload.url, { body: formData, method: "POST" })` at `mingla-business/src/services/eventCoverVideoProcessingService.ts:272-291`. | No. Current code cannot show real upload percentage. |
| Does current Mingla status endpoint return progress fields? | `event-cover-video-status` returns raw job status and terminal data only at `supabase/functions/event-cover-video-status/index.ts:46-58`. | No progress metadata today. |
| Does installed Expo FileSystem have upload progress callbacks? | Local package exposes `UploadProgressData.totalBytesSent/ExpectedToSend` and `createUploadTask(..., callback)` at `mingla-business/node_modules/expo-file-system/src/legacy/FileSystem.types.ts:163-171` and `FileSystem.ts:335-340`. | A no-new-dependency upload-progress path likely exists, but must be tested with Cloudinary multipart form upload on iOS/Android. |

## 7. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs | Cloudinary supports async eager processing and completion/failure webhooks; no true processing percent found. | Official Cloudinary docs linked above. | Matches current staged-processing assumption. |
| Schema/RLS | Existing job statuses include `source_uploading`, `source_uploaded`, `processing_queued`, `processing`, `ready`, `failed`, `cancelled`, `applied`. | `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql` from prior ORCH-0776 evidence. | Schema can represent stages, not provider percent. |
| Code | Current business app source upload uses plain `fetch`; status polling waits for ready/applied. | `eventCoverVideoProcessingService.ts:272-306`, `:308-335`. | Does not support upload percent today. |
| Runtime/tests | Existing ORCH-0776 reports user seeing "still processing" after spinner; no automated proof of upload percent path. | Prior report plus current code. | Runtime symptom matches missing intermediate/status progress. |
| Data/cache | Supabase job row is the durable state owner. Cloudinary webhook writes terminal processed data. | `event-cover-video-webhook/index.ts:83-168`. | Correct owner, but not enough progress detail today. |

**Contradictions:**

- The desired UX asks for a percentage across the whole process, but Cloudinary docs only prove exact percentage for upload if Mingla measures bytes client-side. Provider transcoding percentage is not available from the documented Cloudinary eager/webhook/Admin/delivery mechanisms.

## 8. Findings

### Finding 1: Real Source Upload Percentage Is Achievable, But Current Mingla Code Cannot Produce It

- **Severity:** Medium user-experience gap.
- **Type:** UX gap / production-hardening gap.
- **Confidence:** Proven for current code; probable for Expo upload-task solution until runtime tested.
- **Broken journey step:** Phone-to-Cloudinary source upload.
- **Evidence:** `mingla-business/src/services/eventCoverVideoProcessingService.ts:272-291` uses plain `fetch(FormData)`. Expo FileSystem exposes upload progress callback primitives in local package files.
- **Current behavior:** UI only knows "uploading/processing" as broad states.
- **Expected behavior:** App should show real bytes-sent progress while uploading the source file.
- **Causal chain:** Plain fetch upload -> no progress callback -> UI cannot receive bytes sent -> spinner/static copy only.
- **User impact:** Long video uploads feel frozen, especially on slow connections.
- **Fix direction:** Replace source upload transport with a progress-capable path, preferably existing `expo-file-system/legacy` `createUploadTask` multipart upload if compatible with Cloudinary signed fields; otherwise use React Native `XMLHttpRequest.upload.onprogress` with the same signed form payload. No new dependency is proven necessary yet.
- **Missing test or guardrail:** Unit test that upload progress callback receives increasing values and UI renders upload percentage during source upload; manual device gate with a throttled network.

### Finding 2: Real Cloudinary Processing Percentage Is Not Exposed By Official Docs Reviewed

- **Severity:** High for product expectation; Medium implementation risk if fake percent is added.
- **Type:** UX gap / invariant guardrail.
- **Confidence:** High.
- **Broken journey step:** Cloudinary compression/transcoding after upload is accepted.
- **Evidence:** Cloudinary documents `eager_async`, `eager_notification_url`, Admin API derived metadata, chunked upload responses, and `423` pending delivery URL behavior, but none of the reviewed official docs expose a numeric processing percentage for eager video transcoding.
- **Current behavior:** Mingla waits for webhook/status terminal states; ORCH-0776 proposes staged progress.
- **Expected behavior:** Show honest provider state, not fabricated percentage.
- **Causal chain:** Cloudinary owns transcode worker internals -> public docs expose completion/failure and limited pending signals -> Mingla cannot calculate true provider percent -> exact processing percentage would be fiction.
- **User impact:** If Mingla shows fake percentage, users may distrust the product when it stalls at arbitrary numbers.
- **Fix direction:** Keep provider processing as `progressKind = indeterminate` or staged label. Use elapsed time and status copy. Only mark final 100% when webhook/status confirms ready/applied.
- **Missing test or guardrail:** Test that provider-processing statuses render no exact percentage unless the status payload explicitly marks it as source-upload progress.

### Finding 3: Admin API / Delivery URL Polling Can Add State Confidence, Not Percentage

- **Severity:** Medium production-hardening opportunity.
- **Type:** production-hardening gap.
- **Confidence:** High.
- **Broken journey step:** Diagnosing "processing forever" after source upload.
- **Evidence:** Admin API can return resource/derived details and is rate limited. Delivery URLs may return `423` while derived generation is pending. Webhook retries are documented.
- **Current behavior:** Status endpoint returns only job row state and terminal provider payload fields.
- **Expected behavior:** Mingla can optionally use server-side provider probing to distinguish "still pending" from "webhook missed" or "derived exists but job not applied."
- **Causal chain:** Webhook-only terminal transition -> missed/late webhook leaves user uncertain -> provider polling can detect ready/pending in some cases -> still no percent.
- **User impact:** Better error recovery and fewer "try again later" dead ends.
- **Fix direction:** If ORCH-0776 expands provider polling, do it server-side only, rate-limited, and map to states like `processing`, `ready`, `failed`, `provider_pending`. Do not expose Cloudinary API secret to clients.
- **Missing test or guardrail:** Edge function tests for `423` pending, Admin-derived-ready, webhook-missed recovery, and rate-limit safe polling.

## 9. Root Cause Proof

### RC-1: Current Upload Transport Cannot Emit Upload Percent

- **File + line:** `mingla-business/src/services/eventCoverVideoProcessingService.ts:272-291`
- **Exact code/schema:** `uploadEventCoverVideoSource()` creates `FormData` then calls `fetch(input.upload.url, { body: formData, method: "POST" })`.
- **What it does:** Sends the whole multipart upload without providing any upload progress callback.
- **What it should do:** Use a progress-capable upload transport and pass upload progress to state/UI.
- **Causal chain:** No callback in service API -> component cannot subscribe to progress -> user only sees spinner/static phase copy.
- **Verification step:** Instrument a test/dummy upload service callback. Current function signature cannot emit progress. After rework, verify on device that progress moves from 0 to 100 before provider processing begins.

### RC-2: Provider Processing Percent Is Not A Known Cloudinary Signal

- **File + line:** `supabase/functions/event-cover-video-upload-intent/index.ts:238-299`, `supabase/functions/event-cover-video-webhook/index.ts:83-168`
- **Exact code/schema:** Upload intent requests async eager processing through Cloudinary; webhook only persists failed/ready/applied outcomes.
- **What it does:** Delegates transcode/compression to Cloudinary and waits for Cloudinary notification.
- **What it should do:** Continue treating Cloudinary processing as a provider-controlled state machine, unless Cloudinary exposes a documented percentage.
- **Causal chain:** Async eager transformation -> provider performs work internally -> Cloudinary public docs expose completion/failure/pending signals, not percent -> Mingla cannot calculate true processing percentage.
- **Verification step:** Attempt provider API review or support confirmation for an eager job progress endpoint. If no percent field exists, keep provider processing indeterminate/staged.

## 10. What Current Mingla Code Can Support Today

Today, without code changes:

- It can show upload intent started/succeeded.
- It can show source upload started/succeeded only as a broad phase.
- It can poll Supabase job status.
- It can show terminal `ready`, `applied`, `failed`, or `cancelled`.
- It cannot show real source upload percentage because `fetch(FormData)` does not feed progress to the service/component.
- It cannot show real Cloudinary transcode percentage because the status endpoint has no provider percentage and Cloudinary docs do not expose one.

With a small upload transport rework:

- It can show real phone-to-Cloudinary upload percent.
- It can then transition to honest provider-processing state.

With a server-side provider polling enhancement:

- It can improve provider state confidence: pending vs ready vs failed/missed webhook.
- It still cannot show true Cloudinary processing percent unless Cloudinary provides a documented percentage API.

## 11. Recommended ORCH-0776 Amendment

Amend ORCH-0776. Keep the staged provider-processing model, but add a stronger upload-progress requirement and a stricter no-fake-percent guardrail.

### Exact Spec Language To Add

Add under Mobile Service Contract:

```markdown
Source upload progress must be determinate when the selected upload transport exposes byte counts. `uploadEventCoverVideoSource` must accept an optional progress callback and emit `{ phase: "source_upload", bytesSent, bytesTotal, percent }` when `bytesTotal > 0`. The UI may display numeric percent only for this source-upload phase.

Cloudinary eager processing must not display a numeric provider-processing percentage unless a documented Cloudinary API response includes a true percentage for the current job. In the current Cloudinary contract, eager processing is represented as state-based progress only: `source_uploaded`, `processing_queued`, `processing`, `ready`, `failed`, `applied`.

Provider processing UI must use `progressKind = "indeterminate"` or a clearly labeled staged bar with copy such as `Compressing browser-safe video...`. If a staged bar is used, the UI must not label the staged value as an exact percentage. `100%` is allowed only after `ready` or `applied`.

Optional provider polling may query delivery/Admin state server-side to detect `pending`, `ready`, or `failed`, but must not expose Cloudinary secrets to the client and must respect Admin API rate limits.
```

Add under Edge Status Contract:

```markdown
`event-cover-video-status` may return:

- `progressKind: "determinate"` with `progressPercent` only for source upload progress captured by the client or for terminal complete states.
- `progressKind: "indeterminate"` with `progressPercent: null` during provider processing unless a documented provider percentage exists.
- `providerState: "pending" | "ready" | "failed" | "unknown" | null` when provider probing is implemented.

The status function must never infer an exact Cloudinary processing percentage from elapsed time.
```

Add under UX Contract:

```markdown
The visible flow must read as:

1. `Uploading video... 0-100%` using real bytes sent when available.
2. `Upload complete. Compressing browser-safe video...` with indeterminate/staged progress and elapsed time.
3. `Video ready. Saving cover...` at ready/apply.

Do not show `Compressing video 72%` unless Cloudinary exposes a true processing percent for that exact job.
```

## 12. Tests Required

Automated tests to add/update in the same scoped commit as the implementation:

1. `eventCoverVideoProcessingService` test proving the source upload function accepts a progress callback and emits determinate source-upload progress when the upload transport reports bytes.
2. Component test for `CreatorStep4Cover` proving:
   - source upload phase renders numeric percent when provided;
   - provider-processing phase renders indeterminate/staged copy with no exact provider percent;
   - ready/applied moves to complete/save.
3. Edge status test proving `event-cover-video-status` maps source-upload/progress and provider-processing states without fake percentage.
4. Provider polling tests if added:
   - delivery `423` maps to pending/processing;
   - derived ready maps to ready;
   - provider failure maps to failed;
   - Admin API errors/rate-limit responses do not break the client journey.

Manual runtime gate:

1. On iOS device/simulator, upload a 10-15 second video with network throttled.
2. Confirm the upload phase shows increasing percent before processing begins.
3. Confirm after upload reaches 100%, UI switches to "Compressing browser-safe video..." without an exact percentage.
4. Confirm final video applies only after webhook/status confirms ready/applied.
5. Confirm failed provider processing shows a clear retry/cancel path.

## 13. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|
| No upload progress callback in current source upload path | `mingla-business/src/services/eventCoverVideoProcessingService.ts` | Plain `fetch(FormData)` at lines 288-291 | Medium | UX gap |
| Status endpoint returns no progress semantics | `supabase/functions/event-cover-video-status/index.ts` | Returns raw job fields at lines 46-58 | Medium | production-hardening gap |
| Admin API polling must remain server-side | Cloudinary Admin API docs | Admin API requires API key/secret and is rate limited | High if misused | security / ops guardrail |

## 14. Blast Radius

- **Other flows affected:** Event-cover video upload in draft and live-event edit flows.
- **Mobile/business/admin/public parity:** Business upload UX affected; public playback unaffected by progress UI but affected by whether processed MP4 is actually ready before applying.
- **Query keys/cache/state involved:** Video job status polling, draft/local cover state, published event cover state.
- **RLS/auth/permission implications:** Upload progress is client-local; provider polling/status must continue checking event manager permissions.
- **Integrations involved:** Cloudinary Upload API, eager async webhook, optional Admin API/delivery URL probing.
- **Deploy/migration implications:** Upload-progress-only change can be client/service. Provider-state additions require Edge function deploy and possibly schema/status payload changes if new fields are persisted.
- **Recurring pattern:** Do not turn missing provider telemetry into fake UX certainty.

## 15. Production Readiness Verdict

- **Ready / not ready:** Current progress UX is not production-ready for larger video uploads.
- **Launch blockers:** No real source upload percentage; provider processing still appears opaque.
- **Residual risks:** Expo FileSystem upload-task multipart compatibility with Cloudinary signed form must be proven on iOS and Android before locking that implementation path.
- **Telemetry/monitoring gaps:** Need upload progress logs/events and status transition timing (`upload_started`, `upload_100`, `processing_started`, `webhook_ready`, `webhook_failed`, `apply_done`).
- **Missing tests:** No regression test protects the upload-progress contract or no-fake-provider-percent rule.
- **Fastest next verification:** Prototype source upload with existing Expo FileSystem `createUploadTask` multipart mode against Cloudinary signed fields. If Cloudinary accepts it and progress callbacks fire, implement without adding a dependency.

## 16. Discoveries For Orchestrator

- None outside ORCH-0776A.

## 17. Recommended Next Step

Send ORCH-0776 back to `$implementor` with the amendment above. The implementation should first add real source upload progress using an existing dependency if possible, then keep Cloudinary processing indeterminate/staged, and only optionally add server-side provider state probing for missed-webhook recovery.

