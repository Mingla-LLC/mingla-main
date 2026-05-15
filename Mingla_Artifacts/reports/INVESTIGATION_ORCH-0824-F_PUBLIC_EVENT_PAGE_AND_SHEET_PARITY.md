# INVESTIGATION — ORCH-0824-F — Public event page + consumer sheet render parity for new ORCH-0824 fields

**Mode:** INVESTIGATE
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Parent:** ORCH-0824 (CLOSED w/ deferred follow-ups)
**Operator scope decision:** additive only on the public page; sheet matches same content in sheet-native form

---

## Headline

The PUBLIC EVENT PAGE (`mingla-business/app/e/[brandSlug]/[eventSlug].tsx` → `PublicEventPage` component) currently renders the original Cycle-6 layout — cover, title + dates, brand chip, venue card, About, Tickets list. **It is completely unaware that the new ORCH-0824 fields (`partyTypes`, `vibeTags`, `musicGenres`, `city`, `locationGeo`) exist on the event.** No render references at all.

The CONSUMER SHEET (`app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`) **does render the new chips already** — Party Type chips, Vibe chips with emoji, Music Genre chips, plus the existing venue / date / price / CTA stack. Counterintuitively, the consumer sheet is currently MORE complete than the public page.

So the work direction is **public page catches up to the sheet** (additive content), then **sheet adapts to mirror the same content order** that the public page lands on.

---

## Layer A — Public event page

### Component chain
- Route: `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` (88 lines)
- Data hook: `usePublicEventBySlug(brandSlug, eventSlug)` → reads from `business_public_events_view` (migration 3 already exposes all 5 new columns)
- Render: `PublicEventPage` (1325 lines) → `PublishedBody` sub-renderer (the live-event variant; lines 396-650)

### What `PublishedBody` currently renders (top → bottom)

| # | Section | File location | Renders new fields? |
|---|---|---|---|
| 1 | Cover hero (image / hue band / video) | lines 444-475 | N/A (unchanged) |
| 2 | Title + status badge | lines 488-510 | N/A |
| 3 | Dates list (master + multi-date expand) | lines 515-560 | N/A |
| 4 | Brand chip (single letter tile + brand name) | lines 562-572 | N/A |
| 5 | Venue card (icon + venueName + address-OR-hidden-message) | lines 573-610 | **city not shown explicitly** |
| 6 | "About" section header + description | lines 612-617 | N/A |
| 7 | "Tickets" section header + tickets list | lines 619-640 | N/A |

### Gaps (vs. what the DB now provides)

| Field | DB column | Available on `event` object? | Currently rendered? |
|---|---|---|---|
| `partyTypes` | `events.party_types` text[] | YES (via `business_public_events_view` → eventFromRow → LiveEvent.partyTypes) | **NO** |
| `vibeTags` | `events.vibe_tags` text[] | YES | **NO** |
| `musicGenres` | `events.music_genres` text[] | YES | **NO** |
| `city` | `events.city` text | YES | **NO** (buried in the address concatenation only) |
| `locationGeo` | `events.location_geo` point | YES | **NO** (no map preview today — out of scope per operator) |

### Address rendering — current behavior

Looking at lines 580-595, the Venue card body has this branching logic:

```ts
{event.hideAddressUntilTicket
  ? "Address shared after ticket purchase"
  : event.format === "hybrid" && event.address !== null
    ? `${event.address} · also online`
    : event.address ?? "Address shared after ticket purchase"}
```

