# INVESTIGATION — ORCH-0997 [Friend-page holiday/birthday cards don't render or open like the swipeable deck]

**Phase:** INVESTIGATE (forensics, independently verified — supersedes the orchestrator's source-level draft)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0997-[friend-card-deck-parity]/` on branch `ORCH-0997-friend-card-deck-parity` (off `origin/main`, HEAD `aacf080bd`)
**Date:** 2026-05-29
**Confidence:** BOTH root causes **PROVEN** — six-field source trace AND live-fire on a real paired friend (Android, 2026-05-29). See §Live-fire.

---

## Symptom (operator, verbatim)

> On the public friend page, the birthday cards, upcoming holidays, standard holidays and custom holiday section still have cards that dont render like they would on the swipeable deck. The shape is broken and the cards dont just open the same way.

- **Expected:** the cards in the friend page's birthday / "Your Special Days" / "Upcoming Holidays" sections look and open like the Home swipeable-deck cards.
- **Actual:** they're small mini-tiles (different shape), and tapping one opens a degraded detail view.
- **"still":** ORCH-0986 (paired-profile premium redesign, PR #235 `661d7b535`) restyled the page but fixed neither symptom.

---

## Investigation manifest (files read in full, this worktree)

| # | File | Why |
|---|---|---|
| 1 | `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` | friend-page host; owns `handleCardPress` + the `ExpandedCardModal` mount |
| 2 | `app-mobile/src/components/PersonHolidayView.tsx` | renders the 3 sections via `CardRow` → `CompactCard`; builds the `onCardPress` payload |
| 3 | `app-mobile/src/components/SwipeableCards.tsx` (card render 2494–2604; modal mount 2612–2680) | the deck: reference card + how it builds `selectedCardForExpansion` |
| 4 | `app-mobile/src/components/ExpandedCardModal.tsx` (1367–1480, 1760–1972, 2240–2260) | how the modal consumes `target.data` — the contract both surfaces must satisfy |
| 5 | `app-mobile/src/types/expandedCardTypes.ts` (`ExpandedCardData` 8–183; `ExpandedCardModalProps` 254–296) | the data contract |

---

## ROOT CAUSE #2 — "Don't open the same way" — 🔴 PROVEN

**The friend page feeds `ExpandedCardModal` a data object whose field names don't match `ExpandedCardData`. There is no normalization layer, so the modal reads `undefined` for the hero image and location and renders a degraded detail.**

Six-field evidence:

- **File + line:**
  - Producer: `app-mobile/src/components/PersonHolidayView.tsx:478–502` (the `onCardPress({...})` payload) and `:90–116` (its declared shape).
  - Pass-through: `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx:263–266` (`handleCardPress` sets `expandedCard` verbatim) → `:486–489` (`target={{ kind:"nightOut", data: expandedCard }}`).
  - Consumer: `app-mobile/src/components/ExpandedCardModal.tsx:1392` `const card = target?.kind === "nightOut" ? target.data : null;` (no mapping), `:1914–1927` (hero image), `:1474–1477` (location/distance).
- **Exact code:** producer emits `imageUrl: c.imageUrl`, `lat: c.lat`, `lng: c.lng` (flat). Consumer reads `card.images && card.images.length > 0 ? <ImageGallery images={card.images} initialImage={card.image}/> : <grey "No images" box>` (`:1914`), and `card.location?.lat / card.location?.lng` (`:1474–1475`).
- **What it does now:** `card.images` and `card.image` are `undefined` (the object only has `imageUrl`), so the single-place branch falls to the **grey `#f3f4f6` "No images" placeholder** (`:1916–1927`). `card.location` is `undefined` (object has flat `lat`/`lng`), so the distance/travel computation early-returns at `:1477` and the location-derived pills/sections no-op.
- **What it should do:** the modal should receive `image: <url>`, `images: [<url>...]`, and `location: { lat, lng }` so it renders the hero gallery + location-derived data exactly as the deck does (deck passes a full `ExpandedCardData` as `selectedCardForExpansion`, `SwipeableCards.tsx:2616`).
- **Causal chain:** friend page maps DB card → ad-hoc object using deck-foreign field names (`imageUrl`/flat `lat,lng`) → passed straight through `handleCardPress` → `target.data` → modal consumes verbatim (no normalizer at `:1392`) → `card.images`/`card.location` undefined → grey "No images" box + dead location features → user sees a stripped-down detail unlike the deck.
- **Verification step:** independently confirmed in this worktree — `:1392` is a direct ternary assignment (grep for `normaliz|mapTo|toExpanded` in `ExpandedCardModal.tsx` returns only `normalizeWebsiteUrl`, unrelated). `ExpandedCardData` (`expandedCardTypes.ts:16–17`) declares `image: string; images: string[]` and (`:70–73`) `location?: { lat; lng }`. The producer (`PersonHolidayView.tsx:481,490–491`) emits `imageUrl`/`lat`/`lng`. No code path renames them. This is a static certainty — no runtime/timing dependence — hence PROVEN without live-fire.

Classification: **contract violation / response-shape divergence.** One-owner-per-truth (the card→modal data shape has two divergent producers) + Constitution "response shape truthful in all states."

Curated note: the producer does pass `cardType:"curated"` + `stopsData`, but the curated stops are typed loosely (`stops: unknown[]`) and not shaped as `CuratedStop[]`; the curated branch in the modal (`:1764` onward keys off `card.nightOutData`/`cardType` + stop fields) can still mis-render. Lower-severity than the hero-image break but in scope for the fix.

---

## ROOT CAUSE #1 — "Shape is broken" — 🔴 architecturally confirmed (visual live-fire pending)

**There is no shared deck-card component; the deck card is built inline inside `SwipeableCards.tsx`, so the friend page grew its own structurally different `CompactCard`.**

- The deck card is inline JSX (`SwipeableCards.tsx:2502–2604`): full-bleed portrait, `CardHeroImage` hero (~60–65% height), `LinearGradient`, `GlassBadge` chips (distance/travel/rating/price/category), title overlay, white details footer. Curated → `CuratedExperienceSwipeCard`. It is **not** an importable component.
- The friend-page tile is `PersonHolidayView.tsx:246–340` (`CompactCard`): width `CARD_W = s(150)` (`:1109`), image fixed `height: s(100)` (`:1232`), raw RN `<Image source={{uri:imageUrl}} resizeMode="cover">` (`:290`), one corner category badge, price/rating footer; curated tiles get a dark `#1C1C1E` background (`:1227`) while singles are white. Rendered in a horizontal `ScrollView` (`CardRow`, `:459–547`).
- Consequence: deck = portrait hero, friend page = 150-wide landscape thumbnail. Different geometry, different image renderer (`CardHeroImage` vs raw `<Image>`), different badge system → cannot look alike. Even within one row, curated (dark) vs single (white) tiles look inconsistent. This is **architecture-flaw / design-debt**, not a style typo, and is why ORCH-0986's restyle didn't close the gap.

Confidence note: the divergence is certain from source. The operator's word "shape is broken" is a **visual** claim on a described reproducer, so per Prime Directive #7 the exact current rendered geometry must be captured on the iOS sim before the SPEC pins target tokens. That live-fire is blocked (below); confidence stays **architecturally-confirmed**, not yet **proven**, on the visual specifics.

---

## Five-layer cross-check (open-path root cause)

| Layer | Finding |
|---|---|
| Docs | ORCH-0986 redesign restyled the page; no doc requires deck parity of card+open — this is the gap being closed. |
| Schema | N/A — no DB change; the card source data has the fields, the client mis-maps them. |
| Code | Producer field names (`imageUrl`, flat `lat/lng`) ≠ consumer reads (`image`/`images`, `location.lat/lng`). No normalizer. CONFIRMED. |
| Runtime | Live-fire pending (blocked). Static trace is deterministic: undefined → grey "No images" box + dead location. |
| Data | The card rows carry image + coords; loss is purely the client-side field-name mismatch, not missing data. |

---

## Outcome & journey step-back

- **User goal:** "I'm on my paired friend's profile; show me date/gift ideas for their birthday and upcoming holidays, and let me tap one to see the full place the same way I do when swiping the deck."
- **Journey:** open friend profile → scroll to Birthday / Your Special Days / Upcoming Holidays → see picks → tap a pick → full place detail → save/share/plan.
- **Divergence points:** (a) the picks render as mini-tiles, not deck cards (RC#1); (b) tapping yields a grey "No images" detail with dead location features (RC#2). Both must be fixed for the outcome; fixing only the tile shape would still leave the open broken, and vice-versa. The scoped fix (operator-chosen) addresses both: correct the producer payload (RC#2) + reshape the tile to the deck's visual language (RC#1).

---

## Blast radius

- Surfaces: **iOS-consumer + Android-consumer** (shared `app-mobile` code → parity automatic once fixed). Not business/admin/buyer-web (no friend page).
- Same `CompactCard`/`CardRow` path serves all three friend-page sections (birthday hero row, custom holidays, standard holidays) and the fallback-card path (`PersonHolidayView.tsx:506–544`) — all inherit both bugs, all fixed together.
- `PersonGridCard` / `PairedSavesListScreen` / `PairedProfileSection` import `PersonGridCard` (a *different* grid card) — out of scope, but flag: a third card renderer exists (drift surface).
- The deck (`SwipeableCards.tsx`) is explicitly OUT of scope per the operator's "scoped fix" choice — must not be edited.

---

## Discoveries for orchestrator

- **D-1:** Three separate recommendation-card renderers exist (deck inline card, `CompactCard`, `PersonGridCard`). The durable cure is one shared `<RecommendationCard>` + one `toExpandedCardData()` adapter (the rejected Option A). Worth a future consolidation ORCH once this scoped fix ships.
- **D-2:** The `onCardPress` payload type in `PersonHolidayView.tsx:90–116` is a hand-rolled inline interface, not `Partial<ExpandedCardData>` — which is *why* the field-name drift wasn't caught by the type checker. The fix should type the producer against `ExpandedCardData` so this can't recur (regression-prevention hook).

---

## Live-fire — PROVEN end-to-end on Android (Samsung `R58R54YV7JT`), 2026-05-29

Per Prime Directive #7 the reproducer was run end-to-end on a real device (operator authorized the connected Android phone and paired the test friend mid-session; both iOS sims were in use by sibling sessions). Setup: anchor Metro on isolated port 8099 (worktree node_modules symlink broke Metro resolution → ran from the anchor checkout per `feedback_testing_handoff_just_run_expo_start.md`), `adb reverse tcp:8099`, deep-linked the dev client. The Android build HAS `expo-video`; the iOS sim build did NOT (`Cannot find native module 'ExpoVideo'` red-box — predates the launch rebuild, COMMS-0007; environment artifact, not the bug).

**Evidence captured (`/tmp/o997_*.png`):**

- **RC#1 PROVEN — tile shape.** On paired friend "Seth O" the Birthday row renders two `CompactCard` tiles side by side: a **dark `#1C1C1E` curated tile** ("Nike Art Gallery → FoLiXx Bukka / Celebration · 2 stops / Chill · $50 max") and a **white single tile** ("Nike Art Gallery / Icebreakers / 4.7") — small ~150-wide landscape thumbnails, image on top, text below. Against the captured deck cards ("The Pit Authentic Barbecue", "So Hot HotPot- Cary" — full-bleed portrait hero + `GlassBadge` chips + white Share footer; curated "Big Ed's City Market → Artspace" via `CuratedExperienceSwipeCard`), the geometry is unmistakably different and the curated-dark/single-white split makes the row internally inconsistent. Matches the source analysis exactly.
- **RC#2 PROVEN — broken open (smoking gun).** Tapping the white single tile opened `ExpandedCardModal` showing a grey **"No images available"** placeholder box where the deck card shows a full hero photo — the exact `ExpandedCardModal.tsx:1916–1927` fallback that fires because `card.images`/`card.image` are `undefined` (the friend page passed `imageUrl`). Title/category/rating/price/address/Save/Schedule/Policies all rendered; only the hero — and the location-derived distance (no pill; address shown instead, consistent with `card.location` being `undefined`) — are degraded. Precisely the "doesn't open the same way" symptom.

**Birthday hero (works as designed):** "Seth / Birthday · September 18 / Turning 30 / 112 days" + "11 Liked Places" + "Add to calendar". "Your Special Days" shows the "Mark a day that matters" empty state (no custom holidays seeded); standard "Upcoming Holidays" sit below — all feed the same `CardRow`/`CompactCard`, so all inherit both bugs.

**Dev-only noise observed (NOT the bug, NOT in scope) — Discovery for orchestrator:** recurring LogBox overlays on this dev build — "Unable to activate keep awake" and "Uncaught (in promise) Error: Unable to…" — surfaced during navigation; dev-client artifacts, not friend-page defects. Hot-reloads also intermittently bounced the screen to the deck (dev instability), not a product issue.
