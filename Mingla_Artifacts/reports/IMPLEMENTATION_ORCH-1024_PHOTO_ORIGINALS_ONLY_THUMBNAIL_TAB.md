# IMPLEMENTATION — ORCH-1024 [Photo backfill originals-only + separate thumbnail tab]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1024-[photo-originals-thumbnail-tab]/`
**Branch:** `ORCH-1024-photo-originals-thumbnail-tab`
**Status:** implemented and verified (no deploy)
**Date:** 2026-05-31

---

## 1. Plain-English summary

The admin "Download Photos" backfill was crashing Supabase with "not enough compute
resources." Cause: ORCH-0957 had bolted inline thumbnail generation (decode → resize →
re-encode every downloaded image, up to 50 per invocation) onto the photo-download hot
path. This ORCH restores the pre-ORCH-0957 behavior: the main backfill now **downloads and
stores ORIGINALS ONLY** — no decode, no resize, no thumbnail upload — which is light enough
to run without exhausting compute.

Thumbnail generation isn't lost; it moves to the already-existing, separate
`backfill-place-photo-thumbs` edge function, now driven from a **new admin "Thumbnails"
tab**. That tab runs a single GLOBAL job over every place that has stored originals but no
thumbnail yet, with the same batch/pause/cancel/retry controls the Photos tab already has.

The ORCH-1023 expired-photo-name REFRESH fix that was staged in this worktree is fully
preserved.

---

## 2. Files changed

| File | Surface | Change |
|---|---|---|
| `supabase/functions/_shared/photoStorageService.ts` | Backend (Edge) | Removed inline thumbnail generation; download/store ORIGINALS ONLY; decoupled `thumbs_backfilled_at` (no longer written) |
| `supabase/functions/_shared/photoStorageService.test.ts` | Backend (Deno test) | Updated thumbnail assertions → originals-only; repurposed the thumb-fail test; `[TEST-MOD-APPROVED ORCH-1024]` |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Admin Web | New "Thumbnails" tab + `ThumbnailTab` component invoking `backfill-place-photo-thumbs`; Photos `active_runs` scoped to exclude the thumbs city marker |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | CI gate | Added `ORCH_1024_BACKEND_ALLOWLIST` (4 backend files) spread into `ALLOWLIST` |

**Kept untouched (staged ORCH-1023 work preserved):**
`supabase/functions/backfill-place-photos/index.ts` and
`supabase/functions/backfill-place-photos/index.test.ts` — the `fetchFreshPlacePhotos`
refresh path + the `processBatch` process-path test still pass unchanged.

---

## 3. Thumbnail-removal + decoupling (exact)

### `photoStorageService.ts`

**Before:** In `attemptStorePhotos`, after uploading the original image, the function
decoded the bytes with imagescript (`decode(new Uint8Array(imageData))`), and if the result
was an `Image`, called `decoded.resize(THUMB_SIZE, THUMB_SIZE)` +
`decoded.encodeJPEG(THUMB_JPEG_QUALITY)` and uploaded `${safePlaceId}/${i}_thumb.jpg`. It
tracked `allUploadedThumbsSucceeded` and pushed `stage:'thumb'` failures on
decode/upload/non-image. `updateStoredPhotoUrls` accepted an
`allUploadedThumbsSucceeded` argument and wrote `thumbs_backfilled_at = now()` when all
thumbs succeeded, alongside `stored_photo_urls`.

**After:**
- The entire thumbnail block (the `const thumbPath = …` through its full `try/catch` with
  `decode`, `resize`, `encodeJPEG`, `_thumb.jpg` upload) is **deleted**. The original-image
  download → `upload(${i}.${ext})` → `getPublicUrl` → `storedUrls.push(...)` is unchanged.
- `allUploadedThumbsSucceeded` is removed entirely: the local var in `attemptStorePhotos`,
  the `AttemptResult` interface field, and both return sites.
