# SPEC — ORCH-0989 [Unified cover picker sheet]

**Mode:** SPEC (forensics) — architecture, contracts, data flow, storage, gates, success criteria, invariants, test cases. The visual/interaction pixel-spec is a `mingla-designer` pass that follows this SPEC (§13 🎨 OPEN).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0989-[unified-cover-picker-sheet]/` on branch `ORCH-0989-unified-cover-picker-sheet`
**Date:** 2026-05-29
**Investigation baseline:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0989_UNIFIED_COVER_PICKER.md` (read in full; this SPEC is built on its 8 findings + 5 discoveries).
**Confidence in contract:** HIGH — every layer read in full (picker components, services, edge fns, storage migration, video pipeline, both at-risk gates).

---

## 0. Comms Ledger (read on entry)

- **COMMS-0002 (WARN, OPEN, ALL)** — the `orch-0863` strict-grep C7 "no-new-backend-files" check blocks any PR adding files under `supabase/functions/` unless that file is added to an `ORCH_NNNN_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit. This SPEC adds one new edge function (`event-cover-pexels-curated`, §6.3) → `ORCH_0989_BACKEND_ALLOWLIST` MUST be added in the same commit (§9.4). **Factored.**
- **COMMS-0003 (WARN, OPEN, ALL)** — every external-API endpoint/enum/param/payload/rate-limit/attribution rule cited inline with the provider's canonical docs URL. **Honored throughout §6.**
- **COMMS-0010 (RESOLVED, ORCH-0978)** — Architecture B for video: integer `du_${ceil}`, NO `so_` start-offset; the trimmed local file IS the upload. **This SPEC preserves it byte-for-byte (§7) and forbids reintroducing `so_`.**
- No `BLOCK`/`OPEN` row targets `ORCH-0989` or `mingla-forensics`. Nothing gates this SPEC.

---

## 1. The outcome this SPEC delivers

A brand operator opens **one** "Add cover" button and immediately sees browsable grids — their own photos/videos (Library), trending GIFs (GIF), curated stock photos (Stock) — and picks one in two taps, no typing required. The same sheet serves event covers, trip covers, and brand covers. Today there are 3 picker components, 2 architectures, type-to-search-only, and video on 2 of 7 surfaces. This SPEC converges them onto ONE shared, Sheet-hostable, gallery-first picker, retires the duplicate `BrandCoverPickerSheet` + its two brand services, adds Giphy-trending + Pexels-curated browse, and extends video to trips + brand.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (🔒 LOCKED — the 4 operator decisions of 2026-05-29)

1. **ONE "Add cover" button → tabbed bottom sheet** with tabs **Library / GIF / Stock**. Gallery-first: every tab shows a browsable grid immediately, search optional at the top of GIF + Stock.
2. **Unify all three COVER surfaces** (events, trips, brand) onto ONE shared picker. Retire `BrandCoverPickerSheet` + `giphyBrandCoverService` + `pexelsBrandCoverService` (subtract-before-add).
3. **Avatar picker stays DEVICE-ONLY** — `BrandAvatarPickerSheet` does NOT join the unified sheet. Untouched except where it shares code the unification touches (it does not — it imports none of the cover services).
4. **Video everywhere** — Library tab enables VIDEO on event AND trip AND brand covers, via the proven ORCH-0978 Architecture-B trim→upload→Cloudinary chain, plus the backend generalization required to accept a brand target (§8) and the brand-cover storage change (§5).

### 2.2 Non-Goals (explicitly OUT)

- **Avatar unification** — out (decision #3). No GIF/Stock/video on avatars.
- **Pexels stock VIDEO tab** — `GET /v1/videos/popular` exists ([docs](https://www.pexels.com/api/documentation/#videos-search)) but is OUT of scope; Stock tab is curated PHOTOS only. Register as a future ORCH if ever wanted.
- **Provider-enum change** — the `EventCoverMediaProvider` union stays `"upload" | "giphy" | "pexels"` (Library = `"upload"`). NO new provider value, NO DB CHECK migration for the provider column (Finding F-7). A new value would break `events_cover_media_provider_check` + the `orch-0783` gate.
- **Render-side change** — covers render via shared `@mingla/event-rendering/EventCoverMedia` (Finding F-6). The picker is authoring-only; render is untouched.
- **Consumer-app (`app-mobile`) authoring** — consumers do not author covers; no consumer picker exists. OUT.
- **Admin authoring** — admin does not author brand/event covers. OUT.

### 2.3 Assumptions (stated, must hold)

- A1: ORCH-0978 video pipeline is live and proven E2E on events (per COMMS-0010 resolution + `project_cover_picker_unified_sheet_gated.md` gate). **Confirmed.**
- A2: Trips ARE events-table rows (`uploadEventCoverMedia` + the video pipeline are event_type-agnostic; trip cover already routes through `CoverPicker` with `eventRowId={trip.id}`). So enabling video on TRIPS is purely a client `enableVideoUpload` flip — no backend change for trips. **Confirmed** (CoverPicker.tsx:20-26 doc + TripCreatorStep1Basics.tsx:401 + EditPublishedTripScreen.tsx:1085 pass real events-row ids).
- A3: Enabling video on BRAND requires backend generalization because `event_cover_video_jobs.event_id` is `NOT NULL REFERENCES public.events(id)` and `requireEventManager` does `SELECT FROM events WHERE id=eventId` — a brand has no events-row (§8). **This is the single largest backend cost of this ORCH.**
- A4: Giphy stays client-direct; Pexels stays edge-proxied (Finding F-4; provider ToS — §6.1/§6.2).

---

## 3. Architecture decision (🔒 LOCKED)

**Converge on the existing `CoverPicker` component, extended to be (a) Sheet-hostable, (b) gallery-first with three tabs, and (c) target-aware (event vs trip vs brand).** Retire `BrandCoverPickerSheet`. Rationale:

- `CoverPicker` already owns the proven 7-field patch, the ORCH-0978 video path, the provider-metadata tokens, and is referenced by both `orch-0783` and `orch-0978` gates — keeping it as the single component preserves those gates with minimal amendment.
- `BrandCoverPickerSheet` is the duplicate (Finding F-2/F-8); it + its two brand services are deleted.
- A new thin wrapper component **`CoverPickerSheet`** wraps `CoverPicker` inside the `Sheet` primitive so all 7 surfaces present the SAME sheet. Inline (events/trips wizards) and Sheet (brand) both render `CoverPickerSheet` (the sheet is the canonical surface for ALL; the wizards open it from a button too — see §4 mount migrations).

### 3.1 New + retired component inventory

| Action | File | Note |
|--------|------|------|
| **CREATE** | `mingla-business/src/components/ui/CoverPickerSheet.tsx` | `Sheet`-hosted wrapper of `CoverPicker`; props in §4.1. |
| **MODIFY** | `mingla-business/src/components/ui/CoverPicker.tsx` | Add 3-tab gallery-first body; add `coverTarget` prop (§4.2); route brand target to brand persistence; wire Giphy-trending + Pexels-curated browse. |
| **CREATE** | `mingla-business/src/services/coverProviderBrowseService.ts` | Unified Giphy-trending (client) + Pexels-curated (edge) browse calls (§6). Replaces the brand duplicates. |
| **CREATE** | `supabase/functions/event-cover-pexels-curated/index.ts` | New Pexels `/v1/curated` edge route (§6.3). Backend allowlist required (§9.4). |
| **DELETE** | `mingla-business/src/components/brand/BrandCoverPickerSheet.tsx` | Retired; gate `orch-0805` Check 8 repointed (§9.1). |
| **DELETE** | `mingla-business/src/services/giphyBrandCoverService.ts` | Duplicate of `giphyEventCoverService`; gate `orch-0805` Check 6 amended (§9.1). |
| **DELETE** | `mingla-business/src/services/pexelsBrandCoverService.ts` | Duplicate; same. |
| **KEEP (re-used)** | `mingla-business/src/hooks/useBrandCoverUpload.ts` + `services/brandCoverService.ts` + `utils/brandCoverRules.ts` | Brand DEVICE-upload + provider-URL-validation pipeline still used by `CoverPicker` brand target. Extended for video MIME (§5). |
| **UNTOUCHED** | `mingla-business/src/components/brand/BrandAvatarPickerSheet.tsx` | Decision #3. |

---

## 4. UI layer — the unified sheet + every mount-point migration

### 4.1 `CoverPickerSheet.tsx` props (🔒 LOCKED)

```ts
export interface CoverPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Discriminated cover target. Drives persistence + video-availability. */
  target: CoverTarget;
  /** Current cover state for preview + remove. */
  initial: CoverPatch;          // the 7-field patch shape from CoverPicker.tsx:109
  onCoverChange: (patch: CoverPatch) => void;
  onShowToast: (msg: string) => void;
  disabled?: boolean;
}
```

The sheet renders `<Sheet visible onClose snapPoint="full">` (web auto-resolves to centred card — §4.4) hosting `<CoverPicker target=... ... />`. The sheet owns NOTHING beyond mount + close; `CoverPicker` owns all picker state. The sheet MUST be mounted as a JSX child of the parent host `View` (I-SUB-SHEET-INSIDE-PARENT, §11).

### 4.2 `CoverTarget` discriminated union (🔒 LOCKED — replaces ad-hoc `brandId`+`eventRowId` props)

```ts
export type CoverTarget =
  | {
      kind: "event" | "trip";
      brandId: string;
      eventRowId: string;          // events-table row id (event id, or trip's events-row id)
      coverMediaApplyMode: "draft_auto" | "published_manual";
    }
  | {
      kind: "brand";
      brandId: string;
      accountId: string;           // needed by useBrandCoverUpload's updateBrand
      existingDescription: string | null;  // needed by useUpdateBrand optimistic patch
    };
