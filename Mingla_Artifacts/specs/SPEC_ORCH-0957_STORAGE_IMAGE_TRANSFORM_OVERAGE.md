# SPEC — ORCH-0957 [Storage image transformation overage] — Tier B

**Mode:** SPEC (binding contract for implementor)
**Investigation reference:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-0957_STORAGE_IMAGE_TRANSFORM_OVERAGE.md`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]`
**Branch:** `0957-storage-image-transform-overage`
**Fix tier:** B — pre-generate thumbnail variants at ingest time, store in parallel path inside `place-photos` bucket, point collage pipeline at thumbs via the non-metered object endpoint.

---

## 1. Goal (plain English)

Stop paying Supabase per-image transformation fees on the place-intelligence collage pipeline by generating a 384×384 JPEG thumbnail next to each original place photo at ingest time, then teaching the collage helper to read the pre-sized thumbnail directly instead of asking Supabase to resize the original on every fetch. Backfill the 88,133 existing photos without touching the metered transform endpoint.

## 2. Scope and non-goals

### Scope

1. New ingest-time thumbnail generation inside `_shared/photoStorageService.ts` `downloadAndStorePhotos`.
2. Modified URL rewriter in `_shared/imageCollage.ts` `transformPhotoUrlForTile` Pattern 1 to point at the thumbnail path via the non-metered object endpoint.
3. New admin-driven backfill edge function `backfill-place-photo-thumbs` modeled on the existing `backfill-place-photos` harness.
4. New `place_pool.thumbs_backfilled_at TIMESTAMPTZ NULL` column for backfill resumability tracking.
5. Updated unit tests for both modified files.
6. Updated regression test that locks in the cost-control behaviour.

### Non-goals (explicit)

- **Tier D (stop mirroring Google photos):** OUT of scope per operator decision 2026-05-25. Keep the mirror as today.
- **Google CDN `lh3.googleusercontent.com` Pattern 2:** NO change. Pattern 2 already costs $0 and stays as-is.
- **Backfill UI:** the new backfill function exposes the same action vocabulary as `backfill-place-photos` (`preview_run`, `create_run`, `run_next_batch`, `run_status`, `pause/resume/cancel/retry/skip`). Adding a dedicated admin-dashboard screen is out of scope; admins can invoke via the existing run-management UI by passing the new function name OR via a one-line curl while orchestrator-monitored. If a dashboard screen is needed later, register a follow-up ORCH.
- **Other Supabase meters** (Storage egress, Edge Function invocations, Realtime, DB egress): OUT of scope. Investigation §10 caveat noted.
- **`MAX_PHOTOS = 5` vs `MAX_PHOTOS = 16`** cardinality discrepancy between `photoStorageService.ts` (5) and `imageCollage.ts` (16): NOT addressed here. Existing places have up to 9 photos in storage per the investigation DB probe, so this is latent but not blocking. Flag as discovery.
- **Migration of historical 2,327 collages in `place-collages` bucket:** OUT of scope. Those collages are already encoded PNGs and not re-transformed; they bill nothing on this meter.

### Assumptions

