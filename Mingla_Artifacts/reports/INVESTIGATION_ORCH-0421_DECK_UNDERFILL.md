# Investigation Report: Deck Severely Underfilled Across All Categories (ORCH-0421)

> Date: 2026-04-14
> Source: User report + Orchestrator dispatch
> Confidence: H — root cause proven with production SQL data across all 13 categories
> Status: root cause proven

---

## 1. Layman Summary

When you browse cards, the app asks the database for up to 200 cards but the price filter
throws away the vast majority before you ever see them. For Nature & Views, 609 cards exist
near Raleigh but only 8 survive the "comfy + bougie" price filter because 98.7% of nature
places are free/cheap ("chill" tier). This isn't a bug in the traditional sense — it's a
structural design flaw where price preferences meant for restaurants and bars are applied
identically to parks, trails, and gardens where price is meaningless. The same pattern hits
10 of 13 categories to varying degrees, with Nature, Picnic Park, and Watch being effectively
wiped out.

---

## 2. Symptom

- **Expected behavior:** Selecting "Nature & Views" returns a full deck of cards (dozens to hundreds)
- **Actual behavior:** Only 5 cards returned out of 200 requested
- **Reproduction:** Always — select Nature & Views with comfy+bougie price preferences in Raleigh area
- **Affected flow:** Discovery (deck swipe) — solo and collab mode
- **Affected surface:** Mobile (primary), Admin analytics (secondary — distorted engagement metrics)

---

## 3. Investigation Manifest

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `app-mobile/src/contexts/RecommendationsContext.tsx` | Context | Where priceTiers are resolved from user prefs |
| 2 | `app-mobile/src/hooks/useDeckCards.ts` | Hook | Where deck query is built with priceTiers |
| 3 | `app-mobile/src/services/deckService.ts` | Service | Where discover-cards edge function is called |
| 4 | `supabase/functions/discover-cards/index.ts` | Edge Function | Where priceTiers are passed to pool pipeline |
| 5 | `supabase/functions/_shared/cardPoolService.ts` | Shared Service | Where queryPoolCards RPC is called |
| 6 | `supabase/migrations/20260412400001_phase6_dead_code_cleanup.sql` | SQL RPC | Latest `query_pool_cards` definition — the hard filter |
| 7 | `supabase/functions/_shared/scoringService.ts` | Shared Service | Confirmed scoring uses priceTiers for ranking only, not filtering |

---

## 4. Five-Layer Cross-Check

| Layer | What It Says | Matches Reality? |
|-------|-------------|-----------------|
| Docs | No product doc specifies that nature should be exempt from price filtering. The comment in discover-cards says "User's price tier selection (via preferences) is the only price filter that applies" — implies uniform application. | Y — docs are silent on exemptions |
| Schema | `card_pool.price_tier` is nullable TEXT. No constraint enforces non-null. The RPC `query_pool_cards` uses `cp.price_tier = ANY(p_price_tiers)` which silently excludes NULLs. | N — schema allows NULL but query treats NULL as "no match" |
| Code | No category-aware price logic exists anywhere in the chain. `priceTiers` flows unchanged from user prefs → context → hook → service → edge function → RPC. | Y — code is consistent (uniformly wrong) |
| Runtime | Logs show `priceTiers: ["comfy","bougie"]` sent to discover-cards. Pool returns 5 cards. | Y — runtime matches code behavior |
| Data | 609 nature_views cards exist in Raleigh geo box. 98.7% are chill/NULL. Only 8 match comfy+bougie. | N — data distribution makes the filter structurally destructive for nature |

**Contradictions found:** Schema allows NULL price_tier (reasonable for free venues), but the SQL query treats NULL as "doesn't match any tier" — silently excluding 24 nature cards and 193 cards across all categories that have no price data. Additionally, the data distribution for nature/picnic/watch categories is structurally incompatible with a comfy+bougie preference filter.

---

## 5. Findings

### 🔴 Root Cause

**RC-1: Price tier filter applied uniformly to all categories regardless of price relevance**

