# Feature: Recommendation Type Unification
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Resolve Recommendation type mismatch between RecommendationsContext and CardsCacheContext

## Summary
Two independent `Recommendation` interfaces exist in the codebase — one in `CardsCacheContext.tsx` (narrow, outdated) and one in `RecommendationsContext.tsx` (full, current). They diverged as features like nature cards, curated strolls, and place details were added only to the RecommendationsContext version. This fix extracts a single canonical `Recommendation` type into a shared types file, then has both contexts import from it. Zero runtime behavior changes — this is a compile-time-only correction.

## User Story
As a developer, I want a single canonical `Recommendation` type so that TypeScript correctly reflects the full shape of card objects flowing through the cache and recommendation pipelines, preventing silent type errors and unsafe casts.

## Problem Analysis

### Two diverged interfaces

| Field | CardsCacheContext | RecommendationsContext |
|-------|-------------------|------------------------|
| `openingHours` | `string` | `string \| { open_now?: boolean; weekday_text?: string[] } \| null` |
| `website` | missing | `string \| null` (optional) |
| `phone` | missing | `string \| null` (optional) |
| `placeId` | missing | `string` (optional) |
| `strollData` | missing | full stroll object (optional) |

### Circular dependency constraint
- `RecommendationsContext.tsx` imports `useCardsCache` from `CardsCacheContext.tsx`
- Therefore `CardsCacheContext` **cannot** import from `RecommendationsContext`
- Solution: extract to a third file (`types/recommendation.ts`)

### Consumer import sites (all import from RecommendationsContext — none from CardsCacheContext)
- `SwipeableCards.tsx` — `import { Recommendation } from "../contexts/RecommendationsContext"`
- `DiscoverScreen.tsx` — `import { Recommendation } from "../contexts/RecommendationsContext"`
- `useDiscoverQuery.ts` — `import { Recommendation } from "../contexts/RecommendationsContext"`
- `useRecommendationsQuery.ts` — `import { Recommendation } from "../contexts/RecommendationsContext"`
- `ExpandedCardModal.tsx` — uses `useRecommendations` (no direct type import)

## Architecture Impact

- **New files:** `app-mobile/src/types/recommendation.ts` — canonical Recommendation interface
- **Modified files:**
  - `app-mobile/src/contexts/CardsCacheContext.tsx` — delete local interface, import from types file
  - `app-mobile/src/contexts/RecommendationsContext.tsx` — delete local interface, import + re-export from types file
- **No new DB tables/columns**
- **No new edge functions**
- **No external API changes**

### Files NOT modified (zero consumer changes needed)
- `SwipeableCards.tsx` — keeps importing from RecommendationsContext (which re-exports)
- `DiscoverScreen.tsx` — same
- `useDiscoverQuery.ts` — same
- `useRecommendationsQuery.ts` — same
- `ExpandedCardModal.tsx` — same

## Implementation

### Step 1: Create `app-mobile/src/types/recommendation.ts`

Extract the FULL Recommendation interface (from RecommendationsContext) into this new file. This becomes the single source of truth.

```typescript
/**
 * Canonical Recommendation type used across the entire card pipeline.
 *
 * Regular cards have the base fields.
 * Nature cards add: website, phone, placeId, complex openingHours.
 * Curated cards add: strollData + cardType discriminator (via runtime cast).
 */
export interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: string;
  lat?: number;
  lng?: number;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  priceRange: string;
  distance: string;
  travelTime: string;
  experienceType: string;
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours:
    | string
    | {
        open_now?: boolean;
        weekday_text?: string[];
      }
    | null;
  tags: string[];
  matchScore: number;
  reviewCount: number;
  website?: string | null;
  phone?: string | null;
  placeId?: string;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  strollData?: {
    anchor: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
    };
    companionStops: Array<{
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
      rating?: number;
      reviewCount?: number;
      imageUrl?: string | null;
      placeId: string;
      type: string;
    }>;
    route: {
      duration: number;
      startLocation: { lat: number; lng: number };
      endLocation: { lat: number; lng: number };
    };
    timeline: Array<{
      step: number;
      type: string;
      title: string;
      location: any;
      description: string;
      duration: number;
    }>;
  };
}
```

### Step 2: Update CardsCacheContext.tsx

**Delete** lines 12-49 (the entire local `Recommendation` interface).
**Add** import at top:
```typescript
import { Recommendation } from "../types/recommendation";
```

No other changes needed — `CardsCacheEntry`, `setCachedCards`, and all internal usage automatically picks up the imported type.

### Step 3: Update RecommendationsContext.tsx

**Delete** lines 31-109 (the entire local `Recommendation` interface).
**Add** import at top:
```typescript
import { Recommendation } from "../types/recommendation";
```
**Add** re-export so all consumer imports continue working:
```typescript
export type { Recommendation };
```

No other changes needed — all consumer files import `Recommendation` from `RecommendationsContext`, and the re-export preserves that contract.

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Consumer import breaks | **None** | RecommendationsContext re-exports the type — all existing imports work unchanged |
| Circular dependency | **None** | Both contexts import from `types/recommendation.ts`, not from each other |
| Runtime behavior change | **None** | TypeScript types are erased at compile time — zero JS output change |
| CardsCacheContext now accepts wider type | **Intended** | The cache already stores full objects at runtime; now TS knows about it |

## Test Cases

1. **TypeScript compilation passes** — `npx tsc --noEmit` with zero errors related to Recommendation
2. **Cache round-trip preserves strollData** — Write a Recommendation with `strollData` into cache, read it back, verify strollData is accessible without type assertion
3. **Nature card openingHours** — `natureToRecommendation()` output can be passed to `setCachedCards()` without type error
4. **Existing consumer imports work** — All files that `import { Recommendation } from "../contexts/RecommendationsContext"` compile without changes
5. **App builds successfully** — `npx expo start` runs without errors

## Success Criteria

- [ ] Single `Recommendation` interface in `types/recommendation.ts`
- [ ] Zero duplicate `Recommendation` interface definitions in the codebase
- [ ] All existing imports compile without modification
- [ ] No circular dependencies introduced
- [ ] App builds and runs identically to before
