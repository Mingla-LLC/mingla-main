# DESIGN — ORCH-1138C Public Experience Page Redesign (Direction A)

**Status:** DESIGN-FIRST. Mockup for review BEFORE any implementation.
**Surface:** Public buyer-anon experience page — `mingla-business` React Native Web, route `/exp/[brandSlug]/[experienceSlug]`.
**Inherits:** The APPROVED trip Direction A v6 system (`DIRECTION_A_V2_FULL_RESPONSIVE.html`, Seth: "works perfect") — full-bleed phone parallax cover + body-level fixed chrome (X / Share / Mute) + brand theming (color/font + contrast palette) + overlapping rounded body card + desktop 2-column sticky-right booking panel + count-aware galleries + interactive demo bar + real-data-only (rule 9). (The trip page's ✓/✗ inclusion chips and refund ladder are NOT inherited — the experience wizard authors neither; see §A.7.)
**Deliverable mockup:** `EXPERIENCE_DIRECTION_A_RESPONSIVE.html` (open by double-click; resize to switch phone↔desktop; use the demo bar to flip brand color/font, State, and the When-mode).
**Reviewer action:** Open the HTML. Flip the brand swatches/font to confirm theming. Flip **When** (Multi-date / Recurring / Single) to see the date picker appear/collapse. Flip **State** (Available / Deadline / Sold out / Ended) to see the booking states. Then approve or request changes.

---

## A. FIELD INVENTORY — every field a published experience can carry (traced to source)

Sourced by reading the real public service + wizard, NOT guessed. Public read shape:
`mingla-business/src/services/publicExperienceService.ts` → `getPublicExperienceBySlug` → `PublicExperiencePayload { experience: PublicExperience; brand: PublicExperienceBrand }`. The authoring wizard: `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (5 steps: Identity · Stops · When · Pricing · Cover). Stop draft type: `experienceWizardTypes.ts`. Date subline owner: `utils/experienceDateSubline.ts`.

### A.1 Experience core (`events` row, `event_type='experience'`)
| Field | Source | Rendered as |
|---|---|---|
| `title` | `events.title` → `PublicExperience.title` (`publicExperienceService.ts:213`) | Hero/lead title |
| `description` | `events.description` → `.description` (`:215`) | About block (collapsible "Read more"; omitted when null/empty) |
| `slug` / `brandSlug` | `events.slug` / `brands.slug` (`:214/:212`) | URL only |
| `coverMediaUrl` | `events.cover_media_url` → `.coverMediaUrl` (`:220`) | Full-bleed parallax hero |
| `coverMediaType` | `events.cover_media_type` → `.coverMediaType` (`:221`); `normalizeCoverType` → `image\|video\|gif\|null` (`:107`) | video → autoplay-muted, toggled by the circular Mute icon button in the chrome row |
| `timezone` | `events.timezone` → `.timezone` (`:219`) | Date/time formatting basis |
| `status` / `visibility` | `events.status`/`visibility` (`:217/:218`); `PUBLIC_STATUSES` gate (`:105`) | Gates whether page resolves (`scheduled\|live\|ended\|cancelled`); draft never leaks |
| `bookable` | `pg_brand_can_charge` RPC for PAID experiences (`resolveBookable` `:168`) | False ⇒ floating bar = non-tappable "Booking unavailable — organizer finishing payment setup" |

### A.2 Curated vibes (`experience_intents` text[])
| Field | Source | Rendered as |
|---|---|---|
| `experience_intents` | authored in wizard Step 1 (`ExperienceCreatorWizard.tsx:208,363`); persisted to `events`/`experience_intents`; taxonomy `constants/experienceIntents.ts` (4 ids: `adventurous`, `first-date`, `romantic`, `group-fun`) | **Vibe chips** under the meta row (accent-washed pills + glyph). ⚠ **NOT in `PublicExperience` today** — the public service does NOT select/map `experience_intents`. The field EXISTS and is authored; the public read path must add it. FLAGGED below. |

### A.3 Date model (`event_dates` + events flags)
| Field | Source | Rendered as |
|---|---|---|
| `whenMode` | derived from `events.is_recurring`/`is_multi_date` → `deriveWhenMode` (`:223`); `single\|recurring\|multi_date` | Drives the date treatment: single → one date chip; recurring/multi → date PICKER |
| `dates[]` | `event_dates` rows → `.dates` (`:237`); `{id, startAt, endAt, timezone, isMaster}` | Meta chip subline via `formatExperienceDateSubline` ("5 dates · Next: Fri 20 Jun") + the booking-block date picker rows |
| `recurrenceRule` | `events.recurrence_rules[0]` → `firstRecurrenceRule` (`:227`) | "Every Friday · Next: …" subline (recurring mode) |
| `dates[].startAt` / `endAt` | `event_dates.start_at`/`end_at` (`:239/:240`) | Date-picker row label + start time |

### A.4 Itinerary stops (`experience_stops`, ordered by `stop_order`)
| Field | Source | Rendered as |
|---|---|---|
| `stops[]` | `experience_stops` → `.stops` (`:228`); `PublicExperienceStop` (`:31`) | The itinerary spine — one card per stop (2–5 stops; wizard `stopsValid` enforces 2–5, `ExperienceCreatorWizard.tsx:319`) |
| `stop.stopOrder` | `experience_stops.stop_order` (`:230`) | Spine dot number + START HERE / THEN / END WITH label (`labelForIndex`, `experienceWizardTypes.ts:64`) |
| `stop.placeName` | `experience_stops.place_name` (`:231`) | Stop card title |
| `stop.address` | `experience_stops.address` (`:232`) | Stop address line w/ pin glyph (omitted when empty) |
| `stop.imageUrls[]` | `experience_stops.image_urls` (`:233`); ≤5, `imageUrls[0]` = primary (`experienceWizardTypes.ts:23`) | **Per-stop count-aware gallery** (1=full / 2=split / 3+=slider). video items get ▶ overlay |
| `stop.startTime` | `experience_stops.start_time` (`:234`) | Stop time pill ("7:00 PM"; `formatStopTime` handles "HH:mm" or ISO) (omitted when null) |
| `stop.description` (ai_description) | authored + persisted (`ExperienceCreatorWizard.tsx:388` `ai_description`); 1–280 chars, **required at publish** (`stopHasValidDescription`) | **Per-stop blurb** (the strongest itinerary copy). ⚠ **NOT selected by the public service today** — `loadExperienceSidecars` selects `id, stop_order, place_name, address, image_urls, start_time` only (`:265`), and `PublicExperienceStop` omits it (`:31`). The field EXISTS, is authored, and is required — the public read must add it. FLAGGED. |
| `stop.lat`/`lng` | `experience_stops.lat`/`lng` (authored, `experienceWizardTypes.ts:21`) | **Map block** (first stop). ⚠ NOT selected by the public service today; FLAGGED. |

### A.5 Pricing & ticket (`ticket_types`, ONE row)
| Field | Source | Rendered as |
|---|---|---|
| `ticket.priceCents` | `ticket_types.price_cents` → `.ticket.priceCents` (`:199`) | All-in price ("$65") |
| `ticket.currency` | `ticket_types.currency` (`:200`) | Currency symbol |
| `ticket.name` | `ticket_types.name` (`:198`) | Ticket label (used in checkout recap) |
| `ticket.isFree` | `price_cents===0 \|\| is_free` (`:203`) | Free experiences: price = "Free", CTA = "Get my spot", no all-in line |
| `ticket.quantityTotal` / `isUnlimited` | `ticket_types.quantity_total`/`is_unlimited` (`:201/:202`) | Capacity basis → "N max" / sold-out |
| `ticket.ticketsRemaining` | sibling checkout hook via remaining RPC; **preview path sets null** (`:206`) | "N spots left" chip + per-date "N left" capacity. ⚠ null in the slug preview today — see §F gap. |
| pricing switches (passTax/passMinglaFee/passServiceFee) | wizard Step 4 (`ExperienceCreatorWizard.tsx:240,369`) → `events.pass_*` (authoring-only) | Drive the all-in "Taxes & fees included" copy; never buyer-set |

### A.6 Brand (`brands` row)
| Field | Source | Rendered as |
|---|---|---|
| `brand.name` | `brands.name` → `PublicExperienceBrand.name` (`:330`) | Brand chip "Presented by" |
| `brand.coverMediaUrl` | `brands.cover_media_url` → `.coverMediaUrl` (`:332`) | Brand avatar tile |
| `brand.slug` | `brands.slug` (`:329`) | "View" tap target → brand page |
| `brand.bio` | `brands.description` → `.bio` (`:331`) | ⚠ Fetched but **NOT rendered** — matches the trip page v4 decision (brand bio removed). Brand block = avatar + kicker + name only. |
| brand `theme` | `events.theme`/`brands.theme` via `resolveTheme` + `createThemePalette` | **Drives ALL accent/font/light-dark** — the headline fix (the experience page is the ONLY public offering page with NO theming today) |

### A.7 Fields NOT rendered — and WHY  [SCHEMA-ONLY / NOT-AUTHORED → DO NOT RENDER]
ORCH-1138 wizard audit verdict: each of these is now **fully removed** from the mockup (no greyed candidates left), because the experience CREATE/EDIT wizard does not author them.
- **`inclusions` / what's-included — NOT AUTHORED, NO MODEL FIELD. REMOVED.** The wizard's 5 steps (Identity · Stops · When · Pricing · Cover — `ExperienceCreatorWizard.tsx` STEPS `:134`) capture NO inclusions list. The trip page has `inclusions[]`; the experience model does not. The prior pass rendered a greyed "candidate" block — **DELETED** this pass (the `.chip-wrap`/`.ichip` CSS is retained only for brand-page reuse). Re-adding it would require a NEW wizard field first (separate ORCH); do NOT render until then.
- **Cancellation / refund policy — NOT AUTHORED for experiences. REMOVED.** The experience wizard has **no refund or cancellation step** — there is no refund field in any of its 5 steps and `PublicExperience` (`publicExperienceService.ts:61`) carries no `refundPolicy`/`tiers`. (The TRIP wizard authors a refund deadline via ORCH-1120; the experience wizard does NOT.) The prior pass rendered a refund-ladder section + a desktop "Flexible refund" strip — both **DELETED** this pass. This is NOT a read-path gap to wire — there is nothing to read; it is unauthored. Do NOT render until the wizard adds a refund field.
- **No departure→destination route line.** An experience is a local multi-stop crawl, not A→B travel — there is no `departure*`/`destination*` on the experience model. The trip page's route line is **correctly dropped**. "Where you'll be" = the stops + a map of the first stop.
- **No installment schedule / no pay-over-time toggle.** `PublicExperience` carries NO `installmentSchedule` — experiences sell as ONE ticket at a single price (`ExperienceCheckoutFlow.tsx:8` "ONE ticket … no per-stop or multi-tier selection"). The trip page's Pay-in-full/Pay-over-time segmented control is **correctly dropped** (rendering it would violate rule 9).
- **`endAt` per date, `isMaster`, ticket `name`** — available but not surfaced as standalone UI (folded into the date-picker subline / checkout recap).
- **Per-stop price (`per_stop` mode)** — the wizard DOES author per-stop prices (Pricing step `per_stop` mode, `ExperiencePricingStep.tsx:176`), but they roll into the ONE all-in ticket; the buyer always buys the whole itinerary (`ExperienceCheckoutFlow.tsx:8`, `ExperiencePricingStep.tsx` SoldAsOneSummary). The public page renders ONE all-in price and NO per-stop price line. Correctly excluded as a buyer-facing field.
- **`startTime` per stop — OPTIONAL.** The wizard's stop "Start time" field is optional (`ExperienceStopCard.tsx:236` "Start time (optional)"). The mockup renders the time pill ONLY when present (stop 2 in the mockup deliberately has none, proving the absence case).

---

## B. Current page vs. reimagined (the 3-bullet headline)

**Current → improved:**
1. **Unthemed, locked-dark, standalone renderer → full brand theming.** Today `ExperiencePreview.tsx` is hardcoded to `#0c0e12` + `accent.warm` (orange) everywhere (cover, stop ordinals, calendar icon, check badge) and the route host is `backgroundColor: "#0c0e12"`. It is the ONLY public offering page with no `resolveTheme`/`createThemePalette` — a brand's color/font is ignored. Direction A inherits the event/trip theming engine: contrast-aware light/dark page, accent drives every accent, brand font drives type. **This closes the documented theming gap.**
2. **Flat, weak presentation → immersive parallax + real itinerary spine.** Today: a 240px static cover, `by {brand.name}` as a thin grey line (no avatar, no "Presented by", no tap target), a one-line date card, a plain stack of stop cards with no images/blurbs, and a single "From {price}" box. Reimagined: full-bleed parallax cover with fixed chrome (X / Share / Mute), a strong brand chip, vibe chips, and a vertical stop spine where **each stop shows its real photos (count-aware gallery), its blurb, address, time, and START HERE/THEN/END WITH label** — the itinerary reads as a journey, not a list.
3. **Buried checkout → a real booking decision (date + price).** Today the date is a passive one-liner and the only action is the floating get-spot bar routing to a separate checkout screen with no date choice on the page. Reimagined: a first-class booking block (desktop = sticky right panel; phone = inline card + floating bar) with a **date picker** for multi-date/recurring experiences (pick the date with remaining capacity before checkout), the all-in price, "Book Experience" CTA, and per-state capacity ("N left" / "Sold out"). Single-date experiences collapse the picker to one date chip.

---

## C. Layout & IA

### C.1 Reading order (matches visual order)
hero → eyebrow (derived stop-count) + title → meta chips (date subline, start time, capacity, primary location) → **vibe chips** → brand chip → About (collapsible) → **The itinerary** (stop spine with per-stop media + blurb) → Where you'll start (map) → **Book your spot** (date picker + all-in price) → floating Book bar. (No inclusions section, no cancellation/refund section — neither is authored by the experience wizard.)

### C.2 Phone (≤1023px) — immersive parallax (inherited unchanged from trip v6)
- Cover PINNED (`position:fixed`, 4/5 ratio, z-index 1); a `.hero-spacer` holds its height; the body card (opaque `var(--page)` bg, rounded top, −28 seam) slides UP and OVER the cover.
- Chrome (X top-left · Share + Mute top-right circular icon buttons) FLOATS fixed at z-index 70 (`.cm`), always tappable.
- Single column; booking block inline; floating Book bar in the thumb zone (the single primary action).

### C.3 Desktop (≥1024px) — two-column (inherited unchanged from trip v5)
- `.page` centered `max-width:1200px`; hero contained, rounded, 21/9, max-height 520; title overlaid bottom-left in the hero.
- `.shell` grid `minmax(0,1fr) 360px`, gap 40. LEFT = scrolling content (about, itinerary, map). RIGHT = sticky booking panel (`top:24px`): brand chip → date picker → all-in price → **Book Experience** → reassurance (remaining-on-date + secure Stripe checkout). No refund strip (unauthored).
- Floating phone bar hidden; the sticky panel owns the book action.

### C.4 Token grid (inherited)
Spacing 4/8/16/24/32 · radius cards 14–20 / pills 999 / seam 28 · type title 32 (phone) / 46 (desktop hero) / sec-head 20–22 / body 15 / meta 13 / eyebrow 10–11 upper · all targets ≥44pt · color never the only indicator (✓/✗ glyphs, START HERE labels, radio fill on selected date).

---

## D. The stop card (experience-specific anatomy, top→bottom)
1. **Spine dot** — 20×20 accent circle, white `stopOrder+1`, 4px page-ring over the gradient rail.
2. **Header row** — `START HERE` / `THEN` / `END WITH` accent eyebrow (from `labelForIndex`) + optional `startTime` pill.
3. **`placeName`** — 15/800 primary.
4. **`address`** — 12/tertiary with a pin glyph (omitted when empty).
5. **`description` (ai_description)** — 13/1.5/secondary blurb (the strongest itinerary copy; required at publish).
6. **`imageUrls[]` gallery — count-aware:** 1→full-width single, 2→split, 3+→scroll-snap slider; video items get a ▶ scrim. Empty ⇒ zero nodes.

(No stops fabrication risk here — unlike the trip page, experience stops ARE authored by the wizard, with name/address/time/images/blurb all real and required.)

---

## E. Every state
| State | Phone | Desktop |
|---|---|---|
| **Loading** | Skeleton: cover shimmer + title bar + meta-chip bars + 2 stop-card bars + price bar (replace today's bare spinner) | same skeleton in the 2-col frame |
| **Error** | "Couldn't load experience" + the real PostgrestError message (preserve current behavior, `[experienceSlug].tsx:106`) + retry affordance | same |
| **Not found / not live** | "Experience not found — may not be live yet, or the link is wrong" (`:125`) | same |
| **No cover media** | Hero → accent-derived flat hue (EventCoverMedia no-cover branch); title still legible over scrim | same |
| **Cover is video** | autoplay-muted; sound toggled by the circular Mute button beside Share | same |
| **Available** | floating accent Book bar + "N spots left" chip + per-date "N left" | sticky-panel Book + reassurance |
| **Deadline / filling up** | accent banner under hero ("Next date filling up — N spots left") + the near-empty date row highlighted | centered accent pill + panel reassurance |
| **Sold out** (all dates full / ticket sold out) | grey "SOLD OUT" banner, capacity chip → "Sold out · 12 of 12", bar → non-tappable "Sold out" | panel Book → disabled grey |
| **Ended** (all dates past, `allDatesPast`) | "This experience has ended" banner, bar → non-tappable | panel Book → disabled grey |
| **Not bookable** (`bookable===false`) | bar → "Booking unavailable — the organizer is finishing payment setup" (preserve ORCH-1076/1117) | panel Book → same disabled info copy |
| **whenMode=single** | date picker collapses to one date chip; "From" kicker drops to a flat price | same |
| **Free experience** | no all-in money line; CTA "Get my spot"; price chip "Free" | same |
| **Empty stops** (shouldn't happen — 2 min enforced) | itinerary section omitted | same |

---

## F. Per-surface deltas + flags

### F.1 Theming (inherited contract — non-negotiable)
Reuse the EXACT event/trip machinery: `resolveTheme(brandTheme, experienceOverride)` → `createThemePalette` → light/dark page + contrast-adjusted accent (≥3.15:1 on page, ≥4.5:1 white-on-accent) + `theme.fontFamilyValue` on title/section heads/stop titles/price/CTA + `ThemeEntranceAnimation` over the cover keyed `experience:${id}` + contrast-aware `palette.primaryText/secondaryText/tertiaryText` (never raw `#ffffff`). The mockup's `setTheme` CSS helper illustrates the OUTCOME; production uses the real palette function.

### F.2 Android glass policy
Any translucent panel (vibe chips, brand row, date-option rows, sticky panel) uses the opaque ≥0.92 frosted fallback on Android via `Platform.select` + `overflow:'hidden'` + no Android shadow under a rounded fill (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). iOS keeps translucent. Mockup shows the iOS look.

### F.3 Motion (inherited)
Cover entrance `ThemeEntranceAnimation` once/session (reduced-motion: skip) · Read-more 200ms height settle · date-option select 150ms bg/border + radio fill cross-fade · floating-bar price cross-fade · all 150–300ms transform/opacity only · reduced-motion fallback on each.

### F.4 Accessibility (inherited + experience-specific)
Contrast ≥4.5:1 via the palette engine · date picker = `role="radiogroup"` / each option `role="radio"` + `aria-checked` (single-select, the mockup's `pickDate` mirrors this) · vibe chips = static labeled text (not interactive) · capacity is text not color-only · reading order = visual order · ≥44pt targets (date rows, Book CTA, brand row) · floating bar in the thumb zone is the single primary action.

### F.5 GAPS the implementor must close (RENDER NOW, NEEDS READ-PATH WIRING)
These four fields are **authored or auto-derived real data** the page renders, but the public read path (`publicExperienceService.ts`) does not yet fetch/map them. They are **read-path additions, not new authoring** — wire them so the rendered nodes show real data:
1. **`experience_intents`** [AUTHORED — wizard Step 1, ≥1 required] — add to the `events` select + `PublicExperience` + `mapExperience` so the vibe chips render real data.
2. **`stop.description` (ai_description)** [AUTHORED — required at publish, 1–280] — add to `loadExperienceSidecars` select (`:265`) + `PublicExperienceStop` + `mapExperience` — it's the strongest itinerary copy and is currently dropped by the read path.
3. **`stop.lat`/`lng`** [AUTHORED — Mapbox pick required on stop 1] — add to the stops select + type so the map block renders the first stop's real coordinates. (If the map is judged out of scope for v1, drop the map block instead of fabricating coordinates — do NOT ship a placeholder map image.)
4. **`ticket.ticketsRemaining` per date** [AUTO-DERIVED REAL — capacity − sold] — the slug preview path sets `ticketsRemaining: null` (`:206`); the date picker's "N left" + sold-out gating needs the remaining computation wired into the preview (the checkout sibling `usePublicExperienceById` already computes it). Without it the date picker shows dates but no capacity.

**NOT a gap — DO NOT WIRE:** Cancellation/refund policy is **not authored** by the experience wizard (no refund step; `PublicExperience` has no refund field). There is nothing in the model to read — it was removed from the mockup, not flagged for wiring. The same goes for inclusions. Adding either requires a NEW wizard field first (separate ORCH).

---

## G. Deliverables
- **`EXPERIENCE_DIRECTION_A_RESPONSIVE.html`** — the responsive phone↔desktop mockup, all real fields, interactive (brand swatches + font + State picker + When-mode picker → date picker shows/collapses, single date-select). Single file, double-click to open.
- **This spec** — field inventory (→source:line), current-vs-reimagined, IA/layout, every state, per-surface deltas, and the read-path gaps the implementor must close.

> Constitution rule 9 honored: the page renders ONLY fields the experience CREATE/EDIT wizard authors (Identity/Stops/When/Pricing/Cover) plus legitimate auto-derived real fields (brand identity, all-in price from the tier, per-date remaining, stop-count). The prior pass's greyed "candidate" inclusions block and the refund-ladder/refund-strip have been DELETED — neither is authored by the experience wizard, so neither is rendered or flagged for read-path wiring. The four flagged items in §F.5 (intents, ai_description, lat/lng, per-date remaining) ARE authored/derived real data and are rendered now, pending the implementor widening the public read path.
