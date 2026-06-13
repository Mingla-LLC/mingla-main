# INVESTIGATE — ORCH-1119 — Trip itinerary days: optional media gallery (images + videos)

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery` (rebased onto origin/main; 0 ahead / 0 behind at INVESTIGATE start).
**Phase:** INVESTIGATE (no fix proposed; SPEC follows in `specs/SPEC_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md`).
**Confidence:** `proven` for the data-model + persistence-hop map (live DB probes + verbatim source). `proven` for the reuse-vs-new breakdown. No reproducer bug here — this is a greenfield additive feature investigation, so the "live-fire a described bug" directive is N/A; the equivalent rigor (live DB schema + RLS + bucket probes) was applied.
**Comms ledger:** read on entry. No OPEN row targets `mingla-forensics`, `ORCH-1119`, or `ALL` that touches trip media. Standing WARN advisories exist but none touch trip-day media — no action, per dispatch.

---

## Symptom summary (feature gap, not a bug)

**Expected (target):** A brand creating/editing a TRIP can attach an OPTIONAL ordered gallery of images AND videos to each itinerary DAY; consumers (iOS/Android) and anonymous web buyers see that per-day gallery on the trip itinerary view, video playing through the existing `EventCoverMedia` renderer.

**Actual (today):** Trip days carry only `title` + `narrative` (+ unused `stops` jsonb, `date`). No media field exists at any layer — not in the `trip_days` table, not in any TS type, not in any authoring UI, not in any display surface. A per-day gallery cannot be authored or rendered.

---

## Investigation manifest (every file read, in trace order)

| # | File / object | Layer | Why |
|---|---|---|---|
| 1 | `COMMS_LEDGER.md` | docs | Mandatory entry scan |
| 2 | `mingla-business/src/services/tripsService.ts` | code (service) | Trip + TripDay types, day persistence (`upsertTripDays`, `updateLiveTripFields`), publish path |
| 3 | live DB: `information_schema.columns` / `pg_policy` for `public.trip_days` | schema/data | Ground-truth columns + RLS |
| 4 | `supabase/migrations/20260608000000_orch_0859_trip_sidecar_tables.sql` | schema | `trip_days` DDL + RLS origin |
| 5 | `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql` | schema | `business_publish_trip_draft` — does it write days? |
| 6 | `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql` | schema | `biz_update_live_trip` — how published days are upserted |
| 7 | `mingla-business/src/components/experience/ExperienceStopPhotoSheet.tsx` | code (component) | The closest precedent (per-stop photo picker) |
| 8 | `mingla-business/src/services/experienceStopImageService.ts` | code (service) | Precedent upload path: bucket + keying |
| 9 | `mingla-business/src/components/trip/TripDayEditor.tsx` | code (component) | Authoring day card — where the gallery section sits |
| 10 | `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` | code (component) | Day-list state owner (`TripDayDraft[]`) |
| 11 | `mingla-business/src/utils/tripAdapter.ts` | code (util) | `TripDayDiff` + change-summary diff |
| 12 | `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` | code (component) | Published-edit patch build |
| 13 | `mingla-business/src/utils/publishedTripEditGuards.ts` | code (util) | Client refund-gate mirror |
| 14 | `app-mobile/src/hooks/useConsumerTripDetail.ts` | code (hook) | Consumer DISPLAY fetch of `trip_days` |
| 15 | `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | code (component) | Consumer day render |
| 16 | `mingla-business/src/hooks/usePublicTripBySlug.ts` | code (hook) | Web public-trip fetch of `trip_days` |
| 17 | `mingla-business/src/components/trip/TripPreview.tsx` | code (component) | Web `/t/...` + business-preview day render |
| 18 | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | code (route) | Confirms web route renders `TripPreview` |
| 19 | `packages/event-rendering/EventCoverMedia.tsx` | code (package) | The mandated image/video renderer |
| 20 | `mingla-business/src/hooks/useEventCoverVideoUpload.ts` + `eventCoverVideoProcessingService` | code | Existing trip-cover VIDEO pipeline — reusable? |
| 21 | live DB: `storage.buckets` + `storage.objects` policies | data/schema | Which bucket + RLS for image+video brand-keyed upload |

