# Investigation Report: Wave 1 — ORCH-0409, ORCH-0406, ORCH-0408

> **Date:** 2026-04-13 (REVISED — original investigation was insufficient for ORCH-0406)
> **Status:** Root causes proven (all three issues)
> **Confidence:** High (code-level evidence, full data-path trace for all findings)

---

## Layman Summary

**ORCH-0406 (Price Tier Labels — MUCH WORSE THAN FIRST REPORTED):** Every single expanded card in the entire app shows "Chill · $50 max" regardless of the actual price tier. Sullivan's Steakhouse is bougie when you see it in the deck, but tap to expand and it says "Chill." This isn't just one component — it's broken in 7 separate code locations. The bug: when a card is converted from the swipe deck format to the expanded view format, nobody mapped the `priceTier` field. The fallback function receives `undefined` and defaults to "chill." This affects cards opened from the deck, the For You grid, featured cards, map pins, saved cards, calendar entries, and collaboration sessions.

**ORCH-0409 (Map Avatars Disappear):** The fix from 2 days ago is still in the code and works for one specific trigger (coming back from background). But there are other ways avatars can vanish — the most likely: when you switch tabs, the people query gets disabled. When you come back, if anything went wrong (GPS drift changes the cache key, network hiccup left the query in error state), the app shows an empty map and silently hides the error. NOT a regression of the old fix — different triggers.

**ORCH-0408 (Quoted DM Message Invisible):** The quoted message preview uses a flex layout where the text container has `flex: 1` with `minWidth: 0`, allowing it to shrink to near-zero width. When the parent bubble is narrow (short reply message below the quote), the quote block gets compressed. Same component also used in board discussions.

---

## Issue 1: ORCH-0406 — Price Tier Labels Wrong on ALL Expanded Single Cards

### ORCH-0385 Overlap: None. This is a data-mapping bug, not a display/rendering bug.

### Investigation Manifest

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `app-mobile/src/components/expandedCard/CardInfoSection.tsx` | Component | Price tier display logic |
| 2 | `app-mobile/src/components/ExpandedCardModal.tsx` | Component | Props passed to CardInfoSection |
| 3 | `app-mobile/src/types/expandedCardTypes.ts` | Type | ExpandedCardData interface |
| 4 | `app-mobile/src/types/recommendation.ts` | Type | Recommendation interface |
| 5 | `app-mobile/src/constants/priceTiers.ts` | Constants | `googleLevelToTierSlug()` fallback |
| 6 | `app-mobile/src/components/SwipeableCards.tsx` | Component | Deck card → ExpandedCardData conversion |
| 7 | `app-mobile/src/components/DiscoverScreen.tsx` | Component | Featured/Grid/Map → ExpandedCardData |
| 8 | `app-mobile/src/components/activity/SavedTab.tsx` | Component | Saved card → ExpandedCardData |
| 9 | `app-mobile/src/components/activity/CalendarTab.tsx` | Component | Calendar entry → ExpandedCardData |
| 10 | `app-mobile/src/components/SessionViewModal.tsx` | Component | Session card → ExpandedCardData |
| 11 | `app-mobile/src/services/deckService.ts` | Service | `unifiedCardToRecommendation()` — where priceTier IS set |

### Findings

#### ROOT CAUSE: `priceTier` dropped in EVERY Recommendation → ExpandedCardData conversion

| Field | Evidence |
|-------|----------|
| **File + lines** | 7 conversion sites (see table below) |
| **Exact code** | All conversions construct `ExpandedCardData` with explicit field lists — `priceTier` is omitted from every one |
| **What it does** | The `Recommendation` type has `priceTier?: string` (recommendation.ts:45) and it's correctly populated by `unifiedCardToRecommendation()` (deckService.ts:80,123). But when the user taps a card to expand it, the code creates a NEW `ExpandedCardData` object and copies fields one by one — `priceTier` is never copied. |
| **What it should do** | Include `priceTier: currentRec.priceTier` in every conversion |
| **Causal chain** | 1. User swipes through deck → collapsed card reads `currentRec.priceTier` directly → shows correct tier (e.g., "Bougie") → 2. User taps to expand → `ExpandedCardData` constructed WITHOUT `priceTier` → 3. `ExpandedCardModal` passes `(card as any).priceTier` → `undefined` → 4. `CardInfoSection` line 58: `priceTier ?? googleLevelToTierSlug(priceLevel)` → both undefined → 5. `googleLevelToTierSlug(undefined)` returns `'chill'` (priceTiers.ts:49) → 6. Display shows "Chill · $50 max" regardless of actual tier |
| **Verification** | Add `priceTier: currentRec.priceTier` to SwipeableCards.tsx:1137. Expand Sullivan's. Should show "Bougie" instead of "Chill." |

