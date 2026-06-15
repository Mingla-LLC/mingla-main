# SPEC — META-ORCH-1138 Leg 1 [Shared Direction-A Foundation + Public TRIP Page]

**Status:** SPEC (binding contract). NOT implemented.
**Author:** mingla-forensics (SPEC mode).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign` (rebased onto `origin/main` @ `1123cffb5`).
**Supersedes / extends:** `SPEC_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN.md` (which predates the v2–v7 design iterations and covered trip only; this spec adds the shared 4-page foundation and binds the FINAL approved trip mockup). The earlier spec's §0 provenance facts (ORCH-1130 merged; no schema change needed) are RE-CONFIRMED below.
**Approved design = SOURCE OF TRUTH (anchor checkout `Mingla_Artifacts/design/ORCH-1138/`):**
- `DIRECTION_A_V2_FULL_RESPONSIVE.html` — the FINAL approved TRIP mockup (Leg-1 build target; reflects every v2–v7 iteration).
- `DESIGN_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN.md` — trip field inventory + per-day itinerary + desktop layout (§A/B/C).
- `EVENT_DIRECTION_A_RESPONSIVE.html` + `DESIGN_ORCH-1138B_PUBLIC_EVENT_PAGE.md` — event tuning (ticket panel) — read so the FOUNDATION fits it.
- `EXPERIENCE_DIRECTION_A_RESPONSIVE.html` + `DESIGN_ORCH-1138C_PUBLIC_EXPERIENCE_PAGE.md` — experience tuning (date-pick + book panel) — read so the FOUNDATION fits it.
- `BRAND_DIRECTION_A_RESPONSIVE.html` + `DESIGN_ORCH-1138D_PUBLIC_BRAND_PAGE.md` — brand tuning (hub + summary panel) — read so the FOUNDATION fits it.

The HTML/MD are the pixel/token/state/motion source of truth; this SPEC binds them to exact files, prop contracts, and the data path.

---

## 1. Executive summary

The four public buyer-anon offering pages — trip (`/t/`), event (`/e/`), experience (`/exp/`), brand (`/b/`) — are being unified onto one approved "Direction A" visual system (immersive parallax cover + body-level fixed chrome + brand-driven theming + overlapping rounded body seam + responsive desktop two-column with a sticky right panel + count-aware media galleries + wrapping check/✗ chips). META-ORCH-1138 ships this in **legs**.

**Leg 1 (this spec) delivers TWO things:**

- **PART A — the shared Direction-A FOUNDATION:** build once, reused by all four pages. (1) Extract `createThemePalette` + the `ThemePalette` type out of `@mingla/event-rendering`'s private `PublicEventPage.tsx` into an EXPORTED, behavior-neutral module so it is the single theming source of truth for all four pages — guarded by an event-page parity test that fails on any palette drift. (2) Spec a small set of reusable, generic layout primitives (parallax cover + fixed chrome, responsive two-column shell with a page-specific sticky panel, count-aware gallery, wrapping chip group, contrast-aware surface theming) with exact prop contracts, living in a new shared package both `mingla-business` and `@mingla/event-rendering` can import.

- **PART B — the TRIP page on that foundation (the Leg-1 deliverable that actually IMPLEMENTS a page):** rebuild `TripPreview.tsx` + `/t/[brandSlug]/[tripSlug].tsx` to the final approved trip mockup using the foundation primitives, with a fetch change to thread brand+trip theme columns into a resolved palette. Trip is the proving ground for the foundation; event/experience/brand are subsequent legs (NOT implemented here).

**Why now:** the trip page is the only public offering page that is NOT themed today (hardcoded warm orange, locked-dark, weak brand byline, flat itinerary, afterthought payment). This leg both fixes that and lays the foundation the other three pages snap onto.

**This is a FETCH + RENDER + REFACTOR change only. No migration, no DB view change, no RLS change, no edge-function change.** (See §3 + §4; expected schema/view gap = NONE.)

---

## 2. Scope & non-goals

### 2.1 IN SCOPE (Leg 1)

**Part A — Foundation:**
- A1. Extract `createThemePalette` + `ThemePalette` (+ the color-math helpers it depends on) out of `packages/event-rendering/PublicEventPage.tsx` into a new exported module `packages/event-rendering/themePalette.ts`, re-exported from `packages/event-rendering/index.ts`. `PublicEventPage.tsx` then imports them (behavior-neutral; same algorithm, same outputs). Guarded by an event-page palette parity snapshot test (§9).
- A2. A new shared package `packages/offering-rendering/` (name + rationale §6) holding the reusable Direction-A layout primitives: `ParallaxCoverShell`, `OfferingChrome`, `CountAwareGallery`, `ChipGroup`, plus the surface-theming helper `useOfferingSurface`/`offeringSurfaceStyles`. Each primitive is generic across all four pages; the page-specific content (booking panel / ticket panel / summary panel) is passed in as children/props. Prop contracts in §4.
- A3. The primitives are pure-presentational (props in, no app `src/` imports) per I-MOR-0827-PACKAGE-ISOLATION, mirroring `@mingla/event-rendering`.

**Part B — Trip page:**
- B1. Fetch change in `usePublicTripBySlug.ts`: select brand `theme_color/theme_font/theme_animation` + map trip `theme_color_override/theme_font_override/theme_animation_override` (already returned by `events.select("*")`) into a `ThemeInput`-shaped payload. NO schema change.
- B2. Sold-out wiring: thread `pg_public_ticket_types_remaining` into the slug-preview path so `ticketsRemaining` is real (today it is hardcoded `null` at `usePublicTripBySlug.ts:259`), mirroring the already-wired `getPublicTripById` checkout path (`publicEventsService.ts:1326,1410-1422`).
- B3. `/t/[brandSlug]/[tripSlug].tsx`: resolve theme → palette → surface and pass them down; restyle the route chrome to the foundation's fixed chrome (X / Share / Mute) and route the existing `ShareModal` (no dead taps); keep ORCH-1115 anon-route exemption + the ORCH-0874 status-bar-overlap strict-grep allow comment.
- B4. `TripPreview.tsx` rebuilt to the FINAL approved trip mockup (`DIRECTION_A_V2_FULL_RESPONSIVE.html`) using the foundation primitives: full-bleed parallax cover + fixed chrome; eyebrow/title; meta chips (dates, derived duration, seats-left, location); brand "Presented by" chip; route line (departure → destination); collapsible About; **real per-day itinerary** (ordinal/date + title + narrative + per-day count-aware media gallery — NO fabricated timed stops); What's included / not-included wrapping check/✗ chips; static map block (destination lat/lng); the ORCH-1130 payment block; refund ladder + booking-deadline strips; every state. Responsive: phone single-column immersive ↔ ≥1024px two-column with the sticky right BOOKING panel.
- B5. Wrap (never reimplement) the merged ORCH-1130 payment components (`TripPaymentChoice.tsx`, `TripCheckoutFlow.tsx`) with an **additive optional `palette` prop** — absent ⇒ byte-identical 1130 output (protects the checkout wizard Step 5 + `/checkout-trip/[tripEventId]/payment.tsx` which reuse these components).

### 2.2 NON-GOALS (explicitly OUT — do NOT build in Leg 1)

- The EVENT page (`/e/`), EXPERIENCE page (`/exp/`), BRAND page (`/b/`) implementations. The foundation must FIT them (prop contracts are abstracted for ticket/date-pick/summary panels) but Leg 1 IMPLEMENTS only trip. These are subsequent legs.
- Any change to the existing `PublicEventPage.tsx` rendering OUTPUT. A1 is a behavior-neutral extraction only; the event page must render identically before/after (parity test enforces).
- Any schema change, migration, RLS change, view change, or edge-function change. (Confirmed unnecessary — §3.)
- Per-day **timed stops** rendering (`trip_days.stops`). The wizard does not author them; rendering would fabricate data (rule 9). Final mockup v3 REMOVED them. A day ends at its media gallery. (If stops are ever activated, that is a separate ORCH that adds the wizard sub-editor first.)
- A trip-level standalone gallery (no model field — fabrication; removed in mockup v5).
- Brand bio subline on the trip page (removed in mockup v4 for event-page parity).
- Multi-tier trip tier selector. Today only `pricingTiers[0]` is rendered; multi-tier is out of scope (no prod data) — see §10 Q3.
- Real cover audio playback for the Mute toggle beyond what `EventCoverMedia` already does (the chrome Mute button toggles `EventCoverMedia`'s existing muted state; no new audio engine).
- Consumer app-mobile native trip detail screen. This is the business-app shared component (also mountable in-app via the shared package, but app-mobile wiring is not a Leg-1 deliverable).
- OTA / EAS publish / deploy / PR merge (orchestrator CLOSE owns those).

### 2.3 Assumptions
- ORCH-1130 is MERGED to origin/main (confirmed `028f48e16` … `2c0b13154` per the prior spec §0; re-verified the components exist in this rebased branch). No blocking dependency.
- The trip is an `events` row with `event_type='trip'`; theme columns exist (§3).
- COMMS-0029 (WARN, OPEN) concerns `biz_update_live_trip` migration clobber coordination between ORCH-1119/1120. **This Leg is render-only with NO migration** → no conflict; acked as FYI.

---

## 3. Confirmed schema/view truth (read before scoping — expected gap = NONE)

Verified against the migration chain (latest-wins) in this rebased worktree:

- **`public.brands`** carries `theme_color` / `theme_font` / `theme_animation` (text; hex-CHECK / whitelist-CHECK) — `supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql:8-10,22-48`.
- **`public.events`** carries `theme_color_override` / `theme_font_override` / `theme_animation_override` (text; same constraints) — same migration `:13-15,50-79`. Trips are `events` rows, so a trip physically carries these override columns.
- **`business_public_events_view`** already exposes both sets (`brand_theme_*` + `theme_*_override`) and is `GRANT SELECT … TO anon` — same migration `:174-240`. (The trip slug hook does NOT use this view; it reads `brands` + `events` directly — see below — but the columns it needs exist on those base tables.)
- **`pg_public_ticket_types_remaining`** is an anon-callable RPC already wired into the trip checkout path (`getPublicTripById`, `publicEventsService.ts:814,1326,1410-1422`).

**Therefore the only data-layer work is FETCH MAPPING in `usePublicTripBySlug.ts`:**
- It selects brand `id, slug, name, description, cover_media_url` (`:91`) — **omits `theme_color/theme_font/theme_animation`** → ADD them.
- It does `events.select("*")` (`:103`) — so `theme_color_override/theme_font_override/theme_animation_override` ARE returned, but the `Trip` mapper drops them → MAP them.
- It hardcodes `ticketsRemaining: null` (`:259`) → wire the remaining RPC.

**Expected schema/view/RLS/migration gap found = NONE.** All three changes are TypeScript fetch-mapper edits.

---

## 4. Layered specification

No DB / edge / realtime layers are touched. Layers below: **package extraction → shared primitives → service/hook → component**.

### 4.0 Layer: event-rendering palette extraction (Part A1 — behavior-neutral)

**File:** NEW `packages/event-rendering/themePalette.ts`.
**Move VERBATIM (no logic change)** from `packages/event-rendering/PublicEventPage.tsx`:
- the `ThemePalette` type (`PublicEventPage.tsx:116-131`),
- the `Rgb` type + `FALLBACK_ACCENT_RGB` + color helpers: `clampColorChannel`, `parseHexColor`, `rgbToHex`, `mixHexColors`, `hexToRgba`, `linearizeSrgb`, `relativeLuminance`, `contrastRatio`, `readableTextFor`, `contrastAdjustedAccent`, `contrastAdjustedForWhiteText` (`:133-230`),
- `createThemePalette` (`:232-272`).

These depend ONLY on `ResolvedTheme` (already exported from `designTokens.ts`). The module imports `ResolvedTheme` from `./designTokens`.

**Export contract (add to `packages/event-rendering/index.ts`):**
```ts
export { createThemePalette } from "./themePalette";
export type { ThemePalette } from "./themePalette";
```
**`PublicEventPage.tsx` change:** delete the moved declarations; `import { createThemePalette, type ThemePalette } from "./themePalette";`. The `resolveOfferingSurface` export (`:279-293`) stays in `PublicEventPage.tsx` OR moves to `themePalette.ts` alongside (recommended: move it, since it duplicates the `useDark` decision and both pages need a "light"/"dark" surface tone) — implementor's choice, but if moved it must remain exported with the identical name/signature.

**Contract:** `createThemePalette(resolvedTheme)` returns a `ThemePalette` byte-identical to today for every input. The parity test (§9 RT-1) is the gate.

### 4.1 Layer: shared offering-rendering primitives (Part A2)

**New package:** `packages/offering-rendering/` — pure-presentational, props-only, no app `src/` imports (I-MOR-0827). `package.json` name `@mingla/offering-rendering`; it MAY depend on `@mingla/event-rendering` (for `ThemePalette`, `ResolvedTheme`, `EventCoverMedia`, `ThemeEntranceAnimation`) and on RN / react-native-web only.

> **Per-platform note:** these primitives must work on **react-native-web** (the `/t/`,`/e/`,`/exp/`,`/b/` routes are RN-web) AND **native RN** (in-app mount). Web-specific behaviors (the `position:fixed` parallax pin, the `position:sticky` desktop panel, the `@media` breakpoint, hover) are achieved via RN-web style props + a `useResponsiveLayout` width hook; native falls back to single-column immersive with `safeAreaInsets`. Where a behavior is web-only, the spec says so and names the native fallback.

#### 4.1.1 `ParallaxCoverShell`
The full-bleed parallax cover + the overlapping rounded body seam + the responsive two-column shell. The single structural primitive every page mounts.

```ts
interface ParallaxCoverShellProps {
  palette: ThemePalette;                 // from createThemePalette
  theme: ResolvedTheme;                  // for fontFamilyValue + entrance animation key
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue?: number | null;              // no-cover flat-hue fallback (accent-derived)
  entranceAnimationKey: string;          // e.g. `trip:${id}` / `event:${id}` / `brand:${slug}`
  muted: boolean;                        // cover-video sound state (default true)
  onToggleMute: () => void;              // toggles EventCoverMedia muted
  showMute: boolean;                     // true only when coverMediaType==='video' (brand page gates this)
  onClose: () => void;
  onShare: () => void;
  heroEyebrow?: React.ReactNode;         // desktop overlay caption (duration / date)
  heroTitle?: React.ReactNode;           // desktop overlay title
  stateBanner?: React.ReactNode | null;  // sold-out / closed / deadline pill (page-specific)
  children: React.ReactNode;             // LEFT scrolling content (the page body)
  stickyPanel?: React.ReactNode | null;  // RIGHT sticky panel (page-specific: booking/ticket/summary)
  ScrollComponent?: React.ComponentType<any>;  // gorhom BottomSheetScrollView injection (default RN ScrollView)
  contentBottomInset?: number;           // floating-bar clearance (phone)
  safeAreaTop?: number;                  // native: insets.top; web: 0 (full-bleed)
  testID?: string;
}
```
**Behavior contract (proven by the mockup — implementor must not reintroduce the stacking traps):**
- **Phone (<1024px):** cover is `position:fixed` (web) / pinned (native) at z-index 1, aspect 4/5, full-bleed edge-to-edge; a flow spacer holds the cover height so the body starts below it; the body (opaque `palette.page` bg, `borderTopRadius:28`, −28 seam, accent-tinted border) slides UP and OVER the cover at z-index 2. `stickyPanel` is ignored on phone (its content is mounted inline by the page in the children flow instead — see trip §4.3); the floating bar is a separate page-level sibling.
- **Chrome stacking (THE TRAP — document inline):** the X / Share / Mute chrome row must escape the pinned-cover stacking context. On web it is a **body-level fixed layer** at z-index ≥70 (above the cover AND the sliding content), inset 16px from each edge, top = `safeAreaTop + 12`. It must NOT be a child of the pinned cover (it would be clipped / pinned with it). Mockup proved: cover/hero z-index 1 < content z-index 2 < chrome z-index ≥70. On native, the chrome is an absolute-positioned sibling of the ScrollView with `pointerEvents="box-none"` (mirrors today's `/t/` route overlay pattern) padded by `safeAreaTop`.
- **Desktop (≥1024px):** cover is contained inside the centered shell (`max-width:1200px; margin:0 auto`), rounded 24, aspect 21/9 max-height 520; `heroEyebrow`+`heroTitle` overlay bottom-left ON the cover; chrome is `position:absolute` on the contained cover top corners. The shell is a CSS grid `minmax(0,1fr) 360px` gap 40: LEFT = `children`, RIGHT = `stickyPanel` (`position:sticky; top:24px`). The phone floating bar is hidden.
- **No-cover:** flat `coverHue`-derived hue fill behind the title scrim (reuse `EventCoverMedia`'s no-cover branch / `coverHue`).
- **Cover video:** `EventCoverMedia` autoplay-muted; the chrome Mute button (`showMute`) toggles its muted state via `onToggleMute`. Reuse `EventCoverMedia`'s `VolumeGlyph` glyph (filled triangle + slash↔waves).
- **Entrance:** `ThemeEntranceAnimation` over the cover keyed by `entranceAnimationKey`, once per session, reduced-motion-skipped.

#### 4.1.2 `OfferingChrome`
The circular icon-button row (X top-left; Share + optional Mute top-right). Used INSIDE `ParallaxCoverShell` (exposed standalone so a page can mount it independently if it owns its own cover). Reuses `Icon` `share` glyph + `EventCoverMedia` `VolumeGlyph`. 40×40 circular glass buttons, `palette`-tinted, ≥44pt hit target (hitSlop 8). Props: `{ palette; showMute; muted; onClose; onShare; onToggleMute; closeAccessibilityLabel?; }`.

#### 4.1.3 `CountAwareGallery`
The 1=full / 2=split / 3+=scroll-snap-slider media gallery. Used by per-day media (trip), per-stop media (experience).
```ts
interface CountAwareGalleryItem { url: string; type: "image" | "video"; }
interface CountAwareGalleryProps {
  items: CountAwareGalleryItem[];        // empty ⇒ renders NOTHING (zero nodes; rule 9 — no empty frame)
  palette: ThemePalette;
  variant?: "phone" | "desktop";         // sizing deltas per mockup (phone 96–150 / desktop 190–300)
  accessibilityLabelPrefix?: string;     // e.g. "Day 1 media"
  testID?: string;
}
```
**Contract:** picks `media-one` / `media-two` / `media-slider` from `items.length` (1 / 2 / ≥3). `type:'video'` items get a centered ▶ overlay on a `rgba(0,0,0,0.28)` scrim, EXPLICIT type (never auto-detected — ORCH-1069/0978 rule). Video tiles reuse `EventCoverMedia` (autoplay-muted, one-playing guard preserved from today's `TripPreview` `activeVideoKey` pattern). Empty `items` ⇒ returns `null`.

#### 4.1.4 `ChipGroup`
The wrapping chip row with check (✓) / cross (✗) variants for included / not-included.
```ts
interface Chip { label: string; variant: "yes" | "no"; }
interface ChipGroupProps { chips: Chip[]; palette: ThemePalette; testID?: string; }
```
**Contract:** flex-wrap left→right on both phone+desktop. `yes` = accent-wash fill + accent-filled ✓ badge; `no` = card fill + muted ✗ badge. **Color is never the only indicator** — the ✓/✗ glyph carries the meaning. Empty ⇒ `null`.

#### 4.1.5 Surface theming helper
`offeringSurfaceStyles(palette)` → a memo-friendly set of derived RN styles (page bg, card, cardStrong, border, accentBorder, accentWash, primary/secondary/tertiary text, danger/danger-wash) so every primitive + page reads from ONE resolved palette and never a raw hex. Plus re-export `resolveOfferingSurface` (light/dark tone) from `@mingla/event-rendering`. **Contract:** every accent/text/surface color on all four pages derives from `palette` (the `createThemePalette` output) — never `accent.warm` / `#0c0e12` / raw `#ffffff`.

