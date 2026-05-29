# INVESTIGATION — ORCH-0989 [Unified cover picker sheet]

**Mode:** INVESTIGATE (truth baseline + blast radius; no solutions, no SPEC, no code)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0989-[unified-cover-picker-sheet]/` on branch `ORCH-0989-unified-cover-picker-sheet`
**Date:** 2026-05-29
**Confidence:** HIGH (source read in full across all picker surfaces + services + edge fn + gates; external API endpoints verified against provider docs with URLs cited. No sim live-fire required — this is a code/architecture audit per dispatch scope; no specific runtime reproducer was given.)

---

## Comms Ledger (read on entry)

- **COMMS-0003 (WARN, OPEN, ALL)** — every external-API endpoint/param/payload referenced MUST carry the provider's canonical docs URL inline. **Honored throughout §4 + §3.** (Ack is orchestrator-owned; I factored it.)
- **COMMS-0007 (RESOLVED, ORCH-0964)** — `EventCoverMedia` + `EventCover` now live in shared `@mingla/event-rendering`; mingla-business files are thin re-export shims. Confirms render side is shared (see Finding F-6).
- **COMMS-0010 (RESOLVED, ORCH-0978)** — Architecture B for video covers: integer `du_${ceil}`, NO `so_` start-offset; the trimmed local file IS the upload. Edge pair must stay reconciled. Confirms the video-trim hand-off contract (Finding F-5).
- No `BLOCK`/`OPEN` row targets `ORCH-0989` or `mingla-forensics`. Nothing gates this investigation.

---

## 1. The user's actual goal (outcome step-back)

A brand operator wants to **put a great-looking cover on the thing they're publishing — fast, without typing**. Today they're forced to either (a) hunt for a file on their device, or (b) think of a search term and type it before they see a single option. The job-to-be-done is "show me good covers immediately, let me pick one in two taps." The unified tabbed gallery-first sheet (Library / GIF / Stock, browsable grids, search optional) is the journey that delivers that outcome across all three authoring surfaces (events, trips, brand).

**Journey divergence today:** the very first screen of every provider tab is a blank result area with a search box. Zero options are visible until the user types ≥2 characters and taps Search. That is the core product gap this ORCH closes. (Not a "bug" — a missing best-practice; cf. Giphy/Pexels native pickers, Notion cover picker, Instagram sticker tray, all of which open to a populated grid.)

---

## 2. Picker surface enumeration (Goal 1)

There are **two completely separate picker implementations** in `mingla-business/`, plus a third single-purpose avatar sheet. They do NOT share a component.

| # | Surface | Mount file:line | Picker component | Rendered in a Sheet? | Accept-list today |
|---|---------|-----------------|------------------|----------------------|-------------------|
| S1 | **Event create wizard — Step 4 Cover** | `CreatorStep4Cover.tsx:57` (mounted by `EventCreatorWizard.tsx:635`, `coverMediaApplyMode:"draft_auto"` at :620) | `CoverPicker` (`ui/CoverPicker.tsx`) | **No — inline in wizard pane** | image, GIF (upload), **video** (upload+trim), GIPHY GIF (search), Pexels image (search) |
| S2 | **Event EditPublishedScreen — Cover step** | `CreatorStep4Cover.tsx` via `EditPublishedScreen.tsx:1007` (`coverMediaApplyMode:"published_manual"` at :993) | `CoverPicker` | **No — inline** | same as S1 (video enabled) |
| S3 | **Trip create wizard — Step 1 Basics** | `TripCreatorStep1Basics.tsx:394` | `CoverPicker` | **No — inline** | image, GIF (upload), GIPHY GIF, Pexels image. **`enableVideoUpload={false}` (:407) → NO video** |
| S4 | **Trip EditPublishedTripScreen — Cover section** | `EditPublishedTripScreen.tsx:1083` | `CoverPicker` | **No — inline (accordion body)** | same as S3, **`enableVideoUpload={false}` (:1096) → NO video** |
| S5 | **BrandEditView — brand cover** | `BrandEditView.tsx:823` (CTA `handleOpenCoverPicker` at :594) | **`BrandCoverPickerSheet`** (separate) | **Yes — `Sheet snapPoint="full"`** | image, GIF (upload, 8MB cap), Pexels image (search), GIPHY GIF (search). **NO video** |
| S6 | **BrandCreationFlow — brand cover (onboarding)** | `BrandCreationFlow.tsx:390` | **`BrandCoverPickerSheet`** (separate) | **Yes — Sheet** | same as S5 |
| S7 | **BrandEditView — brand avatar** | `BrandEditView.tsx:839` | **`BrandAvatarPickerSheet`** (separate) | **Yes — `Sheet snapPoint="half"`** | image only (device upload, native 1:1 crop, 5MB). **No GIF, no video, no provider search** |

**Headline:** 7 mount points, **3 distinct picker components**, **2 distinct architectures** (inline vs. Sheet). Video is supported on exactly 2 of 7 surfaces (S1, S2). The dispatch's premise that "all three authoring surfaces go through the shared `CoverPicker`" is **only true for events + trips**; brand cover + brand avatar are their own Sheet components.

---

## 3. Findings (classified, six-field where root-cause-grade)

### 🔵 F-1 — `CoverPicker` (events + trips) is type-to-search only; no grid/trending path exists
- **File+line:** `ui/CoverPicker.tsx:570-597` (`runProviderSearch`), `:573` (`if (trimmed.length < 2) { setSearchError("Search with at least two characters."); return; }`), `:855-883` (horizontal-scroll result strip, empty until search).
- **What it does:** GIPHY/Pexels are inner radio-tabs (`:802-819`); results only populate after the user types ≥2 chars and presses Search. The result container is a **horizontal** ScrollView strip of 128pt tiles, not a grid. No trending/curated call exists anywhere in this component.
- **What it should do (per ORCH goal):** open each tab to a populated browsable grid (trending/curated) with search optional.
- **Why it matters:** this is the central UX the ORCH replaces. Confirms "gallery-first" is net-new wiring, not a toggle.
- **Layer:** Component + Service.
- **Confidence:** proven (read in full).

### 🔵 F-2 — `BrandCoverPickerSheet` is a fully separate tabbed sheet with its own services + 3-col grid
- **File+line:** `brand/BrandCoverPickerSheet.tsx:55-61` (its own `TabId = "upload"|"pexels"|"giphy"` + `TABS`), `:254-346` (`PexelsTab`), `:350-443` (`GiphyTab`), `:546-550` (`grid` style: `flexWrap:"wrap"`, `thumbPressable width:"31%"` → **3-column wrapping grid**).
- **What it does:** brand cover uses a `Sheet`-hosted tabbed picker (Upload/Pexels/GIPHY) that calls `giphyBrandCoverService` + `pexelsBrandCoverService` (brand-specific duplicates of the event services). Still type-to-search (`:299`,`:395` Search disabled until `query.trim().length >= 2`), but the result layout is already a wrapping grid (unlike CoverPicker's horizontal strip). **No video, no Library/device-video.**
- **Why it matters:** "one build upgrades all three" is **false today**. Brand cover does NOT consume `CoverPicker`. Unifying requires either (a) extending `CoverPicker` to be Sheet-hostable + grid-first and retiring `BrandCoverPickerSheet` + brand services, or (b) a new shared sheet both consume. This is the single biggest architecture decision for the SPEC.
- **Layer:** Component + Service.
- **Confidence:** proven.

### 🔵 F-3 — `BrandAvatarPickerSheet` is device-upload-only by deliberate ORCH-0807 design
- **File+line:** `brand/BrandAvatarPickerSheet.tsx:3-5` ("no Pexels/GIPHY tabs — avatars are device-only per ORCH-0807 SPEC §2 non-goals"), `:107-117` (`allowsEditing:true, aspect:[1,1]` native square crop).
- **What it does:** single CTA → device image picker with 1:1 crop, 5MB, image-only. No tabs, no provider search, no video.
- **Why it matters:** the dispatch lists "BrandEditView avatar" in scope. Adding a Library tab to the avatar picker is plausible, but GIF/Stock/video for an avatar is a **product decision** (square crop + 5MB cap + ORCH-0807 non-goal). Flag for operator: does ORCH-0989 unify avatar into the same sheet, or keep avatar device-only and only unify the 3 *cover* surfaces? The current avatar contract (square crop) does not map cleanly onto a GIF/video grid.
- **Layer:** Component.
- **Confidence:** proven.

### 🔵 F-4 — GIF and Stock use ASYMMETRIC transport: GIPHY client-direct, Pexels edge-proxied
- **File+line (GIPHY):** `services/giphyEventCoverService.ts:98` + `services/giphyBrandCoverService.ts:110` — both `fetch("https://api.giphy.com/v1/gifs/search?" + params)` with `api_key` from `EXPO_PUBLIC_GIPHY_API_KEY` (a **public, client-exposed** key). GIPHY docs **require** client-side calls (see §4).
- **File+line (Pexels):** `services/pexelsEventCoverService.ts:49` + `services/pexelsBrandCoverService.ts:74` — both `supabase.functions.invoke("event-cover-pexels-search")`. The key lives **server-side** in the edge fn (`supabase/functions/event-cover-pexels-search/index.ts:104` `Deno.env.get("PEXELS_API_KEY")`), which requires an authed user (`:78-95 requireUser`) and hard-codes `orientation:"landscape"` (`:122`).
- **What it does:** two providers, two transports, by design (GIPHY's ToS forbids proxying; Pexels' key must not be exposed).
- **Why it matters:** the unified sheet's GIF tab keeps Giphy **client-side**; the Stock tab keeps Pexels **edge-proxied**. A trending/curated grid for Giphy is a new client endpoint; for Pexels it requires a NEW edge route (or a new param on the existing fn) because `event-cover-pexels-search` is search-only (no `/curated` path).
- **Layer:** Service + Edge.
- **Confidence:** proven.

### 🔵 F-5 — Video-trim hand-off is Architecture B (ORCH-0978), wired only inside `CoverPicker`
- **File+line:** `ui/CoverPicker.tsx:421-471` (`trimVideoWithDedicatedEditor` → `showEditor(uri,{maxDuration:EVENT_COVER_MAX_VIDEO_DURATION_MS,...})` from `react-native-video-trim`), `:473-554` (`pickVideoCover`: device video pick → native trim → `buildTrimmedVideoUploadFile` → `videoUpload.start`). Hand-off contract in `ui/coverPickerVideoTrimUpload.ts:20-52`: `trimStartMs:0`, `trimEndMs = trimmedDurationMs`, `uri = trimResult.outputPath` (the trimmed file IS the upload). Source ceiling guard at `:519` (`EVENT_COVER_SOURCE_CEILING_MS`, 33s) with "Please trim to 29 seconds first." Cap `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000` per `orch-0978-video-cap-29s.mjs` C1-C3.
- **What it does:** a picked device video flows local-trim → trimmed file uploaded → Cloudinary integer `du_${ceil}`, no `so_` (Architecture B, COMMS-0010). Web has no trimmer (`isNative` branch at `:492-496` → uses raw asset).
- **Why it matters:** the unified sheet's **Library tab** (device photos + videos) must route a picked video through this exact path. Today this logic lives in `CoverPicker` and is gated by `supportsVideoUpload = supportsUpload && enableVideoUpload`. Brand cover + trips have video OFF; the SPEC must decide whether the unified Library tab enables video for trips/brand (product + Cloudinary-cost decision).
- **Layer:** Component + Hook (`useEventCoverVideoUpload`) + Edge (Cloudinary pipeline).
- **Confidence:** proven.

### 🔵 F-6 — Render side is the shared `@mingla/event-rendering` `EventCoverMedia` (authoring-only blast radius confirmed)
- **File+line:** `packages/event-rendering/EventCoverMedia.tsx` (canonical). `mingla-business/src/components/ui/EventCoverMedia.tsx:1-9` is a thin re-export shim (`export { EventCoverMedia } from "@mingla/event-rendering"`). Same for `EventCover.tsx`. Brand page renders covers via this component (`packages/brand-rendering/PublicBrandPage.tsx`, enforced by `orch-0805` Check 9 + `orch-0964`).
- **What it does:** image/GIF/video render (web `<video>`/`<img>`, native expo-image/expo-video, muted autoplay) is centralized and SHARED with buyer-web + app-mobile.
- **Why it matters:** **the picker is authoring-only.** Restructuring the picker does NOT touch how covers render for buyers/consumers. Confirms Goal 6. The picker writes the same 7-field `cover_media_*` patch regardless of UI; render reads it unchanged.
- **Layer:** Component (shared package) — read-only confirmation.
- **Confidence:** proven.

### 🟡 F-7 — `CoverPicker.CoverPatch` provider union is locked to `"upload"|"giphy"|"pexels"`
- **File+line:** `types/eventCoverProvider.ts:1` (`EventCoverMediaProvider = "upload"|"giphy"|"pexels"`), DB CHECK `events_cover_media_provider_check` (migration `20260515000018_orch_0783...`, enforced by `orch-0783` gate line 94-95).
- **Why it matters:** a "Library" tab is just the existing `"upload"` provider re-labeled; GIF=`"giphy"`, Stock=`"pexels"`. No new provider enum is needed → no DB migration for the provider column. (Hidden flaw only if SPEC invents a new provider value — it must not, or the DB CHECK + gate will reject it.)
- **Layer:** Types + Schema.
- **Confidence:** proven.

### 🟡 F-8 — Two brand-side service duplicates exist purely because brand never adopted `CoverPicker`
- **File+line:** `services/giphyBrandCoverService.ts` + `services/pexelsBrandCoverService.ts` are near-byte-duplicates of the event versions (different error class `BrandCoverError` vs `EventCoverProviderError`, different result interface names). `pexelsBrandCoverService.ts:2-8` openly documents it reuses the SAME edge fn.
- **Why it matters:** unifying on `CoverPicker` would let the SPEC delete these two duplicates + the brand provider tabs. They are dead-weight maintenance and a DRY violation. Note for the SPEC's "subtract before adding."
- **Layer:** Service.
- **Confidence:** proven.

---

## 4. Giphy + Pexels grid/trending feasibility (Goal 4 — external, docs-cited)

**Verdict: YES — both providers expose grid/trending endpoints that return a browsable grid with NO search query. Gallery-first is fully achievable.**

### GIPHY Trending — `GET https://api.giphy.com/v1/gifs/trending`
- Docs: https://developers.giphy.com/docs/api/endpoint/ (endpoint), https://developers.giphy.com/docs/api/ (rate/attribution).
- **Required:** `api_key`. **Optional:** `limit` (default 25), `offset` (max 499), `rating` (g/pg/pg-13/r), `bundle`, `country_code`, `region`, `random_id`, `remove_low_contrast`.
- **No query required** — returns "the most relevant and engaging content each and every day."
- **Response:** `{ data: GifObject[], pagination, meta }` — same `images.fixed_width.url` / `downsized_medium` shape the current `normalizeResult` already parses (`giphyEventCoverService.ts:45-69`), so the existing normalizer works unchanged against trending.
- **Rate limit:** beta/free key = **100 calls/hour**; production status (dashboard application) required to exceed. No documented daily cap.
- **Attribution:** MUST "conspicuously display 'Powered By GIPHY'" where the API is used (already present: `BrandCoverPickerSheet.tsx:440` "Powered by GIPHY"). **Client-side mandatory:** GIPHY docs state "GIPHY requires the Trending API call be made from the client side" and "all requests to GIPHY should be made directly from the client side... must not proxy." → keep Giphy client-direct in the unified sheet.