- **File:** `supabase/migrations/20260412400001_phase6_dead_code_cleanup.sql`, lines 129-133
- **Code:**
```sql
AND (
  v_any_tier
  OR (v_use_tiers AND cp.price_tier = ANY(p_price_tiers))
  OR (NOT v_use_tiers AND cp.price_min <= p_budget_max)
)
```
- **What it does:** When `p_price_tiers` is non-empty (e.g., `["comfy","bougie"]`), requires every card's `price_tier` to be one of those values. Applies identically to all 13 categories. NULL price_tier cards are always excluded (SQL `NULL = ANY(array)` evaluates to NULL/false).
- **What it should do:** For categories where price is structurally irrelevant (nature, picnic, etc.), cards should NOT be filtered by price tier. For all categories, NULL price_tier should be treated as "matches any tier" rather than "matches nothing."
- **Causal chain:**
  1. User has saved preferences `price_tiers: ["comfy","bougie"]`
  2. Client sends `priceTiers: ["comfy","bougie"]` to discover-cards (line 279 of deckService.ts)
  3. Edge function passes to `serveCardsFromPipeline` → `queryPoolCards` → `query_pool_cards` RPC
  4. RPC sets `v_use_tiers = true` and filters `cp.price_tier = ANY('{"comfy","bougie"}')`
  5. 98.7% of nature_views cards have `price_tier = 'chill'` → excluded
  6. 3.9% have `price_tier = NULL` → also excluded (NULL != ANY(...) is NULL/falsy)
  7. Only 1.3% (8 of 609 in Raleigh) survive the filter
  8. After additional geo/haversine filtering, 5 reach the user
- **Verification:** Run `query_pool_cards` with `ARRAY[]::text[]` for price tiers → 200 cards returned. Run with `ARRAY['comfy','bougie']` → 9 cards. Delta = 191 cards lost to price filter alone.
- **Invariant violated:** None formally defined, but this violates the principle that price preferences should refine results, not eliminate entire categories.

### 🟠 Contributing Factors

**CF-1: NULL price_tier treated as "no match" instead of "unknown/any"**

- **File:** Same SQL RPC, line 131
- **Code:** `v_use_tiers AND cp.price_tier = ANY(p_price_tiers)`
- **Why it contributes:** SQL `NULL = ANY(array)` returns NULL (falsy). Cards with no price data are silently excluded regardless of what tiers the user selected. This affects 193 cards across all categories (see data below). For wellness alone, 53 cards have NULL price_tier.
- **Severity if root cause is fixed:** Still matters — even if nature is exempted from price filtering, other categories with NULL price_tier cards still lose them silently.

**CF-2: Opening hours filter runs AFTER price filter on already-decimated set**

- **File:** `supabase/functions/discover-cards/index.ts`, line 595
- **Code:** `const timeFilteredCards = filterByDateTime(poolResult.cards, ...)`
- **Why it contributes:** At 10:30 PM Saturday, this filter drops additional cards from the already-tiny set. For nature specifically, parks are in `ALWAYS_OPEN_TYPES` so they survive, but for other categories (restaurants, museums, shops), late-night browsing further reduces the deck. The compounding effect means the user sees even fewer cards than the price filter alone would produce.
- **Severity if root cause is fixed:** Moderate — this is a legitimate filter but its impact is amplified when the input set is already small.

**CF-3: Wellness category has critically low AI approval coverage (44%)**

- **File:** `place_pool.ai_approved` column
- **Why it contributes:** 147 of 264 wellness cards have `ai_approved = false/NULL`. In Raleigh, only 41 of 98 geo-matched wellness cards pass the AI gate. Combined with price filter, wellness drops from 98 → 14 cards (86% loss).
- **Severity if root cause is fixed:** Independent issue — AI validation pipeline hasn't fully covered wellness places.

### 🟡 Hidden Flaws

**HF-1: Multi-category queries return cards from unrequested categories**

- **File:** `query_pool_cards` RPC, line 177: `cp.categories && v_slug_categories`
- **Risk:** When requesting Nature + Drink, the result includes casual_eats, play, flowers cards because those cards have `nature_views` or `drink` in their `categories` array but a different PRIMARY `category`. The per_category_cap is applied on `cp.category` (primary), not on the requested categories. This means the cap doesn't protect against category leakage — 74 casual_eats cards appeared in a Nature+Drink query.
- **Recommended fix:** This may be intentional (multi-category cards surfacing), but the user should understand this behavior. Flag for specer to decide.
- **Priority:** Track as debt — not causing the underfill, but produces unexpected deck composition.

**HF-2: Picnic Park has only 1 card globally**

- **Risk:** Any user selecting Picnic Park gets 0-1 cards regardless of filters. This is a data completeness issue, not a code bug, but the user experience is empty deck.
- **Priority:** Data pipeline issue — needs admin attention to seed picnic_park.

### 🔵 Observations

**OB-1: AI approval coverage is excellent for most categories (95%+)**