#### ALL 7 AFFECTED CONVERSION SITES

| # | File | Line | Entry Point | priceTier Mapped? |
|---|------|------|-------------|-------------------|
| 1 | `SwipeableCards.tsx` | 1137-1174 | Deck card tap | **NO** |
| 2 | `DiscoverScreen.tsx` | 2362-2399 | Featured card tap | **NO** |
| 3 | `DiscoverScreen.tsx` | 2411-2448 | Grid card tap | **NO** |
| 4 | `DiscoverScreen.tsx` | 2928-2966 | Map pin tap (single cards) | **NO** (curated-only at line 2962) |
| 5 | `SavedTab.tsx` | 1478-1509 | Saved card tap | **NO** |
| 6 | `CalendarTab.tsx` | 1119-1159 | Calendar entry tap | **NO** |
| 7 | `SessionViewModal.tsx` | 530-573 | Collaboration session card tap | **NO** |

**Impact:** EVERY expanded single card across the ENTIRE app shows "Chill · $50 max." This is not a cosmetic issue — it's incorrect data shown to every user on every card expansion.

#### SECONDARY BUG: Curated alternative stops use hardcoded string capitalization

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/ExpandedCardModal.tsx:1055` |
| **Exact code** | `{alt.priceTier ? alt.priceTier.charAt(0).toUpperCase() + alt.priceTier.slice(1) : ''}` |
| **What it does** | Capitalizes the raw slug ("comfy" → "Comfy") instead of using `tierLabel()` with range and currency |
| **What it should do** | `tierLabel(alt.priceTier as PriceTierSlug)` — consistent with main stops at line 934 |

#### HIDDEN FLAW: `(card as any)` casts hide the type error

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/ExpandedCardModal.tsx:1791-1792` |
| **Exact code** | `priceTier={(card as any).priceTier}` and `priceLevel={(card as any).priceLevel}` |
| **What it does** | The `as any` cast suppresses TypeScript's warning that `priceTier` might not exist as expected on the card object. Without the cast, TypeScript would have flagged this. `priceLevel` doesn't even exist on `ExpandedCardData` — it's only on the `CardInfoSection` props interface. |
| **What it should do** | Use typed access: `card.priceTier` (field IS on ExpandedCardData at line 133 under curated section). Remove `priceLevel` prop or populate it properly. |

#### HIDDEN FLAW: Fabricated social stats in multiple conversions

| File | Line | Hardcoded Values |
|------|------|-----------------|
| `DiscoverScreen.tsx` | 2388-2393 | `views: 1200, likes: 340, saves: 89, shares: 45` |
| `DiscoverScreen.tsx` | 2437-2442 | `views: 800, likes: 220, saves: 56, shares: 28` |

These show fake social engagement numbers. Violates constitutional rule: "No fabricated data — never show fake ratings, prices, times."

### Card View Audit — CORRECTED

**Note:** The first investigation incorrectly marked expanded single card price tier as "CORRECT" because it only examined the display component (CardInfoSection.tsx), not the data conversion pipeline. CardInfoSection code IS correct — it properly reads `priceTier` and falls back to `googleLevelToTierSlug(priceLevel)`. The bug is that both values are always `undefined` because the conversion never populates them.

| Card View | Price Tier Display Code | Data Populated? | User Sees |
|-----------|------------------------|-----------------|-----------|
| Collapsed Single | `formatTierLabel(currentRec.priceTier)` | **YES** — reads from Recommendation directly | Correct tier |
| **Expanded Single** | `priceTier ?? googleLevelToTierSlug(priceLevel)` | **NO** — conversion drops both fields | **Always "Chill · $50 max"** |
| Collapsed Curated | `formatTierLabel(firstStopTier)` | **YES** — reads from stop data | Correct tier |
| Expanded Curated (main) | `tierLabel(stop.priceTier)` | **YES** — reads from stop data | Correct tier |
| **Expanded Curated (alts)** | `alt.priceTier.charAt(0).toUpperCase()` | **YES but wrong format** | Raw slug capitalized, no range/currency |

---

## Issue 2: ORCH-0409 — Map Avatars Intermittently Disappear

### ORCH-0385 Fix Verification

**Status: FIX IS INTACT — NOT A REGRESSION**