### 4.2 Layer: service / hook (Part B1 + B2)

**File:** `mingla-business/src/hooks/usePublicTripBySlug.ts`.

**B1 — theme fetch + map (no schema change):**
- Brand select (`:91`) → add `theme_color, theme_font, theme_animation`.
- Extend `PublicTripPayload.brand` with `theme: ThemeInput | null`.
- Map brand theme via the same guard logic as `asThemeInput` (`publicEventsService.ts:512-523`) using the exported `isThemeColor` / `isThemeFontSlug` / `isThemeAnimationSlug` from `@mingla/event-rendering` (do NOT duplicate the regex; do NOT import from `publicEventsService` — keep the hook self-contained but reuse the package guards).
- Map the trip override columns (already on `event` from `select("*")`): add `themeOverrides: ThemeInput | null` to the payload, built from `event.theme_color_override / theme_font_override / theme_animation_override`.
- **The page** (§4.3) resolves `resolveTheme(payload.brand.theme, payload.themeOverrides)` → `createThemePalette(...)`. (Resolution lives in the page/component, not the hook — mirrors `PublicEventPage` which resolves from props.)

**B2 — sold-out wiring:**
- Replace the hardcoded `ticketsRemaining: null` (`:259`) with the real per-ticket remaining, mirroring `getPublicTripById` (`publicEventsService.ts:1326,1410-1422`): call `pg_public_ticket_types_remaining` for `eventId`, fold `remaining` per `ticket_type_id` into each `TripPricingTier.ticketsRemaining`, honoring `isUnlimited` (unlimited ⇒ `null`, never "0 left"). On RPC error → fail open to `null` (no fabricated sold-out), matching the event-side `fetchTicketTypesRemaining` catch (`:823`).
- Add the RPC call to the existing `Promise.all` sidecar batch (`:118-146`) so it costs one round trip.

