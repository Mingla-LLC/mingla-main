# Investigation: Picnic Park / Nature & Views Exclusivity + Picnic Date Pipeline (ORCH-0429)

**Date:** 2026-04-14
**Confidence:** HIGH — data queried, all code paths traced, GPT prompt root cause proven

---

## Layman Summary

"Picnic Park" and "Nature & Views" show identical places because the GPT prompt literally
tells the AI: "Parks with grass also get picnic_park. Almost always paired with nature_views."
So GPT obediently dual-tags 7,626 places. The two decks are mirrors of each other.

The good news: picnic dates ARE a fully-built multi-stop experience in the system — the
curated experience generator creates Grocery → Flowers (optional) → Park cards with AI
shopping lists. The problem is that Picnic Park as a standalone single-card category is
redundant with Nature & Views because of the dual-tagging.

The data split is very clean: **78% can be resolved deterministically** by primary_type.
Parks and city parks → picnic. Hiking areas, beaches, botanical gardens, scenic spots →
nature. Only ~1,500 places need GPT judgment.

---

## Part A: Data Split Analysis

### Primary Type Breakdown (7,626 dual-tagged places)

| Primary Type | Count | Deterministic Assignment | Reasoning |
|-------------|-------|------------------------|-----------|
| `park` | 5,089 | **picnic_park** | Generic parks — most have lawns for blankets |
| `city_park` | 778 | **picnic_park** | Urban parks — designed for recreation, lawns |
| `picnic_ground` | 80 | **picnic_park** | Self-explanatory |
| **Subtotal: picnic wins** | **5,947** | | **78% of all dual-tagged** |
| `hiking_area` | 285 | **nature_views** | Trails — you hike, not picnic |
| `state_park` | 181 | **nature_views** | Large preserves — scenic, not lawn-focused |
| `nature_preserve` | 126 | **nature_views** | Protected land — scenic, no blankets |
| `botanical_garden` | 69 | **nature_views** | Curated gardens — scenic walks |
| `scenic_spot` | 66 | **nature_views** | Viewpoints — no lawns |
| `lake` | 47 | **nature_views** | Water body — scenic |
| `beach` | 34 | **nature_views** | Sand — scenic, not lawn picnic |
| `observation_deck` | 19 | **nature_views** | Elevated viewpoint |
| `national_park` | 9 | **nature_views** | Wilderness — scenic |
| `wildlife_park` | 6 | **nature_views** | Animal preserve |
| `wildlife_refuge` | 4 | **nature_views** | Animal preserve |
| `river` | 2 | **nature_views** | Water body |
| `marina` | 2 | **nature_views** | Harbor/waterfront |
| **Subtotal: nature wins** | **850** | | **11% of all dual-tagged** |
| `garden` | 542 | **AMBIGUOUS** | Could be scenic garden or lawn garden |
| `tourist_attraction` | 135 | **AMBIGUOUS** | Could be anything |
| `NULL` | 26 | **AMBIGUOUS** | No type from Google |
| `historical_landmark` | 19 | **nature_views** (likely) | Landmarks = scenic |
| `plaza` | 12 | **AMBIGUOUS** | Some have lawns, some don't |
| `farm` | 10 | **nature_views** (likely) | Agricultural — scenic |
| `sculpture` | 10 | **nature_views** (likely) | Art installation — scenic |
| Misc (event_venue, community_center, restaurant, etc.) | ~75 | **AMBIGUOUS** | Various |
| **Subtotal: ambiguous** | **~829** | | **~11% of all dual-tagged** |

### Summary

| Category | Count | % | Resolution |
|----------|-------|---|-----------|
| Deterministic: picnic wins | 5,947 | 78% | Strip nature_views |
| Deterministic: nature wins | 850 | 11% | Strip picnic_park |
| Ambiguous | ~829 | 11% | Default to nature_views (safer — scenic is broader) |
| **Total** | **7,626** | **100%** | |

**Recommendation:** For the ~829 ambiguous places, default to **nature_views** (strip
picnic_park). Reasoning: nature_views is the broader, safer category. A `garden` or
`tourist_attraction` is more likely to be a scenic spot than a picnic lawn. The ambiguous
places can be re-evaluated later with a targeted AI re-run if needed.

This means **100% can be resolved deterministically** — no GPT re-run needed.

---

## Part B: Picnic Date Pipeline

### How Picnic Dates Actually Work

The picnic date system is **fully built and functional**. Here's the chain:

**1. Single cards (generate-single-cards):**
- Creates one card per place tagged `picnic_park`
- These are just park cards — "here's a park"
- No food component, no shopping list
- Used for the standalone Picnic Park swipe deck

**2. Curated experiences (generate-curated-experiences):**
- Creates multi-stop picnic dates: **Grocery → Flowers (optional) → Park**
- Uses **reverse-anchor**: finds the park FIRST, then queries grocery stores within 3km
- Generates an AI shopping list via OpenAI (or falls back to a static list with emojis)
- Duration: 20 min shopping + travel + 75 min at park
- This is a fully-realized date experience with stops, timeline, and shopping list