The AI approval gate (H3 in orchestrator hypothesis) is NOT a significant factor for most categories. Coverage: casual_eats 97%, creative_arts 91%, drink 100%, fine_dining 100%, first_meet 99%, nature_views 99%, live_performance 98%. Only wellness (44%) and play (82%) have meaningful gaps.

**OB-2: 97% of nature_views cards are multi-category (also tagged picnic_park)**

1,607 of 1,668 nature_views cards also belong to picnic_park. This means picnic_park queries would theoretically return many cards IF those cards had `category = 'picnic_park'` as primary. But only 1 card has `picnic_park` as its primary category — the rest are `nature_views` primary with picnic_park secondary. This is a categorization artifact.

---

## 6. Static Analysis Flags

| Flag | File | Issue | Severity |
|------|------|-------|----------|
| NULL handling | `query_pool_cards` RPC line 131 | `price_tier = ANY(...)` silently excludes NULL rows — known Supabase NULL pattern | H |
| No category-aware filtering | `cardPoolService.ts` line 164 | `priceTiers` passed as-is, no per-category adjustment | M |

---

## 7. Security Findings

No security issues found. The price filter is overly restrictive but does not expose data.

---

## 8. Pattern Compliance

| File | Pattern Check | Compliant? | Notes |
|------|--------------|-----------|-------|
| `query_pool_cards` RPC | NULL-safe filtering | N | Violates the documented `.neq()` NULL pattern — same class of bug |
| `cardPoolService.ts` | Parameter passthrough | Y | Consistent with the (broken) design — no special cases |
| `discover-cards/index.ts` | Filter ordering | Y | Price filter in SQL, then hours in JS — consistent layering |

---

## 9. Blast Radius

- **Other flows affected:** Collab mode deck (same pipeline, same filters), prefetch on auth (same params), session deck (uses sessionDeckService — separate path, needs independent check)
- **Solo/collab parity:** Both affected identically. Collab aggregates group price tiers, but the same SQL filter applies.
- **Admin surface:** Not directly affected, but Pool Intelligence metrics may show misleadingly low "served" counts due to price filtering
- **Query keys involved:** `deck-cards` (includes priceTiers in key — different tiers produce different cache entries)
- **Invariants violated:** No formally registered invariant, but violates the user expectation that selecting a category produces a meaningful number of cards
- **Recurring pattern?** YES — this is the same NULL-exclusion pattern documented in MEMORY.md for `.neq()` on nullable columns. `NULL = ANY(array)` is the same class as `NULL != value`.

---

## 10. Per-Category Impact Data (Raleigh Geo Box)

### Price Tier Distribution (Global)

| Category | Total | chill | comfy | bougie | lavish | NULL | % comfy+bougie |
|----------|-------|-------|-------|--------|--------|------|---------------|
| nature_views | 1,668 | 1,632 | 12 | 0 | 0 | 24 | **0.7%** |
| picnic_park | 1 | 1 | 0 | 0 | 0 | 0 | **0.0%** |
| watch | 53 | 49 | 2 | 1 | 0 | 1 | **5.7%** |
| live_performance | 238 | 201 | 29 | 2 | 1 | 5 | **13.0%** |
| creative_arts | 449 | 393 | 43 | 3 | 0 | 10 | **10.2%** |
| first_meet | 1,188 | 808 | 305 | 5 | 1 | 69 | **26.1%** |
| drink | 750 | 501 | 204 | 19 | 2 | 24 | **29.7%** |
| play | 155 | 97 | 50 | 3 | 0 | 5 | **34.2%** |
| wellness | 264 | 117 | 90 | 3 | 1 | 53 | **35.2%** |
| casual_eats | 3,009 | 1,390 | 1,554 | 40 | 4 | 21 | **52.9%** |
| fine_dining | 162 | 24 | 30 | 68 | 40 | 0 | **60.5%** |
| flowers | 12 | 4 | 7 | 0 | 0 | 1 | **58.3%** |
| groceries | 188 | 98 | 58 | 22 | 0 | 10 | **42.6%** |

### Cascade Filter (Raleigh Geo Box, comfy+bougie)

