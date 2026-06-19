# DESIGN — ORCH-1138 Public Trip Page Redesign

**Status:** DESIGN-FIRST. Mockups for review BEFORE any implementation.
**Surface:** Public buyer-anon trip page — `mingla-business` React Native Web, route `/t/[brandSlug]/[tripSlug]`.
**Reviewer action:** Open the three `.html` files (double-click), use the swatch row at the top of each to flip the brand theme color/font, and toggle the pay-in-full / pay-over-time segmented control to see the payment block + floating bar react. Pick one direction.

> **v2 UPDATE (2026-06-14):** Seth approved **Direction A — "Immersive Itinerary"**. v2 keeps that aesthetic and adds two things: (1) a maximal **kitchen-sink** mockup that renders EVERY field a trip can carry, and (2) a **true desktop wide layout** (re-architected 2-column shell, not a stretched phone column). New v2 deliverable: **`DIRECTION_A_V2_FULL_RESPONSIVE.html`** — ONE responsive file; resize the window (≤980px = phone immersive, ≥981px = desktop 2-column). It also adds a **State** picker (Available / Deadline soon / Sold out / Bookings closed) alongside the existing brand-color/font swatches and pay toggle. The FIELD INVENTORY, per-day itinerary spec, and desktop layout spec are §§A/B/C below.

