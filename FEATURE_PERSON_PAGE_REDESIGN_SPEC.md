# Feature: Person Page Redesign — Hero Cards + Unified Card Design

**Date:** 2026-03-12
**Status:** Planned
**Requested by:** Redesign the person page (PersonHolidayView) to embed 5 experience cards inside the hero section, add age + gift suggestion, allow on-demand generation of up to 5 more cards from audio description analysis, and unify all card designs across the page to match the For You tab GridCard — except curated cards which keep their own design.

---

## 1. Summary

This feature redesigns the person detail page (`PersonHolidayView`) to transform the hero section from a static info card into an interactive experience hub. The hero retains name, birthday, and countdown but adds the person's age and a gift suggestion (from the existing AI summary). Five experience cards are embedded inside the hero — 1 curated (matched to audio description), 1 category card (matched to audio description), 1 Fine Dining, 1 Watch, 1 Play — scrollable horizontally within the hero box. Users can generate up to 5 additional cards on-demand (pool-first, Google API fallback). All cards across the entire page (hero + holiday rows) are unified to the GridCard design from the For You tab. The card generation pipeline is extended via `get-holiday-cards` to accept a `description` parameter so that cards can be generated for **any** saved person (linked or not) using audio description analysis as the personalization signal.

---

## 2. User Story

As a Mingla user who has added a person (linked or not), I want to see personalized experience cards on their page that reflect what I've told the app about them (via voice recordings), so that I can quickly find gifts and experiences tailored to their interests — without needing them to be a linked Mingla user.

---

## 3. Success Criteria

1. When I navigate to a person's page, the hero section displays: **name**, **birthday date**, **age** (e.g., "Turning 28"), **countdown** (e.g., "42 days away"), and a **gift suggestion** (1-sentence AI-generated text).
2. Inside the hero section, below the info area, a horizontally scrollable row of exactly **5 cards** appears: 1 curated card + 1 description-matched category card + 1 Fine Dining + 1 Watch + 1 Play.
3. The curated card uses the **curated card design** (dark background, amber badge, multi-stop layout). All other cards use the **GridCard design** (white background, image 130px, category icon badge bottom-left, title 2 lines, category label, price + arrow button).
4. A "Generate More" button appears after the 5th card. Tapping it generates up to **5 additional cards** matched to the person's audio description analysis. The button disappears after 5 additional cards are generated or if no more results are available.
5. Cards in the **Upcoming Holidays** expanded rows also use the GridCard design (replacing the current 180×230 holiday card design), with the same compact layout: image, category icon badge, title, category, price, arrow button.
6. Cards are generated for **every saved person**, whether linked or not. The personalization signal is `saved_people.description` (from audio analysis). If description is NULL, cards fall back to location-based generic results (current behavior).
7. When a card is tapped, it opens Google Maps at the card's coordinates (preserving current behavior).
8. The hero section renders correctly when: (a) person has birthday + description, (b) person has birthday but no description, (c) person has no birthday but has description, (d) person has neither.
9. The "Generate More" flow checks `card_pool` first, then falls back to Google Places API only if pool results are insufficient. No unnecessary API calls.
10. All cards display price tier information formatted via `formatTierLabel()`. Cards from `get-holiday-cards` that lack `price_tier` data derive it from `priceLevel` via `googleLevelToTierSlug()`.

---

## 4. Database Changes

### 4.1 New Tables

None.

### 4.2 Modified Tables

None. The existing `card_pool`, `saved_people`, and `person_experiences` tables have all necessary columns. No schema migration is required.

### 4.3 RLS Policy Summary

No new RLS policies. Existing policies on `card_pool` (service-role only) and `saved_people` (user-scoped) are sufficient.

---

## 5. Edge Functions

### 5.1 Extend `get-holiday-cards` (MODIFIED)

**File path:** `supabase/functions/get-holiday-cards/index.ts`
**HTTP method:** POST
**Authentication:** Required — verify JWT via Supabase client
**Purpose:** Extend to accept an optional `description` parameter and optional `mode` parameter to support description-based card generation for the hero section and on-demand generation.

#### 5.1.1 Request Body Changes

**Current `RequestBody`:**
```typescript
interface RequestBody {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
}
```

**New `RequestBody`:**
```typescript
interface RequestBody {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
  // ── NEW FIELDS ──────────────────────────────────────────────
  description?: string;        // Person's audio description analysis text
  mode?: "holiday" | "hero" | "generate_more";  // Default: "holiday"
  excludeCardIds?: string[];   // Card IDs to exclude (prevents duplicates across generate_more calls)
}
```

#### 5.1.2 Response Body Changes

**Current response:**
```typescript
{ cards: Card[] }
```

**New response:**
```typescript
{
  cards: Card[];
  hasMore: boolean;   // NEW: true if more cards could be generated
}
```

**Extended `Card` interface:**
```typescript
interface Card {
  id: string;
  title: string;
  category: string;
  categorySlug: string;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  // ── NEW FIELDS ──────────────────────────────────────────────
  priceTier: string | null;       // "chill" | "comfy" | "bougie" | "lavish"
  description: string | null;     // Card description text (for GridCard display)
  cardType: "single" | "curated"; // Discriminator for card rendering
}
```

#### 5.1.3 Backward Compatibility

- `mode` defaults to `"holiday"` when omitted — existing callers (HolidayRow) continue to work identically.
- `description`, `excludeCardIds` are optional — existing callers never send them.
- `hasMore` is a new response field — existing callers ignore unknown fields (`data.cards ?? []` pattern in `holidayCardsService.ts`).
- **No existing behavior changes when `mode` is `"holiday"` or omitted.**

#### 5.1.4 New Validation Rules

Add these validations **only when `mode` is `"hero"` or `"generate_more"`**:

1. `description` must be a non-empty string (≥ 10 characters) when `mode` is `"hero"` or `"generate_more"`. If missing or too short AND mode is `"hero"` or `"generate_more"` → proceed without description personalization (fall back to category-only search). Do NOT return 400 — graceful degradation.
2. `excludeCardIds`, if provided, must be an array of strings. If not an array → ignore it (treat as empty array). Do NOT return 400.
3. `mode`, if provided, must be one of `"holiday"`, `"hero"`, `"generate_more"`. If unrecognized → treat as `"holiday"`.

#### 5.1.5 Implementation Logic — Mode: `"hero"`

When `mode === "hero"`, the function generates 5 cards for the hero section:

**Step 1: Resolve categories from description.**
- If `description` is provided and ≥ 10 characters:
  - Call the existing `resolveCategory()` function on each slug in `categorySlugs`.
  - The mobile client sends `categorySlugs` as `["description_match", "fine_dining", "watch", "play"]`.
  - For the `"description_match"` slug: use OpenAI GPT-4o-mini to extract the **single best-matching canonical category** from the description. Prompt:
    ```
    System: "Given a person description, pick the single best experience category from this list: Nature, First Meet, Picnic, Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness, Groceries & Flowers, Work & Business. Return JSON: { "category": "string" }"
    User: "Description: ${description}"
    ```
    Model: `gpt-4o-mini`, temperature: 0.3, max_tokens: 50.
  - Validate the GPT response against `ALL_CATEGORY_NAMES` using `resolveCategory()`. If GPT returns a non-canonical name, attempt resolution. If resolution fails, default to `"Casual Eats"`.
  - Replace the `"description_match"` slug with the resolved canonical category name.

**Step 2: Query `card_pool` for each resolved category.**
- Use the existing bounding box logic (lines 162–166 of current code: `DEGREE_OFFSET = 0.09`).
- For each category: query `card_pool` with `.eq("category", resolvedDisplayName)` + geo bounds + `.order("rating", { ascending: false })` + `.limit(5)`.
- If `linkedUserId` is provided, apply the existing boosting logic (linked user's saved cards sorted to top).
- Select **1 card per category** (the top-rated after boosting).
- Exclude any card IDs in `excludeCardIds`.

**Step 3: Generate curated card from description.**
- For the curated card slot: query `card_pool` with `.eq("card_type", "curated")` + geo bounds + `.limit(5)`.
- If description is provided, score curated cards by keyword overlap with the description (simple word intersection scoring: count how many words from the description appear in the curated card's `title`, `description`, `tagline`, or `categories` array). Pick the highest-scoring curated card.
- If no curated cards match or none exist in pool, **skip the curated card** — return 4 cards instead of 5. The mobile client handles this gracefully (renders only available cards).
- Set `cardType: "curated"` on this card.

**Step 4: Assemble and return.**
- Combine: [curated card (if found), description-matched category card, Fine Dining card, Watch card, Play card].
- Set `cardType: "single"` on all non-curated cards.
- Populate `priceTier` on each card: if `card_pool.price_tier` exists, use it. Otherwise, derive from `card_pool.price_level` using the server-side equivalent of `googleLevelToTierSlug()`. Add this derivation function to the edge function (simple mapping — see §5.1.7).
- Populate `description` on each card from `card_pool.description`. If NULL, use fallback: `"A great ${category} spot to explore."`.
- Set `hasMore: true` (there are always potentially more cards to generate).

**Step 5: Google Places API fallback (per category, if pool is empty).**
- If `card_pool` returns 0 results for a category, use the existing Google Places fallback (lines 214–286 of current code).
- Apply the same `priceTier` derivation to Google Places results.
- Set `description` from Google Places `editorial_summary` field if available, otherwise use the category fallback text.

#### 5.1.6 Implementation Logic — Mode: `"generate_more"`

When `mode === "generate_more"`:

**Step 1: Extract up to 3 categories from description.**
- Call GPT-4o-mini to extract up to 3 best-matching canonical categories. Prompt:
  ```
  System: "Given a person description, pick up to 3 experience categories from this list that best match their interests: Nature, First Meet, Picnic, Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness, Groceries & Flowers, Work & Business. Return JSON: { "categories": ["string"] }"
  User: "Description: ${description}"
  ```
  Model: `gpt-4o-mini`, temperature: 0.3, max_tokens: 100.
- Validate each category against `ALL_CATEGORY_NAMES` using `resolveCategory()`. Discard any that don't resolve.
- If 0 categories resolve, fall back to `categorySlugs` from the request (which the mobile client populates as `["casual_eats", "nature", "drink"]` as defaults).

**Step 2: Query `card_pool` for each category.**
- Same geo bounding box as hero mode.
- Query up to 5 cards per category, exclude `excludeCardIds`.
- Take up to 2 cards per category (round-robin across categories to reach 5 total).

**Step 3: Google Places fallback if needed.**
- If total cards < 5 after pool query, fill gaps from Google Places API (same logic as hero mode).
- If total cards still < 5 after Google Places, return what's available.

**Step 4: Return.**
- All cards have `cardType: "single"` (no curated cards in generate_more).
- Set `hasMore: (totalPoolCards + totalGoogleCards) > cardsReturned`.
- Populate `priceTier` and `description` using same logic as hero mode.

#### 5.1.7 Price Tier Derivation (Server-Side)

Add this utility function inside `get-holiday-cards/index.ts` (or in `_shared/priceTiers.ts` if it exists there):

```typescript
function derivePriceTier(
  priceTier: string | null,
  priceLevel: string | null
): string | null {
  if (priceTier) return priceTier;
  if (!priceLevel) return "chill";
  const mapping: Record<string, string> = {
    PRICE_LEVEL_FREE: "chill",
    PRICE_LEVEL_INEXPENSIVE: "chill",
    PRICE_LEVEL_MODERATE: "comfy",
    PRICE_LEVEL_EXPENSIVE: "bougie",
    PRICE_LEVEL_VERY_EXPENSIVE: "lavish",
  };
  return mapping[priceLevel] ?? "chill";
}
```

#### 5.1.8 Category Validation (Server-Side)

Import `ALL_CATEGORY_NAMES` from `../_shared/categoryPlaceTypes.ts`. After GPT returns a category, validate:

```typescript
import { resolveCategory, ALL_CATEGORY_NAMES } from "../_shared/categoryPlaceTypes.ts";

function validateCategory(input: string): string {
  const resolved = resolveCategory(input);
  if (resolved && ALL_CATEGORY_NAMES.includes(resolved)) return resolved;
  return "Casual Eats"; // Safe fallback
}
```

#### 5.1.9 Updated SELECT Fields

The current SELECT (line 176) fetches 10 fields. Extend it to include `price_tier` and `description`:

**Current:**
```typescript
.select("id, title, category, image_url, rating, price_level, address, google_place_id, lat, lng")
```

**New:**
```typescript
.select("id, title, category, image_url, rating, price_level, address, google_place_id, lat, lng, price_tier, description, card_type")
```

This also applies to the curated card query, which additionally needs: `tagline, categories, stops, total_price_min, total_price_max`.

#### 5.1.10 OpenAI API Key

The edge function already has access to `GOOGLE_PLACES_API_KEY` from environment. It also needs `OPENAI_API_KEY` for GPT-4o-mini calls. Verify this is available in the edge function environment. Check: `Deno.env.get("OPENAI_API_KEY")`. The `generate-ai-summary` and `process-person-audio` functions already use this key, so it should be available.

#### 5.1.11 Error Handling for GPT Calls

If the GPT call fails (network error, timeout, malformed response):
- **Do NOT return an error to the client.**
- Fall back to using `categorySlugs` as-is (without description-based personalization).
- Log the error with `console.error("GPT category extraction failed:", error)`.
- This ensures the feature degrades gracefully — cards still appear, just without personalization.

---

## 6. Mobile Implementation

### 6.1 New Files to Create

#### 6.1.1 `app-mobile/src/components/PersonGridCard.tsx`

**Purpose:** Shared GridCard component extracted from DiscoverScreen's inline GridCard rendering. Used by BirthdayHero (hero cards), HolidayRow (holiday cards), and PersonRecommendationCards (if retained). Single source of truth for the GridCard design on the person page.

**Exports:** `PersonGridCard` (named export), `PersonGridCardProps` (type export)

```typescript
import React from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Feather } from "@expo/vector-icons";
import { s, vs, SCREEN_WIDTH } from "../utils/responsive";
import { colors, shadows } from "../constants/designSystem";
import { getCategoryIcon } from "../utils/categoryUtils";
import { formatTierLabel, googleLevelToTierSlug, PriceTierSlug } from "../constants/priceTiers";

export interface PersonGridCardProps {
  id: string;
  title: string;
  category: string;             // Display name: "Fine Dining", "Watch", etc.
  imageUrl: string | null;
  priceTier: PriceTierSlug | null;
  priceLevel: string | null;    // Fallback for deriving priceTier
  onPress: () => void;
}
```

**Visual structure (exact match to DiscoverScreen GridCard):**
- Card dimensions: `PERSON_GRID_CARD_WIDTH` = `s(180)`, height = `s(240)`
- Image container: 130px height, relative positioning
- Category icon badge: absolute, bottom: 8, left: 8, white background, orange (#eb7825) Ionicons icon (16px)
- Content section: 12px padding
- Title: 14px, fontWeight "600", color #111827, numberOfLines={2}, lineHeight 18, minHeight 36
- Category label: 12px, fontWeight "500", color #6b7280, marginBottom 8
- Footer row: flexDirection "row", justifyContent "space-between", alignItems "center"
  - Price text: 9px, fontWeight "500", color #eb7825 — formatted via `formatTierLabel(resolvedTier)`
  - Arrow button: 24×24, borderRadius 12, backgroundColor #eb7825, Feather chevron-right 14px white
- Shadow: shadowColor #000, shadowOffset {0, 2}, shadowOpacity 0.08, shadowRadius 8, elevation 3
- Border radius: 16px, overflow "hidden", backgroundColor white

**Price tier resolution logic (inside the component):**
```typescript
const resolvedTier: PriceTierSlug = props.priceTier ?? googleLevelToTierSlug(props.priceLevel);
const formattedPrice = formatTierLabel(resolvedTier);
```

**Image placeholder (when imageUrl is null):**
- Same container dimensions
- backgroundColor: `colors.gray[200]`
- Centered Ionicons category icon, size 28, color `rgba(255,255,255,0.6)`

**Why a new component instead of modifying DiscoverScreen's inline GridCard:**
- DiscoverScreen's GridCard is defined inline (not exported) and is tightly coupled to DiscoverScreen's local types (`GridCardData`), currency state, and `onPress` handlers.
- Extracting it would require refactoring DiscoverScreen — high blast radius, zero benefit for this feature.
- A standalone `PersonGridCard` with a clean interface avoids touching DiscoverScreen entirely.
- The two components are visually identical — if the design drifts in DiscoverScreen, it can be synced later.

#### 6.1.2 `app-mobile/src/components/PersonCuratedCard.tsx`

**Purpose:** Compact curated card for the hero section. Borrows the design language from `CuratedExperienceSwipeCard.tsx` but sized for the hero's horizontal scroll (same width as PersonGridCard).

**Exports:** `PersonCuratedCard` (named export), `PersonCuratedCardProps` (type export)

```typescript
export interface PersonCuratedCardProps {
  id: string;
  title: string;
  tagline: string | null;
  categoryLabel: string;
  imageUrl: string | null;
  stops: number;                // Number of stops (derived from stops array length)
  totalPriceMin: number | null;
  totalPriceMax: number | null;
  rating: number | null;
  onPress: () => void;
}
```

**Visual structure (adapted from CuratedExperienceSwipeCard for compact display):**
- Card dimensions: same as PersonGridCard — `s(180)` width × `s(240)` height
- Background: `#1C1C1E` (dark) — matches curated card design
- Image section: 55% height (same ratio as curated swipe card)
  - Single image (first stop's image or card's main image)
  - Stop count badge: top-left, small amber (#F59E0B) badge showing "X stops"
- Info section: 45% height, padding 10px
  - Category badge: amber (#F59E0B) background, white text, 10px font, 700 weight, borderRadius 6
  - Title: white (#FFFFFF), 13px, 700 weight, numberOfLines={2}
  - Meta row: `rgba(255,255,255,0.7)`, 10px — rating (star icon + number) · price range
- No arrow button (curated cards have a different interaction model)

**Why a separate component from CuratedExperienceSwipeCard:**
- `CuratedExperienceSwipeCard` is designed for full-screen swipeable deck display (flex: 1, image strip with multiple images side-by-side).
- The hero section needs a compact card (180×240) with a single image thumbnail.
- Sharing the component would require conditional rendering that makes both use cases harder to maintain.
- Design language is borrowed (dark bg, amber badges, white text), not the component itself.

#### 6.1.3 `app-mobile/src/hooks/useHeroCards.ts`

**Purpose:** React Query hook for fetching hero section cards via the extended `get-holiday-cards` edge function.

**Exports:** `useHeroCards`, `heroCardKeys`

```typescript
export const heroCardKeys = {
  all: ["hero-cards"] as const,
  forPerson: (personId: string) =>
    [...heroCardKeys.all, personId] as const,
};

export function useHeroCards(params: {
  personId: string;
  description: string | null;
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: heroCardKeys.forPerson(params.personId),
    queryFn: () =>
      getHolidayCards({
        personId: params.personId,
        holidayKey: "hero",
        categorySlugs: ["description_match", "fine_dining", "watch", "play"],
        location: params.location,
        linkedUserId: params.linkedUserId,
        description: params.description ?? undefined,
        mode: "hero",
      }),
    enabled: params.enabled,
    staleTime: 30 * 60 * 1000,    // 30 min — same as holiday cards
    gcTime: 60 * 60 * 1000,       // 1 hour
  });
}
```

**staleTime justification:** Hero cards are location-based recommendations that don't change frequently. 30 minutes prevents unnecessary refetches while the user browses the person page. Matches the existing `useHolidayCards` staleTime for consistency.

**Cache invalidation strategy:** Hero cards are keyed by personId only (not by description). If the user re-records audio (description changes), the cache is invalidated when `PersonHolidayView` unmounts and remounts with the updated person object. No explicit invalidation needed — React Query's automatic refetch on stale data handles this.

#### 6.1.4 `app-mobile/src/hooks/useGenerateMoreCards.ts`

**Purpose:** React Query mutation hook for the "Generate More" on-demand card generation.

**Exports:** `useGenerateMoreCards`

```typescript
export function useGenerateMoreCards() {
  return useMutation({
    mutationFn: (params: {
      personId: string;
      description: string;
      location: { latitude: number; longitude: number };
      linkedUserId?: string;
      excludeCardIds: string[];
    }) =>
      getHolidayCards({
        personId: params.personId,
        holidayKey: "generate_more",
        categorySlugs: [],            // Not used in generate_more mode
        location: params.location,
        linkedUserId: params.linkedUserId,
        description: params.description,
        mode: "generate_more",
        excludeCardIds: params.excludeCardIds,
      }),
  });
}
```

**Why a mutation, not a query:** "Generate More" is a user-initiated action, not automatic data fetching. Using `useMutation` gives us:
- No automatic refetching (user controls when to generate).
- `isLoading` state for the button spinner.
- `data` that accumulates (the component manages the full list of generated cards).
- No cache key collisions with hero cards.

### 6.2 Files to Modify

#### 6.2.1 `app-mobile/src/services/holidayCardsService.ts`

**What to change:** Extend the `HolidayCard` interface and `getHolidayCards` function to support the new fields.

**Current `HolidayCard` interface (lines 3–15):**
```typescript
export interface HolidayCard {
  id: string;
  title: string;
  category: string;
  categorySlug: string;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
}
```

**New `HolidayCard` interface:**
```typescript
export interface HolidayCard {
  id: string;
  title: string;
  category: string;
  categorySlug: string;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  // ── NEW FIELDS ──────────────────────────────────────────────
  priceTier: string | null;
  description: string | null;
  cardType: "single" | "curated";
}
```

**Current `getHolidayCards` params (lines 17–23):**
```typescript
export async function getHolidayCards(params: {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
}): Promise<HolidayCard[]>
```

**New `getHolidayCards` params:**
```typescript
export async function getHolidayCards(params: {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
  // ── NEW FIELDS ──────────────────────────────────────────────
  description?: string;
  mode?: "holiday" | "hero" | "generate_more";
  excludeCardIds?: string[];
}): Promise<HolidayCard[]>
```

**Return type stays `HolidayCard[]`** — the `hasMore` field from the edge function response is consumed by the hook layer, not the service layer. The service extracts `data.cards ?? []` as before.

**Wait — we need `hasMore`.** Update the return type:

```typescript
export interface HolidayCardsResponse {
  cards: HolidayCard[];
  hasMore: boolean;
}

export async function getHolidayCards(params: { ... }): Promise<HolidayCardsResponse> {
  // ...existing fetch logic...
  const data = await response.json();
  return {
    cards: data.cards ?? [],
    hasMore: data.hasMore ?? false,
  };
}
```

**CRITICAL BACKWARD COMPATIBILITY:** The existing `useHolidayCards` hook (line 2 of `useHolidayCards.ts`) calls `getHolidayCards()` and its consumers expect `HolidayCard[]` (the data from `useQuery` is `HolidayCard[]`). Changing the return type to `HolidayCardsResponse` breaks this.

**Resolution:** Keep the existing `getHolidayCards` returning `HolidayCard[]` for backward compatibility. Add a NEW function:

```typescript
export async function getHolidayCardsWithMeta(params: {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
  description?: string;
  mode?: "holiday" | "hero" | "generate_more";
  excludeCardIds?: string[];
}): Promise<HolidayCardsResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(
    `${supabaseUrl}/functions/v1/get-holiday-cards`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to fetch holiday cards");
  }

  const data = await response.json();
  return {
    cards: data.cards ?? [],
    hasMore: data.hasMore ?? false,
  };
}
```

The existing `getHolidayCards` function is left completely untouched. The new hooks (`useHeroCards`, `useGenerateMoreCards`) use `getHolidayCardsWithMeta`.

#### 6.2.2 `app-mobile/src/components/BirthdayHero.tsx`

**What to change:** Add age display, embed hero cards scroll inside the hero box, add "Generate More" button and generated cards.

**Props change:**

**Current `BirthdayHeroProps` (lines 35–39):**
```typescript
interface BirthdayHeroProps {
  person: SavedPerson;
  aiSummary: string | null;
  isLoadingSummary: boolean;
}
```

**New `BirthdayHeroProps`:**
```typescript
interface BirthdayHeroProps {
  person: SavedPerson;
  aiSummary: string | null;
  isLoadingSummary: boolean;
  // ── NEW PROPS ──────────────────────────────────────────────
  heroCards: HolidayCard[];
  isLoadingHeroCards: boolean;
  generatedCards: HolidayCard[];
  isGenerating: boolean;
  canGenerateMore: boolean;
  onGenerateMore: () => void;
  onCardPress: (card: HolidayCard) => void;
}
```

**New helper function — `getAge`:**
```typescript
function getAge(birthdayStr: string): number {
  const today = new Date();
  const bday = new Date(birthdayStr);
  let age = today.getFullYear() - bday.getFullYear();
  const monthDiff = today.getMonth() - bday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < bday.getDate())) {
    age--;
  }
  return age;
}

function getNextAge(birthdayStr: string): number {
  return getAge(birthdayStr) + 1;
}
```

**Layout change — birthday container:**

The hero container height changes from `SCREEN_HEIGHT * 0.4` to `SCREEN_HEIGHT * 0.55` to accommodate the embedded cards scroll.

**New layout structure (top to bottom inside the orange/grey box):**

1. **Info row** (flexDirection: "row", justifyContent: "space-between"):
   - Left column:
     - Name: `{person.name}'s Birthday` (existing `birthdayTitle` style)
     - Birthday date: `March 15` (existing `birthdayDate` style)
   - Right column:
     - Age badge: rounded pill, white background with 0.2 opacity, containing:
       - Text: `Turning {nextAge}` — 14px, 600 weight, white

2. **Countdown section** (existing, centered):
   - Large countdown number (existing `countdownNumber` style)
   - Days label (existing `countdownLabel` style)

3. **Gift suggestion** (replaces `summarySection`):
   - Icon: Ionicons "gift-outline" (14px, white, 0.85 opacity) inline before text
   - Text: `{aiSummary}` — 14px italic white 0.85 opacity (existing style, just add icon prefix)

4. **Hero cards scroll** (new):
   - `ScrollView` horizontal, showsHorizontalScrollIndicator={false}
   - contentContainerStyle: paddingHorizontal 16, gap 12
   - Renders `heroCards` + `generatedCards` combined
   - Each card: if `card.cardType === "curated"` → render `<PersonCuratedCard>`, else → render `<PersonGridCard>`
   - After all cards: if `canGenerateMore` → render "Generate More" button
   - If `isLoadingHeroCards` → render 3 skeleton cards (same dimensions as PersonGridCard, pulsing animation)
   - If `isGenerating` → render spinner after last card

5. **"Generate More" button** (inside the scroll, after last card):
   - Dimensions: `s(80)` width × `s(240)` height (same height as cards)
   - backgroundColor: `rgba(255,255,255,0.15)`
   - borderRadius: 16, borderWidth: 1.5, borderColor: `rgba(255,255,255,0.3)`, borderStyle: "dashed"
   - Center content: Ionicons "add-circle-outline" (28px, white 0.8 opacity) + Text "More" (12px, white 0.8 opacity, 600 weight)
   - `onPress` → calls `onGenerateMore`
   - Hidden when `!canGenerateMore` or `!person.description`

**No-birthday variant:**
- When `!person.birthday`: show `{person.name}'s Picks` (existing) + hero cards scroll (new). No age, no countdown. Gift suggestion still shows if aiSummary exists.
- Hero cards still render — they're based on description, not birthday.

**No-description variant:**
- Hero cards still load (using category-only matching from pool/Google Places).
- "Generate More" button is hidden (no description to personalize from).
- Gift suggestion shows generic AI summary or nothing.

#### 6.2.3 `app-mobile/src/components/PersonHolidayView.tsx`

**What to change:** Wire up hero cards, generate more functionality, and pass new props to BirthdayHero.

**Add imports:**
```typescript
import { useHeroCards } from "../hooks/useHeroCards";
import { useGenerateMoreCards } from "../hooks/useGenerateMoreCards";
import { HolidayCard } from "../services/holidayCardsService";
```

**Add state and hooks (inside the component, after existing hooks):**
```typescript
// ── Hero cards ──
const { data: heroCardsData, isLoading: isLoadingHeroCards } = useHeroCards({
  personId: person.id,
  description: person.description,
  location,
  linkedUserId: person.linked_user_id ?? undefined,
  enabled: true,
});
const heroCards = heroCardsData?.cards ?? [];

// ── Generate More ──
const [generatedCards, setGeneratedCards] = useState<HolidayCard[]>([]);
const [generateCount, setGenerateCount] = useState(0);
const MAX_GENERATE_MORE = 5;
const generateMoreMutation = useGenerateMoreCards();

const allHeroCardIds = useMemo(() => {
  return [...heroCards, ...generatedCards].map((c) => c.id);
}, [heroCards, generatedCards]);

const canGenerateMore =
  generateCount < MAX_GENERATE_MORE &&
  !!person.description &&
  person.description.length >= 10 &&
  (generateMoreMutation.data?.hasMore !== false);

const handleGenerateMore = useCallback(() => {
  if (!person.description || generateCount >= MAX_GENERATE_MORE) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  generateMoreMutation.mutate(
    {
      personId: person.id,
      description: person.description,
      location,
      linkedUserId: person.linked_user_id ?? undefined,
      excludeCardIds: allHeroCardIds,
    },
    {
      onSuccess: (response) => {
        setGeneratedCards((prev) => [...prev, ...response.cards]);
        setGenerateCount((prev) => prev + 1);
      },
    }
  );
}, [person, location, allHeroCardIds, generateCount, generateMoreMutation]);

const handleCardPress = useCallback((card: HolidayCard) => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  if (card.lat && card.lng) {
    Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${card.lat},${card.lng}`
    ).catch(() => {});
  } else if (card.address) {
    Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}`
    ).catch(() => {});
  }
}, []);
```

**Update BirthdayHero rendering (lines 234–239):**
```typescript
<BirthdayHero
  person={person}
  aiSummary={aiSummary ?? null}
  isLoadingSummary={isLoadingSummary}
  heroCards={heroCards}
  isLoadingHeroCards={isLoadingHeroCards}
  generatedCards={generatedCards}
  isGenerating={generateMoreMutation.isPending}
  canGenerateMore={canGenerateMore}
  onGenerateMore={handleGenerateMore}
  onCardPress={handleCardPress}
/>
```

**Remove PersonRecommendationCards** (line 242):
- Delete: `<PersonRecommendationCards person={person} location={location} />`
- The hero cards now serve this purpose for ALL persons (linked and not linked).
- **Rationale:** PersonRecommendationCards only worked for linked users and used a different data pipeline (`get-personalized-cards`). The new hero cards replace it entirely.

**Add `Linking` import** if not already present (check line 8 — it's not currently imported in PersonHolidayView):
```typescript
import { Linking } from "react-native";
```

#### 6.2.4 `app-mobile/src/components/HolidayRow.tsx`

**What to change:** Replace the current holiday card rendering (lines 219–278) with `PersonGridCard`.

**Add import:**
```typescript
import PersonGridCard from "./PersonGridCard";
import { googleLevelToTierSlug, PriceTierSlug } from "../constants/priceTiers";
```

**Remove imports that are no longer needed:**
- `Image` (from react-native) — PersonGridCard handles its own image
- `LinearGradient` (from expo-linear-gradient) — PersonGridCard doesn't use gradient

**Replace the card rendering block (lines 213–280):**

Current inline `<TouchableOpacity>` card → replace with:

```typescript
{data.map((card) => (
  <PersonGridCard
    key={card.id}
    id={card.id}
    title={card.title}
    category={getReadableCategoryName(card.categorySlug || card.category)}
    imageUrl={card.imageUrl}
    priceTier={(card.priceTier as PriceTierSlug) ?? null}
    priceLevel={card.priceLevel}
    onPress={() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (card.lat && card.lng) {
        Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${card.lat},${card.lng}`
        ).catch(() => {});
      } else if (card.address) {
        Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}`
        ).catch(() => {});
      }
    }}
  />
))}
```

**Remove unused styles from HolidayRow:**
Delete these style keys (they're replaced by PersonGridCard's internal styles):
`holidayCard`, `cardImageArea`, `cardImage`, `cardGradient`, `placeholderImage`, `categoryBadge`, `categoryText`, `cardContent`, `cardTitle`, `cardAddress`, `cardFooter`, `ratingRow`, `ratingText`, `mapHint`

**Keep these style keys** (they're used by the HolidayRow header/expanded area, not the cards):
`outerContainer`, `archivedOuter`, `swipeBackground`, `rowWrapper`, `row`, `rowLeft`, `rowTextGroup`, `holidayName`, `holidayDate`, `rowRight`, `daysBadge`, `daysBadgeText`, `actionButton`, `expandedArea`, `expandedStatus`, `loadingText`, `errorText`, `cardsScrollContent`

### 6.3 State Changes

**Zustand:** No Zustand changes.

**React Query keys affected:**
- **NEW:** `["hero-cards", personId]` — created by `useHeroCards`
- **EXISTING (unchanged):** `["holiday-cards", personId, holidayKey]` — used by `useHolidayCards` (backward compatible)
- **EXISTING (unchanged):** `["ai-summary", personId]` — used by `useAiSummary`
- **NO invalidation needed** between hero cards and holiday cards — they're independent queries with different data.

---

## 7. Implementation Order

**Step 1: Extend the edge function.**
- Open `supabase/functions/get-holiday-cards/index.ts`.
- Add the new request body fields (`description`, `mode`, `excludeCardIds`) to the `RequestBody` interface.
- Add the `derivePriceTier()` and `validateCategory()` utility functions.
- Extend the SELECT query to include `price_tier`, `description`, `card_type`.
- Add the `hasMore` field to the response.
- Implement the `mode === "hero"` logic (§5.1.5).
- Implement the `mode === "generate_more"` logic (§5.1.6).
- Ensure the existing `mode === "holiday"` (default) path is completely untouched.
- **Verify:** Deploy locally with `supabase functions serve`. Test with curl:
  - `mode: "holiday"` with existing params → same response as before + `hasMore: false` + new card fields (null if not in pool).
  - `mode: "hero"` with description → returns up to 5 cards with `cardType` and `priceTier`.
  - `mode: "generate_more"` with description + excludeCardIds → returns up to 5 new cards.
  - Missing auth → 401.
  - Invalid personId → 400.

**Step 2: Create `PersonGridCard` component.**
- Create `app-mobile/src/components/PersonGridCard.tsx` per §6.1.1.
- Match the GridCard design from DiscoverScreen pixel-for-pixel.
- **Verify:** Import in a test screen, render with mock data, compare visually to For You tab GridCards.

**Step 3: Create `PersonCuratedCard` component.**
- Create `app-mobile/src/components/PersonCuratedCard.tsx` per §6.1.2.
- Match the curated card design language (dark bg, amber badges, white text) in compact form.
- **Verify:** Render with mock data, compare visually to CuratedExperienceSwipeCard's design language.

**Step 4: Extend `holidayCardsService.ts`.**
- Add new fields to `HolidayCard` interface.
- Add `HolidayCardsResponse` interface.
- Add `getHolidayCardsWithMeta` function.
- **Do NOT modify** the existing `getHolidayCards` function.
- **Verify:** Call `getHolidayCardsWithMeta` with hero mode params from a test hook.

**Step 5: Create hooks.**
- Create `app-mobile/src/hooks/useHeroCards.ts` per §6.1.3.
- Create `app-mobile/src/hooks/useGenerateMoreCards.ts` per §6.1.4.
- **Verify:** Wire into a test component, confirm loading → success transition.

**Step 6: Modify `BirthdayHero.tsx`.**
- Add new props.
- Add age calculation.
- Add hero cards horizontal scroll.
- Add generate more button.
- Adjust container height.
- Handle all 4 state combinations (birthday±description).
- **Verify:** Visual check in all 4 states: birthday+description, birthday only, description only, neither.

**Step 7: Modify `PersonHolidayView.tsx`.**
- Wire up hero cards hook and generate more mutation.
- Pass new props to BirthdayHero.
- Remove PersonRecommendationCards.
- **Verify:** Full flow — add person → see hero → cards load → generate more works.

**Step 8: Modify `HolidayRow.tsx`.**
- Replace inline card rendering with PersonGridCard.
- Remove unused styles and imports.
- **Verify:** Expand a holiday → cards render in GridCard design → tap opens Maps.

**Step 9: Integration test.**
- Full end-to-end: Discover → For You → + → Add person (with audio) → See person page → Hero shows name, age, countdown, gift suggestion → 5 cards in hero → Tap "Generate More" → Up to 5 more cards appear → Expand a holiday → Cards in GridCard design → Tap a card → Google Maps opens.
- Test with linked person → same behavior + linked user boosting.
- Test with person without description → cards still appear (generic), no "Generate More" button.
- Test with person without birthday → "Person's Picks" header, cards still load.

---

## 8. Test Cases

| # | Test | Input | Expected Output | Layer |
|---|------|-------|-----------------|-------|
| 1 | Hero mode returns 5 cards | `mode: "hero"`, valid description, location near venues | 5 cards: 1 curated + 4 single, each with `priceTier`, `description`, `cardType` | Edge |
| 2 | Hero mode with no curated cards in pool | `mode: "hero"`, location with no curated cards | 4 cards (all single), `hasMore: true` | Edge |
| 3 | Hero mode with null description | `mode: "hero"`, `description: null` | 4 cards (Fine Dining, Watch, Play + 1 random category), no GPT call for description_match | Edge |
| 4 | Generate more returns up to 5 cards | `mode: "generate_more"`, valid description, excludeCardIds from hero | Up to 5 new cards, none with IDs in excludeCardIds | Edge |
| 5 | Generate more with exhausted pool | `mode: "generate_more"`, excludeCardIds covers all pool cards | Cards from Google Places fallback, `hasMore: false` if Google also exhausted | Edge |
| 6 | Holiday mode backward compat | `mode: undefined`, existing params | Identical response to current behavior + `hasMore: false`, new fields nullable | Edge |
| 7 | GPT returns non-canonical category | GPT responds `"Bars & Nightlife"` | `validateCategory()` resolves or defaults to "Casual Eats" | Edge |
| 8 | GPT call fails (network error) | OpenAI API timeout | Falls back to categorySlugs, cards still returned, no 500 error | Edge |
| 9 | PersonGridCard renders correctly | Valid card data with priceTier "comfy" | Image + icon badge (bottom-left, white bg, orange icon) + title + category + "Comfy · $50 – $150" + arrow | Component |
| 10 | PersonGridCard with null imageUrl | `imageUrl: null`, category "Watch" | Gray placeholder with film-outline icon centered | Component |
| 11 | PersonGridCard with null priceTier | `priceTier: null`, `priceLevel: "PRICE_LEVEL_MODERATE"` | Derives "comfy", displays "Comfy · $50 – $150" | Component |
| 12 | PersonCuratedCard renders dark theme | Valid curated card data | Dark background (#1C1C1E), amber badge, white text, stop count | Component |
| 13 | BirthdayHero shows age | Person with birthday "1998-03-15", today is 2026-03-12 | Shows "Turning 28" (next birthday age) | Component |
| 14 | BirthdayHero no birthday | `person.birthday: null` | Shows "Person's Picks", no age/countdown, hero cards still visible | Component |
| 15 | BirthdayHero no description | `person.description: null` | Hero cards load (generic), "Generate More" button hidden | Component |
| 16 | Generate More button disappears | User taps "Generate More" 5 times (or `hasMore: false` returned) | Button disappears, no more taps possible | Component |
| 17 | HolidayRow uses GridCard design | Expand "Valentine's Day" holiday | Cards render as PersonGridCard (image + icon badge + title + category + price + arrow) | Component |
| 18 | Card tap opens Maps | Tap any card with `lat: 40.7128, lng: -74.006` | Opens Google Maps at those coordinates | Component |
| 19 | Existing holiday flow unchanged | Navigate to person page, expand a holiday (no new params sent) | Cards load exactly as before (mode defaults to "holiday") | Integration |
| 20 | Full flow: add person with audio → hero cards | Add person with audio recording → AI processes → view person page | Hero shows 5 cards matched to description + gift suggestion | Integration |

---

## 9. Common Mistakes to Avoid

1. **Modifying `getHolidayCards` return type:** The existing function returns `HolidayCard[]`. Changing it to `HolidayCardsResponse` breaks `useHolidayCards` and every HolidayRow. → **Correct approach:** Create a new `getHolidayCardsWithMeta` function. Leave the old one untouched.

2. **Trusting GPT category output without validation:** GPT-4o-mini may return category names like "Bars & Nightlife", "Fine_Dining", or "fine dining" — none of which match `card_pool.category` exactly. → **Correct approach:** Always pass GPT output through `resolveCategory()` + `ALL_CATEGORY_NAMES` validation. Default to "Casual Eats" if resolution fails.

3. **Hardcoding hero container height:** The hero section now contains cards (variable count, 0–10). A fixed `SCREEN_HEIGHT * 0.55` may clip on small screens or waste space on large ones. → **Correct approach:** Use `SCREEN_HEIGHT * 0.55` as a fixed height. The cards are in a horizontal ScrollView, so vertical space is constant regardless of card count. The scroll handles overflow horizontally.

4. **Forgetting `priceTier` derivation on Google Places fallback cards:** Google Places returns `priceLevel` (e.g., "PRICE_LEVEL_MODERATE"), not `priceTier`. If you only check `card_pool.price_tier`, Google fallback cards will have `priceTier: null` and display "Chill" incorrectly. → **Correct approach:** Always call `derivePriceTier(card.priceTier, card.priceLevel)` in the edge function response builder.

5. **Breaking the `mode === undefined` path:** The default mode must behave exactly like the current function. Do NOT move existing logic into a conditional branch that might not execute when mode is undefined. → **Correct approach:** Add `const effectiveMode = body.mode ?? "holiday";` at the top. Wrap new logic in `if (effectiveMode === "hero" || effectiveMode === "generate_more") { ... } else { /* existing code, untouched */ }`.

6. **Race condition in `generatedCards` state:** If the user taps "Generate More" rapidly twice, two mutations fire. The second `onSuccess` callback captures a stale `allHeroCardIds` (missing cards from the first batch), causing duplicate card IDs in `excludeCardIds`. → **Correct approach:** Use a functional updater `setGeneratedCards(prev => [...prev, ...response.cards])` (already specified above) AND derive `excludeCardIds` from the latest state at mutation time. The `useMemo` on `allHeroCardIds` + the `useCallback` dependency on it ensures the second mutation sees the updated list. However, if both mutations are in-flight simultaneously, the second one was constructed before the first completed. **Mitigate:** Disable the "Generate More" button while `generateMoreMutation.isPending` — the button's `onPress` is gated by `!isGenerating`.

7. **Removing `PersonRecommendationCards` import but not the component file:** After removing the `<PersonRecommendationCards>` usage from PersonHolidayView, the file `PersonRecommendationCards.tsx` becomes unused. → **Correct approach:** Do NOT delete the file in this PR. It may be referenced elsewhere or needed for rollback. Just remove the import and usage from PersonHolidayView. A follow-up cleanup PR can delete the file after verifying zero imports.

---

## 10. Pre-Existing Issues to Fix in This Spec

### 10.1 Category Mismatch in `process-person-audio` (CRITICAL)

**Problem:** The GPT prompt in `process-person-audio/index.ts` (line 187) uses a hardcoded category list that does NOT match the canonical 12 categories in `categoryPlaceTypes.ts`. The prompt lists: "Fine Dining, Casual Eats, Bars & Nightlife, Coffee & Cafe, Outdoor Adventures, Arts & Culture, Wellness & Spa, Shopping, Entertainment, Live Music, Sports & Recreation, Date Night". Only 2 of these ("Fine Dining", "Casual Eats") match canonical categories exactly.

**Impact on this feature:** When `get-holiday-cards` (hero mode) uses the description to extract categories via GPT, it will extract canonical categories correctly (because our new prompt uses the correct list). However, if someone later tries to use the `categories` field stored by `process-person-audio` in `person_audio_clips` or `saved_people`, they'll get non-canonical values.

**Fix (scope: this spec):** The new GPT prompts in `get-holiday-cards` (§5.1.5, §5.1.6) use the correct canonical category list. This feature does NOT read from `process-person-audio`'s stored categories — it reads `saved_people.description` (free text) and extracts categories fresh. No fix to `process-person-audio` is needed for this feature to work correctly. However, we recommend fixing `process-person-audio`'s prompt in a separate PR to align all systems.

### 10.2 `person_experiences` Table — Dead Data

**Problem:** `generate-person-experiences` writes to `person_experiences` but nothing reads from it in the rendering pipeline.

**Impact on this feature:** None. This feature reads from `card_pool` and Google Places, not `person_experiences`. The dead table is a separate concern.

**Recommendation:** Do not touch `person_experiences` in this PR. Address in a separate cleanup PR.

### 10.3 New Card Fields Backward Compatibility

**Problem:** The extended `Card` response from `get-holiday-cards` includes `priceTier`, `description`, and `cardType`. Existing consumers (HolidayRow via `useHolidayCards`) will receive these new fields but currently ignore them.

**Impact:** Zero. HolidayRow currently destructures only the fields it uses. After this spec is implemented, HolidayRow switches to `PersonGridCard` which uses `priceTier`. The transition is atomic — both changes land in the same PR.

**Safeguard:** The edge function always returns these new fields (with sensible defaults: `priceTier` derived from `priceLevel`, `description` from pool or fallback, `cardType: "single"`). No consumer can receive `undefined` for these fields.

---

## 11. Stability & Drift Analysis

### 11.1 Will It Break Under Load?

**GPT calls in the edge function:** Hero mode makes 1 GPT call (category extraction). Generate_more mode makes 1 GPT call. These are lightweight (50–100 token responses, gpt-4o-mini). At scale:
- Each person page view = 1 GPT call (hero mode).
- Each "Generate More" tap = 1 GPT call.
- **Mitigation:** The hero cards are cached for 30 minutes via React Query. Repeated views of the same person don't trigger new GPT calls. The GPT call is also inside a try/catch with graceful fallback — if OpenAI is slow or down, cards still load from pool/Google Places.

**Google Places API calls:** Only triggered when `card_pool` has no results for a category. As the pool fills up from discover-cards (which warm the pool), Google Places fallbacks become rare. No new cost concern beyond existing patterns.

### 11.2 Will It Break Something Else?

**DiscoverScreen's GridCard:** Untouched. `PersonGridCard` is a separate component with identical visual output but independent code. Changes to one don't affect the other.

**HolidayRow's expanded cards:** Replaced with `PersonGridCard`. The data contract is the same (`HolidayCard` interface) — just the rendering component changes. The `useHolidayCards` hook, its query key, and the `get-holiday-cards` edge function's holiday mode are all unchanged.

**PersonRecommendationCards:** Removed from PersonHolidayView but the file is not deleted. If it's imported elsewhere (it's not — verified), it continues to work.

**useAiSummary:** Completely unchanged. It's called in PersonHolidayView and its result is passed to BirthdayHero as before.

**AddPersonModal:** Completely unchanged. It creates a person with `description: null` and uploads audio in the background. The audio processing pipeline eventually populates `description`. When the user next views the person page, hero cards use the populated description.

### 11.3 Will It Drift?

**Risk: DiscoverScreen GridCard design changes but PersonGridCard doesn't update.**
- Likelihood: Medium (design iteration on For You tab is ongoing).
- Impact: Visual inconsistency between For You tab and person page.
- Mitigation: This is an accepted tradeoff of code duplication. The alternative (extracting GridCard from DiscoverScreen into a shared component) has a higher blast radius and touches a 3500+ line file. If the design changes, update both components in the same PR. Document this coupling in a code comment at the top of `PersonGridCard.tsx`.

**Risk: `card_pool` schema changes break the extended SELECT.**
- Likelihood: Low (schema is stable, behind migrations).
- Impact: Edge function fails, cards don't load.
- Mitigation: The SELECT explicitly names columns (not `SELECT *`). Any breaking schema change would require a migration that's reviewed before deploy.

**Risk: Price tier system changes.**
- Likelihood: Low (price tiers are a business decision, not a technical iteration target).
- Impact: PersonGridCard shows wrong prices.
- Mitigation: `priceTiers.ts` is the single source of truth on mobile. `derivePriceTier` on the server mirrors it. If tiers change, update both.

### 11.4 Edge Cases That Must Not Fail

| Scenario | Expected Behavior | How It's Handled |
|----------|-------------------|------------------|
| Person has no description AND no birthday | Hero shows "Person's Picks" + generic cards (location-based) | `useHeroCards` sends `description: null`, edge function skips GPT, queries pool by category only |
| Person has description but card_pool is empty for all categories | Hero cards from Google Places fallback | Existing fallback logic in get-holiday-cards (lines 214–286) |
| Person has description but Google Places API is down | Hero shows 0 cards (empty scroll area) | GPT call succeeds, pool query returns empty, Google fallback fails silently → empty cards array |
| User taps "Generate More" with no internet | Mutation fails, button stays enabled, no crash | `useMutation` handles errors; `isPending` resets to false on error |
| User navigates away mid-generation | Mutation completes in background, state update on unmounted component | React Query handles this — mutation result is discarded if component unmounted |
| `card_pool.description` is NULL | PersonGridCard never shows description (it's not in the visual spec — GridCard doesn't display description text) | `description` field exists on the data model but is not rendered by PersonGridCard |
| Curated card has no stops data | PersonCuratedCard shows "1 stop" or hides stop count | `stops` prop defaults to 0; if 0, hide the stop badge |

---

## 12. Handoff to Implementor

Implementor: this document is your single source of truth. Execute it top to bottom, in the exact order specified in §7. Do not skip steps. Do not reorder steps. Do not add features, refactor adjacent code, or "improve" anything outside the scope of this spec. Every file path, function signature, type definition, SQL statement, and validation rule in this document is intentional and exact — copy them precisely. If something in this spec is unclear or seems wrong, stop and ask before improvising. When you are finished, produce your IMPLEMENTATION_REPORT.md referencing each section of this spec to confirm compliance, then hand the implementation to the tester. Your work is not done until the tester's report comes back green.

**Key reminders:**
- Do NOT modify `getHolidayCards()` — create `getHolidayCardsWithMeta()` alongside it.
- Do NOT modify DiscoverScreen.tsx — create a separate `PersonGridCard` component.
- Do NOT delete `PersonRecommendationCards.tsx` — only remove its usage from PersonHolidayView.
- Do NOT touch `process-person-audio` — its category mismatch is a separate concern.
- The `mode ?? "holiday"` default is your backward compatibility lifeline — protect it.