---

## Q-scorecard

### Q1 — Where do trip days persist, and what is the exact column shape?
**Verdict (`proven`):** Real sidecar table `public.trip_days`, FK `event_id → events(id) ON DELETE CASCADE`, columns `id, event_id, ordinal(smallint), title(text NOT NULL), narrative(text), date(date), stops(jsonb DEFAULT '[]'), created_at, updated_at`. NO media column. `UNIQUE(event_id, ordinal)`. Days are NOT JSON on `events`. (Evidence F-1.)

### Q2 — How does a day round-trip across create → draft-save → publish → edit → consumer → web?
**Verdict (`proven`):** Six hops, all enumerated in F-2. Critical nuance: the **publish RPC does NOT write days from the payload** — it reads the already-persisted `trip_days` rows (written earlier by `upsertTripDays`) and only validates `count > 0`. So the DRAFT media write happens in `upsertTripDays`; the PUBLISHED-edit media write happens in `biz_update_live_trip`. (F-2, F-4, F-5.)

### Q3 — Is the experience per-stop photo sheet reusable as a model, and what must be NEW for video?
**Verdict (`proven`):** `ExperienceStopPhotoSheet` is the right MODEL (3-tab Library/GIFs/Photos picker, brand-keyed device upload, multi-select with a cap, append-public-URL contract) but is **images-only — it has NO video tab and uploads to the images-only `brand_covers` bucket**. NEW for v1: a video tab/path + a video-capable bucket + a `{url,type}` shape instead of bare `string[]`. (F-3, F-6.)

### Q4 — Can the existing trip-cover VIDEO pipeline (`useEventCoverVideoUpload`) be reused for a per-day gallery?
**Verdict (`proven`): NO — and this is the single most important contained-scope decision.** That pipeline is a heavy server-side transcode job (intent → upload → transcode → webhook) that writes the SINGLE `events.cover_media_*` column set and is keyed one-cover-per-event. A per-day gallery needs MANY videos per trip stored as URLs in a sidecar — it cannot ride the single-column auto-apply pipeline. The reusable video asset is the RENDERER (`EventCoverMedia`) and the video-capable Storage bucket, NOT the cover upload pipeline. (F-7.)

### Q5 — Which Storage bucket + keying supports brand-authored IMAGE *and* VIDEO upload at trip-day-edit time?
**Verdict (`proven`):** `event_covers` (public, 30 MB cap, MIME allows `image/* + video/mp4 + video/quicktime + video/webm`) with brand-keyed-via-event RLS `brandId/eventId/...` (2-segment). The trip's `events` row already exists before day editing (createTripDraft runs first), so the 2-segment key is satisfiable for both create-draft and published-edit. `brand_covers` (used by experience stops) is **images-only** so cannot hold day videos. `event-media` (50 MB, video-capable) exists but has **NO write RLS policy and zero code references** — usable only if a new policy is added; `event_covers` needs no new policy. (F-6, F-8.)

### Q6 — Where do consumers + anon web render days, so the gallery slots in?
**Verdict (`proven`):** Exactly two render surfaces, both already import `EventCoverMedia` from `@mingla/event-rendering`:
- Consumer iOS/Android: `ConsumerTripDetailScreen.tsx:399-404` (the `detail.days.map(...)` day card), fed by `useConsumerTripDetail.ts:169` anon-direct `trip_days` select.
- Anon web `/t/{brandSlug}/{tripSlug}` AND business preview: both render `TripPreview.tsx:174-180` (`trip.days.map(...)`), web fed by `usePublicTripBySlug.ts:93-97`. (F-9, F-10.)

### Q7 — How does the per-day `media[]` flow through draft-save, published-edit, and the change-summary?
**Verdict (`proven`):** Draft: add `media` to `TripDayInput` + the `upsertTripDays` INSERT (currently hardcodes `stops:[]`, drops media). Published-edit: add `media` to the `biz_update_live_trip` §5b upsert (currently writes only `ordinal,title,narrative`). Change-summary: `computeTripDayDiffs` / `TripDayDiff` compare only title+narrative — a media-only change is currently invisible; needs a `mediaChanged` flag (additive severity). (F-4, F-5, F-11.)

