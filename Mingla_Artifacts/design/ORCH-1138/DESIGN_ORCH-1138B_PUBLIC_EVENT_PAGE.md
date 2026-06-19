# DESIGN — ORCH-1138B Public EVENT Page Redesign (Direction A, event-tuned)

**Status:** DESIGN-FIRST. Mockup for review BEFORE any implementation.
**Surface:** Public buyer-anon EVENT page — `mingla-business` React Native Web, route `/e/[brandSlug]/[eventSlug]` (`mingla-business/app/e/[brandSlug]/[eventSlug].tsx`). Mounted in-app via the same shared `@mingla/event-rendering` `PublicEventPage`.
**Deliverable:** `EVENT_DIRECTION_A_RESPONSIVE.html` — one self-contained responsive mockup. Open by double-clicking; resize ≤1023px = phone immersive, ≥1024px = desktop two-column. Demo bar: brand color swatches + font + **State** (Available / Few left / Sold out / Sales closed) + **Cover** (Image / Video / No media) + the **tier selector** (select a tier → price + CTA + floating bar react).
**Inherits:** the APPROVED Direction A trip system (`DIRECTION_A_V2_FULL_RESPONSIVE.html`, Seth: "works perfect") — phone parallax cover, body-level fixed chrome (X · Share · Mute), brand theming, overlapping rounded body card, desktop 2-column with sticky right panel, count-aware galleries, wrapping check/✗ chips. **Fine-tuned** for a single-date ticketed event (see §B).

> **The big difference from the trip:** an event is **ONE date with ticket TIERS**, not a multi-day narrative with an installment plan. So: (1) the trip's per-day **itinerary spine is removed** — that vertical space becomes the **venue + map + the ticket-tier list**; (2) the right sticky panel is the **TICKET panel** (tier select → all-in price → free-vs-paid CTA + capacity), NOT a pay-in-full/over-time toggle; (3) the **refund-ladder + booking-deadline strips are removed** — the event public read carries **neither field** (trips do, events do not — see §A.6). Everything else (parallax, chrome, theme, seam, brand chip, About, two-column architecture, count-aware media) is the trip system unchanged.

---

## A. FIELD INVENTORY — every field a single EVENT can actually carry (traced to source)

Sourced by reading the real authoring + public contract, **NOT guessed**:
- **Authoring (what an event can hold):** `mingla-business/src/components/event/EventCreatorWizard.tsx` (7 steps: Basics · When · Where · Cover · Tickets · Settings · Preview) → `DraftEvent` + `TicketStub` in `mingla-business/src/store/draftEventStore.ts:83` (TicketStub) / `:230` (DraftEvent).
- **Public read shape (what reaches the buyer page):** `mingla-business/src/services/publicEventsService.ts` → `BusinessPublicEventViewRow` (`:34`) + `publicEventViewRowToEvent` (`:701`) + `fetchTicketTypesRemaining` (`:814`, `pg_public_ticket_types_remaining`) + `PublicEventDetail.bookable` (`:229`).
- **Render contract (the package the page builds against):** `packages/event-rendering/types.ts` → `PublicEventProps` (`:48`) + `PublicTicketProps` (`:21`) + `PublicBrandProps` (`:84`). This file IS the cross-app contract.

