# DESIGN ADDENDUM — META-ORCH-1059 [experiences-business-parity] · WIZARD: STOPS + PRICING

**ORCH:** META-ORCH-1059 [experiences-business-parity]
**Skill:** mingla-designer (mode: SCREEN + COMPONENT)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Status:** **SUPERSEDES the wizard section of the main design** (`DESIGN_META-ORCH-1059_EXPERIENCES_LIFECYCLE.md` §SUB-A A.2 "When" + A.3 "Pricing" — the single-venue/GA-VIP-tier model). Everything else in the main design (Identity step, Cover step, dashboard Sub-B, public page Sub-C, checkout Sub-D LOCKED to `ticket-checkout-create`, guards Sub-E, analytics Sub-F) **remains in force** except where this addendum touches the underlying data shape (flagged in §6).
**Anchors:** Investigation `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1059_EXPERIENCES_BUSINESS_PARITY.md`; main design (above); curated card types `app-mobile/src/types/curatedExperience.ts`; curated render `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`.
**Tokens:** `mingla-business/src/constants/designSystem.ts`. Every value below is a token; zero magic numbers introduced (the only literals are pre-existing values explicitly matched for parity, mapped to tokens in new code — see §0.4).

**Comms-ledger acks (read on entry):** **COMMS-0014** + **COMMS-0016** (BLOCK-grade: experience checkout MUST route through the existing `ticket-checkout-create` edge fn / `biz_ticket_checkout_create_session` RPC — no parallel money fn). This addendum changes only the *authoring shape* (multi-stop) and the *pricing-mode UI*; it introduces **zero** new payment UI and **zero** money-engine changes. The whole itinerary still resolves to ONE sellable `ticket_types` row → checkout is byte-identical to the main design's Sub-D. **COMMS-0013** (web-vs-native tax basis) carried forward unchanged (Q-RES-6). No new cross-ORCH discovery this turn.

**References examined (premium-craft §3):** Airbnb Experiences host "itinerary" builder (ordered stop list with add/reorder, per-stop photo + title + duration), Komoot / AllTrails route-builder (numbered waypoint reorder + drag handles + per-waypoint detail), Eventbrite/Tock multi-item editor (itemized line list that sums to a buyer total), Partiful (warm sequencing language "first / then / end"), Apple Maps "Guides" stop cards (numbered badge + image + place name), Resy/Tock prix-fixe ("one price, multiple courses" mental model). **Synthesis:** the strongest in-product anchor already exists in Mingla — the **consumer curated-deck card** (`CuratedExperienceSwipeCard`) renders a numbered multi-stop itinerary with `Start Here / Then / End With` labels, an image strip, glass badges, and a cumulative price. The genius move is **make the wizard author exactly that shape** so the brand is building the card it will be judged by on the deck. The stops builder is therefore "an editable, validated, mirror of the curated card's `CuratedStop[]`," and pricing is "one prix-fixe price OR an itemized per-stop breakdown that sums to that price" — the Tock/Resy mental model, not the Eventbrite multi-tier ladder.

---

## 0. EXECUTIVE SUMMARY (read this; the rest is build detail)

The operator reframed an experience from *single-venue offering with GA/VIP tiers* to a **brand-authored 2–5-stop ITINERARY** — the same shape a consumer sees as a curated-intent card on the swipe deck, but **priced, bookable, and brand-distinguished**. The wizard's two genuinely-new steps are therefore:

- **Step 2 — STOPS (was "Venue"):** an ordered builder for **2–5 stops**. Each stop = a Google-validated address (via the canonical `AddressAutocompleteInput` → `places-autocomplete` edge fn), a stop name, image(s), an **optional** start time, and an **optional** per-stop price (only relevant in per-stop pricing mode). Reorder updates the `Start Here / Then / End With` labels live. A collapsible **live deck-card preview** shows the brand exactly how the itinerary will read on the consumer deck. Stop 1 defaults to the brand's saved venue/address.
- **Step 4 — PRICING (reframed):** a two-way **mode toggle** — **"One price for the whole experience"** vs **"Price each stop."** The buyer ALWAYS buys the whole itinerary → exactly **ONE sellable ticket** per experience. Whole-mode = single price (or Free) + total capacity. Per-stop mode = the per-stop price list (pulled live from Step 2) that auto-sums to a read-only total + total capacity. A persistent **"Buyers pay {total} for all {N} stops"** summary line makes the single-ticket truth unmistakable. `WhoCoversCostsSection` (the 3 pass/absorb switches) is kept **verbatim**.

