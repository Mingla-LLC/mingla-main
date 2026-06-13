# SPEC — ORCH-1119B [trip-day-media-gallery] · upload RLS path-shape fix + visible failure

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery` · HEAD `90d4397f5`
**Date:** 2026-06-12
**Phase:** SPEC (contract — no implementation)
**Upstream investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1119_HAPTIC_NO_MEDIA.md` (root cause PROVEN)
**Supersedes:** the original `SPEC_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md` premise "2-segment key satisfies `event_covers` RLS, no new policy needed" (F-6 — analytically FALSE; the prescribed key is 3-segment).

> Also handled COMMS-0028 (WARN, ORCH-1127 GIF-key OTA clobber): already acked by ORCH-1119 forensics; factored as D-1 — the ORCH-1119 dev OTA must be re-published LAST after this fix lands, and bundle identity confirmed before re-test. Orthogonal to this fix.

---

## 1. Executive summary

Trip-day gallery uploads ("+ Add media" → Library → Choose from library → multi-select) fire a haptic but land **no tile and no visible error**. Two proven root causes:

1. **PRIMARY (load-bearing):** the upload is 403'd by Storage RLS. `tripDayMediaService.ts:163` builds a **3-folder-segment** key `{brandId}/{eventId}/trip-day-media/{token}.{ext}`, but every `event_covers` write policy (INSERT/UPDATE/DELETE) hard-requires `array_length(storage.foldername(name), 1) = 2`. Three segments ≠ two → RLS denies the INSERT → `BrandCoverError("upload_failed")` thrown → zero objects have ever landed.
2. **SECONDARY (Constitution #3):** on a 0-success batch the `TripDayMediaSheet` fires `warnHaptic()` + `onShowToast(error)` but only `onClose()`s on success, so the full-screen native `Modal` (`SheetMobile.tsx`) stays mounted and occludes the wizard-root `Toast` → the user feels a haptic and sees nothing.

This SPEC fixes both: **Layer 1** adds a fail-closed, ADDITIVE `event_covers` Storage policy set scoped strictly to the `trip-day-media` subfolder (keeping the 3-segment client key), and **Layer 2** closes the sheet whenever an upload batch resolves with no successes so the already-dispatched error toast becomes visible.

---

## 2. Scope & non-goals

### In scope
- A **new migration** adding three ADDITIVE, fail-closed Storage policies on `storage.objects` permitting the 3-segment `{brandId}/{eventId}/trip-day-media/{file}` `event_covers` key for INSERT, UPDATE, DELETE, gated on brand/event identity + caller rank ≥ `event_manager` (the same auth predicate the existing 2-segment cover policies use).
- A one-line behavioral fix in `TripDayMediaSheet.tsx` so an all-failed upload batch closes the sheet (making the error toast visible).

### Non-goals (explicitly NOT touched, and why)
- **No change to the existing 2-segment `event_covers` cover policies.** They stay exactly as-is (`array_length = 2`). The new policies are additive and disjoint (`array_length = 3 AND [3] = 'trip-day-media'`).
- **No client storage-key change.** The 3-segment key is KEPT (justified in §4.1, Decision D-A) — clean separation, trivial cleanup.
- **No SELECT policy added.** `event_covers` is a PUBLIC bucket with an existing bucket-wide `"Public can read event covers"` SELECT policy; public buckets bypass access control on downloads (Supabase docs — §4.1 citation), so trip-day reads + `verifyBrandCoverPublicUrl` HEAD already work. Adding a SELECT policy would be dead code.
- **No experiences / events / cover-pipeline / `packages/event-rendering` changes.** Experience-stop and event-cover uploads use the legitimate 2-segment key and are unaffected.
- **No GIPHY-key work** (COMMS-0028 / ORCH-1127) — orthogonal; that path uses remote provider URLs, no storage upload.
- **No change to the append (`handleAddMediaToDay`) or render (`TripDayEditor`) paths** — investigation RULED them OUT as correct (F-4, F-5).
- **No bucket MIME / size-limit change** — `event_covers` already allows image + `mp4`/`webm`/`quicktime` video at 30 MB (migrations `20260515000002` / `20260515000010`).

### Assumptions
- The trip-day token (`generateBrandCoverPathToken`) is base-36 alphanumeric with no `/` → the key is ALWAYS exactly 4 path components / 3 folder segments / `foldername[3] = 'trip-day-media'`. Verified in `brandCoverRules.ts:141-145`.
- `public.events` holds the trip's row (trips are `events` rows with a trip kind), so the same `EXISTS (... FROM public.events e ...)` identity check the cover policy uses applies unchanged. Confirmed: the trip-day key's `eventId` segment IS the trip's `events.id` (investigation F-1, real-trip arithmetic).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NOT (display-only) | Renders persisted trip-day media once authored; no authoring path. | none | n/a — render-only, already correct |
| 2 | Consumer Android (`app-mobile/` Android) | NOT (display-only) | Same as #1. | none | n/a |
| 3 | Buyer/anon Web (`mingla-business/` `/t/...`) | NOT (display-only) | Renders persisted trip-day media on the public trip page; no authoring. | none | n/a |
| 4 | **Business iOS** | **YES** | Trip create wizard Step 2 + published-trip edit: picked image/video uploads, appends a tile, persists; a failed upload shows a VISIBLE toast. | migration (shared); `TripDayMediaSheet.tsx` | Migration = automatic (shared DB). Component = shared RN file, automatic across iOS/Android. |
| 5 | **Business Android** | **YES** | Same as #4. | same as #4 | automatic (shared) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NOT | No trip authoring in admin. | none | n/a |
| 7 | Business Web preview (adjacent) | NOT (no native upload) | The picker upload path is native-only; web preview does not author trip-day media via this sheet. | none | n/a |

The fix is a DB policy (universal) + one shared RN component file → Business iOS and Android reach parity automatically. No manual per-platform code.

---

## 4. Layered specification

### 4.1 Database — Storage RLS migration (the load-bearing fix)

#### Decision D-A — KEEP the 3-segment key + ADD a new scoped policy (recommended)

**Chosen:** keep the client's 3-segment `{brandId}/{eventId}/trip-day-media/{token}.{ext}` key and add NEW, separately-named, fail-closed policies scoped to `foldername[3] = 'trip-day-media'`.

**Rejected alternative — fold into a 2-segment key** (e.g. `{brandId}/{eventId}/{token}.{ext}` with a `trip-day-` filename prefix to reuse the existing policy): rejected because (a) it would mix trip-day media into the SAME prefix as event covers, making cleanup/audit/lifecycle ambiguous (no folder boundary), (b) it would force the existing cover policy to also gate trip-day writes — coupling two features to one policy and risking accidental cross-loosening on any future edit, and (c) the existing 2-segment policy's `EXISTS` identity check is identical either way, so the fold saves nothing while losing the clean folder boundary. The 3-segment + dedicated-policy approach is strictly safer and trivially reversible (drop three named policies, delete one prefix).

**Why this does NOT loosen the existing 2-segment writes:** the new policies are mutually exclusive with the old ones by construction. A name passes the new policy ONLY if `array_length(...) = 3 AND foldername[3] = 'trip-day-media'`; it passes the old policy ONLY if `array_length(...) = 2`. No name can satisfy both count predicates, and the existing policies are left textually untouched. RLS is permissive-OR across policies, so adding a disjoint policy widens the permitted SET by exactly the trip-day subfolder and nothing else.

#### Existing policies (VERBATIM, from live `pg_policies` + migration `20260515000002_orch_0758a_event_cover_storage.sql`) — DO NOT MODIFY

INSERT — `"Event managers can upload event covers"` (`with_check`):
```
(bucket_id = 'event_covers'
 AND array_length(storage.foldername(name), 1) = 2
 AND storage.filename(name) <> ''
 AND EXISTS (SELECT 1 FROM public.events e
   WHERE e.brand_id::text = (storage.foldername(name))[1]
     AND e.id::text = (storage.foldername(name))[2]
     AND e.deleted_at IS NULL
     AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')))
```
UPDATE — `"Event managers can update event covers"` (`USING` = `WITH CHECK`): identical body to the above.
DELETE — `"Event managers can delete event covers"` (`USING`): identical body to the above.
SELECT — `"Public can read event covers"`: `USING (bucket_id = 'event_covers')` — bucket-wide public read; **covers trip-day reads already, no new SELECT needed.**

These three INSERT/UPDATE/DELETE policies all hard-bind `array_length(...) = 2`. That count guard is the SINGLE failing predicate for the 3-segment trip-day key (investigation F-1). The new policies below relax NOTHING in them — they sit alongside as a disjoint OR-branch.

#### NEW migration — exact policy SQL

- **Version:** `20260930000000` (see §4.1 "version choice" below).
- **Filename:** `supabase/migrations/20260930000000_orch_1119b_trip_day_media_storage_rls.sql`
- **Apply at implement time via the Supabase Management API** (MCP is read-only; CLI is drift-wedged) — per the edge-deploy/migration-apply hazards memory. After apply, INSERT the row into `supabase_migrations.schema_migrations` so the local history matches remote.
- **Idempotent:** `DROP POLICY IF EXISTS` before each `CREATE POLICY`.

```sql
-- ORCH-1119B: ADDITIVE event_covers Storage RLS for the 3-segment trip-day-media key.
-- Scope: permits {brandId}/{eventId}/trip-day-media/{file} writes ONLY.
-- Does NOT modify the existing 2-segment cover/experience-stop policies
-- (array_length = 2); those stay exactly as-is. Fail-closed: same brand/event
-- identity + caller-rank->=-event_manager predicate as the 2-segment policy.
-- Ref: Supabase Storage Access Control — subfolder scoping via
-- (storage.foldername(name))[n]; public buckets enforce RLS on INSERT/UPDATE/
-- DELETE/move/copy but bypass it on downloads, so no new SELECT policy is needed
-- (the bucket-wide "Public can read event covers" SELECT already serves reads).
-- https://supabase.com/docs/guides/storage/security/access-control

DROP POLICY IF EXISTS "Event managers can upload trip day media" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can update trip day media" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can delete trip day media" ON storage.objects;

CREATE POLICY "Event managers can upload trip day media"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[3] = 'trip-day-media'
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

CREATE POLICY "Event managers can update trip day media"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[3] = 'trip-day-media'
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
)
WITH CHECK (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[3] = 'trip-day-media'
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

CREATE POLICY "Event managers can delete trip day media"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[3] = 'trip-day-media'
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);
```

**Notes on the SQL:**
- `upsert: true` is passed by the service (`tripDayMediaService.ts:167`) → the storage layer may perform an UPDATE on a name collision, so the UPDATE policy is required (token collisions are vanishingly rare, but `upsert` is set). Supabase docs: "To allow overwriting files using the `upsert` functionality you will need to additionally grant SELECT and UPDATE permissions." SELECT is satisfied by the existing public SELECT policy; UPDATE is added here.
- DELETE is included so a future "remove tile from gallery → delete object" cleanup (and any orphan reclamation) is RLS-permitted under the same auth. The current remove flow only drops the URL from `media[]`; the DELETE policy is defensive parity with the cover policy set and harms nothing.
- The auth predicate is copied byte-for-byte from the existing cover policy (`biz_brand_effective_rank_for_caller(e.brand_id) >= biz_role_rank('event_manager')`), confirmed present in `pg_proc` (`biz_brand_effective_rank_for_caller(p_brand_id uuid)`, `biz_role_rank(p_role text)`).

**Migration version choice — `20260930000000` (proven free):**
- Live remote `supabase_migrations.schema_migrations` max = `20260928000002` (orch_1123_batch_discard_offering_drafts), confirmed via MCP.
- Sibling worktree scan (`/Users/sethogieva/Desktop/mingla-orchs/*`): `ORCH-1116` + `ORCH-1128` + anchor `main` carry `20260928000002`; **`orch-1120` carries an unmerged `20260929000000`** (orch_1120_trip_settings_refund_deadline). ORCH-1119's own already-applied migrations are `20260928000000/01`.
- `20260930000000` is strictly greater than both the remote max (`...28000002`) AND the highest unmerged sibling (`...29000000`), so it cannot collide on merge or on apply. (Do NOT reuse `20260929000000` — taken by orch-1120.)

#### RLS / security inspection
- Fail-closed: a caller below `event_manager` on the brand, or a `brandId`/`eventId` that does not match an existing non-deleted `events` row, is denied. Anonymous callers are denied (the `EXISTS` rank check resolves to deny without a brand membership).
- No data exposure: SELECT remains bucket-wide public read (pre-existing, by design — `event_covers` is a public bucket).
- No path injection: `foldername[3] = 'trip-day-media'` is a literal-equality guard; the token segment is filename-only (`storage.filename(name) <> ''`), so a crafted deeper path (`.../trip-day-media/sub/x`) would have `array_length = 4` and be denied.

### 4.2 Component — visible failure (Constitution #3)

**File:** `mingla-business/src/components/trip/TripDayMediaSheet.tsx`

**Approach chosen: close the sheet on batch resolution (success OR all-failed), NOT host the toast inside the Modal.**

Rationale: the wizard-root `Toast` is a persistent in-tree absolute `View` (`TripCreatorWizard.tsx:1436-1443`) whose `visible` is already flipped true by `onShowToast` BEFORE the sheet would close. Once the native Modal dismisses, that toast renders unoccluded with zero extra plumbing. Hosting a second toast inside the Modal would duplicate toast state, risk a double-toast on partial success, and add a new toast host to maintain — strictly more surface area for the same outcome. Closing on resolution is the minimal, regression-safe change.

**Exact change — `TripDayMediaSheet.tsx:393`:**

Current:
```ts
// Close once all uploads have resolved — no selection is lost mid-flight.
if (uploaded.length > 0) onClose();
```
Replace with:
```ts
// Close once the batch has resolved — on full success AND on a 0-success
// batch — so the wizard-root error toast (onShowToast above) is no longer
// occluded by this native-Modal sheet (Constitution #3). The partial-success
// toast still fires before this close. Pre-upload throws (catch below) keep
// the sheet open so the user can retry the picker.
onClose();
```

**Why this preserves the success path and the batch-append fix:**
- On full success: `onAddMedia(uploaded)` + Success haptic already fired (L375-382) before this line; `onClose()` behavior is unchanged from today (it always closed on success).
- On partial success (some uploaded, some failed): `onAddMedia` fired with the successes, the partial-failure toast fired (L384-391), and now the sheet closes so that toast is visible — an improvement, not a regression. The appended successes persist.
- On 0 success (the bug): `firstError` toast fired (L384-391), now the sheet closes → toast visible. No `onAddMedia` call (correct — nothing uploaded).
- The pre-upload `catch` block (L394-402, picker/permission errors) is OUTSIDE this `try`'s success region and is unaffected — it keeps the sheet open and toasts, which is correct (the user can re-pick). The `onClose()` we add is in the post-loop success region only.
- The REWORK batch-append (single `onAddMedia(uploaded)` call) is untouched.

**a11y / haptics:** unchanged. `warnHaptic()` on failure + `Success` haptic on ≥1 upload both remain. The toast component already carries its own copy + dismiss affordance.

---

## 5. Success criteria

- **SC-1-iOS / SC-1-Android (PRIMARY — upload lands):** In the Business app trip create wizard Step 2, on a real brand-owner session, picking an **image** from Library and confirming lands an object at `event_covers/{brandId}/{eventId}/trip-day-media/{token}.{img-ext}` (verifiable via `storage.objects` query) and renders an 88×88 tile in that day's gallery.
- **SC-2-iOS / SC-2-Android (PRIMARY — video):** Same as SC-1 with a **video** (mp4/mov) → object lands with a video ext, tile renders via `EventCoverMedia`.
- **SC-3 (persistence — draft):** The appended media survives a draft save and re-open (the day's `media[]` round-trips; object still present).
- **SC-4 (persistence — published edit):** Editing a PUBLISHED trip (`EditPublishedTripScreen` → same `TripCreatorStep2Itinerary`) can add trip-day media; the object lands and persists via `biz_update_live_trip` (migration `20260928000001`).
- **SC-5 (no cross-loosening):** A write to a 2-segment `event_covers` key (an event cover) by an `event_manager` still succeeds (existing policy intact); a 2-segment write by a sub-`event_manager` caller still fails. A 3-segment write whose `foldername[3] != 'trip-day-media'` is DENIED. A 3-segment trip-day write by a sub-`event_manager` caller (or to a brand the caller doesn't manage) is DENIED.
- **SC-6-iOS / SC-6-Android (VISIBLE failure — Constitution #3):** With uploads forced to fail (e.g. temporarily point the key at a brand the caller does not manage, or simulate a 403), confirming a pick shows a VISIBLE toast ("Couldn't upload that file. Tap to retry." / the friendly `BrandCoverError` copy) — the sheet closes and the wizard-root toast is seen; no silent haptic-only outcome.
- **SC-7 (read path intact):** The uploaded public URL passes `verifyBrandCoverPublicUrl` (HEAD 200) — i.e. public SELECT still serves the object (no new SELECT policy regressed reads).

---

## 6. Invariants

### Preserved
- **`event_covers` 2-segment cover/experience-stop writes stay fail-closed and unchanged.** Verified by SC-5 + by the additive-disjoint construction (§4.1 D-A). The existing three policies are not edited.
- **Constitution #3 (no silent failure):** SC-6 — every upload failure now reaches the user visibly.
- **ORCH-1069/0978 explicit-type rule:** unchanged — `uploadTripDayMedia` still returns an explicit `type:"image"|"video"`.

### Proposed (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip)
- **`I-PROPOSED-TRIP-DAY-MEDIA-UPLOAD-RLS-ALLOWED` (DRAFT):** there MUST exist an `event_covers` Storage INSERT policy that permits the 3-segment `{brandId}/{eventId}/trip-day-media/{file}` key under brand/event identity + caller rank ≥ `event_manager`, AND it MUST be disjoint from the 2-segment cover policy (no name satisfies both). Guard: a migration-presence/grep test (§9) that fails-on-revert.
- **`I-PROPOSED-NATIVE-MODAL-SHEET-FAILURE-VISIBLE` (DRAFT):** a native-`Modal`-hosted media sheet MUST close (or host its own toast) on a 0-success upload batch so a parent-tree toast is not occluded. (Candidate per investigation D-3 — reusable hazard.) Scoped to `TripDayMediaSheet` for now; promote if it recurs.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Image upload lands (happy) | event_manager session, JPG pick | object at `…/trip-day-media/{tok}.jpg`; tile renders | DB+component |
| T-2 | Video upload lands (happy) | event_manager session, MP4 pick | object `…/{tok}.mp4`; `EventCoverMedia` tile | DB+component |
| T-3 | Policy disjointness (cover still works) | event_manager, 2-segment cover key INSERT | ALLOW (existing policy) | DB/RLS |
| T-4 | No cross-loosen (3-seg non-trip-day) | 3-segment key with `foldername[3]='evil'` | DENY | DB/RLS |
| T-5 | Auth fail-close (under-ranked) | viewer-rank caller, 3-seg trip-day key | DENY | DB/RLS |
| T-6 | Auth fail-close (wrong brand) | event_manager of brand B writes brand A's trip-day key | DENY | DB/RLS |
| T-7 | Visible failure (Constitution #3) | forced-403 batch, all fail | toast VISIBLE; sheet closed; warn haptic | component |
| T-8 | Partial success | 2 picks, 1 fails | success tile appended; partial-failure toast visible; sheet closed | component |
| T-9 | Pre-upload error keeps sheet open | picker/permission throw | toast fires; sheet STAYS open for retry | component |
| T-10 | Published-edit persistence | add media on EditPublishedTrip | object lands; persists via `biz_update_live_trip` | DB+component |
| T-11 | Public read intact | GET the uploaded public URL | 200 (verifyBrandCoverPublicUrl passes) | DB/RLS |

T-3..T-6 are DB-level RLS assertions (run as the relevant role/JWT against `storage.objects` INSERT, read-only-safe via a transaction that rolls back, or via a scratch brand/event). T-7..T-9 are component-behavior (jest on the `handleConfirm` callback's close/toast branches + a device smoke per SC-6).

---

## 8. Implementation order

1. **Migration** — author `supabase/migrations/20260930000000_orch_1119b_trip_day_media_storage_rls.sql` with the exact SQL in §4.1. Apply via Supabase Management API (browser UA; MCP read-only). Insert the version into `supabase_migrations.schema_migrations`.
2. **Verify policies live** — `select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' and policyname ilike '%trip day media%'` → 3 rows (INSERT/UPDATE/DELETE).
3. **Component** — apply the one-line change in `TripDayMediaSheet.tsx:393` (§4.2) + the explanatory comment.
4. **Regression tests** — add the migration-presence/disjointness assertion (§9) + the jest close-on-0-success assertion.
5. **Re-publish ORCH-1119 dev OTA LAST** (per COMMS-0028 D-1) so the device test runs the multi-select REWORK bundle, not the ORCH-1127 GIF OTA.

(No edge function, service-signature, hook, or realtime change — the service already builds the correct 3-segment key; only the policy that gates it was missing.)

---

## 9. Regression prevention (fails-on-revert)

- **Structural safeguard:** the three named `…trip day media…` policies in the migration, disjoint from the 2-segment cover policies.
- **DB regression test (fails-on-revert target):** a test that asserts (a) an INSERT of a 3-segment `{brand}/{event}/trip-day-media/{file}` name by an `event_manager` of that brand SUCCEEDS, and (b) the same name by an under-ranked caller is DENIED, and (c) a 2-segment cover INSERT by an `event_manager` STILL succeeds. Reverting the migration (dropping the trip-day policies) makes (a) FAIL; restoring makes it PASS. Drives `I-PROPOSED-TRIP-DAY-MEDIA-UPLOAD-RLS-ALLOWED`.
- **Component regression test (fails-on-revert target):** a jest test on `handleConfirm` asserting that when every `uploadTripDayMedia` rejects, `onShowToast` is called AND `onClose` is called (today `onClose` is gated on `uploaded.length > 0`, so reverting line 393 makes the `onClose` assertion FAIL). Drives `I-PROPOSED-NATIVE-MODAL-SHEET-FAILURE-VISIBLE`.
- **Protective comment:** the migration header comment (§4.1) explains WHY the 3-segment policy is additive/disjoint and must not be folded into the 2-segment policy; the `TripDayMediaSheet.tsx:393` comment explains WHY the sheet must close on a 0-success batch (Modal occlusion of the parent toast).

---

## 10. Open questions

- **OQ-1 (DELETE policy scope):** the DELETE policy is included for parity/defensive cleanup, but the current remove-tile flow only drops the URL from `media[]` (no object delete) → orphan objects accumulate. Out of scope for ORCH-1119B (no functional regression), but flag: a future "delete object on tile-remove" is now RLS-permitted should the orchestrator want it. Do NOT build it here.
- **OQ-2 (`upsert:true` necessity):** the service sets `upsert:true`; tokens are unique so collisions are near-impossible. The UPDATE policy is added to keep `upsert` from 403'ing on the (rare) collision and to follow Supabase's "upsert needs UPDATE" guidance. No action needed; noted for review.

(No blocking open questions — the SPEC is implementable as written.)

---

## 11. Downstream routing

- **Next:** `mingla-implementor` (Business + Supabase). Build the migration + the one-line component fix + the two regression tests, apply the migration via the Management API, self-verify policies live + jest, and re-publish the ORCH-1119 dev OTA LAST.
- **Then:** `mingla-tester` — device-prove SC-1..SC-7 on Business iOS AND Android (real brand-owner session, image + video upload lands a tile + persists through draft-save and published-edit; forced-failure shows a visible toast; cover writes still work).
- **Then:** `mingla-orchestrator` CLOSE — flip `I-PROPOSED-TRIP-DAY-MEDIA-UPLOAD-RLS-ALLOWED` + `I-PROPOSED-NATIVE-MODAL-SHEET-FAILURE-VISIBLE` to ACTIVE, mark original SPEC F-6 premise superseded (D-2).
- **Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]/` on branch `ORCH-1119-trip-day-media-gallery`.

---

## Allowlist (implementor MAY change)

- `supabase/migrations/20260930000000_orch_1119b_trip_day_media_storage_rls.sql` (NEW)
- `mingla-business/src/components/trip/TripDayMediaSheet.tsx` (line 393 + comment only)
- Test files: a new DB-RLS regression test + a new/extended jest test for `TripDayMediaSheet` close-on-0-success (e.g. under `mingla-business/__tests__/` or the colocated test dir matching repo convention).
- `supabase_migrations.schema_migrations` row insert (via Management API, at apply time).

## DO-NOT-TOUCH (stop-and-amend before changing)

- `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql` and the existing 2-segment cover policies (and the live versions) — do NOT edit/widen.
- `supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql`, the bucket MIME/size config.
- `tripDayMediaService.ts` — the 3-segment key is KEPT; do not change it to 2-segment (Decision D-A).
- `TripCreatorStep2Itinerary.tsx` `handleAddMediaToDay` (batch append — RULED OUT correct), `TripDayEditor.tsx` (render — RULED OUT correct), `TripCreatorWizard.tsx` toast host (works once the Modal closes).
- `SheetMobile.tsx` (the Modal primitive — do not re-architect; the fix is close-on-resolution, not de-portaling).
- Anything under `app-mobile/`, `mingla-admin/`, experiences, events, the cover-video transcode pipeline, `packages/event-rendering`.
- The GIPHY-key path (`giphyEventCoverService.ts`, `coverProviderBrowseService.ts`) — COMMS-0028 / ORCH-1127.
- Any `event_covers` SELECT policy (public read already correct).