1. `deno.land/x/imagescript@1.2.17` (already used by `imageCollage.ts`) is the resize library. No new dependency.
2. JPEG output at quality 80 produces ~12 KB thumbnails at 384×384 (consistent with the Supabase render endpoint's observed 10.7 KB at 192×192 per ORCH-0737 v6 telemetry).
3. The Google-Places-Media-API source photos arrive at `maxWidthPx=800` per `photoStorageService.ts:67` — small enough that single-photo decode peaks well under 256 MB edge function memory limit (the ORCH-0737 v6 OOM was triggered by the *outer* parallel-12 prep loop, not single-photo decode).
4. Backfill can run during normal operating hours; no maintenance window required.
5. Operator's Pro-plan billing cycle starts on the same day each month (2026-05-06 → 2026-06-06 in this cycle); the cost-control SC-5 verification window is calibrated to "7 days into the cycle following deploy + backfill complete."

## 2.5 Cross-Surface Impact

| Surface | In scope? | Why / what changes |
|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | NO | Does not read or write `place-photos`; collages are server-side artifacts consumed only by Claude vision. |
| Consumer Android (`app-mobile/` on Android) | NO | Same as iOS. |
| Buyer/anonymous Web (`mingla-business/` buyer routes) | NO | Same — no client touches `place-photos`. |
| Business iOS (`mingla-business/` on iOS) | NO | Same. |
| Business Android (`mingla-business/` on Android) | NO | Same. |
| Admin Web (`mingla-admin/`) | NO | Admins drive backfill via existing run-management surface (same as `backfill-place-photos`); no new screen required by this spec. Register a follow-up ORCH if a dedicated UI is wanted. |
| Business Web preview | NO | Same. |
| **Supabase backend** (edge functions + DB + Storage) | **YES** | All work happens here: 2 edge functions modified (`_shared/photoStorageService.ts`, `_shared/imageCollage.ts` ripple to `run-place-intelligence-trial` redeploy), 1 new edge function (`backfill-place-photo-thumbs`), 1 migration (`place_pool.thumbs_backfilled_at`). |

**Affected Surfaces:** `backend-only — no client surface` (per the ORCH INTAKE rule for backend-only ORCHs).

Parity verification at TEST: not applicable across client surfaces. Tester verifies the single backend surface only.

## 3. Layer-by-layer specification

### 3.1 Database layer

**Migration:** `supabase/migrations/YYYYMMDDHHMMSS_orch_0957_place_pool_thumbs_backfilled_at.sql`

Implementor: at commit time, regenerate the filename timestamp prefix to the latest available number, AND check active per-ORCH worktrees under `~/Desktop/mingla-orchs/*/supabase/migrations/` for any later or equal prefixes to avoid parallel-ORCH collision (per orchestrator's invariant migration-filename rule, codified 2026-05-24).

```sql
-- ORCH-0957: track thumbnail backfill completion per place.
-- NULL = thumbs not yet generated. NON-NULL = thumbs present in storage.
ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS thumbs_backfilled_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS place_pool_thumbs_backfill_pending_idx
  ON public.place_pool (id)
  WHERE thumbs_backfilled_at IS NULL
    AND stored_photo_urls IS NOT NULL
    AND array_length(stored_photo_urls, 1) > 0;

COMMENT ON COLUMN public.place_pool.thumbs_backfilled_at IS
  'ORCH-0957: when backfill-place-photo-thumbs generated 384x384 thumbs for this place. NULL = pending or NEW place (set to NOW() by downloadAndStorePhotos when thumbs are written inline at ingest).';
```

**Pre-flight data probe (implementor MUST run before db push, per orchestrator''s invariant migration backstop):**

```bash
# Confirm column does not already exist (the IF NOT EXISTS is defensive but not load-bearing).
SUPABASE_TOKEN=$(grep -oE 'sbp_[A-Za-z0-9]+' ~/.claude.json | head -1)
curl -s -X POST "https://api.supabase.com/v1/projects/gqnoajqerqhnvulmnyvv/database/query" \
  -H "Authorization: Bearer $SUPABASE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\":\"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='place_pool' AND column_name='thumbs_backfilled_at'\"}"
```

Expected: `[]` (empty). If non-empty, halt and reconcile with operator before push.

**RLS:** No new RLS needed. `thumbs_backfilled_at` inherits existing `place_pool` policies (admin read/write, service-role full access).

### 3.2 Storage layer

**Bucket:** REUSE existing `place-photos` bucket. Do NOT create a new bucket.

**Path convention:**

- Original: `place-photos/<safePlaceId>/<index>.<ext>` (unchanged from today)
- Thumb: `place-photos/<safePlaceId>/<index>_thumb.jpg` (NEW; always `.jpg` regardless of original ext)

Rationale for `.jpg` always: imagescript encodes JPEG with quality control, keeping thumb size bounded ~12 KB. PNG encoding produces larger files (~40 KB at 384×384) and there's no transparency requirement for thumbs.

**Storage policies:** Inherit existing `place-photos` bucket policies. Thumbs share the public-read + service-role-write contract.

### 3.3 Edge function: `_shared/photoStorageService.ts` (modified)

**File:** `supabase/functions/_shared/photoStorageService.ts`

**Change site:** Inside the `for` loop of `downloadAndStorePhotos`, immediately AFTER the successful original upload (current line 104, after `const { error: uploadError }`), BEFORE the `getPublicUrl` call (current line 112).

**New behaviour (pseudocode):**

```ts
// ORCH-0957: generate 384×384 JPEG thumbnail alongside the original.
// Thumbs are served via the non-metered /storage/v1/object/public/ endpoint
// by the collage pipeline, eliminating Supabase Image Transformations billing.
const thumbPath = `${safePlaceId}/${i}_thumb.jpg`;
try {
  const decoded = await decode(new Uint8Array(imageData));
  if (decoded instanceof Image) {
    decoded.resize(THUMB_SIZE, THUMB_SIZE);                    // 384
    const thumbBytes = await decoded.encodeJPEG(THUMB_JPEG_QUALITY); // 80
    const { error: thumbUploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(thumbPath, thumbBytes, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '31536000',
      });
    if (thumbUploadError) {
      console.warn(`[photo-storage] Thumb upload failed for ${thumbPath}:`, thumbUploadError.message);
      // NON-FATAL: original is already up; collage pipeline falls back to transform endpoint.
    }
  } else {
    console.warn(`[photo-storage] Decoded as non-Image (GIF?) for ${storagePath} — thumb skipped`);
  }
} catch (thumbErr) {
  console.warn(`[photo-storage] Thumb generation failed for ${storagePath}:`,
    thumbErr instanceof Error ? thumbErr.message : String(thumbErr));
  // NON-FATAL: skip the thumb; collage pipeline falls back to transform endpoint until backfill catches up.
}
```

**New imports:**
```ts
import { Image, decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
```

**New constants (file-level):**
```ts
const THUMB_SIZE = 384;
const THUMB_JPEG_QUALITY = 80;
```

**`thumbs_backfilled_at` write:** AFTER the inner photo loop completes successfully (when `storedUrls.length > 0`), in the same `update({ stored_photo_urls: storedUrls })` call at current line 140, ALSO set:

```ts
.update({ stored_photo_urls: storedUrls, thumbs_backfilled_at: new Date().toISOString() })
```

Rationale: NEW places get thumbs written inline at ingest time, so they're "born backfilled."

**Error contract:** Thumb generation is **always non-fatal**. The original photo upload succeeds first; thumb is best-effort. The collage pipeline tolerates missing thumbs (see §3.4 fallback).

**Memory contract:** Single decode + resize + encode per photo, executed serially within the existing `for` loop (no new parallelism). Peak memory per photo: ~5 MB (decoded buffer at original 800px × 4 bytes + resized 384×384 buffer + encoded JPEG). Stays well under 256 MB edge function limit.

### 3.4 Edge function: `_shared/imageCollage.ts` (modified)

**File:** `supabase/functions/_shared/imageCollage.ts`

**Change site:** `transformPhotoUrlForTile` Pattern 1 block (current lines 74-86).

**New behaviour:**

```ts
// Pattern 1 — Supabase Storage public object URL.
// ORCH-0957: rewrite to pre-generated thumbnail (non-metered object endpoint).
// Thumbs are 384×384 JPEG written at ingest by photoStorageService.downloadAndStorePhotos
// or backfilled by backfill-place-photo-thumbs. The collage pipeline accepts any
// thumbnail size >= tileSize (imagescript.resize() handles down-scaling at line 169).
//
// Backward compatibility during backfill window:
//   USE_PLACE_PHOTO_THUMBS=true       → rewrite to _thumb.jpg via object endpoint (non-metered)
//   USE_PLACE_PHOTO_THUMBS=false       → legacy /render/image transform endpoint (metered)
//   USE_PLACE_PHOTO_THUMBS unset      → defaults to TRUE (post-deploy default)
//
// Kill-switch DISABLE_PHOTO_URL_TRANSFORM=true (predates ORCH-0957) takes priority
// and bypasses BOTH transforms, returning the original URL.
const supabaseObjectPrefix = "/storage/v1/object/public/";
if (url.includes(supabaseObjectPrefix)) {
  const useThumbsFlag = Deno.env.get("USE_PLACE_PHOTO_THUMBS");
  const useThumbs = useThumbsFlag === undefined ? true : useThumbsFlag === "true";

  if (useThumbs) {
    // Rewrite /place-photos/<dir>/<i>.<ext> → /place-photos/<dir>/<i>_thumb.jpg
    // Strip any query string first, then swap extension on the basename.
    const [base] = url.split("?");
    const lastSlash = base.lastIndexOf("/");
    const dirPart = base.slice(0, lastSlash + 1);
    const basename = base.slice(lastSlash + 1);
    const dotIdx = basename.lastIndexOf(".");
    const stem = dotIdx > 0 ? basename.slice(0, dotIdx) : basename;
    return `${dirPart}${stem}_thumb.jpg`;
  }

  // Legacy path (set USE_PLACE_PHOTO_THUMBS=false to revert post-deploy if needed).
  const transformedPath = url.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/",
  );
  const [base] = transformedPath.split("?");
  return `${base}?width=${tileSize}&height=${tileSize}&resize=cover`;
}
```

**Fallback behaviour:** `fetchAndDecode` (current lines 109-130) already returns `null` on fetch failure with a `console.warn`. If a place's thumb is missing (backfill incomplete + new-ingest path failed), the fetch returns 404, that cell becomes a black tile in the collage, and the pipeline proceeds. This is the same graceful-degradation contract that already exists for Google CDN fetch failures.

**Backfill-window safety:** During the ~24-hour backfill window, places whose thumbs haven't been generated yet will produce 404s on thumb fetches → cells go black. Two mitigations:

1. **The kill-switch path is preserved.** Operator can set `USE_PLACE_PHOTO_THUMBS=false` to revert ALL Supabase reads to the legacy transform endpoint until backfill completes.
2. **Smarter fallback (preferred):** the implementor MAY (not MUST) add a per-fetch fallback inside `fetchAndDecode` — if the thumb fetch returns 404, retry once with the legacy transform URL. This avoids black cells during backfill at the cost of paying for transforms on un-backfilled places. RECOMMENDED for production rollout; gate via env var `THUMB_404_FALLBACK_TO_TRANSFORM=true` (default true).

**Constants:** No tile-size change. `TARGET_SIZE = 768`, `MAX_PHOTOS = 16` unchanged.

### 3.5 Edge function: `backfill-place-photo-thumbs` (NEW)

**File:** `supabase/functions/backfill-place-photo-thumbs/index.ts`

**Modeled on:** `supabase/functions/backfill-place-photos/index.ts` (admin-auth + action vocabulary + batch run state).

**Action vocabulary:** SAME shape as `backfill-place-photos`:
- `preview_run` — count places with `thumbs_backfilled_at IS NULL AND stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0`
- `create_run` — create a `backfill_runs` row (reuse existing table if present; if it's specific to `backfill-place-photos`, create a parallel `thumb_backfill_runs` table; implementor decides based on existing schema)
- `run_next_batch` — process N places per batch (default 25; configurable via body param)
- `run_status` — return progress + remaining count + estimated completion time
- `pause_run` / `resume_run` / `cancel_run`
- `retry_batch` / `skip_batch`

**Per-photo backfill logic (inside `run_next_batch`):**

For each place in batch:
1. Read `stored_photo_urls` array from `place_pool`.
2. For each URL in the array (serially):
   a. Extract the storage path: split on `/storage/v1/object/public/place-photos/` and take the suffix.
   b. Check if the corresponding `_thumb.jpg` already exists (HEAD request to the public URL; if 200, skip — already backfilled).
   c. Fetch the ORIGINAL via `/storage/v1/object/public/place-photos/<path>` (**non-metered** — must not use `/render/image/`).
   d. Decode with imagescript.
   e. Resize to 384×384.
   f. Encode JPEG quality 80.
   g. Upload to `<dir>/<i>_thumb.jpg` via `supabaseAdmin.storage.from('place-photos').upload(...)` with `upsert: true`.
3. After ALL photos in the place succeed: `UPDATE place_pool SET thumbs_backfilled_at = NOW() WHERE id = <place_id>`.
4. If ANY photo fails: do NOT set `thumbs_backfilled_at` (leave place pending for retry). Per-photo failures are logged with `console.warn` and don't abort the batch.

**Batch sizing:**
- Default 25 places per batch.
- Inter-photo delay: 100 ms (gentle — backfill is not latency-sensitive).
- Inter-place delay: 500 ms.
- Estimated throughput: ~5 photos/sec → 88,133 photos / 5 = ~17,627 seconds = ~5 hours wall time at full-speed continuous. With operator-controlled batch dispatch (admin runs batches at their pace), spread across 24 hours is realistic.

**Cost contract (critical):** The backfill function MUST fetch via `/storage/v1/object/public/` and NEVER via `/storage/v1/render/image/`. The implementor MUST add a regression test asserting the backfill fetch URL contains `/object/public/` and NOT `/render/image/` — see §6 T-04.

**Auth:** Same admin-bearer-token pattern as `backfill-place-photos` (lines 47-66).

**Resumability:** The `thumbs_backfilled_at IS NULL` filter naturally resumes from where the last batch stopped, including across edge function cold starts and manual pauses.

### 3.6 Edge function: `run-place-intelligence-trial/index.ts` (NO source changes, requires redeploy)

This function imports the modified `_shared/imageCollage.ts`. **No source changes**, but it MUST be redeployed for the shared-helper change to take effect. Orchestrator handles deploy per the orchestrator's own deploy-edge-functions rule.

### 3.7 No client-side changes

`app-mobile/`, `mingla-business/`, `mingla-admin/`: untouched.

## 4. Success criteria

| ID | Criterion | How tested |
|---|---|---|
| SC-1 | NEW place ingest via `downloadAndStorePhotos` writes BOTH the original AND the `_thumb.jpg` to `place-photos` bucket for every photo, and sets `place_pool.thumbs_backfilled_at` to non-NULL. | Integration test: invoke `places-autocomplete` for a fresh Google place_id with photos, verify storage objects + DB column. |
| SC-2 | `transformPhotoUrlForTile(url, tile)` for a Supabase storage URL returns a URL containing `_thumb.jpg` AND `/storage/v1/object/public/` AND NOT `width=` or `height=` or `resize=` or `/render/image/` (when `USE_PLACE_PHOTO_THUMBS` unset or `true`). | Unit test in `imageCollage.test.ts` — adds 2 new cases. |
| SC-3 | With `USE_PLACE_PHOTO_THUMBS=false`, `transformPhotoUrlForTile` reverts to the legacy `/render/image/` behaviour (regression safety net for the kill-switch path). | Unit test — 1 new case. |
| SC-4 | `backfill-place-photo-thumbs` `run_next_batch` action fetches originals via `/storage/v1/object/public/` ONLY, never via `/render/image/`. | Integration test inspects the function's outbound fetch URLs (mock or fetch spy). |
| SC-5 | 7 days after Tier B deploys + backfill completes, Supabase Storage Image Transformations meter shows <100 cumulative for a 7-day window (effectively zero ongoing). Verified by operator-eyeball on the Supabase dashboard at billing day +14. | Operator-verified post-close. Tester records baseline (today: 9,168 in 19 days = ~482/day) and tracks meter at deploy + 24h + 7d. |
| SC-6 | Place-intelligence pipeline (`run-place-intelligence-trial` `compose_collage` action) does NOT hit `WORKER_RESOURCE_LIMIT 546` when reading from thumbs. | Tester triggers a collage compose with 16-photo place; checks edge function logs for absence of memory errors over 100 consecutive runs. |
| SC-7 | A place whose thumb is missing produces a black-tile cell in the collage (per the existing graceful-degradation contract) AND does NOT crash the pipeline. With `THUMB_404_FALLBACK_TO_TRANSFORM=true` (default), it falls back to the legacy transform endpoint for that single photo. | Tester deletes one `_thumb.jpg` manually, triggers a collage compose for that place, verifies fallback behaviour matches the env-var setting. |
| SC-8 | The `place_pool.thumbs_backfilled_at` column + supporting index exist on remote after `supabase db push`, and querying `WHERE thumbs_backfilled_at IS NULL AND stored_photo_urls IS NOT NULL` returns ~18,547 rows initially (the entire historical pool) and decreases monotonically as backfill batches run. | Read-only DB probe by tester pre + post backfill batches. |

## 5. Invariants

### Preserved

- **Memory safety contract from ORCH-0737 v6** (collage compose stays under edge function memory limit): preserved by reading thumbs (~12 KB) instead of originals (~ 250-500 KB for 800px JPEGs). Per-photo decode memory drops further from 5 MB to ~600 KB.
- **`MAX_PHOTOS = 5` in ingest vs `MAX_PHOTOS = 16` in collage:** unchanged. Latent discrepancy preserved (flagged as discovery, not in scope).
- **`stored_photo_urls` array shape on `place_pool`:** unchanged. No new column added to point at thumbs because the thumb path is conventionally derivable from the original path.
- **`DISABLE_PHOTO_URL_TRANSFORM` kill-switch** from ORCH-0737 v6: preserved as the top-priority bypass (overrides `USE_PLACE_PHOTO_THUMBS`).
- **Constitutional #3 (no silent failures):** thumb generation failures `console.warn` and proceed; not swallowed; the collage's existing `console.warn` on fetch failure remains the visibility path.

### New (proposed)

- **`I-PROPOSED-NO-METERED-READ-ON-INGESTED-PHOTOS`** (DRAFT → ACTIVE on ORCH-0957 close): Any code path that reads photos from the `place-photos` bucket for processing MUST use the non-metered `/storage/v1/object/public/` endpoint, NOT `/storage/v1/render/image/`. Pre-sized thumbnails are written at ingest time for sizing needs. The single exception is the legacy transform path retained behind `USE_PLACE_PHOTO_THUMBS=false`, used only as an emergency revert lever. Enforced by:
  1. Unit test (T-04 below) asserting `transformPhotoUrlForTile` Supabase branch returns object-endpoint URL by default.
  2. Strict-grep CI rule (registered into `.github/workflows/strict-grep-mingla-business.yml` per the registry pattern memory rule): no NEW occurrence of `/storage/v1/render/image/` in `supabase/functions/**/*.ts` outside the explicitly-allowlisted legacy fallback block in `_shared/imageCollage.ts`.

- **Discovery D-1 follow-up:** orchestrator should broaden `I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED` at CLOSE to cover metered endpoints (currently scoped only to enums/payloads). Not enforced in this SPEC — flagged for orchestrator's CLOSE Step 5e (constitutional/invariant updates).

## 6. Test cases

Implementor MUST write the regression test (T-04 below). Tester MUST write an adversarial test attacking a different angle (T-05 candidate is suggested).

| T# | Scenario | Input | Expected | Layer | Owner |
|---|---|---|---|---|---|
| T-01 | NEW place ingest writes original + thumb | Mock Google Places API returning 1 JPEG | Both `<dir>/0.jpg` and `<dir>/0_thumb.jpg` present in `place-photos` bucket; `thumbs_backfilled_at` set | Edge fn + Storage + DB | Implementor + Tester |
| T-02 | `transformPhotoUrlForTile` default behaviour for Supabase URL | `'https://x.supabase.co/storage/v1/object/public/place-photos/abc/0.jpg'`, tile=192 | Returns `'https://x.supabase.co/storage/v1/object/public/place-photos/abc/0_thumb.jpg'` (no query string) | Unit | Implementor |
| T-03 | `transformPhotoUrlForTile` legacy mode | Same input + `USE_PLACE_PHOTO_THUMBS=false` env | Returns `'https://x.supabase.co/storage/v1/render/image/public/place-photos/abc/0.jpg?width=192&height=192&resize=cover'` (legacy shape) | Unit | Implementor |
| **T-04** | **Regression: cost-control contract** | `transformPhotoUrlForTile` invoked with `USE_PLACE_PHOTO_THUMBS` UNSET on a Supabase URL | Returned URL contains `/storage/v1/object/public/` AND `_thumb.jpg`; does NOT contain `/render/image/` OR `width=` OR `height=` OR `resize=`. **Implementor MUST verify `fails-on-revert at <commit hash>` per the regression-test gate.** | Unit | Implementor (happy-path regression) |
| **T-05** | **Adversarial: thumb missing 404 fallback** | Manually delete a known place's `_thumb.jpg`; invoke `compose_collage` for that place; assert behaviour matches `THUMB_404_FALLBACK_TO_TRANSFORM` env (default `true` → falls back to legacy transform; `false` → black tile). Bonus assertion: even on fallback, total transform calls stays at exactly 1 (not N retries). | Integration | Tester (adversarial — attacks the fallback path, not the happy path) |
| T-06 | Backfill function fetches via object endpoint only | Invoke `backfill-place-photo-thumbs run_next_batch` with batch=1 against a known un-backfilled place; spy on outbound fetch URLs | All fetches contain `/object/public/`; ZERO fetches contain `/render/image/` | Integration | Implementor + Tester |
| T-07 | Backfill skips already-backfilled photos | Run backfill twice in succession; second run processes 0 photos | Second-run report shows 0 thumbs written, 0 errors | Integration | Implementor |
| T-08 | Thumb generation failure is non-fatal | Mock imagescript decode to throw; verify original upload still succeeds + place row still has `stored_photo_urls` populated | Original photo present in storage; `thumbs_backfilled_at` remains NULL; warn logged | Unit + Integration | Implementor |
| T-09 | Memory safety in compose pipeline | Trigger `run-place-intelligence-trial compose_collage` against a 16-photo place using thumbs; observe edge function memory metric | Peak memory < 100 MB (well under 256 MB limit); no WORKER_RESOURCE_LIMIT 546 errors across 100 runs | Runtime | Tester |
| T-10 | Backfill resumability across pause/resume | Start backfill; pause mid-batch via `pause_run`; resume via `resume_run` | No duplicate work; no orphan thumbs; `thumbs_backfilled_at` set only after FULL place success | Integration | Tester |

## 7. Implementation order

Implementor MUST follow this order. Each step is committable independently if needed.

1. **Migration** — create `supabase/migrations/<timestamp>_orch_0957_place_pool_thumbs_backfilled_at.sql` per §3.1. Run pre-flight data probe. Operator then applies via `supabase db push --linked` from the worktree.
2. **`_shared/imageCollage.ts`** — modify `transformPhotoUrlForTile` Pattern 1 per §3.4. Add T-02, T-03, T-04 to `imageCollage.test.ts` with `fails-on-revert` verification at the new commit hash. Run `deno test supabase/functions/_shared/imageCollage.test.ts` locally.
3. **`_shared/photoStorageService.ts`** — add thumb generation logic per §3.3. Add unit test T-08.
4. **`backfill-place-photo-thumbs/index.ts`** — new edge function per §3.5. Add T-06, T-07 tests. Deploy via orchestrator's deploy step.
5. **Redeploy `run-place-intelligence-trial`, `places-autocomplete`, and any other consumer of `_shared/*`** — orchestrator's deploy responsibility (per `feedback_orchestrator_deploys_edge_functions.md`). Verify with `mcp__supabase__list_edge_functions` and one curl per redeployed function (per `feedback_supabase_edge_deploy_verify_first_call.md`).
6. **CI strict-grep gate** — add `.github/scripts/strict-grep/orch-0957-no-metered-place-photo-reads.mjs` and wire into `strict-grep-mingla-business.yml` per the registry pattern. Enforces I-PROPOSED-NO-METERED-READ-ON-INGESTED-PHOTOS.
7. **Add backend allowlist entries** for ORCH-0863 strict-grep (per COMMS-0002 + the close-commit pre-commit checks memory rule) — `supabase/functions/backfill-place-photo-thumbs/index.ts`, `supabase/functions/_shared/imageCollage.ts`, `supabase/functions/_shared/photoStorageService.ts`, and the new migration filename.
8. **Backfill operation** — operator invokes `backfill-place-photo-thumbs create_run` then `run_next_batch` in batches at their pace.

## 8. Regression prevention

- **Test T-04** locks in the cost-control contract at the unit-test layer with `fails-on-revert` verification. Reverting Pattern 1 to the metered shape breaks T-04 immediately.
- **CI strict-grep gate** (step 7 above) prevents future ORCHs from introducing new `/storage/v1/render/image/` strings in `supabase/functions/**` outside the legacy-fallback allowlist.
- **Invariant I-PROPOSED-NO-METERED-READ-ON-INGESTED-PHOTOS** (DRAFT → ACTIVE on CLOSE) gives forensics/orchestrator a named rule to cite in future reviews.
- **D-1 escalation:** orchestrator should broaden `I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED` at this ORCH's CLOSE to add the word "metering" to its scope, so future external-API integrations cite the metering rule + cost model in their SPEC.
- **In-code comments** at both modified sites cite ORCH-0957 + the cost rationale so future readers understand WHY the indirection exists (the `imageCollage.ts` v6 comment block becomes a model).

## 9. Edge cases + open questions for tester

1. **Mixed-extension originals:** A place has `0.jpg`, `1.png`, `2.webp`. The thumb path normalization always produces `_thumb.jpg` regardless of original ext. Verify the basename-extension-stripping logic in `transformPhotoUrlForTile` Pattern 1 handles all three correctly.
2. **URL with query string:** original URL might have `?cachebuster=123` (per the existing unit test). Pattern 1 strips the query before rewriting. Verify with T-02 variant.
3. **Place with `stored_photo_urls = ['url1', null, 'url3']`:** Backfill should skip the null and continue. Check `downloadAndStorePhotos` already filters nulls; if not, the backfill function must.
4. **Race condition during backfill:** A new ingest writes a thumb at the same time the backfill function processes the same place. Both use `upsert: true`; last-write-wins is acceptable since both produce identical content. No mitigation needed.
5. **`run-place-intelligence-trial` is running mid-deploy of the new helper:** Old in-flight invocations will use the OLD helper version (pointing at transform endpoint); new invocations use the NEW helper. No data corruption risk; just a brief transition where both paths coexist.

## 10. Cost-control verification plan

Tester records the Supabase dashboard Image Transformations meter at:

- **T-0:** at start of testing (baseline).
- **T+24h:** after backfill complete (should show small bump from any thumb-404-fallback transforms during the backfill window, then plateau).
- **T+7d:** in the NEW billing cycle (June 6 onward) — should show <100 cumulative for the 7-day window if SC-5 holds.

If T+7d reading exceeds 200, tester FAILs the CONDITIONAL PASS verdict and requires implementor to investigate which call path is still hitting the metered endpoint.

## 11. Out-of-scope discoveries (do NOT scope-creep into this SPEC)

- `MAX_PHOTOS = 5` vs `MAX_PHOTOS = 16` discrepancy (investigation D-2 candidate — flag to orchestrator post-CLOSE).
- Tier D (stop mirroring Google photos) — operator deferred; register as `ORCH-NNNN` follow-up if/when desired.
- Dedicated admin-dashboard screen for thumb backfill run management — register as `ORCH-NNNN` follow-up if operator wants UI parity with `backfill-place-photos`.
- Other Supabase meters (Storage egress, Edge Function invocations) — separate audit scope.
