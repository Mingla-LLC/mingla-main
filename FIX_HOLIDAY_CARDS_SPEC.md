# Fix: Holiday Cards — Interaction, Styling, and Data Pipeline

**Date:** 2026-03-12
**Status:** Planned
**Requested by:** Cards in upcoming holidays don't display properly, aren't clickable/expandable, look stale, show slug labels instead of readable names, and the data pipeline delivers wrong/thin results.

---

## 1. Summary

Holiday cards inside the expanded HolidayRow are broken across three layers: **interaction** (cards are `<View>` — not tappable, no destination), **data** (category slug mismatch between mobile and card_pool causes pool misses; intent types leak through as raw slugs; Google Places fallback produces imageless cards; only 1 card per category), and **styling** (tiny cards, flat shadows, cramped content, no gradient overlay, no category color). This spec fixes all three layers to produce tappable, properly-styled, data-rich cards that open Google Maps on tap.

## 2. User Story

As a user viewing a person's holiday page, I want to expand a holiday row and see beautiful, tappable cards with proper category labels, venue images, and ratings — so I can tap one to open it in Google Maps and plan my outing.

## 3. Success Criteria

1. When the user expands a holiday row, 3-5 cards appear in a horizontal scroll — each with a venue image, readable category label (e.g., "Fine Dining" not "fine_dining"), title, address, and rating.
2. When the user taps a card, Google Maps opens centered on that venue (using coordinates if available, address as fallback).
3. Category badges display the readable name with the category's designated color background (from `getCategoryColor()`).
4. Cards from the pool display their stored `image_url`. Cards from Google Places fallback display the photo from the Places response.
5. Intent-based sections (romantic, adventurous) resolve to their mapped category slugs via `INTENT_CATEGORY_MAP` before being sent to the edge function.
6. The edge function queries card_pool with display names (matching how pool stores categories), not raw slugs.
7. Cards feel premium: proper elevation, gradient overlay on images, adequate sizing, breathing room in content area.
8. PersonRecommendationCards (below birthday hero) use the same interaction and styling improvements.

---

## 4. Database Changes

None. No schema changes required.

---

## 5. Edge Function Changes

### 5.1 `get-holiday-cards/index.ts`

**What changes:**
1. Replace the simplified `CATEGORY_TYPE_MAP` with the canonical `_shared/categoryPlaceTypes.ts`
2. Resolve incoming slugs to display names before querying card_pool (pool stores display names)
3. Extract Google Places photo URLs in the fallback path
4. Return up to 3 cards per category instead of 1
5. Include `lat`/`lng` in the Card response for map navigation

**Request body changes — add `lat` and `lng` to Card interface:**

```typescript
interface Card {
  id: string;
  title: string;
  category: string;          // NOW: display name (e.g., "Fine Dining")
  categorySlug: string;      // NEW: original slug for client-side color/icon lookup
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
  lat: number | null;         // NEW
  lng: number | null;         // NEW
}
```

**Implementation changes (in exact order):**

**Step 1: Replace CATEGORY_TYPE_MAP with canonical import.**

Delete lines 13-27 (the hardcoded `CATEGORY_TYPE_MAP` and `getIncludedTypes` function). Replace with:

```typescript
import { getPlaceTypesForCategory, resolveCategory } from '../_shared/categoryPlaceTypes.ts';
```

Replace `getIncludedTypes(slug)` calls with `getPlaceTypesForCategory(resolveCategory(slug) ?? slug)`.

**Step 2: Resolve slugs to display names before querying card_pool.**

After the `const slugs = categorySlugs.slice(0, 3);` line, add:

```typescript
// Resolve slugs to display names (card_pool stores display names, not slugs)
const resolvedCategories = slugs.map(slug => ({
  slug,
  displayName: resolveCategory(slug) ?? slug,
}));
```

Change the pool query (line 188) from `.eq("category", slug)` to `.eq("category", resolved.displayName)`:

```typescript
for (const resolved of resolvedCategories) {
  const { data: poolCards, error: poolError } = await adminClient
    .from("card_pool")
    .select("id, title, category, image_url, rating, price_level, address, google_place_id, lat, lng")
    .eq("category", resolved.displayName)
    .gte("latitude", latMin)
    // ... rest stays the same
    .limit(5);
```

**Step 3: Return up to 3 cards per category instead of 1.**

Replace the "pick the best card" logic (lines 196-217) with:

