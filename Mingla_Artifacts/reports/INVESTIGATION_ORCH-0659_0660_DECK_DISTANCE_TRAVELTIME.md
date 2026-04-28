# Investigation — ORCH-0659 + ORCH-0660: Deck "nearby" Fallback + Expanded-View Missing Travel Time

**Investigator:** mingla-forensics
**Date:** 2026-04-25 (early morning)
**Severity:** S1-High (both); promote to S0 candidate (see Blast Radius)
**Status:** Root cause PROVEN with HIGH confidence; READY FOR SPEC.
**Confidence:** HIGH — six-field evidence on the primary root cause, MCP runtime probes corroborate.

---

## 1. Executive Summary (plain English)

Both bugs share **one root cause in the backend**, not in the mobile rendering code.

The backend edge function that powers the deck's category cards (`discover-cards`) does **not compute distance or travel time at all** — every card it returns has `distanceKm: 0` and `travelTimeMin: 0` hardcoded into the response. The mobile app receives those zeros, treats them as "missing," and falls back to the "nearby" placeholder string for distance and to suppressing the travel-time pill entirely for the expanded view.

The data the edge function would need to compute distance — user's GPS lat/lng + each place's lat/lng + the user's travel mode — **is fully available** at the time the response is built. It's being thrown away. Worse, an older version of the same function used to compute haversine distance + estimated travel time per travel mode; that logic was stripped out in commit `f1880d93` and the replacement (commit `93d96f32`, ORCH-0588 — fine-dining vertical) introduced the hardcoded zeros, originally in a cohort-gated path. ORCH-0634 (commit `7456b0f3`, 2026-04-22) then promoted the signal-serving path to ALL category chips, exposing every user to the bug. ORCH-0640 (2026-04-23) demolished the legacy fallback. So the "nearby" fallback has been firing on every single-category card for every user since at least 2026-04-22.

**Curated cards** (Romantic, First-Date, Picnic, Adventurous, Stroll, Group-Fun, Take-A-Stroll) are NOT affected — `generate-curated-experiences/index.ts:612-613` computes haversine distance + per-mode travel time correctly. So the user sees "nearby" specifically on category-chip cards (Nature, Casual, Brunch, Drinks, Fine Dining, Movies, Theatre, Creative Arts, Play, Icebreakers).

**Recommended fix direction:** Compute haversine distance + per-mode travel-time estimate inside `discover-cards` (mirror what `generate-curated-experiences` already does), populate `distanceKm` and `travelTimeMin` honestly, and drop the layered `> 0` / `!== '0 min'` truthy guards that have piled up across deckService + SwipeableCards + CardInfoSection. Single source of truth for "missing" should be `null`, not "0 sentinel + empty string."

**Findings count:** 1 root cause · 2 contributing factors · 3 hidden flaws · 3 observations.

---

## 2. Symptoms (founder-reported, 2026-04-25)

| Symptom | Where | Expected | Actual |
|---------|-------|----------|--------|
| **A (ORCH-0659)** | Collapsed swipeable deck card (current + next-card preview) | "0.8 km" / "12 min walk" / similar real value | Literal text "nearby" in the location badge |
| **B (ORCH-0660)** | ExpandedCardModal top section (CardInfoSection metrics row) | Travel-time pill with mode-matching icon (walk/drive/transit/bike) | Pill missing entirely |

---

## 3. Investigation Manifest

Files read in trace order:

| # | File | Why |
|---|------|-----|
| 1 | `Mingla_Artifacts/MASTER_BUG_LIST.md`, `WORLD_MAP.md` | Phase 0 prior context |
| 2 | `app-mobile/src/services/deckService.ts:1-540` | Recommendation shape; where distance/travelTime fields are set |
| 3 | `app-mobile/src/components/SwipeableCards.tsx:2150-2320` | Render layer for collapsed card (current + next) |
| 4 | `app-mobile/src/components/ExpandedCardModal.tsx:1740-1840` + grep `hideTravelTime` | Caller audit for Symptom B |
| 5 | `app-mobile/src/components/expandedCard/CardInfoSection.tsx:1-230` | Metrics row that should render the travel-time pill |
| 6 | `app-mobile/src/types/expandedCardTypes.ts:262-266` | `hideTravelTime` prop definition |
| 7 | `app-mobile/src/services/savedCardsService.ts:1-90` | Saved-card normalization (expanded-view backflow) |
| 8 | `app-mobile/src/utils/cardConverters.ts` | Curated-card → Recommendation converter |
| 9 | `supabase/functions/discover-cards/index.ts:510-600` | Card transformer for signal-serving path |
| 10 | `supabase/functions/generate-curated-experiences/index.ts:595-666, 1034-1075` | Curated-stop builder (reference implementation) |
| 11 | Migration grep + `git log -S` on `discover-cards` | Bisect distance/travelTime introduction & removal |
| 12 | MCP probes (5): RPC return-shape, sample servable nature places at Raleigh, RPC argument signature, fetch_local_signal_ranked return shape, preferences travel_mode distribution | Layer 4 (Runtime) + Layer 5 (Data) verification |

---

## 4. Five-Truth-Layer Cross-Check

### Symptom A — Collapsed card "nearby"

| Layer | State | Source |
|-------|-------|--------|
| **Docs** | No spec mentions a "nearby" placeholder. ORCH-0029 (2026-03-22, closed) explicitly added per-user travel times. ORCH-0392 closed 2026-04-11 added travel-mode pills to deck. Implicit contract: real distance + real travel time. | tracker history |
| **Schema** | `query_servable_places_by_signal` returns lat/lng but NO distance/travel-time columns. `place_pool` has lat/lng populated. `preferences` has `travel_mode` (enum: walking/driving/transit/biking) and `custom_lat/custom_lng`. All raw materials present. | MCP probes 1, 2, 4 |
| **Code** | `discover-cards/index.ts:554-555` hardcodes `distanceKm: 0, travelTimeMin: 0`. `deckService.ts:174` returns `''` when distanceKm is 0. `SwipeableCards.tsx:2170, 2304` falls back to `t('cards:swipeable.nearby')` when string is empty. | direct file read |
| **Runtime** | RPC returns 5 Raleigh nature rows with full lat/lng (Williamson Preserve 35.73/-78.45, Umstead State Park 35.89/-78.75, etc.). Edge function transforms them with hardcoded zeros. Mobile renders fallback. | MCP probe 2 + edge code |
| **Data** | `preferences.travel_mode` distribution: 10× driving, 1× transit, 1× walking, 1× biking — varied, not stuck on default. `place_pool.lat/lng` non-null for every servable Raleigh row probed. | MCP probe 5 |

**Verdict:** Layers Code + Runtime contradict layers Docs + Schema + Data. Code throws away available data. Bug is in Code (edge fn).

### Symptom B — Expanded view missing travel-time pill

| Layer | State | Source |
|-------|-------|--------|
| **Docs** | ORCH-0392 (closed 2026-04-11): travel-mode pills required. ExpandedCardModal type (`expandedCardTypes.ts:264`) has `hideTravelTime?: boolean`. | type definition |
| **Schema** | Same as A — data is there. | n/a |
| **Code** | `ExpandedCardModal.tsx:1785` passes `travelTime={hideTravelTime ? undefined : card.travelTime}`. `CardInfoSection.tsx:144` renders only when `travelTime && travelTime !== '0 min'`. **`travelMode` prop is NEVER passed by ExpandedCardModal** (props block lines 1778-1793 omit it) — even when the pill would render, the icon defaults to `navigate-outline`. | direct file read |
| **Runtime** | `card.travelTime === ''` (because deckService.ts:175 returned empty string) → guard at CardInfoSection:144 fails truthy check → entire pill block skipped. | causal trace from RC-1 |
| **Data** | Saved cards in `saved_card.card_data` JSONB persist whatever travelTime was at save time — likely empty string for any card saved since 2026-04-20. No migration backfill yet. | savedCardsService:43-64 |

