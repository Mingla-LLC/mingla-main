# SPEC-868 — Ordered images-only COVER GALLERY on Event / RSVP / Trip / Experience

**Issue:** #868 `[cover-gallery]` · **Branch/worktree:** `868-cover-gallery` @ `/Users/sethogieva/Desktop/mingla-orchs/868-[cover-gallery]/`
**Design status:** APPROVED by Seth (visual/interaction). This SPEC is the build contract; do NOT redesign.
**Author phase:** forensic SPEC (contract only — no product code, no migrations run, no source edited).

> Design intent (verbatim, binding): Replace the single cover with an ordered IMAGES-ONLY gallery. Gallery = photos only (NO video items). The existing single video-cover capability stays SEPARATE and untouched. Item #1 is the primary cover everywhere a single cover is still expected. VIEWER: on the offering hero, a stylish row of rounded image cards sits in its OWN ROW directly BENEATH the cover (the body's first row), NOT overlaid on the cover; the full cover stays visible; the cover is horizontally SWIPEABLE to flip photos; tapping a card also swaps it; both drive the same shown-photo state; the row's active card shows an accent ring; the row SCROLLS AWAY with the body over the pinned cover (parallax unchanged); Discover swipe-deck stays primary-only. AUTHORING: extend the existing CoverPicker sheet to manage an ordered set of photos (add up to 8, reorder via the WCAG-safe move-menu "Make cover / Move earlier / Move later / Remove", first tile = cover). Same Library/GIF/Photos tabs.

---

## A. Scope & non-scope

> **BINDING MODEL (amended per Seth — OQ-1 + OQ-2 resolved 2026-07-28): COVER AND GALLERY ARE INDEPENDENT.**
> - `cover_media_url` / `cover_media_type` = the **PRIMARY COVER** (hero sequence index 0) — image **OR VIDEO** — an INDEPENDENT, **UNCHANGED** field-pair. This is what ALL thumbnail / share / OG / email surfaces read. There is **NO `gallery[0]`→cover sync**, no "video clears gallery", no "gallery forces image".
> - `cover_media_gallery jsonb '[]'` = **ADDITIONAL image/GIF items** (NO video items), hero indices 1..N. Purely additive; it does **NOT** alter the cover fields on any write path.
> - Hero pinned pager **sequence = [cover] ++ gallery images**. Swipe cycles cover→gallery images; a video cover at index 0 plays exactly as today.
> - Row beneath = full-sequence thumbnails: **card 0 = the COVER** (its poster; a small ▶ badge ONLY when the cover is a video), cards 1..N = gallery images. Active card ringed; scrolls away.

### In scope (v1)
- **Offering types:** `event_type` ∈ {`event`, `rsvp`, `trip`, `experience`} — all four live on `public.events`.
- **Data:** one new additive `public.events.cover_media_gallery jsonb NOT NULL DEFAULT '[]'` column (image/GIF items only), CHECK = array-shape only (item shape app-side, mirroring ORCH-1119 `trip_days.media`). It is a purely additive EXTRA-images field; it never touches the cover columns.
- **Viewer renderer:** a pinned cover pager over the **[cover] ++ gallery** sequence + a new `CoverGalleryRow` (card 0 = cover, cards 1..N = gallery) as the body's first row, in `@mingla/offering-rendering` (shared across buyer-web, business native, consumer native).
- **Authoring:** the primary cover is set **exactly as today (image / GIF / video)** via the existing `CoverPicker` cover flow; SEPARATELY, `CoverPicker` gains an ordered "additional photos" manager (add ≤8 image/GIF, reorder via WCAG move-menu, remove) that writes ONLY `cover_media_gallery` — never the cover fields. Applies to `event`/`trip`/`experience` targets + the RSVP author path.
- **Save/read layer:** cover write paths are UNCHANGED; `cover_media_gallery` is persisted ADDITIVELY (no sync, no derive); the 4 anon hero RPCs + 2 management/public views project the gallery additively.
- **Share/OG/email:** byte-identical — they read the UNCHANGED `cover_media_url`/`_type` — PLUS the RSVP `og:image` gap fix.

### Non-scope (explicit, with one-phrase reason)
- **Brand covers** (`brands.cover_media_url`, `packages/brand-rendering/PublicBrandPage.tsx`): **FAST-FOLLOW**, not v1 — brand cover is a different owner/table/picker-target; touching it risks the ORCH-0805 gate.
- **Venue covers** (`venue_listings`, `PublicVenuePage.tsx`, `CoverTarget.kind='venue'`): **EXCLUDED** — venue hero is a separate owner (META-ORCH-1255) and out of the four in-scope offering types.
- **Video ITEMS in the gallery:** EXCLUDED — the gallery holds image/GIF items ONLY. (A VIDEO **cover** is fully supported — it lives in the cover fields at sequence index 0, unchanged, and COEXISTS with a photo gallery.)
- **The Discover swipe-deck** (`discover-cards`, `CountAwareGallery` slider): UNCHANGED — deck stays primary-cover-only (gesture clash with card swipe).
- **`CountAwareGallery` / trip-day / stop media galleries** (`packages/offering-rendering/CountAwareGallery.tsx`, `trip_days.media`): UNCHANGED — a separate multi-media feature; the cover gallery does not reuse or alter it.
- **Post-purchase address unlock, cart, checkout:** UNCHANGED.

### Assumptions
1. An **empty** gallery (`[]`) is byte-identical to today's single-cover behavior (no row, no pager) — the single cover (image or video) renders exactly as today.
2. The hero sequence = **[cover] ++ gallery images**; the pager + row engage when there is **more than one sequence item**, i.e. `cover_media_gallery.length ≥ 1`.
3. Cover and gallery are **independent** — no write path syncs, derives, or clears one from the other. A video cover and a photo gallery COEXIST.

---

## B. Data model (Layer 1 — migration)

### B.1 Migration file + chosen version (collision-checked)
- **File:** `supabase/migrations/20270116000868_issue_868_cover_gallery.sql`
- **Version choice:** `20270116000868`. Collision scan performed against the anchor and EVERY sibling worktree under `/Users/sethogieva/Desktop/mingla-orchs/*/supabase/migrations` on 2026-07-28; the strictly-greatest existing migration everywhere is `20270115000865_issue_865_rollup_rls_reservation_attribution.sql`. `20270116000868` is strictly greater than every observed max (migration-monotonicity invariant, cross-host rule). Encodes the issue number (`…000868`).
- **Pattern mirrored VERBATIM from** `supabase/migrations/20260928000000_orch_1119_trip_day_media.sql:19-34` (idempotent `ADD COLUMN IF NOT EXISTS … DEFAULT '[]'::jsonb` + `DROP/ADD CONSTRAINT … CHECK (jsonb_typeof(...) = 'array')` + `COMMENT`).