```typescript
if (poolCards && poolCards.length > 0) {
  // Take up to 3 cards, boosting linked user's saved cards to the top
  let sorted = [...poolCards];
  if (linkedUserId && linkedSavedCardIds.size > 0) {
    sorted.sort((a: any, b: any) => {
      const aLinked = linkedSavedCardIds.has(a.id) ? 1 : 0;
      const bLinked = linkedSavedCardIds.has(b.id) ? 1 : 0;
      if (aLinked !== bLinked) return bLinked - aLinked;
      return (b.rating || 0) - (a.rating || 0);
    });
  }

  for (const chosen of sorted.slice(0, 3)) {
    cards.push({
      id: chosen.id,
      title: chosen.title,
      category: chosen.category,
      categorySlug: resolved.slug,
      imageUrl: chosen.image_url ?? null,
      rating: chosen.rating ?? null,
      priceLevel: chosen.price_level ?? null,
      address: chosen.address ?? null,
      googlePlaceId: chosen.google_place_id ?? null,
      lat: chosen.lat ?? null,
      lng: chosen.lng ?? null,
    });
  }
}
```

**Step 4: Extract photo URL from Google Places fallback.**

In the Google Places fallback (lines 256-276), add `places.location` to the field mask and extract photos:

Change the field mask to:
```
"places.id,places.displayName,places.rating,places.priceLevel,places.formattedAddress,places.photos,places.location"
```

Replace the card push (lines 262-271) with:

```typescript
if (places.length > 0) {
  const topPlaces = places.slice(0, 3);
  for (const p of topPlaces) {
    const photoRef = p.photos?.[0]?.name;
    const imageUrl = photoRef
      ? `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=400&key=${googleApiKey}`
      : null;

    cards.push({
      id: p.id ?? "",
      title: p.displayName?.text ?? "Unknown",
      category: resolved.displayName,
      categorySlug: resolved.slug,
      imageUrl,
      rating: p.rating ?? null,
      priceLevel: p.priceLevel ?? null,
      address: p.formattedAddress ?? null,
      googlePlaceId: p.id ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
    });
  }
}
```

**Step 5: Update the card_pool column name for geo queries.**

The card_pool table uses `lat` and `lng` columns (not `latitude`/`longitude`). Verify the geo filter uses:
```typescript
.gte("lat", latMin)
.lte("lat", latMax)
.gte("lng", lngMin)
.lte("lng", lngMax)
```

---

## 6. Mobile Implementation

### 6.1 Files to Modify

#### 6.1.1 `services/holidayCardsService.ts` — Update HolidayCard interface

Add the new fields returned by the edge function:

```typescript
export interface HolidayCard {
  id: string;
  title: string;
  category: string;           // display name
  categorySlug: string;       // NEW — for color/icon lookup
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
  lat: number | null;          // NEW
  lng: number | null;          // NEW
}
```

#### 6.1.2 `components/PersonHolidayView.tsx` — Resolve intent types before passing as categorySlugs

**Where:** Lines 146-148, inside the `allHolidays` useMemo.

**Replace this:**
```typescript
const categorySlugs = holiday.sections
  .map((sec) => sec.categorySlug || sec.type)
  .filter(Boolean);
```

**With this:**
```typescript
const categorySlugs = holiday.sections
  .flatMap((sec) => {
    if (sec.categorySlug) return [sec.categorySlug];
    // Resolve intent types to their mapped category slugs
    const mapped = INTENT_CATEGORY_MAP[sec.type];
    return mapped ?? [];
  })
  .filter(Boolean);
```

**Add import at top:**
```typescript
import { INTENT_CATEGORY_MAP } from "../constants/holidays";
```

**Why:** Intent sections like `ROMANTIC_SECTION` (type: "romantic", no categorySlug) currently pass "romantic" as a raw slug. This resolves it to `['first_meet', 'drink', 'picnic', 'wellness', 'nature']` — real category slugs that match pool data and Google Places types.

#### 6.1.3 `components/HolidayRow.tsx` — Make cards tappable, fix styling, fix labels

**Full replacement of the card rendering section and styles.** This is the core visual and interaction fix.

**Add imports at top of file:**
```typescript
import { Linking } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { getReadableCategoryName, getCategoryColor, getCategoryIcon } from "../utils/categoryUtils";
```

**Replace the card rendering (lines 210-243) with:**

```typescript
{data.map((card) => {
  const categoryColor = getCategoryColor(card.categorySlug || card.category);
  const categoryIcon = getCategoryIcon(card.categorySlug || card.category);
  const categoryLabel = getReadableCategoryName(card.categorySlug || card.category);

  return (
    <TouchableOpacity
      key={card.id}
      style={styles.holidayCard}
      activeOpacity={0.85}
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
    >
      <View style={styles.cardImageArea}>
        {card.imageUrl ? (
          <Image
            source={{ uri: card.imageUrl }}
            style={styles.cardImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.cardImage, styles.placeholderImage]}>
            <Ionicons name={categoryIcon as any} size={s(28)} color="rgba(255,255,255,0.6)" />
          </View>
        )}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.5)"]}
          style={styles.cardGradient}
        />
        <View style={[styles.categoryBadge, { backgroundColor: categoryColor }]}>
          <Text style={styles.categoryText}>{categoryLabel}</Text>
        </View>
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {card.title}
        </Text>
        {card.address ? (
          <Text style={styles.cardAddress} numberOfLines={1}>
            {card.address}
          </Text>
        ) : null}
        <View style={styles.cardFooter}>
          {card.rating ? (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={s(11)} color="#F59E0B" />
              <Text style={styles.ratingText}>{card.rating.toFixed(1)}</Text>
            </View>
          ) : null}
          <View style={styles.mapHint}>
            <Ionicons name="navigate-outline" size={s(11)} color={colors.gray[400]} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
})}
```

