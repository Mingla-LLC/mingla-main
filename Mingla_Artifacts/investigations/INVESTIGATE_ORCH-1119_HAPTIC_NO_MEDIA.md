# INVESTIGATE — ORCH-1119 [trip-day-media-gallery] · "haptic but no media tile"

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery` · HEAD `90d4397f5`
**Date:** 2026-06-12
**Phase:** INVESTIGATE (no fix proposed)
**Confidence:** **root cause PROVEN** (live-DB policy arithmetic against a real trip's brand/event IDs + zero-objects-ever-landed evidence; the failing predicate is deterministic, not probabilistic)

---

## 1. Symptom (expected vs actual)

- **Reproducer (Seth, physical iPhone, ORCH-1119 dev bundle):** Business app → trip create wizard → Step 2 (Itinerary) → a day's "+ Add media" → Library → "Choose from library" → multi-select → confirm.
- **Expected:** chosen images/videos upload, append to the day's `media[]`, and render as 88×88 tiles in that day's horizontal gallery.
- **Actual:** a **haptic fires** on confirm, but **no tiles appear**. No visible error.
- **First real exercise of the SUCCESS happy path.** The tester only proved rejections (>25MB / bad MIME) + the DB/RPC layer; the successful upload→append→render round-trip was never runtime-proven (the HITL gap).

---

## 2. Investigation manifest (files read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `mingla-business/src/services/tripDayMediaService.ts` | service/upload | the upload + storage-key construction |
| 2 | `mingla-business/src/components/trip/TripDayMediaSheet.tsx` | component | where haptic fires + `onAddMedia` batch call + close-on-success |
| 3 | `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` | component/state | `handleAddMediaToDay` append + sheet host |
| 4 | `mingla-business/src/components/trip/TripDayEditor.tsx` | component/render | the gallery `media.map` tile render |
| 5 | `mingla-business/src/components/trip/TripCreatorWizard.tsx` | component/state | Step2 wiring (`days`/`onChange`/`brandId`/`eventId`/`showToast`) + root Toast |
| 6 | `mingla-business/src/components/ui/SheetMobile.tsx` | primitive | the Sheet is a native `Modal` portal (toast occlusion) |
| 7 | `supabase/migrations/20260928000000_orch_1119_trip_day_media.sql` | schema | "NO RLS change" — column-only migration |
| 8 | `supabase/migrations/20260928000001_orch_1119_live_trip_media.sql` | schema | `biz_update_live_trip` media persistence (unrelated to upload) |
| 9 | live `storage.objects` RLS policies (project `gqnoajqerqhnvulmnyvv`) | data/RLS | the actual INSERT predicate vs the trip-day key |
| 10 | `Mingla_Artifacts/specs/SPEC_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md` | docs | the spec's "2-segment" premise |

---

## 3. Q-scorecard

- **Q1 — Does the upload SUCCEED (does an object land in `event_covers/{brandId}/{eventId}/trip-day-media/`)?**
  **Verdict: NO — PROVEN.** The `event_covers` INSERT RLS policy requires `array_length(storage.foldername(name),1) = 2`; the trip-day key has **3** folder segments, so every upload is RLS-403-rejected. Zero objects have ever landed under `%trip-day-media%`. (F-1, F-2)

- **Q2 — Is there a SILENT failure (Constitution #3)?**
  **Verdict: PARTIAL — the error toast IS fired but is INVISIBLE.** `uploadTripDayMedia` throws → caught per-item → `firstError` set → `warnHaptic()` (the haptic Seth feels) → `onShowToast(firstError)`. But the sheet does NOT `onClose()` on a 0-success batch, so the full-screen **native-Modal** sheet stays mounted on top, and the wizard-root `Toast` (a plain in-tree absolute `View`) renders BEHIND the Modal portal → the user never sees it. Effective silent failure. (F-3)

- **Q3 — Does `onAddMedia` fire / does `media[]` append?**
  **Verdict: NO — but the append code is CORRECT.** `onAddMedia(uploaded)` is only called when `uploaded.length > 0` (sheet L375). Because every upload throws (Q1), `uploaded` is empty, so `onAddMedia` is never called. The batch-append logic (`handleAddMediaToDay`, REWORK) and the Success haptic both require ≥1 successful upload and are never reached. (F-4)

- **Q4 — Does the gallery RENDER appended media?**
  **Verdict: render path is CORRECT (not the defect).** `TripDayEditor` `media.map` renders image/video tiles correctly; `media[]` simply never grows because of Q1. RULED OUT as the break. (F-5)

- **Q5 — Images vs video?**
  **Verdict: BOTH fail identically.** The break is the storage key's segment count, which is independent of MIME/type. Neither image nor video can upload. (F-1)

- **Q6 — Is this an implementor deviation or a spec/investigation defect?**
  **Verdict: SPEC-LEVEL analytical error, faithfully implemented.** The SPEC repeatedly asserts a "2-segment key" satisfies the RLS (§ lines 37/129/290, F-6 "RESOLVED"). It is a **3-segment** key. The implementor built exactly what the SPEC prescribed. (F-6)

---

## 4. Findings (six-field evidence)

### F-1 · `event_covers` INSERT RLS rejects the 3-segment trip-day key — **CONFIRMED ROOT CAUSE**

1. **Symptom:** Upload silently fails; no tile; no object in storage.
2. **Layer:** data / RLS (storage.objects).
3. **Probe (live, read-only, project `gqnoajqerqhnvulmnyvv`):**
   ```sql
   select policyname, cmd, with_check from pg_policies
   where schemaname='storage' and tablename='objects' and with_check ilike '%event_covers%';
   ```
   and the path arithmetic:
   ```sql
   select array_length(storage.foldername('brand/event/trip-day-media/tok.mp4'),1) as trip_day_len,
          array_length(storage.foldername('brand/event/cover.jpg'),1)               as cover_len;
   ```
4. **Evidence (verbatim):**
   - INSERT policy "**Event managers can upload event covers**" `with_check`:
     `((bucket_id = 'event_covers') AND (array_length(storage.foldername(name), 1) = 2) AND (storage.filename(name) <> '') AND (EXISTS (SELECT 1 FROM events e WHERE ((e.brand_id)::text = (storage.foldername(objects.name))[1] AND (e.id)::text = (storage.foldername(objects.name))[2] AND e.deleted_at IS NULL AND biz_brand_effective_rank_for_caller(e.brand_id) >= biz_role_rank('event_manager')))))`
   - `trip_day_len = 3`, `cover_len = 2`.
   - Against a **real trip** (brand `22a18413-…`, event `61980280-…`): `trip_day_seg_len = 3`, and `foldername[2]` for the trip-day key = the eventId (so the EXISTS identity check would PASS) — but `array_length = 2` FAILS. **The single failing predicate is the segment-count guard.**
   - Service code that builds the rejected key — `tripDayMediaService.ts:163`:
     `const storagePath = `${brandId}/${eventId}/trip-day-media/${token}.${ext}`;`
     then `.upload(storagePath, bytes, …)` (L165-167) → on `uploadError` throws `BrandCoverError("upload_failed", …)` (L169-174).
5. **Mechanism:** The 4-segment path (`brand/event/trip-day-media/file`) has 3 folder segments; the INSERT policy's `array_length(...) = 2` clause is false → Postgres RLS denies the INSERT → `supabase.storage.upload` returns a 403 error → service throws → no append.
6. **Severity:** `CONFIRMED ROOT CAUSE`.

### F-2 · Zero objects ever landed under the trip-day prefix — **corroborating evidence**

1. **Symptom:** No successful upload has EVER occurred.
2. **Layer:** data.
3. **Probe:** `select count(*) … from storage.objects where bucket_id='event_covers' and name like '%trip-day-media%'`.
4. **Evidence:** `[]` (zero rows).
5. **Mechanism:** Consistent with F-1 — the policy has rejected every attempt since the feature shipped to the dev bundle.
6. **Severity:** `SECONDARY ROOT CAUSE` (corroboration of F-1).

### F-3 · Error toast is occluded by the still-open native-Modal sheet — **SECONDARY ROOT CAUSE** (the "no visible error" half)

1. **Symptom:** "Haptic but nothing visible + no error."
2. **Layer:** code (component).
3. **Probe:** read `TripDayMediaSheet.tsx` L375-393 + `TripCreatorWizard.tsx` L1436-1443 + `SheetMobile.tsx` L40/279-288.
4. **Evidence:**
   - Sheet L384-391: on failure `warnHaptic(); onShowToast(firstError)`. Sheet L393: `if (uploaded.length > 0) onClose();` → **on a 0-success batch the sheet does NOT close.**
   - Wizard L1436: `<View style={styles.toastWrap}…><Toast … /></View>` is a plain in-tree absolute View (`toastWrap`: `position:absolute, top:0`).
   - `SheetMobile.tsx` L40/279-288: the Sheet content is wrapped in React Native `<Modal transparent statusBarTranslucent>` — a **separate OS-level portal above the entire React tree**.
5. **Mechanism:** The friendly error toast IS dispatched, but it renders in the normal tree behind the full-screen native Modal that stays open (no close-on-failure) → the user sees only the haptic, never the toast → effective silent failure (Constitution #3).
6. **Severity:** `SECONDARY ROOT CAUSE`. Even after F-1 is fixed, this masks ANY future upload failure (network, verify-url, large file) and should be addressed.

### F-4 · `onAddMedia` / batch append never reached — **RULED OUT as defect (code correct)**

1. **Symptom:** `media[]` doesn't grow.
2. **Layer:** code.
3. **Probe:** read `TripDayMediaSheet.tsx` L350-393 + `TripCreatorStep2Itinerary.tsx` L80-90.
4. **Evidence:** `onAddMedia(uploaded)` is gated on `uploaded.length > 0` (L375). `handleAddMediaToDay` appends immutably and re-enforces the cap (L80-90) — correct. The Success haptic (L377-381) is also gated on `uploaded.length > 0`.
5. **Mechanism:** Both are correct but unreachable because every upload throws (F-1). The REWORK batch-append is sound; it is simply never exercised.
6. **Severity:** `RULED OUT`.

### F-5 · Gallery render path — **RULED OUT as defect (code correct)**

1. **Symptom:** No tile.
2. **Layer:** code (render).
3. **Probe:** read `TripDayEditor.tsx` L176-259.
4. **Evidence:** `media.map` renders `EventCoverMedia` (video) or `Image` (image) tiles keyed `${m.url}-${mi}`; `mediaEnabled` is satisfied (brandId/eventId/onAddMedia/onRemoveMedia all threaded from Step2 L162-176 / Wizard L1230-1236).
5. **Mechanism:** Render is correct; it has nothing to render because `media[]` never grows (F-1/F-4).
6. **Severity:** `RULED OUT`.

### F-6 · SPEC's "2-segment key satisfies RLS" premise is FALSE — **CONFIRMED (root-cause origin)**

1. **Symptom:** The whole upload design was built on a miscount.
2. **Layer:** docs (spec) → propagated to code + the column migration's "NO RLS change".
3. **Probe:** `grep -n "2-segment\|foldername\|array_length\|RLS" SPEC_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md`.
4. **Evidence:**
   - SPEC L37: "makes the **2-segment** `event_covers` key `{brandId}/{eventId}/...` satisfiable".
   - SPEC L127: prescribes `storagePath = `${brandId}/${eventId}/trip-day-media/${token}.${ext}`` — actually **3 segments**.
   - SPEC L129: "The **2-segment** key satisfies `event_covers` RLS (F-6): `foldername[1]=brandId`, `foldername[2]=eventId`".
   - SPEC L290: "OQ-6 … RESOLVED in investigation (F-6): use `event_covers` (no new RLS policy needed)".
   - Migration `20260928000000` L10: "**NO RLS change**".
5. **Mechanism:** The investigation/SPEC counted only `brandId`+`eventId` and ignored the literal `trip-day-media/` folder segment, concluding "2-segment, no policy needed." The implementor faithfully built the 3-segment key with no new policy → guaranteed RLS rejection. Not an implementor deviation.
6. **Severity:** `CONFIRMED ROOT CAUSE` (analytical origin of F-1).

---

## 5. Five-Truth-Layer reconciliation

| Layer | Says | Truth? |
|-------|------|--------|
| **Docs (SPEC)** | "2-segment key, no RLS policy needed" | **FALSE** — the prescribed key is 3-segment. |
| **Schema (migrations)** | column-only; "NO RLS change" | True to its word — but that's exactly the gap (no policy permits the 3-seg key). |
| **Code** | builds `brand/event/trip-day-media/token.ext` and uploads | Faithful to SPEC; the key the storage layer rejects. |
| **Runtime** | upload → 403 → throw → warn haptic → toast (occluded) → no append | The observed symptom. |
| **Data** | INSERT policy `array_length=2`; zero trip-day objects ever | The authority. **Contradiction with Docs = the bug.** |

**Flagged contradiction:** Docs vs Data — the SPEC says the key is permitted; the live policy proves it is not. Data holds the truth.

---

## 6. Repro evidence

- **Live-DB repro (deterministic, authoritative):** the INSERT policy predicate `array_length(storage.foldername(name),1) = 2` evaluated against the EXACT key shape the code builds, using a REAL trip's brand/event IDs, yields segment length **3 ≠ 2** → reject. Confirmed via four read-only SQL probes (policy dump, path arithmetic, real-trip arithmetic, zero-objects count). Because RLS evaluation is deterministic, this is a PROVEN repro of the upload-failure hop — not a probabilistic inference.
- **Sim note:** the iPhone 17 Pro sim (`17091E60-…`) is booted with the business dev build. A UI repro would add a screenshot of the occluded-toast symptom but cannot change the proven mechanism; a real storage write to confirm the 403 over REST would require a live brand-owner JWT (credentials = STOP-and-ask) and would be a destructive write. The deterministic policy proof + zero-objects evidence is conclusive for the root cause, so no destructive live write was performed (Hard Guard: READ-ONLY).

---

## 7. Blast radius / cross-surface map

- **In-scope (broken):** Business iOS + Business Android trip create wizard Step 2, AND the published-trip edit screen (`EditPublishedTripScreen.tsx` renders the same `TripCreatorStep2Itinerary`). Both author via `uploadTripDayMedia` → same 3-segment key → same RLS rejection.
- **GIF/Pexels tabs:** NOT affected by F-1 (they use remote provider URLs, no storage upload) — but a GIPHY-key gap is separately tracked under COMMS-0028 / ORCH-1127 and is orthogonal to this bug.
- **Consumer iOS/Android + anon Web display:** render-only; they would display persisted trip-day media but none can be authored yet, so they show empty galleries (correct per Constitution #9). Not broken — just starved.
- **Other `event_covers` consumers (event covers, experience-stop images):** UNAFFECTED — they use the legitimate 2-segment key. Any fix MUST NOT loosen the policy for them (see Invariant impact).
- **F-3 (toast occlusion):** affects every failure path of `TripDayMediaSheet` on native (Business iOS/Android).

---

## 8. Invariant impact (flagged, NOT pre-decided)

- **Storage path-shape invariant:** the `event_covers` INSERT/UPDATE/DELETE policies currently hard-bind `array_length(foldername) = 2`. Any fix that permits the 3-segment trip-day key MUST remain fail-closed for the existing 2-segment cover/stop keys (brand+event identity + caller rank ≥ event_manager) and MUST NOT broaden write access to arbitrary 3-segment paths (e.g. require `foldername[3] = 'trip-day-media'` exactly). Flag for the SPEC to choose: a new dedicated trip-day policy vs. relaxing the count guard. **Do not pre-decide here.**
- **Constitution #3 (no silent failure):** F-3 currently violates it (toast occluded by open Modal). The SPEC should decide the close-on-failure / toast-host strategy.

---

## 9. Discoveries for Orchestrator

- **D-1 (COMMS-0028 acked):** the dev-channel HEAD was overwritten 2026-06-12 by ORCH-1127's two keyless GIPHY OTAs (ios `c42f46da`, android `5c959da6`), superseding the ORCH-1119 multi-select dev update. This does NOT cause the haptic-no-media bug (that's the RLS root cause above), but if Seth's "ORCH-1119 dev bundle" was actually serving the ORCH-1127 OTA, the multi-select REWORK may not even be in the bundle he tested. Worth confirming the bundle identity when the fix ships; re-publish the ORCH-1119 dev update after the fix.
- **D-2:** F-6 means the original `INVESTIGATE_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md` F-6 ("use event_covers, no new RLS policy needed") is now refuted. Recommend marking it superseded.
- **D-3:** F-3 (native-Modal occludes the wizard-root Toast) is a reusable hazard pattern — any sheet that shows toasts via a parent-tree host will have them hidden. Candidate for a shared invariant if it recurs.

---

## 10. Confidence

**root cause PROVEN.** The upload-failure hop is proven by deterministic live-DB policy arithmetic against a real trip's brand/event IDs plus zero-objects-ever-landed evidence. The "no visible error" half is proven by source: close-on-success-only + native-Modal portal occluding the in-tree root Toast. Append + render paths RULED OUT (code correct, simply unreached).

---

## 11. Recommended next phase + scope (direction only — NOT a fix)

- **Next phase:** SPEC (then implementor).
- **Primary fix direction (F-1/F-6):** permit the trip-day-media write at the `event_covers` storage-RLS layer — a migration adding a dedicated, fail-closed policy (or amending the existing trio) that accepts the 3-segment `{brandId}/{eventId}/trip-day-media/{file}` key while preserving brand/event identity + caller-rank ≥ event_manager and NOT broadening the existing 2-segment cover/stop writes. The SPEC chooses the exact policy shape.
- **Secondary fix direction (F-3):** ensure an upload failure is actually visible — e.g. close the sheet (or host the toast inside the sheet's Modal) on a 0-success batch so the friendly error reaches the user. SPEC decides.
- **Verification the SPEC must demand:** a successful end-to-end runtime upload (image AND video) lands an object under `event_covers/{brandId}/{eventId}/trip-day-media/` AND renders a tile AND survives draft save + published-edit; a forced failure shows a VISIBLE toast.
- **Do NOT** widen to experiences/events/cover-pipeline or touch the GIPHY-key issue (COMMS-0028 / ORCH-1127).