**Verdict:** Same root cause as A. The `hideTravelTime` prop is **dead code** — no caller ever passes it (caller-audit Gate 4 grep returned zero matches). The bug is purely empty-data propagation, plus a hidden flaw that the icon prop is never threaded.

---

## 5. Findings

### 🔴 RC-1 — Singles edge-function path returns hardcoded distance/travel-time zeros

| Field | Value |
|-------|-------|
| **File + line** | `supabase/functions/discover-cards/index.ts:530-562` (`transformServablePlaceToCard` function); zeros at L554-L555 |
| **Exact code** | `distanceKm: 0,` <br> `travelTimeMin: 0,` |
| **What it does** | Every card emitted by the signal-serving path (which since ORCH-0634 is **every** category chip) carries `distanceKm = 0` and `travelTimeMin = 0`. Distance Matrix is not called. Haversine is not computed. Travel mode is not consulted. |
| **What it should do** | Compute haversine distance from `userLat/userLng` (resolved from `body.location`) to `row.lat/row.lng`; derive estimated travel-time from `body.travelMode` using the existing pattern from `generate-curated-experiences/index.ts:612-613` (`haversineKm(...)` + `estimateTravelMinutes(distFromUser, travelMode)`). Populate both fields with real values. |
| **Causal chain** | (1) RPC returns lat/lng → (2) `transformServablePlaceToCard` ignores both → (3) edge fn responds `{cards: [{ distanceKm: 0, travelTimeMin: 0, ...}]}` → (4) mobile `unifiedCardToRecommendation` (deckService.ts:151-152) reads `card.distanceKm ?? 0` + `card.travelTimeMin ?? 0` = both `0` → (5) line 174 returns `''` for distance, line 175 returns `''` for travelTime → (6a) SwipeableCards.tsx:2170/2304 hits the `|| t('cards:swipeable.nearby')` fallback (Symptom A); (6b) SwipeableCards.tsx:2172/2306 truthy guard fails so collapsed travel-time badge is suppressed; (6c) ExpandedCardModal.tsx:1785 passes empty string through; (6d) CardInfoSection.tsx:144 truthy guard fails so expanded travel-time pill is suppressed (Symptom B). |
| **Verification** | (a) Direct file read: only one place in `discover-cards/index.ts` ever sets these fields (grep returns lines 554-555 only). (b) MCP probe of `query_servable_places_by_signal('nature', 120, 35.7796, -78.6382, 50000, '{}', 5)` returns 5 rows with valid lat/lng (Williamson Preserve, Umstead, Chainsaw Log, Cabelands Trail, Eno River) — none of which would have distance computed by the current transformer. (c) Bisect: pre-`f1880d93` discover-cards computed haversine at lines 461-462; that commit stripped it. ORCH-0588 (`93d96f32`, 2026-04-20) introduced the hardcoded zeros in a cohort-gated path; ORCH-0634 (`7456b0f3`, 2026-04-22) promoted the signal path to all chips. (d) Curated path (`generate-curated-experiences/index.ts:612-613`) demonstrates the correct pattern. |

**Confidence:** HIGH (proven). All six fields verified.

---

### 🟠 CF-1 — Mobile sentinel-string conversion makes 0 indistinguishable from "missing"