### Pexels Curated Photos — `GET https://api.pexels.com/v1/curated`
- Docs: https://www.pexels.com/api/documentation/ (Curated Photos + Search + rate/attribution sections).
- **Required:** none. **Optional:** `page` (default 1), `per_page` (default 15, max 80).
- **No query required** — returns a paginated curated `photos[]` collection (`page`, `per_page`, `total_results`, `prev_page`/`next_page`). Same photo object shape (`src.landscape`, `photographer`, `photographer_url`, `avg_color`, `alt`) the existing edge fn already maps (`event-cover-pexels-search/index.ts:154-...`).
- **Rate limit:** **200 requests/hour, 20,000/month** (default).
- **Attribution:** MUST "show a prominent link to Pexels" + credit photographers (already present: `BrandCoverPickerSheet.tsx:343` "Photos provided by Pexels" + per-photo credit). **Key must stay server-side** → Pexels curated needs a NEW edge route/param (the current `event-cover-pexels-search` fn only hits `/v1/search` with a mandatory `query` and hard-coded `orientation:"landscape"`; `normalizeSearchRequest` at `:50-62` REJECTS query length < 2). Curated has no orientation param — landscape filtering is not available on `/curated`.

**Implication for SPEC (not a solution, just the constraint):** the GIF tab can call trending client-side with the existing normalizer; the Stock tab needs a server route for `/v1/curated` (the existing edge fn cannot be reused as-is for a no-query browse). Popular Videos (`GET https://api.pexels.com/v1/videos/popular`) also exists if a future Stock-video tab is ever scoped — out of current scope.