```

`CoverPicker` switches on `target.kind`:
- `"event" | "trip"` → device image/GIF + provider selection persist via `uploadEventCoverMedia` / direct 7-field patch (the existing path); video persists via the event-scoped `useEventCoverVideoUpload(eventRowId, brandId, applyMode)`.
- `"brand"` → device image/GIF persist via `useBrandCoverUpload.uploadCover({source:{kind:"upload",...}})`; provider selection persists via `useBrandCoverUpload.uploadCover({source:{kind:"provider",ref}})` (this validates host allowlist via `validateBrandCoverProviderUrl`); video persists via the generalized brand-video pipeline (§8).

> 🔒 LOCKED: `CoverPicker`'s existing `brandId` / `eventRowId` / `coverMediaApplyMode` / `initial*` props are subsumed by `target` + `initial`. The 7-field `CoverPatch` emit contract (CoverPicker.tsx:109-119) and the `onCoverChange` callback shape are UNCHANGED — every mount point keeps consuming the same patch.

### 4.3 Tab model (🔒 LOCKED behaviour; 🎨 OPEN visuals)

| Tab | id | Source | Browse-first (no query) | Optional search | Video |
|-----|-----|--------|--------------------------|------------------|-------|
| **Library** | `"library"` | device photos + videos (`ImagePicker.launchImageLibraryAsync`) | Device picker opens to OS gallery on tap (OS owns the grid) | n/a | YES (per target — §4.5) |
| **GIF** | `"gif"` | Giphy | Giphy **trending** on tab open (§6.1) | Giphy search (≥2 chars) | no |
| **Stock** | `"stock"` | Pexels | Pexels **curated** on tab open (§6.2/§6.3) | Pexels search (≥2 chars, existing fn) | no |

- 🔒 On entering GIF or Stock tab with an empty query, the picker MUST issue the trending/curated browse call and render its grid (gallery-first). The current "blank until search" behaviour (CoverPicker.tsx:855-883) is REPLACED.
- 🔒 The result layout is a **wrapping grid** (not the current horizontal strip at CoverPicker.tsx:855 `horizontal`). The brand sheet's 3-col wrapping grid (`BrandCoverPickerSheet.tsx:546-554`) is the reference layout; exact columns are 🎨 OPEN.
- 🔒 Attribution strings stay verbatim: "Powered by GIPHY" (GIF tab) + "Photos provided by Pexels" (Stock tab) — provider ToS (§6).
- 🔒 The "Library" tab on a target with video enabled keeps BOTH actions: "Upload image/GIF" and "Upload video" (CoverPicker.tsx:704-734), plus "Remove" when a cover exists.

### 4.4 Mount-point migrations (🔒 LOCKED — all 6 cover mounts; avatar untouched)

| # | Surface | File:line today | Change |
|---|---------|------------------|--------|
| M1 | Event create wizard Step 4 | `CreatorStep4Cover.tsx` (mounts inline `CoverPicker`) | Replace inline `CoverPicker` with an "Add cover" / "Change cover" button that opens `CoverPickerSheet` with `target={kind:"event", brandId, eventRowId:coverMediaEventId, coverMediaApplyMode:"draft_auto"}`. Preview thumbnail + credit stay inline; the picker UI moves into the sheet. Video stays enabled. |
| M2 | Event EditPublishedScreen Cover step | `EditPublishedScreen.tsx:1007` via `CreatorStep4Cover` | Same as M1 with `coverMediaApplyMode:"published_manual"`, `eventRowId:liveEvent.serverEventId`. |
| M3 | Trip create wizard Step 1 Basics | `TripCreatorStep1Basics.tsx:394` (inline `CoverPicker`, `enableVideoUpload={false}`) | Same button→`CoverPickerSheet` pattern, `target={kind:"trip", brandId, eventRowId:tripEventId, coverMediaApplyMode:"draft_auto"}`. **Video now ENABLED** (decision #4). |
| M4 | Trip EditPublishedTripScreen Cover | `EditPublishedTripScreen.tsx:1083` (inline, `enableVideoUpload={false}`) | Same, `target={kind:"trip", eventRowId:trip.id, coverMediaApplyMode:"published_manual"}`. **Video now ENABLED.** |
| M5 | BrandEditView cover | `BrandEditView.tsx:823` (`BrandCoverPickerSheet`) | Replace `BrandCoverPickerSheet` with `CoverPickerSheet` `target={kind:"brand", brandId:brand.id, accountId, existingDescription:joinBrandDescription(...)}`. `handleOpenCoverPicker` / `handleCoverPicked` adapt to the 7-field `onCoverChange`. |
| M6 | BrandCreationFlow (onboarding) cover | `BrandCreationFlow.tsx:390` (`BrandCoverPickerSheet`) | Same replacement as M5. |
| — | BrandEditView avatar | `BrandEditView.tsx:839` (`BrandAvatarPickerSheet`) | **UNTOUCHED** (decision #3). |

> 🔒 Wizard inline→sheet caveat: M1/M3 mount inside the desktop-web wizard left-rail + contained pane (contracts 12-14, §10). Opening `CoverPickerSheet` over the wizard pane MUST NOT regress the rail/pane. The 4 desktop-web jest gates (§9.3) must stay green.

### 4.5 Per-target video availability (🔒 LOCKED)

| Target | Library video enabled? | Persistence path |
|--------|------------------------|-------------------|
| event | YES (today) | `useEventCoverVideoUpload(eventRowId, brandId, applyMode)` → events-scoped Cloudinary pipeline → `events.cover_media_url` |
| trip | **YES (new)** | identical (trip IS an events-row; A2) |
| brand | **YES (new)** | generalized brand-video pipeline (§8) → `brands.cover_media_url` |

### 4.6 Brand provider-selection persistence nuance (🔒 LOCKED)

For `target.kind === "brand"`, a GIF or Stock selection does NOT emit the generic 7-field patch directly into `brands`; it MUST route through `useBrandCoverUpload.uploadCover({source:{kind:"provider", ref:{provider, publicUrl, attribution}}})` so `validateBrandCoverProviderUrl` enforces the Pexels/Giphy host allowlist (`brandCoverRules.ts:266-310`) before persisting to `brands.cover_media_url`. The picker then emits the resulting `CoverPatch` to `onCoverChange` for preview. This preserves the ORCH-0805 anti-injection guard. Event/trip targets keep their existing direct-patch path (the events publish RPC validates separately).

---

## 5. Storage layer — brand-cover bucket video change (🔒 LOCKED)

### 5.1 What actually needs to change (and what does NOT)

The processed video lands on **Cloudinary**, NOT the `brand_covers` Supabase bucket (confirmed: `event-cover-video-apply/index.ts:50-55` writes `cover_media_url = job.processed_url` which is a Cloudinary URL; the source upload goes straight to Cloudinary, never to Supabase Storage). Therefore:

- The `brand_covers` **bucket** stores ONLY device image/GIF uploads (the `uploadBrandCover` path). It does **not** need to store video bytes.
- **HOWEVER** — the dispatch's locked decision #4 requires the brand-cover storage to "accept video with appropriate size/duration limits consistent with the event-cover video caps." Interpreted precisely: the brand cover surface must ACCEPT a video cover end-to-end, persisting a Cloudinary `cover_media_type="video"` URL on `brands`. No video bytes hit the bucket. The "storage change" is therefore: (a) the brand-video Cloudinary path (§8), and (b) a host-allowlist extension so the validator accepts the Cloudinary video host when persisting `brands.cover_media_url` (§5.3).

### 5.2 Brand-cover bucket: NO video MIME added (🔒 LOCKED)

The `brand_covers` bucket `allowed_mime_types` stays `['image/jpeg','image/png','image/webp','image/gif']` and `file_size_limit` stays 8 MB (the operator-hotfixed runtime cap; `brandCoverRules.ts:27` `BRAND_COVER_MAX_BYTES = 8MB`; bucket migration declares 15 MB at the bucket level but the service rejects > 8 MB pre-read). **Do NOT add `video/*` to the bucket** — video never transits this bucket; adding it would be dead config and would imply a direct-to-bucket video path that does not exist.

> 🔵 NOTE for the implementor: the bucket migration `20260529000000` declares `file_size_limit = 15728640` (15 MB) while the service enforces 8 MB. That is the existing ORCH-0805-hotfix state (intentional — bucket is a loose ceiling, service is the real cap). Do NOT "fix" this drift; it is documented at `brandCoverRules.ts:19-26`.

### 5.3 Cloudinary video-host allowlist for brand persistence (🔒 LOCKED — NEW migration NOT required; code-only)

`validateBrandCoverProviderUrl` (`brandCoverRules.ts:266`) only knows `pexels`/`giphy` hosts. The brand-video apply path persists a Cloudinary `res.cloudinary.com` URL. Because brand video persists via the generalized server pipeline (§8) which writes `brands.cover_media_url` server-side (NOT via the client provider-ref path), **the client validator does not gate it** — the server is the trust boundary. No client allowlist change is needed for video. (Pexels/Giphy host allowlist unchanged.)

### 5.4 Brand video caps (🔒 LOCKED — reuse event caps verbatim)

Brand video reuses the event-cover caps exactly: processed ≤ 29 s (`EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`), source ceiling 33 s (`EVENT_COVER_SOURCE_CEILING_MS`), source ≤ 100 MB / ≤ 60 s (`MAX_SOURCE_VIDEO_BYTES` / `MAX_SOURCE_VIDEO_DURATION_MS`), processed ≤ 25 MB (`FINAL_MAX_BYTES`), Architecture B integer `du_`, no `so_`. No new caps; no new constants. The "generous source / 29 s processed" gate (`orch-0978-video-cap-29s.mjs`) is preserved unchanged.

---

## 6. Services + edge — provider browse (external-API, docs-cited per COMMS-0003)

### 6.1 Giphy Trending — client-direct (🔒 LOCKED)

- **Endpoint:** `GET https://api.giphy.com/v1/gifs/trending` — docs: https://developers.giphy.com/docs/api/endpoint/#trending
- **Auth:** `api_key` query param from `EXPO_PUBLIC_GIPHY_API_KEY` (client-exposed, per Giphy ToS). Giphy **requires** client-side calls and **forbids** proxying: https://developers.giphy.com/docs/api/ ("all requests to GIPHY should be made directly from the client side"). → keep client-direct; do NOT route through an edge fn.
- **Params:** `api_key` (required); `limit` (default 25, clamp 6–25 to match existing `searchGiphyEventCovers`); `offset` (0–499); `rating` (`"pg"` to match existing search). Docs: https://developers.giphy.com/docs/api/endpoint/#trending
- **No `q` param** — trending returns top content with no query.
- **Response shape:** `{ data: GifObject[], pagination, meta }` — identical object shape to search; the EXISTING `normalizeResult` (`giphyEventCoverService.ts:45-69`) parses `images.fixed_width.url` / `downsized_medium` and works unchanged.
- **Rate limit:** beta/free key = 100 calls/hour; production key required to exceed. Docs: https://developers.giphy.com/docs/api/#rate-limits . → debounce tab-open trending (one call per tab-open, not per keystroke) and reuse the result while the tab stays open.
- **Attribution:** MUST display "Powered By GIPHY" where the API is used. Docs: https://developers.giphy.com/docs/api/#design-guidelines-and-requirements . Keep the existing "Powered by GIPHY" footer string.

New function in `coverProviderBrowseService.ts`:
```ts
export const trendingGiphyCovers = async (
  options?: { limit?: number; offset?: number },
): Promise<GiphyCoverSearchResult[]>   // returns the SAME GiphyCoverSearchResult[] as search
```
Same `EventCoverProviderError` codes as `searchGiphyEventCovers` (`not_configured` / `rate_limited` / `provider_unavailable` / `invalid_response`). MUST hit `https://api.giphy.com/v1/gifs/trending` (so a `orch-0989` gate can assert the literal — §9.5) and MUST NOT contain `supabase.functions.invoke` or `PEXELS_API_KEY` (mirrors `orch-0783` line 79 for the search adapter).

### 6.2 Pexels Curated — edge-proxied (🔒 LOCKED)

- **Endpoint:** `GET https://api.pexels.com/v1/curated` — docs: https://www.pexels.com/api/documentation/#photos-curated
- **Auth:** `Authorization: <PEXELS_API_KEY>` header, key SERVER-SIDE only (`Deno.env.get("PEXELS_API_KEY")`). Pexels requires the key be kept secret: https://www.pexels.com/api/documentation/#authorization . → MUST be edge-proxied; never client-side.
- **Params:** `page` (default 1); `per_page` (default 15, max 80 — clamp 6–20 to match existing search fn). Docs: https://www.pexels.com/api/documentation/#photos-curated . **No `query` param; no `orientation` param** — `/v1/curated` does not accept orientation (only `/v1/search` does), so curated results are NOT landscape-filtered. This is acceptable for a browse grid (the user picks; the cover renderer crops).
- **Response shape:** `{ page, per_page, photos: Photo[], total_results, next_page, prev_page }`. Photo object: `{ id, width, height, url, photographer, photographer_url, avg_color, alt, src: { landscape, ... } }` — IDENTICAL to search; the existing edge mapper (`event-cover-pexels-search/index.ts:147-162`) is copy-reusable.
- **Rate limit:** 200 requests/hour, 20,000/month default. Docs: https://www.pexels.com/api/documentation/#guidelines (rate-limit headers `X-Ratelimit-Limit` / `X-Ratelimit-Remaining` / `X-Ratelimit-Reset`). → one curated call per tab-open; surface `x-ratelimit-*` like the search fn.
- **Attribution:** MUST show a prominent link to Pexels + credit the photographer. Docs: https://www.pexels.com/api/documentation/#guidelines . Keep "Photos provided by Pexels" footer + per-photo `photographer` credit.

### 6.3 New edge function `event-cover-pexels-curated` (🔒 LOCKED)

Because the existing `event-cover-pexels-search` fn (a) rejects empty query (`normalizeSearchRequest` requires len ≥ 2), and (b) hard-codes `orientation: "landscape"` (a param `/curated` does not accept), it CANNOT be reused for browse. Create a sibling fn.

- **File:** `supabase/functions/event-cover-pexels-curated/index.ts`
- **Method/route:** `POST` (matches `supabase.functions.invoke` convention used everywhere else). OPTIONS → CORS preflight (reuse `corsHeaders`).
- **Auth:** SAME `requireUser` Bearer-token gate as the search fn (`event-cover-pexels-search/index.ts:72-91`) — authed user required (brand operators are authed). Returns `{ error: "auth_required" }` 401 on failure.
- **Request schema:** `{ page?: number; perPage?: number }` — no query. Clamp `page` 1–50, `perPage` 6–20 (mirror search clamps).
- **Upstream call:** `GET https://api.pexels.com/v1/curated?page=<p>&per_page=<n>` with `Authorization: <PEXELS_API_KEY>` header + 8 s `AbortController` timeout (mirror search fn:121-133).
- **Response schema (success):** `{ photos: PexelsCoverSearchResult[]; page: number; nextPage: number | null; rateLimit: { limit, remaining, reset } }` — IDENTICAL to the search fn response so the client `PexelsCoverSearchPage` type + `searchPexelsEventCovers` normalizer are reused.
- **Error shapes:** `{error:"pexels_not_configured"}` 500 (no key); `{error:"pexels_rate_limited", rateLimit}` 429; `{error:"pexels_unavailable", rateLimit}` 502; `{error:"method_not_allowed"}` 405. Same vocabulary as the search fn so `errorCodeForEdgeError` (`pexelsEventCoverService.ts:28-36`) maps it unchanged.
- **Secret handling:** key read ONLY via `Deno.env.get("PEXELS_API_KEY")`; never echoed in any response. (COMMS-0003 — no provider secret in client code; this keeps it server-side.)

New client function in `coverProviderBrowseService.ts`:
```ts
export const curatedPexelsCovers = async (
  options?: { page?: number; perPage?: number },
): Promise<PexelsCoverSearchPage>   // SAME PexelsCoverSearchPage as search
```
MUST call `supabase.functions.invoke("event-cover-pexels-curated", ...)`. MUST NOT read `PEXELS_API_KEY` client-side.

### 6.4 Service retirement (🔒 LOCKED — subtract-before-add)

- DELETE `giphyBrandCoverService.ts` + `pexelsBrandCoverService.ts`. The brand sheet was their only consumer; after M5/M6 migrate to `CoverPicker`, the brand picker uses `giphyEventCoverService` (search) + `searchGiphyEventCovers`/`trendingGiphyCovers` (browse) + `searchPexelsEventCovers`/`curatedPexelsCovers`. Brand provider SELECTION still validates via `validateBrandCoverProviderUrl` (kept).
- The `orch-0805` gate Check 6 (asserts the two brand services EXIST) MUST be amended in the SAME commit (§9.1) or CI fails.

---

## 7. Video-trim hand-off (🔒 LOCKED — Architecture B preserved verbatim)

The Library-tab video path is the EXISTING `CoverPicker.pickVideoCover` body (CoverPicker.tsx:473-554) → `trimVideoWithDedicatedEditor` (`showEditor`, `maxDuration: EVENT_COVER_MAX_VIDEO_DURATION_MS`) → `buildTrimmedVideoUploadFile` (`trimStartMs:0`, `uri:outputPath`) → `useEventCoverVideoUpload.start()`. For event/trip targets this is unchanged. For brand target it routes through the generalized brand-video hook (§8). 🔒 NO `so_` start-offset; integer `du_${ceil}` only (COMMS-0010). Web has no trimmer (`isNative` branch CoverPicker.tsx:492-496) — on web the raw asset is used; brand web video acceptance follows the same web limitation (acceptable; documented).

---

## 8. Brand video backend generalization (🔒 LOCKED — the largest backend cost)

The event-cover video pipeline is **events-table-bound**. To accept a brand cover video, generalize the 6 edge functions + the job table to support a brand-scoped target. **Recommended approach (Option A) is LOCKED below; Option B documented as the rejected alternative for the implementor's context.**

### 8.1 Option A — generalize the existing pipeline with a nullable `brand_target` (🔒 LOCKED)

**Migration `supabase/migrations/20260801000000_orch_0989_brand_cover_video_target.sql`:**
- `ALTER TABLE public.event_cover_video_jobs ALTER COLUMN event_id DROP NOT NULL;`
- `ALTER TABLE public.event_cover_video_jobs ADD COLUMN target_kind text NOT NULL DEFAULT 'event' CHECK (target_kind IN ('event','brand'));`
- Add a row-level CHECK: `CHECK ((target_kind = 'event' AND event_id IS NOT NULL) OR (target_kind = 'brand' AND event_id IS NULL))` so a brand job has no event FK and an event job keeps its FK.
- `brand_id` already exists + is NOT NULL — reused for both kinds.
- RLS: the existing job-table RLS predicate (whatever gates `event_cover_video_jobs` today) MUST also admit `target_kind='brand'` rows gated by `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('brand_admin')`. Read the live RLS on `event_cover_video_jobs` from migration `20260515000012_orch_0770_*` and extend it; do NOT weaken the event predicate.

**Edge functions (all 6 under `supabase/functions/event-cover-video-*`):**
- `requireEventManager` (in `_shared/eventCoverVideo.ts:159`) is event-bound (selects from `events`). Add a sibling `requireBrandCoverManager(supabase, brandId, userId)` that resolves `biz_brand_effective_rank` (NOT via `events`) and requires ≥ `brand_admin` (50). Each fn dispatches on `target_kind` / presence of `eventId`.
- `event-cover-video-upload-intent`: accept `{ target: "brand", brandId }` (no `eventId`); skip the `requireEventManager` `events` lookup; use `requireBrandCoverManager`; Cloudinary `public_id` becomes `brand-covers/raw/${brandId}/${job.id}` (no eventId segment); `context` carries `target_kind=brand|brand_id=...|job_id=...` (no `event_id`); the supersede-prior-active-jobs query keys on `brand_id` + `target_kind='brand'` instead of `event_id`.
- `event-cover-video-source-uploaded` / `-status` / `-cancel`: branch on the job's `target_kind`; identical state machine.
- `event-cover-video-apply`: when `target_kind='brand'`, write `UPDATE public.brands SET cover_media_url = job.processed_url, cover_media_type = 'video', updated_at = now() WHERE id = job.brand_id` instead of the `events` update (apply fn:50-55). 🔒 The brand video processed URL persists to `brands.cover_media_url` + `brands.cover_media_type='video'`.
- `event-cover-video-webhook`: the eager-callback context parse must tolerate the `event_id`-absent / `brand_id`-present brand shape (it already recovers job_id from `context`/`public_id` per COMMS-0010 AMENDMENT-5; extend `recoverJobIdFromPayload` to the brand `public_id` template `brand-covers/raw/${brandId}/${job.id}`).
- 🔒 Cloudinary eager string stays Architecture B verbatim (`c_limit,w_1280,h_720`, integer `du_${ceil}`, `vc_h264`, `ac_aac`, `br_...`, `f_mp4`, `q_auto:good`; NO `so_`). Same caps (§5.4).

**Client hook:** `useEventCoverVideoUpload` (today `(eventRowId, brandId, applyMode)`) gains a brand mode. Cleanest: a thin `useBrandCoverVideoUpload(brandId)` that calls the same processing-service functions with `{ target:"brand", brandId }` and, on `ready`, persists via `useBrandCoverUpload` semantics (or the apply fn writes `brands` directly and the hook just polls to `applied`). 🔒 LOCKED: brand video uses `applyMode` semantics equivalent to `published_manual` (a brand is always "live"), so the apply step writes `brands.cover_media_url` immediately on `ready` (mirror the event published_manual path).

### 8.2 Option B — parallel brand-video pipeline (🔵 REJECTED, documented)

A separate `brand_cover_video_jobs` table + 6 new edge fns. Rejected: doubles the surface area, duplicates the Cloudinary signing/webhook/destroy logic (the exact DRY sin this ORCH is removing on the client), and multiplies the COMMS-0010 webhook-drift risk. Option A reuses one battle-tested pipeline.

### 8.3 Backend allowlist + migration (COMMS-0002)

The migration `20260801000000_orch_0989_brand_cover_video_target.sql` + the new edge fn `event-cover-pexels-curated/index.ts` + any edits to the 6 `event-cover-video-*` fns + `_shared/eventCoverVideo.ts` MUST be added to `ORCH_0989_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit (§9.4). The 6 existing video fns + `_shared/eventCoverVideo.ts` are EDITS not new files, but C7 may still flag modified backend files depending on its diff mode — include them defensively (per the ORCH-0863 implementor-checklist note in COMMS-0002 acked_by).

---

## 9. CI gate amendments (🔒 LOCKED — all land in the SAME commit as the code)

### 9.1 `orch-0805-brand-cover-overhaul.mjs` — repoint away from the retired sheet

- **Check 6** (lines 167-173) asserts `pexelsBrandCoverService.ts` + `giphyBrandCoverService.ts` EXIST. Since both are DELETED → **remove Check 6 entirely** OR repoint to assert the unified browse service exists: change to assert `mingla-business/src/services/coverProviderBrowseService.ts` exists AND exports `trendingGiphyCovers` + `curatedPexelsCovers`. 🔒 LOCKED: repoint (don't just delete) so brand provider browse stays gated.
- **Check 8** (lines 189-201) asserts `BrandCoverPickerSheet.tsx` EXISTS + contains tab labels "Upload"/"Pexels"/"GIPHY". Since the file is DELETED → repoint to assert the unified surface: `CoverPickerSheet.tsx` exists AND `CoverPicker.tsx` contains the unified tab labels "Library"/"GIF"/"Stock" (or whatever the designer locks — assert the tab `id`s `"library"/"gif"/"stock"` which are LOCKED in §4.3, not the display labels which are 🎨 OPEN). 🔒 LOCKED: assert on tab `id` literals, not display copy.
- **Checks 1–5, 7, 9** (bucket migration, brand admin write policies, `brandCoverRules` exports, `brandCoverService` exports, `BrandEditView` no `COVER_HUE_TILES`, shared page renders via `EventCoverMedia`) are UNCHANGED — they still hold (the bucket + rules + service + render path are all preserved).
- Update the header comment + final `console.log("...9/9 checks")` count to match the new check count.

### 9.2 `orch-0783-event-cover-image-provider-pivot.mjs` — admit gallery-first

- Line 70-71 requires the event composite (`CreatorStep4Cover` + `CoverPicker`) to contain `searchGiphyEventCovers` + `searchPexelsEventCovers`. Since the gallery-first picker ADDS `trendingGiphyCovers` + `curatedPexelsCovers` but KEEPS search, this still passes — **but** if M1 moves the picker UI out of `CreatorStep4Cover` into `CoverPickerSheet`, the composite `step4 + coverPicker` may no longer be where the tokens live. 🔒 LOCKED: amend line 42's `eventCoverComposite` to also concatenate `CoverPickerSheet.tsx` so the tokens are found wherever they land. Add `trendingGiphyCovers`/`curatedPexelsCovers` as additionally-required tokens (gallery-first proof).
- Line 76 `giphy.includes("https://api.giphy.com/v1/gifs/search")` — STILL required (search retained). Add a parallel assertion that the browse service contains `https://api.giphy.com/v1/gifs/trending` (assert against `coverProviderBrowseService.ts`).
- Line 79 forbids `giphy` containing `supabase.functions.invoke` / `PEXELS_API_KEY` — STILL holds (Giphy stays client-direct). Apply the same negative assertion to `coverProviderBrowseService.ts`'s Giphy path.
- Line 82-90 Pexels-edge assertions UNCHANGED (the new curated route is additive; search route still exists with `PEXELS_API_KEY` + (search-only) `orientation`).
- 🔒 The `forbiddenStep4` list (lines 53-62) must keep passing — M1 moves the picker into the sheet but `CreatorStep4Cover` must still NOT expose `pickVideoCover`/`Replace video`/etc. directly. Verify the new `CreatorStep4Cover` (a button + preview only) contains none of those tokens.

### 9.3 Desktop-web jest gates — keep green (§10)

`test:orch-0885-a`, `BottomNavWebDesktopPolish`, `wizardDesktopLayout`, `homeKpiPresentation`, `useResponsiveLayout` — run all 4 (+ the responsive hook test) after touching M1/M3 wizard files. No gate edits expected; they must simply stay green.

### 9.4 New `ORCH_0989_BACKEND_ALLOWLIST` (COMMS-0002)

Add to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`:
```
const ORCH_0989_BACKEND_ALLOWLIST = [
  "supabase/functions/event-cover-pexels-curated/index.ts",
  "supabase/migrations/20260801000000_orch_0989_brand_cover_video_target.sql",
  // generalized video fns + shared (edits; defensive include):
  "supabase/functions/event-cover-video-upload-intent/index.ts",
  "supabase/functions/event-cover-video-source-uploaded/index.ts",
  "supabase/functions/event-cover-video-status/index.ts",
  "supabase/functions/event-cover-video-apply/index.ts",
  "supabase/functions/event-cover-video-cancel/index.ts",
  "supabase/functions/event-cover-video-webhook/index.ts",
  "supabase/functions/_shared/eventCoverVideo.ts",
];
```
Wire it into the C7 allowlist union exactly as `META_ORCH_0952_BACKEND_ALLOWLIST` was (COMMS-0002 acked_by `f62cfefb`).

### 9.5 New gate `orch-0989-unified-cover-picker.mjs` (🔒 LOCKED — establishes the new invariants)

A new strict-grep gate + workflow job asserting:
1. `CoverPickerSheet.tsx` exists and renders `<Sheet` + `<CoverPicker`.
2. `CoverPicker.tsx` contains the tab `id` literals `"library"`, `"gif"`, `"stock"` (gallery-first tab model).
3. `coverProviderBrowseService.ts` exists, exports `trendingGiphyCovers` + `curatedPexelsCovers`, contains `https://api.giphy.com/v1/gifs/trending`, calls `event-cover-pexels-curated`, and does NOT read `PEXELS_API_KEY`.
4. `event-cover-pexels-curated/index.ts` exists, reads `PEXELS_API_KEY` server-side, hits `https://api.pexels.com/v1/curated`, and does NOT send `orientation`.
5. `BrandCoverPickerSheet.tsx`, `giphyBrandCoverService.ts`, `pexelsBrandCoverService.ts` do NOT exist (retirement proof).
6. The brand-video migration exists and `event-cover-video-apply/index.ts` contains an `UPDATE` to `brands` SET `cover_media_url` (brand apply target).
7. Architecture-B negative: NONE of the video edge fns contain `so_` (no server-cut start-offset).

---

## 10. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behaviour + files | Parity |
|---|---------|----------|-------------------|--------|
| 1 | **Consumer iOS** (`app-mobile`) | NO | Consumers don't author covers; no picker. | — |
| 2 | **Consumer Android** | NO | Same. | — |
| 3 | **Buyer/anon Web** (`/b/{slug}`, `/e/...`, `/checkout/...`) | NO (render only) | Covers RENDER via shared `EventCoverMedia`; picker is authoring-only (F-6). The new video covers will simply render as video on these pages (already supported). | automatic (shared render) |
| 4 | **Business iOS** (`mingla-business`) | YES | All 6 cover mounts (M1-M6) open `CoverPickerSheet`; Library video on event+trip+brand; GIF trending; Stock curated. Files: §3.1 + §4.4. | shared component → automatic |
| 5 | **Business Android** | YES | Identical to iOS (shared RN code). Native trimmer works on Android (react-native-video-trim). | shared → automatic; tester must still run Android (parity-enforcement) |
| 6 | **Admin Web** | NO | Admin doesn't author brand/event covers. | — |
| 7 | **Business Web preview** (`mingla-business` web build) | YES | `CoverPickerSheet` resolves to the desktop centred-card (≥1024px) / mobile bottom-sheet (<1024px) via `Sheet.web.tsx` + `useResponsiveLayout()` (I-DESKTOP-GATE-VIA-HOOK). Library video has NO trimmer on web (uses raw asset, §7). GIF/Stock grids render. The wizards (M1/M3) keep their desktop left-rail + contained pane (contracts 12-14). | manual — separate web success criteria (SC-Web below) |

🔒 Per-surface success criteria where parity is MANUAL (Business Web):
- **SC-7-Web-1:** On desktop web (≥1024px) the cover sheet renders as a centred floating card (width `min(640, vw-64)`, max-h `min(80vh, vh-64)`), NOT a full bottom sheet.
- **SC-7-Web-2:** `Sheet.web.tsx` imports the mobile sheet from `./SheetMobile` (NEVER `./Sheet`) — no self-import recursion → no mobile-web renderer OOM (ORCH-0964 precedent, `830c52be2`/`41ec95698`).
- **SC-7-Web-3:** Opening the cover sheet over a create wizard (M1/M3) does NOT collapse/regress the desktop left-step-rail or the contained form pane (contracts 12-14).
- **SC-7-Web-4:** Library video on web uses the raw asset (no trimmer); the sheet must not crash when `showEditor` is unavailable.

---

## 11. Invariants

### 11.1 Preserved (each with how + test)

| Invariant | How preserved | Test |
|-----------|---------------|------|
| **I-DESKTOP-GATE-VIA-HOOK** | `CoverPickerSheet` uses `Sheet` which gates web layout via `useResponsiveLayout()` only. | SC-7-Web-1 + jest `useResponsiveLayout` |
| **I-SUB-SHEET-INSIDE-PARENT** | `CoverPickerSheet` mounted as JSX child of each parent host `View` (M1-M6), never a sibling Fragment. | gate §9.5; manual sim |
| **ORCH-0978 Architecture-B (integer `du_`, no `so_`)** | Brand video reuses the same eager string; gate §9.5(7) asserts no `so_`. | `orch-0978-video-cap-29s.mjs` + §9.5(7) |
| **events `cover_media_provider` CHECK** | No new provider value; Library = `"upload"`. | `orch-0783` line 94 |
| **I-RN-COLOR-FORMATS** | New styles use hsl/hex/rgb only (designer pass). | lint |
| **I-KEYBOARD-NEVER-BLOCKS-INPUT** | Search inputs flow through SmartScrollView/KAS (existing pattern, CoverPicker.tsx:48); no bespoke keyboard listeners. | `orch-0892-no-bespoke-keyboard-plumbing.mjs` |
| **Brand provider URL anti-injection** | Brand provider selection still validates via `validateBrandCoverProviderUrl` (§4.6). | `brandCoverRules.test.ts` + new test |
| **Stripe RAK / pk_live / etc.** | Untouched (no money path). | n/a |

### 11.2 NEW invariants proposed (DRAFT → ACTIVE on CLOSE)

- **I-PROPOSED-UNIFIED-COVER-PICKER-SINGLE-SHEET** — All cover authoring surfaces (event create, event edit, trip create, trip edit, brand edit, brand onboarding) MUST mount the SAME `CoverPickerSheet`/`CoverPicker` component. No second cover-picker component may exist. `BrandCoverPickerSheet` is permanently retired. Backed by gate §9.5(1)(5). (Avatar is exempt — separate device-only sheet.)
- **I-PROPOSED-COVER-PICKER-GALLERY-FIRST** — Every provider tab (GIF, Stock) MUST present a populated browse grid on tab-open with NO query required (Giphy trending / Pexels curated). Search is additive, never the entry gate. Backed by gate §9.5(2)(3)(4).
- **I-PROPOSED-BRAND-COVER-VIDEO-VIA-SHARED-PIPELINE** — Brand cover video MUST reuse the generalized `event_cover_video_jobs` pipeline (Option A); no parallel brand-video table/edge-fn set. Brand video persists to `brands.cover_media_url` + `cover_media_type='video'` via the apply fn. Backed by gate §9.5(6).
- **I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED** — (existing DRAFT, COMMS-0003) every Giphy/Pexels endpoint/param/rate-limit/attribution cited inline (§6). Honored.

---

## 12. Success criteria (observable, testable, unambiguous)

1. **SC-1 (single sheet):** Tapping "Add cover"/"Change cover" on ALL 6 cover surfaces opens the identical `CoverPickerSheet` with tabs Library / GIF / Stock.
2. **SC-2 (gallery-first GIF):** Opening the GIF tab with empty query renders a grid of ≥6 trending GIFs within one network round-trip; no typing required. Typing ≥2 chars + search swaps to search results.
3. **SC-3 (gallery-first Stock):** Opening the Stock tab with empty query renders a grid of ≥6 curated Pexels photos; no typing required. Search ≥2 chars works as before.
4. **SC-4 (Library image/GIF):** Picking a device image/GIF persists the correct 7-field patch and shows the preview + credit; brand target persists via `useBrandCoverUpload` (host-validated for provider; bucket-uploaded for device).
5. **SC-5 (event video, unchanged):** Event cover video trim→upload→ready→`events.cover_media_url` works exactly as ORCH-0978 (regression).
6. **SC-6 (trip video, NEW):** Trip cover (create + edit) accepts a video via the same trim→Cloudinary path; `events.cover_media_url` for the trip's events-row gets the processed Cloudinary URL with `cover_media_type='video'`.
7. **SC-7 (brand video, NEW):** Brand cover accepts a video; a `target_kind='brand'` job runs the generalized pipeline; on ready, `brands.cover_media_url` = processed Cloudinary URL + `cover_media_type='video'`; renders on `/b/{slug}`.
8. **SC-8 (retirement):** `BrandCoverPickerSheet.tsx`, `giphyBrandCoverService.ts`, `pexelsBrandCoverService.ts` no longer exist; `grep` for `BrandCoverPickerSheet` across `mingla-business/src` returns zero non-comment hits.
9. **SC-9 (secrets):** No client file reads `PEXELS_API_KEY`; Giphy uses `EXPO_PUBLIC_GIPHY_API_KEY` client-direct only; curated route reads the Pexels key server-side only.
10. **SC-10 (attribution):** GIF tab shows "Powered by GIPHY"; Stock tab shows "Photos provided by Pexels" + per-photo photographer credit.
11. **SC-11 (caps preserved):** Brand + trip video honor the same 29 s processed / 33 s source-ceiling / 100 MB-60 s source caps as events; no `so_` in any eager string.
12. **SC-12 (gates):** `orch-0805`, `orch-0783`, `orch-0978-*`, the 4 desktop-web jest gates, the new `orch-0989` gate, and the `orch-0863` C7 (with `ORCH_0989_BACKEND_ALLOWLIST`) all pass on the PR.
13. **SC-Web-1..4:** Per §10 (centred card, no OOM, wizard pane intact, web no-trimmer).

---

## 13. 🎨 OPEN — handed to `mingla-designer` (DESIGN pass follows this SPEC)

The mingla-designer pass owns the pixel/interaction contract for `CoverPickerSheet` + the 3-tab `CoverPicker` body. This SPEC LOCKS the skeleton (tab ids, gallery-first behaviour, mounts, persistence, gates, video); the designer dresses it. OPEN items:

- Grid columns + thumbnail aspect/treatment per tab (brand sheet's 3-col `width:"31%"` is a reference, not a lock).
- Tab-bar visual style, active/selected state, segmented-control vs underline.
- Loading skeletons for trending/curated grids; the empty/error/offline/rate-limited states with Mingla-voice copy (LOCKED: error states MUST exist for `rate_limited`, `not_configured`, `provider_unavailable`, `invalid_response`, and device-permission-denied).
- Motion: sheet present/dismiss, tab-switch transition, thumbnail press feedback, `prefers-reduced-motion` fallback; haptics on selection.
- Preview-thumbnail placement (inline on the calling screen vs inside the sheet) + the "Add cover"/"Change cover" button styling at each mount.
- Display tab labels (the LOCKED tab `id`s are `library`/`gif`/`stock`; the visible labels e.g. "Library"/"GIF"/"Stock" are designer-owned copy).
- Safe-area/edge padding, page-width/containers at 375/390/430pt + the ≥1024px desktop card, Dynamic Type, contrast ratios (body ≥4.5:1, large ≥3:1), light+dark tokens.
- No-AI-slop bans apply (no generic gradients, stock/AI imagery, emoji icons, decorative effects).
- "References examined" line required (Notion cover picker, Instagram sticker/GIF tray, Giphy/Pexels native pickers, Linear/Things sheets).

Designer completion condition: produce `Mingla_Artifacts/specs/SPEC_ORCH-0989_UNIFIED_COVER_PICKER_DESIGN.md` (tokens + premium-craft + all 9 states) before IMPLEMENT.

---

## 14. Implementation order (DB → edge → service → hook → component → mounts → gates)

1. **DB migration** `20260801000000_orch_0989_brand_cover_video_target.sql` (nullable `event_id`, `target_kind`, row CHECK, RLS extension). Operator runs `supabase db push`.
2. **Edge:** new `event-cover-pexels-curated/index.ts`; generalize the 6 `event-cover-video-*` fns + `_shared/eventCoverVideo.ts` (`requireBrandCoverManager`, brand `public_id`, brand apply target, webhook brand-context recovery). Deploy.
3. **Service:** `coverProviderBrowseService.ts` (`trendingGiphyCovers`, `curatedPexelsCovers`); delete `giphyBrandCoverService.ts` + `pexelsBrandCoverService.ts`.
4. **Hook:** brand-video upload mode (`useBrandCoverVideoUpload` or `target` param on the existing hook).
5. **Component:** `CoverPickerSheet.tsx`; extend `CoverPicker.tsx` (3-tab gallery-first body + `coverTarget` + brand persistence + browse wiring); delete `BrandCoverPickerSheet.tsx`.
6. **Mounts:** migrate M1-M6 to `CoverPickerSheet`; enable trip + brand video.
7. **Gates (SAME commit as their code):** amend `orch-0805` (Check 6/8) + `orch-0783` (composite + browse tokens); add `orch-0989-unified-cover-picker.mjs` + workflow job; add `ORCH_0989_BACKEND_ALLOWLIST` to `orch-0863`.
8. **Tests:** §15.

---

## 15. Test cases (happy + adversarial — Step 0.5)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | GIF trending browse | Open GIF tab, no query | ≥6 trending GIFs render; one `gifs/trending` call | Service+Component |
| T-02 | Stock curated browse | Open Stock tab, no query | ≥6 curated photos; `event-cover-pexels-curated` invoked; no `orientation` param sent | Edge+Service |
| T-03 | GIF search still works | Type "sunset", search | search results swap in; `gifs/search` call | Service |
| T-04 | Library image (brand) | Pick device JPEG on brand target | uploads to `brand_covers` bucket; `brands.cover_media_url` patched; 8 MB cap enforced | Hook+Storage |
| T-05 | Library video (trip) | Pick + trim a 40 s clip on trip create | trimmed to ≤29 s, integer `du_`, processed URL → trip's `events.cover_media_url`, type `video` | Component+Edge+DB |
| T-06 | Library video (brand) | Pick + trim clip on brand edit | `target_kind='brand'` job; apply writes `brands.cover_media_url` + `cover_media_type='video'`; renders on `/b/{slug}` | Edge+DB+render |
| T-07 | Brand provider injection | Forge a non-Pexels URL into provider ref | `validateBrandCoverProviderUrl` throws `provider_invalid_url`; nothing persisted | Service |
| T-08 | Giphy rate-limited | Mock 429 on trending | `rate_limited` error state copy; grid not broken; no crash | Service+Component |
| T-09 | Pexels not configured | Unset `PEXELS_API_KEY` on curated fn | `pexels_not_configured` 500 → `not_configured` error state | Edge+Service |
| T-10 | Curated auth gate | Call curated fn without Bearer | 401 `auth_required` | Edge |
| T-11 | No `so_` regression | Inspect brand + event + trip eager strings | none contain `so_`; all contain integer `du_${n}` | Edge (gate §9.5(7)) |
| T-12 | Retirement | grep `BrandCoverPickerSheet`/`giphyBrandCoverService`/`pexelsBrandCoverService` in `mingla-business/src` | zero non-comment hits; files deleted | repo (gate §9.5(5)) |
| T-13 | Web centred card | Open sheet at ≥1024px web | centred card, not full sheet; no OOM | Component+Web |
| T-14 | Web no-trimmer video | Library video on web | raw asset used; no crash on missing `showEditor` | Component+Web |
| T-15 | Wizard pane intact | Open sheet over event create wizard (desktop web) | left-rail + contained pane unchanged; 4 jest gates green | Component+Web |
| T-16 | Brand-video RLS | Non-admin user opens brand-video upload-intent | `forbidden` 403 (rank < brand_admin); no job row | Edge+RLS |
| T-17 | Event job RLS unchanged | Existing event-video upload by event_manager | still works; event predicate not weakened | Edge+RLS |
| T-18 | Provider-enum unchanged | Library selection | `cover_media_provider='upload'`; CHECK passes | DB |
| T-19 | Backend allowlist | PR with new curated fn | `orch-0863` C7 passes (allowlist includes it) | CI |
| T-20 | Avatar untouched | Open brand avatar picker | still device-only Upload sheet; unchanged | Component |

---

## 16. Regression prevention

- **New gate `orch-0989-unified-cover-picker.mjs`** locks single-sheet + gallery-first + retirement + brand-apply + no-`so_` (the four NEW invariants).
- **`orch-0805` Check 6/8 repointed** (not deleted) so brand provider browse + the unified surface stay gated forever.
- **`orch-0783` composite extended** to `CoverPickerSheet` so moving the picker UI never silently drops the provider-search tokens.
- **Protective comments:** brand-video apply fn carries `// ORCH-0989: brand target writes brands.cover_media_url (not events)`; the migration carries the `target_kind` CHECK rationale; `coverProviderBrowseService.ts` carries the Giphy-client-direct / Pexels-edge-proxied ToS note with docs URLs.
- **COMMS-0010 webhook drift:** the brand `public_id` template change MUST deploy the upload-intent + webhook pair TOGETHER (the exact lesson of COMMS-0010); the new gate asserts both contain the brand template.

---

## 17. Discoveries for orchestrator

1. **Brand video is a real backend project, not a client flag** — `event_cover_video_jobs.event_id` is `NOT NULL FK to events`; `requireEventManager` selects from `events`. Decision #4 (brand video) requires the §8 Option-A generalization (nullable event_id + `target_kind` + RLS + brand apply target + 6 edge-fn edits + webhook brand-context recovery + a new migration). This is the dominant cost of the ORCH — size the IMPLEMENT dispatch accordingly.
2. **The "brand-cover bucket must accept video" framing is partly a misnomer** — processed video lives on Cloudinary, not the `brand_covers` Supabase bucket. The real work is the Cloudinary pipeline generalization (§8) + persisting the Cloudinary URL to `brands.cover_media_url`. No `video/*` MIME is added to the bucket (§5.2). Flag for operator so the storage expectation is correct.
3. **Pexels curated has no `orientation` param** — curated browse photos are not landscape-filtered (unlike search). Acceptable for a browse grid; renderer crops. Documented §6.2.
4. **Giphy must stay client-direct** (ToS forbids proxying); Pexels must stay edge-proxied (key secret). The asymmetry is permanent and gated (§9.2/§9.5).
5. **Designer pass is a hard prerequisite** to IMPLEMENT — §13 OPEN items (grids, states, motion, copy, tokens) must be locked by `mingla-designer` first.
