# META-ORCH-1270 — Vector C: Cloudinary UPLOAD / STORAGE Static Audit

Read-only forensic audit. No code changed. Account `dhza7d54o` (FREE, 25 credits/mo) was deleted twice for over-usage. ORCH-1209 fixed web-video *bandwidth* only; the ingest + retention pipeline was never audited. This report proves the storage-leak vectors.

## Scope note — where Cloudinary storage actually comes from

The ONLY code path that uploads bytes into Cloudinary is the event/brand **cover-video** pipeline. Verified by grepping the whole repo for `api.cloudinary.com`, `/upload`, `image/upload`, `raw/upload`, `upload_preset`:

- Images / GIFs covers → Supabase Storage buckets `event_covers` / `brand_covers`, NOT Cloudinary (`mingla-business/src/services/eventCoverMediaService.ts:20`, `brandCoverService.ts:37`).
- Pexels covers → proxied and served from the Pexels CDN; nothing is copied into Cloudinary (`supabase/functions/event-cover-pexels-curated/index.ts`, `event-cover-pexels-search/index.ts` — proxy only).
- No backfill / seed / place-photo job uploads to Cloudinary (Q6 below).

So every stored Cloudinary byte is a cover-video raw source and/or its eager MP4 derivative. The pipeline files are: `event-cover-video-upload-intent`, `event-cover-video-source-uploaded`, `event-cover-video-webhook`, `event-cover-video-apply`, `event-cover-video-cancel`, shared `_shared/eventCoverVideo.ts`, client `eventCoverVideoProcessingService.ts`.

---

## Q1 — SIGNED or UNSIGNED uploads? → SIGNED (good; not an open preset)

Uploads are **signed**. There is NO `upload_preset` anywhere in the repo, and no unsigned preset.

- Signature computed server-side (SHA-1 of sorted params + `CLOUDINARY_API_SECRET`): `_shared/eventCoverVideo.ts:266-274`.
- The intent signs `context, eager, eager_async, eager_notification_url, public_id, timestamp`, then returns `api_key`, `signature`, `timestamp` in the upload fields: `event-cover-video-upload-intent/index.ts:330-340, 365-387`.
- Every intent is gated: `requireUserId` (`_shared/eventCoverVideo.ts:126-159`) plus `requireEventManager` / `requireBrandCoverManager` role checks (`index.ts:204-224`).

**Verdict:** an anonymous attacker cannot mint uploads, and cannot forge the `public_id` (it is signed). This is the correct pattern. Residual risk is only from *authenticated brand members* (see Q2) — not the open-preset catastrophe.

---

## Q2 — Server-side SIZE / DURATION caps? → NO real cap on the stored raw source (HIGH)

The "caps" in `upload-intent` validate the **client-declared** numbers in the JSON body, not the bytes actually uploaded to Cloudinary:

- `sourceBytes` (client-declared) checked vs `MAX_SOURCE_VIDEO_BYTES` = 100 MB — `upload-intent/index.ts:138,146-152`; constant `_shared/eventCoverVideo.ts:23-26`.
- `sourceDurationMs` (client-declared) checked vs 60 s / 33 s ceiling — `index.ts:153-176`.

None of these values are bound into the Cloudinary signature, and Cloudinary does not enforce a max file size from a signed param here. The signature only pins `public_id`/`eager`/`context`. **A client can declare `sourceBytes: 1000000` in the intent, receive a valid signature, and then POST a 5 GB file to that signed `public_id`.** The declared size and the real upload are fully decoupled.

The `du_<seconds>` + `br_` + `c_limit,w_1280,h_720` eager transform caps only the **derived** MP4 (`index.ts:309-321`), and the webhook re-validates the derivative vs `FINAL_MAX_BYTES` (26 MB) via `assertProcessedDerivative` (`_shared/eventCoverVideo.ts:436-449`). But the **raw source** that Cloudinary stores is whatever the client actually sent — unbounded.

Critically, the real byte count IS known server-side and is thrown away: `event-cover-video-source-uploaded/index.ts:132-140` receives `providerUploadResponse.bytes` and writes it to the job, but never compares it to `MAX_SOURCE_VIDEO_BYTES` and never destroys an oversize asset.

Client-side compression is advisory only and skipped under 5 MB (`eventCoverVideoProcessingService.ts:427`); it runs on-device and is trivially bypassed by hitting the signed URL directly.

**Fix:** In `event-cover-video-source-uploaded`, if `providerUploadResponse.bytes > MAX_SOURCE_VIDEO_BYTES`, call `cloudinaryDestroy(public_id)` and fail the job. Additionally set the Cloudinary account-level "max video file size" as a hard backstop, and (optionally) reject when reported `duration` exceeds the source ceiling.

---

## Q3 — CLEANUP on delete / replace / cancel / abandon? → destroy runs in ONE path only (CRITICAL, primary leak)

`cloudinaryDestroy` (`_shared/eventCoverVideo.ts:276-324`, uses `resource_type=video`) is invoked in exactly **one** place: the explicit user-cancel handler `event-cover-video-cancel/index.ts:94-104`. Every other termination path orphans the stored bytes forever:

1. **Supersede / re-upload (retry) — NOT cleaned.** A new intent marks all prior active jobs `cancelled` in the DB but never calls destroy: `upload-intent/index.ts:234-260`. Each superseded job's raw source (+ its eager derivative) is orphaned. A user who re-picks a cover N times leaves N raw sources in storage.
2. **Job failure — NOT cleaned.** The webhook sets `status='failed'` on provider error or bad derivative but never destroys the already-uploaded source: `event-cover-video-webhook/index.ts:163-176, 214-225`.
3. **Cover REPLACE — NOT cleaned.** Applying a new cover overwrites `events.cover_media_url` / `brands.cover_media_url` (`event-cover-video-apply/index.ts:55-84`; auto-apply `webhook/index.ts:246-275`) with no lookup or destroy of the previously-applied job's Cloudinary asset. Old asset orphaned on every replace.
4. **Draft abandoned — NOT cleaned.** If the user uploads a source then closes the app without applying or cancelling, the job sits at `source_uploaded`/`ready` with its bytes retained indefinitely. There is no TTL/reaper.
5. **Event / brand / user delete — NOT cleaned.** No delete path destroys cover-video assets; `delete-user/index.ts` only nulls/deletes DB rows (`:167` comment). Soft-deleting an event leaves its cover assets in Cloudinary.
6. **No scheduled reaper.** No cron/scheduled function destroys assets for `cancelled`/`failed`/superseded/abandoned jobs. Confirmed: the only functions touching `event_cover_video_jobs` are the interactive edge functions; no migration schedules a Cloudinary cleanup.

**Structural cost even on the happy path:** the eager derivative shares the source's `public_id` (URL `.../video/upload/<transform>/event-covers/raw/<brand>/<event>/<jobId>.mp4`), so destroying the source would kill the served derivative. Therefore every *applied* cover permanently stores **raw source (up to 100 MB+) + derivative (~25 MB)**. The raw source is dead weight that is never reclaimed.

**Magnitude:** this is the dominant leak. On a 25 GB free plan, ~250 applied covers at ~100 MB raw each exhaust storage — before counting orphaned supersede/failure/replace/abandon assets, which accumulate with no ceiling.

**Fix:**
- Add a reaper (pg_cron → edge fn) that destroys the source `public_id` for jobs in `{cancelled, failed}` and for superseded jobs, and for `source_uploaded`/`ready` jobs older than ~24 h that were never applied.
- On supersede in `upload-intent`, destroy the prior job's `source_public_id` before/after cancelling it in the DB.
- On replace/apply, look up the prior applied job for that event/brand and destroy its asset.
- To reclaim the raw-source dead weight: re-host the derivative as an independent asset (e.g. `event-covers/final/...`) and destroy the `raw/` source after apply.

---

## Q4 — EAGER transforms / derived assets → yes, +1 stored derivative per upload (MEDIUM)

`upload-intent/index.ts:313-321` requests an eager transform with `eager_async:"true"` (`index.ts:336, 379`). Cloudinary stores the derived MP4 in addition to the raw source, so each upload consumes storage for **source + 1 derivative** (~2× the derivative size, plus the oversized raw). Only one eager is requested, so the multiplier is bounded at 2×, but it compounds directly with the no-cleanup findings in Q3. The eager is required to produce the browser-safe MP4, so it can't simply be disabled — the lever is destroying the raw source after the derivative is re-hosted (Q3 fix).

---

## Q5 — RETRY / DUPLICATE stored copies? → yes, every attempt is a new asset (HIGH)

`public_id` is keyed on a fresh per-intent `job.id` UUID: `upload-intent/index.ts:305-308`. There is **no `overwrite`, no `invalidate`, no `unique_filename`, no stable dedupe key** (grep confirms none in the intent). Consequences:

- Each retry / re-pick creates a new intent → new `job.id` → new `public_id` → a brand-new stored asset. Combined with "supersede does not destroy" (Q3.1), flaky-network retries pile up distinct orphaned sources.
- Within a single upload, chunked web uploads DO dedupe via `X-Unique-Upload-Id: jobId` (`eventCoverVideoProcessingService.ts:559`), so chunk-level duplication is avoided — but cross-attempt duplication is not.

**Fix:** destroy-on-supersede (Q3), and/or reuse a stable `public_id` per (event|brand) target with `overwrite:true` + `invalidate:true` so retries overwrite rather than accumulate.

---

## Q6 — BACKFILL / batch mass-upload to Cloudinary? → none found (GOOD; hypothesis ruled out)

No seeding/backfill/place-photo job uploads to Cloudinary. Photo backfill uses Google (per project memory), Pexels covers are CDN-proxied (not stored), and the only `api.cloudinary.com/.../upload` writer is the interactive per-user cover-video intent. The thumbnail cron migrations (`orch_1043`/`orch_1044`) operate on Supabase Storage, not Cloudinary. There is no gigabytes-at-once ingest vector.

---

## Priority ranking of storage-leak findings

1. **CRITICAL — No destroy on supersede/failure/replace/abandon + no reaper (Q3).** Orphaned raw sources accumulate with no ceiling; applied covers permanently retain 100 MB+ raw dead weight. This is what blows the plan.
2. **HIGH — No real server-side byte cap on the stored source (Q2).** An authenticated brand member can store an arbitrarily large raw file despite the "100 MB" declared cap; actual bytes are known at ack time but never enforced.
3. **HIGH — Every retry is a new stored asset, no dedupe (Q5).** Compounds Q3.
4. **MEDIUM — Eager derivative doubles per-upload storage (Q4).** Required for playback; reclaim via re-host + destroy raw.