> **v3 REVIEW REVISION (2026-06-14) — applied to `DIRECTION_A_V2_FULL_RESPONSIVE.html` in place.** Four Seth-reviewed changes:
> 1. **Per-day STOP rows REMOVED.** The wizard does not author timed stops (§A.7), so the fabricated "Trailhead transfer 8:30 AM"-style rows are gone. Each itinerary day now renders ONLY real model fields: ordinal/date + title + narrative + media gallery. This supersedes §A.7 decision and §B.1 step 6 / §B.4 below (now struck).
> 2. **Gallery is count-aware** (BOTH the main trip gallery AND each per-day media gallery): **1 photo → full available width** (single large image); **2 photos → full-width split** (two equal columns, no orphan/gutter); **3+ photos → horizontal scroll-snap slider**. Implemented via `.media-one` / `.media-two` / `.media-slider` modifier classes on the container; the implementor picks the class from `media.length` (1 / 2 / ≥3). Demo shows all three: Day 1 = 1 (full-width), Day 2 = 2 (split), Day 3 = 3+ (slider), main gallery = 5 (slider).
> 3. **Trip meta line contrast fixed.** "6 days · small group · Italy" (`.eyebrow.lead`) now renders at `--primary` (the resolved palette's primaryText — same as the title), not the faded `--accent`. Theme-aware (flips black/white on light/dark brand pages). The desktop hero-overlay eyebrow stays white-on-image.
> 4. **Desktop two-column breakpoint fixed → `min-width: 1024px`** (was 981px and reportedly not triggering on a widened window). The phone `.page { max-width: 660px }` clamp is now explicitly lifted inside the query (`width:100%; max-width:1180px`) so no parent clamps the page to phone width; `.page { overflow: visible }` on desktop lets the sticky right panel pin. Verified `.shell` is a `display:grid` direct parent of `.body` (col 1, scrolling content) + `.deskpanel` (col 2, sticky booking panel). Below §C breakpoint values updated to 1024/1023.
>
> **v4 REVIEW REVISION (2026-06-14) — applied to `DIRECTION_A_V2_FULL_RESPONSIVE.html` in place.** Three Seth-reviewed changes:
> 1. **Brand bio tagline REMOVED.** The brand block previously showed a `brands.description` subline ("Small-group, slow-travel trips run by people who actually live in the places they take you."). Both the markup (`.brand-bio` div in the phone brand row) and its CSS rule are deleted. The brand block now shows ONLY avatar chip + "Presented by" kicker + brand name — matching the event page. This supersedes §A.6 row `brand.bio` and the "Brand chip subline (NEW in v2)" note: brand bio is NOT rendered on the trip page.
> 2. **Share icon = real glyph; Mute control added beneath it (event-page parity).** The cover chrome's right side is now a vertical column (`.chrome-right`) stacking two controls. (a) The Share control is the actual three-node **share-network glyph ported verbatim from `mingla-business/src/components/ui/Icon.tsx` `share` renderer** (`<circle cx=6 cy=12 r=2.5>` + `<circle cx=18 cy=6 r=2.5>` + `<circle cx=18 cy=18 r=2.5>` + connecting `M8.2 10.8L15.8 7.2M8.2 13.2L15.8 16.8`) — this is the exact glyph the business-web event adapter renders via `IconChrome icon="share"`, replacing the prior `↗` arrow. (b) Directly **beneath** the share button sits a **Sound/Mute pill ported verbatim from `packages/event-rendering/EventCoverMedia.tsx` `VolumeGlyph` + the Sound/Mute pill** — a filled-white speaker triangle (`M11 5 6 9H2v6h4l5 4V5z`) with, when muted, the two diagonal cross-lines (`16,9→22,15` and `22,9→16,15`) and a "Sound" label; toggled on, the slash is replaced by the two-arc wave (`M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13`) and the label flips to "Mute" — identical states to the event page. Default = muted (cover-video convention). The redundant bottom-right "tap for sound" video pill text is trimmed to just "Cover video" since sound is now the Mute control's job. Mock toggle is visual-only (no real audio, as specified).
> 3. **Capacity-text contrast fixed.** The "3 seats left" capacity indicator's TEXT (`.seats-left`) now renders at `--primary` (high-contrast, same as body/meta text) instead of the faded `--accent`. The seat/people ICON keeps the accent color (it inherits `.chip svg { stroke: var(--accent) }` — unchanged). Theme-aware (flips black/white on light/dark brand pages). The only accent-colored capacity label was `.seats-left`; the desktop reassure micro-line stays `--tertiary` by design.
>
> **v5 REVIEW REVISION (2026-06-14) — applied to `DIRECTION_A_V2_FULL_RESPONSIVE.html` in place.** Four Seth-reviewed changes:
> 1. **STANDALONE "Gallery" section REMOVED (heading + photo strip).** The trip data model has **no trip-level gallery field** — the prior section's photos and captions (Coast view / Lemon grove clip / Harbor / Cove / Village) were fabricated. The whole section and all `.gallery` CSS (phone + desktop) are deleted. **Per-day media galleries inside the itinerary are KEPT** (they come from real `trip_days.media`, ORCH-1119). Per-day media has **no caption field** in the model, so per-day items render as images/video only — no invented captions (the prior build already showed no visible per-day captions; only `alt` accessibility text remains). This supersedes §B "gallery as a multi-column grid", §C.2 "Gallery grid", and the v3 "main gallery is count-aware" note — there is no main gallery.
> 2. **"► Cover video" hero badge REMOVED.** The bottom-right `.video-pill` label is deleted entirely. The cover can still be a video; mute/sound is the icon button's job (change 3). This supersedes the tail of v4 change 2 ("trimmed to just 'Cover video'") — the chip is gone, not trimmed.
> 3. **Mute = circular ICON button beside Share, matching X/Share.** The mute control is no longer a labeled pill. It is now `class="chrome-btn mute-btn"` — **identical in diameter/shape/glass background/icon treatment to the top "X" (close) and Share buttons.** The cover chrome's right cluster is now a **horizontal row** (`.chrome-right { flex-direction: row }`) of two matching circular icon buttons: **Share + Mute, side by side** (mute directly beside share, not beneath, not a pill). The mute glyph is the `EventCoverMedia.tsx` `VolumeGlyph` speaker (filled triangle + diagonal slash when muted; slash → two-arc wave when toggled on). **No "Mute"/"Sound" text label.** The X stays top-left. This supersedes v4 change 2(b) (the vertical-stacked labeled pill).
> 4. **DESKTOP LAYOUT REBUILT FROM SCRATCH (was broken — content jammed left with an empty void right).** Root cause: `.stage` flex-centering plus a leaked phone `max-width:660` clamp meant the grid never owned the full shell width. New model — `.stage` is now a plain block scroll surface; **centering moved onto `.page` itself via `margin: 0 auto`** (no flex dependency) at `max-width: 1200px`. `.page` is THE shell; hero, body, and the two-column grid all share its width and left/right alignment. **Hero** is contained inside the shell, rounded (radius 24), `aspect-ratio: 21/9` with `max-height: 520px`. **The two-column grid** (`.shell`) is `display:grid; grid-template-columns: minmax(0,1fr) 360px; gap: 40px;` — **LEFT ≈62% scrolls** (title+meta in hero overlay; About; per-day itinerary with media; route; cancellation policy + refund ladder + booking-deadline strip), **RIGHT 360px is `position: sticky; top: 24px`** carrying the booking card (brand chip, Pay-in-full/Pay-over-time toggle + installment schedule, price, Reserve CTA, reassurance + condensed deadline/refund strips). The phone floating Reserve bar is `display:none` on desktop. The full cancellation policy + refund ladder were moved OUT of the phone-only block into a shared `.dsection` so they appear in the LEFT column on both viewports. Phone (≤1023px) is unchanged: single column + floating bar. This supersedes the v3 desktop fix (1180px / flex-centered / 392px right col) and §C.2–C.3 values below.
>
> **v6 REVIEW REVISION (2026-06-14) — applied to `DIRECTION_A_V2_FULL_RESPONSIVE.html` in place. PHONE-ONLY (≤1023px); DESKTOP UNTOUCHED.** One Seth-reviewed interaction change:
> 1. **Phone parallax cover + floating fixed chrome.** On the phone viewport only, the **cover (hero media + overlay) is now PINNED to the viewport** (`.hero { position: fixed; top:0; left:50%; transform:translateX(-50%); width:100%; max-width:660px; aspect-ratio:4/5 }`) at a low z-index, behind the content. A new in-flow **`.hero-spacer`** div (same `width` + `aspect-ratio:4/5` as the pinned cover) holds the cover's height so the body column starts below the cover; as the user scrolls, the **body card slides UP and OVER the fixed cover** — a parallax reveal. The body card already carries an **opaque `var(--page)` background + rounded top corners + the −28px seam**, so it cleanly covers the pinned cover with no see-through overlap. The **three cover-chrome buttons (X top-left · Share + Mute top-right) now FLOAT fixed** (`.chrome { position: fixed; top:18px; left:50%; transform:translateX(-50%); width:100%; max-width:660px; padding:0 16px }`) at the viewport corners — always above both cover and sliding content, always tappable; they keep the exact circular `.chrome-btn` icon style/size and the v5 Share+Mute horizontal cluster. **Z-INDEX LAYERING: cover/hero = 1 < content (.page/.shell/.body/.state-banner) = 2 < chrome = 60** (60 also clears the demo-bar's z-index:50 so the chrome floats over the demo chrome in the mockup). The phone `.page` is set to `overflow:visible` so the fixed cover/chrome escape the rounded-card clip; the body's own top radius preserves the seam look, and bg colors match so no frame artifact. The phone floating Reserve bar (`.floating`, a body-level sibling) is unaffected. **All of this is guarded inside `@media (max-width: 1023px)`** and never reaches desktop: at ≥1024px the base `.hero { position:relative }` + the existing desktop `@media (min-width:1024px)` rules apply unchanged — cover is contained (21:9, rounded), chrome is `position:absolute` on the contained hero, and the two-column + sticky-right-card shell is **completely UNAFFECTED**. This is a real scroll interaction — it does not appear in a single top-of-page screenshot.

---

## A. FIELD INVENTORY — every field a trip can actually carry (traced to source)