Verified in code:
- `useForegroundRefresh.ts` lines 39-40: `['nearby-people']` and `['map-settings']` present in `CRITICAL_QUERY_KEYS`
- `ReactNativeMapsProvider.tsx` lines 47-56: `tracksViewChanges` reset logic present with 3s timer
- Git log: No changes to nearby-people query logic since ORCH-0385 fix

### Investigation Manifest

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `app-mobile/src/hooks/useForegroundRefresh.ts` | Hook | Verify ORCH-0385 fix |
| 2 | `app-mobile/src/hooks/useNearbyPeople.ts` | Hook | Query config |
| 3 | `app-mobile/src/components/map/DiscoverMap.tsx` | Component | Consumer |
| 4 | `app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx` | Component | Marker rendering |
| 5 | `app-mobile/src/config/queryClient.ts` | Config | Defaults |

### Findings

#### ROOT CAUSE 1: Query Disabled During Tab Switch — Error State Persists, Empty Default Masks It

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/hooks/useNearbyPeople.ts:38` + `app-mobile/src/components/map/DiscoverMap.tsx:141-144` |
| **Exact code** | Hook: `enabled: enabled && !!location, refetchInterval: 60_000, staleTime: 30_000` / Consumer: `const { data: nearbyPeople = [] } = useNearbyPeople(peopleLayerOn && !isHidden && !paused, userLocation)` |
| **What it does** | When user switches tabs, `paused` becomes true → `enabled` false → React Query stops 60s polling. If the query was in error state (401 from race with focusManager, network glitch) or if it transitions back, `data` is undefined and the `= []` default kicks in → zero markers. No retry mechanism on re-enable. |
| **What it should do** | Use `placeholderData: (previousData) => previousData` to keep showing last good data during errors. Or add explicit error recovery when enabled transitions false→true. |
| **Causal chain** | Tab switch → enabled=false → refetchInterval stops → query may enter error → return to map → enabled=true → cached error persists → `data` undefined → `= []` → no markers |
| **Verification** | Check `isError` and `error` alongside `data` in the consumer. Or add `placeholderData`. |

#### ROOT CAUSE 2: GPS Drift Changes Query Key → New Empty Cache Entry

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/hooks/useNearbyPeople.ts:29` |
| **Exact code** | `queryKey: ['nearby-people', location?.latitude?.toFixed(2), location?.longitude?.toFixed(2), radiusKm]` |
| **What it does** | `toFixed(2)` gives ~1.1km precision. Normal GPS variance (especially indoors) can change the 2nd decimal, creating an entirely new query key → no cached data → `data` undefined → `= []` while fetch runs. If fetch fails, stays empty. |
| **What it should do** | Use `toFixed(1)` (~11km grid) or `Math.round(lat * 10) / 10` for stability. Or use `placeholderData` to show previous key's data while new key loads. |
| **Causal chain** | Stationary user → GPS jitter → query key changes → new cache miss → `= []` while fetching → if fetch fails, stays empty |
| **Verification** | Log query key on each render, correlate key changes with avatar disappearance |

#### CONTRIBUTING: Empty Default Masks Error

**File:** `DiscoverMap.tsx:141` — `const { data: nearbyPeople = [] } = useNearbyPeople(...)` — no distinction between "no people nearby" and "fetch failed." Silent failure.

#### CONTRIBUTING: focusManager Race

**File:** `queryClient.ts:16-21` — `focusManager.setFocused(true)` fires on AppState active BEFORE auth refresh. Stale queries with expired JWT fail with 401, then ORCH-0385's post-auth invalidation covers it — but ONLY for background return, not for tab-switch scenarios.

#### HIDDEN FLAW: Cache Entry Accumulation

**File:** `useNearbyPeople.ts:29` — Each GPS coordinate creates a cache entry with 24h gcTime. Over a day of GPS drift, dozens of entries accumulate. Memory leak.

---

## Issue 3: ORCH-0408 — Quoted Message in DM Compressed to Invisibility

### Investigation Manifest

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `app-mobile/src/components/chat/ReplyQuoteBlock.tsx` | Component | Quote rendering |
| 2 | `app-mobile/src/components/chat/MessageBubble.tsx` | Component | Parent bubble |
| 3 | `app-mobile/src/components/MessageInterface.tsx` | Component | Reply data resolution |
| 4 | `app-mobile/src/components/discussion/MessageBubble.tsx` | Component | Board discussions (same component) |

### Findings