**3. Client display (curatedToTimeline.ts):**
- Converts the curated stops into a visual timeline
- Shows "Start Here" → grocery, "Then" → flowers, "End With" → park
- Travel segments between stops

### The Problem

The issue is NOT that picnic dates are broken. The curated multi-stop picnic experience
works great. The problem is the **standalone Picnic Park category in the swipe deck**:

- It shows the same parks as Nature & Views (96% overlap)
- A single park card is just "here's a park" — no food, no shopping list
- It doesn't feel like a "picnic date" — it's just nature with a different label
- Users selecting Picnic Park in preferences expect picnic-specific content but get generic parks

### What Makes a Picnic Card Different From a Nature Card

**Currently: nothing.** The same park gets a card in both categories. The only difference
is the curated multi-stop experience, which is a separate system from the single-card deck.

---

## Part C: GPT Prompt Root Cause

### 🔴 Root Cause: GPT prompt explicitly instructs dual-tagging

**File:** `ai-verify-pipeline/index.ts:141-143`
**Code:**
```
NATURE_VIEWS: Parks, trails, beaches, botanical gardens, scenic viewpoints, observation decks, waterfronts, bridges, harbors, nature preserves. Parks with grass also get picnic_park.

PICNIC_PARK: Parks with open lawns where you can lay a blanket. Almost always paired with nature_views.
```

**What it does:** Tells GPT that picnic_park and nature_views should almost always coexist.
**What it should do:** Tell GPT they are mutually exclusive with clear criteria for each.
**Causal chain:** GPT reads "Almost always paired with nature_views" → dual-tags 96% of parks → both decks show identical content → user sees repetition.

### 🟠 Contributing Factor: No exclusivity enforcement in pipeline

Same pattern as ORCH-0428. The `enforceExclusivity()` function exists for fine_dining/casual_eats
but no equivalent for picnic_park/nature_views. Even if GPT stops dual-tagging, old data
and edge cases would still allow both.

---

## Fix Strategy (Direction Only)

### Phase 1: Deterministic data cleanup (free, instant)

SQL queries to split the 7,626 places:
1. `park`, `city_park`, `picnic_ground` → strip nature_views, keep picnic_park
2. `hiking_area`, `state_park`, `nature_preserve`, `botanical_garden`, `scenic_spot`,
   `lake`, `beach`, `observation_deck`, `national_park`, `wildlife_park`, `wildlife_refuge`,
   `river`, `marina` → strip picnic_park, keep nature_views
3. Everything else (garden, tourist_attraction, NULL, etc.) → strip picnic_park, keep nature_views (default to nature)

### Phase 2: Pipeline enforcement

1. Extend `enforceExclusivity()` to also handle picnic_park/nature_views
2. Decision rule: if both present, use primary_type to pick the winner (same rules as above)
3. For types not in the deterministic list, default to nature_views

### Phase 3: GPT prompt update

1. Rewrite NATURE_VIEWS definition: scenic spots for walks and views — trails, beaches,
   botanical gardens, viewpoints, observation decks, waterfronts, harbors, nature preserves.
   NOT parks with lawns (those are picnic_park).
2. Rewrite PICNIC_PARK definition: parks with open grass/lawns where you can lay a blanket.
   Generic parks, city parks, picnic grounds. NOT scenic viewpoints, trails, or beaches.
3. Add: "IMPORTANT: picnic_park and nature_views are MUTUALLY EXCLUSIVE."
4. Add worked examples showing the split.

---

## Blast Radius

| What changes | Impact |
|-------------|--------|
| Picnic Park deck | Becomes distinct — only lawn parks, no hiking trails or beaches |
| Nature & Views deck | Loses ~5,947 generic parks, keeps scenic spots, trails, beaches |
| Curated picnic experiences | Unaffected — they use the picnic_park tag to find parks, which still exist |
| Single picnic cards | Now exclusively lawn parks — feels more intentional |
| User preferences | Users who selected ONLY nature_views lose generic parks. Users who selected ONLY picnic_park gain a distinct deck. |

**Risk:** Nature & Views deck shrinks significantly (from ~8,400 to ~2,500). But the
remaining content is higher quality — scenic spots, not generic city parks.

---

## Discoveries for Orchestrator

1. **The curated picnic experience system is well-built** — reverse-anchor grocery finding,
   AI shopping lists, multi-stop timeline. No fixes needed there.
2. **Nature & Views deck will shrink from ~8,400 to ~2,500** after the split. This may feel
   thin in some cities. Monitor after deployment.
3. **The `garden` type (542 places) is the biggest ambiguity.** Some gardens are picnic-worthy
   (Central Park gardens), others are purely scenic (botanical gardens are already handled).
   Defaulting to nature_views is safe but could be revisited.
