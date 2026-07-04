# META-ORCH-1270 — Client-Side Cover-Video Pipeline (mingla-business)

Architecture phase, read-only. Maps every client-side moving part from "add a video cover"
to "cover applied", and enumerates every Cloudinary-specific coupling baked into the client.

Scope note: this covers ONLY the video-cover path. Image/GIF/stock covers do NOT touch
Cloudinary — device image/GIF uploads go to Supabase Storage bucket `event_covers`
(`services/eventCoverMediaService.ts:20,154-164`) and GIPHY/Pexels covers are just remote URLs.
Cloudinary is the video processor exclusively.

## Files read (trace order)

- `components/ui/CoverPicker.tsx` — the picker UI + orchestration of every stage.
- `components/ui/coverPickerDeviceMedia.native.ts` / `.ts` — native (expo-image-picker) vs web (file input) selection.
- `components/ui/coverPickerVideoTrimEditor.ts` / `.web.ts` — native react-native-video-trim vs web no-op stub.
- `components/ui/coverPickerVideoTrimUpload.ts` — normalizes the trimmed clip into an upload file.
- `components/ui/coverPickerFileInfo.native.ts` / `.ts` — stat a local file URI (native) vs web stub.
- `hooks/useEventCoverVideoUpload.ts` — the stateful upload state machine (start/cancel/stage).
- `services/eventCoverVideoProcessingService.ts` — every edge call + the direct-to-Cloudinary upload.
- `utils/platformFileSystem.native.ts` / `.ts` — expo-file-system multipart upload task (native) vs web stub.
- `utils/browserFilePicker.ts` — the web `<input type=file>` machinery.
- `types/eventCoverProvider.ts` — the `provider="upload"` metadata written into the 7-field cover patch.

---

## Numbered stage-by-stage pipeline

### 1. SELECTION

Entry point: `CoverPicker.pickVideoCover` (`CoverPicker.tsx:499`), fired by the "Video" button
in the Library tab (`CoverPicker.tsx:1102-1111`).

Pre-gates before any picker opens:
- Phone-web (`window.innerWidth < 768`) is HARD-BLOCKED — video upload is desktop/native only
  (`CoverPicker.tsx:209-212, 501-503`; the "Video" button is also `disabled={isPhoneWeb}` at 1109).
- Auth must be ready (`isAuthReady`, `CoverPicker.tsx:505-508`).
- Media-library permission + a non-empty server `eventRowId` (event/experience targets)
  (`CoverPicker.tsx:509-510`).

Selection mechanism is a Metro platform split:
- **Native** (`coverPickerDeviceMedia.native.ts:41-49`): `expo-image-picker`
  `launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 1, preferredAssetRepresentationMode: Compatible })`.
  No format/size filter is applied at the picker; duration comes from the asset metadata.
- **Web** (`coverPickerDeviceMedia.ts:75-92`): a hidden `<input type=file>`
  (`utils/browserFilePicker.ts:154-207`) with `accept="video/mp4,video/quicktime,video/*"`, `maxFiles:1`.
  Duration is read by loading the clip into an off-DOM `<video preload=metadata>`
  (`coverPickerDeviceMedia.ts:40-62`). No byte cap is enforced client-side on web (empty-file +
  MIME checks only, `browserFilePicker.ts:76-89`).

Client-enforced format/limit constants live in `eventCoverVideoProcessingService.ts:19-22`:
`EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`, `EVENT_COVER_SOURCE_CEILING_MS = 33_000`, and the
user copy "compresses the cover to a browser-safe MP4 under 25 MB".

### 2. TRIM

- **Native only.** `trimVideoWithDedicatedEditor` (`coverPickerVideoTrimEditor.ts:88-143`) lazily
  `require("react-native-video-trim")` and calls `showEditor(uri, { maxDuration: 29000, enablePreciseTrimming: true, saveButtonText:"Use clip", cancelButtonText:"Back" })`.
  It resolves with `{ outputPath, duration, startTime, endTime }` on finish, or `null` on cancel.
  The package is loaded lazily (not top-level) so a stale dev build rejects the action instead of
  crashing (`coverPickerVideoTrimEditor.ts:61-86`).
- **Web** has NO trimmer: `coverPickerVideoTrimEditor.web.ts:17-20` is a no-op returning
  `Promise.resolve(null)`; the caller gates on `isNative` (`CoverPicker.tsx:522-525`) and uploads
  the raw clip as-is, relying on the server (Cloudinary) to trim/compress.