**Replace the card-related styles (lines 343-401) with:**

```typescript
cardsScrollContent: {
  paddingHorizontal: s(16),
  paddingTop: vs(12),
  paddingBottom: vs(4),
  gap: s(12),
},
holidayCard: {
  width: s(180),
  height: s(230),
  borderRadius: s(16),
  backgroundColor: "#FFFFFF",
  overflow: "hidden",
  ...shadows.md,
},
cardImageArea: {
  width: "100%",
  height: "55%",
  position: "relative",
},
cardImage: {
  width: "100%",
  height: "100%",
},
cardGradient: {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  height: "50%",
},
placeholderImage: {
  backgroundColor: colors.gray[200],
  alignItems: "center",
  justifyContent: "center",
},
categoryBadge: {
  position: "absolute",
  top: s(8),
  left: s(8),
  paddingHorizontal: s(8),
  paddingVertical: vs(3),
  borderRadius: s(8),
},
categoryText: {
  fontSize: s(10),
  fontWeight: "700",
  color: "#FFFFFF",
},
cardContent: {
  flex: 1,
  padding: s(12),
  justifyContent: "space-between",
},
cardTitle: {
  fontSize: s(13),
  fontWeight: "700",
  color: colors.gray[800],
},
cardAddress: {
  fontSize: s(11),
  color: colors.gray[500],
  marginTop: vs(2),
},
cardFooter: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: vs(4),
},
ratingRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: s(3),
},
ratingText: {
  fontSize: s(11),
  fontWeight: "600",
  color: colors.gray[700],
},
mapHint: {
  opacity: 0.6,
},
```

#### 6.1.4 `components/PersonRecommendationCards.tsx` — Same fixes (tappable + styling + labels)

Apply the same pattern as HolidayRow:

**Add imports:**
```typescript
import { Linking } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { getReadableCategoryName, getCategoryColor, getCategoryIcon } from "../utils/categoryUtils";
```

**Replace the card `<View>` (line 94) with `<TouchableOpacity>` with the same onPress pattern:**

```typescript
<TouchableOpacity
  key={card.id}
  style={styles.card}
  activeOpacity={0.85}
  onPress={() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (card.location?.latitude && card.location?.longitude) {
      Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${card.location.latitude},${card.location.longitude}`
      ).catch(() => {});
    } else if (card.address) {
      Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}`
      ).catch(() => {});
    }
  }}
>
```

**Replace the category badge text with:**
```typescript
<Text style={styles.categoryText}>
  {getReadableCategoryName(card.category)}
</Text>
```

**Add the `LinearGradient` overlay inside `imageArea` after the image (same as HolidayRow).**

**Update the `categoryBadge` style to use dynamic color:**
```typescript
<View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(card.category) }]}>
```

**Import `Haptics`:**
```typescript
import * as Haptics from "expo-haptics";
```

---

## 7. Implementation Order

**Step 1: Update the edge function.**
Modify `supabase/functions/get-holiday-cards/index.ts` per §5.1. Deploy locally with `supabase functions serve`. Verify:
- Send a request with `categorySlugs: ["fine_dining", "romantic"]` → expect cards with `category: "Fine Dining"` and proper image URLs.
- Confirm pool queries now match (since pool stores display names and we now query with display names).
- Confirm Google Places fallback cards have `imageUrl` populated.
- Confirm up to 3 cards per category.

**Step 2: Update `holidayCardsService.ts`.**
Add `categorySlug`, `lat`, `lng` to the `HolidayCard` interface.

**Step 3: Fix intent type resolution in `PersonHolidayView.tsx`.**
Replace `sec.categorySlug || sec.type` with the `flatMap` + `INTENT_CATEGORY_MAP` logic from §6.1.2. Verify: expand Valentine's Day → request body should contain `categorySlugs: ["first_meet", "drink", "picnic", "wellness", "nature"]` (not `["romantic", "fine_dining"]`).

