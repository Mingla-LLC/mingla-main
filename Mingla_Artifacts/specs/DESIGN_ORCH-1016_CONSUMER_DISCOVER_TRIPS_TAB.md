# DESIGN — ORCH-1016 [Consumer Discover Trips tab]

> **ORCHESTRATOR RESOLUTIONS (2026-05-30, pre-IMPLEMENT) — binding on the implementor:**
> The DESIGN flagged 5 underspecified items. Resolved by the orchestrator (all technical/copy, no scope change):
> 1. **Null-cover hue source → HASH `tripId` CLIENT-SIDE.** Do NOT add `cover_hue` to the RPC (keeps the RPC lean + migration smaller). Use the same deterministic hash-hue helper pattern already used for fallback bands elsewhere; seed = `tripId`.
> 2. **`formatTripDateRange` → EXTRACT TO SHARED.** Move it into the shared `@mingla/event-rendering` package (or the existing shared util it lives nearest) and consume from BOTH business + app-mobile. No divergent reimplementation.
> 3. **`RefundPolicyDisplay` → EXTRACT TO `@mingla/event-rendering`.** Shared, so consumer + business never drift. Business side becomes a re-export shim (same pattern as `EventCoverMedia` per COMMS-0007 / `feedback_eventcovermedia_shared_package`).
> 4. **Default sort label → "Newest".** NOT "Recommended" (no proximity/personalization is computed in C1 — "Recommended" would overpromise / read as AI-slop). Sort options: **Newest** (default) · Oldest · Price (low→high) · Price (high→low). The RPC's `relevance` mode = newest-first backs the "Newest" label. (Seth may override this one copy choice at the checkpoint.)
> 5. **Empty-state "Browse events" CTA → THREAD the tab setter.** Pass the Discover `setActiveTab('events')` setter into the Trips content so the empty-state button switches tabs in-place.
>
> **Mode:** SCREEN + COMPONENT (pixel-precise visual + UX contract). NO product code.
> **Worktree:** `~/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]/` on branch `ORCH-1016-consumer-discover-trips-tab`. Metro port 8087.
> **Binding inputs:** `SPEC_ORCH-1016_CONSUMER_DISCOVER_TRIPS_TAB.md` (🔒/🎨 contract) + `INVESTIGATION_ORCH-1016_CONSUMER_DISCOVER_TRIPS_TAB.md`.
> **Scope of this doc:** the 7 🎨 OPEN items in SPEC §17. Every 🔒 LOCKED requirement is honored verbatim, never re-opened.
> **Date:** 2026-05-30. **Author:** mingla-designer.

---

## 0. Comms Ledger (read on entry — acks)

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. No OPEN row is addressed `to` `mingla-designer` or to `ORCH-1016`. The active rows (COMMS-0001…0014) target Stripe/edge/intake/checkout phases and are already acked by the SPEC (§0). This is a visual+UX design pass — it introduces no migration, no edge fn, no Stripe payload, no external-API enum. Nothing to ack; no new cross-ORCH discovery. FYI/WARN rows read and continued.

---

## 1. References examined

Studied the real premium patterns for the two hard moments here — a tabbed discovery surface and a travel/marketplace card+filter feed — then synthesized Mingla-native work. **Reference pass performed against documented patterns + the live Mingla codebase; external web fetch was not run this turn (flagged — a pre-implementation web pull on Airbnb/Hinge current screens is optional polish, not blocking, because the card/filter/detail mechanics are already proven inside this repo).**

- **Mingla `LikesPage.tsx`** (read in full) — the LOCKED spotlight-pill tab pattern. I compose strictly within its geometry (`PILL_BAR_HEIGHT=52`, `HEADER_PANEL_RADIUS=28`, orange spotlight spring, glass `BlurView` + Android opaque fallback). The Trips tab inherits this byte-for-byte; I only decide what sits *below* the pill.
- **Mingla `DiscoverScreen.tsx`** header + grid (read L1880–2008 + the `glass.discover.*` token block) — the existing large-title + horizontal-chip-row + pinned-Filters header, the 2-col grid (`aspectRatio 0.72`, `radius 24`), `BusinessEventCard` glass info-chip card. The Trips feed reuses this exact card visual language so Events and Trips feel like one product.
- **Mingla `BusinessEventCard.tsx`** (read in full) — the canonical Discover card: full-bleed `EventCoverMedia` hero + bottom glass info-chip + top-right pill. The TripCard is its sibling, not a new species.
- **Mingla business `t/[brandSlug]/[tripSlug].tsx` + `TripPreview.tsx`** (read) — the trip-detail structure to mirror: full-bleed cover hero, X-close/share `IconChrome` overlays, closed-banner / countdown-pill / refund-ladder, day-by-day itinerary, inclusions, tiers, Reserve CTA.
- **Airbnb Experiences / Dice / Posh (documented patterns, from prior premium-craft research in this repo):** travel/event feeds lead with the cover, stack a one-line "where + when" meta under the title, keep price bottom-anchored, and use a thin chip row (destination, dates, price, group) above an infinite scroll — never a dense form. Group-size and departure are secondary chips, not primary. This anchors the TripCard hierarchy (cover → title → when/where → price+spots) and the chip order.