| Category | In Geo Box | After Price | After AI | After Both | % Lost to Price |
|----------|-----------|-------------|----------|------------|----------------|
| **nature_views** | **609** | **8** | **599** | **7** | **98.7%** |
| **picnic_park** | **1** | **0** | **1** | **0** | **100.0%** |
| **watch** | **22** | **3** | **18** | **2** | **86.4%** |
| creative_arts | 142 | 32 | 123 | 14 | 77.5% |
| live_performance | 97 | 26 | 95 | 25 | 73.2% |
| first_meet | 558 | 113 | 553 | 111 | 79.7% |
| drink | 278 | 84 | 278 | 84 | 69.8% |
| wellness | 98 | 61 | 41 | 14 | 37.8% + 57.1% AI |
| play | 76 | 31 | 65 | 28 | 59.2% |
| casual_eats | 1,483 | 711 | 1,420 | 695 | 52.1% |
| fine_dining | 51 | 33 | 51 | 33 | 35.3% |
| flowers | 10 | 7 | 8 | 5 | 30.0% |
| groceries | 117 | 40 | 110 | 37 | 65.8% |

### Simulated RPC Results (comfy+bougie vs no price filter)

| Query | With Price Filter | Without Price Filter | Delta |
|-------|------------------|---------------------|-------|
| Nature only | 9 | 200 (capped) | **-191 (95.5%)** |
| Nature + Drink | 150 (nature: 7, drink: 67, leakage: 76) | 200 (nature: 64, drink: 63, others: 73) | nature specifically: **-89%** |
| Nature + Casual + Drink | 162 (nature: 7, casual: 67, drink: 67, others: 21) | 200 (balanced) | nature: **-89%** |
| All 12 categories | 151 (nature: 7, watch: 2, flowers: 5) | 200 | nature: **-96%**, 5 categories under 17 |

### Multi-Category Interaction

When Nature is combined with price-compatible categories (Drink, Casual Eats), those categories fill the deck and nature is marginalized. The per_category_cap (`CEIL(limit/num_categories)`) doesn't help because nature has so few surviving cards it never reaches the cap.

Example: Nature + Drink with comfy+bougie → 150 cards total. Looks healthy. But only **7 are nature** (4.7%) vs **67 drink** (44.7%). Nature is a ghost category — present in name, absent in deck.

---

## 11. Categories That Are "Price-Irrelevant"

Categories where price tier filtering is structurally inappropriate because the majority of places are inherently free/cheap:

| Category | % chill/NULL | Rationale |
|----------|-------------|-----------|
| **nature_views** | **99.3%** | Parks, trails, gardens, scenic spots — overwhelmingly free |
| **picnic_park** | **100%** | Picnic grounds are free by definition |
| **watch** | **94.3%** | Movie theaters — price is ticket-based, not tier-based |
| **creative_arts** | **89.8%** | Museums, galleries — many are free or donation-based |
| **live_performance** | **86.6%** | Venues — price is event-dependent, not venue-tier |

---

## 12. Fix Strategy (Direction Only)

- **Database (SQL RPC):** The `query_pool_cards` function needs category-aware price tier logic. Two possible directions: (a) define a set of "price-exempt" categories that bypass price filtering entirely, or (b) treat NULL price_tier as "matches any tier" globally and add per-category exemptions for the most affected categories.
- **Edge functions:** No changes needed — the filter lives in the RPC.
- **Services:** No changes needed — passthrough is correct.
- **Hooks/Components:** No changes needed.
- **Data:** Run AI validation on remaining wellness places (147 unapproved). Seed more picnic_park cards.

---

## 13. Regression Prevention Requirements

- **Structural safeguard:** Category-aware price filtering in SQL prevents future categories from being silently decimated
- **Test requirement:** For every category, verify that `query_pool_cards` with the most restrictive price filter still returns > 0 cards. Any category returning 0 is a data alert.
- **Protective comment:** SQL RPC must document which categories are price-exempt and why

---

## 14. Discoveries for Orchestrator

- **DISC-1:** Wellness AI approval coverage is 44% (117/264 globally, 41/98 in Raleigh). Estimated severity: S2. Recommend: run AI validation pipeline on wellness places.
- **DISC-2:** Picnic Park has only 1 card globally. Estimated severity: S2. Recommend: admin seed pipeline for picnic_park category.
- **DISC-3:** Multi-category queries return cards from unrequested categories due to `categories && v_slug_categories` array overlap. Not a bug per se, but produces unexpected deck composition. Estimated severity: S3. Recommend: document intended behavior or add primary-category gating.

---

## 15. Recommended Next Step

**Write spec.** Root cause is proven with production data. The fix direction is clear: category-aware price tier exemption in the SQL RPC + NULL-safe handling. The specer should define exactly which categories are exempt, the SQL changes, and the test criteria.
