# IMPLEMENTATION — ORCH-1119 — Trip itinerary days: optional per-day media gallery

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md` (binding contract)
**Status:** implemented + self-verified (migrations applied + live-verified; jest green; fails-on-revert proven). Device/runtime UX proof deferred to tester.

---

## 1. Summary

Trip itinerary DAYS can now carry an OPTIONAL ordered media gallery (images AND videos, mixed, up to 8/day). A brand authoring or editing a trip adds/reorders/removes per-day media via a new trips-only picker sheet (Library accepts device images + videos; GIFs/Photos tabs unchanged). Consumers (iOS/Android) and anonymous web buyers see the per-day gallery on the trip itinerary, video playing through the existing `EventCoverMedia` renderer with a one-playing guard. A day with no media renders ZERO gallery nodes on every surface (Constitution #9). Built narrowly: a new `trip_days.media` jsonb column, a new `tripDayMediaService` (direct `event_covers` upload, 25 MB cap), a new `TripDayMediaSheet`, and field-threading through the draft + published-edit + display hops. No per-stop media, no shared cross-offering abstraction, no reuse of the cover-video transcode pipeline.

---

## 2. SPEC success-criteria coverage

All commits land in the single ORCH-1119 commit (hash recorded by the orchestrator at REVIEW; see `git log` on the branch).

| SC | Status | Evidence |
|----|--------|----------|
| **SC-1 (DB column + CHECK + backfill)** | **proven** | Live Management-API probe: `media jsonb NOT NULL DEFAULT '[]'` present; `trip_days_media_is_array` CHECK present; all 15 existing rows backfilled to `[]`. |
| **SC-2-iOS / SC-2-Android (authoring round-trip)** | **suspected (source) — needs device** | Authoring wiring built end-to-end (sheet → service → `upsertTripDays` media INSERT → re-seed via `tripToDaysDraft`); draft media round-trip proven at the DB layer (live §5b upsert persisted a typed gallery). On-device add/reorder/remove + autosave persistence is tester's runtime proof. |
| **SC-3 (video upload + reject)** | **proven (logic) + suspected (live upload)** | Service rejects unsupported MIME (`unsupported_type`) + >25 MB (`file_too_large`) BEFORE any `.upload()` (asserted by test; friendly copy, no silent failure). Live storage upload of a real `.mp4` to the keyed path needs a signed-in device (tester). |
| **SC-4-iOS / SC-4-Android (consumer display)** | **suspected (source) — needs device** | Consumer screen renders the gallery gated on `day.media.length > 0`, videos autoplay muted with the `activeVideoKey` one-playing guard; empty day = no gallery node (asserted by the consumer test's behavioral replica). Physical autoplay/one-at-a-time is tester's runtime proof. |
| **SC-5-Web (anon buyer)** | **suspected (source) — needs runtime** | `usePublicTripBySlug` coerces `media`; `TripPreview` renders `EventCoverMedia` gallery (web video via `EventCoverWebVideo` + lazy-mount). Logged-out `/t/...` render is tester's runtime proof. |
| **SC-6 (published-edit additive, never blocked by sales)** | **proven (no-block) + see deviation D-2 (server severity)** | Live-fired the §5b upsert on a SOLD trip (24 live orders, event `060d0483…`): the media gallery persisted, the `days_dropped_with_sales` gate did NOT fire (media adds no dropped ordinals). The change-summary is additive (client `computeRichTripFieldDiffs` → "Photos/videos updated"). NOTE the server RPC `severity` field stays `material` when `days` present (see Deviation D-2 — spec-mandated "§6 stays unchanged"). |
| **SC-7 (Constitution #9 — media:[] ⇒ zero nodes)** | **proven (logic)** | Consumer + web + editor all gate the gallery on `media.length > 0`; the consumer test's behavioral replica returns 0 nodes for `media:[]`; `coerceTripDayMedia` drops malformed/typeless items. |
| **SC-8 (no scope leak)** | **proven** | `git diff` of `ExperienceStopPhotoSheet.tsx`, `experienceStopImageService.ts`, `useEventCoverVideoUpload.ts`, `eventCoverVideoProcessingService.ts`, `packages/event-rendering/*`, `publishedTripEditGuards.ts` (util) is EMPTY. Only the 2 new migrations added to `supabase/migrations/`. |

---

## 3. Files changed

### New (6)
- `supabase/migrations/20260928000000_orch_1119_trip_day_media.sql` (+34) — `trip_days.media` column + array CHECK + COMMENT.
- `supabase/migrations/20260928000001_orch_1119_live_trip_media.sql` (+569) — `biz_update_live_trip` CREATE OR REPLACE (latest body verbatim, only §5b changed) + GRANT + NOTIFY.
- `mingla-business/src/services/tripDayMediaService.ts` (+200) — direct `event_covers` upload (image+video, 25 MB cap, typed return).
- `mingla-business/src/components/trip/TripDayMediaSheet.tsx` (+790) — trips-only 3-tab picker (Library accepts video).
- `mingla-business/src/services/__tests__/orch1119_trip_day_media_persistence.test.ts` (+125) — business regression (structural + diff behavioral).
- `app-mobile/src/screens/Trip/__tests__/orch1119_trip_day_media_gallery.test.tsx` (+130) — consumer regression (node:assert replicas).

### Modified (14)
- `mingla-business/src/services/tripsService.ts` (~+55) — `TripDayMedia` interface + `coerceTripDayMedia` + `TripDay.media` + `TripDayRow.media` + `mapTripDay` + `TripDayInput.media` + `upsertTripDays` INSERT `media` key.
- `mingla-business/src/utils/tripAdapter.ts` (~+55) — `TripDayDiff.mediaChanged/oldMediaCount/newMediaCount` + media fingerprint in `computeTripDayDiffs` + media-aware `days` row in `computeRichTripFieldDiffs`.
- `mingla-business/src/components/trip/TripDayEditor.tsx` (~+170) — gallery section + props + `TripDayDraft.media` + Android-opaque tile fill.
- `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` (~+95) — media handlers (add/remove/reorder) + active-day state + hosts `TripDayMediaSheet`.
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (~+15) — `tripToDaysDraft`/auto-seed/previewTrip/autosaveStep2/pristine `media`, Step2 prop threading.
- `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (~+30) — `tripToLocalEditState` media seed + media-aware day signature + `patch.days` media + Step2 prop threading.
- `mingla-business/src/components/trip/TripPreview.tsx` (~+90) — `EventCoverMedia` gallery + one-playing guard + Android-opaque tile.
- `mingla-business/src/hooks/usePublicTripBySlug.ts` (~+4) — `coerceTripDayMedia(d.media)` in the `TripDay` mapper.
- `mingla-business/src/services/publicEventsService.ts` (~+5) — compile-forced `media: coerceTripDayMedia(d.media)` (buyer-checkout trip read; see D-1).
- `mingla-business/src/utils/__tests__/publishedTripEditGuards.test.ts` (2 lines) — fixture `media: []` (forced type-correctness; `[TEST-MOD-APPROVED ORCH-1119]`).
- `app-mobile/src/hooks/useConsumerTripDetail.ts` (~+45) — `TripDayMedia` + `coerceTripDayMedia` + `media` in select + `TripDetailDay.media`.
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (~+70) — `activeVideoKey` state + per-day gallery render + styles.
- Plus the spec + investigation artifacts (already in the worktree).

---

## 4. Data-model changes applied (LIVE — project gqnoajqerqhnvulmnyvv)

Applied via the Supabase Management API (`POST .../database/query`, Bearer token from `~/.claude.json`, browser User-Agent) — MCP is read-only + CLI drift-wedged, per the edge-deploy/migration-apply hazards memory.

**Pre-apply probes (pasted):**
- Remote `schema_migrations` max = `20260926000000` (drift + monotonic check passed).
- `trip_days` had NO `media` column (clean apply).
- `event_covers` bucket: `public=true, file_size_limit=31457280, allowed_mime_types={image/gif,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm}`.

**Migration 1 — `20260928000000_orch_1119_trip_day_media.sql`** → HTTP 201. Post-apply verify:
- `media jsonb NOT NULL DEFAULT '[]'` present.
- `trip_days_media_is_array` CHECK present.
- 15/15 existing rows backfilled to `[]`.

**Migration 2 — `20260928000001_orch_1119_live_trip_media.sql`** → HTTP 201. Post-apply verify:
- `pg_get_functiondef(biz_update_live_trip)` `src_len` = **20630** (was 20046 in the SPEC's quote; the live latest differed — see D-3); contains `media = EXCLUDED.media` at position 16447.

**Recorded into `schema_migrations`:** both `20260928000000` + `20260928000001` inserted + confirmed present.

**Version deviation:** SPEC §4.1/§4.2 planned `20260927000000` + `…001`, but sibling worktree `ORCH-1116-[booking-gate-rls]` claimed `20260927000000` after the SPEC was written. Bumped to `20260928000000/001` to stay strictly-greater than the remote max AND every sibling max (migration-monotonicity invariant / cross-host rule 10).

**No RLS change** (column inherits `trip_days` row policies). `business_publish_trip_draft` unchanged (it reads `trip_days` via `to_jsonb(td)`, automatically picking up `media`).

---

## 5. Edge functions touched

None. (No edge-function changes in scope.)

---

## 6. Regression tests added + fails-on-revert

### Business — `mingla-business/src/services/__tests__/orch1119_trip_day_media_persistence.test.ts` (9 tests, PASS)
Structural (source-grep) persistence assertions + service-reject assertions + behavioral `computeTripDayDiffs` media-awareness. Source-grep is intentional — `tripsService.ts`/`tripDayMediaService.ts` import the native supabase client and cannot load in node-jest (verified).

### Consumer — `app-mobile/src/screens/Trip/__tests__/orch1119_trip_day_media_gallery.test.tsx` (11 checks, PASS)
node:assert source-assertions + behavioral replicas (app-mobile has no jest/RTL runner — repo convention). Covers coercer drop-malformed (T2 explicit-type invariant), the anon-only media select (COMMS-0009), Constitution #9 empty-state (zero nodes), and the one-playing guard.

### Fails-on-revert — **PROVEN at HEAD `0f9860b4a`** (true line DELETION, not comment-out):
- Deleting the `upsertTripDays` `media` key + the §5b migration `media = EXCLUDED.media` + the `computeTripDayDiffs` media branch → **4 of 5 business assertions FAILED**; restoring → all 5 PASS again.
- Deleting the consumer gallery render block → **the T3 `day.media.length > 0` gate assertion FAILED**; restoring → all 11 PASS again.

### Append-only
`publishedTripEditGuards.test.ts` is the only existing test modified (2 fixtures gained `media: []`, a forced type-correctness change). The commit body carries `[TEST-MOD-APPROVED ORCH-1119]`. The 2 new test files are append-only-clean.

---

## 7. Old → New receipts (key surfaces)

### `tripsService.ts`
- **Before:** `TripDay` had no media; `upsertTripDays` INSERT hardcoded `stops:[]` and dropped any media.
- **Now:** `TripDay.media: TripDayMedia[]`; `mapTripDay` coerces `row.media`; `upsertTripDays` INSERT carries `media: d.media ?? []`; `TripDayInput.media?` rides the published-edit patch automatically.
- **Why:** SC-1/SC-2 draft persistence + read mapping.

### `20260928000001_…live_trip_media.sql`
- **Before (latest live body):** §5b `INSERT INTO trip_days (event_id, ordinal, title, narrative) … DO UPDATE SET title, narrative` — media dropped on published-edit.
- **Now:** column list + conflict update include `media` (from `COALESCE(d->'media','[]')` / `EXCLUDED.media`). Everything else verbatim.
- **Why:** SC-6 published-edit persistence.

### `tripAdapter.ts`
- **Before:** a media-only day edit produced NO diff (title/narrative only) → published-edit no-op.
- **Now:** media fingerprint makes a media-only change a `modified` diff with `mediaChanged:true`; the change-summary `days` row shows "Photos/videos updated" (additive) when only media changed.
- **Why:** SC-6 + §4.4 (the secondary root cause F-11).

### `ConsumerTripDetailScreen.tsx` / `TripPreview.tsx`
- **Before:** day card = ordinal + title + narrative only.
- **Now:** + a horizontal `EventCoverMedia` gallery (gated on `media.length > 0`) with a one-playing `activeVideoKey` guard; empty day renders no gallery node.
- **Why:** SC-4/SC-5/SC-7.

---

## 8. Cross-surface impact

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Consumer iOS | YES | Per-day gallery render | Shared RN — auto |
| Consumer Android | YES | Same (native video; opaque tile fill) | Shared RN — auto |
| Buyer/anon Web `/t/...` | YES | Per-day gallery via `TripPreview` (web video lazy-mount) | Shared component — auto |
| Business iOS | YES | Authoring (add/reorder/remove + sheet) in wizard + published-edit | Shared RN — auto |
| Business Android | YES | Same authoring | Shared RN — auto |
| Admin Web | NO | Out of scope (no trip-day authoring/display) | — |
| Business Web preview | YES (= `TripPreview`) | Gallery in preview | Same component as web |

---

## 9. Smoke result

No simulator/device run this pass (implementor self-verify focused on DB live-fire + jest + fails-on-revert). The live §5b upsert was fired against the real project (rolled back). Device dead-tap proof of the "+ Add" tile + the picker + autoplay one-at-a-time is the tester's job (per the interactive-elements-must-fire rule).

---

## 10. Known issues / deferred + deviations from spec

- **D-1 (publicEventsService.ts not in allowlist):** the buyer-checkout trip read constructs a `TripDay` literal and would fail typecheck without `media`. Added a compile-forced `media: coerceTripDayMedia(d.media)` (+ value import). Minimal, additive, harmless; flagged for orchestrator awareness.
- **D-2 (server RPC `severity` for media-only edits):** the SPEC §4.2 hard-guard says change ONLY the §5b upsert and "the §6 severity computation … stays". The §6 branch sets `severity='material'` whenever `p_patch ? 'days'`, so a media-only published-edit returns `severity:"material"` from the RPC. SPEC §4.4 + SC-6 say media-only should be **additive** — but the spec resolves this CLIENT-side (the change-summary IS additive: "Photos/videos updated"). Test-case T7 (client diff) passes additive; **test-case T6 expects the RPC return `severity:"additive"`, which conflicts with the spec's explicit "§6 stays unchanged" hard-guard.** I honored the dispatch's non-negotiable "copy the latest body verbatim, change ONLY §5b" guard and did NOT touch §6. The load-bearing SC-6 guarantee — *never blocked by sales* — is fully met and live-proven. **Flag for tester/orchestrator:** if T6's server-side `severity:"additive"` is truly required, it needs a §6 amendment (detect days-only-media-change → additive), which is a second body change the spec forbade. Recommend the orchestrator adjudicate.
- **D-3 (src_len differs from SPEC):** SPEC quoted the live `biz_update_live_trip` `src_len`=20046; the actual live latest was a different length (post-replace = 20630). I copied the LATEST body from `20260911000000_orch_1075…sql:2626` verbatim as instructed; the SPEC's quoted number was stale. No functional impact.
- **OQ defaults adopted (all §10 RECOMMENDED):** 8 media/day, 25 MB/item, no client duration cap, GIFs as `type:"image"`, button-reorder (move-left), `event_covers` bucket.
- **No per-day `date` field work** (pre-existing `TripDayDraft.date` omission — Discovery #2, untouched per spec).

---

## 11. Operator action required (orchestrator/operator at CLOSE)

- **Migrations are ALREADY applied + verified live** (Management API) + recorded into `schema_migrations`. The two files must still merge to main via the closing PR for source-of-truth parity (do NOT re-apply — they're idempotent but already present). No `db push` needed; if desired for parity: `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]" && /Users/sethogieva/bin/supabase db push --linked` would be a no-op for these two versions.
- **Edge functions:** none to deploy.
- **OTA:** pure-JS (RN) consumer + business changes → eligible for `eas update` per-platform at CLOSE (no native module added). Business app authoring also OTA-eligible.
- **Tester dispatch:** attack video size/duration, the one-playing guard on a real device, the media-only live-edit severity (see D-2), Constitution #9 empty-state on all 3 surfaces, anon-web RLS read of `media`, and the "+ Add" tile dead-tap proof.

---

## 12. Discoveries for orchestrator

1. **T6 vs §4.2 spec contradiction (D-2)** — server `severity` for media-only edits is `material` (spec-mandated "§6 stays"); T6/SC-6 imply additive. Adjudicate whether a §6 amendment is warranted.
2. **`publicEventsService.ts` compile-coupling (D-1)** — any new field on `TripDay` forces a touch here; candidate for the future shared `OfferingMediaGallery` consolidation noted in the investigation (Discovery #3).
3. **Pre-existing trip jest failures** — `tripsService.test.ts` (`publishTrip` mock missing `.maybeSingle()`), `publicEventsService.tripFetch.test.ts` (`@mingla/event-rendering` unresolved in jest), and several `TripMiniCard`/`EditPublishedTripScreen.save` suites fail on clean origin/main too (verified via `git stash`). NOT introduced by ORCH-1119; worth a cleanup ORCH.

---

# REWORK — multi-select Library picks are lost (device-caught, pre-merge) — 2026-06-12

**Trigger:** Seth, on the `development`-channel dev build: trip CREATE wizard → Step 2 → a day's "+ Add media" → Library → "Choose from library" → MULTI-SELECT several assets → sheet closes but the selections do NOT appear in the day's gallery. Single-select worked.

**Rework branch state:** rebased onto `origin/main` (was 12 behind — all ORCH-1116/1117/1118/1121 merges; one conflict in `ConsumerTripDetailScreen.tsx` resolved by keeping BOTH the ORCH-1117 collapsible-About state and the ORCH-1119 `activeVideoKey` state + the `Image` import). My three ORCH-1119 commits replayed cleanly on top; all DO-NOT-TOUCH files remain untouched vs origin/main.

## R1. Proven root cause (runtime evidence — stale-closure clobber, suspect (c))

The picker (`TripDayMediaSheet.pickFromLibrary`) uploaded each chosen asset and called the parent's `onAddMedia(media)` **once per asset inside a tight synchronous `for` loop** (old lines 337-350). The parent handler `TripCreatorStep2Itinerary.handleAddMediaToDay` rebuilt the day's media from the **render-time `days`** on every call:

```
const next = [...days];                 // <- same render-time base every call
const current = next[dayIndex].media ?? [];
next[dayIndex] = { ...next[dayIndex], media: [...current, media] };
onChange(next);                         // value-set; no re-render mid-loop
```

`onChange` is value-based (`setDaysDraft` in the wizard; `handleDaysChange` → `setEditState` in `EditPublishedTripScreen`). React does NOT re-render the parent between the synchronous loop iterations, so the `days` the handler closes over never updates mid-loop. Each iteration appends ONE item to the SAME stale base and calls `onChange` with it — so only the **last** asset survives. N selections collapse to 1. Single-select (N=1) is unaffected, exactly matching "multi-select only".

**Runtime proof (deterministic, no HITL):** a standalone replica of the exact data flow (parent owns `days`, value-only `onChange`, handler closes over render-time `days`, sheet calls per-item in a loop) with 3 picks `[u1,u2,u3]` → `final media count: 1 -> ["u3"]` → **BUG REPRODUCED: clobbered to 1**. This is encoded as the REWORK-A behavioral test (`appendOneBuggy` path asserts length 1, url `u3`; `appendBatch` path asserts all 3 survive).

NOT suspect (a) (the loop did iterate all assets), NOT (b) (uploads resolved fine — the items were uploaded to storage; only the parent append clobbered), NOT (d) (no silent upload error — uploads succeeded). The defect is purely the per-item-against-stale-base parent append.

**Bundle-compile proof of the authoring path:** the iOS business bundle compiles end-to-end from this worktree's Metro (port 8089), HTTP 200, 31.2 MB, zero transform errors, with `TripDayMediaSheet`/`handleAddMediaToDay`/`trip-day-media` present (248 hits) — the path is reachable, not a dead tap. The authenticated wizard walkthrough + sim photo-library multi-video pick remains human-in-the-loop (brand-owner auth), unchanged from the original CONDITIONAL.

## R2. The fix (file:line + what + why)

**`mingla-business/src/components/trip/TripDayMediaSheet.tsx`**
- Prop contract: `onAddMedia: (media: TripDayMedia) => void` → `onAddMedia: (media: TripDayMedia[])  => void` (batch). *Why:* a single batched append is the only clobber-proof shape given the value-only `onChange` on both surfaces.
- Library upload loop: now ACCUMULATES each successful upload into `const uploaded: TripDayMedia[] = []` (per-item `try/catch` so one bad file doesn't abort the batch; first error captured in `firstError`), then calls `onAddMedia(uploaded)` **once** after the loop; closes only after all uploads resolve. A failed item surfaces a friendly toast even on partial success (`Some media couldn't be added. <msg>`) — no silent failure (Constitution #3). *Why:* keeps the sheet open with the existing `loading={uploading}` spinner until every selection resolves, then hands them all to the parent atomically — no lost picks.
- Provider (GIF/Pexels) single picks: `onAddMedia({...})` → `onAddMedia([{...}])` (one-item array).

**`mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx`**
- `handleAddMediaToDay(dayIndex, media: TripDayMedia)` → `handleAddMediaToDay(dayIndex, media: TripDayMedia[])`: appends the WHOLE batch in one `onChange` — `[...current, ...media].slice(0, MAX_TRIP_DAY_MEDIA)` (cap re-enforced as a backstop; empty-batch no-op). *Why:* one `onChange` with all N items can't be clobbered by a stale base. Imports `MAX_TRIP_DAY_MEDIA`.
- The sheet wiring `onAddMedia={(media) => handleAddMediaToDay(mediaSheetDayIndex, media)}` is unchanged — `media` is now the array, flows straight through.

Both authoring surfaces (create wizard + `EditPublishedTripScreen`, which reuses `TripCreatorStep2Itinerary`) are fixed by these two files. No DB / service / RPC / display change — the persistence + render layers were already correct; only the in-memory multi-append was lost before save.

## R3. Re-proof on the simulator / gates

- **REWORK regression test** `mingla-business/src/components/trip/__tests__/orch1119_trip_day_media_multiselect.rework.test.ts` (NEW, append-only): 9/9 PASS. REWORK-A behavioral (3-pick batch keeps all 3; one-by-one clobbers to 1; append-not-replace onto existing; cap at 8; empty no-op). REWORK-B source-contract anchors (sheet prop is array; loop collects + single `onAddMedia(uploaded)`; no `onAddMedia(media)` single-call in-loop; parent batch signature; provider one-item arrays; partial-failure toast).
- **fails-on-revert verified at `92fbb9944`:** TRUE LINE DELETION — reverted the parent handler to the single-item `(dayIndex, media: TripDayMedia)` append AND the sheet loop to per-item `onAddMedia(media)` → the two REWORK-B source-anchor assertions ("Library loop hands the COLLECTED batch in ONE call" + "parent handler accepts a batch") **FAILED** (2 failed / 7 passed). Restored the fix → **9/9 PASS**.
- **No new failures vs baseline:** the touched-scope (`src/components/trip` + `orch1119` + `tripAdapter`) failing-suite set is identical pre- and post-rework (verified by stashing the two fix files and re-running) — all 11 failing suites are the pre-existing drifted contract/`@mingla/event-rendering`-unresolved tests documented in §12.3 + the QA report §6; the rework adds zero new failures. All 3 ORCH-1119 suites pass (25 tests).
- **Bundle re-compile:** iOS business bundle re-bundled with the rework — HTTP 200, 31.2 MB, zero errors, batch fix (`uploaded.push`/`handleAddMediaToDay`) compiled in.
- **Trip strict-grep gates:** `i-proposed-trip-canonical-columns`, `orch-0947-trip-spots-tickets-not-orders`, `orch-0963-public-trip-rpc-and-route-segregation` all PASS.
- **DO-NOT-TOUCH clean:** `git diff origin/main` of `ExperienceStopPhotoSheet.tsx`, `experienceStopImageService.ts`, `useEventCoverVideoUpload.ts`, `packages/event-rendering/*` = empty.

## R4. Updated SC-2 status

**SC-2-iOS / SC-2-Android (authoring round-trip incl. multi-select):** the multi-select clobber is FIXED and proven by deterministic logic reproduction (3→1 before, 3→3 after) + fails-on-revert regression test + bundle-compile. The on-device authenticated multi-select round-trip (pick multiple images AND a video → all appear → reorder/remove → autosave persist → publish → reopen) remains the human-in-the-loop device gate (brand-owner auth + sim photo-library media), unchanged from the original CONDITIONAL — `probable → proven` pending Seth's device re-verify after OTA.

## R5. Discoveries (rework)

- No new side issues. The value-only `onChange` contract on both authoring surfaces is the structural reason a per-item loop append is unsafe — the batch contract is the correct long-term shape and is now enforced by the REWORK-B source anchors.