---

## 5. Video-trim hand-off map (Goal 5)

See F-5. Path: device video pick (`ImagePicker.launchImageLibraryAsync({mediaTypes:["videos"]})`) → native-only `showEditor()` (react-native-video-trim) → `onFinishTrimming` payload `{outputPath,duration,startTime,endTime}` → `buildTrimmedVideoUploadFile` (`coverPickerVideoTrimUpload.ts`) produces an `EventCoverVideoUploadFile` with `trimStartMs:0`, `uri:outputPath` → `useEventCoverVideoUpload.start()` → Cloudinary Architecture B (integer `du_`, no `so_`, COMMS-0010). A tabbed Library tab feeds this by routing a video selection into `pickVideoCover`'s existing body; an image/GIF selection routes into `pickImageOrGifCover`. Both already live in `CoverPicker`. The wiring exists; the SPEC's job is to (a) surface device media as a grid inside the Library tab and (b) decide per-surface whether video is enabled.

---

## 6. Render side — read-only confirmation (Goal 6)

Confirmed authoring-only. Covers render via shared `@mingla/event-rendering/EventCoverMedia` (Finding F-6). mingla-business uses re-export shims; buyer-web + consumer-app + public brand page all consume the shared package. **The picker change does not touch render.** Cite: `packages/event-rendering/EventCoverMedia.tsx`, `packages/brand-rendering/PublicBrandPage.tsx`, shim `mingla-business/src/components/ui/EventCoverMedia.tsx`.