**Error contract:** unchanged — throw PostgrestError to the route's `isError` branch (preserve ORCH-0879 raw-message surfacing).
**Query key:** unchanged (`tripKeys.publicBySlug(brandSlug, tripSlug)`); `staleTime` unchanged (60s).

### 4.3 Layer: route (Part B3)

**File:** `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`.
- Keep the ORCH-1115 anon-route exemption note + the ORCH-0874 `orch-strict-grep-allow safearea-on-fullscreen-routes` comment (do not remove — load-bearing).
- After `payload` resolves: `const theme = resolveTheme(payload.brand.theme ?? null, payload.themeOverrides ?? null); const palette = createThemePalette(theme); const surface = resolveOfferingSurface(theme);` (all from `@mingla/event-rendering`).
- Mount the page through `TripPreview` (rebuilt §4.4) wrapped by `ParallaxCoverShell` (TripPreview itself composes the shell — see §4.4), passing `palette`/`theme`/`surface`.
- **Chrome:** the route currently renders bespoke `IconChrome` close/share overlays (`:325-346`). Replace with the foundation `OfferingChrome` (via `ParallaxCoverShell`), preserving `handleClose` (router.back → `/b/{slug}` fallback) and `handleShare` (→ `ShareModal`, NEVER the bare RN `Share.share` — ORCH-1114 dead-tap rule). Add the Mute control gated `coverMediaType==='video'`.
- **Floating bar:** keep `FloatingOfferingBar` (ORCH-1117) as the phone bar; pass `surface` so its tone matches the resolved page (use `resolveOfferingSurface`, not a hardcoded `"dark"` — the current `surface="dark"` at `:363` is replaced by the resolved value). Preserve all CTA states (`!bookable` → "Booking unavailable"; closed → "Bookings closed"; free → "Reserve my spot"; paid → price). Keep the ORCH-1130 `paymentPlanChoice` state + the deposit/full `barPrice` logic + the `plan` route param into `/checkout-trip/`.
- **Loading/error/not-found** states upgraded per §5; the error branch keeps the ORCH-0879 PostgrestError message extraction.

