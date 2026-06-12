# SPEC — ORCH-1119 — Trip itinerary days: optional media gallery (images + videos)

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery`.
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md` (confidence `proven`).
**Mode:** SPEC (binding contract). Scope LOCKED by Seth — do not widen.

---

## 1. Executive summary

Add an OPTIONAL ordered media gallery (images AND videos) to each TRIP itinerary DAY. A brand authoring or editing a trip can attach up to **8** media items per day (image or video, mixed, reorderable, removable). Consumers (iOS/Android) and anonymous web buyers see the per-day gallery on the trip itinerary view, with video playing through the existing `EventCoverMedia` renderer (explicit `mediaType`, one-playing guard, web lazy-mount). A day with no media renders NO gallery section (Constitution #9).

Built narrowly for trips: a new `media` jsonb column on `trip_days`, a new trips-only `tripDayMediaService` (direct `event_covers` Storage upload), a new trips-only add-media sheet (adapted from `ExperienceStopPhotoSheet` as a copied model — NOT shared), and field-threading through the existing draft + published-edit + display hops. No shared cross-offering abstraction. The heavyweight cover-video transcode pipeline is deliberately NOT reused (it writes a single column; a gallery needs many URLs) — per-day video is a direct upload, exactly like per-stop images.

---

## 2. Scope & non-goals

### In scope
- DB: `trip_days.media jsonb NOT NULL DEFAULT '[]'` (migration `20260927000000`).
- Data shape `TripDayMedia[]` + every type/interface edit.
- Authoring: per-day gallery section in `TripDayEditor.tsx`; new `TripDayMediaSheet.tsx` (images + video tabs); new `tripDayMediaService.ts`; thread media through `TripDayDraft`, `TripDayInput`, `upsertTripDays`, the create-wizard Step 2, and the published-edit screen.
- Published-edit parity: replace `biz_update_live_trip` (LATEST def) to persist `media`; make the day-signature + `TripDayDiff` + change-summary media-aware (additive severity).
- Display: per-day gallery in `ConsumerTripDetailScreen.tsx` (consumer) and `TripPreview.tsx` (web public `/t/...` + business preview), video via `EventCoverMedia`.
- Read-path threading: `getTrip`, `mapTripDay`, `useConsumerTripDetail`, `usePublicTripBySlug`.

### Non-goals (explicit)
- **NO per-stop media** — gallery is PER-DAY only (locked (a)).
- **NO shared cross-offering media primitive** — `ExperienceStopPhotoSheet`/experience/event media are NOT refactored or unified (locked (c)). The new sheet is a trips-only copy-adapt.
- **NO reuse of the cover-video transcode pipeline** (`useEventCoverVideoUpload`) — per-day video is a direct upload (F-7).
- **NO new `event-media` bucket policy** — we use `event_covers` (already video-capable + brand/event-keyed RLS).
- **NO admin-web** surface.
- **NO per-day `date` field work** (pre-existing `TripDayDraft.date` omission — Discovery #2, untouched).
- **NO change to the day-dropped-with-sales refund gate** — media is additive, never triggers a refund.

### Assumptions
- The trip's `events` row exists before day editing (proven: `createTripDraft` runs before Step 2). This makes the 2-segment `event_covers` key `{brandId}/{eventId}/...` satisfiable at create-draft and published-edit time.
- Remote migration max = `20260926000000`; all sibling worktrees (1116/1117/1118) share that max — `20260927000000` is free and monotonic.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | YES | Per-day gallery (images + video) on trip itinerary; video autoplays muted, one at a time | `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`, `app-mobile/src/hooks/useConsumerTripDetail.ts` | Shared RN — auto |
| 2 | Consumer Android | YES | Same as iOS (native video via `EventCoverNativeVideo`) | same as #1 | Shared RN — auto |
| 3 | Buyer/anon Web (`/t/{brandSlug}/{tripSlug}`) | YES | Per-day gallery; web video via `EventCoverWebVideo` + lazy-mount | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (no edit), `mingla-business/src/components/trip/TripPreview.tsx`, `mingla-business/src/hooks/usePublicTripBySlug.ts` | Shared component — auto |
| 4 | Business iOS | YES | Add/reorder/remove per-day media in create wizard + published-edit; preview shows gallery | `TripDayEditor.tsx`, `TripDayMediaSheet.tsx` (NEW), `TripCreatorStep2Itinerary.tsx`, `EditPublishedTripScreen.tsx`, `tripDayMediaService.ts` (NEW), `tripsService.ts`, `tripAdapter.ts`, `TripPreview.tsx` | Shared RN — auto |
| 5 | Business Android | YES | Same authoring as Business iOS | same as #4 | Shared RN — auto |
| 6 | Admin Web | NO | No trip-day authoring/display in admin | — | Reason: out of scope |
| 7 | Business Web preview | YES (= surface #3's `TripPreview`) | Preview renders the gallery | `TripPreview.tsx` | Same component as #3 |

---

## 4. Layered specification

### 4.1 Database — migration `20260927000000_orch_1119_trip_day_media.sql`

Idempotent. Adds the media column + a shape-validation CHECK. NO RLS change (column inherits `trip_days` row policies; reads/writes already governed by F-1's two policies).

```
BEGIN;

ALTER TABLE public.trip_days
  ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Shape guard: media must be a jsonb ARRAY (the per-item url/type validation is
-- enforced application-side + by the bucket MIME allowlist; this CHECK only
-- prevents a non-array scalar from being stored).
ALTER TABLE public.trip_days
  DROP CONSTRAINT IF EXISTS trip_days_media_is_array;
ALTER TABLE public.trip_days
  ADD CONSTRAINT trip_days_media_is_array
  CHECK (jsonb_typeof(media) = 'array');

COMMENT ON COLUMN public.trip_days.media IS
  'ORCH-1119: optional ordered per-day media gallery. jsonb array of {url:text, type:"image"|"video", provider?:text, width?:int, height?:int}. Default [] = no gallery (rendered as absent, Constitution #9). Brand-authored uploads land in the event_covers bucket under {brandId}/{eventId}/trip-day-media/.';

COMMIT;
```

**Migration-protocol compliance:** version `20260927000000` > remote max `20260926000000` and > every sibling worktree's max (all `20260926000000`). No RPC `$function$;`/GRANT in THIS migration (column-only). The RPC replacement is a SEPARATE migration (4.2) and DOES carry `$$;` + GRANT. `DROP CONSTRAINT IF EXISTS` before re-add makes it idempotent. No `RETURNS TABLE` widening here.

### 4.2 Database — RPC replacement migration `20260927000001_orch_1119_live_trip_media.sql`

**CRITICAL:** Replace the LATEST `biz_update_live_trip` definition — it lives in `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql:2626` (live `src_len`=20046, args `p_event_id uuid, p_patch jsonb, p_reason text`). The implementor MUST copy that ENTIRE latest body verbatim and change ONLY the §5b `trip_days` upsert (latest lines ~3044-3050), then re-`CREATE OR REPLACE` + re-`GRANT EXECUTE`. Do NOT base it on the 20260616 original.

The ONLY change inside the body — the §5b upsert:

```
-- 5b. trip_days upsert + delete  (ORCH-1119: now carries media)
IF p_patch ? 'days' THEN
  IF v_dropped_ordinals IS NOT NULL AND array_length(v_dropped_ordinals, 1) > 0 THEN
    DELETE FROM public.trip_days
      WHERE event_id = p_event_id AND ordinal = ANY (v_dropped_ordinals);
  END IF;
  INSERT INTO public.trip_days (event_id, ordinal, title, narrative, media)
    SELECT p_event_id,
           (d->>'ordinal')::int,
           d->>'title',
           NULLIF(d->>'narrative', ''),
           COALESCE(d->'media', '[]'::jsonb)
      FROM jsonb_array_elements(p_patch->'days') d
    ON CONFLICT (event_id, ordinal)
    DO UPDATE SET title = EXCLUDED.title,
                  narrative = EXCLUDED.narrative,
                  media = EXCLUDED.media;
END IF;
```

After the function body: `$$;` then `GRANT EXECUTE ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text) TO authenticated;` then the existing `COMMENT ON FUNCTION ...` (append "ORCH-1119: §5b now persists per-day media."), then `NOTIFY pgrst, 'reload schema';`. Idempotent via `CREATE OR REPLACE`.

**Severity rule (unchanged gate):** media-only edits change no ordinals → `v_dropped_ordinals` empty → no `days_dropped_with_sales` reject → media edit is allowed even with sales. Correct (additive). The §6 severity computation (`material` when days/inclusions/pricing structurally change) stays — a media-only day edit must classify **additive** (handled client-side in 4.4, signature includes media but `computeTripDayDiffs` marks it `modified` with additive severity).

**Publish RPC (`business_publish_trip_draft`):** NO change needed — it reads `trip_days` rows into its composite return via `to_jsonb(td)` (publish migration line 264-267), which automatically includes the new `media` column. Draft media is already in the table (written by `upsertTripDays`) before publish runs.

### 4.3 Service layer

**4.3a NEW `mingla-business/src/services/tripDayMediaService.ts`** — direct upload, modeled on `experienceStopImageService.ts` (F-8), but to `event_covers` with video support.

- Const `TRIP_DAY_MEDIA_BUCKET = "event_covers"`.
- `MAX_TRIP_DAY_MEDIA = 8` (per day).
- Accepted MIME: images `image/jpeg,image/png,image/webp,image/gif`; video `video/mp4,video/quicktime,video/webm`.
- Size cap: **25 MB** per item (under the bucket's 30 MB hard limit, leaving headroom; images are tiny, videos are the constraint).
- Signature: `uploadTripDayMedia(brandId: string, eventId: string, input: TripDayMediaAssetInput): Promise<TripDayMedia>` where `TripDayMediaAssetInput = {uri, mimeType?, fileName?, fileSize?, width?, height?}`.
- Body: resolve content-type → reject unsupported; size guard (input.fileSize + post-read byteLength) → reject >25 MB with friendly copy; `readBrandCoverFileBytes(uri)` (content-agnostic, F-8); `token = generateBrandCoverPathToken()`; `storagePath = ` `${brandId}/${eventId}/trip-day-media/${token}.${ext}`; `supabase.storage.from("event_covers").upload(storagePath, bytes, {contentType, upsert:true})`; `getPublicUrl`; `verifyBrandCoverPublicUrl(url)` (HEAD/GET 200 check — reuse); return `{url, type: isVideo ? "video" : "image", provider: "library", width, height}`.
- Throws `BrandCoverError` (reuse) with user-facing copy on every failure (Constitution #3 — no silent failure).
- The 2-segment key satisfies `event_covers` RLS (F-6): `foldername[1]=brandId`, `foldername[2]=eventId`, caller rank ≥ `event_manager`.

**4.3b `mingla-business/src/services/tripsService.ts`:**
- Add interface `export interface TripDayMedia { url: string; type: "image" | "video"; provider?: string; width?: number; height?: number; }`.
- `TripDay`: add `media: TripDayMedia[]`.
- `TripDayRow`: add `media: unknown` (raw jsonb).
- `mapTripDay`: add `media: coerceTripDayMedia(row.media)` — new local coercer that filters to well-formed `{url:string, type:"image"|"video"}` items, drops malformed (defensive, like `extractInstallmentSchedule`).
- `TripDayInput`: add `media?: TripDayMedia[]`.
- `upsertTripDays` INSERT rows: add `media: d.media ?? []` (drop the unconditional `stops: []` change — leave stops as-is, only ADD media).
- `getTrip` `trip_days` select already `"*"` → returns `media` automatically; only the mapper needs the field.
- `LiveTripPatch.days` is `TripDayInput[]` → media rides automatically once `TripDayInput` has it (no change to `LiveTripPatch` itself).

### 4.4 Adapter / diff (`mingla-business/src/utils/tripAdapter.ts`)
- `TripDayDiff`: add `mediaChanged: boolean` (and optionally `oldMediaCount`, `newMediaCount` for copy).
- `computeTripDayDiffs`: compute a media fingerprint per ordinal (`JSON.stringify(media.map(m => m.url + "|" + m.type))`); when title/narrative unchanged but media differs, emit a `modified` diff with `mediaChanged:true`. Media changes are **additive** severity (never enter `MATERIAL_KEYS`; `classifyTripSeverity` already treats `days` add-only/narrative-only as additive — media joins that additive lane). Do NOT add `media` to `MATERIAL_KEYS`.
- `computeRichTripFieldDiffs` `days` row: when only media changed across days, still surface the `days` row (so the change-summary isn't empty) with `severity:"additive"` and a copy like `"Photos/videos updated"`.

### 4.5 Authoring components

**4.5a `TripDayEditor.tsx`:**
- `TripDayDraft`: add `media: TripDayMedia[]` (import type from `tripsService`).
- Add a gallery section below the narrative field: a horizontal row of media thumbnails (image → `Image`; video → `EventCoverMedia mediaType="video" playbackActive={false}` static poster OR a video glyph badge over the first frame — see Design §4.7), each with a remove (×) affordance + drag/swap reorder via the existing chevron pattern OR long-press; an "Add media" tile (+) that opens `TripDayMediaSheet` when `media.length < 8`, disabled at cap with "8 max".
- New props: `brandId: string`, `eventId: string` (needed for the upload key), `onAddMedia: (m: TripDayMedia) => void`, `onRemoveMedia: (index: number) => void`, `onReorderMedia: (from: number, to: number) => void`.
- Empty state: when `media.length === 0`, show just the "+ Add media" tile (no empty frame).

**4.5b NEW `TripDayMediaSheet.tsx`** (copy-adapt `ExperienceStopPhotoSheet.tsx`, trips-only — do NOT import/extend it):
- Tabs: **Library** (device images AND video), **GIFs**, **Photos** (Pexels) — same 3 tabs, but the Library tab now ALSO accepts video.
- Library picker: native `launchImageLibraryAsync({mediaTypes:["images","videos"], ...})` (multi-select to remaining slots); web `pickBrowserFiles({accept:"image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm", ...})`. Each chosen asset → `uploadTripDayMedia(brandId, eventId, asset)` → `onAddMedia(result)`.
- GIFs/Photos tabs: unchanged from the precedent (provider URL → `{url, type:"image", provider:"giphy"|"pexels"}` via `onAddMedia`). GIFs map to `type:"image"` (animated GIF renders as image).
- Cap: `MAX_TRIP_DAY_MEDIA = 8`; remaining-slots gating identical to the precedent.
- Copy: "Add media" / "{remaining} of 8 slots left" / "This day is full (8 items)."
- Error/empty/loading states: reuse the precedent's `ProviderGrid` states verbatim.

**4.5c `TripCreatorStep2Itinerary.tsx`:**
- `TripDayDraft` now has `media`; `handleAddDay` seeds `media: []`. Thread `brandId`, `eventId` (the draft trip's id), and the three media handlers into each `TripDayEditor`. `handleDayChange` already merges partials — media handlers mutate `day.media` immutably and call `onChange`.
- The create-wizard saves days via `upsertTripDays` (existing autosave) — media now persists because `TripDayInput.media` is set from `TripDayDraft.media`.

**4.5d `EditPublishedTripScreen.tsx`:**
- State `days: TripDayDraft[]` mapping at line ~228 + ~357: add `media: d.media ?? []`.
- Day signature (lines 365-374): include media fingerprint so a media-only change sets `daysChanged=true` and `patch.days`.
- `patch.days` build (377-382): include `media: d.media` in each `TripDayInput`.
- Thread `brandId` (`trip.brandId`) + `eventId` (`trip.id`) + media handlers into the embedded `TripDayEditor` list (line ~1156).
- Change-summary (`computeTripDayDiffs` already updated) shows the media-changed rows as additive.
- Client guard `validateLiveTripFieldUpdate`: NO change — media edits don't touch capacity/dates/dropped-ordinals/inclusions/pricing, so they always pass the gate (correct).

### 4.6 Display components

**4.6a Consumer — `useConsumerTripDetail.ts` + `ConsumerTripDetailScreen.tsx`:**
- `TripDetailDay`: add `media: TripDayMedia[]` (import type).
- Anon select (line 169): change to `.select("id, ordinal, title, narrative, media")`; map `media: coerceTripDayMedia(d.media)`.
- `ConsumerTripDetailScreen` day card (after narrative, ~line 404): render the gallery when `day.media.length > 0` — a horizontal scroll/row of `EventCoverMedia` tiles: images `mediaType="image"`, videos `mediaType="video"` with the **one-playing guard** (track an `activeVideoKey` in screen state; only the in-view/tapped tile gets `playbackActive={true}`, all others `playbackActive={false}`; `autoplay` muted, `loop`, mirroring ORCH-1069). No gallery node when `media.length === 0`.

**4.6b Web + business preview — `usePublicTripBySlug.ts` + `TripPreview.tsx`:**
- `usePublicTripBySlug` already `.select("*")` on `trip_days` → returns `media`; in the `days.map` (line 171-181) add `media: coerceTripDayMedia(d.media)`.
- `TripPreview.tsx` day card (after narrative, line ~179): render the same `EventCoverMedia` gallery when `day.media.length > 0`. On web, `EventCoverMedia`'s `useInViewport` lazy-mount already bounds concurrent video decodes; apply the one-playing guard here too (only the first/in-view video autoplays).

### 4.7 Design contract (embedded — gallery is small, derived from existing tokens; no full mingla-designer pass required for an additive thumbnail row, but the implementor MUST honor these)
- Thumbnail tile: 96×96 (consumer/web) / 88×88 (editor), `borderRadius: radius.md`, `overflow:"hidden"`, horizontal gap `spacing.sm`, horizontal `ScrollView` (no wrap).
- Video tile: render `EventCoverMedia mediaType="video"` filling the tile with a small play-triangle glyph overlay (bottom-left) so a paused tile reads as video; tap → expands/plays inline (consumer) honoring the one-playing guard.
- Authoring remove affordance: a 22pt circular `×` top-right of each tile, `hitSlop:8`, `accessibilityLabel="Remove media {n}"`.
- Add tile: dashed `accent.border`, `+` glyph, label "Add", disabled (opacity 0.4) at cap.
- Android glass policy: tiles use opaque fills (`overflow:'hidden'` clip) per `ANDROID_GLASS_USES_OPAQUE_FALLBACK` — no translucent Android fills.
- A11y: each media tile `accessibilityRole="image"`/`"imagebutton"` with label `"{Trip day} media {n}, {image|video}"`; gallery container `accessibilityLabel="Day {n} media gallery"`.

---

## 5. Success criteria

- **SC-1 (DB):** `trip_days.media jsonb NOT NULL DEFAULT '[]'` exists with `trip_days_media_is_array` CHECK; existing rows backfill to `[]`. Verified by `\d trip_days` + a SELECT.
- **SC-2-iOS / SC-2-Android (authoring):** In the create wizard Step 2, tapping "Add media" on a day opens `TripDayMediaSheet`; choosing a device IMAGE and a device VIDEO appends two tiles; reordering and removing work; the day persists media through autosave (`upsertTripDays`). After publish, re-opening the trip shows the same media.
- **SC-3 (video upload):** A chosen `.mp4`/`.mov` ≤25 MB uploads to `event_covers/{brandId}/{eventId}/trip-day-media/...` and returns a public URL with `type:"video"`; a >25 MB file is rejected with a friendly toast (no silent failure); an unsupported MIME is rejected.
- **SC-4-iOS / SC-4-Android (consumer display):** On the consumer trip itinerary, a day WITH media shows the gallery (images render; videos autoplay muted, exactly ONE at a time); a day WITHOUT media shows NO gallery section (no empty frame).
- **SC-5-Web (anon buyer):** On `/t/{brandSlug}/{tripSlug}` logged-out, the per-day gallery renders; web video plays via `EventCoverWebVideo`; off-screen videos are lazy-mounted; a media-less day shows no gallery.
- **SC-6 (published-edit):** On a LIVE trip, adding/removing/reordering day media and saving (with a valid 10-200 char reason) persists via `biz_update_live_trip` (media-only change classifies **additive**, never blocked by sales); the change-summary shows an additive "Photos/videos updated" row; re-fetch shows the new media on consumer + web.
- **SC-7 (Constitution #9):** No layer ever fabricates or placeholders a gallery — `media:[]` ⇒ zero gallery DOM/RN nodes on consumer, web, preview, and editor (editor shows only the "+ Add" tile).
- **SC-8 (no scope leak):** `ExperienceStopPhotoSheet.tsx`, `experienceStopImageService.ts`, event cover code, and the `useEventCoverVideoUpload` pipeline are UNMODIFIED (git diff shows them untouched).

---

## 6. Invariants

- **Preserve I-1.2-UNIFIED-EVENT-TYPE** — media is a `trip_days` column; no new top-level table. Test: migration adds a column, not a table.
- **Preserve Constitution #9 (missing hidden)** — SC-7; regression test asserts zero gallery nodes for `media:[]`.
- **Preserve I-ANON-BRANDS-VIA-DEFINER-VIEW / COMMS-0009** — consumer fetch adds only `media` to the existing `trip_days` anon select; no new `brands`/`tickets` read. Test: grep `useConsumerTripDetail` for `.from("brands")`/`.from("tickets")` → none.
- **Preserve I-MOR-0827-PACKAGE-ISOLATION** — `EventCoverMedia` consumed as-is; `packages/event-rendering` unchanged. Test: git diff of the package = empty.
- **Preserve the day-dropped-with-sales refund gate** — media-only edits add no dropped ordinals. Test: SC-6 (live edit with sales succeeds on media-only change).
- **I-PROPOSED-TRIP-DAY-MEDIA-OPTIONAL-HIDDEN (DRAFT → ACTIVE on CLOSE)** — a zero-media day renders no gallery section on every surface.
- **I-PROPOSED-TRIP-DAY-MEDIA-EXPLICIT-TYPE (DRAFT → ACTIVE on CLOSE)** — every persisted media item carries an explicit `image|video` type; the renderer is never asked to auto-detect (ORCH-1069/0978 rule). `coerceTripDayMedia` drops any item missing a valid type.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T1 | Migration applies | run `20260927000000` | column + CHECK present; existing rows `[]` | DB |
| T2 | Coercer drops malformed | `[{url:"x",type:"image"},{type:"video"},{url:"y",type:"bogus"},"junk"]` | returns `[{url:"x",type:"image"}]` | service/util |
| T3 | Draft persists media | `upsertTripDays(eid,[{ordinal:1,title:"A",media:[{url:"u",type:"video"}]}])` | row has `media=[{url,type}]` | service+DB |
| T4 | Video too large rejected | 30 MB `.mp4` | `BrandCoverError`, friendly copy, no upload | service |
| T5 | Unsupported MIME rejected | `.txt` | rejected | service |
| T6 | Live-edit media-only with sales | LIVE trip w/ 1 sold order, add a day photo, valid reason | `{ok:true, severity:"additive"}`, media persisted, NOT `days_dropped_with_sales` | RPC |
| T7 | computeTripDayDiffs media-only | old day media `[]`, new `[{url,type:"image"}]`, same title/narrative | one diff `status:"modified", mediaChanged:true`, additive | util |
| T8 | Consumer zero-media | day `media:[]` | no gallery node rendered | component |
| T9 | Consumer one-playing guard | day with 2 videos | at most one `playbackActive={true}` | component |
| T10 | Web anon render | logged-out `/t/...` with media | gallery renders, video element present | web |
| T11 | Scope untouched | git diff | experience-stop + cover-video files unchanged | meta |

---

## 8. Implementation order

1. **DB** — `20260927000000_orch_1119_trip_day_media.sql` (column + CHECK). Apply via Supabase Management API (MCP read-only; CLI drift-wedged — per the edge-deploy/migration-apply hazards memory). Verify with a live `\d`.
2. **DB** — `20260927000001_orch_1119_live_trip_media.sql` (CREATE OR REPLACE `biz_update_live_trip` from the LATEST 20260911 body + §5b media + GRANT + NOTIFY). Apply + verify `src_len` changed.
3. **Service** — `tripDayMediaService.ts` (NEW) + `tripsService.ts` type/mapper/`upsertTripDays` edits + `coerceTripDayMedia`.
4. **Adapter** — `tripAdapter.ts` `TripDayDiff` + `computeTripDayDiffs` media awareness.
5. **Authoring** — `TripDayMediaSheet.tsx` (NEW) → `TripDayEditor.tsx` gallery + props → `TripCreatorStep2Itinerary.tsx` threading → `EditPublishedTripScreen.tsx` state/signature/patch/threading.
6. **Display** — `useConsumerTripDetail.ts` + `ConsumerTripDetailScreen.tsx`; `usePublicTripBySlug.ts` + `TripPreview.tsx`.
7. **Tests** — T1–T11; run jest gates; prove the regression test (§9) fails-on-revert.

### Allowlist (implementor MAY edit)
- `supabase/migrations/20260927000000_orch_1119_trip_day_media.sql` (NEW)
- `supabase/migrations/20260927000001_orch_1119_live_trip_media.sql` (NEW)
- `mingla-business/src/services/tripDayMediaService.ts` (NEW)
- `mingla-business/src/components/trip/TripDayMediaSheet.tsx` (NEW)
- `mingla-business/src/services/tripsService.ts`
- `mingla-business/src/utils/tripAdapter.ts`
- `mingla-business/src/components/trip/TripDayEditor.tsx`
- `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx`
- `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`
- `mingla-business/src/components/trip/TripPreview.tsx`
- `mingla-business/src/hooks/usePublicTripBySlug.ts`
- `app-mobile/src/hooks/useConsumerTripDetail.ts`
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`
- New test files under the relevant `__tests__/` dirs.

### DO-NOT-TOUCH (stop-and-amend before editing)
- `mingla-business/src/components/experience/ExperienceStopPhotoSheet.tsx`, `experienceStopImageService.ts`, any experience/event media code.
- `mingla-business/src/hooks/useEventCoverVideoUpload.ts`, `eventCoverVideoProcessingService.ts` (cover pipeline — do NOT reuse/modify).
- `packages/event-rendering/*` (consume `EventCoverMedia` only; no edits).
- `business_publish_trip_draft` RPC (no change needed).
- `publishedTripEditGuards.ts` (no media gate).
- `event-media` bucket (do not add a policy; we use `event_covers`).
- Any other migration than the two new ones.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** a jest test `orch1119_trip_day_media_persistence.test.ts` asserting that `upsertTripDays`'s INSERT row object includes a `media` key AND that `biz_update_live_trip`'s §5b migration source contains `media = EXCLUDED.media`. Plus a component test asserting `ConsumerTripDetailScreen` renders zero gallery nodes for `media:[]` and a gallery for non-empty media with the one-playing guard.

**Fails-on-revert:** reverting the `upsertTripDays` media addition (back to `stops:[]`-only) makes the persistence test FAIL (no `media` key); reverting the consumer render makes the display test FAIL (gallery missing for non-empty media). Both PASS when the fix is in place. Protective comment on the `media` INSERT key + the §5b SQL: `// ORCH-1119: per-day media MUST persist on both draft (upsertTripDays) and published-edit (biz_update_live_trip §5b) — reverting either silently drops galleries (see regression test).`

---

## 10. Open questions (each with a RECOMMENDED default — none left unresolved)

- **OQ-1 — Max media per day?** RECOMMENDED: **8** (generous vs experience-stop's 5; bounds web decode load). Adopt unless Seth objects.
- **OQ-2 — Per-item video size cap?** RECOMMENDED: **25 MB** (under the `event_covers` 30 MB bucket limit, headroom for upload overhead). No transcode (direct upload of the chosen file).
- **OQ-3 — Video duration cap?** RECOMMENDED: **none enforced client-side in v1** (the cover-video 29 s cap is a transcode-pipeline constraint that does not apply to direct gallery uploads; the 25 MB byte cap is the practical bound). If perf testing shows long clips hurt the list, add a soft 60 s cap in a follow-up. Flag for the tester to measure.
- **OQ-4 — GIF type mapping?** RECOMMENDED: store animated GIFs as `type:"image"` (renders correctly as an animated image via the `Image`/`EventCoverMedia` image path; avoids a third type). 
- **OQ-5 — Reorder UX in editor?** RECOMMENDED: tap-to-select + left/right move buttons (mirrors the existing day chevron pattern) rather than adding a drag dependency (consistent with TripDayEditor's deferred-drag decision). 
- **OQ-6 — Bucket choice `event_covers` vs new `event-media` policy?** RESOLVED in investigation (F-6): use `event_covers` (no new RLS policy needed; already video-capable). Recorded here for traceability, not open.

---

## 11. Downstream routing

**NEXT HANDOFF — mingla-implementor (business + consumer + DB):** Implement ORCH-1119 [trip-day media gallery] from this SPEC + the investigation, in worktree `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` on branch `ORCH-1119-trip-day-media-gallery`. Goal: optional per-day image+video gallery on trips (authoring + consumer + anon-web display), built per §4 with the allowlist/do-not-touch in §8. Inputs: this SPEC, the investigation report, the two new migrations (apply via Management API per the migration-apply hazards memory — MCP is read-only, CLI drift-wedged; base the RPC replacement on the LATEST 20260911 `biz_update_live_trip` body, NOT the 20260616 original). Hard constraints: trips-only, per-day-only, no shared abstraction, do NOT modify experience/event/cover-pipeline code, use `event_covers` bucket (no new bucket policy). Adopt every §10 RECOMMENDED default unless Seth has overridden. Output: implementation report under `Mingla_Artifacts/reports/`. Downstream: mingla-tester (adversarial — attack video size/duration, the one-playing guard, the media-only live-edit severity, Constitution #9 empty-state, and anon-web RLS read), then orchestrator CLOSE (flip the two `I-PROPOSED` invariants ACTIVE).