---

## 7. Five-layer cross-check

| Layer | Truth |
|-------|-------|
| **Docs** | Memory `project_cover_picker_unified_sheet_gated.md`: build the tabbed gallery sheet only AFTER ORCH-0978 video-cover proven E2E (it is — ORCH-0978 CLOSED per COMMS-0010 resolution). Shared CoverPicker should upgrade events/trips/brand at once. |
| **Schema** | `events.cover_media_*` (7 fields) + `brands.cover_media_url/type/hue` + provider CHECK `events_cover_media_provider_check` (`upload`/`giphy`/`pexels`). Brand cover bucket `brand_covers` (8MB, image+GIF, NO video). Event cover bucket `event_covers` (video-capable, ORCH-0978 30s constraints). **No schema change needed for a re-labeled Library tab** (F-7). A Pexels-curated edge route adds no DB. |
| **Code** | Two picker components, two architectures, asymmetric Giphy/Pexels transport, video on 2/7 surfaces (F-1..F-5, F-8). |
| **Runtime** | Not live-fired (code/architecture audit; no runtime reproducer dispatched). Behavior inferred from full source read + the existing ORCH-0978/0805/0783 QA evidence already on file. |
| **Data** | Not probed (no data-shape question in scope). |

---

## 8. Desktop-web parity (Goal 8)

