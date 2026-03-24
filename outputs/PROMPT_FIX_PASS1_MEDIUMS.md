# Fix Prompt: Pass 1 — 3 Medium Findings

**Skill:** Implementor
**Date:** 2026-03-24
**Source:** outputs/TEST_PASS1_KILL_THE_LIES.md
**Scope:** 3 mechanical fixes. ~30 seconds of work total.

---

## MED-001: Remove unused `tierLabel` import from PersonHolidayView

**File:** `app-mobile/src/components/PersonHolidayView.tsx` (line 29)

Change:
```typescript
// BEFORE:
import { PriceTierSlug, tierLabel, formatTierLabel } from "../constants/priceTiers";

// AFTER:
import { PriceTierSlug, formatTierLabel } from "../constants/priceTiers";
```

---

## MED-002: Guard whitespace-only `card.title` in SavedTab

**File:** `app-mobile/src/components/activity/SavedTab.tsx` (line ~1814)

Change:
```typescript
// BEFORE:
{card.title || stops.map(s => s.placeName).join(' → ')}

// AFTER:
{card.title?.trim() || stops.map(s => s.placeName).join(' → ')}
```

---

## MED-003: Remove fabricated "4.5" rating from SwipeableSessionCards

**File:** `app-mobile/src/components/board/SwipeableSessionCards.tsx` (line 442)

Apply the same conditional-render pattern used in BoardSessionCard:

```typescript
// BEFORE:
<View style={styles.statItem}>
  <Icon name="star" size={14} color="#eb7825" />
  <Text style={styles.statText}>
    {cardData.rating?.toFixed(1) || "4.5"}
  </Text>
</View>

// AFTER:
{cardData.rating != null && cardData.rating > 0 && (
  <View style={styles.statItem}>
    <Icon name="star" size={14} color="#eb7825" />
    <Text style={styles.statText}>
      {Number(cardData.rating).toFixed(1)}
    </Text>
  </View>
)}
```

---

## Constraints

- Only these 3 files, only these 3 changes
- No scope creep