**Issue:** when `hideAddressUntilTicket=true`, the card hides the address entirely AND hides the city. But city is meant to be public-safe info (it's literally the filter that anonymous browsers use on Discover). The page should show the city even when the precise street address is hidden.

For Big Party (which has `hideAddressUntilTicket=true` and `city="Raleigh"`, `address="700 Corporate Center Dr, Raleigh, NC 27607, USA"`), the rendered text today is just "Address shared after ticket purchase" with no city visible. Buyers can't see WHERE in the world this event is.

### Why this matters

- Brand UX: the buyer landing page doesn't show what taxonomy / vibe the event is (no chips). Anonymous buyers can't quickly assess fit.
- City UX: the page doesn't show city when address is hidden. Buyers learn "Raleigh" only from Discover (consumer app) — direct share-URL visitors see no location at all.
- Parity: consumer sheet > public page in completeness, which is backwards — share URL is the persistent canonical artifact.

---

## Layer B — Consumer sheet (`ExpandedBusinessEventSheet`)

### Current render structure

```
hero (image/hue band) + "On Mingla" pill
  ↓
title
"by [brandName]"
  ↓
party type chips (orange-tinted)
vibe chips (with emoji)
music genre chips (blue-tinted)
  ↓
calendar-icon + dateLine
location-icon + venueLine ("Venue · City" OR "revealed after purchase" OR fallback)
cash-icon + priceLine ("Free" / "From £X" / "Pricing on event page")
  ↓
description (if present)
  ↓
"Get Tickets" CTA (orange, full width)
```

### Sheet is MORE complete than public page — what's already there

- Party type / vibe / genre chips ✅
- Brand line ✅
- Date / venue / price summary ✅
- "Pricing on event page" honest fallback ✅
- Hide-address-until-ticket handling ✅
- Get Tickets CTA opens InAppBrowserModal ✅

### What's MISSING in the sheet vs. public page

- No explicit "About" section header (description renders raw without a heading)
- No "Tickets" preview list (the sheet shows summary price line; public page shows full ticket tier list)
- City is concatenated into venue line ("Venue · City") rather than as a structured location card

Per operator decision (sheet-native layout, same content): the sheet's sections should match the public page's added structure but in a sheet-friendly form factor.

---

## Cross-layer contradictions

1. **Render asymmetry**: anon visitor following a share URL sees less content than a logged-in consumer browsing Discover. This violates the implicit "public page = canonical truth, sheet = derivative summary" invariant.
2. **Location info hidden when address-protected**: the page hides BOTH street address AND city when `hideAddressUntilTicket=true`. Only the street address should be hidden — the city is intentionally public (drives Discover filtering).

---

## Constraint inventory

- **Data is available**: all 5 new fields flow through `business_public_events_view` → `usePublicEventBySlug` → `LiveEvent` → into the `PublicEventPage` props. No data plumbing changes needed.
- **`LiveEvent` type already has the fields**: `partyTypes?: string[]`, `vibeTags?: string[]`, `musicGenres?: string[]`, `city?: string | null`, `locationGeo?: {...} | null` (added in hotfix-1).
- **Canonical labels available**: `mingla-business/src/constants/eventTaxonomy.ts` exports PARTY_TYPES, VIBE_TAGS, MUSIC_GENRES — same canonical lists the consumer sheet uses (parity-locked by CI).
- **No schema changes required**. No new edge function. Pure UI work.
- **Existing styling tokens**: `glass`, `accent`, `spacing`, `radius`, `typography`, `text` tokens already in scope.

---

## Open questions for SPEC

1. **City surfaced when address is hidden** — operator decision: show city even when `hideAddressUntilTicket=true`? Recommendation: yes ("Raleigh · Address shared after ticket purchase").
2. **Chip color treatment on public page** — match the consumer sheet's color scheme (party=orange-tinted, vibe=neutral, genre=blue-tinted), or use the public page's existing glass-tinted style? Recommendation: match consumer sheet for cross-surface visual continuity.
3. **Chip section order on public page** — recommend: insert Party Type chips ABOVE the Venue card (next to brand chip), Vibe + Music Genre chips BELOW the venue card before About section. Same logical ordering as the sheet, just laid out for a full page.
4. **Sheet section headers** — should the sheet adopt the public page's "About" / "Tickets" headings? Recommendation: yes for About; "Tickets" header is overkill in the sheet — the Get Tickets CTA already implies it.
5. **Tickets preview in sheet** — should the sheet show a mini-list of ticket tiers (e.g., 2-3 rows) before the CTA? Recommendation: out of scope for this ORCH; the CTA is sufficient. Defer to a future polish ORCH.

---

## Risk + regression surface

- **Ticketmaster / place-card rendering paths in `ExpandedCardModal`** — untouched. Sheet changes are scoped to the new business-event branch only.
- **`CancelledVariant` + `PasswordGateVariant` of PublicEventPage** — unchanged. Only `PublishedBody` body is extended.
- **Server-side data**: no schema or RPC changes. Pure additive UI.
- **Localization**: chip labels come from `eventTaxonomy.ts` which is English-only. Same constraint exists today on the wizard + filter UI.
- **Accessibility**: new chips need `accessibilityLabel` so screen readers announce them.

---

## Discoveries for orchestrator

- **None of the new fields are rendered on the public page** — operator pre-ORCH-0824-F has had a partial-render state since hotfix-1 landed. This investigation formalizes the gap.
- **Address-hiding hides city** — pre-existing behavior, not caused by ORCH-0824, but newly visible because Big Party publishes have started populating `events.city`. SPEC will fix.
- **Sheet > public page** in content completeness — backwards from the natural canonical hierarchy. SPEC will rectify.

---

## Confidence

**High** for the code-level gap analysis (grep + read confirmed zero references to ORCH-0824 fields in PublicEventPage; sheet renders chips per source inspection). **Medium** on the visual representation of "broken" — operator said cover renders fine, rest doesn't; haven't yet captured a sim screenshot of the live public-page state. The render-gap conclusions hold regardless.

NEXT HANDOFF — paste into Claude `mingla-forensics` (SPEC mode):

Write the SPEC for ORCH-0824-F per the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824-F_PUBLIC_EVENT_PAGE_AND_SHEET_PARITY.md`. Operator-locked scope: ADDITIVE only on PublicEventPage (don't restructure existing sections; insert new sections for party-type chips, vibe chips, music-genre chips, structured city display) AND alignment of ExpandedBusinessEventSheet to mirror the same content in a sheet-native layout (handle bar, scrollable, swipe-to-dismiss). No schema changes, no edge functions, no data-plumbing changes — all 5 new fields are already reachable via existing hooks. Five SPEC-level decisions are pending and listed in the investigation's "Open questions for SPEC" section (city-when-address-hidden, chip color treatment, chip section order on public page, sheet section header alignment, sheet ticket-preview). Resolve each inline. Write the spec to `Mingla_Artifacts/specs/SPEC_ORCH-0824-F_PUBLIC_EVENT_PAGE_AND_SHEET_PARITY.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Next dispatch after SPEC return will be implementor for the layout work, then tester (Claude mingla-forensics TEST mode), then CLOSE.
