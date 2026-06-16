# SPEC — ORCH-1138 Leg 2: Public EVENT Page Redesign (Direction A, all surfaces)

**ORCH:** META-ORCH-1138 Leg 2 — `[event-page]`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[event-page]/` on branch `ORCH-1138-event-page` (HEAD on merged main, foundation present, 0 behind origin/main).
**Mode:** SPEC (contract only — NO code).
**Author:** mingla-forensics
**Date:** 2026-06-15
**Status:** READY FOR IMPLEMENT
**Approved design (source of truth):** `Mingla_Artifacts/design/ORCH-1138/EVENT_DIRECTION_A_RESPONSIVE.html` (Seth-approved) + `Mingla_Artifacts/design/ORCH-1138/DESIGN_ORCH-1138B_PUBLIC_EVENT_PAGE.md`.
**Builds on:** the SHIPPED trip leg (Leg 1) — `packages/offering-rendering/*`, `packages/event-rendering/themePalette.ts`, `mingla-business/src/components/trip/TripPreview.tsx` (FOUNDATION mode), `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`, `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`, `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx`, `app-mobile/src/hooks/useConsumerTripFoundation.ts`.

> **Provenance note (do NOT skip):** the dispatch cited `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1138_EBES_DEAD_CODE_DELETABILITY.md`. **That file does not exist in this worktree or on the anchor.** The EBES consumer reality used by this SPEC was therefore re-derived DIRECTLY from source (verified, not assumed): EBES has exactly **two JSX mount sites** — `ExpandedCardModal.tsx` (deck) and `MessageInterface.tsx` (chat). `ExpandedCardModal` mounts EBES **twice**: the deck `businessEvent` card (`ExpandedCardModal.tsx:1740-1753`, the EVENT flow) and the ORCH-1072 venue-experience flow (`ExpandedCardModal.tsx:2259`). So EBES's three live consumers are: (1) deck EVENT card, (2) deck/venue EXPERIENCE card, (3) chat. **This SPEC moves only consumer (1) — the EVENT flow — off EBES.** Consumers (2) and (3) stay on EBES; EBES is NOT deleted (that lands in Leg 3/4). This matches the dispatch intent exactly.

---

## 1. Executive summary

The public **event** page is rebuilt onto the same shared Direction-A foundation the trip page already ships on, across **all three surfaces** (buyer/anon web, business iOS/Android in-app, consumer app). Today the event page is two divergent things: (a) the buyer-web + business in-app page renders the already-themed-but-flat-stacked `@mingla/event-rendering` `PublicEventPage` (`packages/event-rendering/PublicEventPage.tsx`, 1794 lines), and (b) the **consumer** event flow opens the event through `ExpandedBusinessEventSheet` (EBES), which wraps that same `PublicEventPage` in a bottom sheet.

This SPEC:

1. **Re-architects the structure** of the buyer-web/business `PublicEventPage` to Direction A — pinned parallax cover, body-level fixed chrome (X · Share · Mute), brand-themed palette + bold fonts, City,Country venue, a **venue + map block** ("Where you'll be"), date/time facts, a **selectable ticket-TIER list** as the page spine, a **desktop sticky ticket panel**, and the **float→dock single ticket CTA** in the new sleek button language — reusing the foundation primitives (NOT forking them).
2. **Builds a NEW foundation-based consumer event detail screen** (mirroring `ConsumerTripDetailScreen`) and **repoints the deck's event entry off EBES** to it, with **byte-identical** `ticket-checkout-create` checkout.
3. Keeps the **theme palette** parity green (the event page is the palette's ORIGIN — `themePalette.ts` was extracted verbatim FROM `PublicEventPage`).
4. Carries **NO refund-ladder/deadline** (the event model has neither field — trips do, events do not), and **ticket TIERS, not pay-in-full/installments** (events have no installment plan).

No schema change, no edge change, no checkout-contract change is required (see §4.0 — expected gap = NONE).

---

## 2. Scope & non-goals

### In scope
- **S1 (buyer web + business iOS/Android):** re-architect `mingla-business/src/components/event/PublicEventPage.tsx` (the adapter) + `packages/event-rendering/PublicEventPage.tsx` (the shared renderer) so the event page renders Direction A on the offering-rendering foundation. The buyer-web route `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` and the data hook `usePublicEventBySlug` feed it.
- **S2 (consumer app):** new `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (foundation event detail + reserve→cart), a new consumer adapter hook `app-mobile/src/hooks/useConsumerEventFoundation.ts`, a new consumer reserve component `app-mobile/src/components/offering/ConsumerEventReserveBar.tsx` (OR a generalization of `ConsumerTripReserveBar` — see OQ-1), a new consumer cold deep-link route `app-mobile/app/e/[brandSlug]/[eventSlug].tsx`, and the **repoint** of the deck event entry in `ExpandedCardModal.tsx` off EBES.
- **S3:** per-surface data adapters fetch the real event fields (tiers, capacity/remaining, venue geo, theme).
- **S4:** every state (loading / sold-out / few-left / sales-closed / free / no-cover / theme-absent / cancelled / password-gate / not-bookable / pre-sale / approval / waitlist / door-only) on all surfaces.
- **S5:** the venue + **map block** (Mapbox static-image util, honoring `hideAddressUntilTicket`).
- **S6:** strict-grep gates + regression tests (fails-on-revert).

### Non-goals (explicitly OUT)
- **N1 — Do NOT delete EBES.** Experiences (deck/venue) + chat still mount it. Final EBES deletion is Leg 3/4.
- **N2 — No refund ladder / booking-deadline on the event page.** The event public read carries neither (`PublicEventProps` in `packages/event-rendering/types.ts:48-82` has no `refundPolicy`/`bookingDeadline`; `BusinessPublicEventViewRow` does not select them). Rendering either would fabricate data (Constitution rule 9). **The trip's `RefundLadder` is NOT ported to the event page.**
- **N3 — No pay-in-full/installment toggle, no split CTA, no "Choose how you pay" card.** Events have no installment plan (`tier_metadata.installments` is trip-only). The event ticket panel is a TIER selector → one price → one CTA. (The split-CTA seam control from the trip leg is trip-only.)
- **N4 — No lineup / host / performer / agenda section.** The model has no such field (DESIGN §A.6, OQ-2). Render nothing.
- **N5 — No `vibe_tags`/`music_genres`/`party_types` chips.** Authored but NOT in the event public read; surfacing them needs a read-path change first — deferred (DESIGN §F.2, OQ-3).
- **N6 — No schema change, no migration, no edge-function change, no new RPC.** If IMPLEMENT finds one genuinely required, STOP and request a SPEC amendment (§4.0 says NONE expected).
- **N7 — No checkout-contract change.** The `runNativeCheckout` / `ticket-checkout-create` request stays byte-identical to today's EBES path (no address, no `taxCalculationId`; venue-sourced tax). Buyer-web checkout (`/checkout/{eventId}`) is untouched by this SPEC.
- **N8 — The wizard Step-5 preview is untouched.** The event wizard's preview path (if any) is not in scope; only the public buyer page + consumer detail change.
- **N9 — Recurring / multi-date events:** keep the existing `datesList` "Show all N dates" expansion in the date region (DESIGN §A.2). No new date-picker-scopes-tiers IA (OQ-4).

### Assumptions
- Leg 1 (trip) is merged and the foundation primitives are present and stable (verified: `packages/offering-rendering/` + `packages/event-rendering/themePalette.ts` present at HEAD).
- `buildStaticMapUrl` (`mingla-business/src/utils/mapboxStaticImage.ts`) is present and proven (it shipped with the trip leg; verified). The consumer app has no equivalent today — see OQ-5.
- The shared `resolveOfferingCta` / `computeOfferingVariant` / `CtaState` machine (`packages/event-rendering/offeringCta.ts`) is the single CTA owner for BOTH the inline tier rows AND the float/dock/sticky CTA on every surface (verified it already drives the event `FloatingOfferingBar` and the trip bars).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior demanded | Files touched | Parity |
|---|---------|---------|-------------------------------|---------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES | Tapping an event deck card opens the NEW foundation event detail (parallax cover, themed, City,Country venue + map, selectable tier list, float→dock CTA), Get-tickets opens `TicketCartSheet` directly → byte-identical `ticket-checkout-create`. No EBES. | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (NEW), `app-mobile/src/hooks/useConsumerEventFoundation.ts` (NEW), `app-mobile/src/components/offering/ConsumerEventReserveBar.tsx` (NEW or generalized), `app-mobile/app/e/[brandSlug]/[eventSlug].tsx` (NEW), `app-mobile/src/components/ExpandedCardModal.tsx` (repoint) | Manual (separate consumer path; mirrors trip) |
| 2 | **Consumer Android** (`app-mobile/` Android) | YES | Same as iOS; Android opaque-glass fallback on every translucent surface (chips, brand row, tier card, panel). | Same as #1 | Manual (same files; `Platform.select` opaque fallback) |
| 3 | **Buyer/anonymous Web** (`mingla-business/` `/e/{brandSlug}/{eventSlug}`) | YES | Logged-out buyer sees the Direction-A event page: parallax cover (full-bleed phone / contained desktop), brand theme + bold fonts, City,Country venue + map, selectable tiers, desktop sticky ticket panel, float→dock CTA, all states. Checkout via existing `/checkout/{eventId}` (unchanged). | `packages/event-rendering/PublicEventPage.tsx` (re-architect), `mingla-business/src/components/event/PublicEventPage.tsx` (adapter), `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` (route wiring) | Manual where web/native diverge (hover, position:fixed/sticky vs absolute) — foundation primitive owns the split |
| 4 | **Business iOS** (`mingla-business/` iOS in-app) | YES | Same Direction-A page rendered in-app (the same `PublicEventPage` mounts in-app); safe-area top padding for chrome, no hover. | Same as #3 | Automatic (shared `PublicEventPage` + foundation) |
| 5 | **Business Android** (`mingla-business/` Android in-app) | YES | Same as Business iOS + Android opaque-glass fallback. | Same as #3 | Automatic + `Platform.select` |
| 6 | **Admin Web** (`mingla-admin/`) | NO | Admin never renders the public event page. | none | n/a — adjacent, not a consumer |
| 7 | **Business Web preview** (wizard Step-5) | NO | Out of scope (N8); the wizard preview is a separate path and is not redesigned here. | none | n/a — explicitly deferred |

**HARD GATE:** surfaces 1–5 are all covered. The non-negotiable all-surface parity rule is satisfied by: web + business in-app share `PublicEventPage` (automatic parity); consumer is a separate path that REUSES the same foundation primitives + the same CTA machine + the same checkout request (manual parity, enforced by SC split + the parity tests in §7/§9).

---

## 4. Layered specification

### 4.0 Database / Edge / RPC — NO CHANGE (gap audit = NONE)

Traced every field Direction A needs against the existing read paths:

- **Event core + date/time + location + cover + brand + tiers + capacity/remaining + theme** — all already reach the page:
  - Buyer-web/business: `usePublicEventBySlug` → `publicEventsService.ts` → `BusinessPublicEventViewRow` (`:34`) → `publicEventViewRowToEvent` (`:701`) + `fetchTicketTypesRemaining` (`:814`, RPC `pg_public_ticket_types_remaining`) + `PublicEventDetail.bookable` (`:229`, `pg_brand_can_charge`). Maps into `PublicEventProps` / `PublicTicketProps` (`packages/event-rendering/types.ts`).
  - Consumer: the deck `businessEvent` card (`BusinessEventCard`) + `usePublicEventTickets(eventId)` (`app-mobile/src/hooks/usePublicEventTickets.ts`) + `useEventTheme(card)` (anon-safe `business_public_events_view`, 🔒 COMMS-0009) + `useNativeCheckoutFlow`. These already power EBES today (`ExpandedBusinessEventSheet.tsx`: `mapCardToPublicEvent` `:125`, `usePublicEventTickets` `:268`, `runNativeCheckout` `:345`).
- **Venue geo (lat/lng) for the MAP** — `events.location_geo` exists in the model (DESIGN §A.3, traced to `DraftEvent.locationGeo`). **AUDIT REQUIRED at IMPLEMENT step 0:** confirm `BusinessPublicEventViewRow` SELECTs the lat/lng (or `location_geo`) AND that the consumer `BusinessEventCard` carries it. **If the lat/lng is NOT in the public read row OR the consumer card today**, the MAP block is the ONLY field with a possible read-path gap. Resolution per rule 9 + N6:
  - If present on a surface → render the map (Mapbox static image), honoring `hideAddressUntilTicket` and hiding for `format==='online'`.
  - If ABSENT on a surface → **omit the map on that surface** (rule 9 — no fabricated tile), exactly as the trip consumer leg did (`ConsumerTripDetailScreen.tsx:1011-1014` deferred the consumer map because the consumer trip payload lacked lat/lng). Document the gap in the implementation report. Do NOT add a column/SELECT in this leg — if Seth wants the consumer map, that is a follow-on read-path ORCH (flag it). This keeps N6 intact.

**Conclusion: expected schema/edge/RPC gap = NONE.** The only data nuance is the map lat/lng presence per surface, handled by rule-9 omission, not a schema change.

### 4.1 `packages/event-rendering/PublicEventPage.tsx` — re-architect onto the foundation (shared renderer)

The shared renderer is currently a single-column stacked-card page. Re-architect its STRUCTURE to compose `ParallaxCoverShell` (the trip page's exact pattern in `TripPreview.tsx` FOUNDATION mode), keeping its existing theming/cover/CTA machinery.

- **Compose `ParallaxCoverShell`** (`@mingla/offering-rendering`) as the page shell:
  - `palette` / `theme` from the resolved brand theme (the page already resolves `resolveTheme` → it now also builds `createThemePalette(theme)` like the trip route; the event page is the palette's origin so this is in-family).
  - `coverMediaUrl` / `coverMediaType` from `event.coverMediaUrl`/`coverMediaType` (image/gif/video). `coverHue` from `event.coverHue` for the no-cover flat-hue fallback.
  - `entranceAnimationKey={`event:${event.id}`}` (preserve `ThemeEntranceAnimation` keyed once/session).
  - `muted` / `onToggleMute` / `showMute = coverMediaType==='video'` — cover-video sound via the chrome Mute icon (replaces today's text-glyph chrome).
  - `onClose` / `onShare` — route/adapter-owned (the adapter's `handleClose` + `ShareModal` via `handleShare` already exist).
  - `heroEyebrow` = the date eyebrow (DESIGN §B.2 — date is the hero fact); `heroTitle` = `event.name` (desktop hero shows them; phone shows them in the body lead block — mirror `TripPreview` `!isDesktop` lead vs hero).
  - `stateBanner` = the state pill (sold-out / few-left / sales-closed / pre-sale / not-bookable — see §4.5).
  - `stickyPanel` = the **desktop ticket panel** (§4.4).
  - `contentBottomInset` / `safeAreaTop` — route-owned (mirror trip route).
  - `onScroll` / `onScrollViewLayout` — forwarded for the float→dock pill visibility (§4.4).
- **Body content (the `children` / "left" column)** — render ONLY real fields (rule 9), in this STANDARD section order (mirror the trip's §FIX-6 standing order, MINUS trip-only blocks):
  1. phone-only lead block (date eyebrow + bold title; desktop shows them in the hero).
  2. **meta chips:** date · time · capacity ("N tickets left" — suppressed when `hideRemainingCount`) · **City,Country** (via `normalizeCityCountry`). Each chip renders only when its source is present.
  3. **brand chip** ("Presented by" + brand name + View) — phone inline; desktop in the sticky panel. Render the brand photo via the media-aware path with a clean themed-initial fallback (mirror `TripPreview` brand chip + the consumer FIX-3 initial fallback).
  4. **About** — collapsible (`CollapsibleDescription` on business; the consumer screen uses its own `ABOUT_COLLAPSE_THRESHOLD` toggle). Render only when `description` non-empty.
  5. **Where you'll be** — venue card (venue name + address honoring `hideAddressUntilTicket` → "Address shared after ticket purchase"; "Open maps" pill via `onOpenMaps`) PLUS the **map block** (§4.6). For `format==='online'`: the online card ("Conferencing link shared with ticketed guests") instead of venue+map.
  6. **Tickets** — the selectable **tier list** as the page spine (§4.3) + the all-in reassurance line ("All-in price — taxes & fees included, no surprises at checkout").
  7. phone-only **docked CTA** as the LAST body child (§4.4).
- **REMOVE on the event page** (trip-only, rule 9): the per-day itinerary spine, the route (departure→destination) line, the refund ladder, the booking-deadline strip, the "Choose how you pay" payment block, the split-CTA. None have an event data source.
- **Preserve:** `EventCoverMedia` (image/video/gif + Mute), `resolveOfferingCta`/`computeOfferingVariant`/`CtaState`, `JoinWaitlistSheet`, `PasswordGateVariant`, `CancelledVariant`, `PublicEventNotFound`, the `hideFloatingChrome` / `ScrollComponent` / `contentBottomInset` props (still consumed by EBES for experiences). **The shared renderer MUST stay byte-behaviorally compatible for its OTHER consumers** — i.e. EBES (experiences) still mounts it via `ScrollComponent` + `hideFloatingChrome`. The re-architecture must be gated/structured so the experience-in-EBES render does not regress (parity snapshot, §9). If the cleanest path is a FOUNDATION-vs-LEGACY dual-mode (like `TripPreview`: foundation when `palette`+`theme`+chrome handlers present, legacy otherwise), use that pattern so EBES's experience mount keeps the existing render. **This is the recommended approach** (matches the trip leg precedent exactly).

### 4.2 `mingla-business/src/components/event/PublicEventPage.tsx` — adapter (buyer-web + business in-app)

- Build `palette = createThemePalette(resolvedTheme)`, `surface = offeringSurfaceStyles/resolveOfferingSurface(...)`, `boldFamily = boldFontFamily(theme)`; load fonts via `useThemeFont(theme.fontFamilyValue)` + `useThemeFont(boldFamily)` (mirror trip route — the bold family is required or native bold no-ops; verified pattern at `app/t/.../[tripSlug].tsx:230-240`).
- Pass `palette`/`theme`/chrome handlers/`muted`/`onToggleMute`/`stateBanner`/`stickyPanel`/`dockedReserve`/`onScroll`/`onScrollViewLayout` into the shared `PublicEventPage` (FOUNDATION mode).
- Build the **desktop sticky ticket panel** (`stickyPanel`) and the **float/dock CTA** from the SAME `resolveOfferingCta(...)` (`offeringCta`) the page already computes (`:261-270`). Reuse the existing `handleFloatingBarPress` navigation (waitlist sheet / checkout push / not-bookable toast) — DO NOT change the checkout target (`checkoutPublicPath(event.id)`).
- Keep `ShareModal` + `Toast` + `JoinWaitlistSheet` + SEO `<Head>` at the adapter level (unchanged).
- The float→dock pill visibility wiring (dockTopY / scrollY / viewportH → `floatingPillVisible`) mirrors the trip route verbatim (`app/t/.../[tripSlug].tsx:250-269`).

### 4.3 Selectable ticket-TIER list (the page spine — all surfaces)

- A `radiogroup` of tier rows (DESIGN §1 a11y: `role="radiogroup"`, each tier `role="radio"` + `aria-checked`). Selecting a tier drives ONE price + ONE CTA in the sticky panel (desktop) and the float/dock bar (phone). Color is never the only indicator (selected = fill + accent rail + radio dot + bold; sold-out = "Sold out" label; free = the word "Free").
- Per-tier render (from `PublicTicketProps`): `name`, `description` ("what's included"), all-in price (`priceAllInGbp ?? priceGbp`, never recomputed — WYSIWYP) or "Free", capacity ("N available" / "Unlimited" / "Sold out"; suppressed by `hideRemainingCount`), and ✓/✗ included chips per tier ONLY when real (rule 9). `visibility==='hidden'` → not listed; `'disabled'` → "Sales paused" non-selectable.
- The selected tier seeds the CTA via `resolveOfferingCta` (the page-level machine already chooses From-price vs single price, free-vs-paid, sold-out→waitlist, door-only, sales-ended, pre-sale, not-bookable). The tier selection narrows the considered set; the resolved `CtaState` drives the button label + price text identically across surfaces.
- **Consumer:** the tier list lives in the new consumer screen body; selecting a tier seeds `initialTicketTypeId` for `TicketCartSheet` (mirror `ConsumerTripDetailScreen.openCart` seeding the sellable tier, `:463-472`).

### 4.4 The float→dock single ticket CTA (sleek button language)

- **Phone:** a DOCKED CTA as the LAST body child (resting position, may carry its page-colored background, pads its own safe-area bottom) + a FLOATING compact pill (label-only — "Get tickets →" / "Get free ticket →" / "Join waitlist →" / non-tappable info strip) shown ONLY while the docked CTA is scrolled off (visibility from `floatingPillVisible`). **NO split control** (events have no plan). Reuse the trip's float/dock mechanism exactly:
  - Business/web: a `EventReserveBar`-style component OR the existing `FloatingOfferingBar` upgraded to the trip's docked/floating two-variant shape. **Recommendation:** introduce `mingla-business/src/components/event/EventReserveBar.tsx` mirroring `TripReserveBar` (docked + floating variants, single CTA only) OR generalize `TripReserveBar` to be offering-agnostic (OQ-1). It MUST read the same `CtaState` so web + business + consumer bars are identical.
  - Consumer: `ConsumerEventReserveBar.tsx` mirroring `ConsumerTripReserveBar` (docked + floating, single CTA — drop the split-CTA branch entirely), reading the same `CtaState` + `ThemePalette` (OQ-1).
- **Desktop:** the float/dock bar is `display:none`; the **sticky ticket panel** (right column) carries the brand chip → "Choose your ticket" tier list → price block → CTA → reassurance ("N tickets left · secure checkout"). Mirror `TripPreview` `stickyPanel` (`:684-695`) but with the tier selector + single CTA (NOT the pay toggle).
- Constitution #1: non-tappable states render an info strip with NO `onPress` and `accessibilityRole="text"` (verified in both trip bars).
- Android: opaque accent fill, no shadow under the rounded fill (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`) — mirror the trip bars' `Platform.select`.

### 4.5 State banner + state machine (all surfaces)

Driven by `computeOfferingVariant(event, passwordUnlocked)` + `resolveOfferingCta(...)` (the shared machine — single owner). States and copy (DESIGN §D), each on phone (banner + float/dock bar) AND desktop (centered pill + sticky-panel CTA):

| State | Banner | CTA |
|---|---|---|
| available | none / "N tickets left" chip | accent "Get tickets" / single price |
| few left | accent "Only a few tickets left" | accent "Get tickets" |
| sold out | grey "SOLD OUT" | non-tappable "Sold out" (or "Join waitlist" if any tier `waitlistEnabled`) |
| sales closed (all `saleEndAt` past) | red "Ticket sales have closed" | non-tappable "Sales ended" |
| pre-sale (all `saleStartAt` future) | — | non-tappable "On sale soon" |
| not bookable (`bookable===false`) | — | non-tappable "Booking unavailable — organizer finishing payment setup" |
| approval-required tier | — | "Request approval" |
| door-only tier | — | "Pay at the door" (disabled online) |
| free | — | "Get free ticket" / price "Free" |
| password-gated | page-level `PasswordGateVariant` (existing) | — |
| cancelled | page-level `CancelledVariant` (existing) | — |
| cover=video | autoplay-muted, Mute toggles | — |
| cover=none | flat accent `coverHue` hero (title legible via scrim) | — |
| theme-absent | default MINGLA palette via `resolveTheme(null,null)` → `createThemePalette` (never a crash) | — |
| loading | skeleton: cover shimmer + title bar + 3 meta-chip bars + venue bar + 2 tier bars | — |
| error / not found | existing "Event could not load" / `PublicEventNotFound` | — |
| empty tickets | "No tickets available yet." (existing) | non-tappable "Not on sale yet" |

The CTA copy on each surface comes from `resolveOfferingCta` — do NOT hand-roll per-surface copy.

### 4.6 Venue + map block ("Where you'll be")

- Venue card: venue name + address. `hideAddressUntilTicket===true` → "Address shared after ticket purchase". "Open maps" pill via `onOpenMaps` (web/business) / a maps deep-link (consumer). Hidden for `format==='online'` (online card shown).
- Map: a static Mapbox image via `buildStaticMapUrl({ lat, lng, accentHex: palette.accent, height })` (`mingla-business/src/utils/mapboxStaticImage.ts`) — a plain `<Image>`, NO map SDK, NO new dependency, fail-safe (returns null when token/coords absent → omit the image, rule 9). Mirror `TripPreview` map block (`:615-653`). Themed pin + caption pill overlay.
- **Consumer map:** only if the consumer card carries lat/lng (§4.0 audit). If not, OMIT (rule 9) and document the gap — do NOT add a SELECT (N6). The consumer trip leg precedent did exactly this.

### 4.7 Consumer event detail — NEW screen (`ConsumerEventDetailScreen.tsx`)

Mirror `ConsumerTripDetailScreen` structurally:

- Hosts the body inside `BaseBottomSheet` (`scrollMode="view"`, `hidesBottomNav`, the SOLE gorhom consumer) with the gorhom `BottomSheetScrollView` as a DIRECT child (the LOAD-BEARING ORCH-1016/1043 scroll structure — do NOT re-wrap; verified note at `ConsumerTripDetailScreen.tsx:1370-1390`).
- Composes the Direction-A native look AROUND the scroll (pinned `EventCoverMedia` absolute sibling, `OfferingChrome` close/share/mute absolute sibling, float→dock `ConsumerEventReserveBar`) — **NOT** by mounting `ParallaxCoverShell` as the sheet host (its native branch nests its ScrollView in a `nativeHost` view → re-triggers the scroll-freeze; the trip screen composes around it for exactly this reason).
- Data: `useConsumerEventFoundation(detail, palette)` (NEW adapter hook, §4.8) maps the event onto the foundation render inputs. Theme via `useEventTheme(card)` where `card = { eventId }` minimal (anon-safe, 🔒 COMMS-0009; mirror the trip's minimal-card pattern `:383-397`). `usePublicEventTickets(eventId)` for tier/cart.
- Reserve → `TicketCartSheet` DIRECTLY (seed the sellable/selected tier), NEVER EBES. `handleBuy` ported from EBES `handleBuy` (`ExpandedBusinessEventSheet.tsx:313-432`) — same buyer derivation, same guards, **byte-identical `runNativeCheckout` request** (no address, no `taxCalculationId`; `intakeFormData` only when non-empty), same success/cancel/failure toasts + the same post-success cache invalidations (`businessEventOrders` + `circleKeys` + the 3× polling loop for paid). `TicketCartSheet` renders as a SIBLING `BaseBottomSheet` root in the same fragment.
- Loading / error / not-found states: short non-scrolling `BaseBottomSheet` (`scrollMode="view"`) — mirror the trip screen's three early-return state sheets.
- Props: `{ brandSlug, eventSlug, seed?: BusinessEventCard | null, onBack, tabBarAware?, accountPreferences? }` — mirror trip screen.

> **NOTE on the data source:** unlike trips (which have `useConsumerTripDetail` doing a slug fetch), the consumer event flow is opened from the deck with a `BusinessEventCard` already in hand (the `seed`). The new screen can render directly from the seed + `usePublicEventTickets`/`useEventTheme` (no new slug-fetch hook required for the deck path). The cold deep-link route (`app/e/.../[eventSlug].tsx`) opens with `seed={null}` — for that path, IMPLEMENT must resolve the event by slug. **AUDIT at IMPLEMENT step 0:** is there an existing anon-safe event-by-slug consumer fetch? If not, the cold deep-link route is the one place that may need a small consumer fetch hook (`useConsumerEventDetail`) reusing the SAME anon-safe view the business `usePublicEventBySlug` uses — this is a CLIENT hook, NO schema/edge change (N6 intact). If resolving by slug anon-side is not currently possible without a backend change, **STOP and flag** (cap the cold-deep-link sub-feature, ship the deck path, raise an OQ) rather than adding backend scope.

### 4.8 Consumer adapter hook — NEW (`useConsumerEventFoundation.ts`)

Pure projection of the consumer event data (`BusinessEventCard` + tiers + resolved palette) onto the foundation render inputs (mirror `useConsumerTripFoundation.ts`): cover, title, date eyebrow/chips, capacity label (honor `hideRemainingCount`), City,Country (`normalizeCityCountry`), brand name/verified/cover, description, tiers, venue + (optional) geo, `bookable`. Returns null/[] for absent fields (rule 9). NO Supabase table read (🔒 I-ANON-BRANDS-VIA-DEFINER-VIEW / COMMS-0009). NO `mingla-business/src` import (🔒 I-MOR-0827-PACKAGE-ISOLATION).

### 4.9 Deck repoint (`ExpandedCardModal.tsx`)

- The `businessEvent !== null` branch (`:1740-1753`) currently returns `<ExpandedBusinessEventSheet data={businessEvent} ... />`. **Repoint it** to mount `<ConsumerEventDetailScreen seed={businessEvent} onBack={onClose} ... />` (the EVENT flow).
- The ORCH-1072 venue-experience EBES mount (`:2259`) is UNTOUCHED (experiences stay on EBES — N1).
- `MessageInterface.tsx` EBES mount is UNTOUCHED (chat stays on EBES).
- The `mapCardToPublicEvent` export + EBES itself stay (experiences/chat consume them).

### 4.10 Routes

- **Buyer-web:** `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` — wire `palette`/`theme`/chrome/sticky-panel/float-dock state (mirror the trip route's `ResolvedTripPage` child split: resolve theme/fonts only when payload exists). Keep the strict-grep-allow safe-area comment (already present).
- **Consumer cold deep-link:** `app-mobile/app/e/[brandSlug]/[eventSlug].tsx` (NEW) — re-export mounting `ConsumerEventDetailScreen` with `seed={null}`, `tabBarAware={false}` (mirror `app-mobile/app/t/[brandSlug]/[tripSlug].tsx`). Honors the `PUBLIC_BUYER_ROUTE_PREFIXES` allowlist (the `/e/` prefix must be exempt from the ORCH-1102 auth gate — verify it is already in `coldLoadAuthGates.ts`; if not, that's an ORCH-1115-class fix — flag, do not silently add scope).

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1-Web / SC-1-BizIOS / SC-1-BizAndroid:** the public event page renders Direction A via `ParallaxCoverShell` (parallax cover, body-level fixed chrome X·Share·Mute, brand-themed palette + bold fonts, City,Country venue, venue+map, date/time facts, selectable tier list, desktop sticky panel, float→dock single CTA). No itinerary, no route line, no refund ladder, no deadline strip, no pay-toggle.
- **SC-2-iOS / SC-2-Android:** tapping an event deck card opens `ConsumerEventDetailScreen` (foundation look), NOT EBES; the sheet body scrolls (not frozen) and the float→dock CTA shows.
- **SC-3 (all):** the tier list is a radiogroup; selecting a tier updates the single price + single CTA in the sticky panel (desktop) and float/dock bar (phone); color is never the only state indicator.
- **SC-4 (all):** every state in §4.5 renders the exact banner + CTA copy from `resolveOfferingCta`/`computeOfferingVariant` — including sold-out→waitlist, sales-closed, pre-sale, not-bookable, free, approval, door-only, password-gate, cancelled, no-cover, theme-absent, loading skeleton, empty-tickets.
- **SC-5 (all):** the venue+map block honors `hideAddressUntilTicket` (address hidden until purchase) and hides the map for `format==='online'`; the map fails safe (omitted, no fabricated tile) when coords/token absent.
- **SC-6-iOS / SC-6-Android:** Get-tickets / Get-free / approval / waitlist on the consumer screen opens `TicketCartSheet` directly and fires a `ticket-checkout-create` request **byte-identical** to the pre-redesign EBES path (no address, no `taxCalculationId`, same `lines`/buyer/`intakeFormData` shape, same `paymentPlanChoice` omission for events).
- **SC-7 (all):** the theme palette parity snapshot stays green (the event page is the palette origin — no algorithm drift).
- **SC-8 (Biz Android / consumer Android):** every translucent surface uses the opaque ≥0.92 frosted fallback (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`).
- **SC-9 (all):** EBES's OTHER consumers (deck/venue experience, chat) render UNCHANGED — the shared `PublicEventPage` stays behavior-compatible for the experience-in-EBES mount (parity snapshot green).

---

## 6. Invariants

### Preserved
- **I-MOR-0827-PACKAGE-ISOLATION** — `packages/offering-rendering` + `packages/event-rendering` import NO app `src/`; the consumer adapter hook + reserve bar import NO `mingla-business/src`. *Test:* the existing package-isolation gate + a grep in the new consumer files.
- **I-ANON-BRANDS-VIA-DEFINER-VIEW / COMMS-0009** — consumer event theme/brand data flows via `business_public_events_view` / `business_public_brands_view` (anon-safe definer views), NEVER `.from('brands')`. *Test:* grep the new consumer screen + hook.
- **I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED (ORCH-1076)** — `bookable===false` (paid brand can't charge) → non-tappable "Booking unavailable" CTA on every surface, never a dead-end checkout. *Test:* a state test (§7).
- **I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED** — Reserve/Get-tickets opens the cart (confirmation step), never auto-charges. *Test:* the cart-mount assertion.
- **Sheet-scroll invariant (ORCH-1016/1043)** — the consumer screen's gorhom `BottomSheetScrollView` is a DIRECT child of `BaseBottomSheet`; the float bar is an absolute sibling, NOT `stickyFooter`. *Test:* the existing consumer-screen scroll structure test, extended to the event screen.
- **Constitution rule 9** — render only real fields; no fabricated map/lineup/vibe/refund/deadline. *Test:* the rule-9 absence assertions in §7.
- **Constitution rule 1** — no dead taps; non-tappable CTA states are info strips with no `onPress`.
- **All event date/time formatting via `eventDateDisplay.ts`** (existing invariant, line 1918) — the redesign must keep using `formatDraftDateLine`/`formatDraftDateSubline`/`formatDraftDatesList`; no new ISO formatter.

### New (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip)
- **I-PROPOSED-1138-EVENT-DECK-OFF-EBES (DRAFT)** — the consumer EVENT deck entry MUST open `ConsumerEventDetailScreen` directly; it MUST NOT mount `ExpandedBusinessEventSheet` for the `businessEvent` branch. (EBES remains for the experience branch + chat.) *Gate:* `.github/scripts/strict-grep/orch-1138-event-deck-off-ebes.mjs` (§9).
- **I-PROPOSED-1138-EVENT-ON-FOUNDATION (DRAFT)** — the public event page (shared `PublicEventPage` FOUNDATION mode + consumer screen) MUST render via the `@mingla/offering-rendering` primitives (`ParallaxCoverShell`/`OfferingChrome`/`CountAwareGallery`/`ChipGroup`/`useResponsiveLayout`) and MUST NOT carry a refund-ladder, booking-deadline strip, itinerary spine, route line, or pay-in-full/installment toggle. *Gate:* `.github/scripts/strict-grep/orch-1138-event-no-trip-only-blocks.mjs` (§9).
- **I-PROPOSED-1138-EVENT-CHECKOUT-BYTE-IDENTICAL (DRAFT)** — the consumer event `runNativeCheckout` request MUST carry no `address`/`taxCalculationId` and MUST omit `paymentPlanChoice` for events (events have no plan). *Test:* the byte-identical checkout test (§7 / §9).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 | Web event page renders foundation | published event, paid tiers, brand theme | `ParallaxCoverShell` present; parallax cover; tier radiogroup; sticky panel desktop; float/dock phone; no itinerary/route/refund/deadline/pay-toggle nodes | Component (web) |
| T-2 | Biz in-app renders same | same event in-app | same as T-1, safe-area chrome, no hover | Component (biz iOS/Android) |
| T-3 | Consumer deck opens new screen | tap event deck card | `ConsumerEventDetailScreen` mounts; NO `<ExpandedBusinessEventSheet>` in the event path | Component (consumer) |
| T-4 | Consumer sheet scrolls | long event body | gorhom `BottomSheetScrollView` direct child of `BaseBottomSheet`; body scrolls; float bar visible | Component (consumer) |
| T-5 | Tier selection drives one CTA | 3 tiers, select VIP | price + CTA reflect VIP; radiogroup aria-checked moves | Component (all) |
| T-6 | Sold out + waitlist | all tiers sold out, one `waitlistEnabled` | banner "SOLD OUT"; CTA "Join waitlist" | State machine |
| T-7 | Sales closed | all `saleEndAt` past | banner "Ticket sales have closed"; CTA non-tappable "Sales ended" | State machine |
| T-8 | Not bookable | `bookable=false` paid | CTA non-tappable "Booking unavailable …"; no checkout fired | State machine |
| T-9 | Free event | all tiers free | CTA "Get free ticket"; price "Free" | State machine |
| T-10 | No cover | `coverMediaUrl=null` | flat `coverHue` hero; title legible; no broken image | Component |
| T-11 | Theme absent | brand theme null | default MINGLA palette; no crash | Component |
| T-12 | hideAddressUntilTicket | `hideAddressUntilTicket=true` | address "Address shared after ticket purchase"; no leak | Component |
| T-13 | Online event | `format='online'` | online card; NO map block | Component |
| T-14 | Map fail-safe | coords/token absent | map image omitted; no fabricated tile; no crash | Component |
| T-15 | Byte-identical checkout | consumer Get-tickets | `runNativeCheckout` request has no address/taxCalculationId; no `paymentPlanChoice` | Service/integration |
| T-16 | Palette parity | createThemePalette inputs | byte-identical palette vs pre-change (origin) | Snapshot |
| T-17 | EBES experience unchanged | open experience from venue | EBES still mounts shared `PublicEventPage`; experience renders as today | Component (regression) |
| T-18 | Rule-9 absence | event with no map/lineup/refund | zero refund/deadline/itinerary/lineup/vibe nodes rendered | Component |

---

## 8. Implementation order

0. **Audit step (no code):** confirm (a) venue lat/lng presence in `BusinessPublicEventViewRow` + the consumer `BusinessEventCard` (§4.0/§4.6), (b) an anon-safe event-by-slug consumer fetch exists or the cold-deep-link path is degradable (§4.7), (c) `/e/` is in `PUBLIC_BUYER_ROUTE_PREFIXES` (§4.10). Any genuine backend gap → STOP, request a SPEC amendment (do NOT add schema/edge scope).
1. **Shared renderer:** re-architect `packages/event-rendering/PublicEventPage.tsx` to FOUNDATION mode on `ParallaxCoverShell` (dual-mode like `TripPreview` so EBES's experience mount keeps the legacy render). Add the selectable tier list + venue/map block + state banner. Keep the parity snapshot green.
2. **Business reserve bar + sticky panel:** add `EventReserveBar.tsx` (docked/floating single CTA) OR generalize `TripReserveBar` (OQ-1); build the desktop sticky ticket panel.
3. **Business adapter + route:** wire `mingla-business/src/components/event/PublicEventPage.tsx` (palette/theme/fonts/chrome/sticky/float-dock) + `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`.
4. **Consumer adapter hook:** `app-mobile/src/hooks/useConsumerEventFoundation.ts`.
5. **Consumer reserve bar:** `app-mobile/src/components/offering/ConsumerEventReserveBar.tsx` (single CTA; no split).
6. **Consumer screen:** `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (foundation compose-around-scroll + `handleBuy` ported from EBES + `TicketCartSheet` direct).
7. **Consumer cold route:** `app-mobile/app/e/[brandSlug]/[eventSlug].tsx`.
8. **Deck repoint:** `ExpandedCardModal.tsx` `businessEvent` branch → `ConsumerEventDetailScreen` (experience + chat EBES mounts untouched).
9. **Gates + tests:** add the strict-grep gates (§9) + the §7 tests.

---

## 9. Regression prevention (fails-on-revert contract)

- **G-1 — `orch-1138-event-deck-off-ebes.mjs`** (mirror `orch-1138-trip-reserve-straight-to-cart.mjs`): assert (comments stripped) that `ExpandedCardModal.tsx`'s active `businessEvent` branch mounts `ConsumerEventDetailScreen` and does NOT mount `<ExpandedBusinessEventSheet>` in that branch; assert the consumer event screen imports + mounts `TicketCartSheet` and does NOT import/mount EBES. Self-test env `ORCH1138_SIMULATE_REVERT=1` restores the EBES mount → gate MUST FAIL. (The experience + chat EBES mounts must still pass — the gate is scoped to the event branch / the consumer event screen, NOT a blanket EBES ban.)
- **G-2 — `orch-1138-event-no-trip-only-blocks.mjs`:** assert the event page files (shared FOUNDATION render path + consumer screen) contain NO refund-ladder / booking-deadline / itinerary-spine / route-line / pay-in-full-toggle render (rule 9 / N2 / N3). FAILS if any trip-only block is copy-pasted in.
- **G-3 — checkout byte-identical test:** a unit/integration test asserting the consumer event `runNativeCheckout` payload has no `address`/`taxCalculationId` and no `paymentPlanChoice` (FAILS if a future edit reintroduces a tax form or address). Protective comment cites I-PROPOSED-1138-EVENT-CHECKOUT-BYTE-IDENTICAL + ORCH-1025/1130.
- **G-4 — palette parity:** the existing `createThemePalette.parity.orch1138.test.ts` MUST stay green (the event page is the origin). Protective comment: "event page re-architecture must not drift the palette algorithm."
- **G-5 — EBES-experience-unchanged regression:** a render test mounting the shared `PublicEventPage` via the EBES experience path (`ScrollComponent` + `hideFloatingChrome`) asserts it still renders the legacy experience layout (proves SC-9 / N1).

Each gate FAILS when its protected change is reverted and PASSES when restored.

---

## 10. Open questions (for Seth before/at IMPLEMENT)

- **OQ-1 (reuse vs new component):** prefer (a) generalizing `TripReserveBar`/`ConsumerTripReserveBar` to an offering-agnostic single-CTA bar (max reuse, slight refactor of a shipped trip file — risk to trip parity), or (b) new `EventReserveBar`/`ConsumerEventReserveBar` mirroring them (zero risk to trip, mild duplication)? **Recommendation: (b)** — keeps the shipped trip leg untouched (lower blast radius), matches the trip-leg precedent of consumer-local mirror components. Confirm.
- **OQ-2 (lineup/host):** the model has no host/lineup field. Render nothing now (rule-9-clean), or spawn a separate authoring+read ORCH later? **Recommend: leave out now.** (DESIGN §F.1.)
- **OQ-3 (vibe/music/party-type chips):** authored but not in the event public read; surfacing needs a read-path change (out of this leg's N6). Defer? **Recommend: defer.** (DESIGN §F.2.)
- **OQ-4 (multi-date/recurring):** keep the existing `datesList` "Show all N dates" in the date region (no per-date tier scoping)? **Recommend: keep existing.** (DESIGN §F.3 / §A.2.)
- **OQ-5 (consumer map data):** if the consumer `BusinessEventCard` lacks venue lat/lng (§4.0), the consumer map is OMITTED (rule 9) and the web/business map ships — acceptable per-surface degradation for this leg (matches the trip-consumer precedent), with a follow-on read-path ORCH if Seth wants the consumer map. Confirm acceptable.
- **OQ-6 (cold-deep-link consumer event fetch):** if no anon-safe event-by-slug consumer fetch exists, ship the deck path (seed-driven) and cap the consumer cold deep-link with an OQ rather than adding backend scope. Confirm acceptable.

---

## 11. Downstream routing

**Next = mingla-implementor (Codex), then mingla-tester, then orchestrator CLOSE.**

**Allowlist (the implementor MAY change ONLY these):**
- `packages/event-rendering/PublicEventPage.tsx`
- `packages/event-rendering/index.ts` (only if a new export is needed for the event tier/CTA wiring)
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`
- `mingla-business/src/components/event/EventReserveBar.tsx` (NEW, per OQ-1(b))
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (NEW)
- `app-mobile/src/hooks/useConsumerEventFoundation.ts` (NEW)
- `app-mobile/src/components/offering/ConsumerEventReserveBar.tsx` (NEW)
- `app-mobile/app/e/[brandSlug]/[eventSlug].tsx` (NEW)
- `app-mobile/src/components/ExpandedCardModal.tsx` (the `businessEvent` branch ONLY)
- `.github/scripts/strict-grep/orch-1138-event-deck-off-ebes.mjs` (NEW), `.github/scripts/strict-grep/orch-1138-event-no-trip-only-blocks.mjs` (NEW)
- the §7 test files (NEW, under the appropriate `__tests__/`)

**DO-NOT-TOUCH:**
- `packages/offering-rendering/*` (the shipped foundation — REUSE, do not fork/edit). Editing `ParallaxCoverShell`'s native branch is FORBIDDEN (the trip leg proved it freezes the gorhom sheet — compose around it).
- `packages/event-rendering/themePalette.ts` / `offeringCta.ts` / `EventCoverMedia.tsx` (REUSE verbatim).
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (keep — experiences + chat use it; N1).
- `ExpandedCardModal.tsx` lines outside the `businessEvent` branch (esp. the ORCH-1072 experience EBES mount at `:2259`).
- `app-mobile/src/components/MessageInterface.tsx` (chat EBES mount — untouched).
- `mingla-business/src/components/trip/*` + `app/t/*` + `app-mobile/src/screens/Trip/*` + `ConsumerTripReserveBar.tsx` (the shipped trip leg — untouched unless OQ-1(a) is chosen, which requires a SPEC amendment).
- Any `supabase/` migration / function / RPC (N6 — no backend change).
- `mingla-business/app/checkout/*` (the buyer-web checkout — N7).

Any change outside the allowlist → STOP and request a SPEC amendment (`SPEC_AMENDMENT_ORCH-1138_LEG2_EVENT_PAGE.md` or appended in-file).

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1138-[event-page]/` on branch `ORCH-1138-event-page`.
