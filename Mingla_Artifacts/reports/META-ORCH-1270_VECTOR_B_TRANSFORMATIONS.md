# META-ORCH-1270 — Vector B: Cloudinary TRANSFORMATIONS (static audit)

Read-only forensic audit. No code changed. Scope: every place the code CONSTRUCTS or
MUTATES a Cloudinary transformation URL, judged for transformation-count and
derived-storage cost.

## Bottom line (layman)

The transformation *count* surface is tiny and disciplined. There is NO code anywhere
that builds a fresh, per-render, per-viewport, per-device, or cache-busted Cloudinary
transform URL — the classic "new derived asset every page load" leak the audit feared
does **not** exist. Every Cloudinary transform URL in the repo is static and
deterministic, so Cloudinary caches each derived asset after the first hit.

The real credit drain hiding in this vector is **stored bytes, not transform count**:
every cover-video upload permanently leaves its full-size RAW source (up to 25 MB) plus
its processed derivative in Cloudinary, and re-uploads (supersede) pile up more — with NO
cleanup on the success path, on supersede, or on event/brand deletion. That is what
quietly eats storage credits (1 credit = 1 GB stored). The 2026-06-22 prod DB wipe did
NOT remove any of these Cloudinary assets — they are orphaned and still billed.

## Complete Cloudinary integration map

Grep for `CLOUDINARY_`, `res.cloudinary`, `/video/upload/`, `/image/upload/` across the
whole repo (excluding node_modules/tests/Mingla_Artifacts) proves Cloudinary is used in
exactly ONE feature — the event/brand cover-video pipeline:

- `supabase/functions/event-cover-video-upload-intent/index.ts` — signs the upload, sets the eager transform.
- `supabase/functions/event-cover-video-webhook/index.ts` — receives the eager derivative, stores its URL.
- `supabase/functions/_shared/eventCoverVideo.ts` — signature + `cloudinaryDestroy`.
- `supabase/functions/event-cover-video-cancel/index.ts` — the ONLY caller of `cloudinaryDestroy`.
- `supabase/functions/api-health-probe/index.ts` — usage monitoring only (no transforms).
- `packages/offering-rendering/coverMediaPresentation.ts` — `deriveCoverPosterUrl` (`so_0` poster).
- `app-mobile/src/utils/venueExperienceMapping.ts` — `posterFor` (`so_0` poster, duplicate logic).

Place photos, avatars, thumbnails, marketing hero images are NOT on Cloudinary — they use
Supabase Storage object thumbnails / Google `lh3` CDN (`supabase/functions/_shared/imageCollage.ts`),
so they contribute ZERO Cloudinary transformations. The `eager` hits in `mingla-marketing`
are Next.js `<Image loading="eager">` attributes, unrelated to Cloudinary.

## Findings, ranked by cost magnitude

### F1 — Raw source + derivative never reaped (STORAGE credit drain) — HIGH

Files:
- `supabase/functions/event-cover-video-webhook/index.ts:246-275` (success path)
- `supabase/functions/event-cover-video-upload-intent/index.ts:234-260` (supersede path)
- `supabase/functions/event-cover-video-cancel/index.ts:96` (only `cloudinaryDestroy` call site)

When a cover video is uploaded, Cloudinary stores BOTH the original raw upload (at
`public_id`, e.g. `event-covers/raw/<brand>/<event>/<jobId>`, up to `MAX_SOURCE_VIDEO_BYTES`)
AND the async eager derivative. The webhook success path (line 251) writes
`cover_media_url = derivative.url` and returns — it never destroys the raw source.

`cloudinaryDestroy` is reachable ONLY through `event-cover-video-cancel`, which fires only
when a user explicitly cancels an in-flight upload. The two paths that dominate real usage
never call it:

1. **Success**: raw source (≤25 MB) stays forever alongside the derivative.
2. **Supersede** (a re-upload replacing an active job): upload-intent lines 234-260 only run
   a DB `UPDATE ... status='cancelled', failure_code='superseded'`. No `cloudinaryDestroy`.
   So every re-upload of the same cover strands another raw source (+ any eager it produced).

There is also no Cloudinary cleanup when an event or brand is deleted (the webhook only
guards `.is("deleted_at", null)` — soft delete). The 2026-06-22 prod DB wipe therefore
orphaned every previously uploaded cover's Cloudinary assets while leaving them billed.

Cost: ~25-30 MB stored per successful upload, plus ~25 MB per superseded re-upload, growing
monotonically. At 1 credit = 1 GB, a few hundred uploads/re-uploads across testing + churn
crosses the 25-credit ceiling. Static-or-varying: N/A (it is retained bytes, not a transform).