### B.2 Exact DDL
```sql
BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS cover_media_gallery jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Shape guard ONLY (item {url,type?,alt?,credit?,w?,h?} validation is app-side,
-- exactly like trip_days.media / coerceTripDayMedia). This CHECK only blocks a
-- non-array scalar. NO exclusion/sync CHECK — the gallery is independent of the
-- cover columns.
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_cover_media_gallery_is_array;
ALTER TABLE public.events
  ADD CONSTRAINT events_cover_media_gallery_is_array
  CHECK (jsonb_typeof(cover_media_gallery) = 'array');

COMMENT ON COLUMN public.events.cover_media_gallery IS
  'issue #868: ADDITIONAL cover-gallery items (image/GIF ONLY, never video), ordered, hero indices 1..N. jsonb array of {url:text, type?:"image"|"gif", alt?:text, credit?:text, w?:int, h?:int}. Default [] = single-cover behavior (Constitution #9). INDEPENDENT of cover_media_url/_type — no write path syncs or derives between the two. The primary cover (image OR video) stays in cover_media_url/_type as today.';

COMMIT;
NOTIFY pgrst, 'reload schema';
```

### B.3 Item JSON shape (app-enforced)
`{ url: string (required, absolute http(s)); type?: 'image' | 'gif' (default 'image'; **never 'video'**); alt?: string|null; credit?: string|null; w?: int|null; h?: int|null }`. GIFs are allowed (OQ-1 resolved); a `gif` item renders animated via the existing `EventCoverMedia` `gif` branch. Max length **8** (author-side clamp; no DB CHECK on length, mirroring ORCH-1119's app-side item validation). There is **no exclusion/sync CHECK** — the gallery never interacts with the cover columns.

### B.4 RLS inheritance
**No RLS change.** The column inherits `public.events` row policies exactly as ORCH-1119's `trip_days.media` inherited `trip_days` policies (migration header note `20260928000000_...:10-11`). Anon read is via the SECURITY DEFINER hero RPCs / views (Section C), which already gate visibility.

### B.5 Rollback
`ALTER TABLE public.events DROP COLUMN IF EXISTS cover_media_gallery;` (safe: additive, default `'[]'`, no backfill, no dependent object outside the amendments in Section C which are themselves additive `CREATE OR REPLACE`). Rolling back the column requires first reverting the Section C view/RPC amendments that reference it.

### B.6 No backfill
Default `'[]'` covers every existing row. All existing readers see `cover_media_url` unchanged; the new column is invisible to any reader that does not select it.

---

## C. Read layer (additive projections + back-compat)

**Back-compat guarantee (all surfaces):** every existing reader that projects `cover_media_url` / `cover_media_type` is **byte-identical** because those columns are **never touched by this feature** (Section G — the gallery is a separate additive column). The gallery is a NEW additional projection consumed ONLY by the hero mounts. Thumbnail-only readers (~30 surfaces) are UNTOUCHED — they keep reading the unchanged `cover_media_url`.

### C.1 Anon hero RPCs — add ONE json key each (`CREATE OR REPLACE` / `DROP+CREATE`, additive; RETURNS json ⇒ no RETURNS-TABLE widening hazard)
For each RPC: add `e.cover_media_gallery` to the source CTE, then add `'coverGallery', COALESCE(<ev>.cover_media_gallery, '[]'::jsonb)` to the returned `json_build_object`. Reproduce the LATEST body VERBATIM; the ONLY delta is the added column + key.

1. `public.pg_public_event_by_slug(text,text)` — latest def `supabase/migrations/20261015000001_orch_1167_pg_public_event_by_slug.sql`. Add `e.cover_media_gallery` in `ev` CTE (beside `e.cover_media_alt`, line 67) and `'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb)` in the SELECT (beside `'coverMediaUrl'`, line 204).
2. `public.pg_public_rsvp_by_slug(text,text)` — latest def `supabase/migrations/20261016000000_orch_1163_pg_public_rsvp_by_slug.sql` (verify latest via `grep -rn "FUNCTION public.pg_public_rsvp_by_slug" supabase/migrations` before editing; also check `20261114000000_orch_1172_r2_rsvp_edit_hide_address.sql`). Same additive delta.
3. `public.pg_public_trip_by_slug(...)` — latest def `supabase/migrations/20261017000000_meta_orch_1174_pg_public_trip_by_slug.sql`. Same additive delta.
4. `public.pg_public_experience_by_slug(...)` — latest def `supabase/migrations/20261115000000_orch_1183_pg_public_experience_by_slug.sql`. Same additive delta.

> All 4 keep `GRANT EXECUTE … TO anon, authenticated;` and `$function$` terminator BEFORE the GRANT, and end with `NOTIFY pgrst, 'reload schema';` (migration-baseline CI).

### C.2 Views — add one column each (explicit column lists; must be amended)
5. `public.business_public_events_view` — latest CREATE `supabase/migrations/20261015000000_orch_1167_event_city_geo.sql` (explicit list: `e.cover_media_url` etc. at lines 24-42). Add `e.cover_media_gallery` in the same block. (Consumed with `select *` by `mingla-business/server/socialPreview.js:214-238`; adding a column is safe — SSR ignores unknown columns.)
6. `public.business_management_events_view` — latest CREATE `supabase/migrations/20270110000000_issue_1039_mgmt_view_theme_columns.sql:36` (explicit cover cols lines 55-70). Add `e.cover_media_gallery`. This is the authenticated in-app management/hero read.
7. `public.events_with_master_date_view` — original `supabase/migrations/20260525000003_orch_0792_events_with_master_date_view.sql`. **Verify projection style first** (`grep -n "cover_media\|e\.\*\|SELECT" <file>`): if it is `SELECT e.*` the column auto-appears (NO amendment); if explicit, add `e.cover_media_gallery`. Only amend if explicit AND a hero mount reads it.

> **Do NOT amend** thumbnail-only / deck / venue views (`claimed_venues_public_view`, `business_public_brands_view`, deck-supply views) — they read primary only and stay byte-identical.

---

## D. Types (additive, default `[]`)

### D.1 `packages/offering-rendering/types.ts`
Add an exported item type and an optional field on `PublicEventProps` (mirror the ORCH-1157 `partyTypes: []` / ORCH-1167 `musicGenres?: []` additive precedent at `types.ts:118,129`):
```ts
export interface OfferingGalleryImage {
  url: string;
  type?: "image" | "gif";        // never "video"; default "image"
  alt?: string | null;
  credit?: string | null;
  width?: number | null;
  height?: number | null;
}
// PublicEventProps (append near the Cover block, types.ts:90-94):
/** issue #868 — ADDITIONAL image/GIF cover-gallery items (hero indices 1..N),
 *  INDEPENDENT of coverMediaUrl/coverMediaType (the primary cover, image OR
 *  video, at index 0). ADDITIVE + default-safe: [] on every predating
 *  constructor ⇒ single-cover behavior (no row, no pager). ≥1 gallery item
 *  enables the swipeable pinned pager over [cover] ++ gallery + the
 *  beneath-cover CoverGalleryRow. Never mirrors/derives from the cover fields. */
coverGallery?: OfferingGalleryImage[];
```
Export `OfferingGalleryImage` from `packages/offering-rendering/index.ts` (add beside the `CountAwareGalleryItem` export at `index.ts:21-25`).

### D.2 `ParallaxCoverShellProps` (`packages/offering-rendering/ParallaxCoverShell.tsx`)
Add optional `galleryImages?: OfferingGalleryImage[];` (default `undefined` ⇒ byte-identical to today). Documented like `coverAspectRatio` (`ParallaxCoverShell.tsx:127-137`): "Absent ⇒ byte-identical to today."

### D.3 Authoring types
- `mingla-business/src/components/ui/CoverPicker.tsx` `CoverPatch` (line 149): add `coverGallery: OfferingGalleryImage[];` (default `[]`). Keep the existing 7 fields UNCHANGED (the strict-grep/gate + every mount consumes them).
- `mingla-business/src/store/draftEventStore.ts` (cover block lines 316-323, defaults 456-462, key union 517-521): add `coverGallery: OfferingGalleryImage[]` (default `[]`) and its setter key.
- `mingla-business/src/services/tripsService.ts` `TripBasicsPatch` (lines 251-252) + `Trip`/mapper (lines 380-381, 594-595): add optional `coverGallery`.

Every constructor/mapper that predates this field defaults it to `[]` — no non-gallery surface changes.

---

## E. Renderer (viewer)

### E.1 New shared component — `packages/offering-rendering/CoverGalleryRow.tsx`
Pure RN (`react-native` + `themePalette` + the existing `deriveCoverPosterUrl` from `coverMediaPresentation.ts` only; RN-free logic if any goes to a sibling `.ts`, per the package isolation rule). Renders the **body's first row**: a horizontally-scrolling row of rounded cards over the **full sequence [cover] ++ gallery**.

**Props (card 0 = the cover):**
```ts
interface CoverGalleryRowProps {
  cover: { url: string | null; type: "image" | "video" | "gif" | null };  // sequence index 0
  gallery: OfferingGalleryImage[];      // image/GIF, sequence indices 1..N
  activeIndex: number;                  // 0 = cover, i = gallery[i-1] — the shown state
  onSelect: (index: number) => void;    // tap a card → swap the shown item
  palette: ThemePalette;
  variant?: "phone" | "desktop";        // default "phone"
  testID?: string;
}
```
**Behavior/layout:**
- `gallery.length < 1` ⇒ `return null` (Constitution #9 — zero nodes; no empty frame). No additional images = no row; the single cover renders exactly as today.
- **Card 0 = the COVER.** Its thumbnail = the cover image/GIF (`cover.url`) OR, when `cover.type === "video"`, the derived poster via `deriveCoverPosterUrl(cover.url)` (reuse the EXISTING helper — no dependency, no edit to it); if the poster is null, fall back to a hue/`palette.card` tile. A small **▶ play badge overlays card 0 ONLY when `cover.type === "video"`** (never on image/GIF covers or gallery cards).
- Cards 1..N = `gallery` items rendered as image/GIF thumbnails.
- Horizontal `ScrollView` (`horizontal`, `showsHorizontalScrollIndicator={false}`, `contentContainerStyle` with `gap`). This is its OWN horizontal-overflow container ⇒ the page body NEVER scrolls sideways (Section F.4).
- Each card = `Pressable` wrapping an `Image` (`resizeMode="cover"`), `accessibilityRole="imagebutton"`, `accessibilityState={{ selected: index===activeIndex }}`, `accessibilityLabel` = card 0 → `"Cover"` (+`", video"` when video) `+ ", selected"` when active; card i → `"Photo ${i} of ${gallery.length}"` `+ ", selected"`.
- **Active card ring:** `borderWidth: 2, borderColor: palette.accent` when `index===activeIndex`; inactive cards `borderWidth: 1, borderColor: palette.panelBorder`. Ring is NOT color-alone — pair with a small check/dot badge on the active card (WCAG: state via ≥2 signals), mirroring the existing selected-tile treatment in `CoverPicker` (`styles.tileSelected` + `selectedBadge`, `CoverPicker.tsx:1660-1677`).
- Android opaque-tile policy: card `backgroundColor` via `Platform.select({ android: "#1A1A1C", default: palette.card })` (copy `CountAwareGallery.tsx:59-61`).

**Tokens (Section F has the full table):** phone card 64×48, radius 12, gap 8, seam-aligned top padding; desktop card 88×56.

### E.2 Cover pager wiring — `ParallaxCoverShell.tsx`
Add internal state + a sequence-aware cover render. **Guard:** the pager engages ONLY when `galleryImages.length ≥ 1` (i.e. the sequence has >1 item). Otherwise the existing single `coverMedia` (`ParallaxCoverShell.tsx:185-208`) renders UNCHANGED (byte-identical single cover — image OR video).

```ts
const gallery = (galleryImages ?? []).filter(g => typeof g?.url === "string" && g.url.length > 0);
const sequenceActive = gallery.length >= 1;      // sequence = [cover] ++ gallery
const [activeIndex, setActiveIndex] = useState(0); // 0 = cover, i = gallery[i-1] (single owner)
```
- **Pinned pager in gallery mode = a horizontal `pagingEnabled` ScrollView** over the sequence, modeled EXACTLY on the proven consumer precedent `app-mobile/src/components/expandedCard/ImageGallery.tsx:100-146` (`horizontal pagingEnabled`, `onScroll` → `Math.round(offsetX / layoutMeasurement.width)` → `setActiveIndex`, `scrollTo` on tap via a `ScrollView` ref).
  - **Page 0 = the existing `coverMedia`** (`ParallaxCoverShell.tsx:185-208`) UNCHANGED — a VIDEO cover therefore autoplays/loops/mutes exactly as today when it is the shown page.
  - **Pages 1..N** = one `EventCoverMedia` per gallery item (`mediaType = item.type ?? "image"`) sized to the full cover box (`height="100%" width="100%"`).
  - Keep the existing `coverScrim` + `entrance` overlays on top.
  - The pager **must be `pointerEvents="auto"`** in gallery mode (today's cover is `pointerEvents="none"` — that stays for the non-gallery/single path).
- **Row placement (the body's FIRST row):** in gallery mode, render `<CoverGalleryRow cover={{ url: coverMediaUrl, type: coverMediaType }} gallery={gallery} activeIndex={activeIndex} onSelect={i => { setActiveIndex(i); pagerRef.current?.scrollTo({ x: i * coverWidth, animated: true }); }} palette={palette} variant={isDesktop ? "desktop" : "phone"} />` **immediately before `children`** inside the opaque body block — i.e. before `{children}` at the web-phone body (`ParallaxCoverShell.tsx:356`), the native body (`:397`), and the desktop left column (`:257`). Because it lives inside the scrolling body, it **scrolls away with the body over the pinned pager** (parallax unchanged) — exactly the mandate.
- **Both drive one state:** swipe → `onScroll` → `setActiveIndex`; tap card → `onSelect` → `setActiveIndex` + `scrollTo`. The pinned pager shows sequence item `activeIndex` (0 = cover); the row highlights `activeIndex`. Single source of truth = `activeIndex` in the shell.

### E.3 Gesture arbitration (the #1 implementation risk — see Section L)
- **Web (`isWeb` branch, `ParallaxCoverShell.tsx:277`):** the fixed cover becomes a horizontal scroll-snap pager (`overflow-x:auto; scroll-snap-type:x mandatory; scroll-snap-align:start` per page, via the existing `webStyle` escape hatch). Horizontal cover scroll and vertical page scroll are independent axes on web — LOW risk. `onScroll` maps offset→index.
- **Native (`nativeCover`, `:367`):** pinned pager = horizontal `pagingEnabled` ScrollView (`pointerEvents="auto"`). To let horizontal swipes reach the pinned pager (which sits BEHIND the body ScrollView), the body's top spacer (`nativeSpacer`/`webPhoneSpacer`) is rendered with `pointerEvents="none"` **only in gallery mode**. The **row-tap + scrollTo path is the guaranteed control** (works regardless of native gesture routing). The horizontal-swipe-on-cover is the enhancement and MUST be runtime-validated (Section I). **Fallback if native swipe proves unreliable:** left/right chevron affordances on the cover (tap-driven, exactly `ImageGallery.tsx:148-170`), which are already a11y-friendly — add them rather than shipping a non-working swipe.
- **Video cover interplay:** when `activeIndex === 0` and the cover is a video, the page-0 video plays as today; swiping to a gallery image (page ≥1) shows a static image. No change to video autoplay/mute logic.

### E.4 EXPLICIT do-not-change list (renderer)
- `EventCoverMedia.tsx` — **UNCHANGED.** The pager reuses it as-is (`mediaType="image"`). No new props, no video-path edits.
- `ParallaxCoverShell` z-index contract (`COVER_Z=1 < CONTENT_Z=2 < CHROME_Z=70`, `:79-81`), the `-28` seam (`SEAM=28`), the phone cover `4/5` default aspect, desktop contained `21/9` hero (`:429`), native/web/desktop stacking fixes (`:314-336, 463-530`) — **ALL UNCHANGED.** The gallery row and pager are added WITHIN this structure; the guard means non-gallery pages render byte-identically.
- `CountAwareGallery.tsx` + `galleryLayout.ts` — **UNCHANGED** (unrelated trip-day/stop media). Do NOT reuse or fork.
- `coverMediaPresentation.ts` (`resolveEventCoverMediaPresentation`, `shouldFreezeCoverForReduceMotion`, `deriveCoverPosterUrl`) — **UNCHANGED.** `CoverGalleryRow` CALLS the existing `deriveCoverPosterUrl` (`coverMediaPresentation.ts:68`) for the video-cover card-0 poster — no edit to the helper.
- **Duplication rule (HARD):** `coverMediaPresentation.ts` is hand-mirrored in `mingla-business/src/utils/eventCoverMediaRules.ts` (`resolveEventCoverMediaPresentation` at `:382`, `shouldFreezeCoverForReduceMotion` at `:409`). This SPEC does NOT change presentation logic, so BOTH stay untouched. **If the implementor ever changes a resolve* helper, it MUST be changed in BOTH files** (covered by `eventCoverMedia.test.ts`). The cover gallery adds NO new presentation resolver — it renders images through the existing `image` branch.
- Reduce-motion: images are static ⇒ no motion concern for the pager/row. `ThemeEntranceAnimation` reuse UNCHANGED. Do not add autoplay/motion to the row.

---

## F. Authoring (CoverPicker extension) + the 13 mounts

### F.1 `CoverPicker.tsx` extension — cover UNCHANGED + a SEPARATE additional-photos manager
The 3 tabs (`library`/`gif`/`stock`, LOCKED ids — ORCH-0805 Check 8) and the 7-field `CoverPatch` cover emit **stay EXACTLY as today**. The primary cover (image / GIF / **video**) is set through the existing cover flow with ZERO behavior change. A gallery of ADDITIONAL images is managed SEPARATELY and never touches the cover fields.

**Primary cover (UNCHANGED):** `pickImageOrGifCover` (`:517-536`), `pickVideoCover`/`onPickVideo` (`:562-661`, `:1206-1215`), `selectGiphy` (`:828-836`), `selectPexels` (`:880-888`), `handleRemoveCover` (`:904-912`) all keep REPLACING the single cover and emitting the same 7-field patch. Video covers still work identically and now COEXIST with a gallery.

**NEW "Additional photos" section (writes ONLY `coverGallery`):**
- Local state `const [gallery, setGallery] = useState<OfferingGalleryImage[]>(initial.coverGallery ?? [])`.
- A dedicated "Add photo" affordance in the Library/GIF/Photos tabs (reusing the SAME device-image / GIPHY / Pexels selectors) that **appends** an `{url, type: 'image'|'gif', alt?, credit?, w?, h?}` item to `gallery` (clamp at 8; toast "Up to 8 extra photos" at the cap). Adding a photo does NOT modify `localCover`/the cover fields. GIFs allowed (OQ-1) — a GIF selection sets `type: 'gif'`. **No video** may be added to the gallery (the video picker only sets the cover).
- **Reorder — WCAG-safe move-menu (NOT drag):** each gallery tile has an overflow (`⋯`) button opening a menu: **Make cover** · **Move earlier** (swap i↔i-1) · **Move later** (swap i↔i+1) · **Remove** (splice). Impossible options disabled via `accessibilityState.disabled`. Each item ≥44pt, `accessibilityRole="menuitem"`.
  - **"Make cover"** is the ONE explicit, user-initiated action where the gallery UI writes the cover fields: it promotes the selected image/GIF to the primary cover (emits a cover patch = that item, `coverMediaType` = its `image`/`gif`), and demotes the PRIOR cover — if it was an image/GIF — into the gallery at the vacated slot. If the prior cover was a **video**, "Make cover" REPLACES it (the video cover is cleared, exactly like today's "Replace"); this is an explicit user choice, not an automatic sync. (This is the deliberate exception to "adding never touches the cover".)
- **UI:** the primary-cover preview (as today) followed by a horizontal strip of the additional-photo tiles labeled "Also shown" / "Extra photos". The strip reflects the ordered gallery; the cover preview reflects the cover fields. Both feed the same emit.

### F.2 Emit contract (CoverPatch)
`onCoverChange` emits the **UNCHANGED 7 cover fields** (whatever the cover flow set — image, GIF, or video, or all-null when removed) **PLUS** `coverGallery: gallery` (the ordered additional image/GIF items, `[]` when none). The cover fields and `coverGallery` are set independently — NO field of one is derived from the other. `CoverPickerSheet.tsx` (`initial: CoverPatch`, `onCoverChange`, `CoverPickerSheetProps:42-51`) passes `initial.coverGallery` through; hosts persist the full patch (below).

### F.3 The 13 hero/authoring mounts — CHANGE vs INHERIT
A mount CHANGES only if it (a) composes `ParallaxCoverShell` and must pass `galleryImages`, and/or (b) is an authoring step that must persist `coverGallery`. Every mount that constructs `PublicEventProps` from a read RPC/view gains `coverGallery` for free via the adapter mapper (one edit per mapper); mounts that pass `event` straight into a shell wrapper inherit automatically once the wrapper forwards `galleryImages={event.coverGallery}`.

| # | Mount | File | Change? |
|---|-------|------|---------|
|1|FoundationEventPreview|`mingla-business/src/components/event/FoundationEventPreview.tsx:182`|**CHANGE** — add `galleryImages={event.coverGallery}` to `<ParallaxCoverShell>` (beside `coverMediaUrl`, line 185).|
|2|FoundationRsvpPreview|`mingla-business/src/components/event/FoundationRsvpPreview.tsx`|**CHANGE** — same one-line `galleryImages` passthrough on its `ParallaxCoverShell`.|
|3|TripPreview|`mingla-business/src/components/trip/TripPreview.tsx`|**CHANGE** — same passthrough.|
|4|ExperiencePreview|`mingla-business/src/components/experience/ExperiencePreview.tsx`|**CHANGE** — same passthrough.|
|5|ConsumerEventDetailScreen|`app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`|**CHANGE** — same passthrough on its `ParallaxCoverShell`.|
|6|ConsumerTripDetailScreen|`app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`|**CHANGE** — same passthrough.|
|7|ConsumerExperienceDetailScreen|`app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx`|**CHANGE** — same passthrough.|
|8|Business trip route|`mingla-business/app/t/[brandSlug]/[tripSlug].tsx`|**CHANGE** — same passthrough (if it mounts the shell directly).|
|9|Business experience route|`mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`|**CHANGE** — same passthrough.|
|10|Consumer experience route|`app-mobile/app/exp/[brandSlug]/[experienceSlug].tsx`|**CHANGE** — same passthrough (or inherits via ExperienceOfferingBody mount).|
|11|Marketing trip preview|`mingla-marketing/app/trip-preview/TripPreviewClient.tsx`|**CHANGE** — same passthrough.|
|12|Marketing event preview|`mingla-marketing/app/event-preview/EventPreviewClient.tsx`|**CHANGE** — same passthrough.|
|13|Authoring wizard previews|`CreatorStep4Cover.tsx` (event/rsvp), `TripCreatorStep1Basics.tsx`/`EditPublishedTripScreen.tsx` (trip), `ExperienceCoverStep.tsx` (experience)|**CHANGE (authoring)** — host the extended `CoverPickerSheet`, persist `coverGallery` into the draft store / patch (Section G), and (for the live preview) forward `galleryImages`.|

**Adapters (mappers) that gain `coverGallery` (one edit each):**
- Buyer-web/business/consumer read adapters that build `PublicEventProps` from `pg_public_*` json (e.g. `publicEventViewRowToEvent` in `mingla-business/src/services/publicEventsService.ts`; the consumer hooks `usePublicEventBySlug.ts`, `usePublicRsvpBySlug.ts`, `useConsumerTripOfferingData.ts`, `useConsumerExperienceDetail.ts`): map `row.coverGallery ?? []` → `event.coverGallery`.
- `tripOfferingAdapter.ts` / `experienceOfferingAdapter.ts`: pass `coverGallery` through.

**INHERIT-for-free (no edit beyond the mapper):** `EventOfferingBody`/`RsvpOfferingBody`/`TripOfferingBody`/`ExperienceOfferingBody` need NO change — they are shell-agnostic bodies passed as `children`; the row is injected by `ParallaxCoverShell`, and the pager is injected by the shell. **UNCHANGED explicitly.**

**Explicitly DO-NOT-TOUCH mounts:** `PublicVenuePage.tsx`, `PublicBrandPage.tsx`, `CountAwareGallery` call-sites, the Discover deck.

---

## G. Save / persistence contract (path-by-path — ADDITIVE, NO sync)

**Contract (I-868-GALLERY-ADDITIVE-INDEPENDENT):** Every existing cover write is **UNCHANGED** — `cover_media_url` / `cover_media_type` are written exactly as today (image OR video). `cover_media_gallery` is persisted as a SEPARATE additive field. **No write path syncs, derives, or clears one from the other.** No partial-save concern: the cover and the gallery are independent columns; writing one never requires touching the other.

**Draft vs published:**
- **Draft** (`draft_auto`): the CoverPicker emit (7 cover fields UNCHANGED + `coverGallery`) is mirrored into `draftEventStore`; the wizard autosave persists `cover_media_gallery` alongside the cover fields, each independently.
- **Published:** the publish RPCs write `cover_media_gallery` additively from the draft payload while writing the cover fields exactly as today. Live edits: trip via `biz_update_live_trip` / `tripsService`; event/rsvp/experience gallery via a dedicated additive writer (G.1).

### G.1 `mingla-business/src/services/eventCoverMediaService.ts`
- `setEventCover` (`:180-237`) & `clearEventCover` (`:239-276`): **UNCHANGED** — they still write ONLY the cover fields (7-field set / null-out). Do NOT touch them.
- **NEW** `setEventCoverGallery(serverEventId, gallery: OfferingGalleryImage[])`: writes ONLY `cover_media_gallery` (`.update({ cover_media_gallery: gallery, updated_at })`), keeping the existing `.eq("event_type", …)` + `deleted_at IS NULL` guards and a `.select("id, cover_media_gallery").maybeSingle()` persist check. It never reads or writes the cover columns.

### G.2 `business_publish_event_draft` (latest `supabase/migrations/20270112000000_issue_857_add_music_genres.sql:37`) — RE-PUBLISH VERBATIM + additive delta
Add a local `v_cover_media_gallery jsonb := COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb)` (beside the cover reads at `:280-286`) and add `cover_media_gallery = v_cover_media_gallery` to the `UPDATE public.events SET …` block (`:428-473`). The existing cover-field reads/writes (`:280-294`, `:435-441`) stay **VERBATIM** — no derive from the gallery, no null-coupling. Everything else VERBATIM.

### G.3 `business_publish_rsvp_draft` (same migration `:574`) — same additive delta
Add the same local + read + `cover_media_gallery = v_cover_media_gallery` in its `UPDATE public.events SET …` (`:808-853`). Cover fields VERBATIM. Everything else VERBATIM.

### G.4 `biz_update_live_trip` (latest `supabase/migrations/20260928000001_orch_1119_live_trip_media.sql:17`) — §5a events update
The §5a events `UPDATE` already handles the cover columns via `p_patch ?| ARRAY[...cover_media_...]` (`:394-426`). Add `'cover_media_gallery'` to that key array and a `cover_media_gallery = CASE WHEN p_patch ? 'cover_media_gallery' THEN COALESCE(p_patch->'cover_media_gallery','[]'::jsonb) ELSE cover_media_gallery END` line. The existing cover-field CASE lines stay VERBATIM (no derive). Re-publish VERBATIM otherwise (`CREATE OR REPLACE`, mirroring how ORCH-1119 added `media` here).

### G.5 `mingla-business/src/services/tripsService.ts` — `updateTripBasics` (`:996-1017`)
Add `if (patch.coverGallery !== undefined) update.cover_media_gallery = patch.coverGallery;` beside the existing `coverMediaUrl`/`coverMediaType` writes (`:1005-1006`). The cover writes stay UNCHANGED — no sync.

### G.6 `event-cover-video-apply` edge fn (`supabase/functions/event-cover-video-apply/index.ts`) — **UNCHANGED (NOT in allowlist)**
Both updates (`:104-109`, `:118-123`) write ONLY `cover_media_type:"video"` + `cover_media_url:job.processed_url` and stay **exactly as today**. A video cover COEXISTS with a photo gallery, so the edge fn does NOT touch `cover_media_gallery`. **Do not edit this file.**

**Migration-apply plan for G.2–G.4:** deploy via the Management API (NOT auto-apply / not `supabase db push`), orchestrator/Seth applies, then verify with a `curl` of each amended RPC returning `coverGallery` AND the unchanged cover fields (edge-deploy-verify protocol).

---

## H. Share / OG / email — per-file confirmation + RSVP fix

**Why intact (now EVEN SAFER — cover fields are untouched):** all share/OG/email surfaces read `cover_media_url` and require `cover_media_type !== 'video'`. Because this feature NEVER writes the cover columns (the gallery is a separate additive field), the primary image/video is byte-identical for every offering. No share surface reads the gallery in v1 (single-image share is the product contract).

| File | Cover read | Verdict |
|------|-----------|---------|
|`mingla-business/server/socialPreview.js`|`eventCoverUrl` (`:364-367`), `tripCoverUrl` (`:451-454`), `renderEventHtml` media (`:650-653`), `renderTripHtml` media (`:684-687`), `buildBrandOgCardProps` (`:554-563`) — all `isAbsoluteHttpUrl(row.cover_media_url) && row.cover_media_type !== 'video'`|**NO CHANGE** — reads the unchanged `cover_media_url`.|
|`mingla-business/api/og-event.js`, `og-trip.js`, `og-brand.js`|delegate to `socialPreview` builders|**NO CHANGE.**|
|`mingla-business/src/constants/publicUrls.ts`|`ogImageUrl`-style: `isAbsoluteHttpUrl(input.coverMediaUrl) ? coverMediaUrl : /og/event/…` (`:173-176`)|**NO CHANGE** — `coverMediaUrl` unchanged.|
|`supabase/functions/_shared/email/ticketBody.ts`|`isRenderableImage(event.coverMediaUrl, event.coverMediaType)` then `<img src=coverMediaUrl>` (`:27,33-34`)|**NO CHANGE** — cover primary unchanged.|

**KNOWN GAP FIX — RSVP `og:image` (mandate H):** `mingla-business/src/components/event/PublicEventPage.tsx` RSVP `<Head>` (`:861-872`) sets `title`/`description`/`og:title`/`og:url`/canonical but **NO `og:image`** (the event/trip pages get theirs via the SSR `socialPreview`/`publicUrls`, but the RSVP web branch renders its own `<Head>` with none). **Add**, inside that `<Head>`: `<meta property="og:image" content={ogImageUrl({ coverMediaUrl: event.coverMediaUrl, id: event.id, kind: 'event' })} />` plus `<meta name="twitter:card" content="summary_large_image" />` + `<meta name="twitter:image" content={…same…} />` + `<meta property="og:description" …>`. `ogImageUrl` (`publicUrls.ts:173-176`) already resolves the (unchanged) `coverMediaUrl` or the `/og/event/{id}.png` fallback — no new infra. This is the single behavior change in the share layer and it only ADDS a tag (never removes/alters existing tags).

---

## I. Regression protection

### I.1 Existing tests/gates that MUST stay green (append-only; do NOT edit)
- `packages/offering-rendering/__tests__/eventCoverMedia.test.ts` (+ the ×4 family): `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`, `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts`, `…/eventCoverMediaService.setClearSplit.test.ts`. (Presentation-parity of the two `resolve*` copies + set/clear split.)
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` (publish/draft lifecycle guards).
- `.github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs` — 9 checks; specifically **Check 8** (`CoverPicker.tsx` must contain LOCKED tab ids `"library"`/`"gif"`/`"stock"`; `CoverPickerSheet.tsx` hosts `<Sheet>`+`<CoverPicker>`; `BrandCoverPickerSheet.tsx` stays deleted) and **Check 9** (`PublicBrandPage.tsx` renders via `EventCoverMedia` + `coverMediaUrl`). The authoring extension keeps the tab ids and does not touch the brand page ⇒ green.
- The `CoverPicker.*` test family (`CoverPicker.selectedState.test.ts`, `CoverPicker.videoSourceCeiling.test.ts`, `CoverPicker.providerTelemetry.test.ts`, `orch1001CoverPickerWebSplit.test.ts`, etc.) — the video path + web-split + provider-telemetry stay behaviorally identical.
- `orch_1075_paid_publish_integrity_guards.test.*`, `issue_1014_free_publish_currency*` — the publish RPCs are re-published VERBATIM except the additive gallery delta; these gates must stay green.
- CI 10-job MANIFEST / strict-grep registry + deno-fmt gate on the 6 gated files.

### I.2 NEW implementor happy-path regression test (fails-on-revert, real path)
`packages/offering-rendering/__tests__/coverGalleryRow.test.tsx` (append-only) — render `CoverGalleryRow` + assert: (a) `gallery.length<1` ⇒ renders null; (b) `≥1` ⇒ `1 + gallery.length` cards, card 0 = the cover; (c) card 0 shows a ▶ badge WHEN `cover.type==='video'` and NO ▶ for image/GIF cover or gallery cards; (d) the `activeIndex` card carries the accent-ring style + selected badge + `accessibilityState.selected`; (e) tapping card `i` fires `onSelect(i)`. PLUS a shell wiring test `parallaxCoverGallery.test.tsx`: with `galleryImages` (≥1) the shell renders the pager (`1 + N` pages, page 0 = the cover incl. a VIDEO cover) + the row before `children`; with `galleryImages` empty/absent it renders the single cover + NO row + NO pager (byte-identical guard, for BOTH image and video covers). PLUS a persistence unit `coverGalleryPersist.test.ts` asserting: writing a gallery via `setEventCoverGallery` / the publish RPCs leaves `cover_media_url` + `cover_media_type` **UNCHANGED**; a video cover + a photo gallery **COEXIST** (cover_media_type stays `video`, gallery non-empty); and no path derives one field from the other. Each MUST fail when the corresponding wiring is reverted.

### I.3 Tester adversarial test (different angle, required at CLOSE)
Independent test driving the FULL author→publish→view journey on a real path: set a **video** primary cover AND author a 3-photo gallery (reorder via "Move earlier"/"Make cover") via the extended CoverPicker, publish through `business_publish_event_draft`, then read back through `pg_public_event_by_slug` and assert (a) `coverMediaType==='video'` + `coverMediaUrl` == the video URL, **UNCHANGED** by the gallery; (b) `coverGallery` order matches the authored order and contains ONLY `image`/`gif` items (no video); (c) the SSR `socialPreview` `og:image` still equals the cover poster / cover fields (gallery irrelevant to share). Then verify the pure-photo case (image cover + gallery) coexists identically. Runtime-validate on iOS sim + plugged-in Android + buyer-web: the hero sequence = [cover]++gallery; swiping flips through cover→photos + updates the ring; the video cover at index 0 plays; tapping a card flips the shown item; card 0 shows ▶ only for a video cover; the body scrolls the row away over the pinned pager; the page body never scrolls sideways. Get Seth's eyeball DURING test before PASS (runtime-test-all-surfaces mandate).

### I.4 NEW strict-grep gate to add
`.github/scripts/strict-grep/issue-0868-cover-gallery.mjs` (register in the MANIFEST; origin+delta counter per the rebase-safe pattern). Assert: (1) migration `*issue_868*cover_gallery.sql` exists + declares `cover_media_gallery` + the `_is_array` CHECK; (2) the additive write paths (`eventCoverMediaService.ts` `setEventCoverGallery`, `tripsService.ts`, the 3 publish/live RPCs) reference `cover_media_gallery`; (3) `event-cover-video-apply/index.ts` does **NOT** reference `cover_media_gallery` (negative grep — proves the video path stays independent); (4) each of the 4 anon hero RPCs projects `coverGallery`; (5) `CoverGalleryRow.tsx` exists and `ParallaxCoverShell.tsx` references `galleryImages`; (6) the RSVP `<Head>` in business `PublicEventPage.tsx` contains `og:image`. Any miss ⇒ non-zero exit (fails-on-revert of the whole feature).

---

## J. Pre-staged DRAFT invariants (`docs/INVARIANT_REGISTRY.md`)
Stage as **DRAFT** now; orchestrator flips ACTIVE on CLOSE.
- **`I-PROPOSED-868-GALLERY-ADDITIVE-INDEPENDENT`** — `events.cover_media_gallery` holds ADDITIONAL cover items and is INDEPENDENT of `cover_media_url`/`cover_media_type` (the primary cover, image OR video, at sequence index 0). NO write path syncs, derives, or clears one from the other; every existing cover write stays byte-identical, so all thumbnail/share/OG/email readers are unaffected. Verified by `coverGalleryPersist.test.ts` (cover fields UNCHANGED when a gallery is set) + the strict-grep gate (incl. the negative grep on `event-cover-video-apply`).
- **`I-PROPOSED-868-GALLERY-NO-VIDEO`** — `cover_media_gallery` items are `image`/`gif` ONLY (`type ∈ {image,gif}`, never `video`). A video lives ONLY in the cover fields (index 0) and COEXISTS with a photo gallery. Verified by the adversarial coexistence test.
- **`I-PROPOSED-868-HERO-SEQUENCE`** — the hero pinned pager + `CoverGalleryRow` render the sequence `[cover] ++ cover_media_gallery`; card/page 0 is the cover (a ▶ badge only when the cover is a video); the pager/row engage only when `cover_media_gallery.length ≥ 1` (empty ⇒ single-cover behavior byte-identical, image or video). Verified by the shell byte-identical guard test + `coverGalleryRow.test.tsx`.

---

## K. Cross-surface change manifest (file-by-file; 5 shipping surfaces)

**Surfaces:** 1 Consumer iOS · 2 Consumer Android · 3 Buyer/anon Web · 4 Business iOS · 5 Business Android (+ adjacent: Admin Web, Business Web preview). Parity is **AUTOMATIC** for the renderer (single shared `@mingla/offering-rendering` code) and **MANUAL** only at the per-surface mount passthrough (one line each) and the per-app read adapters.

### CHANGED — allowlist (implementor may edit ONLY these)
**DB/migrations (new + additive `CREATE OR REPLACE`):**
- `supabase/migrations/20270116000868_issue_868_cover_gallery.sql` (NEW — column + CHECK)
- re-publish (VERBATIM + gallery delta) the 3 RPCs + amend the 4 anon RPCs + 2 views: `pg_public_event_by_slug`, `pg_public_rsvp_by_slug`, `pg_public_trip_by_slug`, `pg_public_experience_by_slug`, `business_publish_event_draft`, `business_publish_rsvp_draft`, `biz_update_live_trip`, `business_public_events_view`, `business_management_events_view` (+ `events_with_master_date_view` iff explicit). Land these as NEW migration file(s) after `20270116000868` (do NOT edit historical migrations).

**Edge fn:** NONE. `event-cover-video-apply/index.ts` is **UNCHANGED** (video cover coexists with the gallery; it never touches `cover_media_gallery`).

**Shared package (`@mingla/offering-rendering`):**
- `CoverGalleryRow.tsx` (NEW; renders card 0 = cover + gallery, calls `deriveCoverPosterUrl`), `ParallaxCoverShell.tsx` (pager over `[cover]++gallery` + row wiring + `galleryImages` prop), `types.ts` (`OfferingGalleryImage` incl. `type?` + `coverGallery`), `index.ts` (export).

**mingla-business:**
- `src/components/ui/CoverPicker.tsx` (separate additional-photos manager + move-menu; cover flow UNCHANGED), `CoverPickerSheet.tsx` (pass `coverGallery`), `coverTarget.ts` (unchanged types OK), `src/store/draftEventStore.ts` (add `coverGallery`), `src/services/eventCoverMediaService.ts` (**add** `setEventCoverGallery`; `setEventCover`/`clearEventCover` stay UNCHANGED), `src/services/tripsService.ts` (`updateTripBasics` additive `coverGallery` + patch/mapper types), `src/services/publicEventsService.ts` (mapper), the 4 hero wrappers (`FoundationEventPreview.tsx`, `FoundationRsvpPreview.tsx`, `TripPreview.tsx`, `ExperiencePreview.tsx`), the authoring steps (`CreatorStep4Cover.tsx`, `TripCreatorStep1Basics.tsx`, `EditPublishedTripScreen.tsx`, `ExperienceCoverStep.tsx`), `src/components/event/PublicEventPage.tsx` (RSVP `og:image` fix only), the business trip/exp routes (`app/t/…`, `app/exp/…`), `tripOfferingAdapter.ts`/`experienceOfferingAdapter.ts`.

**app-mobile:** the 3 consumer detail screens + `app/exp/…` + the read hooks (`usePublicEventBySlug.ts`, `usePublicRsvpBySlug.ts`, `useConsumerTripOfferingData.ts`, `useConsumerExperienceDetail.ts`) — mapper `coverGallery` + `galleryImages` passthrough.

**mingla-marketing:** `app/trip-preview/TripPreviewClient.tsx`, `app/event-preview/EventPreviewClient.tsx` (passthrough).

**Tests/gates:** `coverGalleryRow.test.tsx`, `parallaxCoverGallery.test.tsx`, `coverGallerySync.test.ts`, `.github/scripts/strict-grep/issue-0868-cover-gallery.mjs` (+ MANIFEST registration), `docs/INVARIANT_REGISTRY.md` (DRAFT invariants).

### UNCHANGED — DO-NOT-TOUCH (stop-and-amend before editing any)
- `EventCoverMedia.tsx`, `CountAwareGallery.tsx`, `galleryLayout.ts`, `coverMediaPresentation.ts`, `mingla-business/src/utils/eventCoverMediaRules.ts` (presentation logic — unless changing a `resolve*` helper in BOTH per the duplication rule, which this SPEC does not).
- The `EventOfferingBody`/`RsvpOfferingBody`/`TripOfferingBody`/`ExperienceOfferingBody` bodies.
- `PublicVenuePage.tsx`, `PublicBrandPage.tsx` (brand fast-follow; venue excluded), the Discover deck / `discover-cards`.
- The ~30 thumbnail surfaces (deck cards, brand/event list cards, management list rows) — they read the unchanged `cover_media_url`; ZERO edits.
- Share/OG/email files (`socialPreview.js`, `og-*.js`, `ticketBody.ts`, `publicUrls.ts` builders) — NO change; only the RSVP `<Head>` in `PublicEventPage.tsx` gains a tag.
- **The entire `event-cover-video-apply/index.ts`** — the video-cover path is independent and coexists with the gallery; do NOT touch it.
- `eventCoverMediaService.ts` `setEventCover` / `clearEventCover` — UNCHANGED (cover-only); the gallery gets its own `setEventCoverGallery`.
- Historical migrations (never edit; land re-publishes as new files).

---

## L. Open risks / sequencing / migration-apply plan

### Risks / open questions
1. **[RISK-1 — native gesture arbitration] (top risk).** Making the pinned-behind pager (`[cover]++gallery`) swipeable while the body ScrollView (on top) owns vertical scroll is nuanced on native (the pinned cover is `pointerEvents:none` today; the body's transparent spacer captures pans). Web is low-risk (independent scroll axes via scroll-snap). Native plan: pinned horizontal `pagingEnabled` ScrollView + spacer `pointerEvents:none` in gallery mode; **row-tap is the guaranteed control**; swipe is the enhancement and MUST be runtime-validated on iOS + Android. **Fallback:** add tap chevrons (per `ImageGallery.tsx:148-170`) if swipe degrades vertical scroll. If neither is acceptable, escalate to the orchestrator (do NOT ship a dead swipe). Do not silently pull in `react-native-gesture-handler` without a SPEC amendment.
2. **[OQ-1 — RESOLVED: GIFs allowed].** GIFs may sit in the gallery (`type ∈ {image,gif}`, never video). Item `type` drives the `EventCoverMedia` render branch.
3. **[OQ-2 — RESOLVED: COEXIST].** Cover (image OR video) and photo/GIF gallery are INDEPENDENT and coexist; no sync, no "video clears gallery". A video cover plays at sequence index 0 while the gallery adds indices 1..N.
4. **[OQ-3 — "Make cover" on a video cover] (confirm).** SPEC decision: "Make cover" from a gallery image, when the current cover is a VIDEO, REPLACES the video cover with the chosen image (explicit user action, like today's "Replace"). Confirm Seth is OK discarding the video in that explicit case (vs. disabling "Make cover" while a video cover is set). Low-risk either way; flag before build.
5. **[RISK-2 — desktop row placement].** On desktop the hero is a contained `21/9` and the body is a two-column grid; the row goes as the first element of the left column (`desktopLeft`, `ParallaxCoverShell.tsx:257`). Confirm the row reads well beneath a contained hero (designer already approved the phone layout).
6. **[RISK-3 — `events_with_master_date_view` projection style]** must be verified (Section C.7) before deciding whether it needs an amendment.

### Sequencing (implementation order)
1. **DB** — `20270116000868` column + CHECK (apply, verify via `list_tables`/`\d events`).
2. **Read RPCs/views** — amend the 4 anon RPCs + 2 views (new migration file(s)); deploy via Management API; `curl`-verify each returns `coverGallery`.
3. **Types** — `types.ts` / `ParallaxCoverShellProps` / `CoverPatch` / draft store / trips patch (default `[]`).
4. **Write paths (ADDITIVE only)** — NEW `setEventCoverGallery`, the 3 publish/live RPCs, `tripsService.updateTripBasics` — all write `cover_media_gallery` and leave the cover fields UNTOUCHED. `setEventCover`/`clearEventCover` and `event-cover-video-apply` stay UNCHANGED. (Verify cover fields unchanged + video↔gallery coexistence.)
5. **Renderer** — `CoverGalleryRow` + `ParallaxCoverShell` pager/row wiring (guarded); the 12 mount passthroughs + read-adapter mappers.
6. **Authoring** — `CoverPicker` ordered-array + move-menu + emit; the 4 authoring steps persist `coverGallery`.
7. **Share fix** — RSVP `og:image`.
8. **Tests + gates + DRAFT invariants** — I.2, I.4, J.
9. **Runtime-validate** all 5 surfaces + Seth eyeball; tester adversarial pass (I.3).

### Migration-apply plan
All schema + RPC/view changes deploy via the **Supabase Management API** (project `gqnoajqerqhnvulmnyvv`), NOT `supabase db push` / not auto-apply (history-drift + blind-push hazards). Orchestrator/Seth applies; verify each amended RPC with a live `curl` returning `coverGallery` and each write path with a round-trip read before PASS. Rollback = drop-column (B.5) after reverting the dependent view/RPC amendments.

---

## Downstream routing
**Next = mingla-implementor** (build side), inside `868-cover-gallery` worktree, following the allowlist (Section K) + stop-and-amend on anything outside it. Then **mingla-tester** (adversarial I.3 across all 5 surfaces + Seth eyeball). Then **orchestrator CLOSE** (flip DRAFT invariants ACTIVE, register the new strict-grep gate in the MANIFEST, ship-log line in `REPORTS.md`).
