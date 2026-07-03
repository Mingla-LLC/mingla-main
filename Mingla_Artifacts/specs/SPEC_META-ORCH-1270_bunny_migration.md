# SPEC — META-ORCH-1270 — Cloudinary → Bunny Stream migration + leak-proofing

Date: 2026-07-03
Author: mingla-forensics (SPEC mode)
Branch: `META-ORCH-1270-bunny-migration`
Status: BUILD CONTRACT — implementor may not deviate. Every external API call in this
spec was verified against `docs.bunny.net` on 2026-07-03 (URLs cited inline). This spec
writes NO product code; it is the contract the implementor executes.

---

## 0. Goal & non-negotiables

Replace Cloudinary with **Bunny Stream** as the cover-video host, add leak-proofing so an
overage can never again kill the account, then retire Cloudinary. Cover videos are short
(≤ 30 s), muted, autoplaying ambient loops; the delivered MP4 is capped at 25 MB.

Hard rules for this build:

1. **Reuse the provider-agnostic core.** Do NOT touch the `event_cover_video_jobs` state
   machine, `assertProcessedDerivative`, `eventCoverVideoReadyUpdate`, or
   `mapEventCoverVideoStatus` semantics. They are provider-neutral and stay.
2. **Real provider dispatch.** `EVENT_COVER_VIDEO_PROVIDER` today only gates a boolean in
   `providerConfigured()` (`_shared/eventCoverVideo.ts:249-256`). It becomes a genuine
   `cloudinary | bunny` switch. Cloudinary code stays UNTOUCHED until Phase 4.
3. **Guardrails land BEFORE the provider flip.** Phase 2 (reaping + byte cap + working
   alarm + circuit-breaker) must be live and proven on the Bunny library BEFORE
   `EVENT_COVER_VIDEO_PROVIDER=bunny` is set in prod.
4. **Zero data migration.** Cloudinary account is dead, prod DB was wiped 2026-06-22, and
   there are 0 live cover videos. No backfill, no URL rewrite, no dual-read. New uploads
   self-heal onto Bunny.