### A.1 Event core (`events` row, `event_type='event'`)
| Field | Source | Rendered as |
|---|---|---|
| `name` | `events.title` → `PublicEventProps.name` (`types.ts:50`; view row `title` `:47`) | Hero/lead title |
| `description` | `events.description` → `PublicEventProps.description` (`types.ts:54`) | About block (collapsible "Read more" — existing `ABOUT_COLLAPSE_THRESHOLD` pattern, `PublicEventPage.tsx:950`) |
| `slug` / `brandSlug` / `eventSlug` | `PublicEventProps.eventSlug/brandSlug` (`types.ts:52-53`) | URL + Share only |
| `coverHue` | `events` → `PublicEventProps.coverHue` (`types.ts:72`) | **No-cover fallback** flat accent-derived hue |
| `coverMediaUrl` | `events.cover_media_url` → `PublicEventProps.coverMediaUrl` (`types.ts:73`) | Full-bleed parallax hero |
| `coverMediaType` | `events.cover_media_type` (`image`\|`video`\|`gif`) → `PublicEventProps.coverMediaType` (`types.ts:74`) | video → autoplay-muted, toggled by the circular **Mute** icon in chrome (existing `EventCoverMedia.tsx` VolumeGlyph) |
| `coverCredit` | `events.cover_media_credit` → `PublicEventProps.coverCredit` (`types.ts:75`) | Small credit caption over cover (existing `coverCreditText`, `PublicEventPage.tsx:610`) |
| `status` | `events.status` → `PublicEventProps.status` (`draft`\|`published`\|`ended`\|`cancelled`, `types.ts:62`) | Gates variant (cancelled → CancelledVariant; ended → "Sales ended") |
| `endedAt` | `PublicEventProps.endedAt` (`types.ts:63`) | Past-event variant basis |
| `themeOverrides` | `events.theme` override → `PublicEventProps.themeOverrides` (`types.ts:81`) | Per-event accent/font/animation override (feeds `resolveTheme`) |

### A.2 Date & time (single date — `event_dates` master row)
| Field | Source | Rendered as |
|---|---|---|
| `dateLine` | derived from `master_start_at`/timezone (`publicEventsService.ts:77`, `splitTimestampInTz`) → `PublicEventProps.dateLine` (`types.ts:57`) | Hero eyebrow + date chip "Sat, Sep 14, 2026" |
| `dateSubline` | derived doors/ends time → `PublicEventProps.dateSubline` (`types.ts:58`) | Time chip "7:00 PM – 11:30 PM" |
| `datesList` | `PublicEventProps.datesList` (`types.ts:59`) | Multi-/recurring-date list (existing `SHOW_INITIAL_DATES` "Show all N dates"). **For a single-date event this is one entry** — the redesign focuses on the single-date case; multi-date events reuse the existing date-list expansion in the date region. |
| `timezone` | `events.timezone` / `master_timezone` (`publicEventsService.ts:69,79`) | Date/time formatting basis |

> NOTE: An event can also be **recurring** or **multi_date** (`DraftEvent.whenMode`, `:263`). This redesign is tuned for the **single-date** case per the brief; recurring/multi-date events render the same shell with the existing `datesList` "Show all N dates" expansion in the date region (no new IA needed — it is already date-driven, not itinerary-driven).

### A.3 Location (`events` — format-aware, privacy-gated)
| Field | Source | Rendered as |
|---|---|---|
| `format` | `events.format` (`in-person`\|`online`\|`hybrid`) → `PublicEventProps.format` (`types.ts:66`) | Drives venue vs "Online" card (existing `PublicEventPage.tsx:829`) |
| `venueName` | `events` → `PublicEventProps.venueName` (`types.ts:67`) | Venue block title |
| `address` | `events.location_text` → `PublicEventProps.address` (`types.ts:68`) | Venue block subline (privacy-gated, below) |
| `hideAddressUntilTicket` | `events` → `PublicEventProps.hideAddressUntilTicket` (`types.ts:69`; authored `DraftEvent.hideAddressUntilTicket:311`) | true → address replaced with "Address shared after ticket purchase"; false → full address (existing `venueAddressLabel`, `PublicEventPage.tsx:506`) |
| `onlineUrl` | `DraftEvent.onlineUrl:309` | NOT shown publicly — "Conferencing link shared with ticketed guests" (existing online-card copy, `PublicEventPage.tsx:943`) |
| `locationGeo` (lat/lng) | `events.location_geo` ← `DraftEvent.locationGeo:307` | **MAP block** (lat/lng exist in the model; the current page does NOT render a map — the redesign adds one, honoring rule 9). Hidden when `format==='online'`. |
| `city` | `events.city` ← `DraftEvent.city:302` | City chip "Washington, DC" |
| maps deep-link | `callbacks.onOpenMaps` (`types.ts:104`) | "Open maps" pill on the venue card (existing `canOpenVenueMaps`, `PublicEventPage.tsx:518`) |