- **Sheet primitive is already desktop-web-aware.** `ui/Sheet.web.tsx`: narrow web (<1024px) → real bottom sheet via `SheetMobile`; wide desktop (≥1024px) → **centred floating card**, width `min(640, vw-64)`, max-height `min(80vh, vh-64)`, backdrop `rgba(0,0,0,0.55)`, gated exclusively via `useResponsiveLayout()` (I-DESKTOP-GATE-VIA-HOOK). The brand pickers (S5/S6/S7) already inherit this because they use `Sheet`.
- **CRITICAL OOM hazard (ORCH-0964 precedent, COMMS context):** `Sheet.web.tsx` MUST import the mobile sheet from `./SheetMobile`, never `./Sheet` — on web Metro resolves `./Sheet` to `Sheet.web.tsx` and a self-import recurses → mobile-web renderer OOM (the exact bug fixed in commits `830c52be2`/`41ec95698`). Any new shared sheet must obey this and the I-SUB-SHEET-INSIDE-PARENT rule (sub-sheets stay JSX-children).
- **Today's event/trip CoverPicker is INLINE (not a Sheet)** on every surface (S1-S4). Moving it into a tabbed Sheet is a structural change that newly subjects events+trips to the desktop-web centred-card behavior and the OOM rule — surfaces that previously had no Sheet involvement.
- **16 desktop-web contracts** (`feedback_mingla_business_desktop_web_contracts.md`): the wizards (S1, S3) use a desktop-only left-step-rail + contained form pane (contracts 12-14). A cover Sheet opening over the wizard pane must not regress those. The 4 jest gates (`test:orch-0885-a`, `BottomNavWebDesktopPolish`, `wizardDesktopLayout`, `homeKpiPresentation`, `useResponsiveLayout`) must stay green if any nearby wizard file is touched.