### 4.4 Layer: component (Part B4 + B5)

**File:** `mingla-business/src/components/trip/TripPreview.tsx` — rebuilt to the final mockup. It composes `ParallaxCoverShell` (so the wizard Step-5 preview AND the public route both get the immersive layout). The `showCta`/`onReserveTap`/`contentPadding` props are PRESERVED for wizard compatibility (wizard preview passes `showCta={false}`; the public route's Reserve action lives in the floating bar / sticky panel, not inline).

**LEFT content (children of the shell), in reading order (matches mockup):**
1. phone-only lead eyebrow (`{duration} · {group} · {region}` derived) + title — at `palette.primaryText` contrast (NOT faded accent; mockup CHANGE 3). Desktop shows these in the hero overlay instead.
2. Meta chips (`ChipGroup`-adjacent inline chips, accent-stroked icons): dates "Sep 14 – Sep 19, 2026" (`formatTripDateRange`) · derived duration "6 days · 5 nights" · seats `seats-left` at `primaryText` + capacity "N max" (sold-out → "Sold out · N of N booked") · destination location. Capacity text contrast = primary, icon = accent (mockup CHANGE v4 #3).
3. Brand "Presented by" chip (avatar + kicker + name + "View" → brand page). NO bio subline (mockup v4). Phone: in body; desktop: moves to sticky panel.
4. Route line: "Leaving from {departure}" → "Destination {destination}" (omit a leg when its field is null).
5. Collapsible About (`description`, "Read more"; omitted when empty — reuse the existing `CollapsibleDescription`).
6. **Day-by-day itinerary** — vertical accent spine (gradient rail + numbered accent dots with page-colored ring). Per day: "Day N" accent eyebrow + optional `day.date` pill + `day.title` + `day.narrative` (omit when null) + `CountAwareGallery` from `day.media`. **NO timed stops** (not authored — rule 9). Recommend collapse to first 2 days + "Show all N days" for 5+ days (mockup §B.3 / Open Q1 — default ON for 5+).
7. What's included (`ChipGroup` `yes` from `inclusions` kind=included) + What's not included (`ChipGroup` `no` from kind=excluded). Each section omitted when its list is empty.
8. Static map block (destination lat/lng) — "Where you'll be" + pin + caption. Omitted when destination lat/lng are both null (rule 9 — do NOT ship a placeholder map).
9. **Phone-only** payment block (the ORCH-1130 surface) + cancellation policy + booking-deadline strips inline in the scroll. (Refund ladder + deadline live in the LEFT column on BOTH viewports per mockup v5.)

**RIGHT sticky panel (desktop ≥1024px, passed as `stickyPanel`):** brand chip → ORCH-1130 payment block → Reserve button → reassurance line → condensed refund + deadline strips. The Reserve button + payment toggle drive the same state as the phone floating bar + inline block.

**B5 — ORCH-1130 wrap seam (additive-only):**
- `TripPaymentChoice.tsx`: add optional `palette?: ThemePalette` prop. When PRESENT, the segmented track / selected fill / dots / schedule rows / amount derive from `palette` (accent, accentWash, card, border, text). When ABSENT, render BYTE-IDENTICAL to today (the current `GlassCard`/`designSystem` tokens). Default behavior unchanged — protects `/checkout-trip/[tripEventId]/payment.tsx` + wizard Step 5.
- `TripCheckoutFlow.tsx`: add optional `palette?: ThemePalette` passthrough to `TripPaymentChoice`. Absent ⇒ unchanged. The trip page passes `palette`; the checkout-trip payment route + wizard do NOT (so they stay identical).
- **DO NOT** reimplement `projectInstallmentSchedule`, the deposit math, the schedule projection, or the segmented-control interaction. Wrap + theme only.

**Theming rule (whole component):** every accent/surface/text color reads from `palette`. No `accent.warm`, no `#0c0e12`, no raw `#ffffff`. Font: `theme.fontFamilyValue` on title / section heads / day titles / price / CTA (mockup §1.2). Android glass: translucent panels use the opaque ≥0.92 frosted fallback via `Platform.select` + `overflow:'hidden'` + no Android shadow under a rounded fill (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`).

---

## 5. Success criteria (numbered, observable, testable)

Surfaces with manual parity are split iOS / Android / Web (`-iOS`/`-Android`/`-Web`). The trip page is a single shared RN component → mostly shared; the responsive layout split is Web-vs-native.

- **SC-1 (theming).** A trip whose brand sets `theme_color=#e11d48` renders the cover spine, day dots, chips, payment accent, Reserve, and strips in the resolved crimson palette (contrast-adjusted), NOT the legacy warm orange. A trip with a per-trip `theme_color_override` uses the override over the brand color.
- **SC-2 (contrast / light page).** A light brand color (e.g. saffron) yields a LIGHT page with black-leaning text from `createThemePalette` (`primaryText==='#000000'`); every text-on-surface pair ≥4.5:1; accent-on-page ≥3.15:1; white-on-accent ≥4.5:1.
- **SC-3 (palette parity — Part A1).** `PublicEventPage` renders byte-identical before/after the extraction (RT-1 snapshot passes). `createThemePalette` is importable from `@mingla/event-rendering` and returns the same object for the same `ResolvedTheme`.
- **SC-4 (per-day itinerary, real fields only).** Each day renders ordinal/date + title + narrative (omitted when null) + a `CountAwareGallery` of `day.media`. NO timed-stop rows render for any trip. A day with 1 media item → full-width; 2 → split; 3+ → slider; 0 → no gallery node.
- **SC-5 (chips).** Included items render as ✓ accent-wash chips; not-included as ✗ muted chips; an empty inclusions list renders no section.
- **SC-6-Web (parallax + chrome).** On `/t/...` at <1024px, the cover is pinned and the body slides over it; X (top-left) + Share + Mute (top-right, Mute only when `coverMediaType==='video'`) stay fixed and tappable while scrolling (chrome z-index above cover AND content). Tapping Share opens `ShareModal` (NOT a dead tap). Tapping X → back / brand fallback.
- **SC-7-Web (desktop two-column).** At ≥1024px the page is a centered ≤1200px shell: scrolling content left, a `position:sticky` BOOKING panel right (brand chip + payment toggle + Reserve + strips); the phone floating bar is hidden.
- **SC-8-native (immersive single-column).** In-app RN renders the single-column immersive layout with `safeAreaInsets.top` padding the chrome and `safe-area-inset-bottom` honored by the floating bar; no desktop two-column on native.
- **SC-9 (ORCH-1130 wrap is additive).** With `palette` passed, the payment block matches the trip palette. With `palette` ABSENT (checkout-trip payment route + wizard Step 5), the payment block + checkout flow render byte-identical to pre-ORCH-1138 (RT-2 gate).
- **SC-10 (sold-out wiring).** When `pg_public_ticket_types_remaining` returns 0 for the trip's ticket type, the page shows the sold-out banner + "Sold out · N of N booked" capacity + the floating bar / Reserve becomes the non-tappable "Sold out" strip. When the RPC errors, the page degrades to no-sold-out (fail-open), never a fabricated "Sold out".
- **SC-11 (every state).** Loading → skeleton (cover shimmer + title + 3 meta bars + 2 day-card bars + price bar), not a bare spinner. Error → "Couldn't load trip" + the real PostgrestError message + retry. Not-found → "Trip not found …". No-cover → flat accent-hue hero. Bookings closed → red banner + non-tappable bar (ORCH-0875). Deadline near → accent countdown (ORCH-0875). Not bookable → "Booking unavailable — the organizer is finishing payment setup" (ORCH-1117). Installments on/off → headline number + subline + schedule visibility + bar price swap together. Theme absent → `MINGLA_DEFAULT_THEME` (`#eb7825`/inter/none).
- **SC-12 (currency).** Prices use the trip tier currency via `Intl.NumberFormat` (no hardcoded `£`/`$`/GBP). Free trips show "Free" + no all-in line + "Reserve my spot".
- **SC-13 (no dead taps).** Every tappable (chrome, brand "View", Reserve, payment segments, Read more, day expand, map) has a real handler + a11y label; none is a no-op.
- **SC-14 (foundation fit — design-review gate, NOT an implementation).** The four primitive prop contracts (§4.1) cover, on paper, the event ticket panel, the experience date-pick+book panel, and the brand summary panel (verified against `EVENT_/EXPERIENCE_/BRAND_DIRECTION_A_RESPONSIVE.html`). Confirmed in the implementation report; no event/experience/brand code is written.

---

## 6. Proposed shared-module location + names

- **Palette (Part A1):** `packages/event-rendering/themePalette.ts` — stays inside `@mingla/event-rendering` (it is the event page's own engine; trips/experiences/brands already import theming from this package). Exports: `createThemePalette`, `ThemePalette`, (optionally `resolveOfferingSurface`).
- **Primitives (Part A2):** NEW package `packages/offering-rendering/` (`@mingla/offering-rendering`). Rationale: a new package (not folding into `@mingla/event-rendering`) because (a) these primitives are offering-generic (trip/experience/brand are not "events"), (b) it keeps the event package's surface from ballooning, (c) it can depend on `@mingla/event-rendering` for the palette + cover + animation without circularity. Mirrors the existing `packages/brand-rendering/` precedent (a sibling rendering package). Exports: `ParallaxCoverShell`, `OfferingChrome`, `CountAwareGallery`, `ChipGroup`, `offeringSurfaceStyles`, `resolveOfferingSurface` (re-export), plus their prop types.
  - *(Alternative if the implementor finds the new-package wiring heavy: place the primitives in `packages/event-rendering/` under an `offering/` subfolder and export from its index. This is an OPEN QUESTION — §10 Q1. Default = new `@mingla/offering-rendering` package.)*

---

## 7. Invariants

**Preserved:**
- **I-MOR-0827-PACKAGE-ISOLATION** — both `themePalette.ts` and the new `@mingla/offering-rendering` package import NO app `src/`; all data via props. Verified by the existing package-isolation gate + a grep in RT-3.
- **I-ORCH-1006 all-in / WYSIWYP** — prices shown are server-computed all-in; the trip page never recomputes fees (reads `priceCents` / the projected schedule). No buyer tax/address form (ORCH-1130 removed it; do not reintroduce).
- **ANDROID_GLASS_USES_OPAQUE_FALLBACK** — translucent panels use the opaque Android fallback.
- **Constitution #9 (no fabricated data)** — no timed stops, no trip-level gallery, no placeholder map, no fabricated sold-out; brand bio not rendered.
- **ORCH-1114 (no dead-tap share)** — Share routes through `ShareModal`.
- **ORCH-1115 (anon route allowlist)** — `/t/` stays exempt from the root auth gate; the route adds no `useAuth`.
- **ORCH-0879 (raw PostgrestError surfacing)** — error state shows the real message.

**Proposed (DRAFT — flip ACTIVE at CLOSE; orchestrator owns the flip):**
- **I-PROPOSED-1138-SINGLE-PALETTE-SOURCE** (DRAFT) — all four public offering pages (trip/event/experience/brand) MUST derive their accent/surface/text colors from `createThemePalette` (the single exported engine in `@mingla/event-rendering`). No page may define a second contrast/light-dark palette algorithm or use raw `accent.warm`/`#0c0e12`/`#ffffff` for themed surfaces. (Leg 1 establishes it for trip + event; later legs extend to experience + brand.)
- **I-PROPOSED-1138-ADDITIVE-PALETTE-PROP** (DRAFT) — the ORCH-1130 payment components (`TripPaymentChoice`/`TripCheckoutFlow`) accept `palette` as OPTIONAL; absent ⇒ byte-identical pre-1138 output. A future change may NOT make `palette` required without re-theming every consumer.
- **I-PROPOSED-1138-NO-FABRICATED-TRIP-FIELDS** (DRAFT) — the public trip page renders ONLY real model fields: per-day items (ordinal/date/title/narrative/media), inclusions, route legs, destination map (only when lat/lng present). It MUST NOT render timed stops, a trip-level gallery, a brand bio, or a placeholder map.

---

## 8. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 | Brand theme applied | brand `theme_color=#e11d48` | crimson palette across spine/chips/Reserve | component |
| T-2 | Trip override wins | brand teal + trip `theme_color_override=#6d28d9` | violet palette | hook+component |
| T-3 | Light page contrast | brand `theme_color=#f5c518` | light page, black-leaning text, all pairs ≥4.5:1 | palette |
| T-4 | Palette parity (revert gate) | run RT-1 against pre-extraction snapshot | identical PublicEventPage output | package |
| T-5 | Gallery 1/2/3+ | days with 1, 2, 3 media | full / split / slider | primitive |
| T-6 | Gallery empty | day with `media:[]` | no gallery node | primitive |
| T-7 | No timed stops | trip with `trip_days.stops` populated | NO stop rows render | component |
| T-8 | Chips | inclusions included+excluded | ✓ chips + ✗ chips; glyph carries meaning | primitive |
| T-9 | Parallax chrome (web) | scroll `/t/...` <1024px | chrome fixed + tappable over cover+content | route (web) |
| T-10 | Desktop two-column | `/t/...` ≥1024px | sticky booking panel right, no floating bar | route (web) |
| T-11 | Share not dead | tap Share on web | `ShareModal` opens | route |
| T-12 | Payment wrap additive | render `/checkout-trip/.../payment` (no palette) | byte-identical to pre-1138 (RT-2) | component |
| T-13 | Payment themed | trip page passes palette | payment block matches trip palette | component |
| T-14 | Sold out | remaining RPC → 0 | sold-out banner + non-tappable bar | hook+route |
| T-15 | Sold-out RPC error | RPC throws | fail-open, NO fabricated sold-out | hook |
| T-16 | Free trip | tier `priceCents=0` | "Free", no all-in line, "Reserve my spot" | route+component |
| T-17 | Not bookable | `bookable=false` | "Booking unavailable …" non-tappable | route |
| T-18 | Bookings closed | `bookingsClosed=true` | red banner + non-tappable bar | route |
| T-19 | No cover | `coverMediaUrl=null` | flat accent-hue hero, title legible | primitive |
| T-20 | Theme absent | brand+trip theme all null | `MINGLA_DEFAULT_THEME` (#eb7825) | hook+component |
| T-21 | Currency | tier currency EUR | "€2,450" via Intl, no GBP/USD hardcode | component |
| T-22 | Package isolation | grep new package for `../../src` | zero matches (RT-3) | package |

---

## 9. Regression prevention (fails-on-revert contract)

- **RT-1 — palette parity snapshot (Part A1 gate).** A test in `packages/event-rendering/` that renders `PublicEventPage` (or directly snapshots `createThemePalette` output) across a fixed matrix of `ResolvedTheme` inputs (dark accent, light accent, default, edge low-contrast). It MUST PASS with the extracted module and FAIL if `createThemePalette` is altered (drift). Protective comment: "ORCH-1138 A1 — createThemePalette was extracted from PublicEventPage behavior-neutrally; this snapshot fails on any palette-algorithm drift." Fails-on-revert: reverting the extraction (or changing a color-math helper) flips a snapshot value.
- **RT-2 — ORCH-1130 additive-prop gate.** A test rendering `TripPaymentChoice` + `TripCheckoutFlow` WITHOUT `palette` and asserting the output (segment styles / amount markup) matches a snapshot captured from pre-ORCH-1138 main. MUST FAIL if a future edit makes `palette` non-optional or changes the no-palette render. Protective comment cites I-PROPOSED-1138-ADDITIVE-PALETTE-PROP.
- **RT-3 — package isolation grep.** Extend the existing isolation gate (or add one) to assert `packages/offering-rendering/` and `packages/event-rendering/themePalette.ts` contain no `from "../../`/app-`src/` imports. Fails-on-revert: a stray app import flips it red.
- **RT-4 — no-fabricated-trip-fields structural gate.** A grep/AST test asserting `TripPreview.tsx` contains no `stops`-row rendering and no trip-level gallery markup (cites I-PROPOSED-1138-NO-FABRICATED-TRIP-FIELDS).

Implementor delivers the happy-path tests (T-1..T-22 representative subset) + RT-1..RT-4 with fails-on-revert proven. Tester adds an adversarial angle (§11).

---

## 10. Open questions for Seth (resolve before/at IMPLEMENT)

1. **Primitive home:** new package `@mingla/offering-rendering` (default, §6) vs an `offering/` subfolder inside `@mingla/event-rendering`? The new package is cleaner long-term; the subfolder is faster to wire. Recommend the new package.
2. **Long-itinerary collapse:** collapse to first 2 days + "Show all N days" for 5+ days (mockup Open Q1, recommend YES) — confirm.
3. **Multi-tier trips:** stays out of scope (only `tiers[0]` rendered). Confirm — if multi-tier ships later, the booking panel needs a tier selector above the pay toggle (separate ORCH).
4. **Cover Mute on real audio:** the chrome Mute toggles `EventCoverMedia`'s muted state only (no new audio engine). Confirm that's the intended scope.

(All four have a recommended default; none blocks writing the spec. Q1 is the only one the implementor needs answered before the first commit; the rest are confirm-or-redirect.)

---

## 11. Downstream routing

**Next = mingla-implementor (business side).** Build Part A (palette extraction + RT-1; the `@mingla/offering-rendering` primitives + RT-3) THEN Part B (trip hook fetch+sold-out; the route + `TripPreview` rebuild; the ORCH-1130 additive wrap + RT-2; RT-4). Allowlist + do-not-touch in §12. Then → **mingla-tester** (adversarial: prove the event page is byte-identical post-extraction on a real device/web; prove `/checkout-trip/payment` is unchanged; flip every state on `/t/...`; verify contrast on a light-brand trip; confirm sold-out fail-open). Then → **mingla-orchestrator** CLOSE (flip the I-PROPOSED-1138-* invariants ACTIVE; World Map; OTA/deploy decision).

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`.

---

## 12. Scoped allowlist + DO-NOT-TOUCH

**ALLOWLIST (implementor may create/modify):**
- `packages/event-rendering/themePalette.ts` (NEW)
- `packages/event-rendering/PublicEventPage.tsx` (extraction only — remove moved decls, add imports; NO render change)
- `packages/event-rendering/index.ts` (add exports)
- `packages/offering-rendering/**` (NEW package: primitives + package.json + tsconfig + index)
- `mingla-business/src/hooks/usePublicTripBySlug.ts` (theme fetch+map; sold-out wiring)
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (theme resolve; foundation chrome; surface)
- `mingla-business/src/components/trip/TripPreview.tsx` (rebuild on the foundation)
- `mingla-business/src/components/trip/TripPaymentChoice.tsx` (ADD optional `palette` prop — additive only)
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (ADD optional `palette` passthrough — additive only)
- Test files for RT-1..RT-4 + T-* in the appropriate `__tests__/` dirs.
- Workspace wiring needed to register `@mingla/offering-rendering` (root `package.json` workspaces / tsconfig paths / metro config) — ONLY the entries needed to resolve the new package.

**DO-NOT-TOUCH (stop-and-amend before changing):**
- Any migration / `supabase/` / RLS / edge function / view (this leg is render-only).
- `business_public_events_view` or any DB object.
- The EVENT page render output (`PublicEventPage.tsx` beyond the behavior-neutral extraction), the EVENT/EXPERIENCE/BRAND routes + adapters + services.
- `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` and the wizard Step-5 caller (they MUST continue to pass NO `palette` and render unchanged — protected by RT-2; do not edit them).
- `projectInstallmentSchedule` / `installmentScheduleProjection.ts` / the deposit math / the checkout RPC chain.
- `usePublicTripById.ts` / `getPublicTripById` (the checkout-by-id path — already wired; do not refactor it for this leg).
- The ORCH-1130 payment IA (wrap + theme only; never respec).

Any change outside the allowlist requires a SPEC amendment (append in-file or `SPEC_AMENDMENT_ORCH-1138_*.md`) before proceeding.

---

## 13. SPEC AMENDMENT A-1 (implementor, 2026-06-15) — append-only test repoint for the A1 extraction

**Trigger:** Part A1 (§4.0) deletes `createThemePalette` + the color-math helpers (`contrastAdjustedAccent`, `contrastAdjustedForWhiteText`, …) FROM `packages/event-rendering/PublicEventPage.tsx` and moves them VERBATIM into `packages/event-rendering/themePalette.ts`. An existing regression test source-string-asserts those three declarations live INSIDE `PublicEventPage.tsx`:

- `mingla-business/src/components/brand/__tests__/PublicEventPage.orch_0964_design_rework.test.ts` lines 33–38:
  - `expect(sharedSource).toContain("const createThemePalette = (theme: ResolvedTheme)")`
  - `expect(sharedSource).toContain("const contrastAdjustedAccent = (")`
  - `expect(sharedSource).toContain("const contrastAdjustedForWhiteText = (")`

These three string assertions are now FALSE for `PublicEventPage.tsx` (the declarations moved) — a behavior-neutral relocation, NOT a render change. The test still verifies the SAME guarantee, just against the new module home.

**Authorized change (outside §12 allowlist, hence this amendment):** Re-point ONLY those three assertions to read `packages/event-rendering/themePalette.ts` (a new `paletteSource = repoFile("packages/event-rendering/themePalette.ts")` const + assert the three declarations there). All OTHER assertions in that test (the render/style/usage strings that REMAIN in `PublicEventPage.tsx`, e.g. `const palette = useMemo(() => createThemePalette(theme)`, `type ThemePalette` in the import, `backgroundColor: palette.page`) are UNCHANGED. This is a modification-with-deletion of an existing test → carries `[TEST-MOD-APPROVED ORCH-1138]` in the commit body per `tests-append-only.yml`.

**Not affected (verified):** `PublicBrandPage.orch_0964_smoke_rework.test.ts` asserts against `packages/brand-rendering/PublicBrandPage.tsx` (its OWN palette copy — untouched by this leg). `offeringLegibility.orch1117.test.ts` asserts only USAGE strings in `PublicEventPage.tsx`'s render body (which remain). `eventCoverMedia.test.ts` does not assert moved symbols.

**Behavior guarantee:** RT-1 (§9) independently snapshots `createThemePalette` output across a fixed `ResolvedTheme` matrix — that is the real fails-on-revert gate for byte-identical palette output. The repointed string assertions are structural only.

---

## 14. SPEC AMENDMENT A-2 (implementor, 2026-06-15) — route chrome migration (IconChrome → OfferingChrome) test repoint

**Trigger:** §4.3 binds the route to "Replace [the bespoke `IconChrome` close/share overlays] with the foundation `OfferingChrome` (via `ParallaxCoverShell`)". The `/t/[brandSlug]/[tripSlug].tsx` route no longer renders `<IconChrome icon="close"/share>` + the `closeOverlay`/`shareOverlay` absolute styles; instead it threads `onClose={handleClose}` + `onShare={handleShare}` into `TripPreview`, which renders the chrome through `OfferingChrome` (a11y labels "Close" / "Share", preserved). Two existing route-source assertions asserted the OLD IconChrome markup and were GREEN on origin/main; they now (correctly) fail because the redesign removed that markup:

- `mingla-business/src/components/trip/__tests__/TripVisualParity.test.ts` SC-17 ("X-close + share IconChrome overlays on cover hero").
- `mingla-business/src/components/trip/__tests__/TripVisualParity_adversarial.test.ts` A-11 ("public trip page X-close + share IconChromes have accessibilityLabel").

**Authorized change (outside §12 allowlist, hence this amendment):** Repoint ONLY these two route-chrome assertions to verify the SAME guarantee against the new foundation: the route threads `onClose`/`onShare` into `TripPreview`, and `OfferingChrome` (the shared chrome) carries the "Close"/"Share" accessibility labels. The close handler (`router.canGoBack()`/`back()`/`/b/{brandSlug}` fallback) and share handler (→ `ShareModal`, never bare `Share.share`) are UNCHANGED and still asserted. All OTHER assertions in both files are untouched. Modification-with-deletion → carries `[TEST-MOD-APPROVED ORCH-1138]` in the commit body.

**Not a behavior regression:** the close + share affordances are preserved (the foundation chrome replaces the bespoke overlays one-for-one); ORCH-1114 (ShareModal, no dead-tap) and ORCH-1115 (anon-route, no useAuth) postures are unchanged and still asserted by their own (untouched) tests.

**Pre-existing baseline note (NOT touched by this leg):** the wider trip test corpus is broadly red on origin/main already (e.g. `TripVisualParity` SC-01/SC-14 IconChrome-wizard assertions, the `Share.share()` legacy-API assertion at SC line 304 already failing post-ORCH-1114, `tripsService.test`, `PaymentPlanEditor`, `PublicEventPage.orch_0964_design_rework` BlurView/recurrence assertions). A clean origin/main baseline run of the trip suspect-suite set yields 66 failing tests; this leg yields 68 — the delta is EXACTLY the two SC-17/A-11 chrome assertions repointed above. No other test regressed.

---

## 15. SPEC AMENDMENT A-3 (implementor, 2026-06-15) — native-only render fixes (meta-chips/route data source + weight-aware bold font)

**Trigger:** Seth re-confirmed on the business iOS dev build that, AFTER the R2 parity pass, two things are still wrong on NATIVE (correct on react-native-web): (BUG-1) the "N seats left · M max" chip, the "📍 destination" chip, and the destination half of the "Leaving from → Destination" route block do not render; (BUG-2) text the mockup shows bold renders at regular/medium weight. R2 source-only analysis mis-attributed BUG-1 to rule-9 null-hiding and declared the route "already at parity" — both wrong. Forensic DB read (`events` row "The DC Adventure", id `060d0483…`) proved the divergence:

- **BUG-1 ROOT CAUSE — `mingla-business/src/hooks/usePublicTripBySlug.ts`.** The public hook mapped `businessTrip.destinationLocationText` and `businessTrip.capacity` ONLY from the `events.theme.business_trip` JSON mirror, which is **NULL** for trips authored via the canonical columns (DC Adventure: `theme.business_trip.destinationLocationText = null`, `.capacity = null`, while `events.destination_text = "Washington, …"` and `ticket_types[0].quantity_total = 102`). The authenticated path's `readBusinessTrip` (`tripsService.ts:448,461`) already reads canonical-first; the public hook did NOT (it only did so for `departureLocationText` — which is why departure rendered and the other two/route-destination did not). NOT a native-vs-web RENDER divergence — a shared-hook DATA-MAPPING gap; the web evidence was captured against a data state where the mirror was populated. Fix makes BOTH platforms correct.
  **Fix (in §12 allowlist):** `destinationLocationText` ← `events.destination_text` first (theme mirror fallback); `capacity` ← `ticket_types[0].quantity_total` first (theme mirror fallback) — mirroring `readBusinessTrip` exactly.

- **BUG-2 ROOT CAUSE — `FONT_FAMILY_MAP` (designTokens.ts:127) loads exactly ONE non-bold variant per theme font** (e.g. `Inter_500Medium`); TripPreview/route set `fontFamily: <medium>` + `fontWeight:"900"`. On iOS/Android a LOADED CUSTOM font ignores `fontWeight` → renders at medium; react-native-web synthesizes bold from `font-weight` → looked correct on web (native-only). Fix: a weight-aware family resolver `boldFontFamily(theme)` + `FONT_FAMILY_BOLD_MAP` (NEW, in `packages/event-rendering/themePalette.ts` — in allowlist; exported via `index.ts` — in allowlist) mapping each slug → its `*_700Bold` loaded family (the 3 single-weight display faces — DM Serif Display, Bebas Neue, Anton — have no published bold and fall back to their base family). Every bold element on the trip page (title, hero title, section headings, brand name, day titles, chip VALUES, route place VALUES, payment amount, reserve price/CTA) now sets `fontFamily: boldFamily`.

**Authorized change (outside §12 allowlist, hence this amendment):**
- `mingla-business/src/theme/themeFonts.ts` — ADD the 11 `*_700Bold` dynamic-`import()` thunks to `THEME_FONT_MODULE_THUNKS` so the bold faces are loadable on demand via the EXISTING `useThemeFont`/`loadThemeFont` mechanism (same ORCH-1083 boot-budget deferral as the medium thunks; `useThemeFont.ts` is UNCHANGED — it already loads any registered family). Without registering the bold thunk, `useThemeFont(boldFamily)` is a no-op and native keeps the system fallback. Additive-only (no existing thunk modified/removed). This is the single out-of-allowlist FILE; it is the canonical home for the load thunks (a route-local loader would fork the registry).

**Not a behavior regression:** `useThemeFont(theme.fontFamilyValue)` (the medium load, RT-5 #1) is preserved verbatim; the bold load is additive (`useThemeFont(boldFamily)` alongside). Protected callers (checkout payment / wizard Step-5) pass NO palette → LEGACY path → never touch `boldFontFamily` → byte-identical. No schema/edge/migration/dependency change.
