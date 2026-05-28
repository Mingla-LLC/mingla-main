# INVESTIGATION — ORCH-0986 [Paired-profile holidays section]

**Skill:** Claude `mingla-forensics` (INVESTIGATE)
**Date:** 2026-05-28
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0986-[paired-profile-holidays-redesign]/` on branch `ORCH-0986-paired-profile-holidays-redesign` (rebased on `origin/main` `43721c074`, post-PR-#229 merge)
**Affected surfaces:** consumer-iOS + consumer-Android (consumer-app-only feature)
**Confidence:** RC-1 root cause **proven at code + data layers**; on-device UI pixel confirmation **pending** a paired test-account login (named blocker — see §Confidence).

---

## 1. Symptom Summary

- **Expected:** On a paired friend's profile, each occasion section (birthday hero, custom days, standard holidays) shows a horizontal card row that leads with a **curated multi-stop "combo" card** (a date plan) followed by signal-scored single-place cards. The curated card should show a hero image, title, price, and stop count.
- **Actual:** The curated combo card renders "broken" — a dark card with a **gray placeholder icon instead of a hero photo**, no price, and (when tapped) an empty multi-stop view. The single cards render fine. Operator also perceived the surface as "not using the new scored system."
- **Reproduction:** Every paired-profile section (composition rules set `comboCount: 1` for all holiday keys), so the defect is systematic, not occasion-specific.

---

## 2. Investigation Manifest (files read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` | Component | Entry; pairing gate; mounts PersonHolidayView |
| 2 | `app-mobile/src/hooks/useFriendProfile.ts` | Hook | `isFriend` vs `isPaired` distinction |
| 3 | `app-mobile/src/components/PersonHolidayView.tsx` | Component | Section + CardRow + CompactCard rendering |
| 4 | `app-mobile/src/hooks/usePairedCards.ts` | Hook | Query key, fetch params |
| 5 | `app-mobile/src/services/personHeroCardsService.ts` | Service | Edge-fn call shape |
| 6 | `supabase/functions/get-person-hero-cards/index.ts` | Edge fn | Singles RPC + curated combo integration + `curatedCardToCard` mapper |
| 7 | `supabase/functions/generate-curated-experiences/index.ts` | Edge fn | `buildCardFromStops` — actual curated card shape |
| 8 | `supabase/functions/_shared/personHeroComposition.ts` | Shared | Composition rules (`comboCount`) |
| 9 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Schema | `query_person_hero_places_by_signal` RPC (signal scoring) |
| 10 | `app-mobile/src/components/ExpandedCardModal.tsx` | Component | Curated card tap target / stops shape |
| 11 | PR #229 diff (`git show 43721c074`) | History | Whether the merged fix addressed this |

Prior artifacts ingested: `INVESTIGATION_ORCH-0707_CURATED_CATEGORY_DERIVATION.md`, `INVESTIGATION_ORCH-0906_COLLAB_DECK_MISSING_INTENT_AND_CURATED_INTERLEAVE.md`, `SPEC_ORCH-0684` (referenced by composition rules).

---

## 3. Findings

### 🔴 RC-1 — Curated combo card has no hero image (and null price/duration) — field-contract mismatch

**File + line:**
- Producer: `supabase/functions/generate-curated-experiences/index.ts:623-637` (`buildCardFromStops`)
- Consumer: `supabase/functions/get-person-hero-cards/index.ts:236-265` (`curatedCardToCard`)

**Exact code — what the curated card actually contains (producer):**
```js
return {
  id, cardType: 'curated', experienceType, pairingKey,
  title,                       // "PlaceA → PlaceB"
  tagline,
  categoryLabel,               // NOT `category` / `category_slug`
  stops,                       // array of stop objects (each stop HAS imageUrl)
  totalPriceMin, totalPriceMax,// camelCase
  estimatedDurationMinutes,    // camelCase
  matchScore,
  ...(shoppingList ? { shoppingList } : {}),  // camelCase
};
```
There is **no top-level `image_url`/`imageUrl`, no `rating`, no `price_tier`, no `address`** — those live per-stop inside `stops[]`.

