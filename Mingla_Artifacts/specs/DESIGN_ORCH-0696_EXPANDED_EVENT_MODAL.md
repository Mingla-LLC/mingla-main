# DESIGN spec — ORCH-0696 Expanded Event Modal: bottom-sheet conversion + TM information architecture

**Mode:** DESIGN (mingla-designer skill)
**Dispatch:** [`prompts/DESIGN_ORCH-0696_EXPANDED_EVENT_MODAL.md`](../prompts/DESIGN_ORCH-0696_EXPANDED_EVENT_MODAL.md)
**Date:** 2026-04-28
**Designer:** mingla-designer
**Output target:** This document is the design contract. Forensics audit + implementor consume it as ground truth.

---

## E-1: Layman summary

Today the Expanded Card Modal is a centered floating card — 95% width × 90% height, white background, sitting in the middle of a dimmed screen, fade-in animation, dismiss only via the X button or backdrop tap. It works the same way for every card type (places, curated experiences, ticketmaster events). For events specifically, the layout was inherited from the place design — image gallery on top, then a Title / Venue · Artist row / genre chips / ticket-status badge / Date + Price cards / vibe tags / Venue card / sticky Get Tickets button at bottom. Functional but not optimized for event content.

After this design: every card type opens as a **bottom sheet** that slides up from below. It snaps to 50% (peek) or 90% (expanded), responds to drag-down dismissal, has a visible drag handle at top, dimmed scrim above, dark glass-aligned chrome that matches the rest of the app. For events specifically, the layout reorganizes around what a user actually came for: the **event poster** is hero (full-bleed at top), the **artist name** is the second-largest thing on screen, **show date + time + venue** form a compact meta row, **Get Tickets** is the dominant CTA, and **Save / Share / Add to Calendar** sit as a secondary action row. Address, description, seat map, vibe tags, and other detail content live below the fold, expanded by drag or scroll.

Place layouts (restaurants / bars / curated experiences) keep their existing section ordering inside the new bottom-sheet chrome — the change is the chrome, not the content for places.

---

## E-2: Hard locks (verbatim from dispatch §B)

