# INVESTIGATE — ORCH-1119 [trip-day-media-gallery] · REAL CLIENT UPLOAD PATH

**Date:** 2026-06-12
**Skill:** mingla-forensics (dispatched sub-agent; cannot spawn further sub-agents)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery` · HEAD `984d78eb9`
**Prod project:** `gqnoajqerqhnvulmnyvv`
**Recurrence:** THIRD pass on the same symptom. Prior fixes were proven a LAYER BELOW the device UX (deterministic harness; direct Storage INSERT under crafted context). This pass drove the **REAL authenticated client upload** with a real user JWT.

---

## Symptom (Seth, physical iPhone, "latest ORCH-1119B dev OTA")

Trip create wizard → Step 2 → a day's "+ Add media" → Library → multi-select images/video → haptic felt, then "Photos and videos" section stays EMPTY (just the Add button). No tile, **no error toast**, no persist.

Expected: chosen media uploads, tiles append into the day's gallery, autosave persists `trip_days.media`.

---

## Ledger acks (COMMS_LEDGER.md)

- **COMMS-0029** (WARN → ORCH-1119): ORCH-1119's migrations are **PROD-APPLIED-BUT-UNMERGED**; ORCH-1120 re-emits `biz_update_live_trip` and could clobber 1119's live-trip day-media. Acked — factored in (confirms HEAD `984d78eb9` is not on origin/main; the day-media RLS + function ARE live on prod). Out of scope for THIS upload-path investigation.
- **COMMS-0027** (WARN → ALL): concurrent OTA publishes from symlinked worktrees poison the shared Metro/Haste cache → route-empty/stale bundles. Acked — directly relevant to the bundle-identity finding (F-5).
- **COMMS-0028** (WARN → ORCH-1119): GIPHY key unreachable in standalone/OTA. Acked — tangential (affects the GIFs tab, not the Library upload symptom).

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `mingla-business/src/services/tripDayMediaService.ts` | service | the exact client upload — path construction, bucket, upsert, post-verify |
| 2 | `mingla-business/src/components/trip/TripDayMediaSheet.tsx` | component | picker → upload loop → onAddMedia/onShowToast/onClose ordering |
| 3 | `mingla-business/src/components/trip/TripDayEditor.tsx` | component | render of tiles + Add button; `mediaEnabled` gate |
| 4 | `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` | component | brandId/eventId prop threading + `handleAddMediaToDay` |
| 5 | `mingla-business/app/trip/create.tsx` | route | create-entry id minting (`d_*` draft id) |
| 6 | `mingla-business/app/trip/[id]/edit.tsx` | route | `d_*` → real `events.id` swap BEFORE wizard mounts |
| 7 | `mingla-business/src/components/trip/TripCreatorWizard.tsx` | component | `eventId={trip.id}` passed to Step 2 |
| 8 | `mingla-business/src/utils/brandCoverRules.ts` | service | post-upload `verifyBrandCoverPublicUrl` (swallow surface) |
| 9 | `mingla-business/src/services/tripsService.ts` | service | `upsertTripDays` persist of `trip_days.media` |
| 10 | `supabase/migrations/20260930000000_orch_1119b_trip_day_media_storage_rls.sql` | schema | the live 3-seg RLS policy |
| 11 | prod live introspection (`pg_policies`, `pg_get_functiondef`) | schema/data | confirm policy + rank-function resolution |
| 12 | EAS `development` channel head (business app) | runtime | bundle identity — what Seth's device pulled |

---

## Q-scorecard

### Q1 — Is Seth even on the 1119B bundle?
**Verdict: The 1119B fix IS published to the `development` channel for BOTH iOS and android (proven). Whether his DEVICE actually fetched/loaded it is UNVERIFIED (requires the physical device) — and a stale pre-1119B bundle is the single best explanation for "haptic, no toast, nothing." `probable` that the symptom = stale bundle.**

The EAS `development` channel (business app, `runtimeVersion 1.0.0`) head:
- iOS update group `c67700f6-3285-49b8-92ae-aa0964f8b1ed` — message `"ORCH-1119B upload-RLS fix — isolated rebuild (route-healthy)"`, ~13 min before query.
- android update group `b28da637-...` — same message, built from `gitCommitHash 984d78eb946e5f35e59b740b9c12145a15574034` (= worktree HEAD with the fix).

The **immediately prior** OTA on the same channel was `"ORCH-1119 multi-select fix — isolated-cache rebuild"` (commit `3e7111861`, ~44 min before query) — that build had **NO live RLS policy yet AND the success-gated `onClose`**. A device still running that bundle would produce EXACTLY the reported symptom (see F-5).

### Q2 — Does the REAL client upload (real user JWT, `authenticated` role) succeed or 403, and why?
**Verdict: For a real owner of a real draft trip it SUCCEEDS (HTTP 200). The RLS predicate evaluates correctly in the authenticated storage context. `proven`. The orchestrator's lead that the upload is "STILL rejected" is REFUTED for the real-owner path.**

### Q3 — Is `eventId` empty / a `d_*` draft id at CREATE-wizard time (→ malformed key → 403)?
**Verdict: NO. `eventId` at Step 2 is a REAL persisted `events.id`. The `d_*` client id is swapped for the server id via `router.replace` BEFORE `TripCreatorWizard` mounts; the wizard only renders once `useTrip(realId)` resolves. `proven` (source trace, corroborated by Seth seeing the Add button → `mediaEnabled === true` → eventId defined).**

### Q4 — Is the failure swallowed (no toast on a real 403)?
**Verdict: In the 1119B code a 403 DOES surface a toast + warn haptic, and the sheet closes unconditionally so the toast is visible. In the PRE-1119B code (`3e7111861`) the sheet stayed OPEN on a 0-success batch, occluding the wizard-root toast → silent. `proven` (code + the real 403 shape captured).**

### Q5 — Is it the create path or the published-edit path?
**Verdict: Both share the same `uploadTripDayMedia` service and the same 3-seg key; the upload hop behaves identically. CREATE was specifically traced and is well-formed. `proven`.**

### Q6 — Does the render/persist hop drop the media?
**Verdict: The persist hop (`upsertTripDays` writing `trip_days.media`) is correct and only fires on step transition, not on add. The render hop is pure client React state (batched append, fixed in REWORK). Could not be DRIVEN at runtime without a logged-in device/sim, so it stays `suspected` as a secondary possibility — but it is NOT the upload/RLS layer the prior two passes blamed.**

---

## Findings (six-field evidence)

### F-1 — REAL authenticated client upload SUCCEEDS (200) for a real owner. RLS is NOT the failure. — CONFIRMED (RULES OUT the orchestrator lead)
1. **Symptom:** orchestrator hypothesis = real client upload still 403s under the authenticated role.
2. **Layer:** runtime (real user JWT) + schema (RLS).
3. **Probe:** minted a REAL user session for the brand owner (`auth.admin.generateLink` magiclink → anon `verifyOtp` → real `access_token`), built a supabase-js client with `Authorization: Bearer <user JWT>` + anon apikey (EXACTLY the app's auth shape), then called `storage.from("event_covers").upload("{brand}/{event}/trip-day-media/{token}.jpg", bytes, { contentType:"image/jpeg", upsert:true })` against a REAL draft trip the owner owns (event `61980280-ff31-4e84-a169-ea97bd07eff4`, brand `22a18413-bfbf-4087-9ba7-45f70deba0f3` "Leggo This", owner `b17e3e15-218d-475b-8c80-32d4948d6905` = sethogieva@gmail.com).
4. **Evidence (verbatim driver output):**
   ```
   SESSION uid: b17e3e15-218d-475b-8c80-32d4948d6905 token? true
   RANK_FOR_CALLER (authenticated): 60
   UPLOAD path: 22a18413-.../61980280-.../trip-day-media/forensic-mqb18ohm.jpg
   UPLOAD_RESULT: SUCCESS {"path":"22a18413-.../61980280-.../trip-day-media/forensic-mqb18ohm.jpg","id":"20703cbe-...","fullPath":"event_covers/22a18413-.../61980280-.../trip-day-media/forensic-mqb18ohm.jpg"}
   ```
   Full path replayed end-to-end (upload → getPublicUrl → verify): `HOP1 upload: OK` / `HOP2 publicUrl: …` / `HEAD status: 200 ok: true content-length: 22` / `HOP3 verify: OK (verified-via-HEAD)`.
5. **Mechanism:** `biz_brand_effective_rank_for_caller(brand_id)` is `SECURITY DEFINER` and reads `auth.uid()`; under a real user JWT in the storage `authenticated` context it returns 60 (brand_owner) ≥ 40 (event_manager). The `EXISTS (events e WHERE e.brand_id=foldername[1] AND e.id=foldername[2] AND e.deleted_at IS NULL AND rank>=...)` clause matches the real draft event. INSERT allowed. **The RLS / upload hop is healthy for a real owner.**
6. **Severity:** CONFIRMED — RULES OUT "upload still rejected" as the root cause for the real-owner path.

### F-2 — `eventId` at CREATE time is a REAL `events.id`, never a `d_*`/undefined draft id — CONFIRMED (rules out malformed-key theory)
1. **Symptom:** hypothesis = create-wizard builds `{brand}/undefined/...` or `{brand}/d_xxx/...` → EXISTS fails → 403.
2. **Layer:** code (route + wizard threading).
3. **Probe:** read `app/trip/create.tsx` → `app/trip/[id]/edit.tsx` → `TripCreatorWizard.tsx:1230-1235` → `TripCreatorStep2Itinerary.tsx:198-207`.
4. **Evidence:**
   - `create.tsx`: mints `generateDraftId()` (`d_<ts36>`) and `router.replace`s to `/trip/{d_id}/edit`. It does NOT mount the wizard.
   - `edit.tsx:64-77`: on a `d_*` id, eagerly calls `createTripDraftMutation.mutateAsync({brandId})` then `router.replace('/trip/' + trip.id + '/edit')` — swapping to the **server-issued real id**. While `isClientOnlyId`, the route renders only `"Setting up your trip…"` (line 86-95) — the wizard is NOT mounted.
   - `edit.tsx:79-81,128,195-197`: `useTrip(...!isClientOnlyId ? eventId : null)` and the wizard renders `<TripCreatorWizard trip={trip} ...>` only after the real-id query resolves.
   - `TripCreatorWizard.tsx:1234-1235`: `brandId={trip.brandId} eventId={trip.id}` — `trip.id` is the resolved server id.
   - Corroboration: Seth SEES the "+ Add media" button + "Photos and videos" section → `mediaEnabled` (`brandId && eventId && onShowToast` all defined) is `true` → `eventId` is a non-undefined real id.
5. **Mechanism:** by the time Step 2 can render the media UI, `trip.id` is a real persisted `events.id`; the constructed key is well-formed 3-seg with a real event the EXISTS clause matches.
6. **Severity:** CONFIRMED — rules out the malformed-key 403 theory for the create path.

### F-3 — A real 403 DOES surface a toast in 1119B; the swallow existed only PRE-1119B — CONFIRMED
1. **Symptom:** "no error toast."
2. **Layer:** runtime (real 403 shape) + code (sheet close ordering).
3. **Probe:** drove the SAME real-JWT upload against a soft-deleted/rank-0 brand (`Top spin`, `7810d114-...`, `deleted_at` set → rank 0) to force a denial; then read `TripDayMediaSheet.pickFromLibrary` lines 364-397.
4. **Evidence (real 403 shape, verbatim):**
   ```
   RANK0/deleted-brand upload: FAIL status=403 msg=new row violates row-level security policy
   raw: {"name":"StorageApiError","message":"new row violates row-level security policy","status":400,"statusCode":"403"}
   ```
   Sheet code (1119B): on `uploadError !== null`, `uploadTripDayMedia` throws `BrandCoverError("upload_failed", …)`; the loop sets `firstError`; after the loop, `if (firstError !== null) { warnHaptic(); onShowToast(firstError); }` then `onClose()` (now UNCONDITIONAL — line 397). The commit `984d78eb9` message confirms: *"Layer 2: TripDayMediaSheet closes the native Modal UNCONDITIONALLY on batch resolution (was gated on success) so a 0-success batch's wizard-root error toast is no longer occluded."*
5. **Mechanism:** in 1119B a full-failure batch fires warn-haptic + a visible wizard-root toast. So if Seth were on 1119B AND hitting a real 403, he WOULD see a toast. He reports NONE → he is either NOT on 1119B (stale bundle, F-5) OR the upload is NOT failing (F-1) and the gap is render/persist (F-4).
6. **Severity:** CONFIRMED.

### F-4 — Render/persist hop is the only remaining client-runtime candidate; not driven (no device session) — SUSPECTED CONTRIBUTOR
1. **Symptom:** tile never appears even on (hypothetical) success.
2. **Layer:** code (React state) + data (persist).
3. **Probe:** read `TripCreatorStep2Itinerary.handleAddMediaToDay` (lines 80-90) + `TripDayEditor` render (lines 176-258) + `upsertTripDays` (tripsService 945-979).
4. **Evidence:** add path is `onAddMedia(uploaded)` → `handleAddMediaToDay(mediaSheetDayIndex, media)` → `onChange(next)` (immutable append, capped). `onClose()` then sets `mediaSheetDayIndex=null`. Render gate `mediaEnabled` requires brandId+eventId+onAddMedia+onRemoveMedia. Persist (`upsertTripDays`) writes `media: d.media ?? []` and fires on STEP TRANSITION, not on add. No `catch {}` swallow found in the add/render path; the REWORK batched append is the proven multi-select fix.
5. **Mechanism:** if upload succeeds (F-1) but the tile doesn't render, the fault would be a client state/closure/re-render issue — NOT proven, because a logged-in device/sim run was not available this pass. This is the layer the prior two passes did NOT actually drive either.
6. **Severity:** SUSPECTED CONTRIBUTOR (secondary; only if F-5 is excluded).

### F-5 — Stale device bundle (pre-1119B `3e7111861`) reproduces the EXACT symptom — CONFIRMED mechanism / `probable` for Seth's device
1. **Symptom:** "haptic, no toast, nothing persists."
2. **Layer:** runtime (bundle identity) + code (pre-1119B sheet).
3. **Probe:** `git log` of the sheet/service/RLS files; EAS channel history.
4. **Evidence:** the OTA immediately before 1119B was `"ORCH-1119 multi-select fix"` (commit `3e7111861`). At that commit: (a) the 3-seg RLS policy was **NOT yet live** → a real upload 403s; (b) `pickFromLibrary` closed the sheet ONLY on success → on a 0-success batch the native Modal stayed OPEN, occluding the wizard-root error toast. Net device behavior on `3e7111861`: pick → haptic → every item 403s → no toast visible (occluded) → sheet still open / nothing appended → **identical to the report**. Memory + COMMS-0027 establish that dev/business OTA bundles PERSIST on-device (reinstall/foreground-relaunch required to refresh) and that symlinked-worktree publishes can poison caches.
5. **Mechanism:** Seth's device likely loaded the 44-min-old `3e7111861` bundle and did not refresh to the 13-min-old `984d78eb9` (1119B) bundle. On the old bundle the symptom is fully explained with no further code change.
6. **Severity:** CONFIRMED mechanism; `probable` that this is Seth's actual device state (needs a one-line device confirmation).

---

## Five-Truth-Layer reconciliation

| Layer | State | Contradiction? |
|-------|-------|----------------|
| Docs | ORCH-1119B claims upload-RLS fixed + visible failure | — |
| Schema | 3-seg INSERT/UPDATE/DELETE policies LIVE on prod; rank fn `SECURITY DEFINER` reads `auth.uid()` | — |
| Code | Sheet (1119B) surfaces toast + unconditional close; eventId is real at create | **Contradicts** the orchestrator lead "upload still rejected" |
| Runtime (real JWT) | Real-owner upload = 200 end-to-end; deleted-brand = 403 with the documented shape | **Contradicts** "rejected for real owner" |
| Runtime (device) | UNVERIFIED — bundle Seth's iPhone actually loaded is unknown; stale `3e7111861` explains the symptom | This gap IS the most likely bug |
| Data | `trip_days.media` jsonb column exists; persist writes `media ?? []` | — |

The decisive contradiction: **schema + real-JWT runtime PROVE the upload works for a real owner, while the symptom persists** → the truth lives in the **device-bundle layer** (or, secondarily, the render hop F-4), NOT in RLS/upload (which the prior two passes blamed and "fixed" below the device).

---

## Repro evidence

- **Real authenticated client upload (owner, real draft trip):** SUCCESS 200, end-to-end (upload + publicUrl + HEAD verify content-length 22). Driver: magiclink→verifyOtp→Bearer-JWT supabase-js client→`storage.from('event_covers').upload(3-seg key, …, {upsert:true})`. This is the authoritative upload-hop proof the prior two passes never ran.
- **Real authenticated denial (deleted/rank-0 brand):** 403 `new row violates row-level security policy`, `statusCode:"403"` — confirms the client's `upload_failed` → toast path would fire on a genuine denial.
- **NOT reproduced on a logged-in device/sim:** business-app device login was not available to this sub-agent; the render/persist hop (F-4) and the on-device bundle identity (F-5) could not be driven through the real UI. Honest negative: the create-wizard UI flow itself was not exercised on a device this pass — the upload HOP was proven authoritatively via the real-JWT client SDK call, which is authoritative for that hop only.

---

## Blast radius / cross-surface map

- **Business iOS / android (CREATE wizard + published-edit):** same `uploadTripDayMedia` + 3-seg key + RLS → identical behavior; both covered by F-1.
- **Consumer app, anon/buyer web, admin:** NOT involved — trip-day media authoring is business-only; public surfaces read via the bucket-wide public SELECT (no RLS on download).
- Recurring pattern: this is the THIRD time the symptom was "fixed" a layer below the device. The structural gap is **proving the upload hop without proving the device bundle Seth runs**.

---

## Invariant impact (flagged, not resolved)

- `ANDROID_GLASS_USES_OPAQUE_FALLBACK` — TripDayEditor tiles already use opaque Android fill; not implicated.
- I-COMMS-LEDGER — acked COMMS-0027/0028/0029.
- No invariant is violated by the current code; the open risk is operational (stale-bundle refresh + COMMS-0029 migration-merge ordering), not a code invariant.

---

## Discoveries for Orchestrator

- **DISC-1119-STALE-BUNDLE:** business dev OTA bundles persist on-device; there is no in-app "you are N versions behind" signal. Repeated "fixed below the device" recurrences trace to this. Consider a build-stamp/commit-hash surfaced in the business app's debug/account screen so a tester can read the loaded bundle commit without guessing.
- **DISC-1119-COMMS-0029:** 1119's day-media migrations are prod-applied-but-unmerged; ORCH-1120 must rebase onto the merged 1119 body or it silently drops day-media from `biz_update_live_trip`. Already tracked in COMMS-0029 — restating for visibility because it blocks a clean merge of THIS ORCH.
- The service-file doc comment says "2-segment … key" (tripDayMediaService.ts lines 8-11) but the key is **3-segment**; cosmetic, but misleading for the next reader.

---

## Confidence

- F-1 (real upload succeeds for owner): **proven**.
- F-2 (real eventId at create): **proven**.
- F-3 (1119B surfaces toast; pre-1119B swallows): **proven**.
- F-5 (stale-bundle mechanism reproduces symptom): mechanism **proven**; that it is Seth's actual device state = **probable** (one device confirmation away).
- F-4 (render/persist hop): **suspected** (not driven on a device this pass).

**Overall: the orchestrator's lead — "real client upload STILL rejected under authenticated role" — is REFUTED.** The upload + RLS hop is healthy for a real owner of a real draft trip. The live symptom is, in priority order: (1) a **stale on-device bundle** (pre-1119B `3e7111861`, where the symptom is fully explained), then (2) the **render/persist client hop** if Seth is confirmed on 1119B and still sees nothing.

---

## Recommended next phase + scope (direction only — NOT a fix)

1. **First, settle bundle identity on the device (cheapest, highest-probability).** Have Seth force-quit + relaunch the business app (or reinstall the dev build), confirm he is on the 13-min-old 1119B iOS OTA (commit `984d78eb9`), and re-run his exact repro. If the tile now appears OR a toast now shows → it was the stale bundle (F-5), close.
2. **If still broken on a confirmed-1119B bundle,** the next phase is a **device/sim runtime drive of the create-wizard UI** with a logged-in business account, instrumenting `pickFromLibrary` (does `uploaded.length>0`? does `onAddMedia` fire with the right day index? does `days[idx].media` grow? does the tile render?) — i.e., prove the render hop (F-4), which neither prior pass nor this one drove through the real UI. That is the ONLY remaining unproven layer.
3. Do NOT re-touch the RLS policy or the upload service — both are proven correct for the real-owner path.