| Field | Value |
|-------|-------|
| **File + line** | `app-mobile/src/services/deckService.ts:151-152, 174-175` |
| **Exact code** | `const distanceKm = card.distanceKm ?? 0;` <br> `const travelTimeMin = card.travelTimeMin ?? 0;` <br> ... <br> `distance: distanceKm > 0 ? \`${distanceKm.toFixed(1)} km\` : '',` <br> `travelTime: travelTimeMin > 0 ? \`${Math.round(travelTimeMin)} min\` : '',` |
| **What it does** | Coerces both `null` and `0` to `0`, then converts `0` to `''`. Three semantically distinct states (missing, zero distance, zero travel time) collapse into one. Constitution #3 silent failure: a real bug (RC-1) cannot be distinguished from a legitimate "no GPS" path. |
| **What it should do** | If the edge function returns honest values, this layer becomes simple: pass the number through; let UI decide rendering. If `distanceKm` could legitimately be missing, encode as `null`, NOT empty string. UI should branch on `null` explicitly. |
| **Causal chain** | RC-1 produces 0 → this layer locks 0 into `''` → all downstream guards check `truthy` instead of `null` → the bug becomes visible as fallback strings rather than as a thrown error or telemetry signal. Without this layer, RC-1 would have surfaced loudly (e.g., "0 min" displayed everywhere) and been caught immediately. |
| **Verification** | Grep `distanceKm > 0 \|\| travelTimeMin > 0` in deckService.ts shows the > 0 sentinel pattern is the only place these are converted. The `?? 0` defensive coercion at line 151-152 was added (per its own comment) for "edge fn may omit them" — the wrong solution; coerce to `null`, not `0`. |

**Confidence:** HIGH (proven).

---

### 🟠 CF-2 — Triple-redundant truthy guards layered across mobile