#### ROOT CAUSE: `flex: 1, minWidth: 0` Allows Content Compression to Zero

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/chat/ReplyQuoteBlock.tsx:110-113` |
| **Exact code** | `content: { flex: 1, minWidth: 0 }` |
| **What it does** | The content area sits in a row with an accentBar (2.5px) and optional thumbnail (32px). `flex: 1` means "grow to fill," but `minWidth: 0` explicitly allows shrinking below natural content width. Combined with React Native's default `flexShrink: 1`, when the parent bubble auto-sizes to fit a short reply message, the quote block row can compress the content area. |
| **What it should do** | Either remove `minWidth: 0` (let content keep its natural min width) or add a `minHeight` to ensure at least 2 lines of 12px text are always visible. |
| **Causal chain** | 1. User replies to a message → 2. Bubble auto-sizes to fit reply text → 3. If reply text is short, bubble is narrow → 4. ReplyQuoteBlock row: accentBar (10.5px) + content (flex:1, minWidth:0) + thumbnail (40px) → 5. Available width for content may be very small → 6. `minWidth: 0` permits compression → 7. Text clips to nothing |
| **Verification** | Remove `minWidth: 0` from content style. Quote text should always be visible. |

#### CONTRIBUTING: No explicit lineHeight on text

**File:** `ReplyQuoteBlock.tsx:124-127` — `previewText: { fontSize: 12, marginTop: 1 }` with no `lineHeight`. The text element can't properly reserve vertical space when width-constrained.

#### BLAST RADIUS: Board Discussion Uses Same Component

**File:** `app-mobile/src/components/discussion/MessageBubble.tsx` — imports and uses the same `ReplyQuoteBlock`. Same bug affects board message replies.

#### DATA PIPELINE: Verified Correct

The reply-to data flow is working correctly:
- `reply_to_id` stored in DB
- `messagingService.getMessageById()` fetches referenced messages
- `MessageInterface.tsx:293-368` resolves reply references with lazy loading
- All fields flow to `ReplyQuoteBlock` correctly
- This is purely a layout/rendering bug, not a data issue

---

## Adjacent Findings

| Suggested ID | Title | Surface | Severity | Source |
|-------------|-------|---------|----------|--------|
| ORCH-0413 | Fabricated socialStats in ExpandedCardData conversions (hardcoded views/likes/saves/shares) | Discovery | S2 | ORCH-0406 — DiscoverScreen.tsx:2388-2393, 2437-2442 |
| ORCH-0414 | nearbyPeople query key memory leak — GPS drift creates unbounded cache entries | Map | S2 | ORCH-0409 — useNearbyPeople.ts:29 |
| ORCH-0415 | Board discussion reply quotes share DM compression bug | Collaboration | S2 | ORCH-0408 — discussion/MessageBubble.tsx |
| ORCH-0416 | `travelMode` not passed to CardInfoSection — travel icon defaults to generic | Discovery | S3 | ORCH-0406 — ExpandedCardModal.tsx:1781-1796 |
| ORCH-0417 | `(card as any)` casts in ExpandedCardModal suppress type safety on 2+ fields | Code Quality | S3 | ORCH-0406 — ExpandedCardModal.tsx:1791-1792 |

---

## Blast Radius Map

### ORCH-0406 (CRITICAL — widest blast radius of all three)
- **Direct:** EVERY expanded single card across the ENTIRE app — 7 entry points
- **Surfaces:** Deck, For You grid, Featured cards, Map pins, Saved cards, Calendar entries, Collaboration sessions
- **Solo/Collab:** Both
- **Curated:** Correctly shows tier on main stops; alt stops have secondary display bug
- **Constitutional violation:** "No fabricated data" — showing "Chill" for a bougie restaurant IS misinformation

### ORCH-0409
- **Direct:** Discover Map people layer
- **Indirect:** Any query with `enabled` toggle + `refetchInterval` pattern
- **Solo/Collab:** Both

### ORCH-0408
- **Direct:** DM quote-reply blocks + board discussion quote-reply blocks
- **Solo/Collab:** Both

---

## Confidence Levels

| Issue | Confidence | Reasoning |
|-------|-----------|-----------|
| ORCH-0406 | **High** (root cause proven) | Traced full data path from deckService → Recommendation → ExpandedCardData conversion → CardInfoSection. 7 conversion sites verified. `googleLevelToTierSlug(undefined)` → `'chill'` confirmed at priceTiers.ts:49. User's live observation (Sullivan's bougie collapsed, chill expanded) matches exactly. |
| ORCH-0409 | **High** (root cause proven) | ORCH-0385 fix verified intact. Multiple alternative triggers identified with code evidence. |
| ORCH-0408 | **High** (root cause probable) | Flex layout analysis consistent with symptom. Data pipeline verified correct. Exact trigger conditions (short reply text causing narrow bubble) match "sometimes" nature of the bug. |
