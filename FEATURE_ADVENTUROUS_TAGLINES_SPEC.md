# Feature: Adventurous Card Taglines Fix
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Fix solo-focused taglines on curated cards — make them exploratory and experience-type-aware

## Summary
The curated experience cards currently show solo-focused taglines like "The perfect day for one" and "A full solo day out" regardless of experience type. This is incorrect for romantic, first-dates, group-fun, friendly, and business cards. The fix replaces the single hardcoded tagline array with a per-experience-type tagline map, using exploratory/adventurous language for solo-adventure cards and appropriate language for each other type.

## User Story
As a user viewing an expanded curated card, I want the tagline to match my experience type so that it feels relevant and exciting rather than always solo-focused.

## Architecture Impact
- **New files:** none
- **Modified files:**
  - `supabase/functions/generate-curated-experiences/index.ts` — replace hardcoded taglines with experience-type-aware map
- **New DB tables/columns:** none
- **New edge functions:** none
- **External APIs:** none

## Edge Function Changes

### File: `supabase/functions/generate-curated-experiences/index.ts`

**What changes:**
Replace the two identical hardcoded tagline arrays (lines 761 and 840) with a single `TAGLINES_BY_TYPE` constant defined once near the top of the file, then reference it in both `buildCuratedCard()` and `resolvePairing()`.

**New constant (place near other constants, e.g. after PAIRINGS_BY_TYPE ~line 225):**

```typescript
const TAGLINES_BY_TYPE: Record<string, string[]> = {
  'solo-adventure': [
    'Explore the unexpected — your next discovery awaits',
    'Three stops, endless possibilities',
    'Chart your own path through the city',
    'For the curious soul who loves to wander',
  ],
  'first-dates': [
    'A thoughtful route for a great first impression',
    'Three stops to break the ice',
    'An effortless plan for getting to know someone',
    'Low pressure, high adventure',
  ],
  'romantic': [
    'A curated route for two',
    'Three stops to make the night unforgettable',
    'Romance awaits around every corner',
    'Set the mood with a plan worth sharing',
  ],
  'friendly': [
    'A day out worth catching up over',
    'Three stops, good company, great vibes',
    'The kind of plan friends remember',
    'Explore together, no planning needed',
  ],
  'group-fun': [
    'Rally the crew — adventure is calling',
    'Three stops of pure group energy',
    'Good times are better together',
    'A plan the whole squad will love',
  ],
  'business': [
    'A polished route for professional connections',
    'Three stops to impress and connect',
    'Networking meets exploration',
    'A curated outing for business minds',
  ],
};

const DEFAULT_TAGLINES = TAGLINES_BY_TYPE['solo-adventure'];
```

**In `buildCuratedCard()` (currently line 761), replace:**
```typescript
const taglines = ['A full solo day out', 'Three stops, zero plans needed', 'Discover your city, one stop at a time', 'The perfect day for one'];
```
**With:**
```typescript
const taglines = TAGLINES_BY_TYPE[experienceType] ?? DEFAULT_TAGLINES;
```

**In `resolvePairing()` (currently line 840), replace:**
```typescript
const taglines = ['A full solo day out', 'Three stops, zero plans needed', 'Discover your city, one stop at a time', 'The perfect day for one'];
```
**With:**
```typescript
const taglines = TAGLINES_BY_TYPE[experienceType] ?? DEFAULT_TAGLINES;
```

Both functions already receive `experienceType` as a parameter, so no signature changes needed.

## Mobile Implementation
No mobile changes required — the tagline is already rendered from `card.tagline` in ExpandedCardModal.tsx line 449. The fix is purely server-side.

## Test Cases
1. Generate solo-adventure curated cards → tagline should be one of the 4 exploratory taglines (never "The perfect day for one")
2. Generate romantic curated cards → tagline should be romantic-themed
3. Generate group-fun curated cards → tagline should be group-themed
4. Generate first-dates curated cards → tagline should be date-themed
5. Generate an unknown experienceType → should fall back to solo-adventure taglines (not crash)

## Success Criteria
- [ ] No curated card tagline says "The perfect day for one" or "A full solo day out"
- [ ] Solo-adventure cards show exploratory/adventurous taglines
- [ ] Each experience type gets contextually appropriate taglines
- [ ] Edge function deploys without errors