Wait — Valentine's Day sections are `[ROMANTIC_SECTION, FINE_DINING_SECTION]`. ROMANTIC_SECTION has no categorySlug, so it maps via INTENT_CATEGORY_MAP. FINE_DINING_SECTION has `categorySlug: "fine_dining"`. Result: `["first_meet", "drink", "picnic", "wellness", "nature", "fine_dining"]`. The edge function slices to first 3. This is correct.

**Step 4: Update `HolidayRow.tsx` — make cards tappable and restyle.**
Apply the full changes from §6.1.3. Verify:
- Cards show readable category labels with colored badges.
- Cards respond to tap with haptic feedback.
- Tapping opens Google Maps at the venue location.
- Cards have proper shadow, gradient overlay, adequate size.

**Step 5: Update `PersonRecommendationCards.tsx` — same treatment.**
Apply changes from §6.1.4. Verify cards are tappable and labels are readable.

**Step 6: Integration test.**
Open a person's holiday view. Expand multiple holidays. Confirm:
- Cards appear with images (from pool or from Places API photos).
- Category badges show readable names with colors.
- Tapping a card opens Google Maps.
- At least 3 cards appear per expanded holiday.
- No slug labels visible anywhere.

---

## 8. Test Cases

| # | Test | Input | Expected Output | Layer |
|---|------|-------|-----------------|-------|
| 1 | Cards are tappable | Tap any holiday card | Google Maps opens with venue location | Component |
| 2 | Category labels are readable | Expand any holiday | Badges show "Fine Dining", "Nature", not "fine_dining", "nature" | Component |
| 3 | Category badges have color | Expand any holiday | Each badge has its category color (violet for Fine Dining, emerald for Nature, etc.) | Component |
| 4 | Intent resolution works | Expand Valentine's Day (has ROMANTIC_SECTION) | Cards appear for First Meet, Drink, Picnic, Wellness, Nature categories (first 3 sent to edge fn) | Data |
| 5 | Pool category match works | Send `categorySlugs: ["fine_dining"]` to edge fn | Pool query uses `.eq("category", "Fine Dining")` matching pool storage | Edge Function |
| 6 | Google Places fallback has images | Force fallback (no pool cards for a category) | Cards have imageUrl populated from Places photos | Edge Function |
| 7 | Multiple cards per category | Expand any holiday | At least 2-3 cards appear (not just 1 per category) | Edge Function |
| 8 | Haptic feedback on tap | Tap a card | Light haptic fires before Maps opens | Component |
| 9 | Gradient overlay on images | View cards with images | Bottom gradient visible, badge readable | Component |
| 10 | Placeholder image has icon | View card with no image | Gray background with category icon centered | Component |
| 11 | Map fallback to address | Tap card with no lat/lng but has address | Google Maps opens searching for the address | Component |
| 12 | PersonRecommendationCards tappable | View linked person's recommendation cards | Cards respond to tap, open Google Maps | Component |

---

## 9. Common Mistakes to Avoid

1. **Querying card_pool with slugs instead of display names:** The pool stores `category` as display names ("Fine Dining", "Nature"). The incoming request uses slugs ("fine_dining", "nature"). You MUST resolve before querying. Use `resolveCategory()` from `_shared/categoryPlaceTypes.ts`.

2. **Forgetting to install/import `expo-linear-gradient`:** This package must be available. Run `npx expo install expo-linear-gradient` if not already installed. Check `package.json` first.

3. **Sending ALL resolved intent slugs to the edge function:** `INTENT_CATEGORY_MAP.romantic` maps to 5 slugs. The edge function already slices to 3 (`categorySlugs.slice(0, 3)`). This is fine — but be aware that which 3 are sent depends on the order of `flatMap`. If the order matters for quality, consider shuffling or prioritizing.

4. **Using `card.category` for color/icon lookup on the client:** After this fix, `card.category` will be a display name ("Fine Dining"). The `getCategoryColor()` function expects a slug. Use `card.categorySlug` (the new field) for color/icon lookups, or rely on the fact that `getCategoryColor` internally calls `getCategorySlug()` which handles display names too.

5. **Not closing the `<TouchableOpacity>` tag:** When replacing `<View>` with `<TouchableOpacity>`, make sure both the opening AND closing tags are replaced. The closing tag is on line 242 (`</View>`).

---

## 10. Handoff to Implementor

Implementor: this document is your single source of truth. Execute it top to bottom, in the exact order specified in §7. Do not skip steps. Do not reorder steps. Do not add features, refactor adjacent code, or "improve" anything outside the scope of this spec. Every file path, function signature, type definition, and validation rule in this document is intentional and exact — copy them precisely. If something in this spec is unclear or seems wrong, stop and ask before improvising. When you are finished, produce your IMPLEMENTATION_REPORT.md referencing each section of this spec to confirm compliance, then hand the implementation to the tester. Your work is not done until the tester's report comes back green.