---

## Findings (F-1 … F-11, six-field evidence)

### F-1 — `trip_days` is a real sidecar table with NO media column — CONFIRMED ROOT-OF-WORK
- **Symptom:** No per-day media can be stored.
- **Layer:** schema / data.
- **Probe:** `SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='trip_days'` (live, project gqnoajqerqhnvulmnyvv) + read `20260608000000_orch_0859_trip_sidecar_tables.sql:34-45`.
- **Evidence:** Columns returned: `id(uuid), event_id(uuid NOT NULL), ordinal(smallint NOT NULL), title(text NOT NULL), narrative(text), date(date), stops(jsonb NOT NULL DEFAULT '[]'), created_at, updated_at`. DDL has `UNIQUE (event_id, ordinal)` + `CHECK (ordinal > 0)` + `CHECK (length(trim(title)) > 0)`. RLS (live `pg_policy`): `trip_days_read_published_or_member` (SELECT: published-status OR brand member) + `trip_days_write_brand_members` (ALL: brand member, USING+WITH CHECK). No `media` column anywhere.
- **Mechanism:** A new persisted column/structure is required; the cleanest is a `media jsonb NOT NULL DEFAULT '[]'` column on `trip_days` (matches the existing `stops jsonb` precedent and the table's small row count). Existing read RLS already covers it (column-level reads inherit row policy); no RLS change needed for the new column.
- **Severity:** CONFIRMED — the migration is the foundation of the build.

### F-2 — Day round-trip is six hops; publish RPC reads days, does NOT write them — CONFIRMED
- **Symptom:** N/A (architecture fact that dictates where media writes go).
- **Layer:** code + schema.
- **Probe:** Read `tripsService.ts` (`createTripDraft` 531-629, `upsertTripDays` 898-928, `publishTrip` 1076-1101, `updateLiveTripFields` 1219-1282, `getTrip` 633-701) + publish RPC `20260608000100:159-163,264-267` + live-edit RPC `20260616000000:390-407`.
- **Evidence:** Hop map:
  1. **Create:** `createTripDraft` inserts the `events` row (`event_type='trip'`) — days NOT yet created.
  2. **Draft day save:** `upsertTripDays(eventId, TripDayInput[])` DELETE-then-INSERT into `trip_days`; INSERT row literal is `{event_id, ordinal, title, narrative, date, stops:[]}` (`tripsService.ts:912-919`).
  3. **Publish:** `publishTrip` → `business_publish_trip_draft` RPC. The RPC `SELECT count(*) … FROM trip_days` (line 159) only — it never inserts/updates day rows from `p_draft_payload`. It re-reads `trip_days` into the composite return (line 264-267).
  4. **Re-load for edit:** `getTrip` selects `trip_days.*` (line 658-662) → `mapTripDay` (301-311).
  5. **Consumer fetch:** `useConsumerTripDetail.fetchTripDetail` anon-selects `trip_days` `id,ordinal,title,narrative` (169).
  6. **Web fetch:** `usePublicTripBySlug` anon-selects `trip_days.*` (93-97) → maps to `TripDay`.
- **Mechanism:** Because publish reads (not writes) days, per-day media must be added to (a) `upsertTripDays` INSERT for the create/draft path and (b) the `biz_update_live_trip` upsert for the published-edit path — and surfaced in every read mapper (getTrip, consumer, web).
- **Severity:** CONFIRMED.

### F-3 — `ExperienceStopPhotoSheet` is the model; it is images-only — CONFIRMED
- **Layer:** code.
- **Probe:** Read `ExperienceStopPhotoSheet.tsx` (full) + `experienceStopImageService.ts` (full).
- **Evidence:** Sheet header comment line 7-9: "EXCEPT there is NO video tab/path for stops (stops own a `string[]` of still images, capped at 5)." `MAX_STOP_PHOTOS = 5` (line 87). Tabs = Library/GIFs/Photos (88-100). Device upload via `uploadExperienceStopImage` returns a public URL appended to the stop's `imageUrls` (123-124, 341-348). `pickFromLibrary` constrains `mediaTypes:["images"]` (327) + `accept:"image/jpeg,image/png,image/webp,image/gif"` (286).
- **Mechanism:** Reusable as the SHEET ARCHITECTURE (tabbed picker, multi-select cap, append-URL contract, error/empty/loading states, masonry grid, Sheet host). NOT reusable verbatim because v1 must also accept video (Library tab adds a video path; data shape becomes `{url,type}` not bare string). Per the locked scope, this sheet is COPIED/adapted into a trips-only component — NOT shared.
- **Severity:** CONFIRMED (reuse model).

### F-4 — Draft write path drops media — `upsertTripDays` INSERT is hardcoded — CONFIRMED
- **Layer:** code (service).
- **Probe:** Read `tripsService.ts:898-928` + `TripDayInput` 171-176.
- **Evidence:** `TripDayInput = {ordinal, title, narrative?, date?}` — no media. `upsertTripDays` insert rows: `{event_id, ordinal, title, narrative: d.narrative ?? null, date: d.date ?? null, stops: []}` — no media key.
- **Mechanism:** Adding `media?: TripDayMedia[]` to `TripDayInput` and `media: d.media ?? []` to the INSERT carries draft media to the DB.
- **Severity:** CONFIRMED.

### F-5 — Published-edit write path drops media — `biz_update_live_trip` §5b upsert is title/narrative-only — CONFIRMED
- **Layer:** schema (RPC).
- **Probe:** Read `20260616000000_orch_0876_trip_published_edit.sql:390-407`.
- **Evidence:** §5b: `INSERT INTO public.trip_days (event_id, ordinal, title, narrative) SELECT … FROM jsonb_array_elements(p_patch->'days') d ON CONFLICT (event_id, ordinal) DO UPDATE SET title=EXCLUDED.title, narrative=EXCLUDED.narrative;` — `media` (and `stops`) are not in the column list and not in the conflict update.
- **Mechanism:** The RPC must be replaced (CREATE OR REPLACE) to also write `media` from `d->'media'` in both the INSERT column list and the `ON CONFLICT DO UPDATE SET`. The day-dropped-with-sales refund gate (4c, 260-286) keys on `ordinal` and is unaffected by media (media-only edits change no ordinals → additive, no refund). `LiveTripPatch.days: TripDayInput[]` (`tripsService.ts:1157`) carries the new media automatically once `TripDayInput` gains the field.
- **Severity:** CONFIRMED.

### F-6 — `event_covers` is the correct bucket for image+video brand-authored day media — CONFIRMED
- **Layer:** data/schema (storage).
- **Probe:** `SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets` + `pg_policy` on `storage.objects` filtered to `event_covers` / `brand_covers` / `event-media` (live).
- **Evidence:**
  - `event_covers`: public=true, limit=31457280 (30 MB), MIME=`{image/gif,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm}`. RLS: upload/update/delete require `array_length(storage.foldername(name),1)=2` AND an `events` row matching `foldername[1]=brand_id` AND `foldername[2]=event.id` AND caller rank ≥ `event_manager` (the 2-segment `brandId/eventId/` key). Public read: any object in bucket.
  - `brand_covers`: public, 8 MB, MIME images-only (`image/jpeg,png,webp,gif`) — **no video**. RLS keys on 1-segment `brandId` (`split_part(name,'/',1)`). Used by `uploadExperienceStopImage`.
  - `event-media`: public, 50 MB, video-capable, but **zero write RLS policies** and **zero code references** (`grep event-media` → empty in src + migrations).
- **Mechanism:** Trip days are authored AFTER the `events` row exists, so the 2-segment `event_covers` key `{brandId}/{eventId}/trip-day-media/{token}.{ext}` is satisfiable at both create-draft and published-edit time, reuses the existing brand-keyed RLS with NO new storage policy, and natively allows image + the three video MIME types. This is the lowest-new-surface choice.
- **Severity:** CONFIRMED (infrastructure decision).

### F-7 — The cover-video pipeline is NOT reusable for a per-day gallery — CONFIRMED
- **Layer:** code.
- **Probe:** Read `useEventCoverVideoUpload.ts` (full) + service imports.
- **Evidence:** Pipeline = `compressVideoLocally → createEventCoverVideoUploadIntent → uploadEventCoverVideoSource → acknowledge → waitForEventCoverVideoReady → (apply)`; keyed on a single `eventId`; the "apply" writes `events.cover_media_url`/`cover_media_type='video'` (lines 35-39, 166-172). 29 s duration cap enforced by `event_cover_video_jobs` CHECK constraints (`20260730000000_orch_0978_video_cap_29s_constraints.sql`).
- **Mechanism:** This produces ONE processed cover per event and auto-applies to the single column — structurally wrong for many videos per trip stored as a list. Reusing it would require per-media job rows + a new apply target, far exceeding "contained / trips-only." The contained path is a DIRECT storage upload (like `uploadExperienceStopImage`) of the raw chosen video to `event_covers`, returning a public URL, plus client-side guards (size/duration). Playback reuses `EventCoverMedia` with explicit `mediaType="video"`.
- **Severity:** CONFIRMED (do-NOT-reuse).

### F-8 — `readBrandCoverFileBytes` already works for any file type (video included) — CONFIRMED
- **Layer:** code.
- **Probe:** Read `brandCoverFileReader.ts` web split (`fetch(uri).arrayBuffer()`).
- **Evidence:** Reader is content-type-agnostic — `fetch → arrayBuffer → Uint8Array`. The `experienceStopImageService` upload mechanics (size guard → byte read → `supabase.storage.upload` → `getPublicUrl` → verify) are MIME-parameterized; pointing them at `event_covers` with video MIME + a larger cap is a small, contained variant.
- **Mechanism:** A new `tripDayMediaService.uploadTripDayMedia(brandId, eventId, asset)` can mirror `uploadExperienceStopImage` almost verbatim, swapping bucket (`event_covers`), key (`{brandId}/{eventId}/trip-day-media/{token}.{ext}`), and the accepted MIME/size set (add video).
- **Severity:** CONFIRMED (reuse mechanics).

### F-9 — Consumer day render is a single map at `ConsumerTripDetailScreen.tsx:399` — CONFIRMED
- **Layer:** code.
- **Probe:** Read `ConsumerTripDetailScreen.tsx:396-404` + import line 56 + `useConsumerTripDetail.ts:24-29,169,188-193`.
- **Evidence:** `detail.days.map((day) => (<View key={day.id}><Text>DAY {day.ordinal}</Text><Text>{day.title}</Text>{day.narrative…}</View>))`. Import already pulls `EventCoverMedia` from `@mingla/event-rendering` (line 56). `useConsumerTripDetail` `TripDetailDay = {id,ordinal,title,narrative}` (no media) and selects `id,ordinal,title,narrative` (169).
- **Mechanism:** Add `media` to the anon select + `TripDetailDay` + render an `EventCoverMedia`-based gallery row inside the day card (after narrative). Anon SELECT on `trip_days` already permitted by `trip_days_read_published_or_member` for published trips.
- **Severity:** CONFIRMED.

### F-10 — Web + business preview day render is `TripPreview.tsx:174`, fed by `usePublicTripBySlug` — CONFIRMED
- **Layer:** code.
- **Probe:** Read `TripPreview.tsx:170-180`; `usePublicTripBySlug.ts:93-97,171-181`; `app/t/[brandSlug]/[tripSlug].tsx` (renders TripPreview).
- **Evidence:** `usePublicTripBySlug` selects `trip_days.*` (93) and maps to full `TripDay` including `stops` (171-181) — so once the table has `media`, `.select("*")` already returns it; only the `TripDay` mapper + `TripPreview` render need the field. `TripPreview.tsx:174` `trip.days.map((day: TripDay) => …)`. `app/t/[brandSlug]/[tripSlug].tsx` is the anon public route rendering TripPreview.
- **Mechanism:** Add `media` to `TripDay` (service type) + the two web mappers + render `EventCoverMedia` gallery in `TripPreview`'s day card. Web video playback already supported by `EventCoverMedia`'s `EventCoverWebVideo` + lazy-mount (`useInViewport`).
- **Severity:** CONFIRMED.

### F-11 — Change-summary + diff are title/narrative-only; media-only edits are invisible — SECONDARY (must address)
- **Layer:** code.
- **Probe:** Read `tripAdapter.ts:112-119,189-237` + `EditPublishedTripScreen.tsx:357-385`.
- **Evidence:** `TripDayDiff` carries only title/narrative. `computeTripDayDiffs` marks a day "modified" only when `title` or `narrative` differs (209-212). `EditPublishedTripScreen` builds `oldDaysSig`/`newDaysSig` from `{ordinal,title,narrative}` only (372-374) → a media-only change produces NO diff → `daysChanged=false` → `patch.days` is not set → the media write never fires.
- **Mechanism:** The day signature + `TripDayDiff` + `computeTripDayDiffs` must include a media fingerprint (e.g. JSON of the ordered media url+type list) so a media-only edit sets `patch.days` and surfaces an additive change-summary row. Severity stays **additive** (adding/removing day photos is buyer-safe; no refund gate).
- **Severity:** SECONDARY ROOT CAUSE (the feature silently no-ops on published-edit without this).

---

## Five-Truth-Layer reconciliation

| Layer | State | Contradiction? |
|---|---|---|
| **Docs** | MEMORY + META-ORCH-1059 note: experiences got per-stop photos (images-only). No doc claims trip days have media. Dispatch defines the target. | None — target is net-new. |
| **Schema** | `trip_days` has no media column; `event_covers` bucket allows image+video with brand/event-keyed RLS; publish RPC reads days; live-edit RPC writes only title/narrative. | **C-1:** live-edit RPC write list (title/narrative) vs the new requirement (must add media). Truth = RPC must be replaced. |
| **Code** | Types (`TripDay`, `TripDayInput`, `TripDayDraft`, `TripDayDiff`, `TripDetailDay`) all lack media; authoring/display surfaces lack a gallery; `EventCoverMedia` renderer + experience-stop precedent + content-agnostic file reader all present. | **C-2:** `EditPublishedTripScreen` day-signature omits media → media-only edit no-ops (F-11). Truth = signature must include media. |
| **Runtime** | Not separately driven — greenfield additive feature, no reproducer bug. DB/RLS/bucket probes stand in for runtime truth. | N/A |
| **Data** | Live `trip_days` rows have no media; `event_covers` bucket live + public + video-capable; `event-media` bucket exists but unused/no-policy. | None. |

Every contradiction (C-1, C-2) is a build requirement captured in the SPEC, not a pre-existing defect.

---

## Repro evidence

No reproducer bug — this is an additive feature. Equivalent rigor applied via live DB probes (project gqnoajqerqhnvulmnyvv, read-only): `trip_days` columns + RLS, `storage.buckets` (all 18), `storage.objects` policies for `event_covers`/`brand_covers`/`event-media`, and `list_migrations` (remote max = `20260926000000`). All probe outputs pasted verbatim in F-1/F-6 and the migration-version section. No simulator drive needed; flagged honestly.

---

## Blast radius / cross-surface map

**In-scope surfaces (5):**
- Consumer iOS — `ConsumerTripDetailScreen.tsx` + `useConsumerTripDetail.ts` (gallery render + anon fetch).
- Consumer Android — same shared RN code (automatic parity; video via `EventCoverNativeVideo`).
- Buyer/anon Web — `app/t/[brandSlug]/[tripSlug].tsx` → `TripPreview.tsx` + `usePublicTripBySlug.ts` (gallery render + anon fetch; web video via `EventCoverWebVideo`).
- Business iOS — `TripDayEditor.tsx` + new add-media sheet + `TripCreatorStep2Itinerary.tsx` + `EditPublishedTripScreen.tsx` + `tripDayMediaService` + `upsertTripDays`/`updateLiveTripFields`.
- Business Android — same shared RN authoring code (automatic parity).

**Adjacent / NOT in scope:**
- Admin Web — no trip-day authoring or display; untouched.
- Business Web preview — `TripPreview` IS the business preview AND the web public page (same component), so it IS covered (counts under Buyer/anon Web + business preview together).
- Experiences/events media — explicitly OUT (locked scope: trips-only, no shared abstraction). `ExperienceStopPhotoSheet` is COPIED-as-model, not refactored.

**Cache keys touched:** `consumerTripDetailKeys.detail`, `tripKeys.publicBySlug`, business `tripKeys.detail` — all already invalidated by existing trip mutations; the new media write rides the same `getTrip`/`updateLiveTripFields` refresh.

**Recurring-pattern note:** This is the THIRD media-on-a-child-row feature (event cover, experience stop photos, now trip-day gallery). The locked scope forbids unifying them now, but the SPEC flags a future `I-PROPOSED` consolidation ORCH.

---

## Invariant impact (flagged, NOT pre-decided)

- **I-1.2-UNIFIED-EVENT-TYPE** — preserved: trips stay `events` rows + sidecar tables; media is a `trip_days` column, no new top-level table.
- **Constitution #9 (missing is hidden, never faked)** — the gallery section MUST be entirely absent when a day has zero media (no empty frame, no placeholder). Drives a success criterion.
- **I-MUTATION-ROWCOUNT** — `upsertTripDays` already carries an `I-MUTATION-ROWCOUNT-WAIVER` (DELETE-then-INSERT); the media addition inherits it.
- **I-ANON-BRANDS-VIA-DEFINER-VIEW / COMMS-0009** — consumer fetch must NOT add any `brands`/`tickets` direct read; media rides the existing anon-direct `trip_days` select only.
- **I-MOR-0827-PACKAGE-ISOLATION** — `EventCoverMedia` stays package-isolated; the gallery consumes it as-is, adds nothing to the package.
- **New (proposed in SPEC as DRAFT):** `I-PROPOSED-TRIP-DAY-MEDIA-OPTIONAL-HIDDEN` (zero-media day renders no gallery) + `I-PROPOSED-TRIP-DAY-MEDIA-EXPLICIT-TYPE` (every media item persists an explicit `image|video` type; renderer never auto-detects, per ORCH-1069/0978).

---

## Discoveries for Orchestrator

1. **`event-media` bucket is dead infrastructure** (public, 50 MB, video-capable, but zero RLS write policies + zero code refs). Not used by this ORCH (we use `event_covers`), but it's an orphan worth a cleanup note.
2. **`TripDayDraft` omits `date`** (`TripDayEditor.tsx:23-27`) even though `trip_days.date` exists and `TripDayInput` carries it — pre-existing, unrelated to this ORCH; the wizard never sets per-day dates. Flagging, not fixing.
3. **Recurring media-on-child-row pattern** (cover / experience-stop / trip-day) — candidate for a future shared `OfferingMediaGallery` ORCH once 3 instances exist; explicitly deferred per locked scope.

---

## Confidence

`proven` — every conclusion is backed by a verbatim source line or a live DB/storage probe pasted in-finding. The two contradictions (C-1 live-edit RPC, C-2 day-signature) are mechanically traced. No source-only leaps. The one judgment call (bucket choice) is decided on hard RLS + MIME + cap evidence with the alternative (`event-media`) explicitly costed.

## Recommended next phase + scope

**SPEC** (this same skill, IA mode), scope LOCKED exactly as dispatched: per-day only, trips-only, images+video, no shared abstraction. The SPEC must specify: the `trip_days.media` migration (version `20260927000000`), the `TripDayMedia` shape, every type edit, the new `tripDayMediaService` (direct `event_covers` upload), the adapted trips-only add-media sheet, `TripDayEditor` gallery section, the `biz_update_live_trip` replacement + day-signature/diff media-awareness, and the two display surfaces' galleries. No fix proposed here.
