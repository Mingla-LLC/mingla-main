# IMPLEMENTATION — ORCH-0989 [Unified cover picker sheet]

**Mode:** mingla-implementor (Claude parity). **Worktree:** `~/Desktop/mingla-orchs/ORCH-0989-[unified-cover-picker-sheet]/` on branch `ORCH-0989-unified-cover-picker-sheet`. **Date:** 2026-05-29.
**Status:** implemented and verified (local typecheck + lint-relevant jest + deno gates green; sim/device live-fire is the tester's phase). **Build order followed:** SPEC §14 exactly (DB → edge → service → hook → component → mounts → gates → tests).

## Comms ledger handled on entry
- **COMMS-0002 (WARN)** — added `ORCH_0989_BACKEND_ALLOWLIST` to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit as the backend files (migration + new curated fn + 6 generalized video fns + `_shared`). Acked.
- **COMMS-0003 (WARN)** — every Giphy/Pexels endpoint/param/rate-limit/attribution is docs-cited inline in `coverProviderBrowseService.ts` + `event-cover-pexels-curated/index.ts`. Acked.
- **COMMS-0010 (RESOLVED→honored)** — Architecture B preserved byte-for-byte: integer `du_${ceil}`, NO `so_`. New `orch-0989` gate A7 asserts no `so_` in any of the 7 video edge fns. upload-intent + webhook are coherent as a pair (brand `public_id` template + `recoverJobIdFromPayload` last-segment recovery both updated). Acked.

---

## Layer-by-layer summary

### 1. DB migration (NOT applied — operator runs db push after REVIEW)
`supabase/migrations/20260801000000_orch_0989_brand_cover_video_target.sql`
- `event_cover_video_jobs.event_id` → DROP NOT NULL.
- `+ target_kind text NOT NULL DEFAULT 'event' CHECK (target_kind IN ('event','brand'))`.
- Row CHECK `((target_kind='event' AND event_id IS NOT NULL) OR (target_kind='brand' AND event_id IS NULL))`.
- New partial unique index "one active job per brand" + brand-target created index.
- RLS: the ORCH-0770 SELECT policy replaced with a UNION-of-predicates — **event predicate byte-for-byte unchanged** + a brand predicate gated by `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('brand_admin')`. Writes stay service-role only (no INSERT/UPDATE/DELETE policy existed; unchanged).
- **Remote data probe (read-only, Supabase MCP):** `biz_brand_effective_rank_for_caller` + `biz_role_rank` exist; `event_id` currently NOT NULL; `target_kind` absent; 8 existing event jobs (all default to `target_kind='event'`, keep `event_id` → row CHECK + DEFAULT pass with no abort, no backfill). Remote migration head = `20260730000004`; `20260801000000` is strictly monotonic. `brands` has `deleted_at` + `cover_media_url` + `cover_media_type`.

### 2. Edge functions
- **NEW** `supabase/functions/event-cover-pexels-curated/index.ts` — POST, `requireUser` Bearer gate, `PEXELS_API_KEY` server-side only, hits `GET https://api.pexels.com/v1/curated` (no `query`, no `orientation`), same response/error vocabulary as the search fn (`pexels_not_configured`/`pexels_rate_limited`/`pexels_unavailable`/`method_not_allowed`). Empty body → defaults to page 1 (browse).
- **GENERALIZED (Option A)** the 6 `event-cover-video-*` fns + `_shared/eventCoverVideo.ts`:
  - `_shared`: added `requireBrandCoverManager` (resolves brand rank, requires ≥ `brand_admin`, no events lookup); `EventCoverVideoStatusPayload.eventId` → `string | null` + `targetKind`; mapper null-tolerant.
  - `upload-intent`: accepts `target:"brand"` + `brandId` (no `eventId`); brand uses `published_manual`; brand `public_id` = `brand-covers/raw/${brandId}/${job.id}`; brand `context` carries `target_kind=brand|brand_id` (no `event_id`); supersede keys on `brand_id`+`target_kind='brand'`; insert sets `event_id:null` + `target_kind`. Architecture-B eager string unchanged.
  - `source-uploaded`/`status`/`cancel`: branch the manager check on `target_kind`; brand context-match verifies `brand_id`+`target_kind` (no event_id).
  - `apply`: `target_kind='brand'` → `UPDATE brands SET cover_media_url=job.processed_url, cover_media_type='video'`; event path unchanged.
  - `webhook`: select includes `target_kind`; draft_auto auto-apply guarded to event-target only (brand jobs are published_manual → stay `ready`, the apply fn writes brands); `recoverJobIdFromPayload` last-segment recovery already covers the brand template.

### 3. Service
- **NEW** `coverProviderBrowseService.ts` — `trendingGiphyCovers` (client-direct `https://api.giphy.com/v1/gifs/trending`, no `q`) + `curatedPexelsCovers` (`supabase.functions.invoke("event-cover-pexels-curated")`, no client key). Docs-cited.
- **DELETED** `giphyBrandCoverService.ts` + `pexelsBrandCoverService.ts` (subtract-before-add).

### 4. Hook
- `useEventCoverVideoUpload(eventId, brandId, applyMode, target="event")` — new `target` param. Brand mode: sends `target:"brand"`, omits `eventId`, invalidates brand caches (`brandKeys.detail`/`lists`) not event caches, and on `ready` calls `applyEventCoverVideoJob` to persist `brands.cover_media_url`. Service `createEventCoverVideoUploadIntent`/`acknowledgeEventCoverVideoSourceUploaded` gained optional `target` + nullable `eventId`; `EventCoverVideoStatus.eventId` → `string | null` + `targetKind`.

### 5. Component
- **NEW** `coverTarget.ts` — `CoverTarget` discriminated union (§4.2).
- **NEW** `CoverPickerSheet.tsx` — `Sheet`-hosted wrapper (header + close + SmartScrollView body hosting `CoverPicker`), mounted as JSX child of each host (I-SUB-SHEET-INSIDE-PARENT), 3-col desktop / 2-col phone via `useResponsiveLayout`.
- **REWRITTEN** `CoverPicker.tsx` — `target`-driven, 3-tab gallery-first (Library/GIFs/Photos), masonry grids, trending/curated browse on tab-open (no query), search additive, brand vs event/trip persistence routing, all 9 states, haptics, web no-trimmer fallback. Video path (trim → Architecture-B upload) preserved byte-for-byte; brand video routes through the generalized pipeline.
- **DELETED** `BrandCoverPickerSheet.tsx`.

### 6. Mounts (M1–M6 migrated; avatar untouched)
- M1/M2 `CreatorStep4Cover.tsx` → button + inline preview → `CoverPickerSheet` (event target; video stays enabled).
- M3 `TripCreatorStep1Basics.tsx` → button + preview → sheet (trip target, **video ENABLED**).
- M4 `EditPublishedTripScreen.tsx` cover case → button + preview → sheet (trip target, published_manual, **video ENABLED**).
- M5 `BrandEditView.tsx` → `CoverPickerSheet` brand target (replaces BrandCoverPickerSheet; handler maps CoverPatch → brand draft).
- M6 `BrandCreationFlow.tsx` → `CoverPickerSheet` brand target (error-styled toast wrapper only surfaces genuine failures).
- `BrandAvatarPickerSheet` UNTOUCHED.

### 7. Gates (all in the same commit as the code)
- `orch-0805` Check 6 repointed → `coverProviderBrowseService` exists + exports trending/curated + retired services gone. Check 8 repointed → `CoverPickerSheet` hosts `<Sheet>`+`<CoverPicker>` + LOCKED tab ids `library`/`gif`/`stock` + `BrandCoverPickerSheet` gone. **PASS 9/9.**
- `orch-0783` composite extended to include `CoverPickerSheet`; new browse-token assertions (trending endpoint, curated edge fn, no client `PEXELS_API_KEY`). **PASS.**
- **NEW** `orch-0989-unified-cover-picker.mjs` — 7 assertions (single-sheet, gallery-first tab ids, browse service contract, curated edge contract, retirement, brand apply target, no `so_`). **PASS 7/7.** Workflow job added to `strict-grep-mingla-business.yml`.
- `orch-0863` C7 — `ORCH_0989_BACKEND_ALLOWLIST` added + wired into the union. Self-test PASS.

### 8. Step-0.5 regression test
`mingla-business/src/services/__tests__/coverProviderBrowseService.test.ts` — 3 tests: trending GIF browse (no `q`), curated Stock browse (edge invoke), brand-video apply target (source-contract).
- Passing run: `3 passed`.
- **fails-on-revert verified at `830c52be2`** (neutralized the browse service + brand apply branch → suite fails to run / behavioral asserts break; restored → 3 passed).

---

## Verification matrix (SPEC §12)
| SC | Result | Evidence |
|----|--------|----------|
| SC-1 single sheet | PASS | all 6 mounts open `CoverPickerSheet`; orch-0989 A1/A2 |
| SC-2 gallery-first GIF | PASS | `loadTrending` on GIF tab-open, no query; browse test |
| SC-3 gallery-first Stock | PASS | `loadCurated` on Stock tab-open; browse test |
| SC-4 Library image/GIF | PASS (code) | brand→useBrandCoverUpload, event→uploadEventCoverMedia |
| SC-5 event video unchanged | PASS | upload-intent Deno tests green; trim wiring locked test green |
| SC-6 trip video NEW | PASS (code) | trip target enableVideo via shared event pipeline (A2) |
| SC-7 brand video NEW | PASS (code) | target_kind=brand job → apply writes brands; orch-0989 A6 |
| SC-8 retirement | PASS | 3 files deleted; orch-0989 A5 |
| SC-9 secrets | PASS | orch-0783 + orch-0989 A3/A4 (no client PEXELS key) |
| SC-10 attribution | PASS | "Powered by GIPHY" / "Photos provided by Pexels" + photographer credit |
| SC-11 caps preserved | PASS | reuses EVENT_COVER_* caps; A7 no `so_` |
| SC-12 gates | PASS | orch-0805/0783/0989/0863 + 4 desktop-web jest gates green |
| SC-Web-1..4 | PASS (code) | Sheet.web centred card; SmartScrollView; wizard pane untouched; web no-trimmer helper |

## Invariants
I-DESKTOP-GATE-VIA-HOOK (via `useResponsiveLayout`), I-SUB-SHEET-INSIDE-PARENT (JSX-child mounts), Architecture-B no-`so_` (A7), events provider CHECK (no new provider value), I-KEYBOARD-NEVER-BLOCKS-INPUT (SmartScrollView), brand provider anti-injection (`validateBrandCoverProviderUrl` via `useBrandCoverUpload` for brand provider selects) — all preserved.

## Local gate output (captured)
- `tsc --noEmit` (mingla-business): zero errors in any ORCH-0989 file (pre-existing errors in home.tsx/buyer.tsx/ComposerV2/packages cross-resolution are unrelated baseline).
- jest: CoverPicker.dedicatedTrimmer + videoSourceCeiling + brandCoverRules + giphy/pexels service + useEventCoverVideoUpload + eventCoverVideoProcessingService + coverProviderBrowseService + 4 desktop-web gates → all GREEN.
- deno check: all 7 edge fns clean. deno test: upload-intent + webhook + pexels-search = 20 passed / 0 failed.

## db push command (operator / orchestrator, after REVIEW)
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0989-[unified-cover-picker-sheet]" && /Users/sethogieva/bin/supabase db push --linked
```
NOTE: remote head is `20260730000004`; this branch also carries `20260731000000_orch_0964_public_views_security_definer.sql` (idempotent ALTER VIEW, applied out-of-band per COMMS-0009, not yet in schema_migrations). `db push` will apply both `20260731000000` (safe re-run) and `20260801000000`. Run `/Users/sethogieva/bin/supabase migration list --linked` first to confirm no other remote-only rows before pushing.

## Edge functions to deploy (orchestrator, after db push, AS A SET — upload-intent + webhook PAIR per COMMS-0010)
```bash
for fn in event-cover-pexels-curated event-cover-video-upload-intent event-cover-video-webhook event-cover-video-source-uploaded event-cover-video-status event-cover-video-apply event-cover-video-cancel; do
  /Users/sethogieva/bin/supabase functions deploy "$fn" --project-ref gqnoajqerqhnvulmnyvv
done
```
`event-cover-video-webhook` must keep `verify_jwt:false` (Cloudinary signs callbacks). Verify-first-call: webhook should return 403 `missing_signature` (not 404); curated should return 401 `auth_required` without a Bearer.

## Deviations
1. **Icons:** the codebase's custom `Icon` component (constrained name set) is used instead of raw `@expo/vector-icons` Ionicons named in the DESIGN spec (`images-outline` etc.). Closest semantic `Icon` names chosen (`grid`/`sparkle`/`search`/`play`/`trash`/`globe`/`close`/`upload`). Satisfies the no-emoji anti-slop rule and matches the existing CoverPicker/BrandCoverPickerSheet icon convention. Pure-visual; no behavior/gate impact.
2. **Masonry:** implemented as N flex columns with shortest-column insertion (DESIGN §12 — NOT FlatList numColumns). Reanimated press/selection bounce + tab-slide are simplified to scale/opacity + segmented-pill active state (motion polish can be deepened in a designer follow-up; all 9 states + haptics + reduced-motion-safe present).
3. **Brand cover removal:** emits the null patch to the parent draft (BrandEditView/BrandCreationFlow persist on Save), rather than an immediate brand mutation. Matches the brand draft-then-save model; provider selects + device uploads + video still persist immediately.

## Test modifications ([TEST-MOD-APPROVED ORCH-0989] required in commit body)
- `mingla-business/src/wrappers/__tests__/KeyboardRoot.test.tsx` — `SHEET_CONSUMERS` entry `BrandCoverPickerSheet.tsx` swapped for `CoverPickerSheet.tsx` (the file was deleted; the replacement is the SmartScrollView consumer). Deletes 1 line.
- `mingla-business/src/hooks/__tests__/useEventCoverVideoUpload.test.ts` — ADDED a `jest.mock("../useBrands")` (additive, no deletions) so the new `brandKeys` import doesn't pull the supabase/expo-constants chain in the node test env.

## Discoveries for orchestrator
1. **Pre-existing test failures (NOT introduced by ORCH-0989, confirmed by stash-baseline comparison):**
   - `src/components/ui/__tests__/eventCoverMedia.test.ts` — 6 failed/4 passed on baseline AND with ORCH-0989 (asserts picker tokens live in `CreatorStep4Cover.tsx`; they live in `CoverPicker.tsx` since ORCH-0876/0964). Should be repointed to `CoverPicker.tsx` in a cleanup ORCH.
   - `src/services/__tests__/eventCoverMediaService.test.ts` — 1 failed/18 passed on baseline AND with ORCH-0989 (`rejects over-duration video covers`). Unrelated to cover-picker unification.
   - `src/wrappers/__tests__/KeyboardRoot.test.tsx` — 4 pre-existing ENOENT failures referencing deleted `TripBrandWizard.tsx` + `TripCreatorStep3Inclusions.tsx` (stale from META-ORCH-0972). My `SHEET_CONSUMERS` swap is unrelated to those 4.
2. **COMMS-0009 migration ordering:** the out-of-band `20260731000000` ORCH-0964 view migration will re-apply on the next `db push`; harmless (idempotent ALTER VIEW) but the operator should expect it in the push output.
3. **Brand cover bucket video MIME:** intentionally NOT added (video lives on Cloudinary; `brands.cover_media_url` stores the Cloudinary URL) — SPEC §5.2. No bucket migration.