**Exact code — what the consumer reads (mapper):**
```js
imageUrl: (raw.image_url as string) ?? (raw.imageUrl as string) ?? null,   // neither exists → null
priceTier: (raw.price_tier as PriceTierSlug | null) ?? null,               // producer has none → null
totalPriceMin: (raw.total_price_min as number) ?? null,                    // producer emits totalPriceMin → null
totalPriceMax: (raw.total_price_max as number) ?? null,                    // → null
estimatedDurationMinutes: (raw.estimated_duration_minutes as number) ?? null, // producer emits estimatedDurationMinutes → null
category: (raw.category as string) ?? "Curated",                           // producer emits categoryLabel → "Curated"
shoppingList: Array.isArray(raw.shopping_list) ? ... : null,               // producer emits shoppingList → null
```

**What it does:** The mapped curated `Card` reaches the UI with `imageUrl: null`, `priceTier: null`, `totalPriceMin/Max: null`, `estimatedDurationMinutes: null`. In `CompactCard` (`PersonHolidayView.tsx:291-297`), `imageUrl === null` renders the gray `image-outline` fallback; the curated style is the dark `#1C1C1E` card (`PersonHolidayView.tsx:1188`). Result: a dark card with a gray placeholder icon, a title, an experience-type label + stop count, and no price.