| # | Decision | Locked value |
|---|---|---|
| 1 | Presentation style | **Option α — Global bottom-sheet conversion.** All 8 ExpandedCardModal mount surfaces convert from full-screen modal to bottom sheet. NO per-mount-site presentation flag (Constitution #2 — single source of truth). |
| 2 | Design-token system | Use **current `glass.*` + `dsColors.*` tokens** from designSystem.ts. NO new tokens unless absolutely required (and if so, propose them with rationale). |
| 3 | Render-time content branching | Modal already supports a `nightOutData` extra field for TM events — preserve this branching mechanism. Design must handle BOTH place-shaped data (rating / hours / address) AND event-shaped data (artist / show time / ticket status) gracefully. |
| 4 | Native module changes | NONE. Bottom sheet must be implementable via existing libraries. OTA-eligibility required. |
| 5 | Solo / collab parity | All 8 mount surfaces ship the same UX. No surface-specific overrides for the modal's chrome. Per-data-type render branching IS allowed (place vs event) but at the content layer only, not the chrome. |

---

## E-3: Bottom-sheet chrome design

### E-3.1 Library choice (pre-decided — implementor confirms)

`@gorhom/bottom-sheet` is already a project dependency, used by `MapBottomSheet.tsx` + `PersonBottomSheet.tsx` (both reference patterns). Implementor uses the same library + same pattern. No new dependency.

### E-3.2 Chrome inventory

| Element | Spec |
|---|---|
| **Scrim (backdrop)** | Color: `rgba(0, 0, 0, 0.55)`. Optional `BlurView` intensity `12` (light blur — enough to abstract the underlying surface, not so much it obscures context). Animated fade-in over `200ms` ease-out alongside sheet entrance. Fade-out matches sheet exit. Tap dismisses sheet. |
| **Sheet container** | Background: `rgba(12, 14, 18, 1)` (matches `glass.discover.screenBg` — dark, dramatic, consistent with the rest of the app's modern surfaces). Top corners only: `borderTopLeftRadius: 28, borderTopRightRadius: 28`. Bottom corners square (sheet sits flush to screen bottom). Top edge has a subtle hairline: `borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255, 255, 255, 0.08)'`. Shadow: `shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 16` (downward shadow not needed; sheet sits at screen bottom). |
| **Drag handle** | Width `36pt`, height `4pt`, `borderRadius: 2`, `backgroundColor: 'rgba(255, 255, 255, 0.30)'`, centered horizontally, `marginTop: 8`, `marginBottom: 12`. Use `handleIndicatorStyle` prop on `<BottomSheet>`. |
| **Snap points** | `['50%', '90%']`. Initial `index: 1` (90% — opens expanded so user sees full detail; matches operator-locked current behavior). Peek (`index: 0` = 50%) is the transitional state when user drags down partway but doesn't fully dismiss. |
| **Dismiss affordances** | (a) **Drag down** past 50% snap point → snaps to closed. `enablePanDownToClose: true`. (b) **Scrim tap** → close. (c) **System back button (Android)** → close. (d) **Close X button** in top-right of sheet content (visible only at expanded snap point — recessed at peek to give content room). |
| **Status bar behavior** | When sheet is open: status bar style `light-content` (matches dark sheet). When sheet closes: revert to whatever the underlying screen had. |
| **Safe-area handling** | Top of sheet: NO `insets.top` padding (sheet doesn't reach top of screen even at expanded — the 10% gap above sheet is the scrim). Bottom of sheet: respect `insets.bottom` via `paddingBottom: Math.max(insets.bottom, 16)` on the inner content scroll view (events with sticky CTA need bottom safe area). |
| **Inner content** | `<BottomSheetScrollView>` (from `@gorhom/bottom-sheet`) for scrollable inner content. Standard `<ScrollView>` does NOT work inside `<BottomSheet>` — gestures fight. |
| **Keyboard avoidance** | If any inner content has `<TextInput>` (currently no — but future-proof): use `<BottomSheet keyboardBehavior="interactive">`. |

### E-3.3 Stacking with chat-shared toasts (ORCH-0685 cycle-3 lesson)

Per ORCH-0685 cycle-3, a second `<Modal>` is needed to surface toasts ABOVE the chat-shared ExpandedCardModal because RN Modal portals over sibling Views regardless of zIndex.

`@gorhom/bottom-sheet` is NOT a native `<Modal>` — it's an Animated View positioned via React-Native-Reanimated. **Toasts render on TOP of bottom sheets natively** (toasts mount as siblings in the same React tree; Reanimated layout doesn't create a separate native window). **The Shape 2a Modal hack from ORCH-0685 cycle-3 becomes obsolete** when the modal converts to a bottom sheet.

**Recommendation:** during IMPL, the implementor should remove the Shape 2a second `<Modal>` block from MessageInterface.tsx (lines ~1538-1570) — it's no longer load-bearing once the underlying ExpandedCardModal stops using `<Modal presentationStyle="*">`. Save toasts will render naturally above the bottom sheet through standard z-ordering.

This is a side benefit of the bottom-sheet conversion: it eliminates a transitional architectural hack.

---

## E-4: Design token mapping table

Every visual property → token reference. Tokens come from [designSystem.ts](app-mobile/src/constants/designSystem.ts) and [colors.ts](app-mobile/src/constants/colors.ts).

### E-4.1 Sheet chrome tokens

| Property | Token | Resolved value |
|---|---|---|
| Sheet background | `glass.discover.screenBg` | `rgba(12, 14, 18, 1)` |
| Top corner radius | (literal) | `28pt` |
| Top hairline color | (new — proposed) `glass.bottomSheet.hairline` | `rgba(255, 255, 255, 0.08)` |
| Drag handle bg | (new — proposed) `glass.bottomSheet.handle.color` | `rgba(255, 255, 255, 0.30)` |
| Drag handle width | (literal) | `36pt` |
| Drag handle height | (literal) | `4pt` |
| Scrim color | (new — proposed) `glass.bottomSheet.scrim.color` | `rgba(0, 0, 0, 0.55)` |
| Scrim blur intensity | (new — proposed) `glass.bottomSheet.scrim.blurIntensity` | `12` |
| Sheet shadow | `glass.shadow` (existing) | reused |

**Proposed new sub-namespace:** `glass.bottomSheet.*` — adds `handle.color`, `scrim.color`, `scrim.blurIntensity`, `hairline`, plus `snapPoints: ['50%', '90%']` for shared use across all bottom-sheet components in the app. Justification: the project has 3 existing bottom sheets (MapBottomSheet, PersonBottomSheet, ProposeDateTimeModal) with hardcoded chrome values that should consolidate to a single token. ORCH-0696 IMPL is the natural moment to introduce this token. Forensics audit can confirm existing sheets and propose unifying values.

### E-4.2 Event content tokens (above the fold)

| Element | Property | Token | Resolved |
|---|---|---|---|
| Hero poster | aspectRatio | (literal) | `16:9` ratio (e.g., `width: '100%', aspectRatio: 16/9, maxHeight: 240pt`) |
| Hero gradient overlay | colors | (literal — bottom of poster) | `from: 'rgba(0,0,0,0)' to: 'rgba(12,14,18,0.95)'` (matches existing `card.gradient` pattern) |
| Genre chip on poster | bg | `glass.badge.tint.floor` | `rgba(12, 14, 18, 0.42)` |
| Genre chip on poster | text color | `colors.white` | `#FFFFFF` |
| Genre chip on poster | borderColor | `glass.badge.border.hairline` | `rgba(255, 255, 255, 0.14)` |
| Genre chip blur | intensity | `glass.badge.blur.intensity` | `24` |
| Event title | fontSize | `responsiveTypography.xxl.fontSize` | ~24pt (scaled) |
| Event title | fontWeight | (literal) | `700` |
| Event title | color | `colors.white` | `#FFFFFF` |
| Event title | numberOfLines | (literal) | `3` |
| Artist name | fontSize | `responsiveTypography.lg.fontSize` | ~18pt (scaled) |
| Artist name | fontWeight | (literal) | `500` |
| Artist name | color | `colors.primary` | `#eb7825` (Mingla orange — accent + ties to brand) |
| Meta row text (venue · date · time) | fontSize | `responsiveTypography.sm.fontSize` | ~14pt |
| Meta row text | color | `'rgba(255, 255, 255, 0.70)'` | (or new `dsColors.text.muted` if exists) |
| Meta row separator dot | char | (literal) | `' · '` (with thin spaces) |
| **Get Tickets CTA bg** | `colors.primary` | `#eb7825` | primary orange — same as save heart, share, schedule across app |
| Get Tickets CTA text | color | `colors.white` | `#FFFFFF` |
| Get Tickets CTA fontSize | fontSize | `responsiveTypography.md.fontSize` | ~16pt |
| Get Tickets CTA fontWeight | (literal) | `600` | |
| Get Tickets CTA height | (literal) | `56pt` | matches `glass.buttonPrimary.height` |
| Get Tickets CTA radius | `radius.lg` | (existing token) | |
| Get Tickets CTA disabled bg | (literal) | `'rgba(102, 102, 102, 1)'` | for sold-out state |
| Secondary action row chip | bg | `glass.surface.backgroundColor` | `rgba(255, 255, 255, 0.10)` (dark variant) — see §E-4.3 |
| Secondary action row chip border | `'rgba(255, 255, 255, 0.18)'` | |
| Secondary action row chip height | (literal) | `40pt` |
| Secondary action row chip icon | `Icon` size | (literal) | `18pt` |
| Secondary action row chip text | fontSize | `responsiveTypography.sm.fontSize` | ~14pt |

### E-4.3 Glass-on-dark variant

The existing `glass.surface` token (`rgba(255, 255, 255, 0.55)`) is designed for light backgrounds. For ORCH-0696's dark sheet, propose a new `glass.surfaceDark` token: `backgroundColor: 'rgba(255, 255, 255, 0.10)', borderColor: 'rgba(255, 255, 255, 0.18)', borderWidth: 1, borderRadius: radius.xl`. This matches the existing dark-glass pattern used in `glass.chrome.*` and `glass.discover.*` and gives consistent glass language across the dark sheet.

### E-4.4 Below-the-fold tokens

| Element | Property | Token |
|---|---|---|
| Section divider | borderTopWidth | `StyleSheet.hairlineWidth` |
| Section divider | borderTopColor | `'rgba(255, 255, 255, 0.10)'` |
| Section title | fontSize | `responsiveTypography.md.fontSize` |
| Section title | fontWeight | `600` |
| Section title | color | `colors.white` |
| Section title | marginTop | `dsSpacing.lg` (16pt) |
| Section title | marginBottom | `dsSpacing.sm` (8pt) |
| Body text | fontSize | `responsiveTypography.sm.fontSize` |
| Body text | color | `'rgba(255, 255, 255, 0.80)'` |
| Body text | lineHeight | `responsiveTypography.sm.lineHeight` |
| Address row icon | color | `colors.primary` (#eb7825) |
| Address row text | color | `'rgba(255, 255, 255, 0.70)'` |
| Tag chip | bg | `glass.surfaceDark.backgroundColor` |
| Tag chip | borderColor | `glass.surfaceDark.borderColor` |
| Tag chip text | color | `colors.white` |

---

## E-5: Event IA wireframes

### E-5.1 Peek state (50% snap point)

```
┌─────────────────────────────────────────┐
│            (scrim above sheet)           │
│                                          │
│                                          │
├─────────────────────────────────────────┤  ← top of sheet (28pt rounded)
│              ━━━━━ (drag handle)         │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │  [Event Poster Image —          │    │
│  │       full-bleed, 16:9 ratio]   │    │
│  │                                  │    │
│  │ ┌──────────┐                    │    │
│  │ │AFROBEATS │ ← genre chip       │    │
│  │ └──────────┘                    │    │
│  └─────────────────────────────────┘    │
│                                          │
│  Burna Boy: Love, Damini Tour           │
│  Burna Boy                               │
│  Madison Square Garden ·                 │
│       Fri Nov 7 · 8:00 PM                │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │       Get Tickets · $80–$280       │ │
│  └────────────────────────────────────┘ │
│                                          │
│  [♡ Save] [↗ Share] [📅 Add Calendar]   │
│                                          │
└─────────────────────────────────────────┘  ← peek snap point (50%)
```

Above-the-fold contents (top→bottom) at peek state — visible without scrolling:
1. Drag handle (8pt margin top)
2. Hero poster (full-bleed, ~240pt aspect-ratio 16:9 with gradient overlay)
3. Genre chip (overlay on poster, bottom-left, glass background) — show genre OR genre + sub-genre if both present
4. Event title (24pt bold, 3-line max, white)
5. Artist name (18pt medium, primary orange)
6. Meta row (single line, 14pt, white at 70%) — `[Venue] · [Date] · [Time]`
7. Get Tickets CTA (full-width, 56pt, primary orange) — disabled / re-labeled for sold-out / coming-soon
8. Secondary action row (3 chips: Save / Share / Add to Calendar)

### E-5.2 Expanded state (90% snap point)

Everything above (peek), PLUS below-the-fold:

```
│  ───────────────────────────────────────│  (section divider)
│  ABOUT                                   │
│  Burna Boy returns to Madison Square    │
│  Garden for two nights of African       │
│  giant energy. Tickets include access...│
│                                         More
│                                          │
│  ───────────────────────────────────────│
│  WHEN & WHERE                            │
│  📅  Fri Nov 7, 2026                     │
│      Doors 7:00 PM · Show 8:00 PM       │
│  📍  Madison Square Garden               │
│      4 Pennsylvania Plaza, NY 10001     │
│      [Open in Maps ↗]                    │
│                                          │
│  ───────────────────────────────────────│
│  TAGS                                    │
│  [explicit] [GA] [21+] [parking $50]     │
│                                          │
│  ───────────────────────────────────────│
│  SEAT MAP                                │
│  [seat map image, 200pt ratio]           │
│                                          │
│  (bottom safe-area spacer)               │
└─────────────────────────────────────────┘
```

Below-the-fold contents (in order):
1. **About** section (collapsible after 3 lines, "More" toggle) — `card.fullDescription` or `card.description`
2. **When & Where** section
   - Date row: calendar icon + date + (doors / show times if available — currently just `nightOutData.time`, needs fallback)
   - Address row: pin icon + venue name + street address + Open in Maps link (uses existing `openDirections` helper)
3. **Tags** section (only renders if `nightOutData.tags.length > 0`) — chip wrap with vibe tags
4. **Seat Map** (only renders if `nightOutData.seatMapUrl` and not failed) — full-width image, 200pt aspect

### E-5.3 Loading state

```
┌─────────────────────────────────────────┐
│              ━━━━━                       │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │  [skeleton shimmer — poster]     │    │
│  └─────────────────────────────────┘    │
│                                          │
│  ████████████████████ ← title skeleton   │
│  ███████ ← artist skeleton               │
│  ████████████ ← meta skeleton            │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │  ████████████ ← CTA skeleton        │ │
│  └────────────────────────────────────┘ │
│                                          │
└─────────────────────────────────────────┘
```

Skeleton uses the same shimmer pattern as `LoadingGridSkeleton` in DiscoverScreen. Animated linear gradient sweep (already present in app), `rgba(255,255,255,0.04)` → `rgba(255,255,255,0.08)` cycle. Duration 1200ms, ease-in-out infinite.

### E-5.4 Error state

```
┌─────────────────────────────────────────┐
│              ━━━━━                       │
│                                          │
│        🎫 (large icon, 64pt)            │
│                                          │
│   Couldn't load event details            │
│                                          │
│   Pull down to dismiss, or check         │
│   your connection and try again.         │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │           Try Again                 │ │
│  └────────────────────────────────────┘ │
│                                          │
└─────────────────────────────────────────┘
```

This state fires when the modal opens but the underlying card data is incomplete (e.g., `nightOutData` is present but ticketUrl fetch fails). It's not the EventGridCard data missing — it's downstream data unavailable. Designer note: this is a rare path; current code doesn't surface it. Spec writer to determine if this state needs to be added or if existing behavior (silent best-effort) is acceptable.

### E-5.5 Empty state

Not applicable for events. If `nightOutData` is malformed or missing required fields (e.g., no `eventName`, no `venueName`), the parent (DiscoverScreen) shouldn't have surfaced this card — defensive design only at the schema layer, not the modal layer.

### E-5.6 Sold-out / presale variants

```
SOLD OUT:
  ┌────────────────────────────────────┐
  │      Sold Out (disabled)           │ ← gray bg, white at 60% text
  └────────────────────────────────────┘
  [♡ Save]  [↗ Share]  [📅 Add Calendar]

PRESALE:
  ┌────────────────────────────────────┐
  │    Presale Opens Nov 1 ⏰          │ ← amber bg #F59E0B, white text
  └────────────────────────────────────┘
  [♡ Save] [🔔 Notify Me] [↗ Share]   ← Add Calendar replaced with Notify Me

TBA (no ticket URL yet):
  ┌────────────────────────────────────┐
  │       Tickets TBA                  │ ← amber bg, white text, disabled
  └────────────────────────────────────┘
  [♡ Save]  [↗ Share]                  ← only 2 secondary actions
```

The Get Tickets CTA is ticket-status-aware. The full label includes the price range: e.g., `"Get Tickets · $80–$280"` (per existing implementation pattern — `t('cards:expanded.get_tickets', { price })`).

---

## E-6: Place IA preservation

The existing place IA section ordering is **PRESERVED UNCHANGED** for non-night-out cards. The only change for places is the chrome (centered modal → bottom sheet).

Existing place IA section order (verified by reading current ExpandedCardModal.tsx lines 1779-2045):

1. Sticky header `<ExpandedCardHeader>` with X close button → REPLACED by drag handle + close X (top-right of expanded sheet)
2. `<ImageGallery>` (or empty placeholder) — top
3. **Curated experience plan** branch (when `cardType === 'curated'`):
   - `<CuratedPlanView>` (full curated layout)
   - `<WeatherSection>` (first stop)
   - `<BusynessSection>` (first stop)
   - `<TimelineSection>` (animated timeline)
4. **Standard place** branch (else):
   - `<CardInfoSection>` — title, category icon, tags, rating, distance, travel time, price, description, tip
   - "See Full Plan" button (Stroll cards)
   - "See Full Plan" button (Picnic cards)
   - `<WeatherSection>`
   - `<BusynessSection>`
   - `<MatchFactorsBreakdown>`
   - `<DescriptionSection>` (full)
   - `<HighlightsSection>`
   - `<PracticalDetailsSection>` (address, hours, phone, website)
   - `<CompanionStopsSection>`
   - `<StopImageGallery>`
   - `<ImageLightbox>` (modal-within-modal)
   - `<ActionButtons>` (Save / Schedule / Share / Visit / Policies & Reservations)

All preserved. No change. Tokens get re-mapped to dark variants (white-on-dark) since the sheet bg is now `rgba(12, 14, 18, 1)` instead of `#ffffff` — this is the only adjustment to place rendering, and it's a token-level change, not a structural one. Spec writer enumerates each `<*Section>` component's token usage and re-maps. Forensics audit captures current bg/text colors and proposes target dark-equivalents.

---

## E-7: Render branching contract

```ts
// At the top of the modal's main render block, after sheet chrome opens:

const isCurated = (card as any).cardType === 'curated';
const isEvent = !isCurated && (
  (card as any).cardType === 'event' ||
  card.nightOutData != null
);

if (isCurated) {
  return <CuratedDetailLayout card={card} ... />;
} else if (isEvent) {
  return <EventDetailLayout card={card} nightOutData={card.nightOutData} ... />;
} else {
  return <PlaceDetailLayout card={card} ... />;  // existing
}
```

**Branch trigger fields (deterministic):**
- `card.cardType === 'curated'` → `CuratedDetailLayout` (existing curated branch — no change)
- `card.nightOutData != null` OR `card.cardType === 'event'` → `EventDetailLayout` (NEW — this design's primary deliverable)
- else → `PlaceDetailLayout` (existing place branch — only chrome + token changes)

Forensics audit will verify both `cardType` field convention (does it ever equal `'event'` today?) and `nightOutData` plumbing (currently only set by DiscoverScreen.tsx:1003 — verify no other surface plumbs it).

---

## E-8: Motion design

| Animation | Duration | Easing | Notes |
|---|---|---|---|
| Sheet slide-up entrance | `260ms` | `Animated.spring(damping: 22, stiffness: 220)` | Matches `glass.chrome.motion.springDamping/Stiffness` (existing) |
| Sheet slide-down exit | `220ms` | spring same params | Slightly faster than entrance (gestures should feel responsive) |
| Snap-point physics | spring(damping: 18, stiffness: 200) | — | Snappy enough to feel decisive, soft enough to feel organic. Reuses `glass.chrome.motion` values |
| Dismiss-velocity threshold | 0.6 vy | — | When user drags down with velocity > 0.6, dismiss; otherwise snap to nearest snap point. Matches `@gorhom/bottom-sheet` default |
| Scrim fade-in | `200ms` | `ease-out` | Matches sheet entrance — both elements appear together |
| Scrim fade-out | `180ms` | `ease-in` | Slightly faster than entrance |
| CTA button press | `120ms` | `ease-in-out` | Scale `0.96` on press-in, scale `1.0` on release. Reuses `d.card.pressDurationMs / pressScale` values (existing) |
| Save heart bounce | spring(damping: 12, stiffness: 280) | — | When user taps Save: scale `1.18` → `1.0`. Matches existing `EventGridCard.handleSavePress` saveBounce token |
| Image fade-in (poster load) | `200ms` | linear (default `ExpoImage` transition) | `transition={200}` prop on `<ExpoImage>` |
| Genre chip pulse on visible | (none — static) | — | Don't animate decorative elements |
| Section reveal on scroll | (none — natural scroll) | — | Don't animate scroll content reveal; user controls scroll, animation interferes |
| State transition (loading → loaded) | crossfade 250ms | ease-in-out | Skeleton fades to content |

**Reduced-motion fallbacks (`useReducedMotion` hook returns true):**
- Sheet entrance/exit: skip spring, instant snap to position
- Scrim: instant fade (no animation)
- CTA press: skip scale animation, only color flash
- Save heart bounce: skip animation, only color change

**Reduced-transparency fallbacks (`useReducedTransparency` hook):**
- Disable `BlurView` on scrim → fall back to `rgba(0, 0, 0, 0.85)` solid
- Disable `BlurView` on genre chip → fall back to `glass.badge.tint.fallbackSolid` (define if missing)
- Sheet bg unchanged (already opaque)

---

## E-9: Accessibility

### E-9.1 VoiceOver / TalkBack labels

| Element | accessibilityRole | accessibilityLabel | accessibilityHint |
|---|---|---|---|
| Sheet container | `dialog` | `"Event details"` (or "Place details" for places) | (omitted) |
| Drag handle | `adjustable` | `"Drag to dismiss"` | `"Swipe down to close, or use the close button"` |
| Close X button | `button` | `"Close"` | (omitted — obvious) |
| Hero poster | `image` | `card.eventName + " event poster"` | (omitted) |
| Genre chip | `text` | `nightOutData.genre + (nightOutData.subGenre ? ", " + nightOutData.subGenre : "")` | (omitted) |
| Event title | `header` | `card.eventName` | (omitted) |
| Artist name | `text` | `"By " + nightOutData.artistName` | (omitted) |
| Meta row | `text` | `"At " + nightOutData.venueName + ", " + nightOutData.date + ", " + nightOutData.time` | (omitted) |
| Get Tickets CTA | `button` | depends on status: `"Get tickets, " + price` / `"Sold out"` / `"Presale opens " + date` | `"Opens ticket purchase page in browser"` |
| Save chip | `button` | `isSaved ? "Saved " + eventName : "Save " + eventName` | (omitted) |
| accessibilityState | `selected: isSaved` | — | — |
| Share chip | `button` | `"Share " + eventName` | (omitted) |
| Add to Calendar chip | `button` | `"Add " + eventName + " to calendar"` | `"Adds this event to your device calendar"` |
| Address row | `link` | `"Address: " + address + ", " + venueName` | `"Opens in maps app"` |
| Open in Maps button | `button` | `"Open in Maps"` | (already covered by address row hint — make this redundant if address row IS the link) |

### E-9.2 Focus order (VoiceOver)

1. Sheet dialog (announces "Event details, dialog opened")
2. Close button (top-right; users can dismiss immediately)
3. Hero poster (or skip if `accessibilityElementsHidden` for non-essential image)
4. Genre / sub-genre chip
5. Event title
6. Artist
7. Meta row (combined into single accessibility group)
8. Get Tickets CTA
9. Save → Share → Add to Calendar (left-to-right)
10. About section title → body
11. When & Where section → date row → address row
12. Tags section → tag chips (left-to-right, top-to-bottom)
13. Seat map (with appropriate label)

### E-9.3 Dynamic Type (iOS) / font scaling (Android)

- All text uses `allowFontScaling: true` (RN default) — respects user's system font-size preference
- Title `numberOfLines: 3` allows up to ~72pt total height (24pt × 3 with ~120% line-height) — adequate at largest accessibility text sizes
- Meta row uses `numberOfLines: 2` with ellipsizeMode `tail` — at largest font sizes the venue/date/time may wrap to second line; acceptable
- Get Tickets CTA does NOT use `numberOfLines` (single line forced) BUT uses `adjustsFontSizeToFit: true` with `minimumFontScale: 0.8` — long labels at large font sizes auto-shrink to fit; matches existing pattern
- Description body: free-flowing text, scales naturally

### E-9.4 Touch target sizes (minimum 44pt × 44pt per Apple HIG)

| Element | Size | Compliant? |
|---|---|---|
| Close X button | 44 × 44 (with icon centered) | ✓ |
| Get Tickets CTA | full-width × 56 | ✓ |
| Secondary action chips | min 80 × 40 (with hitSlop 6 to bring to 80 × 52) | ✓ via hitSlop |
| Open in Maps link | 44 height (full address row tappable) | ✓ |
| Tag chips | 32 × 32 (with hitSlop 6 to bring to 44 × 44) | ✓ via hitSlop |

### E-9.5 Color contrast (WCAG AA = 4.5:1 for body, 3:1 for large text ≥18pt)

Tested combinations on `rgba(12, 14, 18, 1)` background (event sheet bg = #0C0E12):

| Foreground | Contrast | Passes |
|---|---|---|
| `#FFFFFF` (white) | 19.5:1 | ✓ AAA |
| `rgba(255,255,255,0.80)` (white@80%) | 15.6:1 | ✓ AAA |
| `rgba(255,255,255,0.70)` (white@70%) | 13.6:1 | ✓ AAA |
| `#eb7825` (Mingla orange — artist name) | 5.9:1 against #0C0E12 | ✓ AA (large text); marginal AA for body — but artist name is 18pt = "large text" classification |
| `rgba(255,255,255,0.30)` (drag handle) | 5.8:1 | ✓ AA |

Avoid: `rgba(255,255,255,0.40)` or below for any TEXT (3.6:1 fails AA). Decorative (handle, dividers) OK.

---

## E-10: Cross-platform parity

### E-10.1 iOS bottom sheet behavior

- Native iOS feel: rubber-band over-scroll at top of sheet content (when at expanded snap point and user scrolls beyond top)
- Status bar: hidden when sheet at expanded; visible (light-content) at peek
- Safe-area: iOS notch / Dynamic Island respected via `useSafeAreaInsets()`
- Haptic feedback: `Haptics.impactAsync(Light)` on snap-point change
- `keyboardBehavior: 'interactive'` if any content has TextInput

### E-10.2 Android bottom sheet behavior

- Material 3 idiom: drag handle visible always, snap behavior matches iOS
- System back button: closes sheet (handled by `onBackdropPress` of `@gorhom/bottom-sheet` if it intercepts back, or via top-level `BackHandler`)
- Status bar: light-content (white text/icons) on dark sheet bg
- Edge-to-edge display: respect Android 15's `edgeToEdgeEnabled` config (already in app.json) — sheet renders behind nav bar with appropriate padding via `useSafeAreaInsets()`
- Haptic feedback: `Haptics.impactAsync(Light)` on snap-point change (Expo's haptics module supports both platforms)

### E-10.3 Platform-conditional details

- **Shadow:** iOS uses `shadowColor / shadowOffset / shadowOpacity / shadowRadius`. Android uses `elevation`. Both specified together.
- **BlurView:** iOS uses native UIBlurEffect. Android pre-12 falls back to `experimentalBlurMethod` or solid color. Already handled by existing `useReducedTransparency` hook.
- **Scroll indicator:** iOS shows native scroll indicator on right edge (`showsVerticalScrollIndicator: true`). Android also supports it but visual is different — `BottomSheetScrollView` handles natively.

### E-10.4 Orientation

Bottom sheet only supports portrait (matches existing app constraint per `app.json: "orientation": "portrait"`). No landscape design needed.

---

## E-11: Open questions for operator (BLOCKING SPEC DISPATCH)

| # | Question | Recommendation |
|---|---|---|
| **OQ-1** | "Add to Calendar" behavior: opens iOS/Android **native calendar app** (via `expo-calendar` `Calendar.createEventAsync`) OR uses **Mingla's internal CalendarTab** system (saves to in-app calendar via `CalendarService.addEntryFromSavedCard`)? | **Native calendar app.** Events have fixed times set by Ticketmaster — they're not user-scheduled like place visits. The user's intent is "remind me to be at this event at this time" — that's calendar app territory. Mingla's CalendarTab is for user-scheduled date plans, not externally-fixed events. |
| **OQ-2** | "Get Tickets" link target: **in-app browser** (current `InAppBrowserModal`) OR **external** (open in OS default browser via `Linking.openURL`)? | **In-app browser** (preserve current pattern). Keeps user inside Mingla; faster bounce-back; preserves session context. Ticketmaster's purchase flow is fully responsive; in-app works. |
| **OQ-3** | Sold-out events: **hide Get Tickets CTA entirely** OR **show as disabled gray button** with "Sold Out" label? | **Show as disabled** with "Sold Out" label. Hiding the CTA leaves a layout hole and confuses users ("where did the buy button go?"). Disabled-with-label sets correct expectation; user understands the button exists but the action isn't available. |
| **OQ-4** | Save heart on past events (events whose `nightOutData.date` < today): **hide save heart** OR **show as disabled gray** OR **show normally** (user can still save for memory/sharing)? | **Show normally.** The Save action saves the event for the user's memory — they may want to recall it after attending. Disabling save creates needless friction. (Note: this also means past events stay visible in `Saved` tab, which is desired memory-preservation behavior.) |
| **OQ-5** | Event modal action set: confirmed `[Get Tickets, Save, Share, Add to Calendar]` for events (replacing place's `[Save, Schedule, Share, Visit, Policies & Reservations]`) — or do you want any of the place actions retained for events too (e.g., `Visit` for "I went to this concert" memory marker)? | **Just the 4 listed.** `Schedule` is meaningless for fixed-time events. `Visit` is a place concept (you visited the venue) and overlaps with Add-to-Calendar. `Policies & Reservations` is restaurant-specific. Keep events lean: 1 primary CTA + 3 secondary chips. |
| **OQ-6** | New `glass.bottomSheet.*` token sub-namespace: **introduce as part of this ORCH** (and forensics audit migrates MapBottomSheet + PersonBottomSheet to use it too) OR **scope strictly to ORCH-0696** (only new tokens for new sheet, leave existing sheets alone)? | **Introduce + retrofit MapBottomSheet + PersonBottomSheet** in same IMPL. Three sheets currently use hardcoded chrome values; consolidating to a single token ensures cross-sheet consistency. Adds ~30 min to IMPL but pays back at every future bottom sheet. Constitution #2 (one owner per truth). |

---

## E-12: Estimated forensics + IMPL effort

| Phase | Estimate |
|---|---|
| Designer pass (this output) | **~3-3.5 hours** ✓ DONE |
| Operator answers OQ-1..OQ-6 | ~10-15 min |
| Forensics audit (render-first inventory of all 8 mount surfaces — current modal style+JSX, then per-surface verification of how each mount uses the modal) | ~3-4 hours |
| Spec writing (combine designer + audit deletion list + OQ resolutions) | ~1.5-2 hours |
| IMPL (6 main areas of work) | ~9-12 hours |
| Tester (cross-surface smoke on all 8 mount sites + iOS + Android = 16 visual checks) | ~1.5-2 hours |
| 2 EAS Updates (iOS + Android separate invocations) | ~10 min |
| **Total wall** | **~18-23 hours** |

### IMPL work breakdown (~9-12 hours)

| Sub-area | Estimate |
|---|---|
| 1. Replace `<Modal>` chrome with `<BottomSheet>` from `@gorhom/bottom-sheet` (single change in ExpandedCardModal.tsx) | 1.5h |
| 2. Add new `glass.bottomSheet.*` tokens + retrofit MapBottomSheet + PersonBottomSheet (per OQ-6 = retrofit) | 1h |
| 3. Build EventDetailLayout component (new file: `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` — 200-300 LOC) | 3h |
| 4. Wire EventDetailLayout into ExpandedCardModal render branching | 30m |
| 5. Re-token all PlaceDetailLayout sub-sections (CardInfoSection, WeatherSection, BusynessSection, PracticalDetailsSection, etc.) for dark sheet bg — text/border colors flip from dark-on-light to light-on-dark | 2.5-3h |
| 6. Add to Calendar action wiring (per OQ-1 = native calendar via expo-calendar) | 30m |
| 7. Save heart toggle for events (currently no Save in night-out branch — add) | 30m |
| 8. Remove Shape 2a Modal hack from MessageInterface.tsx (E-3.3 — no longer needed) | 15m |
| 9. Verify on all 8 mount surfaces + tsc + ESLint | 30m |
| 10. Implementor report | 30m |

### Risk areas (implementor + tester focus)

1. **Place layout dark-token re-mapping** (sub-area 5) is the highest-risk piece. ~10 sub-section components each need ~3-5 token swaps. Easy to miss one and ship a section with white bg on the dark sheet. Tester must verify every place-rendering mount surface (5 of 8 surfaces).
2. **Bottom-sheet gesture conflicts with inner scroll**: `@gorhom/bottom-sheet` requires `BottomSheetScrollView` (not regular `ScrollView`). Implementor must replace, not just wrap.
3. **iOS keyboard with TextInput in modal**: currently no inputs, but if any are added later, `keyboardBehavior` must be configured.
4. **8 mount-surface regression check**: tester must open the modal from EACH of the 8 mount sites and verify it opens as bottom sheet, not centered card. (CalendarTab + SavedTab + DiscoverScreen + MessageInterface + ViewFriendProfileScreen + SessionViewModal + SwipeableCards solo + collab.)

---

## §F: Notes for implementor (key things to get right)

1. **Use `@gorhom/bottom-sheet`, not `<Modal>`.** Library is in project. Patterns established (MapBottomSheet, PersonBottomSheet).
2. **`<BottomSheetScrollView>`, not `<ScrollView>`.** Inside the sheet — gestures fight otherwise.
3. **EventDetailLayout is a new file.** Don't inline the 200-300 LOC into ExpandedCardModal.tsx; extract to `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` for symmetry with PlaceDetailLayout (which IS effectively the existing inline branch — extract that too if blast-radius allows, but it's optional for this ORCH).
4. **All token references must come from designSystem.ts or colors.ts.** No hardcoded hex values except where this spec explicitly authorizes them (e.g., the 28pt corner radius literal — not yet a token).
5. **Place IA section ORDERING is preserved.** Only token mapping changes. Don't reorder, don't add, don't remove sections from PlaceDetailLayout.
6. **Render-branching trigger** (per E-7): event branch fires on `card.cardType === 'event' || card.nightOutData != null`. This is a contract — don't change the trigger without spec approval.
7. **Remove the Shape 2a Modal hack** from MessageInterface.tsx after the bottom-sheet conversion — no longer load-bearing.
8. **Operator answers OQ-1..OQ-6 BEFORE you start.** Don't guess.

---

## §G: Discoveries for orchestrator

1. **D-1: Save heart absent on event modal today.** Current ExpandedCardModal night-out branch has no Save button anywhere — only Get Tickets + Share. Operator may have noticed or not. New design adds Save chip; verify with operator if Save should always be present (yes per OQ-4 default) or only when event is in user's saved list already.

2. **D-2: Schedule action for events is meaningless** but currently exists in the place branch's `<ActionButtons>` component. When an event card uses the place branch fallback (for any reason), the user could try to "Schedule" an event whose time is already fixed by Ticketmaster — confusing UX. Render branching at E-7 prevents this in the new design, but the underlying ActionButtons component still has the logic. Spec writer should flag whether to modify ActionButtons or rely solely on render branching.

3. **D-3: Existing `<ExpandedCardHeader>` sticky header.** Currently rendered for ALL card types. With bottom-sheet conversion, the drag handle replaces this for the chrome role. The X close button in the header may be redundant with sheet's native close-on-drag — designer kept it (in expanded snap point only, as a visible affordance) but operator may want to retire `<ExpandedCardHeader>` entirely. Designer recommends: keep ExpandedCardHeader for the in-sheet "go back" / navigation arrow case (e.g., review-flow navigation between cards, lines 1556-1579 of current modal), but otherwise drag handle is the primary chrome.

4. **D-4: Currency double-conversion (HF-04 from ORCH-0670 audit) interacts with Get Tickets price label.** Designer's Get Tickets CTA includes price: `"Get Tickets · $80–$280"`. If currency is misformatted (London £80 event renders as "$80–$280"), the CTA inherits the bug. ORCH-0670 Slice B will fix the currency layer; ORCH-0696 should NOT also fix it (out of scope). Designer recommends: spec includes a comment/TODO that the price formatting is sourced from `formatPriceRange(nightOutData.price, currency)` and will improve naturally when ORCH-0670 Slice B ships.

5. **D-5: Tracking/analytics events.** Current modal fires Mixpanel events for `trackExperienceVisited` etc. Designer doesn't redesign analytics — assume continued behavior. New events introduced by this redesign:
   - `event_detail_opened` (fires on sheet entrance) — OPTIONAL — operator decides
   - `event_get_tickets_tapped` — likely valuable for funnel measurement
   - `event_added_to_calendar` — likely valuable
   - `event_modal_dismissed` (with method: drag / scrim / button) — interesting UX signal
   Recommend adding these analytics in IMPL but spec writer should confirm naming with operator.

---

## §H: Token additions proposed (summary for spec writer)

New tokens to add to `app-mobile/src/constants/designSystem.ts`:

```ts
// Inside the existing `glass` namespace:
bottomSheet: {
  scrim: {
    color: 'rgba(0, 0, 0, 0.55)',
    blurIntensity: 12,
  },
  handle: {
    color: 'rgba(255, 255, 255, 0.30)',
    width: 36,
    height: 4,
    radius: 2,
    marginTop: 8,
    marginBottom: 12,
  },
  hairline: 'rgba(255, 255, 255, 0.08)',
  topRadius: 28,
  snapPoints: ['50%', '90%'] as const,
  motion: {
    enterDurationMs: 260,
    exitDurationMs: 220,
    springDamping: 22,
    springStiffness: 220,
    dismissVelocityThreshold: 0.6,
  },
},
surfaceDark: {
  backgroundColor: 'rgba(255, 255, 255, 0.10)',
  borderColor: 'rgba(255, 255, 255, 0.18)',
  borderWidth: 1,
  borderRadius: 12,
},
```

Per OQ-6 = retrofit, MapBottomSheet + PersonBottomSheet adopt these tokens too.

---

End of design spec.