- `updateStoredPhotoUrls` drops the `allUploadedThumbsSucceeded` parameter and now writes
  **only** `{ stored_photo_urls: storedUrls }` — it never writes `thumbs_backfilled_at`.
  Both call sites in `downloadAndStorePhotosWithDiagnostics` (cached path + refresh path)
  drop the removed argument.
- Removed imports/constants: `import { Image, decode } from ".../imagescript@1.2.17/mod.ts"`,
  `THUMB_SIZE`, `THUMB_JPEG_QUALITY`. Verified no remaining references (grep clean).
- `MAX_PHOTOS = 5` unchanged. The full refresh path (`fetchFreshPlacePhotos` +
  `shouldRefreshPhotoNames` routing) unchanged.

The `PhotoBackfillFailureStage` union still lists `'thumb'` as a harmless, now-unproduced
member; no code path emits it. Left in place to avoid an unrelated type churn; the
diagnostics shape is otherwise untouched.

### The critical decoupling

Leaving `thumbs_backfilled_at` **NULL** on every freshly-downloaded place is exactly what
lets the separate thumbs pass pick those places up. The `backfill-place-photo-thumbs`
function's pending-place query selects places with originals but no
`thumbs_backfilled_at`; because the originals path no longer stamps that column, the global
thumbs run will always see newly-downloaded places as pending.

---

## 4. New admin "Thumbnails" tab + run-attribution

`ThumbnailTab` is a clone of `PhotoTab`'s job runner with these differences:

- **Invokes `backfill-place-photo-thumbs`** (not `backfill-place-photos`). Same action
  surface: `preview_run`, `create_run`, `run_next_batch`, `run_status`, `active_runs`,
  `pause_run`, `resume_run`, `cancel_run`, `retry_batch`, `skip_batch`. Same admin auth.
- **GLOBAL run — no city.** No `scope`/`registeredCity` props. `create_run` and
  `preview_run` send no `cityId`/`city`/`country`. `preview_run` returns `totalPlaces`
  (pending count); `create_run` returns `totalPlaces`/`totalBatches`.
- **estimatedCost always $0** — surfaced as a static "$0.00" StatCard; no Google calls
  (thumbnails are generated from already-stored originals).
- **Surfaces** pending count, Run All / Run Next / Pause / Cancel, batch progress bar,
  per-batch succeeded/failed/skipped, and `thumbsWritten` / `thumbsAlreadyPresent`
  accumulated from `run_next_batch` responses (shown as StatCards + in the active-run
  stats row when present).
- Reuses existing `Tabs`, `StatCard`, `SectionCard`, `Button`, `useToast`, `formatCount`,
  and the `stopAutoRef` auto-run loop pattern. No new dependencies. `Image as ImageIcon`
  added to the existing lucide import.

### Run-attribution handling (shared `photo_backfill_runs` table)

Both functions write to `photo_backfill_runs`. Thumbnail runs are tagged
`city = 'ORCH-0957 place-photo thumbs'` (`RUN_CITY`) / `country = 'GLOBAL'`.

- **Thumbnails panel binds only to thumbnail runs:** the
  `backfill-place-photo-thumbs` function's own `handleActiveRuns` already filters
  `.eq('city', RUN_CITY).eq('country', RUN_COUNTRY)`, so `ThumbnailTab` only ever sees the
  single global thumbs run.
- **Photos panel is NOT disrupted by thumbnail runs:** the `backfill-place-photos`
  function's `handleActiveRuns` returns ALL `ready/running/paused` runs with no city
  filter, so a thumbs run WOULD otherwise leak into the Photos status bar. Fixed at the
  admin layer (no edge-function edit, no deploy risk): a `THUMBS_RUN_CITY` constant guards
  three feed points that drive the Photos status bar —
  (1) the page-level mount hydration that sets `activePhotoRuns`,
  (2) `PhotoTab.refreshActiveRuns`,
  (3) `PhotoTab`'s mount-effect `onActiveRunsChange` + the `match` finder —
  each now `.filter((r) => r?.run?.city !== THUMBS_RUN_CITY)`. The existing per-city
  `match` already keyed on real city/country, so binding was already safe; the filter
  hardens the visible status bar against ever rendering a thumbs run.