Anti-slop applied throughout: no gradient blobs (only the existing photo-legibility overlay), no stock imagery (null cover = the existing `EventCover` hue band, never a fake photo), no emoji icons (Ionicons set only), no decorative effects (every shadow/blur is the existing chrome token).

---

## 2. The moment (IA foundation)

A consumer opens Discover wanting **one of two different jobs**:
- **Events** — "what's happening near me, soon" — a dense, browse-many, low-commitment grid (today's surface, UNCHANGED).
- **Trips** — "I want to *go somewhere* with a group" — a higher-commitment, fewer-results, read-then-reserve feed.

These are different cognitive tasks, so the pill switcher is correct IA: it lets the same surface serve two intents without a mode-confusion. The design job is to make the switch feel weightless and to make each tab's filter affordances match its job (Events = "near me + when"; Trips = "where + when + how much + how many").

**One-glance hierarchy on a TripCard:** the cover sells the place → the title names it → "to {destination}" + dates answer "where/when" → price + spots answer "can I / should I now". Planner + verified badge are trust signals, not headline. Departure is a helpful detail, not a headline.

---

## 🎨 ITEM 1 — Header IA composition (the biggest decision)

### 1.1 Resolved decision (one line)
**Shared pill header for both tabs; the filter row is PER-TAB and lives in the SCROLL body (not pinned in the glass header), so the glass header is identical across tabs and only its content below the pill changes.**

### 1.2 Why
The LOCKED Likes header is `title (36) → pill (52)` and ends there — it has no filter row. The existing Discover header is `title (36) → filter bar (52)`. Naively stacking both (`title → pill → filter bar`) pushes the grid down ~52pt and makes the glass header tall and top-heavy on a 375pt phone. Pinning two different filter rows inside the glass header also forces the Events-tab regression surface (the existing pinned filter bar + its `LinearGradient` fades + city picker) to be restructured — a risk the SPEC explicitly protects against (SC-12).

So: **the glass header band is JUST `title → pill`** (the Likes geometry, unchanged). Each tab's filters render as the **first scrolling row of that tab's own content**, sticky-under-the-header via the tab's own scroll container. This keeps the Events tab's existing filter bar exactly where its code already puts it (no header surgery → SC-12 safe), gives Trips its own independent `TripFilterChips` row, and keeps the glass header calm and consistent.

### 1.3 Exact stack + tokens (🔒 geometry from `LikesPage`, do not alter)

```
[ status bar / safe area: insets.top ]
[ TITLE BAND ]   top = insets.top + glass.chrome.row.topInset (2)   height = 36
                 title "Discover", glass.discover.title (fontSize 32, weight 700, #FFFFFF)
[ PILL BAR  ]   top = TITLE_TOP + 36   height = 52   (capsule height 44, radius 24)
                 [ Events ] [ Trips ]   orange spotlight spring
[ HEADER_PANEL_HEIGHT = PILL_BAR_TOP + 52 + 4 ]   borderBottomRadius 28, glass blur + Android opaque fallback
─────────────────────────────────────────────
[ TAB CONTENT — scrolls under the header panel; paddingTop = HEADER_PANEL_HEIGHT + 8 ]
   Events tab → existing filter bar (UNCHANGED, its own pinned-in-content position) + 2-col grid
   Trips tab  → TripFilterChips row (sticky at content-top) + TripCard list
```

- Title string: `discover:title` → **"Discover"** (EN-only, 🔒 SPEC §E.1). Token `glass.discover.title`.
- Pill labels: `discover:events_tab` → "Events", `discover:trips_tab` → "Trips".
- **Tab icons (🎨 LOCKED here, from the existing Ionicons set — no new asset, no emoji):**
  - Events → **`sparkles-outline`** (size 16) — "what's happening", matches the lively-events intent; distinct from the Trips glyph.
  - Trips → **`compass-outline`** (size 16) — the universal "go somewhere / explore" glyph; reads instantly as travel, is in the set, and is NOT a literal suitcase (avoids the business-trip connotation). Rejected alternatives: `airplane` (too literal/flight-only, not in set as outline), `briefcase-outline` (reads "work"), `map-outline` (reads "navigation, not journeys").
  - Active icon color `glass.chrome.active.iconColor` (#FFFFFF); inactive `glass.chrome.inactive.iconColor` (rgba 255×.65). Labels: active `glass.chrome.active.labelColor` #FFFFFF weight 600; inactive `glass.chrome.inactive.labelColor` rgba 255×.55. (All 🔒 from LikesPage `tabLabelActive/Inactive`.)
- **Spacing/safe-area:** content `paddingTop = HEADER_PANEL_HEIGHT + 8` (LikesPage value), `paddingBottom = bottomNavTotalHeight + 16` (clears the glass bottom nav). The Trips filter row sits at the very top of the Trips scroll content with `paddingTop = 8` inside that, so it clears the header hairline by `space.sm`.

### 1.4 Per-tab filter behavior
- **Events tab:** keeps its existing filter bar (city chip + date chips + pinned Filters button) EXACTLY as today (🔒 regression SC-12). Designer touches nothing here.
- **Trips tab:** renders `TripFilterChips` (Item 3) as a horizontal-scroll row pinned at the top of the Trips content, visually echoing the Events filter bar (same chip height 36, radius 18, same `glass.discover.chip` tokens) so the two tabs feel like siblings — but with the trip-specific chip set.

### 1.5 Selection persistence + a11y
- `discoverActiveTab` / `setDiscoverActiveTab` Zustand slot (🔒 mirrors `likesActiveTab`). On tab change: `Haptics.impactAsync(Medium)` (iOS) + `mixpanelService.trackTabViewed({ screen:'discover', tab })`.
- Each pill: `accessibilityRole="tab"`, `accessibilityLabel` = the label, `accessibilityState={{selected}}` (🔒 LikesPage). Reading order: title → Events tab → Trips tab → active content.
- **Reduced motion:** spotlight `setValue` instant (🔒 LikesPage `reduceMotion` branch).

---

## 🎨 ITEM 2 — TripCard layout

### 2.1 Layout choice (one line)
**Full-bleed cover card with a single bottom glass info-stack — the same species as `BusinessEventCard`, but ONE-PER-ROW (full content width) and taller, because a trip is a considered, read-more decision (fewer results, richer meta) — not a browse-many grid cell.**

Rationale: Events are scanned 2-up; Trips are weighed one at a time. A single-column, larger card gives the cover room to sell the destination and the info-stack room for the extra trip-only lines (departure, price-from, spots) without crowding. This matches Airbnb-Experiences / Dice list cards (cover-led, one per row, bottom-anchored price). It is still visually the Discover card family (cover + bottom glass chip + top pill), so the two tabs cohere.

### 2.2 Anatomy + exact tokens

Container:
- Width: full content width = screen − 2× `glass.discover.grid.horizontalPadding` (16) → e.g. 343pt @ 375. One column.
- **Aspect ratio: 1.45 : 1 (width : height)** → ~343×237 @ 375. (Cover-dominant but shorter than the 0.72 portrait grid cell, because it's wider and single-column.) Use `aspectRatio` so it scales 375/390/430 with no horizontal scroll.
- Corner radius: **`glass.discover.card.radius` = 24**; `overflow:'hidden'` (clips cover + Android glass — 🔒 ANDROID_GLASS_USES_OPAQUE_FALLBACK).
- Row gap between cards: `glass.discover.grid.rowGap` = 12. Bottom clearance: `glass.discover.grid.bottomClearance` = 120.
- Shadow (iOS only): `glass.discover.card.shadow` (offset 0/4, opacity 0.25, radius 12). **Android: NO shadow under the rounded fill** (🔒 policy) — Android elevation 0, rely on the opaque card fill for separation.
- Press feedback: scale `glass.discover.card.pressScale` 0.97 over `pressDurationMs` 100 — non-shifting (transform only, no reflow). `Haptics.selectionAsync()` on press (mirror BusinessEventCard).

Cover (top, full-bleed):
- `EventCoverMedia` (🔒 shared `@mingla/event-rendering`) `style={StyleSheet.absoluteFill}`, `radius={24}`, `videoContentFit="cover"`, `hue={trip.coverHue}` (derive from `trip.tripId` hash if the RPC doesn't return a hue — the shared `EventCover` already hashes), `mediaUrl={trip.coverMediaUrl}`, `mediaType={trip.coverMediaType}`, `label={trip.title}`.
- **Null/failed cover (🔒 NEVER a fake image):** the shared `EventCover` hue band (`hsl(hue,60%,45%)`) renders automatically — same neutral placeholder the Events grid uses. No "No cover image" text, no stock art.
- Wrap the cover in a `pointerEvents="none"` View (🔒 so the card's tap gesture fires over video covers — the META-ORCH-0991 Bug 3a pattern from BusinessEventCard).
- Photo-legibility overlay: a bottom-anchored linear gradient `glass.discover.card.gradient` (transparent → rgba(0,0,0,0.7), startY 0.35) so the bottom info-stack stays legible over any cover. (This is a legibility gradient, not decoration — allowed.)

Top-left status badge (conditional, reuses `glass.discover.card.topBadge` tokens — height 20, radius 10, inset 8/8):
- **"Closing soon"** when `bookingDeadline` is within 72h and in the future → amber-tinted text, glass fill. (The feed already excludes past/closed, so the only deadline state on a card is "open" or "closing soon".) Hidden otherwise.
- Only ONE top badge max; if no deadline pressure, no badge.

Bottom info-stack (glass chip, full width minus insets — reuses `glass.discover.card.bottomChip` tokens: radius 14, inset 10, paddingH 12 / paddingV 10, Android opaque fallback fill `rgba(16,18,22,0.88)`):
Vertical order (top→bottom), `gap` between lines = `space.xs` (4):

1. **Title** — `bottomChip.titleFontSize` 14 (bump to **16 / weight 700** for the larger single-column card — title is the second-most-important after the cover), color #FFFFFF, `numberOfLines={2}`, lineHeight 20.
2. **When + where line** (one row, `·` separated, `numberOfLines={1}`):
   - Dates: `calendar-outline` 13 + formatted range (reuse the consumer `formatEventDateChip`/business `formatTripDateRange` — 🔒 no new date lib). Conditional: hide the whole segment if both `startAt`/`endAt` null.
   - Separator ` · ` (rgba 255×.55) only when both segments present.
   - Destination: `navigate-outline` 13 + "to {destinationText}". Conditional: hide if null.
   - Meta color `bottomChip.metaColor` rgba(255,255,255,0.72), fontSize 11, lineHeight 14, weight 500.
3. **"Leaving from {departureText}" line** (🔒 conditional — render ONLY when `departureText !== null`; see Item 4 for the exact treatment). Its own row below when/where; same meta type ramp; `paper-plane-outline` 12 icon. NEVER an empty line.
4. **Planner + price row** (one row, `space.sm` between the two clusters, `justifyContent:'space-between'`):
   - Left cluster: planner name `brandName` (fontSize 11, weight 500, rgba 255×.72, `numberOfLines={1}`, `flexShrink:1`) + **verified badge** (Item 2.3) inline-right of the name, ONLY when `brandVerified === true`.
   - Right cluster (price + spots, right-aligned, no wrap):
     - **Price-from:** `minPriceCents` formatted in `currency` (currency-aware, 🔒 Constitution rule 10) → "From $500" (fontSize 13, weight 700, #FFFFFF). If `minPriceCents` null AND `hasFreeTier` → "Free". If both null → hide price entirely.
     - **Spots:** when `spotsLeft !== null` AND `spotsLeft <= 8` → "· {n} left" appended in amber `feedback.warning` (#FF9500) weight 600, as a scarcity cue. When `spotsLeft > 8` → omit (don't show "47 left" — that's not scarcity, it's noise). When `spotsLeft === null` (unlimited) → **hide entirely** (🔒 capacity hides when unlimited; do NOT show "Open" — keeps the row clean and avoids implying a cap).

Field → RPC return mapping (every §A.2/A.3 column accounted for):

| Card element | RPC column | Render rule |
|---|---|---|
| cover | `cover_media_url` + `cover_media_type` | EventCoverMedia; null → hue band |
| title | `title` | 2 lines, weight 700/16 |
| dates | `start_at` / `end_at` | formatted range; hide if both null |
| destination | `destination_text` | "to {…}"; hide if null |
| departure | `departure_text` | "Leaving from {…}"; hide if null (Item 4) |
| planner | `brand_name` | 1 line, flexShrink |
| verified | `brand_verified` | badge only if true (Item 2.3) |
| price-from | `min_price_cents` + `currency` + `has_free_tier` | "From {price}" / "Free" / hidden |
| spots | `spots_left` | "· {n} left" only if ≤8; hidden if null/unlimited/>8 |
| deadline badge | `booking_deadline` | "Closing soon" top-left if <72h future; else none |
| (tap target) | whole card | `onPress(trip)` → detail overlay |
| `trip_slug`/`brand_slug` | carried in `DiscoverTripRow` seed | not rendered; passed to detail |
| `status`/`bookings_closed`/`timezone`/`tickets_sold`/`total_capacity`/`total_count`/`published_at` | — | data plumbing only, not on the card face |

### 2.3 Verified badge (🔒 conditional — zero verified planners today)
- Use **`shield-checkmark`** (Ionicons, in set) at size 12, color `brand.primary` #FF6B35 (the orange = "Mingla-vouched"), inline immediately right of the planner name with `space.xs` gap.
- A11y: the badge carries `accessibilityLabel="Verified planner"`; the planner name + badge group reads as one element.
- Renders ONLY when `brandVerified === true`. **Against current data it never renders** (🔒 no fabrication). It is fully specced so it is correct the day a planner verifies.
- No new asset — `shield-checkmark` is in `Icon.tsx`.

### 2.4 Contrast (computed)
- White (#FFFFFF) title/price on the bottom glass chip over the 0.7-opacity black gradient + dark cover: effective bg ≈ #1A1C20 → contrast **≈ 15.5:1** (passes AA/AAA for body + large). Worst case (bright cover behind a thin chip edge): the chip's own `rgba(16,18,22,0.88)` fill (Android opaque / iOS over gradient) keeps effective bg ≥ #2A2C30 → white text **≈ 12:1**. Pass.
- Meta rgba(255,255,255,0.72) on the same chip ≈ **6.8:1** — passes AA body (≥4.5:1).
- Amber spots #FF9500 on the dark chip ≈ **5.1:1** — passes AA for the small scarcity text (it's a cue, paired with the number, not sole-carrier).
- Dark mode only (this surface is a permanently-dark canvas, `glass.discover.screenBg`). No light-mode variant needed — flagged: the whole Discover surface is dark-only by product design, so the "both modes" clause is N/A here and the dark ratios above stand.

---

## 🎨 ITEM 3 — TripFilterChips row

### 3.1 Layout
Horizontal-scroll chip row at the top of the Trips tab content, visually a sibling of the Events filter bar. Height = `glass.discover.filterBar.height` 52, `paddingHorizontal` 16, `chipGap` 8. Edge `LinearGradient` fades (`fadeEdgeWidth` 20) like the Events bar. No pinned right-button — the sort control is a chip in the row (last slot).

### 3.2 Chip set + order (🔒 set from SPEC §E.3 — NO intent chip)
Order chosen by job-priority (where → when → how much → how many → sort):

1. **Destination** — icon `navigate-outline` 14, label = `destinationQuery` or "Where to". Tap → city/search sheet → sets `destinationQuery`.
2. **Leaving from** — icon `paper-plane-outline` 14, label = `departureQuery` or "Leaving from". Tap → city/search sheet → sets `departureQuery`. (🔒 SEPARATE chip from destination.)
3. **Dates** — icon `calendar-outline` 14, label = "Dates" or the active preset. Tap → date sheet. **Presets (🎨 LOCKED here):** "Anytime" (clears), "This month" (`dateFrom`=today, `dateTo`=end of this month), "Next month" (next month's range), "Custom…" (a from/to picker). Maps to `dateFrom`/`dateTo`.
4. **Price** — icon `pricetag-outline` 14, label = "Price" or "$X–$Y". Tap → a min/max range sheet → `minPriceCents`/`maxPriceCents`.
5. **Group size** — icon `people-outline` 14, label = "Group" or "{n}+". Tap → a stepper/range sheet → `groupSizeMin`/`groupSizeMax`.
6. **Sort** — icon `swap-vertical`-style (use `options-outline` 14, in set), label = "Sort". Tap → a small action sheet: Recommended (relevance) · Newest-first is default · "Lowest price" (price_asc) · "Highest price" (price_desc) · "Oldest" (oldest). Maps to `sort`.

### 3.3 Chip visual (reuse `glass.discover.chip` tokens exactly)
- Height 36, radius 18 (`radius.full`-ish), paddingHorizontal 14, icon→label gap 6, label fontSize 14 / weight 500.
- **Inactive:** bg `chip.inactive.bg` rgba(255,255,255,0.08), border `chip.inactive.border` rgba(255,255,255,0.14), label `chip.inactive.labelColor` rgba(255,255,255,0.85). Android opaque fallback fill `chip.inactive.fallbackSolid` rgba(28,30,34,1).
- **Active (a value is set):** reuses `glass.chrome.active.tint` fill / `glass.chrome.active.border` / `glass.chrome.active.labelColor` #FFFFFF + glow (`chip.active.glowOpacity` 0.25, `glowRadius` 10). Android opaque fallback `chip.active.fallbackSolid` rgba(235,120,37,0.85). The label switches to the chosen value (e.g. "Washington, DC"), and a small **count badge** (`chip.countBadge`, size 16, orange) shows on Price/Group/Dates when a range is set, mirroring the Events "Filters" badge.
- **Press:** scale `chip.pressScale` 0.96 over `pressDurationMs` 120 — non-shifting. Each chip ≥44pt tap height (the 36pt visual sits in a 52pt row with vertical hit-slop → meets 44pt). `accessibilityRole="button"`, label e.g. "Destination filter, currently {value or none}".
- **Clear:** an active chip's sheet has a "Clear" affordance; clearing all → restores the full set (🔒 SC-6).

### 3.4 Picker sheets
All pickers are `BaseBottomSheet`-style dark sheets (reuse the existing Discover More-filter `BaseBottomSheet` + `CityPickerSheet` patterns — 🔒 no new sheet system). Sheet bg `surface.elevated` dark, handle 36×4 `radius.full` `text.tertiary`, radius `radius.lg` top-only, `space.lg` padding. Primary action ("Apply") = `brand.primary` button height 48; "Clear" = text button. Reduced-motion: instant present (no slide spring).

---

## 🎨 ITEM 4 — "Leaving from" display treatment (cross-surface)

The departure line is the new field; it must read identically everywhere it appears so a buyer learns the pattern once.

### 4.1 Canonical treatment
- **Icon:** `paper-plane-outline` (Ionicons, in set) — a plane taking off reads "origin / departure" without being a literal airport. NOT `airplane` (too heavy), NOT a location pin (that's destination's `navigate-outline`). This makes departure and destination visually distinct at a glance.
- **Copy:** `Leaving from {city}` — sentence case, plain, in voice. City = `departure_text` verbatim (already a formatted place string, e.g. "Washington, DC, USA").
- **Order:** ALWAYS render departure ABOVE / before destination when both show, because the mental model is "leave here → go there". On the card the when/where line is destination-led (compact), so departure gets its own line directly under it; on the detail it's a stacked meta row above destination.
- **Separator:** none inline — departure is its own line/row (never `·`-joined to destination), so "leaving from X" and "to Y" never blur together.
- **Conditional (🔒):** render ONLY when `departure_text !== null`. No empty line, no "Leaving from —", no placeholder.

### 4.2 Per-surface

| Surface | Placement | Tokens |
|---|---|---|
| **Consumer TripCard** | Own line in the bottom info-stack, directly under the when/where line, above planner/price | `paper-plane-outline` 12 + meta type (11/weight 500/rgba 255×.72) |
| **Consumer trip detail** | A `metaRow` in the hero body, ABOVE the destination `metaRow` | `paper-plane-outline` 16, `accent.warm` icon, `metaText` (body/15) — mirrors the existing destination metaRow in `TripPreview` |
| **Buyer-web `TripPreview.tsx`** (§G) | A new `metaRow` immediately ABOVE the existing destination metaRow (TripPreview L136–143) | EXACT mirror of the destination metaRow: `<Icon name="paper-plane-outline" size={16} color={accent.warm}/>` + `<Text style={styles.metaText} numberOfLines={2}>Leaving from {trip.businessTrip.departureLocationText}</Text>`; conditional `departureLocationText !== null` (🔒) |
| **Business create/edit input** (§B, not a render — the authoring affordance) | "Departing from" `AddressAutocompleteInput`, immediately ABOVE the "Destination" field group | mirror the Destination block exactly; placeholder "e.g. Washington, DC, USA" |

A11y: the departure metaRow reads "Leaving from {city}" as one label (icon decorative).

---

## 🎨 ITEM 5 — Consumer trip detail screen

### 5.1 Structure (🔒 mirror business `t/[brandSlug]/[tripSlug].tsx`; full-screen overlay)
Mounted as a full-screen overlay over the tab host (🔒 `viewingTrip` state slot in `app/index.tsx`, mirrors `viewingFriendProfileId`). NOT a sheet — a full-screen, edge-to-edge surface so the cover goes full-bleed like the business page. Background `#0c0e12` (matches business page + `glass.discover.screenBg`).

Top→bottom (a `ScrollView`, `paddingBottom = space.xl + safe-area`):

1. **Full-bleed cover hero** — `EventCoverMedia` (🔒 shared), edge-to-edge, ~52% of viewport height, with the bottom photo-legibility gradient. Null cover → hue band (🔒 never fake).
2. **Floating overlays on the hero** (absolute, `top = insets.top + space.sm`):
   - **X-close** (left): `IconChrome icon="close" size={36}` → clears the `viewingTrip` slot. `accessibilityLabel="Close"`. ≥44pt.
   - **Share** (right): `IconChrome icon="share" size={36}` → native Share sheet with the `https://business.usemingla.com/t/{brandSlug}/{tripSlug}` URL (mirror business handleShare). `accessibilityLabel="Share"`.
3. **Title + planner byline** — title `heading.large` (22/600) #FFFFFF; "by {brandName}" `body.medium` (15) `text.secondary` + verified badge (Item 2.3) when `brandVerified`.
4. **Meta rows** (`accent.warm` icons, `body.medium` text, `space.sm` row gap, `space.xs` icon-text gap):
   - Dates: `calendar` + formatted range.
   - **Leaving from** (🔒 conditional): `paper-plane-outline` + "Leaving from {departureText}" — ABOVE destination (Item 4).
   - Destination: `location`/`navigate-outline` + destinationText.
   - Capacity: `people-outline` + "{n} travelers max" when `total_capacity` non-null; hidden when unlimited.
5. **Deadline / refund state band** (🔒 mirror ORCH-0875 ladder semantics + copy):
   - `bookings_closed === true` → **closed banner** (GlassCard, `feedback.error` title "Bookings closed" + body). Reserve DISABLED.
   - else `bookingDeadline` future → **countdown pill** "Bookings close in N days/hours/minutes" (`accent.tint` fill / `accent.border` / `accent.warm` text — exact business tokens).
   - else → no band.
   - **Refund policy ladder** (`RefundPolicyDisplay`, 🔒 reuse the business component's COPY + ladder; if it must be reimplemented in app-mobile, semantics + strings are LOCKED). In a `GlassCard` below the deadline band.
6. **Description** — `body.large` (17) when present.
7. **Day-by-day itinerary** (`trip_days`): section label "Day by day" (`label.medium`), per-day card: "DAY {ordinal}" overline (`label.tiny`, `accent.warm`, letterSpacing 0.3), day title (`heading.small`), narrative (`body.medium` `text.secondary`). `space.md` between day cards.
8. **Inclusions** (`trip_inclusions`): "What's included" / "Not included" sub-sections, each item a row with `checkmark-circle-outline` (included, `feedback.success`) / `close` (excluded, `text.tertiary`) + `body.medium` text.
9. **Price tiers** (`trip_pricing_tiers` → `ticket_types`): each tier a row — tier name + price (currency-aware) + "spots left" if scarce. Free tier → "Free".

### 5.2 Reserve CTA (thumb zone)
- **Sticky bottom bar**, full width, `surface.elevated` dark glass with top hairline, `paddingBottom = insets.bottom + space.sm`, sits ABOVE the scroll content (does not scroll away) — primary action in the thumb zone (🔒 design principle 3).
- Inside: left = "From {minPrice}" (or "Free"); right = **Reserve** button (`brand.primary` #FF6B35 fill, `text.inverse` #FFFFFF, height 48, `radius.sm` 8, weight 600). ≥44pt, `accessibilityLabel="Reserve this trip"`.
- **Enforcement (🔒 F.3):** when `bookings_closed === true` OR (`bookingDeadline !== null` AND `bookingDeadline < now`) → button **disabled** (40% opacity per design-system button rule) + label "Bookings closed", and the closed banner (5.5) shows. Non-shifting (the bar keeps its height).
- Tap → buyer flow (Item not designed here beyond entry; the Reserve sheet builds `lines` + `intake_form_data` per §F). On `succeeded` → confirmation surface (reuse consumer event-checkout confirmation).

### 5.3 Cold-open (deep-link) vs seed
- Card tap carries the full `DiscoverTripRow` seed → hero/title/meta paint instantly from the seed while `useConsumerTripDetail` fetches itinerary/inclusions/tiers (🔒 no `.from('brands')`). Show the seed immediately, then hydrate the lower sections.
- Deep-link cold-open (`app/t/[brandSlug]/[tripSlug].tsx`) → no seed → the whole screen is in **loading state** (5.5/State A) until the hook resolves.

---

## 🎨 ITEM 6 — All 9 states (exact copy, Mingla voice)

Voice rule: friendly, witty-not-cute, never blaming the user, never fake-cheerful about errors. All copy below is the binding string.

| # | State | Trigger | Visual | Copy (binding) |
|---|---|---|---|---|
| **A** | **Loading (skeleton)** | `isLoading` first page | 3 TripCard skeletons (pulsing `background.tertiary→secondary`, 1.5s, `glass.discover.motion.skeletonPulseMs`): full-width rounded rect (cover) + 2 short bars (title/meta). NO spinner, NO "Loading…" text. | — (skeleton is the state) |
| **B** | **Error** | RPC throws (`isError`) | Centered stack: `alert-circle-outline` 48 `feedback.error`; title + body; "Try again" secondary button (re-`refetch`). | Title: **"Well, that's awkward."** Body: **"We couldn't load trips just now. Give it another shot?"** Button: **"Try again"** |
| **C** | **Empty — no trips at all** (first-time / sparse-data reality) | feed returns 0 with NO filters set | Centered: `compass-outline` 48 `text.tertiary`; title + body. No "clear filters" (nothing to clear). Optional secondary: "Browse events" → switches to Events tab. | Title: **"No trips yet — but they're coming."** Body: **"Planners are still mapping out group trips. Check back soon, or see what's happening near you."** Button: **"Browse events"** |
| **D** | **Empty — filters too narrow** | feed returns 0 WITH filters set | Centered: `options-outline` 48 `text.tertiary`; title + body; **"Clear filters"** primary button (resets `DiscoverTripFilters`). | Title: **"Nothing matches those filters."** Body: **"Try widening your dates, budget, or where you're headed."** Button: **"Clear filters"** |
| **E** | **Populated** | ≥1 trip | The TripFilterChips row + the single-column TripCard list, infinite scroll (`fetchNextPage` near end). | — |
| **F** | **Single result** | exactly 1 trip | Same as populated — ONE card, full width, no special "1 result" chrome (a single rich card reads fine; don't add an apologetic count). Optionally a quiet count line above is OK but NOT required. | — |
| **G** | **Deadline-closed** (on detail) | `bookings_closed` or past deadline | Closed banner (5.5) + Reserve disabled (5.2). | Banner title: **"Bookings closed"** Body: **"This trip stopped taking new bookings. Reach out to the organizer with questions."** |
| **H** | **Unlimited capacity** | `spots_left === null` | Card: spots line HIDDEN (no "spots left", no "Open"). Detail: capacity row HIDDEN. | — (absence is the design) |
| **I** | **Unverified planner** | `brand_verified === false` (all trips today) | Planner name renders WITHOUT the badge. No "unverified" label, no warning — absence of the badge is the only signal. | — |

Additional required states (premium-craft 9-state gate, mapped):
- **Submitting** (checkout in flight): Reserve button → spinner replaces label, label "Reserving…", button keeps width, inputs disabled (🔒 design-system Submitting pattern). Covered by the §F buyer flow; specced here as the Reserve in-flight treatment.
- **Offline:** reuse the existing Discover `offlineBanner` token (`glass.discover.offlineBanner`, 36pt, orange-tint, "You're offline" — the Events tab already has this; the Trips tab shows the SAME banner above its content). Cached React-Query data renders under it; no separate offline empty.
- **Returning** (cached): React Query serves the last `discoverTripsKeys.list(filters)` page instantly (no skeleton flash), then revalidates (`staleTime` 60s). Returning users land on their last `discoverActiveTab` (persisted).
- **Degraded** (missing cover / missing price): cover null → hue band (B-handled); price null + no free tier → price simply omitted from the card/CTA (no "$0", no "Price TBD"). The card never looks broken from a missing field.

Reduced-motion: skeleton pulse disabled (static `background.tertiary` blocks) when reduce-motion is on.

---

## 🎨 ITEM 7 — No-AI-slop bans + references

### 7.1 Hard bans (this surface)
- ❌ No fabricated/stock cover imagery. Null cover = the shared `EventCover` hue band ONLY. Never a smiling-travelers stock photo, never a generic "destination" image.
- ❌ No fabricated trust signals. Verified badge renders ONLY on `brand_verified === true` (never today). No "Popular", "Trending", "Top-rated" labels — there's no data behind them.
- ❌ No fake scarcity. "{n} left" shows ONLY when `spots_left ≤ 8` and real; never an invented "Only a few left!".
- ❌ No emoji as UI icons. Ionicons set only (`compass-outline`, `paper-plane-outline`, `navigate-outline`, `shield-checkmark`, `calendar-outline`, `pricetag-outline`, `people-outline`, `options-outline`). Personality lives in copy strings, not glyphs.
- ❌ No new gradients except the existing photo-legibility overlay (`glass.discover.card.gradient`). No purple-to-blue blobs, no rainbow buttons.
- ❌ No decorative shadows/glows. Every shadow/blur/glow is an existing chrome token, and Android gets the opaque fallback with NO shadow under the rounded fill.
- ❌ No layout shift on press. All press feedback is transform-scale / opacity only.
- ❌ No empty "Leaving from —" / "to —" lines. Every conditional field hides cleanly when null.

### 7.2 References examined
(See §1.) `LikesPage.tsx`, `DiscoverScreen.tsx` + `glass.discover.*` tokens, `BusinessEventCard.tsx`, business `t/[brandSlug]/[tripSlug].tsx` + `TripPreview.tsx`, `Icon.tsx` (glyph audit), `designSystem.ts` (tokens), plus documented Airbnb-Experiences / Dice / Posh feed-card + filter-row patterns. External web fetch flagged as not-run this turn (optional pre-implement polish).

---

## Cross-Surface note

The departure field touches three render surfaces; the treatment is intentionally identical so the pattern is learned once:
- **Consumer card** (`TripCard`): `paper-plane-outline` 12 + "Leaving from {city}" on its own line in the bottom info-stack, above planner/price (Item 2.2 line 3 / Item 4).
- **Consumer detail** (`ConsumerTripDetailScreen`): `paper-plane-outline` 16 `accent.warm` + "Leaving from {city}" as a meta row ABOVE the destination row (Item 5.1.4 / Item 4).
- **Buyer-web** (`TripPreview.tsx`, §G): the same metaRow, ABOVE the existing destination metaRow, exact-mirroring its markup, conditional on `departureLocationText !== null` (Item 4 table).
All three are conditional-render (🔒 never an empty line), icon distinct from destination's location/navigate glyph, departure always ordered before destination.

---

## Completion gate (mingla-designer 7 clauses)

1. ✅ "References examined" line present (§1, §7.2); external web fetch explicitly flagged as not-run.
2. ✅ All 9 states designed with exact copy (§Item 6 — loading/error/empty-none/empty-filters/populated/single/deadline-closed/unlimited/unverified, plus submitting/offline/returning/degraded mapped).
3. ✅ Every value is a token (`glass.discover.*`, `glass.chrome.*`, design-system 4px grid); no magic numbers (the two layout choices — card aspect 1.45:1, scarcity threshold ≤8, closing-soon 72h — are named design constants the implementor sets once, not eyeballed spacing).
4. ✅ Contrast computed + written (Item 2.4: title ≈15.5:1, meta ≈6.8:1, amber ≈5.1:1); dark-only surface flagged so "both modes" is N/A by product design.
5. ✅ Every interactive element ≥44pt + `accessibilityLabel` + non-shifting feedback (pills, chips, card, X-close, share, Reserve).
6. ✅ Zero anti-slop violations (§7.1).
7. ✅ Copy in Mingla voice per state; motion has reduced-motion fallback (spotlight, skeleton, sheets).

**DESIGN COMPLETE.** All 7 §17 OPEN items locked. Implementor builds 🎨 to this doc, 🔒 to the SPEC.

---

## UNDERSPECIFIED in the SPEC (flag for orchestrator to resolve before/at IMPLEMENT)

1. **`coverHue` source for the TripCard hue-band fallback.** The RPC return (§A.2) has NO `cover_hue` column, but `EventCoverMedia` needs a `hue` for its null-cover band. The Events grid derives a hue server-side. **Resolution needed:** either add `cover_hue` to `pg_published_trips_public` (cheap, hash of `trip_id` in SQL) OR have `tripsDiscoveryService` hash `tripId` client-side. I assumed client-side hash; orchestrator should confirm (a 1-line RPC add is cleaner and matches the Events path).
2. **`formatTripDateRange` location.** The SPEC says "reuse the business `formatTripDateRange` logic or an equivalent" but it lives in `mingla-business`. The card needs it in `app-mobile`. **Resolution:** confirm whether to extract to a shared package or reimplement (the consumer `formatEventDateChip` already exists and may suffice for the card; the detail needs the fuller range). Implementor's call but should be pinned.
3. **`RefundPolicyDisplay` reuse vs reimplement.** SPEC §F.5/E.4 leaves "extract to shared package OR reimplement" to implementor. The COPY + ladder semantics are LOCKED, but the orchestrator should decide the packaging so the consumer detail and business page don't drift. Recommend extracting to `@mingla/event-rendering` (same package the cover already lives in).
4. **Default sort label.** SPEC §A.3.5 default is "relevance" = newest-first, but there's no location-proximity in C1. The Sort sheet's top option should read **"Recommended"** (maps to `relevance`/newest) to avoid promising proximity that isn't computed. Confirm copy.
5. **"Browse events" empty-state action (State C)** assumes the empty Trips tab can programmatically switch to the Events tab via `setDiscoverActiveTab('events')`. Confirm the host exposes that setter to the Trips content (it should, via the Zustand slot) — minor, but the implementor needs it threaded.
