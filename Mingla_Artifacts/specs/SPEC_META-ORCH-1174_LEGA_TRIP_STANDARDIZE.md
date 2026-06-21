# SPEC — META-ORCH-1174 Leg A — Standardize the Public TRIP Page into ONE shared `TripOfferingBody`

**Status:** IMPLEMENT-ready
**Owner phase:** SPEC (mingla-forensics) → IMPLEMENT (mingla-implementor)
**Parent:** META-ORCH-1166 (offering-page standardization) — this is the **trip leg**.
**Pattern reference (READ FIRST):**
- RSVP leg → ORCH-1163: `mingla-business/src/components/event/RsvpPublicBody.tsx` (the shared shell-agnostic body) + thin wrappers (`mingla-business/app/rsvp/[id]/preview.tsx` web/business; the RSVP branch of `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` consumer) + `packages/offering-rendering/RsvpMomentumDecision.tsx` (the shared promoted sub-part).
- Event leg → ORCH-1167: `packages/event-rendering/PublicEventPage.tsx` (the shared body; injects `ScrollComponent` so the consumer passes gorhom's `BottomSheetScrollView`).

**Anchor investigated:** `/Users/sethogieva/Desktop/mingla-main` @ current `main` (commit `95c3eff37` registers META-ORCH-1174).

> ⚠️ **Naming correction vs the dispatch brief.** The brief referred to `RsvpOfferingBody`, `EventOfferingBody`, `EventOfferingFloatingBar`, `useRsvpOfferingState`. **Those exact symbols do not exist in the anchor.** The real shared bodies are `RsvpPublicBody` (in `mingla-business/src`, cross-imported by buyer-web/business) and `PublicEventPage` (in `@mingla/event-rendering`). There is **no lifted `useRsvp*State` hook** and **no standalone `*FloatingBar` component** — each surface owns its reserve/CTA state inline and renders its own floating bar component. This spec uses the **actual** anchor patterns and names the new symbols `TripOfferingBody` / `useTripOfferingState` / `TripReserveBar` (promoted). The implementor must follow THIS spec, not the brief's placeholder names.

---

## A) GOAL + canonical structure

### A.1 Goal

Collapse the **two forked public-trip implementations** into **ONE shared, shell-agnostic, pure-presentational `TripOfferingBody`** in `@mingla/offering-rendering`, rendered identically across **buyer-web + business iOS/Android + consumer iOS/Android**, retiring the hand-mirrored consumer layout and the forked sub-parts. Mirrors how ORCH-1163 standardized RSVP and ORCH-1167 standardized the event page.

Leg A scope is **the current single-tier reserve→cart with the Pay-in-full / Pay-over-time choice working** — plus the Seth-locked section restructure (full-width pills, animated countdown, folded About + map). **Multi-tier authoring/engine is Leg B** (out of scope here); §10's box is designed so Leg B can extend it to a true multi-tier selector **without relaying out**.

### A.2 Seth-LOCKED canonical section order (the required structure)

The body renders these sections **in this exact order**. The **Cover (1)** and **Floating reservation button (12)** are **surface-pinned siblings** — they live in the per-surface wrapper, NOT in `TripOfferingBody`. Everything 2→11 is the body.

| # | Section | In body? | Notes |
|---|---------|----------|-------|
| 1 | **Cover** | NO — surface-pinned sibling | web/business: `ParallaxCoverShell`'s pinned cover. consumer: the absolute `nativeCover` sibling. |
| 2 | **Event name (title)** | YES | + duration·destination eyebrow above it on phone (desktop renders title in the hero). |
| 3 | **Travel dates · Leaving-from · Destination — as FULL-WIDTH PILLS** | YES | **RESTYLE** from today's meta-chip row + separate route block into the canonical **full-width pill row** (like the event page's date row). See D-note + §C.3. |
| 4 | **Pills row: days&nights · spots-left · animated live countdown** | YES | **NEW countdown.** When `bookingDeadline` exists and is in the future, the spots/meta pill row carries an **animated ticking countdown** (today it's a static `stateBanner` label). Pure-presentational, reduce-motion-aware. |
| 5 | **Presented-By box** | YES | brand cover (gif/video-aware) + "Presented by" + name (+ verified tick on consumer). |
| 6 | **About / description** | YES — **folded in here per Seth** | collapsible (≤160 chars → no toggle). KEEP. |
| 7 | **Itinerary (day-by-day spine)** | YES | shared `DayByDay` (spine + dot + per-day count-aware gallery; collapse at ≥5 days). |
| 8 | **What's included / What's NOT** | YES | two `ChipGroup`s (already shared). |
| 9 | **Cancellation policy (refund ladder)** | YES | shared palette-driven `TripRefundLadder` (see §C.4). |
| 10 | **"Choose how you pay" box** | YES | the §10 reserve box: shared `TripPaymentChoice` + a real selection box, live all-in total, proceed→cart. Leg-A = single-tier; designed for Leg-B multi-tier extension (see §D). |
| 11 | **Where-you'll-be destination map** | YES — **folded in here per Seth** | city/destination-level static map. KEEP. Gated on real lat/lng (rule 9). |
| 12 | **Floating reservation button** | NO — surface-pinned sibling | never dormant; opens/activates the cart. zIndex `6` (the `floatWrap` pattern). |

> **§6 About + §11 map folded positions are explicit and binding.** About sits at position 6 (after Presented-By, before Itinerary). The map sits at position 11 (after Cancellation policy, before the floating bar). This differs from today's web order (web currently renders About *before* the route/itinerary and the map *before* cancellation). The implementor MUST reorder to the table above.

---

## B) CURRENT STATE / forks (file:line)

### B.1 Web / business public trip page
- **Route:** `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — resolves theme→palette→surface, owns `paymentPlanChoice` state (`:86-87`), `muted`/share state, the float→dock pill visibility tracking (`:250-269`), builds `tripCta: CtaState` (`:338-374`), the `paymentBlock` = `<TripCheckoutFlow>` (`:449-458`), `reserveControl` (desktop), `dockedReserve` (`:507-521`), and the floating `<TripReserveBar variant="floating">` (`:562-574`). Reserve routes **straight to `tripCheckoutPath` with `plan` param** (`:382-389`) — NOT a cart sheet (web/business uses a route, see B.4).
- **Body:** `mingla-business/src/components/trip/TripPreview.tsx` → **FOUNDATION mode** (`palette` present, `:231-260`) renders `FoundationTripPreview` (`:279-736`) inside `ParallaxCoverShell` (`:697-735`). Owns inline: meta-chips (`:466-514`), route block (`:519-558`), About (`:561-573`), `DayByDay` (`:757-826`), `ChipGroup`s, static map (`:615-653`), the bespoke palette `RefundLadder` (`:872-931`). **LEGACY mode** (`palette` absent, `:937-1176`) is the wizard Step-5 preview — **MUST stay byte-identical** (do not touch).
- **Sub-parts (business-local):** `TripReserveBar` (`mingla-business/src/components/trip/TripReserveBar.tsx`), `TripPaymentChoice` (`mingla-business/src/components/trip/TripPaymentChoice.tsx` — used by both the public page AND the `/checkout-trip/payment` route + wizard via the no-palette path, B5), `TripCheckoutFlow` (`mingla-business/src/components/trip/TripCheckoutFlow.tsx` — purely the §10 box content; owns NO cart/reserve logic).

### B.2 Consumer
- **Screen:** `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (1820 lines) — mounts inside the shared gorhom `BaseBottomSheet` with `scrollMode="view"` (`:1394-1403`); the gorhom `BottomSheetScrollView` is a **DIRECT child** (`:1430`), with the themed cover (`:1407-1424`), `OfferingChrome` (`:1474-1488`), and floating `ConsumerTripReserveBar` (`:1494`) as **absolute sibling direct children**. It **hand-mirrors** the FoundationTripPreview layout (`bodyChildren`, `:714-1230`): lead/title, meta-chips, brand chip, deadline band, route, About, day-by-day (inline spine, `:950-984`), included/excluded ChipGroups, `ConsumerRefundLadder`, and a fully **re-implemented "Choose how you pay" mockup card** (`:1035-1228`, ~190 lines duplicating `TripPaymentChoice`'s `PaymentMockupCard`).
- **Reserve→cart:** opens `TicketCartSheet` **directly** (`:463-472`, `:1505-1532`); `handleBuy` ported verbatim from EBES (`:496-593`); split CTAs `openCartWithChoice` (`:481-487`).
- **Sub-parts (consumer-local):** `ConsumerTripReserveBar` (`app-mobile/src/components/offering/ConsumerTripReserveBar.tsx`) and `ConsumerRefundLadder` (`app-mobile/src/components/offering/ConsumerRefundLadder.tsx`).

### B.3 The forks (what is duplicated)
1. **Reserve bar:** `TripReserveBar.tsx` (718 lines) vs `ConsumerTripReserveBar.tsx` (785 lines) are **near byte-identical** — same `CtaState`/`ThemePalette` contract, same docked/floating variants, same seam-split (Treatment B) two-tone control, same styles. The only deltas: the consumer bar threads `safeAreaBottom` + a `SHEET_BOTTOM_OVERSHOOT=63` lift (gorhom sheet context), and has F-4 arrow-bleed flexShrink guards. **This is the single biggest, riskiest dedupe.**
2. **Refund ladder:** the business **inline `RefundLadder`** (TripPreview `:872-931`, palette-driven) vs `ConsumerRefundLadder.tsx` (palette-driven). **Both are already palette-driven and near-identical** — the brief's "ConsumerRefundLadder hardcoded warm-orange" note is **STALE**; warm-orange lives only in the *separate* shared `RefundPolicyDisplay` (`packages/event-rendering/RefundPolicyDisplay.tsx`, `#eb7825`), which is a DIFFERENT component (used by the buyer cancel-preview, RefundPolicyEditor, etc.) and is **out of scope**.
3. **Payment choice:** `TripPaymentChoice.tsx`'s `PaymentMockupCard` (business-local) vs the consumer's inline re-implementation (`ConsumerTripDetailScreen` `:1035-1228`). Same copy, same segmented tab toggle, same schedule rows.
4. **DayByDay itinerary:** TripPreview's `DayByDay` (`:757-826`) vs the consumer's inline spine (`:950-984`). Same anatomy.
5. **Meta-chips + route block:** duplicated inline in both (TripPreview `:466-558` vs consumer `:731-892`).

### B.4 Data paths — **DIFFERENT underlying sources** (load-bearing)
- **Web:** `mingla-business/src/hooks/usePublicTripBySlug.ts` — direct anon SELECTs on `brands` + `events` + `trip_days` + `trip_pricing_tiers` + `trip_inclusions` + `ticket_types` + `event_dates`(master), **plus** `rpc("pg_public_ticket_types_remaining")` for **per-tier** spots-left (`:54-74`, `:246`) **plus** `rpc("pg_brand_can_charge")` for `bookable`. Payload (`PublicTripPayload`) carries: `trip.businessTrip.destinationLat/Lng` (from the theme `business_trip` JSON mirror, `:312-315`), per-tier `ticketsRemaining`, full `tierMetadata`, `days[].stops/date`, `brand.coverHue/bio/theme`, `themeOverrides`.
- **Consumer:** `app-mobile/src/hooks/useConsumerTripDetail.ts` (+ `useConsumerTripFoundation.ts` mapper) — anon-isolated per COMMS-0009 (NEVER `.from('brands')`): seeds from `rpc("pg_published_trips_public")` (no by-slug param → page-scan match), direct reads on `events`/`trip_days`/`trip_inclusions`/`trip_pricing_tiers`(embedded `ticket_types` join), `business_public_brands_view` for brand cover, shared `pg_brand_can_charge`. Payload (`ConsumerTripDetail`): aggregate `spotsLeft`/`minPriceCents`/`hasFreeTier`/`hasPlan`, per-tier `installmentSchedule`, `refundPolicy: RefundPolicyShape`.
- **CONSUMER PAYLOAD GAPS vs web:** ❌ **no destination/departure lat/lng** (events select omits the cols → the map cannot render); ❌ **no per-tier `ticketsRemaining`** (only aggregate `spotsLeft`); ❌ no per-day `stops`/`date`; ❌ no brand `coverHue`/`bio`/`theme` in payload (theme resolved separately via `useEventTheme`).

> See §G read-path recommendation: the shared body **consumes a normalized prop contract**, decoupling it from these two divergent read paths; a single shared read RPC is **recommended but optional for Leg A** (the map gap is the only user-visible consequence and is rule-9-guarded).

---

## C) THE BUILD — `TripOfferingBody` + shared sub-components + per-surface wrappers

### C.0 Files created / modified / deleted (summary; details below)

**CREATE (in `packages/offering-rendering/`):**
- `TripOfferingBody.tsx` — the shared shell-agnostic pure body (sections 2→11).
- `useTripOfferingState.ts` — the lifted reserve/CTA state hook (so the §10 box + the floating bar share ONE state machine).
- `TripReserveBar.tsx` — the single promoted reserve/floating bar (docked + floating variants, seam-split).
- `TripPaymentChoice.tsx` — the promoted "Choose how you pay" box (the palette `PaymentMockupCard`, pure-presentational).
- `TripRefundLadder.tsx` — the single promoted palette-driven refund ladder.
- `DayByDay.tsx` — the promoted itinerary spine.
- `TripCountdownPill.tsx` — the NEW animated countdown pill (§C.5).
- `tripOfferingTypes.ts` — the prop contract types (`TripOfferingData`, `TripOfferingBrand`, `TripOfferingTier`, `TripOfferingCallbacks`, `ReserveSplitCtas`, etc.).
- Barrel exports added to `packages/offering-rendering/index.ts`.

**MODIFY:**
- `mingla-business/src/components/trip/TripPreview.tsx` — `FoundationTripPreview` becomes a **thin wrapper**: builds the `TripOfferingData` prop bundle from the business `Trip`, renders `<ParallaxCoverShell>` with `<TripOfferingBody>` as children + pins `<TripReserveBar>`. **LEGACY mode untouched** (wizard preview).
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — keep route-level state ownership (theme/palette/fonts/share/mute/countdown/cart-nav), but delegate body + bars to the shared components via the wrapper. The web/business reserve still routes to `tripCheckoutPath` (route-based cart), NOT a sheet.
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` — retire the hand-mirrored `bodyChildren` (`:714-1230`); render `<TripOfferingBody>` inside the existing `BottomSheetScrollView` (gorhom-safe — see C.2), pin the shared `<TripReserveBar>` as the absolute sibling. **Keep the `TicketCartSheet` direct-mount + `handleBuy`** (gate-protected, see §E).
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` — re-point its plan-path render to the promoted `@mingla/offering-rendering` `TripPaymentChoice` (or fold its logic into the body's §10 box). The no-palette path used by `/checkout-trip/payment` + wizard MUST stay byte-identical (keep the business-local `TripPaymentChoice` for that caller — see C.6).
- `packages/offering-rendering/index.ts` — add the new exports.
- CI: wire the new canonical-order + isolation gates (§E, §F).

**DELETE (the consumer forks):**
- `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` → replaced by the shared `TripReserveBar`.
- `app-mobile/src/components/offering/ConsumerRefundLadder.tsx` → replaced by the shared `TripRefundLadder`.
- The consumer's inline payment-mockup card + inline DayByDay spine + inline meta/route blocks (they move into the shared body; no standalone file to delete, the code is removed from `ConsumerTripDetailScreen`).

> The business-local `TripReserveBar.tsx`, `RefundLadder` (inline), and the `PaymentMockupCard` portion of `TripPaymentChoice.tsx` are **superseded** by the promoted package versions. Delete `TripReserveBar.tsx` once the route imports the package one; the inline `RefundLadder` is removed from TripPreview; `TripPaymentChoice.tsx` is kept ONLY for its no-palette wizard/checkout caller (the palette path delegates to the package).

### C.1 `TripOfferingBody` — contract

```
// packages/offering-rendering/TripOfferingBody.tsx
export interface TripOfferingBodyProps {
  data: TripOfferingData;          // normalized, pre-mapped trip (see tripOfferingTypes)
  brand: TripOfferingBrand;
  palette: ThemePalette;           // from @mingla/event-rendering createThemePalette
  theme: ResolvedTheme;
  state: TripOfferingState;        // from useTripOfferingState (the SHARED machine)
  callbacks: TripOfferingCallbacks;// onViewBrand, onReserve(choice?), onOpenMaps?, onSplitReserve
  variant: "phone" | "desktop";    // useResponsiveLayout-derived; native always "phone"
  fontFamily: string;              // boldFontFamily(theme)
  /** Phone-only docked reserve node (the bar at rest) — passed in by the wrapper
   *  so the SAME <TripReserveBar variant="docked"> renders as the LAST body child. */
  dockedReserve?: React.ReactNode;
  testID?: string;
}
```

**Rules (binding):**
- **Pure-presentational. NO data fetching, NO `useAuth`/`useRouter`/store reads.** All data via `data`/`brand`; all actions via `callbacks`. (I-MOR-0827.)
- **NOT a scroll root.** `TripOfferingBody` returns a plain `<View>` fragment of sections 2→11; it MUST NOT render a `ScrollView`/`BottomSheetScrollView`. The **surface** owns the scroll (web/business via `ParallaxCoverShell`'s injected `ScrollComponent`; consumer via the gorhom `BottomSheetScrollView` it's rendered inside). This is the gorhom-safe contract (§C.2, §E).
- Renders **ONLY real fields** (rule 9): each section is conditionally rendered when its data is present (map only with lat/lng; route legs only when parsed; itinerary only with days; chips only when non-empty).
- The **§10 box** and the **docked reserve** both read from `state` (the shared machine), so the inline box and the bar can never disagree on price/availability.
- Imports allowed: `react-native`, `@mingla/event-rendering` (palette/types/EventCoverMedia/ThemePalette), and sibling `@mingla/offering-rendering` files only. **ZERO app `src/` imports.**

### C.2 Per-surface wrappers

**Web/business** (`FoundationTripPreview` in `TripPreview.tsx`, thin):
```
<ParallaxCoverShell palette theme cover... heroEyebrow heroTitle stateBanner
    stickyPanel={desktop ? <DesktopBookingPanel/> : null}
    contentBottomInset safeAreaTop onScroll onScrollViewLayout>
  <TripOfferingBody ... dockedReserve={!desktop ? <TripReserveBar variant="docked"/> : undefined} />
</ParallaxCoverShell>
/* floating bar pinned by the ROUTE as a sibling of ParallaxCoverShell, zIndex 6 */
{!desktop && floatingPillVisible ? <TripReserveBar variant="floating" .../> : null}
```
`ParallaxCoverShell` already owns the cover (pinned), chrome (`CHROME_Z=70`), and the scroll (`CONTENT_Z=2`); its `ScrollComponent` defaults to RN `ScrollView` on web/business. The desktop sticky panel keeps brand chip + `TripPaymentChoice` + the desktop Reserve control (route-owned), as today.

**Consumer** (`ConsumerTripDetailScreen.tsx`, thin):
```
<BaseBottomSheet scrollMode="view" hidesBottomNav ...>
  <View nativeCover absolute zIndex:1 /> {/* pinned cover sibling */}
  <BottomSheetScrollView nativeScroll zIndex:2 onScroll onLayout> {/* DIRECT child of sheet */}
    <View coverSpacer />
    <View nativeBody>
      <TripOfferingBody ... dockedReserve={<TripReserveBar variant="docked" safeAreaBottom={insets.bottom}/>} />
    </View>
  </BottomSheetScrollView>
  <View nativeChrome zIndex:70><OfferingChrome/></View>
  {floatingPillVisible ? <TripReserveBar variant="floating" safeAreaBottom={insets.bottom}/> : null}  {/* zIndex 6 */}
</BaseBottomSheet>
<TicketCartSheet ... /> {/* sibling root — UNCHANGED, gate-protected */}
```
> **Do NOT** mount `ParallaxCoverShell` as the gorhom sheet host on consumer — its native branch nests its ScrollView inside a `nativeHost` View, which makes the injected gorhom `BottomSheetScrollView` a non-direct child → `viewport==content` → `maxScroll 0` → the documented ORCH-1016/1043 scroll-freeze. The consumer wrapper composes the cover/chrome/reserve as absolute siblings AROUND the gorhom scroll (exactly as today), and renders `TripOfferingBody` as the scroll content. This is identical to how ORCH-1163's consumer RSVP branch and today's consumer trip screen already work.

### C.3 §3 full-width pill restyle (NEW presentation)

Replace today's `metaRow` of small chips + the separate `route` card with a **full-width pill row** matching the event page's date row aesthetic:
- **Row 1 (dates pill):** a single **full-width** pill: `📅 {formatTripDateRange(start,end)}` (the event page's `dateLine` styling — `accent`-colored eyebrow then a full-width themed pill, not a hugging chip).
- **Row 2 (leaving-from / destination pills):** two **full-width** stacked pills (or a balanced split row on desktop): `✈ Leaving from {City, Country}` and `📍 {City, Country}` (the `normalizeCityCountry` output, `numberOfLines=1`+ellipsis). On phone, full-width stacked; on desktop, the existing balanced two-leg row is acceptable.
- This is a **restyle of existing data** (no new fields) — `formatTripDateRange`, `normalizeCityCountry(departureLocationText)`, `normalizeCityCountry(destinationLocationText)`. Keep rule-9 hiding (a leg with no parsed City,Country is omitted).

### C.4 §4 pills row (days&nights · spots-left · countdown)

A horizontal wrap row of solid-fill themed pills:
- `⏱ {deriveDuration(start,end)}` (e.g. "5 days · 4 nights") — when derivable.
- `👥 {spotsLabel}` — `{n} seats left · {cap} max` / `Sold out · {cap} of {cap} booked` / `{cap} max`. Web uses per-tier `ticketsRemaining`; consumer uses aggregate `spotsLeft` (mapped into `data.spotsLabel` by each wrapper — the body just renders the string).
- **NEW: `<TripCountdownPill>`** — rendered ONLY when `data.bookingDeadlineIso` is present and in the future (§C.5).

### C.5 `TripCountdownPill` — the animated live countdown (NEW)

```
// packages/offering-rendering/TripCountdownPill.tsx
export interface TripCountdownPillProps {
  deadlineIso: string;     // booking_deadline
  palette: ThemePalette;
  testID?: string;
}
```
- Pure-presentational, **no app-src**. Computes `deadlineMs - Date.now()` and renders `Bookings close in {Nd Nh Nm Ns}` (or `{Nd Nh}` when > 1 day — drop seconds at coarse granularity to avoid noise).
- **Ticks down** via a single `setInterval`. **Sensible tick + no per-second re-render storms:** tick every **1000ms only when < 1 hour remains**; tick every **60_000ms when ≥ 1 hour**; tick every **3_600_000ms (hourly) when ≥ 1 day**. Re-derive the interval cadence on each tick (so it tightens as the deadline approaches). Clear the interval on unmount and when the deadline passes (then render the closed/`null` state — the surface flips to the "Bookings closed" band via `state`).
- **Reduce-motion-aware:** read `AccessibilityInfo.isReduceMotionEnabled()`; when reduce-motion is on, render the **static** `formatDeadlineCoarse(deadlineIso)` label (no ticking) — accessibility parity, no per-second churn. (Mirror the `useReduceMotion` hook pattern in `PublicEventPage.tsx:96-113`.)
- It's a **presentational pill**; the surface still owns the authoritative closed/sold-out `state` (the countdown reaching 0 does NOT itself gate the CTA — the `bookingsClosed` flag + deadline check in `useTripOfferingState` does).

### C.6 `TripPaymentChoice` (promoted) + `TripCheckoutFlow`

- Promote the **palette `PaymentMockupCard`** path of `TripPaymentChoice.tsx` into `packages/offering-rendering/TripPaymentChoice.tsx` (pure: segmented Pay-in-full/Pay-over-time tab toggle, the 34px amount block, the schedule rows + total, the locked copy). Props: `{ schedule, fullPriceCents, currency, depositPct, value, onChange, palette, fontFamily, showScheduleWhenInstallments?, testID }`. Returns `null` when `schedule===null` (no-plan → the caller renders the quiet price recap).
- The consumer's ~190-line inline mockup (`ConsumerTripDetailScreen :1035-1228`) is **DELETED** and replaced by the shared component (rendered inside the body's §10 box).
- **The business-local `TripPaymentChoice.tsx` stays** ONLY for its **no-palette callers** (`/checkout-trip/payment` route + wizard Step-5), which the brief and RT-2 require to render **byte-identical to pre-1138**. Its palette path delegates to (or is superseded by) the package version. The public trip page's §10 box uses the **package** `TripPaymentChoice`.
- `TripCheckoutFlow.tsx` (business) is repointed: its plan render → package `TripPaymentChoice`; its no-plan quiet recap stays as-is.

### C.7 `useTripOfferingState` — the lifted state machine

```
// packages/offering-rendering/useTripOfferingState.ts
export interface UseTripOfferingStateInput {
  data: TripOfferingData;          // tiers, deadline, bookingsClosed, bookable, currency
  paymentPlanChoice: "full" | "installments";
  now?: Date;                      // injectable for tests; default new Date()
}
export interface TripOfferingState {
  cta: CtaState;                   // @mingla/event-rendering CtaState — the SAME shape both bars + box read
  splitCtas?: ReserveSplitCtas;    // present only when the (single) tier has an installment schedule AND tappable
  barKicker: string | null;        // "All-in, taxes included" / "Due today · deposit"
  barPriceLabel: string;
  isClosed: boolean;
  isSoldOut: boolean;
  selectedTier: TripOfferingTier | null;  // Leg A: the sole/first sellable tier
  projectedSchedule: ProjectedSchedule | null;  // the pay-over-time projection (pure)
}
export function useTripOfferingState(input): TripOfferingState
```
- **One owner of buy-state** (mirrors how the event page uses `resolveOfferingCta`/`computeOfferingVariant` as one owner). The §10 box's selection state AND the floating/docked bar AND the desktop reserve control ALL read `state.cta`/`state.splitCtas`/`state.barPriceLabel` — they can never diverge.
- Pure: no fetch/auth; `projectInstallmentSchedule` math moves here (or a pure copy `projectTripSchedule` so the package has no app-src import). Each wrapper passes `paymentPlanChoice` (its own `useState`) in; the hook derives the CTA labels.
- Leg A: `selectedTier` = the sole/first sellable tier (capacity>0 or unlimited). The shape already anticipates Leg B (multi-tier: `selectedTier` becomes the user-chosen tier + qty; see §D).

---

## D) §10 reserve box — Leg-A scope + Leg-B extension seam

### D.1 Leg-A scope (THIS leg)
The §10 box renders, in order:
1. The shared `TripPaymentChoice` (Pay-in-full / Pay-over-time toggle + schedule), driven by `state.paymentPlanChoice`.
2. A **real selection box** for the **single tier** using the **event-ticket-box mechanics**: a bordered card showing the tier name + the **live all-in total** (`state.barPriceLabel` — the server all-in via the existing tier price; NEVER recompute fees), reading the SAME `state` the bar reads.
3. **Proceed → cart.** Tapping the box's CTA (or the floating bar) calls `callbacks.onReserve(choice?)`:
   - **web/business:** `router.push(tripCheckoutPath(trip.id), { plan })` (route-based cart — UNCHANGED).
   - **consumer:** `openCart()` / `openCartWithChoice(choice)` → seeds + opens `TicketCartSheet` directly (UNCHANGED, gate-protected).
4. The payment-plan choice **threads through ONLY when the tier has an installment schedule** (`state.splitCtas` present); no-plan trips show the single Reserve. **NO address / taxCalculationId** (venue-sourced tax). The cart request stays byte-identical to today.

### D.2 Leg-B extension seam (designed-for, NOT built here)
Design the box so Leg B can extend it **without relaying out**:
- `TripOfferingData.tiers` is already a **list**; Leg A renders only `tiers[0]`/the sole sellable one, but the box's container is a **vertical list slot** — Leg B drops N tier rows in the same slot (option list + `QuantityRow` per tier — `@mingla/event-rendering` already exports `QuantityRow`).
- `useTripOfferingState` exposes `selectedTier`; Leg B replaces "the sole tier" with a `selectedTierId` + `quantities` map (additive fields), and `state.barPriceLabel` becomes the summed all-in. The bar/box contract is unchanged.
- The §10 heading ("Choose how you pay") + the box card stay; Leg B inserts a "Choose your package" tier selector **above** the payment toggle in the same card. No structural reshuffle of sections 2→11.
- **OUT of Leg A:** multi-tier authoring, the multi-tier checkout engine, qty steppers, per-tier remaining display. Leg A keeps the single-tier `pg_public_ticket_types_remaining` seed.

---

## E) GUARDS

1. **I-MOR-0827 package isolation (CI-WIRED):** the new `packages/offering-rendering/*.tsx` files MUST import ZERO app `src/`. Enforced by `.github/scripts/strict-grep/meta-orch-0827-package-isolation.mjs` (wired in `strict-grep-mingla-business.yml:915-924`). All trip/brand/state data arrives via props; pure structural types (like `RefundPolicyShape`) are declared locally in `tripOfferingTypes.ts`.
2. **Gorhom-safe (no scroll root in the body):** `TripOfferingBody` MUST NOT render any `ScrollView`/`BottomSheetScrollView`. The consumer keeps the gorhom `BottomSheetScrollView` as a DIRECT child of `<BaseBottomSheet>` (the proven ORCH-1016/1043 structure). Add a test asserting `TripOfferingBody`'s source contains no `ScrollView` import/JSX (§F).
3. **ORCH-1138 event gate NOT tripped (confirmed):** `.github/scripts/strict-grep/orch-1138-event-no-trip-only-blocks.mjs` scopes a **hard-coded 5-file list of EVENT-page files only** (FoundationEventPreview, ConsumerEventDetailScreen, business PublicEventPage, EventReserveBar, ConsumerEventReserveBar). A new `packages/offering-rendering/TripOfferingBody.tsx` (or any trip body) is **NOT in that list → cannot trip the gate**, even though it legitimately contains `RefundLadder`/`bookingDeadline`/"Day by day"/"Pay over time". **CONFIRMED SAFE.** ⚠️ Caveat: this gate is **not currently wired into CI** (only `orch-1138-trip-reserve-straight-to-cart.mjs` is). The implementor should NOT add the trip files to it; if desired, wire the event gate in a follow-up (out of Leg-A scope).
4. **ORCH-1138 reserve-straight-to-cart gate (CI-WIRED) — MUST stay green:** `orch-1138-trip-reserve-straight-to-cart.mjs` asserts `ConsumerTripDetailScreen.tsx` (a) does NOT import/mount `ExpandedBusinessEventSheet`, (b) has no `tripToBusinessEventCard`, (c) DOES import + mount `TicketCartSheet`. The thin-wrapper refactor MUST preserve the direct `TicketCartSheet` mount + `handleBuy` in `ConsumerTripDetailScreen`. Run the gate (and its `ORCH1138_SIMULATE_REVERT=1` self-test) after the refactor.
5. **Android opaque fills (ANDROID_GLASS_USES_OPAQUE_FALLBACK):** all promoted components keep the existing `Platform.select` opaque-fill + `overflow:'hidden'` clip + no-Android-shadow-under-rounded-fill discipline (already present in both reserve bars and the brand tile). No translucent Android fills reintroduced.
6. **No address / no tax form:** the §10 box + cart request carry NO billing address, NO `taxCalculationId` (venue-sourced tax, ORCH-1025/1130). The existing `orch-1130-no-buyer-tax-form.mjs` discipline holds; the shared body introduces no tax-form UI.
7. **LEGACY TripPreview untouched:** the wizard Step-5 LEGACY mode (`palette` absent) renders byte-identical; the no-palette `TripPaymentChoice` caller stays byte-identical (RT-2).

---

## F) TEST STRATEGY

All tests live in `packages/offering-rendering/__tests__/` (shared) + per-surface `__tests__/` for the wrappers.

1. **Canonical-order test (shared body):** render `TripOfferingBody` with a full fixture; assert the rendered section testIDs appear in the **exact 2→11 order** (name → date pills → meta/countdown pills → presented-by → about → itinerary → included → excluded → cancellation → pay box → map). Assert §6 About sits between Presented-By and Itinerary, and §11 map sits between Cancellation and (the absent-in-body) floating bar. This is the structural lock that proves the Seth order.
2. **Reserve→cart:** 
   - Shared: `useTripOfferingState` unit tests — `cta`/`splitCtas`/`barPriceLabel` for: free / paid-no-plan / paid-with-plan (full vs installments) / sold-out / closed / unbookable. Assert `splitCtas` present ONLY for a tappable plan tier.
   - Web wrapper: tapping the box CTA / floating bar calls `onReserve` → `router.push(tripCheckoutPath, {plan})` with the right `plan`.
   - Consumer wrapper: tapping calls `openCart`/`openCartWithChoice` → `TicketCartSheet` mounts with the matching `initialTicketTypeId` + `dueTodayCents` for installments. Re-run `orch-1138-trip-reserve-straight-to-cart.mjs` (+ SIMULATE_REVERT self-test).
3. **Fork-retirement:** a grep test asserting `ConsumerTripReserveBar.tsx` and `ConsumerRefundLadder.tsx` no longer exist (or are not imported) AND that `ConsumerTripDetailScreen.tsx` imports `TripOfferingBody` + `TripReserveBar` from `@mingla/offering-rendering` (not the deleted forks). Assert `TripOfferingBody.tsx` has no `ScrollView` (gorhom-safe guard, §E.2).
4. **Animated countdown:** `TripCountdownPill` unit tests with fake timers — assert: the label ticks (advance time, re-render shows decremented value); the interval cadence tightens (<1h → 1s, ≥1h → 60s, ≥1d → hourly); the interval is cleared on unmount + at deadline; reduce-motion path renders the static coarse label and starts NO interval. (Mirror the `PublicEventPage` reduce-motion test pattern.)
5. **Isolation gate:** run `meta-orch-0827-package-isolation.mjs` — confirm the new package files pass (no app-src import).
6. **Parity snapshot (optional, recommended):** RT-style byte-stability snapshot of the LEGACY TripPreview + the no-palette `TripPaymentChoice` to prove the wizard/checkout callers are untouched.

---

## G) Read-path recommendation (single source)

**Recommended (but optional for Leg A):** introduce ONE shared anon read RPC `pg_public_trip_by_slug(p_brand_slug, p_trip_slug)` returning the full normalized trip payload (cover, dates, route legs, **destination lat/lng**, per-tier rows with `installments` + remaining, inclusions, refund policy, booking deadline, brand) — and have BOTH wrappers map it into the `TripOfferingData` prop contract via a tiny per-surface adapter. This (a) closes the **consumer map gap** (consumer payload lacks lat/lng today → the §11 map silently omits on consumer), (b) closes the **per-tier spots** gap, (c) removes the by-slug page-scan in `pg_published_trips_public`.

**Leg-A pragmatic path (acceptable):** keep the two existing hooks (`usePublicTripBySlug` / `useConsumerTripDetail`) and add a thin per-surface **adapter** that maps each into the shared `TripOfferingData` shape. The body is then read-path-agnostic. The only visible consequence of NOT consolidating is the consumer map omission (rule-9-guarded, already the case today). **Decision left to the implementor + operator;** if the consumer map parity is required for this leg, do the shared RPC (it's the clean fix). Either way, `TripOfferingData` is the contract — the body never touches a hook.

> **DECISION NEEDED (flag to operator):** consolidate on `pg_public_trip_by_slug` now (closes map + spots parity, ~1 migration + 1 RPC) vs adapter-only (ships faster, consumer map stays absent). Recommend the shared RPC for true parity since META-ORCH-1166's whole premise is "render identically on every surface."

---

## Leg-B preview (high-level only)

Leg B adds **true multi-tier reservation options**: a tier selector (option list + `QuantityRow` per tier) above the payment toggle in the §10 box (the slot designed in §D.2), multi-tier authoring in the trip wizard, and the multi-tier all-in checkout engine (summed lines, per-tier remaining). The shared `TripOfferingBody` + `useTripOfferingState` + `TripReserveBar` contracts are unchanged — Leg B fills the list slot and swaps "sole tier" for "selected tiers + quantities." No section reshuffle, no wrapper changes beyond the new tier-selection callbacks.

---

## Appendix — biggest risk

**The single biggest risk is unifying `TripReserveBar` vs `ConsumerTripReserveBar` into one package component while preserving the consumer's gorhom-sheet safe-area behavior.** The two bars are near byte-identical (718 vs 785 lines) EXCEPT the consumer threads `safeAreaBottom` + a `SHEET_BOTTOM_OVERSHOOT=63` lift + F-4 arrow-bleed guards because it lives inside gorhom's `BottomSheetContent` (whose own SafeAreaProvider resolves `insets.bottom`→~0 and which extends ~63pt below the visible window at the 90% snap). The promoted shared bar MUST accept `safeAreaBottom` + an optional `sheetBottomOvershoot` prop (default 0 for web/business, 63 for the consumer sheet) so the floating pill clears the home indicator on consumer WITHOUT over-padding on web. Get this wrong and the consumer floating "Reserve" either bleeds under the home indicator (regression Seth already flagged once) or floats too high. Device-verify on a physical iPhone + Android at the 90% snap before close.