### A.4 Tickets / tiers (`ticket_types` → `PublicTicketProps[]`)
| Field | Source | Rendered as |
|---|---|---|
| `tickets[]` | `PublicEventProps.tickets` (`types.ts:78`) | The **ticket-tier list** (the event's money IA — replaces the trip's itinerary spine as the page's spine) |
| `tier.name` | `PublicTicketProps.name` (`types.ts:23`) | Tier row title |
| `tier.description` | `PublicTicketProps.description` (`types.ts:24`; authored `TicketStub.description:145`) | Tier "what's included" subline (e.g. "VIP includes dinner + early entry") |
| `tier.priceAllInGbp` ?? `priceGbp` | `PublicTicketProps.priceAllInGbp` (`types.ts:32`) / `priceGbp` (`:25`) | **All-in price** (WYSIWYP; never recompute in TS — `PublicEventPage.tsx:330`). Falls back to base when all-in absent. |
| `tier.currency` | `PublicTicketProps.currency` (`types.ts:33`) / event `currency` (`:79`) | Price symbol |
| `tier.isFree` | `PublicTicketProps.isFree` (`types.ts:34`) | "Free" price + "Get free ticket" CTA |
| `tier.isUnlimited` / `capacity` | `PublicTicketProps.isUnlimited`/`capacity` (`types.ts:35-36`) | "Unlimited" / "N available" capacity label (existing `capacityLabel`, `PublicEventPage.tsx:1148`) |
| remaining (sold-out) | `pg_public_ticket_types_remaining` → folded into per-tier `capacity` (`publicEventsService.ts:814`) | "Sold out" per-tier + page-level Sold-out variant |
| `tier.visibility` | `PublicTicketProps.visibility` (`visible`\|`hidden`\|`disabled`, `types.ts:37`) | hidden → not listed; disabled → "Sales paused" |
| `tier.saleStartAt` / `saleEndAt` | `PublicTicketProps.saleStartAt`/`saleEndAt` (`types.ts:40-41`) | Pre-sale "On sale soon" / "Sales ended" (existing `ticketSaleEnded`, `offeringCta.ts:18`) |
| `tier.approvalRequired` | `PublicTicketProps.approvalRequired` (`types.ts:42`) | CTA → "Request approval" |
| `tier.waitlistEnabled` | `PublicTicketProps.waitlistEnabled` (`types.ts:43`) | sold-out + waitlist → "Join waitlist" |
| `tier.passwordProtected` | `PublicTicketProps.passwordProtected` (`types.ts:38`) | page-level password-gate variant (existing `PasswordGateVariant`) |
| `tier.availableAt` | `PublicTicketProps.availableAt` (`online`\|`door`\|`both`, `types.ts:44`) | door-only → "Pay at the door" (existing `ticketIsDoorOnly`, `offeringCta.ts:26`) |
| `tier.displayOrder` | `PublicTicketProps.displayOrder` (`types.ts:45`) | Tier sort order |
| all-in switches | `DraftEvent.pricingSwitches:335` (authoring-only) | Drives the "Taxes & fees included" all-in copy; not buyer-set |
| `bookable` | `PublicEventDetail.bookable` (`publicEventsService.ts:229`; `pg_brand_can_charge` for paid) | False ⇒ CTA = non-tappable "Booking unavailable — organizer finishing payment setup" (ORCH-1117) |

### A.5 Brand (`brands` → `PublicBrandProps`)
| Field | Source | Rendered as |
|---|---|---|
| `brand.displayName` | `PublicBrandProps.displayName` (`types.ts:87`) | Brand chip "Presented by" + name |
| `brand.photo` | `PublicBrandProps.photo` (`types.ts:88`) | Brand avatar tile (letter fallback — existing `brandLetter`, `PublicEventPage.tsx:505`) |
| `brand.slug` | `PublicBrandProps.slug` (`types.ts:86`) | "View" tap → brand page (`callbacks.onOpenBrand`) |
| `brand.theme` | `PublicBrandProps.theme` (`types.ts:89`) via `resolveTheme` + `createThemePalette` | Drives ALL accent/font + light/dark + contrast text |

### A.6 Fields the model does/doesn't carry — and WHY (rule 9 audit)
- **NO refund policy on events.** The event public read row (`BusinessPublicEventViewRow`, `publicEventsService.ts:34`) and `PublicEventProps` (`types.ts:48`) carry **no `refund_policy` field**. `refundPolicy` exists ONLY on the **trip** mapping (`getPublicTripById`, `publicEventsService.ts:1440`, ORCH-0875). **→ The trip page's refund ladder is CUT from the event page.** Rendering it would fabricate data.
- **NO booking deadline on events.** Same: `bookingDeadline` exists only on the trip mapping (`publicEventsService.ts:1442`), not on the event public read. **→ The trip page's "Bookings close …" deadline strip is CUT.** (Per-tier `saleEndAt` IS real and drives "Sales ended" — that is the event-native equivalent and is kept.)
- **NO host / lineup / performer / agenda field.** A repo-wide grep of `events` migrations and the public read row found **no** host/lineup/performer/artist/speaker/agenda column. **→ No lineup/host section is rendered** (the brief listed it as conditional; the model has nothing to populate it). This is the field I flag below.
- **`party_types` / `vibe_tags` / `music_genres` (authored but NOT in the public read).** `DraftEvent.partyTypes/vibeTags/musicGenres` (`:245/250/256`) persist to `events.*`, but `BusinessPublicEventViewRow` does **not** select them, so they do not reach the buyer page today. **→ NOT rendered** (rendering would require a read-path change first). Flagged below as the second unsure field.
- **`onlineUrl` (NOT shown).** Intentionally hidden — link is shared post-purchase (existing behavior, kept).
- **`requireApproval` / `privateGuestList` / `hideRemainingCount` / `inPersonPaymentsEnabled` (Settings).** `hideRemainingCount` (`DraftEvent.hideRemainingCount:344`) → suppress the "N tickets left" capacity text when true (the redesign honors it). `approvalRequired` surfaces as the per-tier "Request approval" CTA. The others are operator/door-flow flags, not buyer-marketing fields → not rendered.

---

## 0. How the event page looks TODAY vs under Direction A

**Today** (`@mingla/event-rendering` `PublicEventPage.tsx` + the business-app adapter `src/components/event/PublicEventPage.tsx`): the event page is **already the gold standard for theming** — it has `resolveTheme` + `createThemePalette` (contrast-aware light/dark), the full-bleed cover with `EventCoverMedia` (image/video/gif + the Sound/Mute pill), the "Presented by" brand chip, the venue card with `hideAddressUntilTicket` + Open-maps, the collapsible About, the ticket-tier rows, the ORCH-1117 `FloatingOfferingBar` (free-vs-paid via `resolveOfferingCta`), and the IconChrome X/Share row. It is a strong, single-column, stacked-card page.

**Three concrete improvements under Direction A:**

1. **Current → Improved (immersion):** today's cover is full-bleed but **static** and the body is a flat stack of cards; under A the cover becomes a **pinned parallax** the body slides up and over (phone), the chrome **floats fixed** (always-tappable X · Share · **Mute as a matching circular icon**, replacing today's text-glyph chrome row), and the body card **overlaps the cover at a −28px rounded seam** — the same immersive feel Seth approved on the trip.
2. **Current → Improved (desktop is a real layout, not a stretched phone):** today the page is one ~660px column centered on desktop with the floating bar at the bottom; under A, ≥1024px becomes a **true two-column shell** — scrolling content left (cover/meta/About/venue/map), **sticky TICKET panel right** (brand chip + selectable tier list + all-in price + the free-vs-paid CTA + capacity reassurance). The buy decision is always in view while scrolling.
3. **Current → Improved (the venue + map fill the single-date space, and the tier list becomes the spine):** an event has no per-day itinerary, so the redesign uses that space for a **map block** (the model's `location_geo` lat/lng — present but unrendered today) and promotes the **ticket tiers** to the page's structural spine with a **selectable** tier UI that drives one clear price + CTA, instead of N independent stacked buy buttons.

The fix reuses the event page's existing theming/cover/CTA machinery almost verbatim and re-architects the **structure** on top of it — exactly as the brief asks.

---

## 1. Shared foundation (inherited from the approved trip system — unchanged)

Identical to `DESIGN_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN.md` §1.1–1.8, with these the load-bearing points:
- **Theming:** reuse `resolveTheme(brandTheme, eventOverride)` + `createThemePalette` + `theme.fontFamilyValue` + `ThemeEntranceAnimation` (keyed `event:${id}`) — this is **already the event page's own machinery**; the redesign does not invent a second path. Contrast-aware text (`palette.primaryText/secondaryText/tertiaryText`) flips black/white off the resolved page.
- **Token grid:** spacing 4/8/16/24/32; radius cards 14–20 / pills 999 / seam 28; type scale title 32 (phone) / 46 (desktop overlay) / section 20–22 / body 15·1.6 / meta 13 / eyebrow 10–11 upper; every tappable ≥44pt; **color never the only indicator** (selected tier uses fill + accent rail + radio dot + bold, sold-out uses a label, free uses the word "Free").
- **Cover states:** image / gif / **video** (autoplay-muted; Mute = circular icon beside Share, ported from `EventCoverMedia.tsx` VolumeGlyph) / **no-cover** (flat accent-derived `coverHue` hue). Demo "Cover" picker shows all three.
- **Motion:** parallax cover slide; tier-select 150ms (border/fill cross-fade); price + CTA cross-fade (no layout shift); About 200ms height settle; `ThemeEntranceAnimation` once/session. All 150–300ms transform/opacity; full `prefers-reduced-motion` fallback (instant).
- **A11y:** every text-on-surface ≥4.5:1 via `createThemePalette`; tier list = `role="radiogroup"` / each tier `role="radio"` + `aria-checked`; price region `aria-live="polite"`; reading order = hero→title→facts→brand→About→venue/map→tickets; floating bar in the thumb zone is the single primary action.
- **Android glass policy:** any translucent panel (chips, brand row, tier card, sticky panel) uses the opaque ≥0.92 frosted fallback on Android via `Platform.select` + `overflow:'hidden'` + no Android shadow under a rounded fill (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). iOS keeps translucent values. Mockup shows the iOS look.

---

## B. EVENT-NATIVE FINE-TUNING (what changes vs the trip)

### B.1 Removed (trip-only — no data on events)
- **Per-day itinerary spine** — events are single-date. REMOVED.
- **Pay-in-full / Pay-over-time toggle + installment schedule** — events have no installment plan (that is `tier_metadata.installments`, trip-only). REMOVED. The right panel is the **ticket panel**, not a payment-plan card.
- **Refund ladder** — no `refund_policy` on the event public read (§A.6). REMOVED.
- **Booking-deadline strip** — no `booking_deadline` on the event public read (§A.6). REMOVED. (Per-tier `saleEndAt` → "Sales ended" is the kept equivalent.)
- **Route line (departure → destination)** — trip-only. REMOVED.

### B.2 Added / promoted (event-native)
- **Date + time as the hero fact** — `dateLine` (eyebrow + chip) + `dateSubline` (time chip). The single most important fact for an event.
- **Venue block + MAP** — venue card (existing, honors `hideAddressUntilTicket` + Open-maps) PLUS a new **map block** from `location_geo` (lat/lng present but unrendered today). Map hidden when `format==='online'` (online card shown instead).
- **Ticket-tier list as the page spine** — a **selectable** tier list (radio semantics). Selecting a tier drives one all-in price + one CTA in the panel and the floating bar. Per-tier: name, description ("what's included"), all-in price (or "Free"), capacity ("N available" / "Sold out"). Sold-out tiers dim + show a "Sold out" tag and are non-selectable.
- **All-in reassurance line** — "All-in price — taxes & fees included, no surprises at checkout" (the WYSIWYP promise; drives off `pricingSwitches`).

### B.3 Right sticky TICKET panel (desktop ≥1024px)
`position: sticky; top: 24px`. Card: `card-strong` fill, accent border, radius 22, 4px accent top-stripe. Top→bottom: **brand chip** (moves here from the body) → **"Choose your ticket"** + the selectable tier list → **price block** (all-in price / "Free" for the selected tier + "taxes & fees included") → **CTA button** (full-width accent — label from `resolveOfferingCta`: "Get tickets" / "Get free ticket" / "Join waitlist" / "Request approval" / "Pay at the door" / disabled) → **reassurance** ("N tickets left · secure checkout"). The phone floating bar is `display:none` on desktop.

### B.4 Phone floating reserve bar
Inherited from ORCH-1117 `FloatingOfferingBar` verbatim — sticky thumb-zone bar, price + kicker on the left, CTA on the right, driven by the SAME `resolveOfferingCta(selectedTier)` machine as the desktop panel. Non-tappable info-strip variants for unavailable states.

---

## C. Layout / IA (per viewport)

**Phone (≤1023px)** — single immersive column, parallax cover pinned, body slides over, fixed chrome:
hero (parallax) → [state banner] → lead title + date/time eyebrow → meta chips (date · time · capacity · city) → brand chip → About (collapsible) → Where (venue card + map) → **Tickets** (inline selectable tier list + all-in note) → floating reserve bar (thumb zone).

**Desktop (≥1024px)** — two-column, hero contained 21:9 with overlaid title:
LEFT (scrolling): meta chips → About → Where (venue + taller map). RIGHT (sticky ticket panel): brand chip → "Choose your ticket" tier list → price block → CTA → reassurance. State banner = centered pill under the hero.

---

## D. Every state (driven by the demo State + Cover pickers)

| State | Phone | Desktop |
|---|---|---|
| **available** | accent floating reserve bar; "42 tickets left" chip | sticky-panel accent CTA; "42 tickets left" reassurance |
| **few left** | accent "Only a few tickets left" banner under hero | centered accent pill + panel reassurance |
| **sold out** (`computeOfferingVariant`→`sold-out`) | grey "SOLD OUT" banner; capacity chip→"Sold out"; bar→non-tappable "Sold out" (or "Join waitlist" if any tier waitlist-enabled) | panel CTA → disabled grey |
| **sales closed** (past / all `saleEndAt` elapsed) | red "Ticket sales have closed" banner; bar→non-tappable "Sales closed" | panel CTA → disabled grey |
| **pre-sale** (all tiers `saleStartAt` future) | bar → non-tappable "On sale soon" | panel CTA → "On sale soon" disabled |
| **not bookable** (`bookable===false`) | bar → "Booking unavailable — organizer finishing payment setup" (ORCH-1117) | panel CTA → same disabled info copy |
| **approval-required tier selected** | bar CTA → "Request approval" | panel CTA → "Request approval" |
| **door-only tier** | bar CTA → "Pay at the door" (disabled online) | panel CTA → "Pay at the door" |
| **free event** | bar → "Free" + "Get free ticket"; no price surprise | panel price → "Free", CTA → "Get free ticket" |
| **password-gated** | page-level `PasswordGateVariant` (existing) | same |
| **cancelled** | page-level `CancelledVariant` (existing) | same |
| **cover = video** | autoplay-muted; Mute icon beside Share toggles sound | same |
| **cover = none** | flat accent-derived `coverHue` hero; title still legible (scrim) | same |
| **Loading** | skeleton: cover shimmer + title bar + 3 meta-chip bars + venue bar + 2 tier bars (upgrade from today's bare spinner) | same, 2-col skeleton |
| **Error / Not found** | preserve existing "Event could not load" / `PublicEventNotFound` | same |
| **Empty tickets** | "No tickets available yet." (existing `emptyTicketsCard`) | same in panel |

---

## E. Per-surface deltas & reuse map

### E.1 Reuses `@mingla/event-rendering` + business adapter (≈verbatim)
- `resolveTheme` + `createThemePalette` + `theme.fontFamilyValue` + `ThemeEntranceAnimation` — theming engine (no change).
- `EventCoverMedia` (image/video/gif + VolumeGlyph Mute) — cover (no change).
- `resolveOfferingCta` + the shared sub-predicates (`ticketSaleEnded`/`ticketIsSoldOut`/`ticketIsDoorOnly`) + `computeOfferingVariant` — the free-vs-paid + state machine (no change; the tier selector reads it per-selected-tier).
- `FloatingOfferingBar` (ORCH-1117) — phone floating bar (no change).
- `ShareModal` + `IconChrome` — Share + the X/Share chrome (Mute added beside Share to match the trip; chrome restyled to floating circular buttons).
- Venue card + `hideAddressUntilTicket` `venueAddressLabel` + `onOpenMaps` — venue block (no logic change; restyled).
- Collapsible About (`ABOUT_COLLAPSE_THRESHOLD`) — About (no change).
- `pg_public_ticket_types_remaining` (`fetchTicketTypesRemaining`) — capacity/sold-out (no change).

### E.2 Net-new (the redesign's structural work)
- **Phone parallax** (pinned cover + slide-over body + −28px seam) — port the trip's phone parallax + body-level fixed chrome into the event page (it currently uses static chrome).
- **Desktop two-column shell** with the **sticky right TICKET panel** — port the trip's desktop architecture; the panel's contents are event-native (tier selector + all-in price + CTA, NOT a pay toggle).
- **Selectable tier UI** (radio semantics; one selection drives the panel + bar) — new interaction layer over the existing per-tier data (today each tier row has its own buy button).
- **Map block** from `location_geo` (lat/lng exist; unrendered today) — new section, hidden for online events.
- **No-cover** flat-hue + skeleton-loading — upgrade existing fallbacks.

### E.3 Web vs in-app RN
- **Web (`/e/...`):** full-bleed parallax cover to the viewport top (the strict-grep allow comment on the route documents the status-bar-overlap aesthetic). Hover lifts on brand row + tiers + CTA (no layout shift). Page max-width 1200 (desktop) / full-bleed (phone).
- **In-app RN:** no hover; `safeAreaInsets.top` pads the fixed chrome; floating bar respects `safe-area-inset-bottom`; gorhom `BottomSheetScrollView` injection point (`ScrollComponent` prop) preserved if sheet-hosted.

---

## F. Open questions for review
1. **Lineup / host:** the model has **no host/lineup field** (§A.6). Render nothing (current recommendation, rule-9-clean), or is a lineup/host worth a new authoring field + a future ORCH? (Recommend: leave out now; spawn separately if events want a lineup.)
2. **Vibe / music / party-type tags:** authored (`vibe_tags`/`music_genres`/`party_types`) but **not in the event public read** (§A.6). Worth surfacing as accent chips under the title? Requires a read-path change first (add the columns to `BusinessPublicEventViewRow`). (Recommend: defer; flag to forensics if Seth wants them.)
3. **Multi-date / recurring events:** this redesign is tuned for single-date. Recurring/multi-date events reuse the existing `datesList` "Show all N dates" expansion in the date region — confirm that is sufficient, or do they want a date-picker that scopes the tier panel per date?
4. **Tier selection vs N buy buttons:** the redesign promotes one **selectable** tier → one CTA. Confirm this is preferred over today's "every tier has its own Get-tickets button" (selectable is cleaner for the sticky panel; the per-row CTA is more direct on a long list). Both are buildable.

---

## G. Deliverables
- **`EVENT_DIRECTION_A_RESPONSIVE.html`** — the responsive phone↔desktop mockup, all real event fields, interactive (brand swatches + font + State + Cover + tier selector). Single file, resize to switch architecture.
- **This spec** — field inventory (§A), current-vs-reimagined (§0), event-native fine-tuning (§B), layout/IA (§C), every state (§D), reuse-vs-net-new (§E), open questions (§F).