5. **Fail closed.** Every ambiguous provider result (missing MP4, over-cap bytes, unsigned
   webhook we can't authenticate, usage over the hard cap) fails the job / refuses the
   upload — never serves an unbounded or unverified asset.
6. **CLOSE Step 0.5** — every phase ships (a) an implementor happy-path test that FAILS on
   revert and (b) a tester adversarial angle, plus its DRAFT invariant registry rows.

---

## 1. Confirmed Bunny Stream API contract (verified against docs.bunny.net)

All Stream management + upload calls target host `https://video.bunnycdn.com` and
authenticate with the header `AccessKey: {BUNNY_STREAM_API_KEY}` (the Stream **library**
API key). The account-wide usage read (Phase 2 alarm) targets `https://api.bunny.net` with
a **different** key (`BUNNY_ACCOUNT_API_KEY`). Delivery is over the pull-zone CDN host
`{BUNNY_STREAM_CDN_HOSTNAME}` (e.g. `vz-xxxxxxxx-xxx.b-cdn.net`).

1. **Create video** — `POST https://video.bunnycdn.com/library/{libraryId}/videos`
   Headers: `AccessKey`, `Content-Type: application/json`, `accept: application/json`.
   Body: `{"title": "<string>"}` (optional `collectionId`, `thumbnailTime` ms).
   Response: JSON video object; the field we need is **`guid`** (the videoId).
   Doc: https://docs.bunny.net/reference/video_createvideo

2. **Presigned direct upload (TUS resumable)** — client uploads straight to Bunny with a
   server-computed signature, so the AccessKey is NEVER exposed to the client. This is the
   ONLY client-direct path (the simple `PUT .../videos/{videoId}` requires the AccessKey
   header and therefore cannot be client-direct).
   - TUS endpoint: `https://video.bunnycdn.com/tusupload`
   - **Signature recipe (verbatim from docs): `SHA256(library_id + api_key + expiration_time + video_id)`** — the four values concatenated with NO delimiters, hex-encoded.
   - `expiration_time` = **UNIX seconds** (not ms) at which the signature expires.
   - Required headers on the TUS creation request: `AuthorizationSignature`,
     `AuthorizationExpire`, `LibraryId`, `VideoId`, plus TUS `Tus-Resumable: 1.0.0`,
     `Upload-Length: {bytes}`, `Upload-Metadata: filetype {b64(mime)},title {b64(title)}`.
   - Docs: https://docs.bunny.net/stream/tus-resumable-uploads and
     https://bunny.net/blog/bunny-stream-introducing-pre-signed-and-resumable-uploads/

3. **Get video** — `GET https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}`
   (header `AccessKey`). Fields we use: `guid`, `status` (int enum), `length` (duration
   **seconds**, int), `storageSize` (bytes, int64), `availableResolutions` (nullable CSV
   like `"720p,480p,360p"`), `encodeProgress` (int %).
   Doc: https://docs.bunny.net/reference/video_getvideo

4. **Delete video** — `DELETE https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}`
   (header `AccessKey`). Replaces `cloudinaryDestroy`.
   Doc: https://docs.bunny.net/reference/video_deletevideo

5. **Webhook (encoding state change)** — configured ONCE at the **library** level (a single
   webhook URL in Stream library settings), NOT per-upload like Cloudinary's
   `eager_notification_url`. POST body JSON: `{ "VideoLibraryId": <int>, "VideoGuid":
   "<guid>", "Status": <int> }`.
   Status enum (integers): `0 Queued`, `1 Processing`, `2 Encoding`, `3 Finished` (fully
   available), `4 Resolution finished` (one rendition playable), `5 Failed`, `6+`
   pre-signed / caption states (ignore).
   Authenticity: HMAC-SHA256 of the **raw** body, signing secret = the library's read-only
   API key; headers `X-BunnyStream-Signature` (+ `X-BunnyStream-Signature-Version: v1`,
   `X-BunnyStream-Signature-Algorithm: hmac-sha256`). Verify with a constant-time compare
   against `HMAC-SHA256(rawBody, BUNNY_STREAM_WEBHOOK_KEY)`.
   Doc: https://docs.bunny.net/docs/stream-webhook

6. **Poster / thumbnail** — auto-generated at
   `https://{cdnHostname}/{videoGuid}/thumbnail.jpg`. Replaces `deriveCoverPosterUrl`'s
   `so_0` trick.
   Doc: https://support.bunny.net/hc/en-us/articles/5154991563026-How-to-retrieve-an-MP4-URL-from-Stream

7. **Delivery MP4 (for `<video>` / expo-video)** —
   `https://{cdnHostname}/{videoGuid}/play_{H}p.mp4`, where `{H}` is a rendered resolution
   height (e.g. `play_720p.mp4`). **Requires "MP4 Fallback" enabled on the library**
   (console setting); fallback maxes at 720p and only applies to videos uploaded AFTER it
   was enabled — a higher `play_1080p.mp4` 404s. Pick the highest available ≤ 720p from the
   GET-video `availableResolutions`.
   Doc: https://support.bunny.net/hc/en-us/articles/5154991563026-How-to-retrieve-an-MP4-URL-from-Stream

8. **Usage / statistics (Phase-2 alarm)** — `GET https://api.bunny.net/videolibrary/{id}`
   (header `AccessKey: {BUNNY_ACCOUNT_API_KEY}`, the ACCOUNT key). Returns `StorageUsage`
   (bytes) + `TrafficUsage` (bytes this month) + `PullZoneId`. The probe converts each to a
   percent of a configured cap and alerts on the higher of the two.
   Doc: https://docs.bunny.net/reference/videolibrarypublic_index

9. **Volume network** — cheap African egress ($0.005/GB) is a **pull-zone tier** setting on
   the pull zone connected to the Stream library: set that pull zone's **Tier = Volume** in
   the Bunny console. No code; a Seth console step (§7).

---

## 2. Architecture: seam, env vars, DB

### 2.1 Provider seam (server, `_shared/eventCoverVideo.ts`)

Add (Cloudinary functions stay as-is):

```
export type CoverVideoProvider = "cloudinary" | "bunny";

export function coverVideoProvider(): CoverVideoProvider {
  return (Deno.env.get("EVENT_COVER_VIDEO_PROVIDER") ?? "cloudinary") === "bunny"
    ? "bunny" : "cloudinary";
}

// providerConfigured() becomes a dispatch (NO behavior change for cloudinary):
export function providerConfigured(): boolean {
  return coverVideoProvider() === "bunny" ? bunnyConfigured() : cloudinaryConfigured();
}
function cloudinaryConfigured(): boolean { /* the existing three-secret check */ }
function bunnyConfigured(): boolean {
  return Boolean(Deno.env.get("BUNNY_STREAM_LIBRARY_ID"))
      && Boolean(Deno.env.get("BUNNY_STREAM_API_KEY"))
      && Boolean(Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME"));
}

// Provider-agnostic terminal cleanup (replaces the direct cloudinaryDestroy call sites):
export async function destroyCoverVideoAsset(job: {
  provider?: string | null; source_public_id?: unknown; source_asset_id?: unknown;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const provider = (job.provider as string) ?? coverVideoProvider();
  if (provider === "bunny") return bunnyDeleteVideo(String(job.source_asset_id ?? ""));
  return cloudinaryDestroy(String(job.source_public_id ?? "")); // unchanged path
}
```

### 2.2 New shared file `_shared/bunnyStream.ts`

All Bunny HTTP lives here (mirror of the Cloudinary helpers in `eventCoverVideo.ts`). Exact
signatures the implementor must produce:

```
const BUNNY_HOST = "https://video.bunnycdn.com";
const BUNNY_TUS  = "https://video.bunnycdn.com/tusupload";

function bunnyLibraryId(): string  // Deno.env BUNNY_STREAM_LIBRARY_ID
function bunnyApiKey(): string     // Deno.env BUNNY_STREAM_API_KEY
function bunnyCdnHost(): string    // Deno.env BUNNY_STREAM_CDN_HOSTNAME

export async function sha256Hex(input: string): Promise<string>   // crypto.subtle SHA-256

// Create the video object; returns its guid.
export async function bunnyCreateVideo(title: string):
  Promise<{ ok: true; guid: string } | { ok: false; reason: string }>;

// Presign a TUS upload for an existing videoId. expirySeconds default 3600.
export function bunnyPresignTusUpload(videoId: string, expirySeconds?: number): {
  tusEndpoint: string; libraryId: string; videoId: string;
  authorizationSignature: string;  // sha256Hex(libraryId + apiKey + expire + videoId)
  authorizationExpire: number;     // UNIX seconds
};

export async function bunnyGetVideo(guid: string):
  Promise<{ ok: true; video: BunnyVideo } | { ok: false; status: number; reason: string }>;

export async function bunnyDeleteVideo(guid: string):
  Promise<{ ok: true } | { ok: false; reason: string }>;

export function bunnyThumbnailUrl(guid: string): string;         // https://{cdn}/{guid}/thumbnail.jpg
export function bunnyPlayUrl(guid: string, heightP: number): string; // https://{cdn}/{guid}/play_{H}p.mp4

// Highest available resolution ≤ 720 from availableResolutions ("720p,480p" → 720).
export function bunnyBestMp4(video: BunnyVideo): { url: string; heightP: number } | null;

// Map Bunny numeric Status → our job lifecycle.
export function mapBunnyStatus(status: number):
  "processing" | "ready" | "failed" | "ignore";
// 0,1,2 → "processing"; 3 → "ready"; 5 → "failed"; 4 → "processing" (wait for 3); else "ignore".

// HMAC-SHA256(rawBody, BUNNY_STREAM_WEBHOOK_KEY), constant-time compare to header.
export async function verifyBunnyWebhookSignature(input: {
  rawBody: string; signatureHeader: string | null; secret: string;
}): Promise<{ ok: true } | { ok: false; code: string; status: number; message: string }>;
```

### 2.3 Env vars (Supabase project secrets, LIVE prod `gqnoajqerqhnvulmnyvv`)

Phase 1: `EVENT_COVER_VIDEO_PROVIDER` (flip to `bunny` only at cutover),
`BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_CDN_HOSTNAME`,
`BUNNY_STREAM_WEBHOOK_KEY`.
Phase 2 (alarm): `BUNNY_ACCOUNT_API_KEY` (account key for `api.bunny.net`),
`BUNNY_STORAGE_CAP_BYTES`, `BUNNY_TRAFFIC_CAP_BYTES` (monthly caps the % is measured
against), `API_HEALTH_BUNNY_WARN_PCT` (default 60), `API_HEALTH_BUNNY_CRIT_PCT` (default
85), `EVENT_COVER_UPLOAD_HARD_CAP_PCT` (circuit-breaker, default 90).

### 2.4 DB reuse / additions

Reuse (no change): `provider`, `status`, `apply_mode`, `source_bytes`, `source_duration_ms`,
`trim_*`, `processed_url`, `processed_mime_type`, `processed_bytes`, `processed_duration_ms`,
`provider_payload`, `completed_at`, `applied_at`, `cancelled_at`, `failure_*`.

Reuse with new semantics for Bunny:
- **`source_asset_id`** holds the Bunny **video guid** (the "provider asset id"). This is
  what `destroyCoverVideoAsset` and the webhook job-lookup key on.
- `provider_payload.bunny = { videoId, libraryId, cdnHostname }`.

Migrations:
- **Phase 1** (`..._meta_orch_1270_bunny_provider.sql`): drop + re-add the `provider` CHECK
  to `IN ('cloudinary','transloadit','bunny')`; add
  `CREATE INDEX idx_event_cover_video_jobs_source_asset ON event_cover_video_jobs
  (source_asset_id) WHERE source_asset_id IS NOT NULL` (webhook lookup by guid).
- **Phase 2** (`..._meta_orch_1270_reaper_and_alarm.sql`): add `reaped_at timestamptz`
  (nullable; set when the Bunny asset is destroyed so the reaper never double-deletes);
  seed the `bunny` row into `api_health_services` + `api_health_alert_state`; schedule the
  reaper cron (pattern copied from `20261120000000_orch_1201_api_health_hub.sql:233-247`).

---

## 3. PHASE 1 — Bunny provider branch (Cloudinary path untouched)

Goal: with `EVENT_COVER_VIDEO_PROVIDER=bunny`, a business user picks → uploads → the cover
appears, end-to-end on Bunny, with the SAME job lifecycle and client UX. Cloudinary still
works when the env is `cloudinary`.

### 3.1 `event-cover-video-upload-intent/index.ts`

Branch on `coverVideoProvider()` after `job` insert (keep ALL auth, validation, supersede,
and insert logic — only the provider block + the returned `upload` payload change; set
`provider: coverVideoProvider()` on insert instead of the literal `"cloudinary"`).

Bunny branch:
1. `create = await bunnyCreateVideo(title)` where `title` = `job.id` (or
   `"{brandId}:{eventId|brand}:{job.id}"`). On `!create.ok` → mark job `failed`
   (`failure_code:"provider_create_failed"`), return `500 { error:"internal_error",
   detail:"provider_create_failed" }`.
2. Persist: `UPDATE event_cover_video_jobs SET source_asset_id = create.guid,
   provider_payload = { bunny: { videoId: create.guid, libraryId, cdnHostname } }`.
3. `presign = bunnyPresignTusUpload(create.guid)`.
4. Return (SAME envelope shape the client already parses — `jobId` + `upload.url` +
   `upload.fields`, so C7's "malformed" guard passes unchanged):

```
{
  jobId: job.id,
  provider: "bunny",
  maxDurationMs: MAX_DURATION_MS,
  finalMaxBytes: 25 * 1024 * 1024,
  upload: {
    url: presign.tusEndpoint,                    // https://video.bunnycdn.com/tusupload
    protocol: "tus",                             // NEW discriminator (client branches on it)
    videoId: presign.videoId,
    fields: {                                     // sent as TUS creation headers by the client
      AuthorizationSignature: presign.authorizationSignature,
      AuthorizationExpire: String(presign.authorizationExpire),
      LibraryId: presign.libraryId,
      VideoId: presign.videoId
    },
    metadata: { filetype: sourceMimeType ?? "video/mp4", title: job.id }
  }
}
```

Cloudinary branch: unchanged (returns `protocol:"cloudinary-multipart"` implicitly — add the
explicit `protocol` field to BOTH branches so the client's dispatch is unambiguous;
Cloudinary value = `"cloudinary"`).

### 3.2 Client upload leg — `mingla-business/src/services/eventCoverVideoProcessingService.ts`

The 7 Cloudinary couplings (C1–C7) resolve as follows. Gate the whole upload transport on
`input.upload.protocol`.

- **C1** (`provider?: "cloudinary"` literal, `:39`): widen to `provider?: "cloudinary" |
  "bunny"`. Cosmetic (logged only).
- **C7** (the transport): add a `protocol` field to `UploadIntentResponse.upload` and branch.
  `protocol === "tus"` → new `uploadEventCoverVideoSourceViaTus(...)`; else the existing
  Cloudinary multipart/XHR/chunked path (unchanged).
- **New TUS leg** `uploadEventCoverVideoSourceViaTus(input)`:
  1. TUS creation: `POST {upload.url}` with headers = `{ ...upload.fields, "Tus-Resumable":
     "1.0.0", "Upload-Length": String(bytes), "Upload-Metadata": tusMetadata(upload.metadata)
     }`. `tusMetadata` = `"filetype {base64(mime)},title {base64(title)}"`. Expect `201`
     with a `Location` header (the resumable upload URL).
  2. Upload the bytes with a single PATCH (one shot is valid TUS for a ≤ 25 MB clip):
     - **Native**: `createBinaryUploadTask(location, uri, { httpMethod: "PATCH", headers: {
       "Tus-Resumable":"1.0.0", "Upload-Offset":"0",
       "Content-Type":"application/offset+octet-stream" } }, onProgress)` — a NEW
       `FileSystemUploadType.BINARY_CONTENT` task in `utils/platformFileSystem.native.ts`
       (expo-file-system already supports `BINARY_CONTENT`; no new native module → OTA-safe).
     - **Web**: XHR `PATCH {location}` with the same headers, body = the `Blob`;
       `xhr.upload.onprogress` drives the bar (reuse `emitUploadProgress`).
     - Resumability (optional, recommended): on retry, `HEAD {location}` to read
       `Upload-Offset` and PATCH the remainder. A single-shot PATCH is acceptable for MVP
       given the 25 MB cap.
  3. Success = HTTP `204` (or `200`). Return `{ videoId: upload.videoId }` (NOT a Cloudinary
     response object).
- **C2** (`EventCoverVideoProviderUploadResponse` + `sanitizeProviderUploadResponse`): for
  the TUS path there is NO provider JSON to parse. The ack call (§3.3) sends only
  `{ target, jobId, eventId?, brandId }`; the server reads the truth from Bunny. Keep C2/C3/
  C4/C5/C6 for the Cloudinary path (untouched, retired in Phase 4).
- **C3** (`resource_type` strip), **C4** (`"file"` field name), **C5** (chunk headers),
  **C6** (`body.error.message`): Cloudinary-only; not on the TUS path.

Everything else on the client (state machine `useEventCoverVideoUpload.ts`, `waitFor…Ready`
polling, cancel/apply) is provider-agnostic and unchanged.

### 3.3 `event-cover-video-source-uploaded/index.ts`

Add a Bunny branch (keep all auth + job-context checks + the `source_uploading →
source_uploaded` transition). For Bunny, IGNORE `providerUploadResponse`; instead:
1. `v = await bunnyGetVideo(job.source_asset_id)`. If `!v.ok` → keep job at
   `source_uploading` and return its mapped status (client will re-ack/poll); the video may
   not be registered yet.
2. **Source cap (Vector C fix, moved here):** if `v.video.storageSize >
   MAX_SOURCE_VIDEO_BYTES` → `destroyCoverVideoAsset(job)`, set job `failed`
   (`failure_code:"source_over_cap"`), return `413`/mapped-failed. (Real bytes now enforced
   from Bunny, not the client-declared number.)
3. Merge `provider_payload.source_upload = { acknowledged_at, storageSize, length,
   bunny_status: v.video.status }`, set `status:"source_uploaded"`.

### 3.4 `event-cover-video-webhook/index.ts`

Add a Bunny branch selected by `coverVideoProvider()` (Cloudinary branch unchanged). Because
the Bunny webhook is LIBRARY-level and identifies the asset by `VideoGuid` (not our context),
the job lookup changes:

1. `verifyBunnyWebhookSignature({ rawBody, signatureHeader: req.headers.get(
   "x-bunnystream-signature"), secret: BUNNY_STREAM_WEBHOOK_KEY })`. If the header is ABSENT
   (older libraries send unsigned) → **fallback authenticity by fetch**: `bunnyGetVideo(
   VideoGuid)` with the AccessKey; proceed only if it exists AND a job row matches. If the
   header is present and mismatches → `403`.
2. Parse `{ VideoLibraryId, VideoGuid, Status }`. Look up job:
   `SELECT ... FROM event_cover_video_jobs WHERE source_asset_id = VideoGuid` (uses the new
   index). No match → `200 { ok:true, ignored:"unknown_guid" }` (idempotent, never 500 on a
   library webhook for a foreign video).
3. Honor the existing terminal guards (`cancelled` → ignore; `applied` → ignore).
4. `mapBunnyStatus(Status)`:
   - `"processing"` → `UPDATE ... SET status='processing'`, `200 {ok:true}`.
   - `"failed"` → `destroyCoverVideoAsset(job)` (reclaim), set `failed`
     (`failure_code:"provider_failed"`), `200 {ok:true}`.
   - `"ignore"` → `200 {ok:true, ignored:"status_"+Status}`.
   - `"ready"` (Status 3 Finished) → finalize (step 5).
5. Finalize on Finished:
   - `v = bunnyGetVideo(VideoGuid)`; `best = bunnyBestMp4(v.video)`; if `best === null` →
     `failed` (`failure_code:"processed_mp4_unavailable"`). (Fail closed — MP4 Fallback not
     enabled or no ≤720p rendition.)
   - `head = HEAD best.url` (retry ≤ 3× @ 2 s for the MP4 to flush). `bytes =
     Number(head.headers.get("content-length"))`. On persistent 404 → `failed`
     (`processed_mp4_unavailable`).
   - `durationMs = (v.video.length ?? 0) * 1000` (fallback to job trim window like the
     Cloudinary path).
   - `derivative = assertProcessedDerivative({ url: best.url, mimeType:"video/mp4", bytes,
     durationMs })` — **REUSED unchanged** (validates https + mp4 + ≤ FINAL_MAX_BYTES + ≤ 30 s).
     `!derivative.ok` → `destroyCoverVideoAsset(job)` + `failed` (derivative.code). (Delivered
     25 MB cap enforced here, Vector C fix.)
   - `UPDATE ... eventCoverVideoReadyUpdate({ applyMode, derivative, providerPayload:
     { ...payload, bunny_thumbnail: bunnyThumbnailUrl(VideoGuid) } })` — **REUSED unchanged**.
   - Auto-apply for `target_kind !== 'brand' && apply_mode === 'draft_auto'` — the existing
     block, unchanged (writes `events.cover_media_url = derivative.url`).

### 3.5 Poster derivation — `packages/offering-rendering/coverMediaPresentation.ts`

`deriveCoverPosterUrl(videoUrl)` becomes provider-aware (still a pure string fn of the stored
`cover_media_url`, so `EventCoverMedia` needs NO prop change — the caller override path is
untouched):

```
// Bunny: https://{cdn}/{guid}/play_{H}p.mp4  →  https://{cdn}/{guid}/thumbnail.jpg
if (/\/play_\d+p\.mp4($|\?)/i.test(videoUrl)) {
  return videoUrl.replace(/\/play_\d+p\.mp4(\?.*)?$/i, "/thumbnail.jpg");
}
// Cloudinary: existing so_0 branch (retired in Phase 4)
```

### 3.6 Phase 1 DRAFT invariants

- `I-MOR-1270-PROVIDER-DISPATCH` — `EVENT_COVER_VIDEO_PROVIDER=bunny` routes upload-intent /
  source-uploaded / webhook / destroy through the Bunny branch; `=cloudinary` is byte-for-byte
  the pre-1270 Cloudinary path. Guard: unit test both env values.
- `I-MOR-1270-NO-ACCESSKEY-IN-CLIENT` — no Bunny secret (`BUNNY_STREAM_API_KEY`,
  `_WEBHOOK_KEY`, `_ACCOUNT_API_KEY`) may appear in any app/marketing/admin bundle; only the
  presigned `AuthorizationSignature` reaches the client. Guard: repo grep in CI (strict-grep
  registry) + a test asserting upload-intent's response contains no `AccessKey`.
- `I-MOR-1270-PROVIDER-AGNOSTIC-CORE` — `assertProcessedDerivative`,
  `eventCoverVideoReadyUpdate`, `mapEventCoverVideoStatus` are called from the Bunny branch
  unchanged. Guard: test the Bunny webhook drives a job to `ready` via these exact functions.

### 3.7 Phase 1 regression tests

Implementor (happy-path, FAILS ON REVERT):
- `event-cover-video-upload-intent` Bunny test: env `bunny`, mock `bunnyCreateVideo` →
  `{guid}`; assert response `upload.protocol==="tus"`, `upload.url` is the tus endpoint,
  `upload.fields.AuthorizationSignature` equals `sha256Hex(lib+key+expire+guid)`, and the job
  row is `provider:"bunny"`, `source_asset_id:guid`. Revert (delete the Bunny branch) → the
  test throws.
- webhook Finished test: seed a `processing` Bunny job; POST `{VideoGuid, Status:3}` with a
  valid HMAC; mock `bunnyGetVideo` (`availableResolutions:"720p,480p"`, `length:12`) + a HEAD
  returning `content-length: 8_000_000`; assert job → `ready`, `processed_url` ends
  `/play_720p.mp4`, `processed_bytes===8_000_000`.
- `deriveCoverPosterUrl` test: a `…/play_720p.mp4` in → `…/thumbnail.jpg` out; a Cloudinary
  URL still yields the `so_0` still.

Tester (adversarial):
- Forge a webhook with a wrong/absent `X-BunnyStream-Signature` → 403 (or fetch-fallback that
  can't confirm → 403); job never advances.
- Webhook for a `VideoGuid` with no job row → 200 ignored, no 500, no state change.
- Finished but `availableResolutions:null` / HEAD 404 → job `failed`
  (`processed_mp4_unavailable`), asset destroyed, cover NOT applied (fail-closed).
- Live-fire on a real Bunny test library (needs creds, §7): pick a 20 s clip in
  mingla-business, confirm the cover plays on the event hero and grid, and the stored URL is
  `https://{cdn}/{guid}/play_720p.mp4`.

---

## 4. PHASE 2 — Guardrails (LIVE before the provider flip)

### 4.1 Storage reaping (destroy on every terminal + a reaper cron)

Make cleanup provider-agnostic via `destroyCoverVideoAsset(job)` and add it to EVERY
termination path (today only user-cancel destroys):

- **Supersede** (`upload-intent/index.ts:234-260`): after marking prior active jobs
  `cancelled`, `SELECT id, provider, source_asset_id, source_public_id` for those rows and
  `destroyCoverVideoAsset` each; set `reaped_at=now()` on success.
- **Failure** (`webhook` failed/derivative-invalid branches): already destroys in §3.4 for
  Bunny; add the same to the Cloudinary failure branches is OUT of scope (Cloudinary retires
  Phase 4) — Bunny failure destroy is mandatory.
- **Replace** (`event-cover-video-apply` + webhook auto-apply): before writing the new
  `cover_media_url`, look up the PRIOR applied job for that `event_id`/`brand_id`
  (`status='applied'`, different `id`) and `destroyCoverVideoAsset` it + `reaped_at=now()`.
- **Cancel** (`event-cover-video-cancel/index.ts:94-104`): swap the direct `cloudinaryDestroy`
  for `destroyCoverVideoAsset(job)`; set `reaped_at`.
- **Reaper cron** — new edge fn `event-cover-video-reaper` (service-role, no auth; invoked
  only by pg_cron). Every 6 h it finds and destroys leaked assets:
  - jobs in `{cancelled, failed}` with `source_asset_id IS NOT NULL AND reaped_at IS NULL`;
  - superseded jobs (`failure_code='superseded'`) same predicate;
  - abandoned drafts: `status IN ('source_uploaded','ready') AND created_at < now()-interval
    '24 hours' AND applied_at IS NULL` — destroy + set `failed`(`failure_code:'reaped_abandoned'`);
  - orphans from event/brand delete: jobs whose `event_id`/`brand_id` no longer exists or is
    soft-deleted → destroy.
  For each: `destroyCoverVideoAsset` then `UPDATE ... SET reaped_at=now()`. Idempotent
  (`reaped_at` guards double-delete; Bunny delete of an absent guid returns not-found →
  treated as ok).
  Schedule via pg_cron + `pg_net.http_post` using the vault `supabase_url` +
  `service_role_key` pattern from `20261120000000_orch_1201_api_health_hub.sql:233-247`.

### 4.2 Real server-enforced byte cap

Done in §3.3 (source cap vs `storageSize`) and §3.4 (delivered cap vs `assertProcessedDerivative`
+ HEAD `content-length`). Invariant `I-MOR-1270-REAL-BYTE-CAP`: an oversize source is
destroyed + failed at ack; an oversize derivative is destroyed + failed at finalize. Neither
relies on any client-declared number.

### 4.3 Fix the usage alarm so it ACTUALLY fires — `api-health-probe`

The Cloudinary alarm never paged because `credits.used_percent` could be null while the dot
stayed green (Vector D failure #1). Bunny's alarm is deterministic (StorageUsage / TrafficUsage
are always numeric).

- **New `probeBunny()`** (mirror `probeCloudinary` at `index.ts:438-472`):
  - Read `BUNNY_ACCOUNT_API_KEY`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STORAGE_CAP_BYTES`,
    `BUNNY_TRAFFIC_CAP_BYTES`. Any missing → `status:"unknown"` (grey, NEVER green — matches
    the constitutional "no fabricated health" rule).
  - `GET https://api.bunny.net/videolibrary/{libraryId}` header `AccessKey`. Read
    `StorageUsage`, `TrafficUsage`.
  - `storagePct = 100*StorageUsage/cap`, `trafficPct = 100*TrafficUsage/cap`,
    `used_percent = max(storagePct, trafficPct)`. Emit `detail: { used_percent,
    storage_pct, traffic_pct, storage_bytes, traffic_bytes }`. Synthetic `down` iff
    `used_percent >= crit`.
  - **Null-numeric guard fixed by construction**: `StorageUsage`/`TrafficUsage` are numbers;
    if the fetch fails or a field is non-numeric → `status:"unknown"`, NOT healthy.
- **Register** `["bunny", probeBunny, null]` in the `bProbes` array (`index.ts:807` area).
- **logic.ts** — add a `bunny_usage_pct` case to `evaluateBalanceForSignal` (mirror
  `cloudinary_used_pct` at `:356-363`): `used = toNum(detail.used_percent); low = used>=warn;
  crit at >=crit`.
- **Env fallback** in `computeBalanceSignal` (`index.ts:1129` area): add
  `else if (bal.kind === "bunny_usage_pct") { warn = num("API_HEALTH_BUNNY_WARN_PCT", 60);
  if (crit==null) crit = num("API_HEALTH_BUNNY_CRIT_PCT", 85); }`.
- **Seed** (Phase-2 migration): `api_health_services` row `service_key='bunny'`,
  `monitoring_class='A'`, `depletion_signal = { status_feed:
  'https://status.bunny.net/...' (or null), balance: { kind:'bunny_usage_pct', warn:60,
  crit:85, unit:'pct_used' } }`; plus an `api_health_alert_state` row for `bunny` (else
  `runAlertStateMachine` silently skips it — Vector D failure #5). Informational webhook
  freshness: `await webhookFreshness("bunny", "event_cover_video_jobs", "created_at", false)`.
- **Lower threshold**: warn 60 / crit 85 (paged far earlier than Cloudinary's 80/100 given a
  prepaid balance; Seth can tune via env).
- **Verify plumbing** (Vector D failures #2–#7, runbook — NOT code): cron scheduled, vault
  `supabase_url`+`service_role_key` present, `RESEND_API_KEY` non-sandbox, alert-state row
  seeded, force one probe run and confirm an `api_health_checks` bunny row with numeric
  `used_percent`.

### 4.4 Hard pre-upload circuit-breaker (fail closed above the cap)

In `event-cover-video-upload-intent`, BEFORE `bunnyCreateVideo` (Bunny branch only), read the
newest `api_health_checks` row for `service_key='bunny'` (synthetic layer) — or call
`probeBunny()` live if the freshest row is older than ~1 h. If `used_percent >=
EVENT_COVER_UPLOAD_HARD_CAP_PCT` (default 90) → do NOT create the video; return
`503 { error:"media_unavailable", detail:"Cover video is temporarily unavailable. Try again
later." }`. This makes blowing past the cap structurally impossible even if the email never
sends. Client already surfaces unknown edge errors as a toast; add a `media_unavailable` copy
mapping in `processingErrorFromPayload`.

### 4.5 Phase 2 DRAFT invariants + tests

Invariants: `I-MOR-1270-REAP-ON-TERMINAL` (every terminal path destroys the Bunny asset +
sets `reaped_at`), `I-MOR-1270-REAL-BYTE-CAP` (§4.2), `I-MOR-1270-USAGE-ALARM-FIRES` (a
≥warn `used_percent` produces `balanceLow:true` and a Resend alert), `I-MOR-1270-UPLOAD-
CIRCUIT-BREAKER` (upload-intent 503s above the hard cap).

Implementor tests (FAIL ON REVERT):
- Supersede test: create job A (guid A), create job B for the same event → assert A is
  `cancelled` AND `destroyCoverVideoAsset(A)` was called AND `A.reaped_at` set.
- Byte-cap test: `bunnyGetVideo` returns `storageSize = 200MB` at ack → job `failed`
  (`source_over_cap`) + delete called.
- Alarm test (logic.ts): `evaluateBalanceForSignal("bunny", {used_percent:72}, {kind:
  "bunny_usage_pct", warn:60, crit:85})` → `{balanceLow:true, severity:"warn"}`; at 90 →
  `crit`.
- Circuit-breaker test: freshest bunny check `used_percent:95` → upload-intent returns 503,
  `bunnyCreateVideo` NOT called.

Tester (adversarial):
- Upload 4 covers in a row to one event; after each supersede, assert the prior Bunny guid is
  gone (GET → 404) — no orphans accumulate.
- Abandon a draft (ack source, never apply); run the reaper; assert the asset is destroyed and
  the job is `reaped_abandoned`.
- Live-fire the alarm: temporarily set `BUNNY_TRAFFIC_CAP_BYTES` low so `used_percent`
  crosses warn; force a probe; confirm a real "Bunny usage high" email lands (headless QA is
  insufficient — live-fire the Resend path per the RPC-gap rule).

---

## 5. PHASE 3 — Native leak-proofing (provider-agnostic; ships on next build/OTA)

These are the Vector A/B/C native fixes; they are provider-neutral and are the true closer of
the bandwidth leak. Pure JS (no native module change) → OTA-deliverable; must reach devices
(the "merged but DARK" trap killed ORCH-1209).

### 5.1 Native "preload none" — `packages/offering-rendering/EventCoverMedia.tsx`

Root cause (Finding A): `useVideoPlayer(uri, …)` at `:380` sources the player on mount →
buffers/downloads before any `play()`. Fix:

- Create the player with NO source: `const player = useVideoPlayer(null, (p) => { p.loop =
  loop; p.muted = muted; p.staysActiveInBackground = false; p.showNowPlayingNotification =
  false; });`.
- A `sourcedRef = useRef(false)`. In the shouldPlay effect (`:425-431`): when `shouldPlay`
  first becomes true and `!sourcedRef.current` → `await player.replaceAsync(uri)` (wrap in
  `callNativeVideoPlayer`), set `sourcedRef.current=true`, then `player.play()`. When
  `shouldPlay` is false → do NOT source; keep showing the poster `<Image>`.
- Keep the poster `<Image>` (already at `:463-469`) so an unsourced/paused card shows the
  thumbnail with ZERO video bytes. `readyToPlay`/`statusChange`/`sourceLoad` listeners stay
  but only fire after `replaceAsync`.
- Web path (`EventCoverWebVideo`, `preload="none"`) is already correct — DO NOT touch.

### 5.2 Discover grid poster-only — `BusinessEventCard.tsx` + `TripCard.tsx`

Pass `autoplay={false} playbackActive={false}` to `<EventCoverMedia>` at
`BusinessEventCard.tsx:137` and `TripCard.tsx:105`. Combined with §5.1 this means the grid
draws the Bunny `thumbnail.jpg` poster and fetches ZERO video bytes until a card is opened —
matching each file's own header contract ("autoplay disabled for the grid").

### 5.3 Native on-device cache honoring the immutable header

Add a small `useCachedCoverVideoUri(remoteUri)` hook (native-only; web returns `remoteUri`):
- Prefer expo-video source-level caching if the installed `expo-video` exposes
  `useCaching`/cached sources; else download-once via `expo-file-system` to
  `cacheDirectory/coverVideos/{sha1(remoteUri)}.mp4` and return the local `uri` once present
  (return `remoteUri` while downloading; never block first paint — the poster covers it).
- Keyed on the URL, so Bunny's immutable `cache-control` is honored across remounts →
  re-opening a detail screen reads from disk, killing the Finding-C re-download.
- Reconsider the three detail screens' always-on `autoplay playbackActive`
  (`ConsumerEventDetailScreen.tsx:782-783`, `ConsumerTripDetailScreen.tsx:888-889`,
  `ConsumerExperienceDetailScreen.tsx:853-854`) — keep autoplay (a detail screen SHOULD play)
  but they now benefit from the disk cache.

### 5.4 Phase 3 DRAFT invariants + tests

Invariant `I-MOR-1270-NO-EAGER-NATIVE-STREAM` — on native, `EventCoverMedia` does NOT set the
video source until `autoplay && playbackActive` is first true. Guard: a render test asserting
`useVideoPlayer` is called with a null source and `replaceAsync` is NOT called while
`playbackActive=false`. (Fixes the ORCH-1209 test that proved the WRONG property — it only
checked `pause()`, never that the source is withheld.)

Implementor test (FAIL ON REVERT): mount `EventCoverMedia mediaType="video" autoplay={false}
playbackActive={false}` → assert `player.replaceAsync` never called; flip to `autoplay
playbackActive` → assert `replaceAsync(uri)` then `play()`.
Tester (adversarial, RUNTIME — instrument, don't theorize): on a physical device with a Metro
proxy / Charles, open Discover with several Bunny video covers in the grid and assert ZERO
`.mp4` GETs until a card is tapped; open a detail screen twice and assert the second open
serves from cache (no second full `.mp4` GET). This is the leak's true regression guard.

---

## 6. PHASE 4 — Retire Cloudinary (only after Phase 1 proven live)

Once `EVENT_COVER_VIDEO_PROVIDER=bunny` is live and a real cover has round-tripped:
- Remove the Cloudinary branch from upload-intent / source-uploaded / webhook / cancel; delete
  `cloudinarySignature`, `cloudinaryDestroy`, `verifyCloudinaryNotificationSignature`,
  `cloudinaryConfigured`, and the `so_0` branch in `deriveCoverPosterUrl`.
- Client: delete `sanitizeProviderUploadResponse`, `EventCoverVideoProviderUploadResponse`,
  the chunked/`Content-Range` path, `resource_type` strips, `cloudinaryUploadFailureDetail`,
  and the `"cloudinary"` union member.
- Health probe: delete `probeCloudinary` + the `cloudinary` registry entry + the
  `cloudinary_used_pct` case (or leave the `cloudinary` service row `unknown`/archived).
- Remove `CLOUDINARY_*` secrets from the Supabase project; remove the `transloadit` provider
  CHECK value if desired.
- Simplify `EVENT_COVER_VIDEO_PROVIDER` to default `bunny`.
Guard: strict-grep CI rule that fails if `api.cloudinary.com` or `CLOUDINARY_` reappears in
`supabase/functions/**` or `mingla-business/**` after Phase 4.

---

## 7. Credentials & console settings Seth must provide/enable BEFORE live testing

Bunny console (create a **Stream Video Library** first):
1. **`BUNNY_STREAM_LIBRARY_ID`** — the Stream library numeric ID.
2. **`BUNNY_STREAM_API_KEY`** — the Stream library API key (create/upload-presign/get/delete).
3. **`BUNNY_STREAM_CDN_HOSTNAME`** — the library's pull-zone CDN host (e.g.
   `vz-xxxxxxxx-xxx.b-cdn.net`).
4. **`BUNNY_STREAM_WEBHOOK_KEY`** — the library **read-only** API key (HMAC webhook signing
   secret).
5. **`BUNNY_ACCOUNT_API_KEY`** — the ACCOUNT-level API key (for `api.bunny.net/videolibrary`
   usage read). Distinct from the library key.
6. **Enable "MP4 Fallback"** on the library (Stream → library → Encoding) — REQUIRED, else
   `play_720p.mp4` 404s. Cap the resolution ladder at 720p.
7. **Set the connected pull zone Tier = Volume** (cheap African egress) on the library's pull
   zone.
8. **Set the library Webhook URL** to
   `https://<prod-project>.functions.supabase.co/functions/v1/event-cover-video-webhook`
   (library-level, one time).
9. Decide caps: **`BUNNY_STORAGE_CAP_BYTES`** + **`BUNNY_TRAFFIC_CAP_BYTES`** (the monthly
   numbers the alarm % is measured against, e.g. a self-imposed 50 GB traffic budget).

Confirm the alert plumbing is live on prod (Vector D): `RESEND_API_KEY` non-sandbox with a
verified sender, `API_HEALTH_ALERT_EMAILS` includes `seth@usemingla.com`, cron
`orch_1201_api_health_probe` scheduled, vault `supabase_url`+`service_role_key` present.

Everything above is set as **Supabase project secrets on LIVE prod
`gqnoajqerqhnvulmnyvv`** (project-scoped → covers all edge fns at once). No client app build
is required to CUT OVER (no cloud/host literal in shipped client code); Phase 3 native
leak-proofing DOES need an OTA / build to reach devices.

---

## 8. Cutover order (guardrails BEFORE the flip)

1. Merge Phase 1 (Bunny branch, dark — env still `cloudinary`). Deploy edge fns.
2. Merge Phase 2 (reaper cron, real byte cap, `probeBunny` + `bunny` health seed, circuit
   breaker). Deploy. Seed the caps; force one probe; confirm a numeric `bunny` `used_percent`
   row and that the alert path can send.
3. Set the Bunny secrets (§7 items 1–5, 9) on prod; enable MP4 Fallback + Volume tier + the
   library webhook URL (§7 items 6–8).
4. **Flip `EVENT_COVER_VIDEO_PROVIDER=bunny`** on prod; redeploy the four edge fns
   (`event-cover-video-upload-intent`, `-source-uploaded`, `-webhook`, `-cancel`) +
   `api-health-probe` + the reaper. Verify with one live upload-intent (returns the tus
   endpoint) and one real cover round-trip on a test brand.
5. Ship Phase 3 native leak-proofing via OTA / next build; verify on a physical device that
   the grid fetches zero `.mp4` bytes until tap.
6. After a real cover is proven live, execute Phase 4 (remove Cloudinary) and drop the
   `CLOUDINARY_*` secrets.

**No data migration** at any step: 0 live videos + dead Cloudinary = nothing to move; new
uploads land on Bunny and self-heal.