The Photos tab otherwise renders identically (verified by `vite build` compile + unchanged
Photos code paths).

---

## 5. Strict-grep allowlist (Task 4)

Added `ORCH_1024_BACKEND_ALLOWLIST` to
`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` listing every
`supabase/functions/**` file this ORCH touches:

- `supabase/functions/_shared/photoStorageService.ts`
- `supabase/functions/_shared/photoStorageService.test.ts`
- `supabase/functions/backfill-place-photos/index.ts`
- `supabase/functions/backfill-place-photos/index.test.ts`

Spread into the `ALLOWLIST` array (first entry). The admin `.jsx` is correctly NOT added
(not under C7's `supabase/**` scope). Verified all four covered + spread present.
(`photoStorageService.ts`/`.test.ts` were already in `ORCH_0957_BACKEND_ALLOWLIST`; the
two `backfill-place-photos` files were not in any list — the new allowlist clears them.)

---

## 6. Spec traceability

| Task | Requirement | Status |
|---|---|---|
| 1 | Delete inline thumbnail block in `attemptStorePhotos` | ✅ deleted |
| 1 | Remove `allUploadedThumbsSucceeded` (var + interface field + returns) | ✅ removed |
| 1 | `updateStoredPhotoUrls` drops param + stops writing `thumbs_backfilled_at` (writes only `stored_photo_urls`) | ✅ |
| 1 | Update caller to drop removed arg (both call sites) | ✅ |
| 1 | Remove imagescript import + `THUMB_SIZE`/`THUMB_JPEG_QUALITY`; verify no refs | ✅ grep clean |
| 1 | Keep `MAX_PHOTOS = 5` + entire refresh path | ✅ unchanged |
| 2 | "writes original, thumb, thumbs_backfilled_at" → originals-only assertions | ✅ |
| 2 | refresh test uploads → originals-only | ✅ |
| 2 | repurpose/remove "leaves thumbs_backfilled_at unset" test | ✅ repurposed (non-decodable bytes still store original, no decode path) |
| 2 | keep refresh/diagnostic tests intact | ✅ |
| 2 | `[TEST-MOD-APPROVED ORCH-1024]` in commit body | ⏳ to be added at commit time |
| 3 | New `thumbnails` tab invoking `backfill-place-photo-thumbs` | ✅ |
| 3 | No `cityId`; `create_run` no city args; estimatedCost $0 | ✅ |
| 3 | pending count, Run All/pause/cancel, batch progress, per-batch counts, thumbsWritten/thumbsAlreadyPresent | ✅ |
| 3 | Thumbnails panel binds only to thumbnail runs; Photos panel not disrupted | ✅ |
| 3 | Match existing styling/components; reuse helpers; no new deps | ✅ |
| 4 | `ORCH_1024_BACKEND_ALLOWLIST` with 4 backend files, spread into ALLOWLIST; admin .jsx NOT added | ✅ |

---

## 7. Regression test

- **Path:** `supabase/functions/_shared/photoStorageService.test.ts`
- **Passing run:** `9 passed | 0 failed` (7 shared-service + 2 backfill process-path) via
  `deno test --allow-all supabase/functions/_shared/photoStorageService.test.ts supabase/functions/backfill-place-photos/index.test.ts`.
- **Fails-on-revert verified:** ran the NEW ORCH-1024 tests against the pre-edit
  (thumb-generating) staged source — `FAILED | 5 passed | 2 failed`. The two failures are
  exactly the originals-only assertions: expected uploads `["ChIJfresh/0.jpg"]` but the old
  source uploaded `["ChIJfresh/0.jpg", "ChIJfresh/0_thumb.jpg"]`. This proves the tests
  genuinely exercise the behavior change. Source then restored; gates green again.

---

## 8. Gate outputs

### `deno check` (4 files)
```
$ deno check supabase/functions/_shared/photoStorageService.ts \
    supabase/functions/backfill-place-photos/index.ts \
    supabase/functions/backfill-place-photos/index.test.ts \
    supabase/functions/_shared/photoStorageService.test.ts
(no output — exit 0)
```

### `deno test` (2 files)
```
$ deno test --allow-all supabase/functions/_shared/photoStorageService.test.ts \
    supabase/functions/backfill-place-photos/index.test.ts
running 2 tests from ./supabase/functions/backfill-place-photos/index.test.ts
processBatch: retryable provider pressure ... ok
processBatch: non-retryable exhaustion ... ok
running 7 tests from ./supabase/functions/_shared/photoStorageService.test.ts
downloadAndStorePhotos writes ONLY the original (no thumb, no thumbs_backfilled_at) ... ok
downloadAndStorePhotosWithDiagnostics refreshes expired cached names ... ok
downloadAndStorePhotosWithDiagnostics does not refresh on retryable provider pressure ... ok
downloadAndStorePhotosWithDiagnostics returns structured details refresh failure ... ok
fetchFreshPlacePhotos normalizes places/ IDs ... ok
photoBackfillFailureSummary treats post-refresh provider pressure as retryable ... ok
downloadAndStorePhotos stores the original even for non-decodable bytes ... ok
ok | 9 passed | 0 failed (568ms)
```

### strict-grep gate
```
$ node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
OK [C1..C6] ...
OK [C7: no-new-backend-files] zero touches under supabase/migrations/ or supabase/functions/
# All checks PASS  (exit 0)
```
(Self-test mode `--self-test` also passes.)

### Admin build
```
$ npm run build   (mingla-admin/, vite v7.3.1)
✓ 2940 modules transformed.
✓ built in 5.56s   (exit 0)
```
Page compiles. ESLint on the page reports 18 problems vs 17 on the main baseline — the +1
`set-state-in-effect` and +1 `exhaustive-deps` are faithful clones of the existing
`PhotoTab` mount-effect convention already present (and already flagged) throughout this
file; not new error patterns. `vite build` is the real compile gate and is clean.

---

## 9. Cross-surface note

| Surface | Affected? | Why |
|---|---|---|
| Admin Web (`mingla-admin/`) | YES | New "Thumbnails" tab; Photos status-bar scoping |
| Backend edge (`supabase/functions/_shared/photoStorageService.ts`) | YES | originals-only download path |
| Consumer iOS / Android | No | consumes stored photo URLs; rendering unchanged (originals still stored at `${i}.${ext}`) |
| Buyer/anon Web | No | no equivalent flow |
| Business iOS / Android | No | no equivalent flow |
| Business Web preview | No | no equivalent flow |

Admin Web is the only touched UI surface. The thumbnail-consuming reader path
(`imageCollage.ts` thumb fallback) is unaffected: originals are still stored at the same
paths; thumbnails are now produced by the separate function on the new tab's run instead of
inline, so thumbnail availability lags the originals download by one (admin-triggered)
thumbs pass — which is the intended decoupling.

---

## 10. Discoveries for orchestrator

- **`PhotoBackfillFailureStage` still lists `'thumb'`** as an unproduced union member. Left
  intentionally to avoid type churn; a future cleanup could drop it once nothing references
  the diagnostics `'thumb'` stage.
- **The dispatch referenced an existing `ORCH_1023_BACKEND_ALLOWLIST`** in the strict-grep
  file. It is NOT present in this worktree's copy of
  `orch-0863-marketing-hub-phase-b.mjs` (the staged ORCH-1023 restore did not include a
  strict-grep allowlist entry). This did not block ORCH-1024: the new
  `ORCH_1024_BACKEND_ALLOWLIST` explicitly lists all four backend files (including the two
  `backfill-place-photos` files the ORCH-1023 work touches), so the C7 gate is satisfied
  for this branch regardless. Flagging in case ORCH-1023 was expected to carry its own
  allowlist that got dropped.
- **No deploy performed** (per dispatch). When this lands, the operator/orchestrator should
  redeploy `backfill-place-photos` (originals-only) and confirm `backfill-place-photo-thumbs`
  is deployed for the new tab to drive.