**What it should do:** Lead with a real hero image (e.g., the first stop's `imageUrl`) and carry price/duration through. The producer and consumer must agree on field names, and the curated card must expose a representative image at the top level (or the mapper must read `stops[0].imageUrl`).

**Causal chain:** `buildCardFromStops` omits a top-level image + uses camelCase → `curatedCardToCard` reads `image_url`/`imageUrl` + snake_case → `imageUrl`/price/duration null → `CompactCard` shows gray placeholder on dark card → user sees a "broken" curated card.

**Verification step:** Capture a live `get-person-hero-cards` response for a paired user (any of the 8 pairings) and confirm the first card (`cardType: "curated"`) has `imageUrl: null`. (Pending — see Confidence.)

---

### 🟠 CF-1 — Curated combo failures are silently swallowed

**File + line:** `get-person-hero-cards/index.ts:279-348` (`planComboForHoliday`).

**What it does:** On any non-OK response, thrown error, or empty `cards` array from `generate-curated-experiences`, returns `{ combo: null }` and the row silently shows singles only — no error, no retry, no telemetry surfaced to the client. `emptyReason` is set on the response `summary` but the mobile service (`personHeroCardsService.ts:57-60`) **drops `summary` entirely** (only reads `cards` + `hasMore`), so even the empty-reason signal never reaches the UI.

**Classification:** Contributing factor / hidden flaw. Not today's primary symptom (the combo DOES return and render), but it means any real curated failure is invisible — and it masks RC-1's severity (a half-broken card looks the same as a deliberately-omitted one).

---

### 🟡 HF-1 — Tapping a curated card likely opens an empty multi-stop view (stops shape mismatch)

**File + line:** `PersonHolidayView.tsx:487-488` (tap payload) vs `ExpandedCardModal.tsx:769`.

**What it does:** The card tap payload sets `stops: c.stops` (a **count number**, see `Card.stops: number`) and `stopsData: c.stopsData` (the **array**). `ExpandedCardModal.tsx:769` reads `Array.isArray(localCard.stops) ? localCard.stops : []` — i.e. expects `stops` to be the array. A number is not an array → `stops = []` → the expanded multi-stop plan renders empty. The actual stop array sits unused in `stopsData`.

**Classification:** Hidden flaw (medium confidence — depends on how `target={{ kind: "nightOut", data: expandedCard }}` is consumed in the modal's data-mapping; flagged for the spec phase to trace fully). If confirmed, the curated card is broken in BOTH the row (no image) and the expanded view (no stops).

---

### 🟡 HF-2 — Per-section HTTP fan-out (latency + complexity driver)

**File + line:** `PersonHolidayView.tsx` (each `HolidaySectionView`/`CustomHolidaySectionView`/birthday renders a `CardRow`) → `usePairedCards` → `get-person-hero-cards` → internal HTTP call to `generate-curated-experiences` (`get-person-hero-cards/index.ts:295-316`).

**What it does:** Each expanded section independently calls `get-person-hero-cards`, and each of those fires its own nested call to `generate-curated-experiences` (the implementor noted +100-200ms per call at `:271-278`). On a single profile open, the birthday row + the 2 auto-expanded standard holidays (`PersonHolidayView.tsx:823`) + any custom days each trigger an edge call with a nested curated sub-call. Staging (`stage1Done`/`stage2Done`) serializes them, which compounds latency rather than parallelizing.

**Classification:** Hidden flaw — the main "make it simpler" target. A redesign should fetch once, not per-section.

---

### 🔵 OBS-1 — `person_card_impressions` table is empty (0 rows)

`get-person-hero-cards:980-1004` writes a fire-and-forget impression for every single card returned. The table has **0 rows** across all time, despite 8 pairings and a fully populated `place_scores`. Either the paired-hero path has essentially never successfully rendered singles in production, the impression write is failing silently, or the feature is effectively unused. Worth the orchestrator's attention as a usage/health signal — it suggests this surface is cold, which lowers the risk of a bold redesign.

### 🔵 OBS-2 — Singles DO use the new scored system (operator premise corrected)

`query_person_hero_places_by_signal` (`...orch_0729.sql:5747+`) joins `place_scores` (`ps.score AS signal_score`), filters `ps.signal_id = ANY(p_signal_ids)`, and ranks by `signal_score` + personalization boost. Singles are genuinely signal-scored. The "doesn't use the scored system" symptom is really RC-1 (the curated integration looks broken), not a scoring-engine gap.

### 🔵 OBS-3 — PR #229 did not touch this mismatch

`git show 43721c074` changes `generate-curated-experiences` (+21 lines, slug whitelist + replace-stop search center/radius) but the diff contains **no** changes to `buildCardFromStops`, `imageUrl`, or `image_url`, and does not touch `get-person-hero-cards`. RC-1 persists post-#229. (#229 = category (c) "untouched it," w.r.t. the paired-profile rendering.)

---

## 4. Five-Layer Cross-Check

| Layer | Truth | Agreement |
|-------|-------|-----------|
| **Docs** | `SPEC_ORCH-0684` + composition rules: every section returns 1 curated combo + singles | — |
| **Schema** | `place_scores` 225,924 rows / 16 signals; RPC ranks by signal_score; `pairings` 8 rows | Singles path sound |
| **Code** | Producer (camelCase, no top-level image) ≠ consumer (snake_case, reads image_url) | **CONTRADICTION → RC-1** |
| **Runtime** | Not live-fired on device (blocker below). `person_card_impressions`=0 (OBS-1) | Pending |
| **Data** | 8 pairings, 19 birthdays, 3 custom holidays → combo path has inputs to execute | Path executes |

The Code↔Code contradiction (producer vs consumer field contract) is the bug.

---

## 5. Blast Radius

- **Tightly contained.** `get-person-hero-cards` is consumed only by `PersonHolidayView` + `usePairedCards` + `holidayCardsService` + `personHeroCardsService` + `useShuffleCards`. `PersonHolidayView` is rendered only by `ViewFriendProfileScreen`. A redesign touches this island only.
- **Shared dependency:** `ExpandedCardModal` and `generate-curated-experiences` are shared with other curated surfaces (e.g., collab deck — see `INVESTIGATION_ORCH-0906`). RC-1's mapper (`curatedCardToCard`) is **local to `get-person-hero-cards`**, so fixing it does NOT affect other curated surfaces. HF-1 (stops shape) lives in the shared `ExpandedCardModal`, so verify any change there against collab/discover curated cards.
- **No DB/RLS/admin/business impact.**

---

## 6. Invariant Violations

- **Constitution #9 (No fabricated data):** Currently HONORED — null fields render as hidden/placeholder, not fabricated. The fix must preserve this (do not invent a stock image; hoist a real stop image).
- No other invariant violations found. RC-1 is a contract bug, not a security/ownership/cache violation.

---

## 7. Fix Strategy (direction only — NOT a spec) + fix-vs-remove input

Operator has chosen a **full redesign** of the section, so the redesign decides whether curated combos belong here at all. Two factual paths for the curated card specifically:

- **(A) FIX the integration:** Align the producer/consumer contract — have `buildCardFromStops` expose a representative top-level image (e.g., `stops[0].imageUrl`) OR have `curatedCardToCard` read `stops[0].imageUrl` + the camelCase price/duration fields; fix HF-1 by passing the stops array as `stops` (or having the modal read `stopsData`); surface combo failures (CF-1). Keeps the curated feature. Small, well-bounded edge-fn + mapper change.
- **(B) REMOVE curated combos from this surface:** Set `comboCount: 0` in the composition rules for paired-profile holiday keys → singles-only row. Eliminates RC-1, CF-1, HF-1 (for this surface), and HF-2's nested curated call in one stroke. Simplest + most predictable; loses the multi-stop date-plan on paired profiles.

OBS-1 (cold surface, 0 impressions) is relevant context: the curated combo on paired profiles has likely never worked in production, so removing it loses a feature users have effectively never seen.

**This is input for the orchestrator + operator + designer — not a recommendation.**

---

## 8. Regression Prevention (requirements for the spec phase)

- A contract test asserting the curated card shape returned by `generate-curated-experiences` matches what every consumer (`curatedCardToCard`, collab path, `ExpandedCardModal`) reads — field names + presence of a renderable image.
- If FIX path: a test that a curated card mapped through `curatedCardToCard` has a non-null `imageUrl` whenever `stops[0].imageUrl` exists.
- If REMOVE path: a strict-grep/unit gate that `comboCount === 0` for paired-profile composition rules (prevents accidental re-introduction).

---

## 9. Discoveries for Orchestrator

1. **CF-1 + dropped `summary`:** `personHeroCardsService.ts` discards the edge fn's `summary.emptyReason` — the empty-state signal never reaches the UI. Relevant to any empty-state work in the redesign.
2. **HF-1 (stops shape):** likely affects the expanded view of curated cards from this surface; trace fully at SPEC.
3. **OBS-1 (0 impressions):** possible silent impression-write failure OR genuinely-unused surface — either way a health signal worth a follow-up if the redesign keeps the path.
4. The `bilateralMode` tab bar + Saves/Visits tabs in `PersonHolidayView` are built but hidden (`:964-969`) — dead/hidden UI the redesign should consciously keep or remove.

---

## 9b. Addendum — Speed, scoring path, and location (operator follow-up 2026-05-28)

### Q1 — Why the page loads slowly, and how to make all sections fast

The current architecture is the slow part, in four compounding layers:

1. **Per-section fan-out.** Every occasion renders its own `CardRow` → `usePairedCards` → a **separate** `get-person-hero-cards` HTTP call. On a typical open that's the birthday row + the 2 auto-expanded standard holidays (`PersonHolidayView.tsx:823`) + every custom day = 3–5+ independent edge calls.
2. **Serialized, not parallel.** The sections are staged: custom days are gated `enabled={stage1Done}` and standard holidays `enabled={stage2Done}` (`PersonHolidayView.tsx:945,988`). So stage 2 waits for stage 1's round-trip, stage 3 waits for stage 2 — latency adds up instead of overlapping.
3. **Nested HTTP per call.** Each `get-person-hero-cards` call internally fires a **second** HTTP call to `generate-curated-experiences` (`:295-316`) for the one combo. So each section ≈ 2 edge round-trips.
4. **Blocking OpenAI in the curated sub-call.** `generate-curated-experiences` generates teasers on a `curated_teaser_cache` miss via a blocking `await` OpenAI call (`:1419-1431`) and descriptions unless `skipDescriptions` (the person-hero path does NOT set it, `:1243`/`:304-314`), plus per-stop `place_pool` queries. So a cold section can block on 1–3 GPT-4o-mini calls.

**Net:** worst case = (3–5 sections) × (2 HTTP round-trips + up to 3 OpenAI calls), serialized across 3 stages. `staleTime: Infinity` caches per occasion+location after first load, but the first paint is expensive.

**Direction to make all sections load fast (for the redesign — not a spec):**
- Replace N per-section calls with **one batched edge call** that returns recommendations for every section in a single pass (the signal RPC already supports multiple `signal_ids`; sections could be composed server-side).
- **Parallelize** instead of staging (the staging exists only for cross-section dedup — that can be done server-side in one query).
- **Decouple the combo from a synchronous nested HTTP + OpenAI call** — precompute/store combos + teasers offline (the `curated_teaser_cache` already exists; populate it ahead of time), or drop combos here (report §7 option B).

### Q2 — Are the displayed cards coming through the scored system? YES.

- **Singles:** `query_person_hero_places_by_signal` joins `place_scores` (`ps.score AS signal_score`), filters by `signal_id`, ranks by `signal_score` + personalization boost (OBS-2). Confirmed scored.
- **Curated stops:** `generate-curated-experiences` builds every stop via the signal system on `place_pool` (ORCH-0634 — "EVERY curated stop goes through the signal system. No card_pool fallback").
- **No fabricated/fallback cards are shown here.** `PersonHolidayView` is mounted by `ViewFriendProfileScreen` WITHOUT a `fallbackCards` prop (`ViewFriendProfileScreen.tsx:448-463`), so `sectionFallback` is always `[]` (`PersonHolidayView.tsx:419-422`). Everything displayed is scored, real data.

So "doesn't use the scored system" is **false** — the scoring is sound. The only break is the curated card's image/shape mapping (RC-1).

### Q3 — How is the card location determined?

- **Center = the VIEWER's own location, not the paired friend's.** `ViewFriendProfileScreen.tsx:132-139` calls `useUserLocation(currentUserId, 'solo')`, which resolves the viewer's GPS (default) or their saved coordinates (`useUserLocation.ts`). That single `{latitude, longitude}` is passed down to every `CardRow` → `get-person-hero-cards` as `location`, used as the RPC center and the curated combo center. The paired friend's location is never used.
- **Radius differs by path — and this is a second reason combos come up empty:**
  - **Singles:** `initialRadius` 15 km → `maxRadius` 100 km, widened by the *paired* user's learned `distance` preference (`get-person-hero-cards:725-768`, `DISTANCE_RADIUS_MAP`).
  - **Curated combo:** built with a **hardcoded `travelMode: 'walking'` + `travelConstraintValue: 30`** (`get-person-hero-cards:307-309`) → `radiusKmForConstraint(30,'walking',1.0)` = `(30/60)×4.5×1.3` ≈ **2.9 km** (`_shared/distanceMath.ts:24,72-79`).
  - So singles search up to 100 km while the combo searches ~2.9 km around the viewer. In any non-dense area the combo finds little or nothing → silently dropped (CF-1) or a weak plan. This compounds RC-1: when a combo *does* return, it renders imageless; when it doesn't, it silently vanishes.

**Design implications for the redesign:** decide (a) whether to recommend around the viewer, the friend, or a shared midpoint; and (b) give the curated combo a sane metro-scale radius (≈ singles') instead of a 2.9 km walking box.

---

## 9c. Locked redesign brief + friend-GPS feasibility (operator 2026-05-28)

**Operator decisions (locked):**
1. The attached mockup is the **hero section only**. All sections below (birthday, custom days, standard holidays) must adopt the same premium visual style.
2. **Keep the recommendation rows** (curated combos + singles) — do NOT drop or collapse to one highlight — but redesign them to look premium. So curated combos are **fixed + restyled**, not removed (resolves RC-1, HF-1, HF-2, and the 2.9km radius).
3. Recommendation rows live **below the fold, rebuilt fast** (batched + parallel, per §9b Q1 direction).
4. The new full-bleed hero applies to **all friend profiles**; birthday + recommendations remain paired-only below it.
5. Recommendations center on the **paired friend's last-known physical GPS** (`user_location_history`) — **ALWAYS**, no fallback. That is the defining point of the feature ("what's near where your friend actually is"). Explicitly NOT their preferences-sheet location and NOT the viewer's location. When no last-known GPS exists, show an **honest empty state** — never fall back to a different location.
6. **CORRECTION (operator 2026-05-28):** There is **no "Ideal night out" feature** and **no image** on that card — the mockup's "Ideal night out" card was a design mistake. That styled quote card (quotation-mark + premium styling) is simply how the **user's bio** (`profile.bio`) is displayed. The bio section *becomes* the quote-styled card. No new data source — open question RESOLVED.
7. **CORRECTION (operator 2026-05-28):** **No heart/save button** on the hero — do not build it (the mockup's heart next to Message is dropped).
8. **CORRECTION (operator 2026-05-28):** The **Message pill renders directly beneath the bio** quote card — not floating at the bottom of the screen.

**🟠 CF-2 / feasibility risk — friend last-known GPS is largely unavailable.**
`user_location_history` (cols: `user_id, latitude, longitude, accuracy, altitude, heading, speed, location_type, place_context, created_at`) currently holds only **200 rows from 3 distinct users**, most recent **2026-04-08**, with **0 users active in the last 30 days**. RLS has 2 policies (assume owner-only read → cross-user read needs a SECURITY DEFINER RPC or service-role edge read). Decision #5 is therefore **not satisfiable for ~all paired friends today** — the location-capture pipeline is barely populated.

Note: `enhancedLocationService.ts`, `enhancedLocationTrackingService.ts`, and `permissionOrchestrator.ts` are under active modification on the in-flight `orch-0977-close` branch (consumer-app launch), which may be (re)activating location capture — coordinate before assuming the table stays empty.

**Implication for SPEC:** decision #5 requires a documented fallback chain when the friend's GPS is missing/stale, AND a cross-user read path (RPC/edge). Without a fallback, the redesigned recs would have no location for almost every friend. This needs an operator call (see handoff).

---

## 10. Confidence

- **RC-1: root cause proven at code + data layers.** Both field contracts read directly; #229 diff confirmed not to touch them; data confirms the path executes. This is a deterministic contract mismatch, not pattern-matching.
- **On-device UI pixel repro NOT performed.** Per Prime Directive #7 (live-fire reproducer-bound UI bugs), the ceiling without on-device confirmation is intentionally held below "proven-on-device." **Named blocker:** reproducing in-app requires logging into the consumer app on the simulator as one of the 8 paired users (credentials + an active pairing with a birthday/custom holiday), which I do not have. I did not fake or skip this silently — I am surfacing it.
- **Unblock options for full `proven` status:** (a) Seth provides a paired test-account login for the iOS sim, and I run the exact repro + capture video; or (b) Seth provides/authorizes minting a JWT for a paired user so I can call `get-person-hero-cards` directly and capture the curated card JSON (`imageUrl: null`); or (c) Seth accepts the code+data proof and we proceed to the redesign.
- HF-1: medium confidence (needs modal data-map trace at SPEC). HF-2, OBS-1/2/3: high confidence.