- Trimmed clip → `buildTrimmedVideoUploadFile` (`coverPickerVideoTrimUpload.ts:20-52`): recomputes
  duration from `endTime-startTime`, stats the output file for byte size, forces `trimStartMs:0`,
  `trimEndMs:trimmedDurationMs`.
- Client-side duration limits after trim (`CoverPicker.tsx:543-560`): duration must be > 0; if it
  exceeds `EVENT_COVER_SOURCE_CEILING_MS` (33 s) the upload is rejected with "Please trim to 29
  seconds first."; byte size must be > 0. The 29 s cap is the trim-editor `maxDuration`; the 33 s
  ceiling is the hard client reject (allows ~4 s slack for imprecise native trims).

### 3. CLIENT COMPRESSION  (CRITICAL for the eval)

`compressVideoLocally` (`eventCoverVideoProcessingService.ts:415-451`), called first inside the
upload state machine (`useEventCoverVideoUpload.ts:100-110`):

- **Library:** `react-native-compressor` `Video.compress(uri, { compressionMethod: "auto" }, onProgress)`
  (`eventCoverVideoProcessingService.ts:402-413, 435-444`).
- **Platform:** NATIVE ONLY. `loadVideoCompressor` returns `null` on web
  (`eventCoverVideoProcessingService.ts:405`), so web NEVER compresses client-side.
- **Threshold:** even on native, compression is SKIPPED when the source is `< 5 MB`
  (`eventCoverVideoProcessingService.ts:427`) — it returns the original uri unchanged
  (`wasCompressed:false`).
- **Target codec/bitrate/resolution:** NONE specified. `compressionMethod:"auto"` delegates all
  choices to react-native-compressor's heuristic. There is no explicit MP4/H.264 target, no bitrate,
  no resolution cap, no size target in the client. Post-compress size is re-stat'd
  (`statFileSize`, 388-400, 447) and the new bytes/uri flow forward.

Bottom line: client compression is opportunistic, native-only, and non-deterministic (>5 MB, "auto").
It does NOT produce the final browser-safe derivative — the "browser-safe MP4 under 25 MB" outcome is
the SERVER (Cloudinary eager) transform. Web has no client compression at all. So client compression
cannot, as-is, replace server-side transcoding.

### 4. UPLOAD-INTENT CALL

`createEventCoverVideoUploadIntent` (`eventCoverVideoProcessingService.ts:635-766`), invoked at
`useEventCoverVideoUpload.ts:115-127`.

- Transport: `supabase.functions.invoke("event-cover-video-upload-intent", { body, headers:{ Authorization: Bearer <access_token> } })`
  (`...Service.ts:677-683`). The client fetches the session token itself first (`...Service.ts:666-676`).
- **Sends:** `target` ("event"|"brand"), `eventId` (omitted for brand), `brandId`, `applyMode`
  ("draft_auto"|"published_manual"), `sourceFileName`, `sourceMimeType`, `sourceBytes`,
  `sourceDurationMs`, `trimStartMs`, `trimEndMs`, plus a `clientRequestId`
  (`useEventCoverVideoUpload.ts:115-127`, `...Service.ts:635-647,680`).
- **Reads back:** ONLY `jobId`, `provider` (logged only), and `upload:{ url, fields }`
  (`UploadIntentResponse` at `...Service.ts:37-46`; extraction at `...Service.ts:735-765`). It hard-
  fails ("malformed") if `jobId`/`upload.url`/`upload.fields` are missing (`...Service.ts:738-753`).