Sourced by reading the real public hook + service types, NOT guessed. Public read shape:
`mingla-business/src/hooks/usePublicTripBySlug.ts` → `PublicTripPayload { trip: Trip; brand; bookable }`. Type bodies: `mingla-business/src/services/tripsService.ts`. Wizard that authors them: `mingla-business/src/components/trip/TripCreatorWizard.tsx` (7 steps: Basics · Day by day · What's included · Pricing · Cancellation & deadline · Traveler info · Review).

### A.1 Trip core (`events` row, `event_type='trip'`)
| Field | Source | Rendered as |
|---|---|---|
| `title` | `events.title` → `trip.title` (`usePublicTripBySlug.ts:177`) | Hero/lead title |
| `description` | `events.description` → `trip.description` (`:184`) | About block (collapsible "Read more") |
| `slug` / `brandSlug` | `events.slug` / route | URL only |
| `coverMediaUrl` | `events.cover_media_url` → `trip.coverMediaUrl` (`:187`) | Full-bleed hero |
| `coverMediaType` | `events.cover_media_type` → `trip.coverMediaType` (`:188`) | `image` \| `video` \| `gif`; video → autoplay-muted, toggled by the circular Mute icon button in the chrome row (v5; no "Cover video" badge) |
| `timezone` | `events.timezone` → `trip.timezone` (`:186`) | Date/deadline formatting basis |
| `status` / `visibility` | `events.status`/`visibility` (`:180`) | Gates whether page resolves at all (`in ('scheduled','live')`) |

### A.2 Dates & logistics (`businessTrip`, canonical from `event_dates` master row)
| Field | Source | Rendered as |
|---|---|---|
| `startAt` / `endAt` | `event_dates` master row (canonical, ORCH-1130 Fix #1; `theme.business_trip` fallback) (`:171–174`) | Dates chip "Sep 14 – Sep 19, 2026" + **derived duration** "6 days · 5 nights" |
| `departureLocationText` | canonical `events.departure_text`, fallback `theme.business_trip` (`:207`) | Route line "Leaving from" leg |
| `departurePlaceId` / `departureLat` / `departureLng` | `theme.business_trip` (`:204,213,215`) | (lat/lng available — map leg, currently unrendered) |
| `destinationLocationText` | `theme.business_trip.destinationLocationText` (`:194`) | Route "Destination" leg + location chip |
| `destinationPlaceId` / `destinationLat` / `destinationLng` | `theme.business_trip` (`:192,198,200`) | **Map block** (lat/lng exist; not rendered today — v2 adds it) |
| `capacity` | `theme.business_trip.capacity` (`:217`) | "12 max" in seats chip |

### A.3 Per-day itinerary (`trip_days` sidecar, ordered by `ordinal`)
| Field | Source | Rendered as |
|---|---|---|
| `days[]` | `trip_days` (`:219`), `TripDay` (`tripsService.ts:61`) | The itinerary spine, one card per day |
| `day.ordinal` | `trip_days.ordinal` | Day number in the accent dot + "Day N" eyebrow |
| `day.title` | `trip_days.title` | Day card title |
| `day.narrative` | `trip_days.narrative` (nullable) | Day card body copy |
| `day.date` | `trip_days.date` (nullable) | Day card date pill "Sun · Sep 14" |
| `day.media[]` | `trip_days.media` jsonb → `coerceTripDayMedia` (ORCH-1119) (`:230`); `TripDayMedia {url,type:'image'\|'video',provider?,width?,height?}` | **Per-day media gallery** (horizontal strip; video items get a ▶ overlay) |
| `day.stops[]` | `trip_days.stops` jsonb — typed `unknown[]` (`tripsService.ts:68`) | **⚠ See §A.7 — present in the model but NOT authored by the wizard today.** v2 renders them as ordered timeline sub-rows within a day; FLAGGED for Seth. |

### A.4 Pricing & payment (`trip_pricing_tiers` + `ticket_types`)
| Field | Source | Rendered as |
|---|---|---|
| `pricingTiers[0].priceCents` | `ticket_types.price_cents` via tier join (`:252`) | Price (today only tier[0] is shown — see §4 open Q3) |
| `pricingTiers[0].currency` | `ticket_types.currency` (`:253`) | Currency symbol (€ in mock) |
| `pricingTiers[0].tierName` | `trip_pricing_tiers.tier_name` (`:250`) | (tier label, not surfaced on single-tier) |
| `pricingTiers[0].quantityTotal` / `isUnlimited` | `ticket_types` (`:254,260`) | Capacity basis |
| `installmentSchedule` | `tier_metadata.installments` (ORCH-0882) → `TripInstallmentScheduleData {deposit_pct, installments[]{ordinal,pct,days_after_booking?\|fixed_date?}}` (`:242`) | **ORCH-1130 pay-over-time toggle + schedule rows.** Null ⇒ toggle hidden, price only. |
| `pricingSwitches` (passTax/passMinglaFee/passServiceFee) | `events.pass_*` (`Trip.pricingSwitches`, authoring-only) | Drives the all-in "Taxes & fees included" copy; not buyer-set |
| `bookable` | `pg_brand_can_charge` RPC for paid trips (`:291`) | False ⇒ floating bar = non-tappable "Booking unavailable" (ORCH-1117) |

### A.5 Capacity / availability state
| Field | Source | Rendered as |
|---|---|---|
| seats remaining | checkout sibling `usePublicTripById` via `pg_public_ticket_types_remaining` (preview hook sets `ticketsRemaining: null` — `:259`) | "N seats left" chip / "Sold out" (the redesign should wire the remaining RPC into the preview path) |
| `ticketsSoldCount` | `biz_trip_tickets_sold` (`Trip.ticketsSoldCount`) | "12 of 12 booked" sold-out copy |

### A.6 Policy, deadline, refunds, brand
| Field | Source | Rendered as |
|---|---|---|
| `refundPolicy` | `events.refund_policy` → `RefundPolicy {kind:'flexible'\|'standard'\|'strict'\|'custom', tiers[]{days_before_start,refund_pct}}` (`refundPolicyService.ts:19/28`; hook `:280`) | **Refund ladder** rows ("30+ days → 100%", "14–29 → 50%", "<14 → none") + kind label |
| `bookingDeadline` | `events.booking_deadline` (`:281`) | Deadline strip "Bookings close Sep 7" + accent countdown chip when near (ORCH-0875) |
| `bookingsClosed` / `bookingsClosedAt` | `events.bookings_closed`/`_at` (`:282,283`) | Red "Bookings closed" banner + non-tappable bar (ORCH-0875/1120) |
| `brand.name` | `brands.name` (`:296`) | Brand chip "Presented by" |
| `brand.coverMediaUrl` | `brands.cover_media_url` (`:300`) | Brand avatar tile |
| `brand.bio` | `brands.description` → `brand.bio` (`:299`) | Brand chip subline (NEW in v2 — bio is fetched but unrendered today) |
| `brand.slug` | `brands.slug` (`:298`) | "View" tap target → brand page |
| brand `theme` | `events.theme`/`brands.theme` via `resolveTheme` + `createThemePalette` | Drives ALL accent/font/light-dark (the whole point of the redesign) |

### A.7 Fields present in the model that v2 does/doesn't render — and WHY
- **`day.stops[]` (RENDERED, but FLAGGED).** The column exists (`trip_days.stops` jsonb; `TripDay.stops: unknown[]`), the public hook passes it through (`:227`), and the public renderer guards `Array.isArray(d.stops)`. BUT the trip writer always sets `stops: []` (`tripsService.ts:965`) and **neither the wizard's `TripDayEditor` nor the current public `TripPreview` authors or renders stops** (TripDayEditor only edits day title/narrative/media). So in production today `stops` is always empty. v2 RENDERS a real ordered per-day stop list (timeline sub-rows: stop name + time/place) because that is the obvious itinerary structure and the data slot already exists — but this is the **one place v2 may be designing slightly ahead of the wizard.** DECISION NEEDED: either (a) treat stops as future and have the itinerary fall back to day-narrative-only when `stops` is empty (graceful — recommended), or (b) add a stops sub-editor to the wizard's Step 2 (separate ORCH). The mock shows the populated (a)+(b) end state. The stop sub-fields (name/time/place) are illustrative — the jsonb shape is untyped, so the implementor must define it if stops are activated.
- **`destinationLat`/`Lng` + `departureLat`/`Lng` (RENDERED as a map).** Exist in the model, not rendered on today's page. v2 adds a static map block. Honors rule 9 — fields genuinely exist.
- **Traveler intake forms (Step 6, NOT RENDERED).** `intakeSchemaService` / `TripCreatorStep6Intake` author per-tier intake questions, but these are collected at CHECKOUT, not shown on the public marketing page. Correctly excluded.
- **`pricingTiers[1..n]` (NOT RENDERED).** Multi-tier exists in the schema but the public page renders only `tiers[0]` today; a tier selector is out of scope (see §4 Q3).
- **`revenueCents` / `ticketsSoldCount` / authoring `pricingSwitches`.** Authoring/analytics fields — not buyer-facing except the derived sold-out count and the all-in copy.

---

## 0. Why this exists (the problem with today's page)

The current page (`TripPreview.tsx` + `/t/[brandSlug]/[tripSlug].tsx`) is the only public offering page that is **NOT themed**:

- Hardcoded warm accent (`accent.warm = #ff8a3b`) everywhere — calendar icon, day ordinals, check marks, reserve button. Ignores the brand's chosen color/font entirely, even though trips are rows in the `events` table and physically carry the same `theme` JSON columns events do.
- **No contrast-aware light/dark page** — it's locked to the `#0c0e12` dark surface; a light-brand color has nowhere to live.
- **Brand named twice** — the hero has no byline, then `by {brand.name}` sits under the title as a thin grey line with no avatar, no "Presented by" treatment, no tap target. The event page's brand chip is far stronger.
- **No font theming** — the title is the platform default; the event page already drives `fontFamily: theme.fontFamilyValue` on title/section heads/CTA.
- **Flat itinerary** — day cards are a plain stack with no visual spine; a 6-day trip reads as homework.
- **Payment is an afterthought** — a single price in a box. ORCH-1130 needs pay-in-full vs pay-over-time to be a *decision the buyer makes at consideration time*, not a checkout surprise.

The fix: reach the event page's **brand-theming parity** (the `resolveTheme` cascade + `createThemePalette` contrast engine) AND give trips an IA that respects that a trip is a multi-day narrative with a real money decision.

---

## 1. Shared foundation (applies to all three directions)

### 1.1 Data available (from `usePublicTripBySlug` / `Trip`)
title · description · `coverMediaUrl` + `coverMediaType` (image OR **video**) · `businessTrip` (startAt/endAt, departureLocationText, destinationLocationText, capacity) · `days[]` (ordinal, title, narrative, stops[]) · `inclusions[]` (kind included/excluded, item) · `pricingTiers[0]` (priceCents, currency, **installmentSchedule**) · `refundPolicy` · `bookingDeadline` / `bookingsClosed` · brand (name, slug, coverMediaUrl/photo) · `bookable` (paid-brand-can-charge gate).

### 1.2 Brand theming model (parity with the event page — NON-NEGOTIABLE)
Reuse the exact event-page machinery; do **not** invent a second theming path:

- **Cascade:** `resolveTheme(brandTheme, tripOverride)` — per-trip `events.theme` override > brand theme > `MINGLA_DEFAULT_THEME` (`#eb7825` / `inter` / `none`). `themeResolver.ts` already exists and is event/trip agnostic.
- **Palette derivation:** `createThemePalette(resolvedTheme)` from `PublicEventPage.tsx`. This decides a **light or dark page** off the accent's luminance vs `#07070a` / `#f8fafc`, mixes the page base 10% (dark) / 3.5% (light) toward the accent, and produces a **contrast-adjusted accent** that is ≥3.15:1 on the page and ≥4.5:1 as white-text-on-accent. Every accent use on the trip page reads from this palette, never a raw hex.
- **Font:** `theme.fontFamilyValue` drives the title, section heads, day titles, price, and CTA label (same elements the event page themes).
- **Animation:** `theme.animation` → `ThemeEntranceAnimation` over the cover hero, keyed `trip:${trip.id}` (event page keys `event:${id}`). Honors reduced-motion.
- **Contrast-aware text:** `palette.primaryText` / `secondaryText` / `tertiaryText` flip black/white off the resolved page (the ORCH-1117 R1 fix — never raw `#ffffff`).

The mockups simulate this in CSS via a `setTheme(accent, page, mode)` JS helper (a hand-rolled stand-in for `createThemePalette`). In production the real palette function is the source of truth — the CSS is illustrative of the *outcome*, not the algorithm.

### 1.3 Token grid (all directions)
- **Spacing:** 4 / 8 / 16 / 24 / 32 (`spacing.xs/sm/md/lg/xl`). 8pt rhythm.
- **Radius:** cards 14–20, pills 999, body-seam 28 (matches event page `borderTopRadius: 28`).
- **Type scale:** title 30–42 / 900–700 · section head 18–21 / 900–700 · body 15 / 1.6 · meta 13 · caption/eyebrow 10–11 / 800 uppercase / letter-spacing 1.2–1.6.
- **Touch targets:** every tappable ≥44pt (segmented buttons 44+, chips, brand row, floating CTA, day tabs).
- **Color rule:** color is **never the only indicator** — included/excluded use ✓/× glyphs *and* strike-through, selected fare uses fill *and* bold label, sold-out uses a label not just a grey.

### 1.4 Payment block — ORCH-1130 contract (all directions)
This is a **first-class block on the public page**, above the floating bar, present in all three directions with identical behavior:

- **Segmented toggle:** `Pay in full` | `Pay over time`. Two equal segments, selected = accent fill + white label, ≥44pt. Default selection = **Pay in full**.
- **Pay in full selected:** large all-in price (e.g. `€2,450`), subline "One payment, all-in. Taxes & fees included." Floating bar shows the full price + "All-in, taxes included".
- **Pay over time selected:** the headline number switches to **DUE TODAY** (the deposit, e.g. `€612.50`) with a `DUE TODAY` label, subline "25% deposit now, then N payments. €X total — no extra cost." The floating bar price switches to the deposit and the kicker switches to "Due today · deposit".
- **Schedule projection:** appears only when Pay-over-time is selected. One row per payment derived from `installmentSchedule` (`deposit_pct` + `installments[]` with `days_after_booking` or `fixed_date`): "Today · Deposit · €612.50", "In 30 days · €612.50", … Today's row uses a filled accent dot + "Deposit" tag; future rows use a muted dot. Total is implied by the rows and stated in the subline.
- **No installment plan configured on the trip:** the toggle is **hidden entirely** — render only the Pay-in-full price (no empty segmented control). Free trips: no payment block, CTA reads "Reserve my spot" with no price.

### 1.5 Every state (all directions)
| State | Treatment |
|---|---|
| **Loading** | Skeleton: cover shimmer block + title bar + 3 meta-chip bars + 2 day-card bars + price bar. (Today's page shows a bare spinner — upgrade to skeleton matching the chosen layout so there's no content jump.) |
| **Error** | Centered: "Couldn't load trip" + the real PostgrestError message (preserve ORCH-0879 behavior) + Retry. |
| **Not found / not live** | Centered: "Trip not found — this trip may not be live yet, or the link is wrong." |
| **No cover media** | Hero falls back to a flat `heroColor` (accent-derived hue), same as the event page's no-cover branch. Title still legible over it (overlay scrim retained). |
| **Cover is video** | `EventCoverMedia` with `coverMediaType==="video"`, autoplay-muted. Sound is toggled by the **circular Mute icon button beside Share** in the top chrome row (v5 — matches the X/Share buttons; no "Cover video" badge). |
| **Sold out** (`ticketsRemaining===0` / capacity reached) | State banner pill under the hero ("SOLD OUT"), payment block dimmed, floating bar becomes a non-tappable "Sold out" strip. Seats-left chip → "Sold out". |
| **Bookings closed** (`bookingsClosed`) | Red "Bookings closed" strip (preserve ORCH-0875), floating bar non-tappable. |
| **Booking deadline approaching** | Accent countdown chip "Bookings close in N days" (preserve ORCH-0875). |
| **Not bookable** (paid brand can't charge — `bookable===false`) | Floating bar = non-tappable info strip "Booking unavailable — the organizer is finishing payment setup." (preserve ORCH-1117). Payment block dims its CTA-coupling but still shows the price.
| **Installments on vs off** | See §1.4 — headline number, subline, schedule visibility, and floating bar all swap together (single source of truth: the selected plan). |
| **Empty itinerary / empty inclusions** | Section omitted entirely (no empty header). |

### 1.6 Motion (all directions)
- **Segmented toggle:** selection pill slides between segments, 180ms ease-out; amount + subline cross-fade 150ms; schedule rows stagger-in 40ms each (reduced-motion: instant swap, no slide/stagger).
- **Cover entrance:** `ThemeEntranceAnimation` (brand celebration) plays once per session over the hero (reduced-motion: skipped).
- **Read more / day expand:** 200ms height settle (`LayoutAnimation`, the event page's About pattern). Reduced-motion: instant.
- **Floating bar:** price number cross-fades (no layout shift) when plan changes.
- All transitions 150–300ms, transform/opacity only.

### 1.7 Accessibility (all directions)
- Contrast: every text-on-surface pair ≥4.5:1 via `createThemePalette` (the engine guarantees it). Accent-on-page ≥3.15:1, white-on-accent ≥4.5:1.
- Segmented control: `role="tablist"` / each segment `role="tab"` + `aria-selected`; the amount region is `aria-live="polite"` so a plan change is announced.
- Schedule: a real list with a labeled total.
- Reading order: hero → title → key facts → brand → about → itinerary → inclusions → payment → policy. Matches visual order.
- All targets ≥44pt; one-handed reach: the floating reserve bar lives in the thumb zone and is the single primary action.
- Reduced-motion fallback on every animation.

### 1.8 Per-surface deltas (web vs in-app RN) — all directions
- **Web (`/t/...` react-native-web):** the hero is full-bleed to the viewport top (intentional — the strict-grep allow comment in the route file documents the status-bar-overlap aesthetic). Hover states on the brand row + segmented buttons (subtle bg lift, no layout shift). The page max-width clamps to ~660 (matches `heroColumn`/`bodyContent maxWidth: 660`) and centers on desktop.
- **In-app RN (if mounted in app-mobile via the shared component):** no hover; `safeAreaInsets.top` pads the close/share chrome; floating bar respects `safe-area-inset-bottom`; gorhom `BottomSheetScrollView` injection point preserved if sheet-hosted (the event page's `ScrollComponent` prop pattern).
- **Android glass policy:** any translucent panel (segmented track, chips, brand row) uses the opaque ≥0.92 frosted fallback on Android via `Platform.select` with `overflow:'hidden'` and no Android shadow under a rounded fill (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). iOS keeps the translucent values. The mockups show the iOS translucent look; the Android opaque values are the spec's responsibility at build time.

---

## 2. The three directions

### DIRECTION A — "Immersive Itinerary" (`DIRECTION_A_IMMERSIVE_ITINERARY.html`)
**Thesis:** Reach 1:1 visual parity with the themed event page. The buyer should not be able to tell the trip page and the event page were designed by different hands — same full-bleed aspect-adaptive hero, same rounded body card that *overlaps* the cover (the `marginTop:-28` immersive seam), same "Presented by" brand chip with avatar, same accent-driven everything. The new layer is a **vertical itinerary spine** (a connected timeline with numbered accent dots) that turns the day stack into an obvious journey, and the ORCH-1130 payment block as a bordered accent-topped card.

- **IA / order:** hero → eyebrow (duration) + title → meta chips (dates, seats-left/capacity) → brand chip → route line (Leaving from → Destination) → About (collapsible) → Day-by-day spine → What's included → **Choose how you pay** (toggle + schedule) → refund/deadline strips → floating Reserve bar.
- **Layout:** body card overlaps hero by 28px, `borderTopRadius:28`, 1px accent-tinted border (matches event page `palette.panelBorder`). Single-column, 20px side padding.
- **Itinerary:** 2px gradient rail (accent → accent-wash), 20px numbered accent dots with a 4px page-colored ring (sits over the rail cleanly), day card per stop with ordinal eyebrow + title + narrative + stop chips.
- **Payment:** card with a 4px accent top-stripe (echoes the event page `ticketCardAccent`), segmented toggle, deposit/full swap, schedule rows with accent/muted dots.
- **Theming map:** accent → eyebrow, chip icons, seats-left, brand-cta, route arrow, rail/dots, stop chips, segment fill, schedule dots, all strips, reserve bar. Font → title + section heads + day titles + price + CTA. Page light/dark + all text colors from `createThemePalette`.
- **Best for:** the default. Every brand, every trip type. Lowest design risk, highest consistency, reuses the most existing event-page code.

### DIRECTION B — "Boarding Pass" (`DIRECTION_B_BOARDING_PASS.html`)
**Thesis:** A trip is not an event — make it *feel* like travel. A compact hero with the title set over it, then a **perforated boarding-pass card** that floats up over the hero and fuses route + dates + seats + from-price into one scannable artifact (origin code → ✈ → destination code, a torn perforation, a stub row). The itinerary becomes **horizontal day-tabs** (Day 1 / 2 / 3 …) that swap a single panel — a long trip reads as a row of days, not an endless scroll. The payment block is "Choose your fare" — the tear-off stub of the pass — and the schedule is the *itinerary of payments*.

- **IA / order:** compact hero (title over image) → **boarding-pass card** (route + perforation + dates/seats/from stub) → brand chip → About → The journey (horizontal day-tabs + swapping panel) → What's included (2-col) → Choose your fare (toggle + schedule) → strips → floating bar.
- **Layout:** 280px hero, pass card `marginTop:-42` over it with notch cut-outs at the perforation, two-column inclusions to save vertical space.
- **Itinerary:** horizontal scroll tabs, active = accent fill; one animated panel below (fade-up 250ms).
- **Payment:** "fare" card, same toggle/deposit/schedule contract; schedule styled as dashed-rule rows (ticket aesthetic).
- **Theming map:** same accent/font/page mapping as A, plus the boarding-pass route line + plane glyph + active day-tab take the accent; perforation notches are page-colored so they read on any theme.
- **Best for:** brands that lean into the *travel* identity; trips with many days (4+) where a vertical stack gets long. Higher design distinctiveness, slightly more bespoke (day-tab state, perforation rendering) to build.
- **Risk:** the boarding-pass metaphor can feel gimmicky for a non-flight trip (a city walking tour, a local retreat). The pass degrades gracefully — if there's no departure city, the route collapses to a single "destination + dates" header — but it's worth eyeballing.

### DIRECTION C — "Editorial" (`DIRECTION_C_EDITORIAL.html`)
**Thesis:** Sell the aspiration. A travel-magazine feature: a tall cover with the title set *over* the image in a display/serif face, a thin accent rule, generous whitespace, a centered facts strip with hairline dividers, a serif **lede** pull-quote, and big numbered itinerary "chapters" (01 / 02 / 03 in display type). This direction leans hardest on the **brand font** as the personality lever — a Playfair/serif brand reads as luxury, Inter reads as modern-clean — and keeps the brand color *restrained* (thin rules, one accent CTA) so it feels premium rather than loud.

- **IA / order:** tall cover (kicker + accent rule + serif title + "with {Brand}" byline over the image) → facts strip (dates / group / seats, hairline-divided) → serif lede + body copy → The Itinerary (numbered display-type chapters, hairline-divided) → What's Included → Reserve Your Place (toggle + schedule, hairline rows) → note → floating bar (squared 4px-radius CTA).
- **Layout:** 24px side padding, 560px cover, lots of vertical air, hairline `--line` dividers instead of filled cards.
- **Theming map:** brand **font** drives the cover title, lede, facts values, chapter numbers/titles, price, schedule numbers — this is where the font choice is most visible. Brand **color** is restrained: cover rule, chapter numbers, seats-left, segment fill, single CTA. Page light/dark + text from `createThemePalette`.
- **Best for:** premium / curated brands, luxury retreats, signature trips. The font lever makes two brands look genuinely different.
- **Risk:** least consistent with the event page (different DNA — over-image title, hairlines not cards). A brand that picked a display font with poor legibility at 42px needs the title to clamp; the serif lede needs a sans fallback if the brand font is itself a script face (Caveat/Dancing Script) — guard: script fonts fall back to the body sans for the lede/body, display face only on the big title.

---

## 3. Recommendation

**Ship Direction A — "Immersive Itinerary".**

Reasoning:
1. **It is the literal brief** — "visual/brand parity with the themed event page PLUS a cleaner layout." A *is* the event page's proven DNA (the overlapping rounded body, the brand chip, the contrast palette, the accent-driven CTAs) extended with a trip-native itinerary spine. The other two are net-new identities the brief did not ask for.
2. **Lowest risk, highest reuse** — it reuses `resolveTheme`, `createThemePalette`, `ThemeEntranceAnimation`, `EventCoverMedia`, the floating-bar pattern, and the collapsible-About pattern almost verbatim. B and C require bespoke components (day-tab state machine, perforation notches, over-image display type with script-font guards) that add build + test surface for marginal user benefit.
3. **It generalizes** — A looks right for a 2-day city break and a 10-day expedition, for a teal brand and a crimson brand, for a serif font and a sans. B's boarding-pass metaphor strains for non-flight trips; C's editorial restraint under-sells a budget/casual trip.
4. **The payment block lands cleanest in A** — the accent-topped card matches the event page's ticket-card treatment, so pay-in-full/pay-over-time reads as "this is how Mingla shows money," consistent across events and trips.

**Borrow from B and C into A (cheap wins):**
- From **B:** the **seats-left** prominence and the route line as a compact two-leg artifact (A already has both — keep them strong).
- From **C:** offer the **font lever** as the visible brand differentiator (A already themes the font; make sure the title is large enough — 32px — for the font choice to read). Consider C's hairline-divided itinerary as an *alternate density* if a brand has 10+ days.

If Seth wants a more distinct travel identity than the event page, **B is the fallback** (it's the most trip-native). C is the niche pick reserved for a future "premium brand template."

---

## 4. Open questions for review
1. Should the day itinerary be **collapsed by default** (peek 2 days, "Show all N days") for long trips, mirroring the event date-list `SHOW_INITIAL_DATES` pattern? (Recommended yes for 5+ days.)
2. ORCH-1130 coordination: confirm the exact **deposit copy** and whether the total is shown as a line in the schedule or only in the subline. (Mockups show it in the subline + implied by rows.)
3. Multi-tier trips: today only `pricingTiers[0]` is rendered. If multi-tier ships, the payment block needs a tier selector above the pay toggle — out of scope for this redesign unless Seth says otherwise.

---

## B. PER-DAY ITINERARY SPEC (v2 — the real structure, replacing v1's generic spine)

v1 rendered a generic numbered spine with one card per day and a flat chip row. v2 renders the **real `trip_days` structure**: an ordered list of days, and **inside each day** its own media gallery (ORCH-1119) and its ordered stops.

### B.1 Anatomy of one day card (top → bottom)
1. **Spine dot** — 20×20 accent circle, white ordinal number, `box-shadow: 0 0 0 4px var(--page)` ring so it reads cleanly over the 2px gradient rail (`linear-gradient(var(--accent), var(--accent-wash))`). One dot per `day.ordinal`.
2. **Header row** — `Day {ordinal}` accent eyebrow (10px/900/upper/1px) + optional `day.date` pill ("Sun · Sep 14", 10px/700/tertiary) when `day.date` is non-null.
3. **`day.title`** — 15px/800 primary.
4. **`day.narrative`** — 13px/1.5/secondary (omitted entirely when null — rule 9).
5. **`day.media[]` gallery — COUNT-AWARE (v3).** Applies the same 1/2/3+ rule as the main gallery. **1 item → full-width single image** (radius 10, 1px border). **2 items → full-width two-column split** (equal columns, gap 8, no orphan). **3+ items → horizontal scroll-snap slider** (items 150×104 phone / 200×132 desktop). `type:'video'` items get a centered ▶ overlay on a `rgba(0,0,0,0.28)` scrim (explicit type, never auto-detected — ORCH-1069/0978 rule). Empty `media` ⇒ zero gallery nodes (no empty frame — matches today's `TripPreview` ORCH-1119 behavior). Implementor selects `.media-one` / `.media-two` / `.media-slider` from `media.length`.
6. ~~**`day.stops[]`** — ordered timeline sub-rows.~~ **REMOVED (v3).** The trip wizard does not author stops (§A.7), so per-day stops are NOT rendered. A day ends at its media gallery.

### B.2 Spacing / rhythm
- Day card padding 14 (phone) / 16–18 (desktop). Inter-day gap 18 (via `.day { padding-bottom: 18 }`), last day 0. Itinerary left padding 30 (for the rail+dots gutter).
- Media strip: 8 gap, 2 bottom-pad (scroll shadow room). Stops: 8 vertical pad per row.

### B.3 States
- **Long trips (5+ days):** recommend collapse to first 2 days + "Show all N days" (mirrors event `SHOW_INITIAL_DATES`). Open Q1.
- **Day with no narrative / no media / no stops:** that sub-element is omitted; the card still shows ordinal + title (a title is always present).
- **Reduced motion:** day-expand height settle (200ms `LayoutAnimation`) → instant.

### B.4 Theming map (itinerary)
accent → rail gradient, ordinal dots, "Day N" eyebrow; day-date pill text is tertiary (not accent); video ▶ scrim is neutral. Font → day titles. (v3: stop-dot mapping removed with the stops.)

---

## C. DESKTOP WIDE LAYOUT SPEC (v2 — re-architected, not a stretched phone)

The single responsive file `DIRECTION_A_V2_FULL_RESPONSIVE.html` switches architecture at the breakpoint. This is a genuine desktop information architecture, not a centered phone frame.

### C.1 Breakpoint (v3 — lowered to 1024)
- **`max-width: 1023px` → PHONE.** Unchanged Direction A: single immersive column, body card overlaps hero by −28 at `borderTopRadius:28`, sticky floating reserve bar in the thumb zone, payment + policy inline in the scroll.
- **`min-width: 1024px` → DESKTOP.** Two-column shell. (v3: was 981px and reportedly not triggering; lowered to a clearly-reachable 1024px. The phone `.page` 660 max-width clamp is explicitly lifted inside the desktop query so a parent never holds the page at phone width.)

### C.2 Desktop shell
- Page container `max-width: 1180px`, centered, `padding: 28px 32px 64px`, transparent background (the dark page gradient shows through), `overflow: visible` so the sticky panel can pin.
- **Hero:** full container width, **wide `aspect-ratio: 21/9`** (vs 4/5 on phone), own rounded card (radius 24) with shadow. Title + duration eyebrow are **overlaid bottom-left ON the hero** (`.hero-caption`, title 46px, max-width 70%, text-shadow) — the in-body lead title is hidden on desktop to avoid double-titling. The phone keeps the title in the body card under the hero.
- **State banner** (deadline/sold-out/closed) becomes a centered pill (`max-width: 520px`) under the hero.
- **Grid:** `.shell { display: grid; grid-template-columns: minmax(0,1fr) 392px; gap: 36px; align-items: start; }`. Left column = scrolling content; right column = sticky booking panel.

### C.3 Left column (scrolling content)
Order: meta chips → route → About → **per-day itinerary** (uses the full wide column; day cards roomier, media items 150×100) → **gallery as a multi-column grid** → what's included → map. The body card loses its hero-overlap seam on desktop (`margin-top:0`, plain radius-20 section container) since there's no hero directly above it.
- **Gallery grid:** `grid-template-columns: repeat(3, 1fr); gap: 12px;` — first item `.tall` spans 2 rows (a bento accent). No horizontal scroll on desktop (phone keeps the horizontal strip). Each cell 180px tall.
- **Map:** 280px tall on desktop (180 on phone).

### C.4 Right column (sticky booking panel)
- `position: sticky; top: 92px;` (clears the demo bar; in production clears nothing — pins to viewport top + gutter). Card: `card-strong` fill, accent border, radius 22, 4px accent top-stripe, shadow.
- Contents top→bottom: **brand chip** (moves here from the body on desktop — `.brand-row.inbody` is hidden, the panel copy shown) → **payment block** (segmented toggle + amount + schedule, `selectPlan()` drives both this and the phone card) → **Reserve button** (full-width, accent) → reassurance line ("Free to hold · 3 seats left") → refund + deadline strips.
- The phone floating bar (`.floating`) is `display:none` on desktop; the desktop reserve action lives in the sticky panel.

### C.5 State behavior at BOTH viewports (driven by the demo State picker → `body[data-state]`)
| State | Phone | Desktop |
|---|---|---|
| `available` | floating accent reserve bar, seats-left chip | sticky-panel accent reserve, "3 seats left" |
| `deadline` | accent countdown banner under hero + deadline strip | centered accent countdown pill + panel deadline strip |
| `soldout` | grey banner "SOLD OUT", seats chip → "Sold out · 12 of 12", bar → non-tappable "Sold out — join the waitlist" | panel reserve → disabled grey |
| `closed` | red "Bookings are closed" banner, bar → non-tappable "Bookings closed" | panel reserve → disabled grey |
| not bookable (`bookable===false`) | bar → "Booking unavailable — organizer finishing payment setup" (ORCH-1117) | panel reserve → same disabled info copy |

### C.6 Theming & a11y carry over
The CSS theme engine (`setTheme`) recomputes accent/wash/border + light/dark text at both viewports. Contrast, ≥44pt targets, `role=tablist` on the segmented control, `aria-live` on the amount, reading order, and the Android opaque-glass fallback all carry from §1.5–1.8 unchanged — desktop adds hover lifts on the brand row + segments (no layout shift) and a focus-visible ring on the reserve button.

---

## D. v2 deliverables
- **`DIRECTION_A_V2_FULL_RESPONSIVE.html`** — the responsive mobile↔desktop, all fields, interactive (brand swatches + font + State picker + pay toggle). Single file, resize to switch architecture.
- This spec extended with §A (field inventory), §B (per-day itinerary), §C (desktop layout). v1 directions B/C HTML remain for reference but are superseded by the Direction-A decision.