**The one-ticket invariant (the design's spine):** no matter the pricing mode, the experience materializes **one `ticket_types` row** at the computed total — so COMMS-0014/0016 hold by construction and Sub-D checkout is unchanged. Per-stop prices are an **itemized breakdown shown to the buyer**, never individually selectable, never separate SKUs.

**The new data shape (proposed; SPEC formalizes — §6):** each authored stop maps 1:1 onto a `CuratedStop`. Stops persist as either an **`experience_stops` table** (recommended) OR a structured `theme.experience_meta.stops[]` JSON array, shaped to mirror `CuratedStop` so the deck card, the public detail page, and the business dashboard all read from **one source**. The deck card gains a brand-distinguishing treatment (brand byline + warm "Mingla Experience" badge + a **"Book"** CTA instead of "Save").

**What this supersedes:** the main design's "When = recurrence segmented control" and "Pricing = multi-tier ticket ladder" are **out**. (Recurrence/multi-date for *when the itinerary runs* stays a separate concern handled by the unchanged **When** step which still lifts `CreatorStep2When` — see §3.) The tier ladder is replaced by the two-mode pricing model here.

---

## 0.1 — Wizard shape (5 steps, unchanged count)

`Identity · Stops · When · Pricing · Cover`

| # | Step | Status vs main design | This addendum |
|---|------|----------------------|---------------|
| 1 | Identity | unchanged (main design A.1) | — |
| 2 | **Stops** (was "Venue") | **REDESIGNED here** | §2 |
| 3 | When | unchanged — still lifts `CreatorStep2When` (main design A.2) | §3 (note only) |
| 4 | **Pricing** | **REDESIGNED here** | §4 |
| 5 | Cover | unchanged (main design Cover; `CreatorStep4Cover` pattern) | — |

`Stepper` labels become `Identity · Stops · When · Pricing · Cover` (rename index-1 "Venue"→"Stops" in `STEPS`, `ExperienceCreatorWizard.tsx:78-84`).

## 0.2 — Cross-cutting design constants (apply to both new steps)

**Color tokens (designSystem.ts):** Canvas `canvas.discover` (#0c0e12). Primary action / selection `accent.warm` (#eb7825); `accent.tint` (rgba .28) selected-fill; `accent.border` (rgba .55) selected-border. Text `text.primary` (.96) / `text.secondary` (.72) / `text.tertiary` (.52) / `text.quaternary` (.32) / `text.inverse` (#fff). Surfaces `glass.tint.profileBase` + `glass.border.profileBase` (inputs/cards), `glass.tint.profileElevated` + `glass.border.profileElevated` (raised stop cards). Semantic `semantic.error` (#ef4444) + `semantic.errorTint`; `semantic.success` (#22c55e) + `semantic.successTint`.

**Contrast (computed, dark-only app):**
- `text.primary` ≈ #F4F4F5 on `canvas.discover` #0c0e12 → **16.9:1** (body ✓ ≥4.5).
- `text.secondary` ≈ #B0B0B3 on #0c0e12 → **8.9:1** (✓).
- `text.tertiary` ≈ #838385 on #0c0e12 → **4.9:1** (✓ ≥4.5 body; safe for the ≥3:1 caption use).
- `accent.warm` #eb7825 on #0c0e12 → **6.4:1** (price/CTA labels at ≥16/700 — large-text bar ✓; also clears body bar).
- `text.inverse` #fff on `accent.warm` #eb7825 (primary CTA fill) → **2.6:1** — **below 4.5 for body**; this is the EXISTING events/trips/`Button variant="primary"` CTA treatment, used here only at 16pt/600 (large per WCAG → clears the 3:1 bar). KEEP parity; flagged as inherited, not new.
- `semantic.error` #ef4444 on #0c0e12 → **4.6:1** (✓ body — used for inline validation copy).

**Spacing/radius:** only `spacing.*` (2/4/8/16/24/32/48) and `radius.*` (8/12/16/24/28/40/999). Stop-card image thumb radius `radius.md` (12); stop card radius `radius.lg` (16); badge `radius.full`.

**Android glass policy ([[android-glass-policy-opaque-fallback]]):** every card/input reuses the shared `GlassCard` / `Input` / `AddressAutocompleteInput` primitives which already carry the opaque-≥0.92 Android fallback + `overflow:'hidden'` + zeroed Android elevation (`androidSafeElevation`). No hand-rolled translucent fills. The numbered stop badge reuses the shared badge skin (opaque tint on Android).

**Motion (reuse existing system; `prefers-reduced-motion` honored by shared components):** Press feedback `pressed && opacity` (0.7 icon buttons, 0.82–0.9 cards) — non-shifting, no layout shift on press. Add/remove stop: list re-flow via the platform default `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` (≈`durations.normal` 200) guarded by `AccessibilityInfo.isReduceMotionEnabled` (instant when reduced). Reorder: the moved row crossfades label text (`durations.instant` 80) — no spring. Sheets (time picker, image picker) reuse the shared `Sheet` (slide-up `durations.entry` 260 / exit 180; cross-fades when reduced-motion is set). Mode-toggle in Pricing: instant (`durations.instant`) background swap, no spring.

**Accessibility baseline:** every interactive element ≥44pt (icon buttons 44×44 hitbox; rows `minHeight: 44`; stop-card primary tap area ≥76), `accessibilityRole` + per-element `accessibilityLabel` (specified inline), reading order = visual order (single `ScrollView`; the only out-of-flow elements are the autocomplete dropdown and sheets, both last-in-DOM and labeled).

## 0.3 — Architectural decision (locks implementor)

**Do NOT fork `CreatorStep2When`/`CreatorStep5Tickets` into the stops/pricing steps** — those solve a *different* shape now. The Stops step is **net-new** (no event analog: events have one venue). The Pricing step is **net-new** (events use the multi-tier ladder; experiences use the two-mode whole-vs-per-stop model). **Reuse at the primitive level, not the step level:** `AddressAutocompleteInput` (address), the `DateTimePicker` + `Sheet` time-picker mechanics lifted from `CreatorStep2When` (per-stop optional time), `CoverPicker`/`expo-image-picker` device-upload path (stop images), `GlassCard` / `Input` / `Button` / `Icon` / `Toast`, and `WhoCoversCostsSection` (verbatim). The **When** step still lifts `CreatorStep2When` whole (it answers "what date(s) does this itinerary run" — orthogonal to stops).

## 0.4 — Pre-existing literals matched for parity (not new magic numbers)

- Toggle track `width 44 / height 26 / thumb 20` — the exact `CreatorStep3Where` `toggleTrack`/`toggleThumb` values; reuse that StyleSheet block verbatim for any switch.
- Stop image thumb `64×64` — matches the codebase MiniCard thumbnail convention; expressed as a named const `STOP_THUMB = 64` in the new component (a 4px-grid multiple: 16×4).
- Deck-card chrome (image-strip ratio 0.88, card radius 20, `#1C1C1E` card bg) live in the consumer app's `CuratedExperienceSwipeCard` and are **not edited by the wizard** — the wizard preview renders a *scaled facsimile* using business tokens (`canvas.discover` bg, `radius.lg`), not the consumer literals. See §5.

---

## 1. THE MOMENT (IA before pixels)

**Stops step.** The brand just named their experience. Now they answer: *"Where does the night actually go?"* This is a **sequencing** task — order matters, and the brand is mentally walking the buyer through a route. The cognitive load is "build a list of 2–5 places, each validated, in the right order." The primary action is **add a stop**; the secondary actions are reorder/remove/edit-detail. The emotional target: *"this feels like designing a great night, not filling a form."* The deck-card preview pays this off — the brand sees their itinerary become the thing buyers will swipe on.

**Pricing step.** The brand just built the route. Now: *"What do buyers pay — and is it one price or a per-stop breakdown?"* This is a **decision** (the mode) followed by **entry** (the number(s)). The single most important thing to communicate: **buyers buy the whole thing, once.** Per-stop pricing is a *presentation* choice (itemized receipt), not a *purchasing* choice. The persistent total summary is the anchor that prevents the brand from thinking they're creating multiple SKUs.

---

## 2. STEP 2 — STOPS (the stops builder)

**File:** `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` — replaces the Step-2 "Venue" body (`:273-288`). New extracted component recommended: `mingla-business/src/components/experience/ExperienceStopsStep.tsx` (keeps the wizard host thin; mirrors how event steps are extracted).

### 2.1 — Layout (top → bottom)

```
View.stepBody (gap spacing.md)
├─ Text.title (h2, text.primary)            "Build the itinerary"
├─ Text.body  (body, text.secondary)        "Add 2–5 stops. Drag to reorder — the order is the route your buyers follow."
│
├─ <StopCard> × N   (each = one CuratedStop being authored; see §2.2)   [reorderable list]
│
├─ <AddStopCta>     dashed, accent.warm, "+ Add stop"  (hidden when N === 5)
│
├─ Text.helper (caption, text.tertiary)     <dynamic count/limit line, see §2.4>
│
└─ <DeckCardPreviewToggle>  collapsible "Preview as a deck card"  (see §5)
```

### 2.2 — `<StopCard>` anatomy (one per stop)

A `GlassCard variant="elevated"` (radius `radius.lg`, padding `spacing.md`, gap `spacing.sm`). The card is a vertical stack; the address autocomplete and its dropdown must be the **last** focusable block in the card so the dropdown overlays the content below (matches `CreatorStep3Where`).

```
GlassCard.stopCard
├─ Row.header (align center, gap spacing.sm)
│   ├─ <StopBadge>  circular, accent.warm fill, text.inverse number  ("1"/"2"/…)  44×44 — see §2.3
│   ├─ View.labelCol (flex 1)
│   │   ├─ Text.stopLabel (labelCap, accent.warm)   "START HERE" / "THEN" / "END WITH"   ← derived from order (§2.6)
│   │   └─ Text.stopHint  (caption, text.tertiary)  "Stop {n} of {N}"
│   └─ Row.controls (gap spacing.xs)
│        ├─ <IconBtn icon="chevU"  onPress=moveUp    disabled={isFirst} label="Move stop up">
│        ├─ <IconBtn icon="chevD"  onPress=moveDown  disabled={isLast}  label="Move stop down">
│        └─ <IconBtn icon="trash"  onPress=remove    disabled={N<=2}    label="Remove stop"  tint=semantic.error>
│
├─ Field: Stop name
│   ├─ Text.fieldLabel (caption/500, text.secondary)  "Stop name"
│   └─ <Input variant="text" value=name placeholder="e.g. Rooftop welcome drinks" clearable
│            accessibilityLabel="Stop {n} name"  errorBorder when showErrors && !name>
│
├─ Field: Address  (Google-validated — canonical picker)
│   ├─ Text.fieldLabel  "Address"
│   └─ <AddressAutocompleteInput
│            value={stop.address}
│            onChangeText={(v)=>updateStop(i,{address:v, placeId:null, city:null, lat:null, lng:null, region:null, countryCode:null})}
│            onPick={(d:PlaceDetails)=>updateStop(i,{
│                 address:d.formattedAddress, placeId:d.placeId, city:d.city,
│                 region:d.region, countryCode:d.countryCode, lat:d.location.lat, lng:d.location.lng })}
│            onClear={()=>updateStop(i,{address:null,placeId:null,city:null,region:null,countryCode:null,lat:null,lng:null})}
│            error={addressErrorFor(i)}
│            placeholder="Pick a place" />
│        // validity = stop.placeId !== null (free typing without a pick is INVALID, mirrors CreatorStep3Where)
│
├─ Field: Photos
│   ├─ Text.fieldLabel  "Photos"
│   ├─ Row.thumbStrip (horizontal, gap spacing.sm)  ← up to 5 thumbs, mirrors CuratedStop.imageUrls
│   │     ├─ <StopThumb uri … onRemove>   64×64, radius.md, X overlay top-right (label "Remove photo")
│   │     ├─ … (per existing image)
│   │     └─ <AddThumbBtn>  64×64 dashed, accent.warm "+" icon  (hidden at 5; label "Add photo to stop {n}")
│   └─ Text.helper (caption, text.tertiary)  "First photo is the one buyers see first."
│
├─ Field: Start time  (OPTIONAL)
│   └─ <OptionalTimeRow
│         set?   → Pressable row: Icon "time" + "{h:mm a}"  +  trailing "Clear" ghost
│         unset? → Pressable row (dashed): Icon "time" + "Add start time (optional)"
│         onPress → opens shared time Sheet (DateTimePicker mode="time"; web hidden HTML5 input)>
│        // writes stop.startTime as "HH:mm" (local) | null
│
└─ Field: Stop price   ── RENDERED ONLY WHEN pricing mode === 'per_stop' (Step 4)  ──
    ├─ Text.fieldLabel  "This stop's price"
    └─ Row: <Input variant="currency" value=priceMajor placeholder="0.00"
                 leadingText={currencySymbol} accessibilityLabel="Price for stop {n}">
        // when whole-experience mode: this field is absent; per-stop prices are ignored/zeroed.
        // (See §4.3 for how the two steps stay in sync.)
```

**`<IconBtn>`**: a 44×44 `Pressable`, `pressed && {opacity:0.7}`, `hitSlop 8`, icon `size 18`, `accessibilityRole="button"` + the labels above. Disabled state: `opacity 0.32` + `accessibilityState={{disabled:true}}`.

### 2.3 — `<StopBadge>`

Circular, `width/height 44`, `borderRadius radius.full`, `backgroundColor accent.warm`, centered `text.inverse` number at `typography.h3` weight (the wizard-side badge; distinct from the consumer card's `GlassBadge variant="circular"`, which the *preview* uses). On the wizard it's a solid warm chip so the sequence reads at a glance. `accessibilityElementsHidden` (the stop label + hint already announce the number to SR).

### 2.4 — Count/limit helper (dynamic)

| State | Helper copy (caption, text.tertiary unless noted) |
|---|---|
| 0 stops | "Add your first stop to get started." |
| 1 stop | "Add at least 1 more — every experience needs 2–5 stops." (text in `semantic.error` once `showErrors`) |
| 2–4 stops | "{N} of 5 stops. Add more or continue." |
| 5 stops | "Maximum 5 stops reached." (Add CTA hidden) |

### 2.5 — `<AddStopCta>`

Dashed-border full-width `Pressable` (border `accent.border`, `borderStyle:'dashed'`, radius `radius.lg`, `minHeight 56`, centered Icon `plus` `accent.warm` + Text "Add stop" `accent.warm`/600). `pressed && {opacity:0.7}`. Hidden at 5 stops. On press: append a blank stop **prefilled where possible** — if N===0, prefill stop 1 from the brand venue default (§2.7). `accessibilityRole="button"`, label "Add stop".

### 2.6 — Order → label derivation (the sequencing payoff)

`stopLabel` is **derived, never stored** by the editor (mirrors the deck card). Pure function of position + count, matching `CuratedStop.stopLabel`:

```
labelForIndex(i, n):
  if n === 1            → "START HERE"     (not reachable: min 2, but defined for the preview)
  if i === 0            → "START HERE"
  if i === n - 1        → "END WITH"
  else                  → "THEN"
```

(`stopNumber = i + 1`.) Reorder (move up/down) recomputes all labels in the same render. The crossfade (`durations.instant`) on the changed label text makes the re-sequencing legible.

### 2.7 — Stop 1 default (extend `useExperienceVenueDefault`)

When the brand opens Stops with **zero** stops, seed **stop 1** from the brand's saved address. Today `useExperienceVenueDefault` returns only a `defaultVenue` *string* (`brand.address`). Extend it to also expose the brand's structured place when available (placeId/lat/lng/city) so stop 1 lands **already validated** (not just a name). If the brand has only a free-text address, seed stop 1's name from it but leave `placeId=null` so the brand must confirm via a real pick (keeps the always-validated invariant). The seed is a *suggestion*: the brand can clear/replace it. Never auto-seed stops 2–5.

> **Implementor flag S-1:** `useExperienceVenueDefault` currently only reads `brand.address` (string). To seed a *validated* stop 1, the brand record must carry a structured place (placeId/lat/lng) — many brands won't. **Resolution:** seed stop 1's `name`+`address` text from `brand.address`, set `placeId=null`, and show the address field in its "needs a pick" state with helper "Confirm your venue address from the suggestions." This is honest (no fabricated geo) and one tap to validate. Do NOT fabricate a placeId.

### 2.8 — All 9 states (Stops step)

1. **First-time / empty (0 stops):** title + body + (no stop cards) + AddStopCta + helper "Add your first stop." On first open, auto-seed stop 1 from venue default (§2.7) so the brand rarely sees true-empty; true-empty only if the brand deletes down (blocked at 2) — N/A below 2. Continue **disabled**.
2. **1 stop (blocked):** one StopCard, AddStopCta, helper in `semantic.error` "Add at least 1 more — 2–5 stops required." Remove disabled (can't go below… actually 1 is below min — see degraded). Continue **disabled** with helper. *(How you reach 1: only transiently while building up; remove is disabled at exactly 2, so you can't drop to 1 by removal. 1 appears only mid-add.)*
3. **Valid (2–4 stops):** stop cards + AddStopCta + neutral helper. Continue **enabled** once every stop has name + validated address (and, in per-stop mode, a price ≥ 0).
4. **Max reached (5 stops):** AddStopCta hidden, helper "Maximum 5 stops reached." Continue enabled when all valid.
5. **Per-field validation (`showErrors` after a failed Continue):** missing name → input error border + caption "Name this stop." Free-typed address (no pick) → `AddressAutocompleteInput error` = "Pick this stop's address from the suggestions." Per-stop mode missing price → "Set a price for this stop (or 0 for free)." Errors clear on edit.
6. **Address-picking (in-flight):** inherited from `AddressAutocompleteInput` — debounced suggestions dropdown, inline spinner during Place Details fetch, pick-error "Couldn't fetch address details. Tap to try again." (loud, per Constitution #3).
7. **Image uploading:** the AddThumb tile shows an inline `ActivityIndicator` (`accent.warm`) over a dimmed tile while `expo-image-picker` → upload runs; on success the thumb replaces it; on failure a `Toast kind="error"` "Couldn't upload that photo. Tap to retry." and the tile reverts to "+". Other fields stay interactive (per-stop upload is non-blocking).
8. **Reordering:** move-up/down recompute labels with the instant crossfade; the moved card's badge number updates in the same frame. No drag-and-drop in v1 (chevron buttons only — simpler, a11y-clean, no gesture conflict with the ScrollView). *(Drag handles flagged as a v1.1 enhancement, Q-OPEN-3.)*
9. **Degraded / offline:** address autocomplete returns empty (silent — no suggestions); helper unchanged. Image upload fails → toast (state 7). If the device is offline, the AddressAutocompleteInput simply yields no suggestions and the brand can still type+continue is blocked (no validated pick) — honest hard stop, not a crash. A persistent banner is unnecessary; the empty dropdown + blocked Continue communicate it.

### 2.9 — Copy (Stops, Mingla voice)

| Element | Copy |
|---|---|
| Step title | "Build the itinerary" |
| Step body | "Add 2–5 stops. Drag to reorder — the order is the route your buyers follow." |
| Stop name label / placeholder | "Stop name" / "e.g. Rooftop welcome drinks" |
| Address label / placeholder | "Address" / "Pick a place" |
| Address validation error | "Pick this stop's address from the suggestions." |
| Photos label / helper | "Photos" / "First photo is the one buyers see first." |
| Add-photo a11y | "Add photo to stop {n}" |
| Optional time (unset) | "Add start time (optional)" |
| Optional time (set) row + clear | "{h:mm a}" · "Clear" |
| Per-stop price label / error | "This stop's price" / "Set a price for this stop (or 0 for free)." |
| Add stop CTA | "Add stop" |
| Max helper | "Maximum 5 stops reached." |
| Remove (disabled at 2) a11y hint | "You need at least 2 stops." |
| Preview toggle | "Preview as a deck card" |

---

## 3. STEP 3 — WHEN (unchanged; note only)

Per the main design (A.2), the **When** step still lifts `CreatorStep2When` to answer *when the itinerary runs* (one-time / recurring / multiple dates) — that is **orthogonal** to the stop sequence and is NOT touched by this addendum. The per-stop **start time** authored in Step 2 is a *within-the-day* schedule hint (e.g. "Stop 1 at 7:00 PM, Stop 2 at 9:00 PM"), independent of the date(s) the experience runs. The When step owns the **date(s)** + the experience's overall start/end window; Step 2 owns the **per-stop intra-day times**. (Implementor: the experience's master `event_dates` row(s) come from When; per-stop times ride on the stop rows.) No redesign here.

---

## 4. STEP 4 — PRICING (whole-experience vs per-stop)

**File:** replaces the Step-4 body (`ExperienceCreatorWizard.tsx:301-337`). New extracted component recommended: `ExperiencePricingStep.tsx`. `WhoCoversCostsSection` (`:310-336`) is **kept verbatim**.

### 4.1 — Layout (top → bottom)

```
View.stepBody (gap spacing.md)
├─ Text.title (h2)  "Pricing"
│
├─ <PricingModeToggle>   segmented, 2 options (see §4.2)
│      [ One price for the whole experience ] [ Price each stop ]
│
├─ ── MODE A: whole-experience ──────────────────────────────
│   ├─ Field: Price
│   │   ├─ Row: <FreeToggle>  "This experience is free"   (switch; CreatorStep3Where toggle skin)
│   │   └─ if !free: <Input variant="currency" leadingText={sym} value=wholePriceMajor placeholder="0.00"
│   │                       accessibilityLabel="Whole experience price">
│   └─ Field: Capacity (spots)
│       ├─ Row: <UnlimitedToggle> "Unlimited spots"
│       └─ if !unlimited: <Input variant="number" value=capacity placeholder="20"
│                                accessibilityLabel="Total spots available">
│
├─ ── MODE B: per-stop ──────────────────────────────────────
│   ├─ Text.sectionLabel (labelCap, text.tertiary)  "PER-STOP PRICES"
│   ├─ <PerStopPriceRow> × N   (read of Step-2 stops; each: badge# + stop name + price input)
│   │      └─ each price edits the SAME stop.priceMajor that Step 2's per-stop field edits (single source)
│   ├─ Divider (hairline, glass.border.profileBase)
│   ├─ Row.totalRow:  Text "Total"  ···  Text.total (h3, accent.warm)  {sum}   ← READ-ONLY, auto-summed
│   └─ Field: Capacity (spots)  — identical to Mode A (whole-experience capacity)
│
├─ <SoldAsOneSummary>   accent.tint card, always visible (both modes)   (see §4.4)
│      "Buyers pay {total} for all {N} stops — one booking, the whole itinerary."
│
└─ <WhoCoversCostsSection format="experience" … />   ← VERBATIM, unchanged
        previewBaseCents = the computed TOTAL (mode-aware), not a single tier
```

### 4.2 — `<PricingModeToggle>`

A 2-segment control (full width, `glass.tint.profileBase` track, radius `radius.md`, height 44). Selected segment = `accent.tint` fill + `accent.border` border + `text.primary` label; unselected = transparent + `text.secondary`. Instant (`durations.instant`) background swap. `accessibilityRole="tablist"`; each segment `accessibilityRole="tab"` + `accessibilityState={{selected}}`, labels "One price for the whole experience" / "Price each stop". Switching mode is **non-destructive**: whole↔per-stop preserves both the whole price and the per-stop prices in state; only the *resolved total* (and which inputs render) change. (No lossy-switch confirm needed — nothing is discarded.)

### 4.3 — Per-stop ⇄ Step-2 single source (the one cross-step wire)

The per-stop price for stop *i* is **one field** edited from two places: Step 2's StopCard price field (rendered only in per-stop mode) and Step 4's `<PerStopPriceRow>`. Both bind to `stops[i].priceMajor`. This avoids a divergent second list. In **whole-experience** mode, Step 2 hides the per-stop price field and Step 4 hides the per-stop list; the whole price is a separate `wholePriceMajor` field. The **resolved total** that materializes the single ticket:

```
resolvedTotalMajor =
  mode === 'whole'   ? (free ? 0 : wholePriceMajor)
                     : sum(stops[i].priceMajor || 0)
```

### 4.4 — `<SoldAsOneSummary>` (the single-ticket anchor)

A persistent `GlassCard` tinted `accent.tint` (border `accent.border`), Icon `ticket` (`accent.warm`) + copy. Always visible in both modes. Copy is mode-aware:

| Mode / state | Summary copy |
|---|---|
| Whole, paid | "Buyers pay **{sym}{total}** for all **{N}** stops — one booking, the whole itinerary." |
| Whole, free | "Free for buyers — they get all **{N}** stops in one booking." |
| Per-stop, paid | "Stops add up to **{sym}{total}**. Buyers pay it once — one booking, the whole itinerary. They can't buy stops separately." |
| Per-stop, any free stop | (unchanged — the sum just includes 0-priced stops; the line still reads the total) |
| Total = 0 in per-stop mode | "All stops are free — buyers get the whole itinerary at no charge, in one booking." |

This card is the design's load-bearing reassurance: it makes the one-ticket invariant unmissable.

### 4.5 — `WhoCoversCostsSection` (verbatim, total-aware)

Kept exactly as wired (`:310-336`). The only change: `previewBaseCents` now = `Math.round(resolvedTotalMajor * 100)` (mode-aware total) instead of a single tier price. All three pass/absorb switches, the VAT-registration nudge, and the "edit defaults" route are unchanged.

### 4.6 — All 9 states (Pricing step)

1. **First-time / default:** mode defaults to **whole-experience** (simplest mental model), Free toggle off, price empty, capacity prefilled "20" (existing default), summary shows "{sym}0.00 for all {N} stops" until a price is typed. Continue/Publish gated on a valid price (or Free).
2. **Free experience (whole):** Free toggle on → price input hidden, summary "Free … one booking," `WhoCoversCostsSection` preview base = 0. Valid to publish.
3. **Per-stop, all priced:** per-stop list with each price set, total = live sum, summary line. Valid.
4. **Per-stop, a stop missing a price:** that row's input shows error border + the row caption "Set a price (or 0 for free)"; the **total still computes** treating blank as 0 BUT Continue/Publish is **blocked** until every per-stop field is explicitly filled (blank ≠ 0; force an intentional 0). Summary shows the partial total in `text.tertiary` with a sub-line "Finish pricing every stop to continue."
5. **Capacity validation:** capacity must be a positive integer unless Unlimited. Non-numeric/zero → input error "Enter how many spots are available, or choose Unlimited." (At create there is no sold count; the edit-after-publish guard `capacity_below_sold` from Sub-E applies later.)
6. **Mode switch:** non-destructive (§4.2); inputs re-render, total recomputes, summary re-reads.
7. **Submitting (Publish):** footer Publish button `loading`; both fields disabled; on success → onComplete; on error → `Toast kind="error"` (existing).
8. **Returning (editing a draft):** the wizard rehydrates mode + prices + capacity from the persisted stop shape (§6); the total + summary recompute from stored values.
9. **Degraded (per-stop with 0 stops — impossible here):** Pricing is Step 4, reached only after Stops (Step 2) enforced 2–5; per-stop mode therefore always has ≥2 rows. If somehow 0 (defensive), per-stop mode shows "Add stops first" pointing back to Step 2 and Continue is blocked. Not normally reachable.

### 4.7 — Copy (Pricing, Mingla voice)

| Element | Copy |
|---|---|
| Step title | "Pricing" |
| Mode toggle A / B | "One price for the whole experience" / "Price each stop" |
| Free toggle (whole) | "This experience is free" |
| Whole price label | "Price" |
| Unlimited toggle | "Unlimited spots" |
| Capacity label / placeholder | "Total spots" / "20" |
| Per-stop section label | "PER-STOP PRICES" |
| Per-stop total row | "Total" |
| Missing per-stop price | "Set a price (or 0 for free)." |
| Capacity error | "Enter how many spots are available, or choose Unlimited." |
| Sold-as-one summary | (see §4.4 table) |

---

## 5. DECK-CARD PREVIEW + DISTINGUISHING TREATMENT

### 5.1 — In-wizard live preview (Stops §2.1 toggle)

A collapsible `<DeckCardPreviewToggle>` under the stops list renders a **scaled facsimile** of the consumer `CuratedExperienceSwipeCard` using **business design tokens** (not the consumer literals), so the brand sees their authored itinerary as a deck card *without* importing the consumer component cross-app. The facsimile (≈ 320×420 contained card, radius `radius.lg`, `overflow:'hidden'`):

```
PreviewCard
├─ Image strip: thumbs of each stop's first photo, side-by-side (mirrors CuratedExperienceSwipeCard imageStrip)
│     · numbered GlassBadge variant="circular" top-left of each segment (the consumer pattern)
│     · placeholder tile (glass.tint.profileElevated) for stops with no photo yet
├─ Bottom gradient (rgba(0,0,0,0)→0.55) for legibility   ← matches consumer hero fade
├─ Overlay (bottom-left):
│     ├─ <BrandByline>  small row: brand logo dot + "by {brand.name}"   ← DISTINGUISHING (see §5.2)
│     ├─ Text.title  {experience.title || "Your experience"}
│     ├─ Text.tagline (optional)  {experience description first line}
│     └─ Badge row (GlassBadge): price ("{sym}{total}" / "Free") · "{N} stops" · category(optional)
│           └─ + the <MinglaExperienceBadge> warm pill   ← DISTINGUISHING (see §5.2)
└─ Details tray: a single "Book" pill  ← DISTINGUISHING (vs consumer curated "See Full Plan"/"Save")
```

Empty preview (0 photos, no title): show the structure with placeholder tiles + "Add stops and a title to see your card." (caption, text.tertiary).

### 5.2 — Distinguishing a brand experience from an algorithmic curated card

The consumer deck shows **algorithmic curated cards** (no brand, "Save"/"See Full Plan") interleaved with **brand experiences** (this ORCH). They must be distinguishable at a glance. **Proposed treatment (exact):**

1. **Brand byline (identity):** a top-of-overlay row — `Image` brand logo at 16×16 `radius.full` (fallback: a 16×16 `accent.warm` dot with the brand initial) + `Text` "by {brand.name}" at `typography.caption`/600 in `text.inverse` with the same text-shadow the card title uses. Algorithmic curated cards have **no byline**.
2. **"Mingla Experience" badge (provenance):** a `GlassBadge` with `iconName="sparkles"` reading **"Experience"**, tinted warm — render it with the badge's warm/`accent.warm` icon. It sits **first** in the badge row so the warm spark is the eye's entry point. (Consumer curated cards lead with location/travel/rating badges and never carry this badge.) Reuse `GlassBadge` + `accent.warm` per the dispatch.
3. **"Book" CTA (intent):** the details-tray pill reads **"Book"** (with a `ticket` icon) in `accent.warm` fill / `text.inverse` — signalling a *purchasable* card. Algorithmic curated cards use neutral "See Full Plan" / "Save." This is the strongest single differentiator: a warm **Book** button = money, a neutral Save = bookmark.

> The actual consumer-side card (in `app-mobile/`) is OUT of scope for the *wizard* but the wizard preview must visually promise these three treatments so authoring is honest. The consumer card's real implementation of byline + Experience badge + Book CTA is a **consumer-app deliverable** — flagged Q-OPEN-1 (it lands in the META-ORCH-1009 / consumer deck track, not this wizard ORCH). The wizard preview is a faithful mock of that target.

### 5.3 — Stop → `CuratedStop` mapping (authoring is deck-ready)

Each authored stop maps 1:1 onto `CuratedStop` (`app-mobile/src/types/curatedExperience.ts`). The wizard authors the **brand-controlled** subset; the rest are runtime/algorithmic fields the deck pipeline fills (or that are N/A for brand experiences and default sensibly):

| `CuratedStop` field | Authored in wizard? | Source / default |
|---|---|---|
| `stopNumber` | derived | index + 1 |
| `stopLabel` | derived | `labelForIndex` (§2.6) → 'Start Here'/'Then'/'End With' |
| `placeId` | **yes** | `AddressAutocompleteInput` pick |
| `placeName` | **yes** | stop name field |
| `address` | **yes** | `PlaceDetails.formattedAddress` |
| `placeType` | no | default `''` (or Google type if returned later) |
| `rating` / `reviewCount` | no | `0` (brand experiences aren't review-ranked; the deck card hides the rating badge when 0) |
| `imageUrl` | **yes** | first uploaded photo |
| `imageUrls` | **yes** | uploaded photo array (≤5) |
| `priceLevelLabel` / `priceTier` | no | derived from price or `''` |
| `priceMin` / `priceMax` | **yes** | per-stop price (both = the stop price; whole-mode → `0` per stop, total carried at card level) |
| `lat` / `lng` | **yes** | `PlaceDetails.location` |
| `openingHours` / `isOpenNow` / `utcOffsetMinutes` / `website` | no | `null` (honest absence — Constitution #9) |
| `distanceFromUserKm` / `travelTimeFromUserMin` / `travelTimeFromPreviousStopMin` / `travelModeFromPreviousStop` | no | runtime (computed per-viewer by the deck pipeline; `null`/`0` at author time) |
| `aiDescription` | **yes (optional)** | a per-stop blurb field could be added; v1 default = `''` (flag Q-OPEN-2) |
| `estimatedDurationMinutes` | **yes (optional)** | from per-stop time gaps if set, else `0` |
| `optional` / `dismissible` / `role` / `comboCategory` / `rankSignal` | no | `false`/`null` (brand experiences are fixed itineraries — no optional/dismissible stops) |

And the card-level `CuratedExperienceCard`: `title`/`tagline` from Identity; `stops` from the builder; `totalPriceMin/Max` from the resolved total (§4.3); `estimatedDurationMinutes` summed; `cardType:'curated'` reused; **plus brand fields** (`brand_id`/`brandSlug`/`brandName`) that `CuratedExperienceCard` does NOT currently carry — see §6.

---

## 6. PROPOSED STOP DATA SHAPE (contract for the SPEC to formalize)

**The problem:** stops must persist somewhere that (a) the wizard writes, (b) the public detail page + deck card + dashboard read from ONE source, and (c) mirrors `CuratedStop` so authoring is deck-ready. Today experiences store a single `theme.experience_meta.{venue_text,tier_name,price_major,capacity}` — insufficient for 2–5 structured stops.

**Recommendation (designer-proposed; SPEC owns the final call): a dedicated `experience_stops` table** keyed to the experience's `events.id`, one row per stop, shaped to mirror `CuratedStop`:

```
experience_stops
  id              uuid pk
  event_id        uuid  fk → events.id  (the experience row)  [indexed]
  stop_order      int   (0-based; UNIQUE(event_id, stop_order))   → stopNumber/stopLabel derive from this
  place_id        text  not null          ← Google placeId (validated)
  place_name      text  not null          ← stop name
  address         text  not null          ← PlaceDetails.formattedAddress
  city            text
  region          text
  country_code    text
  lat             double precision not null
  lng             double precision not null
  image_urls      text[]  default '{}'    ← ≤5; image_urls[0] = primary (→ CuratedStop.imageUrl)
  start_time      time    null            ← OPTIONAL per-stop intra-day time
  price_cents     int     default 0       ← per-stop price (0 in whole-experience mode)
  ai_description  text    default ''       ← optional blurb (Q-OPEN-2)
  created_at / updated_at
```

**Why a table over JSON:** stops are queryable (the deck pipeline needs to compute per-viewer travel times against lat/lng; a JOIN beats parsing JSON), enforce a clean `UNIQUE(event_id, stop_order)` ordering invariant, and let the public RPC return them as structured rows. JSON in `theme.experience_meta.stops[]` is the fallback if the SPEC prefers fewer migrations — but it loses queryability for the travel-time computation.

**Pricing mode flag:** store `theme.experience_meta.pricing_mode = 'whole' | 'per_stop'` + `theme.experience_meta.whole_price_cents` (whole mode) on the events row. The **resolved total** is what materializes the single `ticket_types` row (price_cents = resolvedTotal, quantity_total = capacity) — so the one-ticket invariant + COMMS-0014/0016 hold. Per-stop prices live on `experience_stops.price_cents` for the itemized buyer receipt; they are **display-only** (never their own ticket rows).

**Brand-distinguishing fields on the card contract:** `CuratedExperienceCard` (consumer) needs three new optional fields to render the §5.2 treatment: `brandId?: string`, `brandSlug?: string`, `brandName?: string` (+ an optional `isBrandExperience?: boolean` discriminator, or infer from `brandId != null`). The public experience RPC (`pg_public_experiences_by_brand`, already returns brand fields) supplies them; the deck-card pipeline maps them onto the card. **This is a consumer-app + RPC contract, flagged Q-OPEN-1.**

**One-source guarantee:** the public single-experience resolver (`getPublicExperienceBySlug`, main design Sub-C) returns the experience + its `experience_stops[]` (ordered) + the resolved total; the business dashboard hero/preview reads the same rows; the deck card maps the same rows onto `CuratedStop[]`. No second copy.

> **For the forensics SPEC:** formalize (1) `experience_stops` table + RLS (brand-owner write, anon read of published only) + the `UNIQUE(event_id, stop_order)` invariant; (2) the `biz_create_experience` RPC (main design Sub-A) extended to atomically write `events` + `experience_stops[]` (2–5) + ONE `ticket_types` (resolved total, capacity) + master `event_dates` (from When); (3) the `CuratedExperienceCard` brand-field additions + the deck-pipeline mapping; (4) stop-image storage keying (§6.1).

### 6.1 — Stop-image storage (implementor contract)

The event cover pipeline (`uploadEventCoverMedia`) keys storage at `${brandId}/${eventId}/…` and **requires a server event id** — but stops are authored *before* the experience row may exist (and stops aren't event rows). **Resolution:** stop images use the **brand-keyed device-upload path** (the `expo-image-picker` → upload flow already used for brand covers), writing to a stop-images bucket under `${brandId}/experience-stops/${randomId}.{ext}`, returning a public URL stored in `experience_stops.image_urls`. This is brand-scoped and independent of any event row, so it works at author time (draft or pre-publish). Do **not** route stop images through the `event`-kind `CoverTarget` (it needs an `eventRowId`). Flag Q-OPEN-4.

---

## 7. RESIDUAL OPERATOR DECISIONS

| # | Decision | Recommendation |
|---|---|---|
| Q-OPEN-1 | The brand-distinguishing deck-card treatment (byline + "Experience" badge + "Book" CTA + `CuratedExperienceCard` brand fields) lands in the **consumer-app / deck pipeline**, not this wizard ORCH. Confirm it's tracked there (META-ORCH-1009 deck track) so brand experiences are visually distinct on the live deck. | Track in the consumer deck ORCH; this ORCH ships the wizard + the data shape that feeds it. |
| Q-OPEN-2 | Per-stop **`aiDescription`/blurb** — author it in the wizard (a small optional textarea per stop) or leave `''` for v1? | v1: leave `''` (keep the stop card lean); add later if buyers want context per stop. |
| Q-OPEN-3 | Reorder via **chevron buttons** (v1) vs **drag handles** — drag is nicer but adds gesture/a11y complexity inside a ScrollView. | Ship chevrons v1 (a11y-clean, no gesture conflict); drag handles = v1.1. |
| Q-OPEN-4 | Stop-image storage = brand-keyed bucket path (§6.1) independent of the event row. | Confirm; it's the only path that works at author time. |
| Q-OPEN-5 | **Min/max stops = 2/5** locked by operator. Confirm the deck card renders gracefully at 5 stops (image strip gets narrow). | Image strip already handles N segments (consumer card `visibleStops.map`); at 5 the thumbs are ~20% width each — acceptable; cap at 5 holds it legible. |
| Q-OPEN-6 (carried) | COMMS-0013 web-vs-native tax basis divergence for experience checkout (same as events/trips). | Accept (live brands ≈ 0; native is primary buyer surface). |
| Q-OPEN-7 | Per-stop **start times with no date alignment** — Step 2 times are intra-day hints; When owns the date(s). Confirm buyers see "Stop 1 · 7:00 PM" as a *schedule within the booked date*, not a separate bookable slot. | Confirm; per-stop time is a schedule hint, never a separate SKU. |

---

## 8. /goal COMPLETION SELF-CHECK

1. **References examined** — present (Airbnb Experiences itinerary builder, Komoot/AllTrails waypoint reorder, Eventbrite/Tock itemized editor, Partiful sequencing voice, Apple Maps Guides, Resy/Tock prix-fixe), synthesis = author the consumer curated-card shape, prix-fixe pricing model. ✓
2. **All 9 states** — designed per new step (Stops §2.8; Pricing §4.6); inapplicable ones named with reason. ✓
3. **Every value is a token** — all spacing/radius/type/color reference designSystem.ts; the only literals (toggle 44/26/20, thumb 64, deck-card facsimile sizing) are pre-existing parity values mapped to named consts / tokens (§0.4). ✓
4. **Contrast computed** — numeric ratios in §0.2 (16.9 / 8.9 / 4.9 / 6.4 / 4.6 :1); the one inherited sub-4.5 value (white-on-orange primary CTA) flagged as the existing system treatment clearing the 3:1 large-text bar. ✓
5. **Interactive elements** — ≥44pt (IconBtn 44, rows minHeight 44, StopBadge 44, mode toggle 44, AddStopCta 56), per-element `accessibilityRole` + `accessibilityLabel` specified, non-shifting opacity press feedback. ✓
6. **Zero anti-slop** — no new gradients (preview reuses the consumer hero fade pattern), no stock/AI imagery (brand uploads real photos), no emoji icons (uses the `Icon`/`GlassBadge` set), no decorative effects. ✓
7. **Mingla voice copy + reduced-motion** — copy specified per state in Mingla voice (§2.9, §4.7); list/reorder motion has explicit reduce-motion guards; sheets reuse `Sheet` which honors `prefers-reduced-motion`. ✓