---

## 9. Blast radius + risk (Goal 7)

**Tests at risk (mingla-business/src):**
- `ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts` — locks the video-trim wiring (F-5).
- `ui/__tests__/CoverPicker.videoSourceCeiling.test.ts` — locks the 33s source ceiling / 29s cap.
- `services/__tests__/giphyEventCoverService.test.ts`, `pexelsEventCoverService.test.ts` — lock current search behavior; trending/curated adds assertions.
- `ui/__tests__/eventCoverMedia.test.ts`, `services/__tests__/eventCoverMediaService*.test.ts` — render/upload (likely unaffected but in blast radius).
- `event/__tests__/EditPublishedScreen.coverPersistence.test.tsx`, `trip/__tests__/TripCreatorWizard.cover.test.ts` — 7-field patch persistence per surface.
- `utils/__tests__/brandCoverRules.test.ts` — brand provider URL allowlist (Pexels/Giphy host validation, F-statement in `brandCoverRules.ts:247-310`).

**Strict-grep gates at risk (`.github/scripts/strict-grep/`):**
- **`orch-0783-event-cover-image-provider-pivot.mjs`** — HARD constraints that will fight a restructure: requires `CreatorStep4Cover`/CoverPicker expose `searchGiphyEventCovers` + `searchPexelsEventCovers` (line 70); GIPHY adapter MUST use `https://api.giphy.com/v1/gifs/search` (line 76); Pexels client MUST call `event-cover-pexels-search` (line 82); Pexels edge MUST request landscape (line 89); forbids `CreatorStep4Cover` re-exposing video/hue creation tokens "Check again"/"Replace video" (lines 57-66). **Adding trending/curated must AMEND this gate, not break it.**
- **`orch-0805-brand-cover-overhaul.mjs`** — Check 8 requires `BrandCoverPickerSheet.tsx` to EXIST with all 3 tab labels (Upload/Pexels/GIPHY). **If the SPEC retires `BrandCoverPickerSheet` in favor of the unified sheet, this gate must be repointed/retired in the SAME commit or CI fails.** Check 6 requires the two brand provider services exist (F-8 deletion conflicts).
- `orch-0978-video-cap-29s.mjs` (C1-C3 pin 29_000 cap + dedicated trimmer), `orch-0978-video-autoplay-muted-contract.mjs`, `orch-0978-video-upload-optimistic-preview.mjs`, `orch-0978-video-cancel-aborts-upload.mjs` — all lock the video path; preserve byte-for-byte.
- `orch-0892-no-bespoke-keyboard-plumbing.mjs` — the search input keyboard avoidance must flow through SmartScrollView/KAS, not bespoke listeners (CoverPicker comment at `:243-248`).
- `orch-0885-a-no-bottomnav-on-wide-desktop.mjs` + the 4 desktop-web jest gates (§8).
- **COMMS-0002** — any new edge fn (Pexels-curated route) or migration must be added to `ORCH_0989_BACKEND_ALLOWLIST` in `orch-0863-marketing-hub-phase-b.mjs` in the SAME commit, else the no-new-backend-files check blocks the PR.