Fix:
- In the webhook success path, after the derivative is confirmed `ready`, call
  `cloudinaryDestroy(source_public_id)` to drop the raw original (keep the derivative that
  `cover_media_url` points to). Cloudinary keeps the derivative because it is served from the
  eager URL, not from the raw `public_id`; verify with one probe before shipping.
- In the upload-intent supersede loop, call `cloudinaryDestroy` for each superseded job's
  `source_public_id` (and its derivative) before/after the DB status flip.
- Add a delete-time reaper: when an event/brand cover is replaced or the row is deleted,
  destroy the associated Cloudinary public_id.

### F2 — `so_0` poster derivation — STATIC / cached / bounded — LOW

Files:
- `packages/offering-rendering/coverMediaPresentation.ts:63-79` (`deriveCoverPosterUrl`, `so_0` injected at line 78)
- `app-mobile/src/utils/venueExperienceMapping.ts:43-54` (`posterFor`, `so_0` injected at line 50)
- Call site: `packages/offering-rendering/EventCoverMedia.tsx:633-636`

Both helpers rewrite `/video/upload/` → `/video/upload/so_0/` and swap the extension to
`.jpg`, producing a first-frame poster. The transform string is a fixed literal (`so_0`),
the query string is stripped (coverMediaPresentation.ts:73-74; venueExperienceMapping.ts
regex `(\?.*)?`), and the input `cover_media_url` is immutable once stored. The output URL
is therefore deterministic per cover video — identical across every render and every surface
(brand page, app deck, venue sheet). Cloudinary derives the JPEG once (first view) and serves
the cached derivative thereafter.

Verdict: STATIC, not per-render-varying. Cost = 1 poster derivative per UNIQUE cover video,
ever. Note the poster URL chains `so_0` on top of the eager transform already baked into
`cover_media_url` (`.../video/upload/so_0/<eager-chain>/<id>.jpg`); Cloudinary may bill the
chained derivation as ~2 transformation units on that single first hit — still bounded per
cover, negligible at fleet scale.

Micro-nit (no Cloudinary cost): `deriveCoverPosterUrl` is called in the render body at
EventCoverMedia.tsx:635 with no `useMemo`, so it re-runs every render. Because the output
string is stable, this triggers NO new derivation — it is pure CPU (a few string ops).
Optional memoization only; not a credit issue.

The two implementations (`deriveCoverPosterUrl` vs `posterFor`) produce byte-identical URLs
for the same input, so there is no divergence multiplier (they hit the same cached derivative).

### F3 — Eager upload transform — 1 per upload, upload-time — LOW/MEDIUM

File: `supabase/functions/event-cover-video-upload-intent/index.ts:313-321`

```
c_limit,w_1280,h_720 , du_<sec> , vc_h264 , ac_aac , br_<kbps>k , f_mp4 , q_auto:good
```

This is a SINGLE comma-joined transform string (one derivative), sent with `eager_async:true`
— NOT an array of multiple eager transforms, so it does not multiply. It runs once per upload
at upload time. `du_<sec>` and `br_<kbps>` vary per upload (duration/bitrate), so each upload's
eager URL is unique, but that is bounded by the number of uploads, not by renders or views.

Verdict: STATIC per job, bounded by upload count. Produces exactly 1 derived (delivered) mp4
plus derived storage. Correct pattern (fixed 1280×720 cap, `q_auto:good`). The only concern is
that this derivative's stored bytes fall under the F1 non-reaping problem.

### F4 — Negative finding (verified absent) — the expensive pattern does NOT exist

Grepped the whole repo for dynamic transform interpolation and cache-busting on Cloudinary
URLs: `w_${...}`, `h_${...}`, `dpr_${...}`, `dpr_auto`, `w_auto`, device-dimension sizing,
per-user/per-timestamp query cache-busters, `c_fill`/`c_scale`/`c_thumb`/`g_auto`/`e_*` image
transforms. NONE are constructed against Cloudinary URLs anywhere in app-mobile, mingla-business,
mingla-marketing, mingla-admin, or the edge functions. No unsigned upload presets, no
multi-transform eager arrays. This is the good news: the transformation-COUNT vector cannot
silently 1000× because no code path generates viewport/device/time-varying derived assets.

## Conclusion

For Vector B, the transformation-COUNT surface is bounded to ~2 derivations per unique cover
video (1 eager at upload + 1 `so_0` poster on first view), all static and cache-friendly — it
is almost certainly NOT what blew the 25-credit ceiling. The actionable leak within this
vector's scope is F1: unreaped raw sources + derivatives accumulating in Cloudinary STORAGE
with no lifecycle cleanup on success, supersede, or delete. That must be fixed (destroy raw
source on webhook success; destroy on supersede; reap on cover replace/delete) before the new
API key is handed over. F2/F3 need no cost change; F2 optional memoization is cosmetic.
