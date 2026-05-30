# INVESTIGATION — ORCH-0997 [Friend-page holiday/birthday cards don't render or open like the swipeable deck]

**Status:** ROOT CAUSE — high-confidence (source-level). Visual specifics flagged for mandatory sim repro before SPEC.
**Date:** 2026-05-29
**Investigator:** mingla-orchestrator+claude
**Affected Surfaces:** iOS-consumer, Android-consumer (app-mobile). NOT in scope: business-iOS/Android (no friend page), buyer-web (no friend page), admin-web (no equivalent).

---

## The complaint (operator, verbatim)

> On the public friend page, the birthday cards, upcoming holidays, standard holidays and custom holiday section still have cards that dont render like they would on the swipeable deck. The shape is broken and the cards dont just open the same way.

Two distinct symptoms:
1. **Shape is broken** — the card tiles in those sections don't look like deck cards.
2. **Don't open the same way** — tapping a tile produces a different/degraded experience than tapping a deck card.

"Still" = ORCH-0986 (paired-profile premium redesign, PR #235, merged `661d7b535`) reskinned the page but did **not** fix either symptom.

---

## Where the code lives

| Surface | File | Card component | Open path |
|---|---|---|---|
| **Swipeable deck** (Home) | `app-mobile/src/components/SwipeableCards.tsx` (cards rendered **inline**, lines ~2494–2604) | full-bleed portrait hero card built inline (`CardHeroImage` + glass badges + title overlay + white details); curated → `CuratedExperienceSwipeCard` | `handleCardTap` → `ExpandedCardModal` with `target={{ kind:"nightOut", data: selectedCardForExpansion }}` where `selectedCardForExpansion` is a **full `ExpandedCardData`** |
| **Friend page** | `app-mobile/src/components/PersonHolidayView.tsx` → `CompactCard` (lines 246–340) | bespoke **150×~200 horizontal-scroll mini tile** (100px image, small title, footer) | `onCardPress` → `ViewFriendProfileScreen.handleCardPress` → `ExpandedCardModal` with `target={{ kind:"nightOut", data: expandedCard }}` where `expandedCard` is a **hand-mapped ~22-field subset** |

The friend-page sections (birthday hero row, "Your Special Days" custom holidays, "Upcoming Holidays" standard holidays) all funnel through the same `CardRow` → `CompactCard`.

---

## ROOT CAUSE #1 — "Shape is broken": there is no shared deck-card component; the deck card is inlined, so the friend page grew its own `CompactCard`

The swipeable-deck card is **not a reusable component**. It is built inline inside `SwipeableCards.tsx` (the hero image, gradient, glass badges, title overlay, and white details section are all JSX literals at lines 2502–2604). Because there was never a `<DeckCard>` to import, `PersonHolidayView` authored its own `CompactCard` — a small landscape grid tile (`CARD_W = s(150)`, image `height: s(100)`, `PersonHolidayView.tsx:1109`, `1216–1318`).

Consequences:
- **Different geometry.** Deck card = full-bleed portrait, ~3:4+. CompactCard = 150-wide landscape thumbnail with a fixed 100px image. They cannot look alike — they are different shapes by construction.
- **Different image renderer.** Deck uses `CardHeroImage` (the hardened image renderer; see COMMS-0007 / `@mingla/event-rendering` lineage). CompactCard uses a raw RN `<Image source={{uri}}>` with `resizeMode="cover"` (`PersonHolidayView.tsx:290`). Different fallback, fade, and aspect behavior.
- **Different badge/visual system.** Deck uses `GlassBadge` chips (distance, travel, rating, price, category). CompactCard uses a single corner category badge + a price/rating footer.
- **Curated divergence within the row.** Curated tiles get a dark `#1C1C1E` background (`compactCardCurated`, `:1227`) while singles are white — so even within one section the tiles look inconsistent, which reads as "broken."

This is an **architecture-flaw / design-debt** root cause, not a styling typo. ORCH-0986's "premium redesign" restyled `CompactCard` but kept it as a separate component, so the deck mismatch survived.

---

## ROOT CAUSE #2 — "Don't open the same way": the friend page feeds `ExpandedCardModal` a shape that doesn't match `ExpandedCardData`

Both surfaces open the *same* `ExpandedCardModal` with the *same* `kind:"nightOut"` — so superficially the open path looks unified. It is not, because the **data contract is violated**.

`ExpandedCardData` (`app-mobile/src/types/expandedCardTypes.ts:8–183`) is a ~40-field interface. The modal reads, among others:
- `image: string` + `images: string[]` for the hero/gallery
- `location: { lat, lng }` for map/weather/busyness
- `categoryIcon`, `reviewCount`, `highlights`, `tags`, `matchFactors`, `socialStats`
- `stops: CuratedStop[]` for the curated multi-stop timeline

The friend page's `onCardPress` payload (`PersonHolidayView.tsx:90–116`, `477–543`) instead passes:
- `imageUrl` **(wrong field — modal reads `image`/`images`, so the hero image is blank/degraded)**
- top-level `lat`/`lng` **(wrong shape — modal reads `location.lat/lng`, so map/weather/distance features no-op)**
- `stops` / `stopsData` as a loose array **(not typed `CuratedStop[]`; curated timeline can mis-render)**
- no `categoryIcon`, `images`, `reviewCount`, `highlights`, `tags`, `matchFactors`, `socialStats`, `nightOutData`

So when a card is opened from the friend page, the expanded modal is **materially degraded** vs the deck: missing hero image, missing location-derived sections, weaker curated rendering. That is the "doesn't open the same way" the operator is seeing. It is a **contract / response-shape** root cause (Constitution: response shape must be truthful in all states; one-owner-per-truth for the card data shape).

The `ViewFriendProfileScreen` open is also hard-coded `kind:"nightOut"` for **every** card (`ViewFriendProfileScreen.tsx:489`) — there is no branch differentiating a single place from a curated experience at the call site; it relies entirely on the malformed `data.cardType`/`stops` to drive the modal's internal branch.

---

## Why this is systemic, not cosmetic

- **No single owner for "what a Mingla recommendation card looks like."** The deck inlines it; the friend page reinvents it; the Discover "For You" grid has yet another (`PersonGridCard` / GridCard). Three renderers, three drift surfaces.
- **No single owner for "the data shape a card hands to `ExpandedCardModal`."** The deck builds a full `ExpandedCardData`; the friend page builds an ad-hoc subset. The type system did not catch it because `onCardPress` declares its own inline object type rather than `ExpandedCardData`/`Partial<ExpandedCardData>`, and the modal target accepts `data` loosely.

Fixing only the friend-page styles would be a symptom patch (Prime Directive #3). The durable fix extracts a shared card component + a single card→modal adapter.

---

## Recommended fix direction (for SPEC — operator decision required)

**Option A (durable, recommended):** Extract the deck's inline card into a shared `<RecommendationCard variant="deck"|"compact">` and a single `toExpandedCardData(card)` adapter. Friend page renders the shared card and opens through the shared adapter → guaranteed parity of both shape and open. Larger blast radius (touches SwipeableCards), highest quality.

**Option B (scoped):** Leave the deck untouched. (1) Fix the open path: build a correct `ExpandedCardData` in the friend-page `onCardPress`/`handleCardPress` (map `imageUrl→image/images`, `lat/lng→location`, type `stops`). (2) Reshape `CompactCard` toward the deck's portrait hero + glass-badge language. Faster, lower risk, but the card stays a second renderer (drift risk remains).

**Open product question for the operator:** do you want the friend-page sections to show *literal deck-style full cards* (portrait hero, swipe affordance feel) in a horizontal rail, or keep a compact rail tile that simply *matches the deck's visual language and opens identically*? This changes the SPEC materially.

---

## Mandatory next step before SPEC

Per `feedback_always_simulator_repro_described_behaviour.md`, the visual "broken shape" and the degraded-open must be reproduced on the iOS sim (paired friend with birthday + a custom holiday + standard holidays) and screenshotted, so the SPEC pins exact current-vs-target geometry. Source-level confidence is high; sim repro promotes it to proven and captures the exact visual delta.