**Invariants in play:** I-DESKTOP-GATE-VIA-HOOK, I-SUB-SHEET-INSIDE-PARENT, I-RN-COLOR-FORMATS, I-KEYBOARD-NEVER-BLOCKS-INPUT, ORCH-0978 Architecture-B (integer `du_`, no `so_`), I-CATEGORY-SLUG n/a, events provider CHECK.

**Biggest risk:** the "single component upgrades all three" assumption is FALSE today (F-2/F-3). The real cost is the **architecture-unification decision** — converge brand cover (and possibly avatar) onto the same shared sheet as events/trips, retire `BrandCoverPickerSheet` + 2 brand services, and amend the `orch-0805` + `orch-0783` gates atomically — all while preserving the ORCH-0978 video path (events only), the 8MB-image-only brand-cover constraint, the desktop-web centred-card + OOM rule, and the 16 desktop contracts.

---

## 10. Discoveries for orchestrator

1. **Avatar scope ambiguity (F-3):** does ORCH-0989 fold brand AVATAR into the unified sheet, or only the 3 *cover* surfaces? Avatar is device-only/1:1-crop/5MB by ORCH-0807 design; GIF/video don't map cleanly. **Needs operator product decision before SPEC.**
2. **Video on trips/brand (F-5):** trips + brand cover have video OFF today. Does "Library = photos + videos" enable video there (Cloudinary cost + 30s pipeline) or stay image/GIF? **Operator decision.**
3. **Brand-cover bucket is image/GIF-only, 8MB** (`brandCoverRules.ts:27`), vs event covers video-capable. If brand video is in scope, a storage-policy + bucket-limit change is required (out of the "no schema change" happy path).
4. **DRY cleanup opportunity (F-8):** unifying lets the SPEC delete `giphyBrandCoverService` + `pexelsBrandCoverService` + the brand provider tabs — but that trips `orch-0805` Check 6/8; gate amendment must be same-commit.
5. **Pexels curated needs a new server route** (F-4/§4): existing edge fn is search-only, no `/curated`, no no-query path, mandatory landscape. New route (or param) → backend allowlist (COMMS-0002).

---

## 11. Fix strategy (direction only — NOT a spec)

Converge all cover surfaces on one shared, Sheet-hostable, grid-first picker; GIF tab = client-direct GIPHY trending (existing normalizer); Stock tab = Pexels via a new server `/curated` route (key stays server-side); Library tab = device photos+videos routing through the existing ORCH-0978 Architecture-B trim path (video per-surface gated). Keep the 7-field `cover_media_*` patch + provider enum unchanged (no DB for the provider column). Retire `BrandCoverPickerSheet` + the 2 brand services, amending `orch-0805`/`orch-0783` gates in the same commit. Honor the desktop-web centred-card + `SheetMobile` OOM rule + 16 contracts. Resolve the avatar + trips/brand-video scope questions (§10) before SPEC.

**No solutions beyond direction. SPEC follows.**