Important: the client does NOT read `signature`, `api_key`, `cloud_name`, `public_id`, `timestamp`,
`eager`, or `notification_url` as named fields. Those all live INSIDE the opaque `upload.fields`
record (Cloudinary's signed params), which the client forwards blindly (see stage 5). The signing,
eager-transform params, and webhook `notification_url` are all set server-side and never inspected
by the client.

### 5. DIRECT UPLOAD  (client talks to Cloudinary DIRECTLY)

`uploadEventCoverVideoSource` (`eventCoverVideoProcessingService.ts:768-876`), invoked at
`useEventCoverVideoUpload.ts:131-142`. The client POSTs the file DIRECTLY to Cloudinary's signed URL
(`input.upload.url`) — it does not proxy the bytes through an edge function. Three transports:

- **Native primary** (`...Service.ts:790-860`): `createMultipartUploadTask` (expo-file-system legacy
  `createUploadTask`, MULTIPART + FOREGROUND, `platformFileSystem.native.ts:15-40`) POSTs to
  `upload.url` with field name `"file"` and `parameters = upload.fields` MINUS `resource_type`
  (`...Service.ts:790-792, 807-823`). Native progress callback drives the % bar.
- **XHR fallback** (`...Service.ts:453-521`, used on any native task error `...Service.ts:874`, and
  effectively the web path since the web multipart task stub throws — `platformFileSystem.ts:9-16`):
  builds a `FormData`, appends every `upload.fields` entry EXCEPT `resource_type`, then appends
  `file` as a React-Native `{ name, type, uri }` object; progress via `xhr.upload.onprogress`.
- **Web chunked** (`...Service.ts:523-574`, only when web AND `bytes > 50 MB` AND a jobId exists,
  gated at `...Service.ts:778-789`): fetches the blob, slices into 10 MB chunks, POSTs each with
  Cloudinary chunk headers `Content-Range: bytes {s}-{e}/{total}` and `X-Unique-Upload-Id: {jobId}`.

Progress: `emitUploadProgress` → `bytesSent/bytesTotal` percent (`...Service.ts:340-359`), surfaced
as `stage.phase="uploading"` (`useEventCoverVideoUpload.ts:136-138`) and rendered as the overlay
progress bar (`CoverPicker.tsx:1055-1062`).

Retry/cancel: retry re-runs `videoUpload.start(lastVideoUploadFileRef)` (`CoverPicker.tsx:592-596`);
cancel aborts via `AbortController` (`useEventCoverVideoUpload.ts:88-91, 207-223`) which calls
`task.cancelAsync()` / `xhr.abort()` and then the cancel edge fn.

The provider upload RESPONSE is parsed and sanitized to a Cloudinary shape
(`sanitizeProviderUploadResponse`, `...Service.ts:372-386`) — `asset_id, public_id, bytes, duration,
format, resource_type` — and returned up to the hook for the ack call.

### 6. ACK / POLL

Two steps, both via edge functions (no client webhook/realtime — pure polling):

- **Ack:** `acknowledgeEventCoverVideoSourceUploaded` (`...Service.ts:941-980`), invoked at
  `useEventCoverVideoUpload.ts:145-151`, calls `event-cover-video-source-uploaded` with
  `{ target, jobId, eventId?, brandId, providerUploadResponse }` — i.e. it hands the SERVER the
  sanitized Cloudinary response (public_id/asset_id/etc.). Returns a mapped status.
- **Poll:** `waitForEventCoverVideoReady` (`...Service.ts:1026-1064`), invoked at
  `useEventCoverVideoUpload.ts:155-165`, loops `fetchEventCoverVideoStatus` →
  `event-cover-video-status` (`...Service.ts:878-896`) every `1500 ms` up to a `120_000 ms` timeout.
  It resolves on `status ∈ {ready, applied}`, throws on `{failed, cancelled}`, and throws
  `processing_timeout` after 120 s. There is NO client subscription to a webhook/Realtime channel —
  the client only polls; the webhook (`notification_url`) is a server concern. The processed
  derivative URL arrives as `status.processedUrl` (`mapStatusResponse`, `...Service.ts:898-939`).

Stage mapping during this window: `stage.phase="processing"` with `progressPercent ?? 90`
(`useEventCoverVideoUpload.ts:153-165`), rendered as "Almost ready..." (`CoverPicker.tsx:310-312`).

### 7. APPLY

Two branches (`useEventCoverVideoUpload.ts:166-177`):

- **Brand target:** the client explicitly calls `applyEventCoverVideoJob` →
  `event-cover-video-apply` with `{ jobId }` (`...Service.ts:982-999`), which returns `processedUrl`;
  the server writes `brands.cover_media_url` + `cover_media_type='video'`.
- **Event/experience target:** the client does NOT call apply. Per the in-code contract
  (`useEventCoverVideoUpload.ts:166-169`) `draft_auto` auto-applies inside the server webhook and
  `published_manual` applies through the event publish flow. The client only takes `ready.processedUrl`
  and emits the 7-field cover patch.

Cover application on the client = `emitChange` with the processed URL and `provider="upload"`
metadata (`CoverPicker.tsx:324-343`, using `UPLOAD_EVENT_COVER_PROVIDER_METADATA` from
`types/eventCoverProvider.ts:19-25`), plus a "Video cover updated." toast. The processed URL is
rendered by `EventCoverMedia` as a plain video source — no Cloudinary URL transformation
(no `f_auto`/`q_auto`/`/upload/` rewriting) is done client-side.

---

## CLIENT CLOUDINARY-COUPLING LIST

Transport verdict: the client uploads the source bytes DIRECTLY to Cloudinary (a client-direct,
signed multipart/chunked POST to the provider URL). Everything ELSE (intent, ack, status poll, apply)
is mediated by our edge functions and is largely provider-agnostic in shape. So a provider swap is
MODERATE difficulty: the couplings below are concentrated in the single direct-upload leg plus the
provider-response schema the client forwards to the ack call. The upload URL and signed fields
themselves are server-supplied and opaque to the client (a plus for swapping).

Couplings (each must change to swap providers):

1. Provider literal `provider?: "cloudinary"` in `UploadIntentResponse`
   (`services/eventCoverVideoProcessingService.ts:39`). Cosmetic — logged only (`...Service.ts:757`),
   never branched on. Low effort.

2. Cloudinary upload-response schema `EventCoverVideoProviderUploadResponse`
   (`services/eventCoverVideoProcessingService.ts:119-126`) and its parser `sanitizeProviderUploadResponse`
   (`...Service.ts:372-386`): `asset_id`, `public_id`, `bytes`, `duration`, `format`, `resource_type`.
   The client parses the Cloudinary direct-upload JSON and forwards it to
   `event-cover-video-source-uploaded` (`...Service.ts:947, useEventCoverVideoUpload.ts:150`). A new
   provider returns a different response body → this schema + the ack contract must change.

3. `resource_type` is explicitly STRIPPED from the multipart form fields before every upload
   (`...Service.ts:479`, `...Service.ts:550`, `...Service.ts:791`). This is a Cloudinary-specific quirk
   (`resource_type` is a URL path segment for Cloudinary, not a form field). Provider-specific.

4. Multipart file field name literal `"file"` in all three upload transports
   (`...Service.ts:481`, `...Service.ts:552`, `...Service.ts:811`). Cloudinary expects the binary under
   `file`; another provider may differ.

5. Cloudinary chunked-upload protocol headers `Content-Range` + `X-Unique-Upload-Id`
   (`...Service.ts:553-560`). This is Cloudinary's documented chunked-upload scheme (web >50 MB path).

6. Cloudinary error-response shape assumption in `cloudinaryUploadFailureDetail`
   (`...Service.ts:361-370`), consumed at `...Service.ts:512, 566, 848`: reads `body.error.message`.
   A different provider's error JSON would not surface a useful message.

7. Client-direct signed-upload PROTOCOL itself: POST of `upload.fields` (Cloudinary's signed params —
   signature/api_key/timestamp/public_id/folder/eager) as multipart form to `upload.url`
   (`...Service.ts:519, 555, 807, 477-485, 548-552`). The client is agnostic to the CONTENTS of
   `upload.fields` (it forwards them blindly, which helps), but the ACT of a browser/device-direct
   signed multipart POST is a Cloudinary-signed-upload assumption. A provider using presigned PUT to
   object storage, a tus endpoint, or a resumable protocol would require rewriting this leg entirely.

8. Documentation-level (not executable) coupling: comments assert "the server (Cloudinary)
   trims/compresses to a browser-safe <=29s MP4" (`components/ui/coverPickerVideoTrimEditor.web.ts:11`,
   `components/ui/CoverPicker.tsx:323`). No code depends on it, but it records the client's reliance on
   Cloudinary eager transforms as the real transcoder.

Minor/soft (not strictly Cloudinary): default filename/mime fallbacks `event-cover.mov` /
`video/quicktime` / `event-cover.mp4` / `video/mp4` (`...Service.ts:482-484, 538, 552, 813`).

Explicitly NOT coupled (reduces swap cost):
- The final processed URL is server-returned (`status.processedUrl` / apply's `processedUrl`) and
  rendered without any client-side Cloudinary URL transformation.
- Image/GIF/stock covers never touch Cloudinary (Supabase Storage + remote provider URLs).
- The upload URL and all signed params are opaque server-supplied strings the client never constructs.

Client coupling count: 7 executable Cloudinary couplings (C1-C7) + 1 documentation-only (C8),
all confined to `services/eventCoverVideoProcessingService.ts` except the doc comments.