| Field | Value |
|-------|-------|
| **File + lines** | `app-mobile/src/services/deckService.ts:175` (1st guard) ; `app-mobile/src/components/SwipeableCards.tsx:2172, 2306` (2nd + 3rd guard, current + next card) ; `app-mobile/src/components/expandedCard/CardInfoSection.tsx:144` (4th guard) |
| **Exact code (sample)** | `{currentRec.travelTime && currentRec.travelTime !== '0 min' ? (...) : null}` |
| **What it does** | Four separate locations independently check whether travelTime is "missing" using string-truthiness AND a `!== '0 min'` exclusion. This is a Constitution #2 violation (multiple owners checking the same truth). The "0 min" exclusion exists because `card.timeAway` (deckService.ts:167) ALWAYS produces "0 min" even when travelTimeMin is 0 — so consumers downstream had to defend against it. |
| **What it should do** | One source of truth. Either `travelTime` is a real string ("12 min") or it is `null`. UI checks `if (travelTime != null)`. No "0 min" magic value. |
| **Causal chain** | Adding a "0 min" sentinel at deckService.ts:167 forced every consumer to re-implement the exclusion. Now there are 4+ guards, each with subtle differences (some check `!== '0 min'`, some don't) — bug-fix surface area scales with caller count. |
| **Verification** | `grep -n "!== '0 min'" app-mobile/` returns matches in SwipeableCards.tsx (twice) and CardInfoSection.tsx (once). |

**Confidence:** HIGH (proven).

---

### 🟡 HF-1 — `hideTravelTime` prop is dead code

| Field | Value |
|-------|-------|
| **File + line** | `app-mobile/src/types/expandedCardTypes.ts:264` (definition); `app-mobile/src/components/ExpandedCardModal.tsx:1225, 1785` (consumed) |
| **Exact code** | `hideTravelTime?: boolean;` (type) ; `travelTime={hideTravelTime ? undefined : card.travelTime}` (use) |
| **What it does** | The prop is defined and threaded through the component, but **NO CALLER passes it.** Caller-audit grep (`hideTravelTime=` and `hideTravelTime:`) returns zero matches across the entire mobile codebase. The toggle is structurally inert. |
| **What it should do** | Either delete the prop entirely (subtract before adding — Constitution #8) or document why it exists for a future caller. Currently it obscures the actual root cause: anyone reading line 1785 would assume travel time is "intentionally hideable" and miss that the data itself is empty. |
| **Causal chain** | Misleading code → reviewers/maintainers chase a flag that never fires → the empty `card.travelTime` root cause is harder to spot. Delays diagnosis. |
| **Verification** | `Grep "hideTravelTime=\|hideTravelTime:"` across `app-mobile/` → 0 matches. Definition + consumption in 2 files only. |

**Confidence:** HIGH (proven). Recommend deletion in spec.

---

### 🟡 HF-2 — `travelMode` prop never threaded into CardInfoSection

| Field | Value |
|-------|-------|
| **File + line** | `app-mobile/src/components/ExpandedCardModal.tsx:1778-1793` (call site omits prop); `app-mobile/src/components/expandedCard/CardInfoSection.tsx:18, 48, 146` (prop expected, used in icon selection) |
| **Exact code (call site)** | `<CardInfoSection title={card.title} ... distance={card.distance} travelTime={hideTravelTime ? undefined : card.travelTime} measurementSystem={accountPreferences?.measurementSystem} priceRange={card.priceRange} ... />` — no `travelMode={...}` |
| **Exact code (consumer)** | `<Icon name={getTravelModeIcon(travelMode)} ... />` — `travelMode` is always `undefined` → `getTravelModeIcon` returns default `navigate-outline` |
| **What it does** | Even after RC-1 is fixed and the travel-time pill renders, the icon next to it will be the generic compass arrow, not the user's actual mode (walk shoe, car, bus, bicycle). Functionally hides the travel-mode-awareness ORCH-0392 introduced. |
| **What it should do** | Pass `travelMode={card.travelMode ?? accountPreferences?.travel_mode}` (matching the SwipeableCards.tsx:2173, 2307 pattern). |
| **Causal chain** | The travel-time pill is currently hidden, so the missing icon hasn't surfaced as a complaint. Once RC-1 is fixed, this becomes visible — ship the fix together. |
| **Verification** | Direct file read of both files; grep for `travelMode` across ExpandedCardModal.tsx shows zero pass-throughs to CardInfoSection. |

**Confidence:** HIGH (proven).

---

### 🟡 HF-3 — `card.timeAway` produces "0 min" sentinel diverging from `card.travelTime` empty string

| Field | Value |
|-------|-------|
| **File + line** | `app-mobile/src/services/deckService.ts:167` |
| **Exact code** | `timeAway: \`${Math.round(travelTimeMin)} min\`,` |
| **What it does** | Always produces a non-empty string. When `travelTimeMin = 0`, this field is the literal string `"0 min"`. Meanwhile `card.travelTime` (line 175) is `''` for the same input. Constitution #2 (one owner per truth) violation: same data has two different shapes for "missing." |
| **What it should do** | Single source — pick one field, drop the other, OR have both honestly report `null` when missing. UI consumers should never see "0 min." Constitution #9 (no fabricated data) — "0 min" is a fabrication; the user is not 0 minutes away from the place. |
| **Causal chain** | Components consuming `timeAway` (e.g., curated card preview) might display "0 min walk" today. Components consuming `travelTime` skip rendering. The asymmetry is silent and inconsistent. |
| **Verification** | Grep `card\.timeAway\|currentRec\.timeAway\|nextCard\.timeAway` returns several call sites that may not have `!== '0 min'` guards. Spec needs to inventory these. |

**Confidence:** HIGH (proven).

---

### 🔵 OBS-1 — Curated path is correct (not solo/collab parity gap; singles vs curated gap)

| Field | Value |
|-------|-------|
| **File + line** | `supabase/functions/generate-curated-experiences/index.ts:612-613, 1034-1075` |
| **Exact code** | `const distFromUser = haversineKm(userLat, userLng, lat, lng);` <br> `const travelFromUser = estimateTravelMinutes(distFromUser, travelMode);` |
| **Significance** | The reference implementation is in the SAME monorepo. Curated cards (Romantic, First-Date, Picnic, Adventurous, Stroll, Group-Fun, Take-A-Stroll) carry real distance + travel-time data; the user is NOT seeing "nearby" on those. The bug surface is purely the singles/category path. The fix is portable — copy the helpers (`haversineKm`, `estimateTravelMinutes`) or extract to `_shared/`. |

---

### 🔵 OBS-2 — Saved cards persist stale empty values (backfill concern for spec)

| Field | Value |
|-------|-------|
| **File + line** | `app-mobile/src/services/savedCardsService.ts:67-89` (`saveCard`); `saved_card.card_data` JSONB |
| **Significance** | Cards saved between 2026-04-20 (ORCH-0588 introduction for fine-dining cohort) or 2026-04-22 (ORCH-0634 promotion for all chips) and the eventual fix have empty `distance`/`travelTime` in their persisted JSONB. After the fix, the live deck will show real values, but the Saved tab + scheduled experiences will keep showing "nearby" until either: (a) backfill, or (b) re-save. **Spec must decide** whether to add a backfill migration similar to ORCH-0649's `20260426000004_orch_0649_backfill_saved_card_opening_hours.sql`. Note: distance/travel-time are user-relative — backfill needs the saver's GPS at save-time, which we don't store. So **backfill is impractical**; recommend stale-data graceful degrade (show category card without those pills) plus user-visible "saved at \<date\>" disclaimer. |

---

### 🔵 OBS-3 — No client-side recompute when travel mode changes while card is open

| Field | Value |
|-------|-------|
| **File + line** | `app-mobile/src/hooks/useDeckCards.ts` (deck refetch on prefs invalidation); `app-mobile/src/components/ExpandedCardModal.tsx` (snapshot at render) |
| **Significance** | Currently dormant because the field is empty (no fabricated value displayed). Once RC-1 ships, if a user opens a card showing "12 min walk" and changes their travel mode to "driving" via PreferencesSheet without closing the card, the displayed pill will stay stale until the modal closes and reopens. Constitution #9 fabrication risk. **Spec must address:** either (a) recompute on `travelMode` change while modal open (subscribe to preferences), or (b) close the modal on mode change (UX cost), or (c) mark this an acceptable corner case (likely cheapest — most users don't change mode mid-view). |

---

## 6. Bisect — Last-Known-Working & Break Point

| Date | Commit | What |
|------|--------|------|
| Pre-2026-04 (unknown old date) | < `f1880d93` | `discover-cards` HAD haversine + per-mode travel time computation in the singles path (lines 461-462 set real `distanceKm`/`travelTimeMin`). |
| ?? | `f1880d93` "extract generate-single-cards from discover-cards, strip discover-cards to pool-only" | **Removed haversine + distance computation from discover-cards.** The new singles helper retained it; discover-cards became a pool-pass-through with no distance logic. |
| 2026-04-20 | `93d96f32` (ORCH-0588) | **Introduced `transformServablePlaceToCard` with hardcoded `distanceKm: 0, travelTimeMin: 0`.** Cohort-gated to fine_dining only — bug latent for most users. |
| 2026-04-22 | `7456b0f3` (ORCH-0634) | Promoted signal-serving path to ALL category chips → bug exposed to every user on every category card. |
| 2026-04-23 | (ORCH-0640 cutover) | Demolished the legacy `card_pool` serving path → no fallback exists. Bug entrenched. |

**Last-known-working state for the singles path:** pre-`f1880d93`. Any restoration that mirrors that logic (or the curated reference) is correct.

---

## 7. Blast Radius

| Surface | Affected? | Notes |
|---------|-----------|-------|
| Solo deck — single category cards | ✅ YES (every card, every user) | All 10 chips: Nature, Casual, Brunch, Drinks, Fine Dining, Movies, Theatre, Creative Arts, Play, Icebreakers |
| Solo deck — curated cards | ❌ NO | `generate-curated-experiences` computes correctly |
| Collab deck — single category cards | ✅ YES (same code path; deckService.ts is shared) | Same root cause |
| Collab deck — curated cards | ❌ NO | Same as solo curated |
| Saved tab — historical cards | ⚠️ PARTIALLY | Cards saved since 2026-04-20 carry empty values; pre-2026-04-20 saved cards may have real values from the old path |
| Calendar tab — scheduled cards | ⚠️ PARTIALLY | Same as saved tab |
| Curated stop browser | ❌ NO | Curated stops always carry distance |

**Severity escalation candidate:** This is currently filed S1, but every deck-rendered single category card for every user has been silently displaying placeholder text since 2026-04-22 (3+ days, longer if signal-serving was already on for fine_dining). The orchestrator should consider whether this rises to **S0 launch-blocker** given launch-readiness work — a placeholder string in the most-visited UI element on the home screen damages perceived product quality. **Recommend orchestrator re-triage to S0.**

---

## 8. Invariant Violations & Candidates

| Invariant | Status | Evidence |
|-----------|--------|----------|
| **Constitution #2** (one owner per truth) | VIOLATED | `card.timeAway` (line 167) and `card.travelTime` (line 175) both encode "travel time" with different sentinels. CF-2 quadruple-guard check is the downstream cost. |
| **Constitution #3** (no silent failures) | VIOLATED | RC-1 + CF-1 chain converts a backend bug (zero distance) into a silent UI fallback ("nearby") with no telemetry, no error log, no warning. The user sees the bug; the system does not. |
| **Constitution #8** (subtract before adding) | OPPORTUNITY | HF-1 dead-code `hideTravelTime` prop should be deleted in the fix. |
| **Constitution #9** (no fabricated data) | VIOLATED & FUTURE-RISK | "0 min" sentinel from HF-3 is a fabrication. OBS-3 stale travel-time on mode-change post-fix is a future fabrication risk. |
| **I-NO-FABRICATED-DISPLAY-N/A** (registered ORCH-0649) | RELATED | "nearby" + "0 min" are display sentinels of the same family as "N/A". Consider extending the CI gate (`scripts/ci-check-invariants.sh`) to flag `\|\| t\('cards:swipeable\.nearby'\)` and `!== '0 min'` patterns. |
| **NEW INVARIANT CANDIDATE: I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME** | NEW | Every card emitted by any deck-serving edge function MUST carry real (haversine-min) `distanceKm` AND real `travelTimeMin` (per the user's selected travel mode), OR explicitly `null`. Never `0` as a sentinel for "missing." Mobile UI MUST branch on `null`, never on truthy/falsy of empty strings. |

---

## 9. Fix Strategy (direction only — not a spec)

**Layer 1 — Edge function (primary fix, single layer):**
- In `supabase/functions/discover-cards/index.ts`, before or inside `transformServablePlaceToCard`:
  - Receive `userLat`, `userLng`, `travelMode` (already available in the handler scope from `body.location` + `body.travelMode`)
  - Compute `distFromUser = haversineKm(userLat, userLng, row.lat, row.lng)`
  - Compute `travelFromUser = estimateTravelMinutes(distFromUser, travelMode)`
  - Set `distanceKm: Math.round(distFromUser * 100) / 100` (matches curated rounding)
  - Set `travelTimeMin: Math.round(travelFromUser)` (matches curated rounding)
- Extract `haversineKm` + `estimateTravelMinutes` to `supabase/functions/_shared/distanceMath.ts` (DRY — both edge fns currently inline). Constitution #2 single owner.
- If `userLat/userLng` unavailable (rare — pool-empty path or auth-required): set both fields to `null` (NOT 0). Mobile renders an "unknown distance" state.

**Layer 2 — Mobile contract tightening (defensive):**
- `deckService.ts:151-152, 174-175, 167`: convert all four locations to honest `null` propagation. `card.distanceKm ?? null`. `card.travelTimeMin ?? null`. `distance: distanceKm != null ? \`${distanceKm.toFixed(1)} km\` : null`. Drop the `card.timeAway` field entirely (HF-3) — single owner.
- `SwipeableCards.tsx:2170, 2304`: `parseAndFormatDistance(currentRec.distance, ...) ?? <UnknownDistanceLabel/>`. Define what the unknown label is — likely a soft state ("Distance unavailable" or just hide the badge) — but never the misleading "nearby."
- `SwipeableCards.tsx:2172, 2306`: drop `&& currentRec.travelTime !== '0 min'`; rely on `null` check.
- `CardInfoSection.tsx:144`: same drop.

**Layer 3 — Hidden flaw cleanups bundled:**
- Delete `hideTravelTime` prop entirely (HF-1).
- Pass `travelMode={card.travelMode ?? accountPreferences?.travel_mode}` from ExpandedCardModal to CardInfoSection (HF-2). Mirror SwipeableCards.tsx:2173/2307 pattern.

**Layer 4 — Deferred / spec-decision:**
- OBS-2 saved-card backfill: recommend NO backfill (distance is user-relative; we don't have the saver's GPS at save time). Instead spec a graceful degrade for cards with null distance/travelTime.
- OBS-3 mode-change recompute: defer to a follow-up — most users don't change mode mid-view. Mark as accepted corner case OR require a `useTravelMode()` subscription in ExpandedCardModal.

**Layer 5 — Regression prevention:**
- Add CI grep gate to `scripts/ci-check-invariants.sh`:
  - Flag `distanceKm: 0` literal in any edge fn
  - Flag `travelTimeMin: 0` literal in any edge fn
  - Flag `\|\| t\('cards:swipeable\.nearby'\)` pattern (only the deckService null-check should produce this fallback string, and only inside a labeled branch)
- Register new invariant **I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME** in `INVARIANT_REGISTRY.md`.
- Add a tester behavioral case: live-fire `discover-cards` at Raleigh with 4 different travel modes; assert distanceKm > 0 AND travelTimeMin matches mode multiplier (walking ≈ 12 min/km, driving ≈ 1.0 min/km, transit/biking interpolated).

---

## 10. Discoveries for Orchestrator

- **ORCH-0659.D-1 (P3) — Saved-card backfill impracticality:** distance is user-relative; we don't store the saver's GPS at save time. Recommend graceful degrade for null fields; no migration backfill possible.
- **ORCH-0659.D-2 (P3) — Travel-mode reactivity (OBS-3):** post-fix, opening a card and changing travel mode mid-view shows stale travel time. Defer or require subscription. File as separate ticket if user wants the corner case fixed.
- **ORCH-0660.D-1 (P3) — `hideTravelTime` dead prop (HF-1):** structurally inert; bundle deletion into the spec.
- **ORCH-0660.D-2 (P2) — `travelMode` prop missing in ExpandedCardModal → CardInfoSection (HF-2):** even after the data fix, icon defaults to compass instead of mode-matching icon. Bundle into the spec.
- **ORCH-0659.D-3 (P2) — Severity escalation candidate:** every deck single-category card affected; recommend orchestrator re-triage as S0 given launch-readiness focus.

---

## 11. Confidence Level — HIGH

- RC-1: **PROVEN.** Six-field evidence; direct file read; MCP runtime probe; bisect proven via `git log -S` and `git show`.
- CF-1, CF-2: **PROVEN.** Direct file reads, grep counts.
- HF-1: **PROVEN.** Caller-audit grep returned zero matches.
- HF-2, HF-3: **PROVEN.** Direct file reads.
- OBS-1: **PROVEN.** Direct file read of `generate-curated-experiences/index.ts`.
- OBS-2: **PROVEN.** Direct file read of `savedCardsService.ts`.
- OBS-3: **PROBABLE.** Architecture inference; not directly tested on device (requires runtime smoke).

---

**Investigation complete. READY FOR SPEC.**
