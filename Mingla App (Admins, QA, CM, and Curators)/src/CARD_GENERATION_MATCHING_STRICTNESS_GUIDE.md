# Card Generation & Matching Strictness - Complete Developer Guide

## Table of Contents
1. [Overview](#overview)
2. [How Preferences Influence Card Generation](#how-preferences-influence-card-generation)
3. [Strictness Levels](#strictness-levels)
4. [Filtering Pipeline (Step-by-Step)](#filtering-pipeline-step-by-step)
5. [Match Score Calculation](#match-score-calculation)
6. [Category-Specific Algorithms](#category-specific-algorithms)
7. [Real-World Examples](#real-world-examples)
8. [API Integration](#api-integration)
9. [Testing & Validation](#testing--validation)
10. [Performance Optimization](#performance-optimization)

---

## Overview

### The Card Generation System

Mingla's card generation system transforms user preferences into a **personalized feed of experience cards** using a multi-stage filtering and scoring pipeline. The system ensures users only see **highly relevant, high-quality matches** while maintaining enough variety to keep discovery exciting.

### Core Principles

```
┌────────────────────────────────────────────────────────────┐
│                  CARD GENERATION PRINCIPLES                 │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  1. STRICT FILTERING                                        │
│     • Hard requirements (budget, travel, availability)      │
│     • Cards that don't meet these are EXCLUDED             │
│     • No exceptions or "close enough" matches              │
│                                                             │
│  2. INTELLIGENT SCORING                                     │
│     • Remaining cards scored on quality of match           │
│     • Category-specific algorithms                         │
│     • Weighted factors based on user intent                │
│                                                             │
│  3. TRANSPARENT RANKING                                     │
│     • Users see WHY each card was recommended              │
│     • Match percentage shows quality (87% = great match)   │
│     • Breakdown shows which factors contributed            │
│                                                             │
│  4. QUALITY OVER QUANTITY                                   │
│     • Show 10 great cards, not 100 mediocre ones           │
│     • "No results" is better than bad matches              │
│     • Help users refine preferences when too restrictive   │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## How Preferences Influence Card Generation

### Complete Preference → Card Filtering Map

```typescript
interface UserPreferences {
  // 1. EXPERIENCE TYPES (Multi-select)
  experienceTypes: string[];
  // Controls: Which categories are available
  // Influence: Category filtering + scoring weights
  // Example: "romantic" → Only shows Sip & Chill, Picnics, Dining, Wellness
  
  // 2. CATEGORIES (Multi-select, filtered by experience types)
  categories: string[];
  // Controls: Primary filter - cards MUST match at least one
  // Influence: HARD FILTER (exclusion if no match)
  // Example: ["sipChill", "diningExp"] → Only coffee shops and restaurants
  
  // 3. BUDGET RANGE
  budgetMin: number;
  budgetMax: number;
  // Controls: Price per person range
  // Influence: HARD FILTER (exclusion if outside range)
  // Example: $25-75 → Excludes $15 and $100 experiences
  
  // 4. DATE & TIME
  dateOption: 'now' | 'today' | 'weekend' | 'pick';
  selectedDate: string;
  selectedTime: string;
  // Controls: Availability checking + arrival time calculation
  // Influence: HARD FILTER (exclusion if closed or can't arrive in time)
  // Example: "Today 7pm" → Excludes venues closed by 7pm
  
  // 5. TRAVEL MODE
  travelMode: 'walking' | 'biking' | 'transit' | 'driving';
  // Controls: How travel time is calculated (via Google Maps)
  // Influence: Affects travel constraint filtering + arrival time
  // Example: "walking" → Slower, so fewer distant venues qualify
  
  // 6. TRAVEL CONSTRAINT
  constraintType: 'time' | 'distance';
  timeConstraint: number;      // Minutes
  distanceConstraint: number;  // km or miles
  // Controls: Maximum acceptable travel
  // Influence: HARD FILTER (exclusion if beyond limit)
  // Example: "20 minutes" → Excludes venues >20min away via Google Maps
  
  // 7. LOCATION
  useLocation: 'gps' | 'search';
  searchLocation: string;
  // Controls: Origin point for all travel calculations
  // Influence: Determines which venues are "nearby"
  // Example: "Ferry Building, SF" → All distances measured from there
}
```

### Influence Hierarchy (Most Restrictive → Least Restrictive)

```
MOST RESTRICTIVE (Hard Filters - Exclusionary)
    ↓
1. CATEGORIES
   └─ If user selects 2 categories, ONLY those 2 appear
   └─ A dining card will NEVER show if only "Sip & Chill" selected

2. BUDGET RANGE
   └─ Cards outside range are EXCLUDED entirely
   └─ A $100 experience will NEVER show if budget is $25-75

3. TRAVEL CONSTRAINT
   └─ Cards beyond limit are EXCLUDED entirely
   └─ A 30-min venue will NEVER show if constraint is 20 minutes

4. DATE/TIME AVAILABILITY
   └─ Cards closed at target time are EXCLUDED entirely
   └─ A venue closed at 9pm will NEVER show for 9pm reservation

5. ARRIVAL TIME VALIDATION
   └─ If travel time causes late arrival after closing, EXCLUDED
   └─ A venue closing at 10pm + 45min travel from 9:15pm start = EXCLUDED
    ↓
LEAST RESTRICTIVE (Soft Factors - Scoring)
    ↓
6. EXPERIENCE TYPE FIT
   └─ Affects scoring but doesn't exclude
   └─ A "business" venue can still show for "romantic" (just lower score)

7. TIME OF DAY PREFERENCE
   └─ Affects scoring (brunch spots score higher at brunch time)
   └─ Doesn't exclude, just reorders

8. WEATHER PREFERENCE
   └─ Affects scoring (outdoor venues score lower if rainy)
   └─ Doesn't exclude, just reorders

9. AMBIENCE FACTORS
   └─ Affects scoring (quiet vs loud, intimate vs social)
   └─ Doesn't exclude, just reorders
```

---

## Strictness Levels

### Strictness Configuration

The system uses **adaptive strictness** based on preference completeness:

```typescript
interface StrictnessConfig {
  // LEVEL 1: ABSOLUTE (Cannot be violated)
  absoluteFilters: {
    categories: boolean;           // TRUE: Must match at least one selected category
    budget: boolean;               // TRUE: Must be within budget range
    travelConstraint: boolean;     // TRUE: Must be within travel limit
    availability: boolean;         // TRUE: Must be open at target time
  };
  
  // LEVEL 2: STRICT (Strong influence on scoring)
  strictFactors: {
    experienceTypeFit: number;     // Weight: 0.4 (40% of score)
    locationProximity: number;     // Weight: 0.25 (25% of score)
    categoryMatch: number;         // Weight: 0.2 (20% of score)
  };
  
  // LEVEL 3: MODERATE (Medium influence on scoring)
  moderateFactors: {
    budgetOptimality: number;      // Weight: 0.1 (10% of score)
    popularityScore: number;       // Weight: 0.05 (5% of score)
  };
  
  // LEVEL 4: SOFT (Minor influence on scoring)
  softFactors: {
    timeOfDayFit: number;         // Bonus: +5% if optimal time
    weatherSuitability: number;   // Bonus: +3% if weather-appropriate
    ambienceMatch: number;        // Bonus: +2% if ambience matches
  };
}
```

### When to Use Each Strictness Level

**ABSOLUTE FILTERS (Hard Exclusion)**
```typescript
// Use when:
// - User explicitly sets a constraint
// - Violating it would create a bad experience
// - Example: Budget, Travel Time, Availability

Example:
User sets budget: $25-75
Card costs: $100
Result: EXCLUDED (don't show at all)

Reason: Showing expensive cards to budget-conscious users is frustrating
```

**STRICT FACTORS (Major Scoring Impact)**
```typescript
// Use when:
// - Strong preference is indicated
// - Mismatch significantly reduces experience quality
// - Example: Experience Type, Category Match

Example:
User selects: "Romantic" experience type
Card: Bowling alley (Group Fun focused)
Result: INCLUDED but scored LOW (40% match)

Reason: User might still want it as an unconventional date, but it's deprioritized
```

**MODERATE FACTORS (Medium Scoring Impact)**
```typescript
// Use when:
// - Nice-to-have preference
// - Mismatch doesn't ruin experience
// - Example: Budget optimality (within range but not perfect)

Example:
User budget: $25-75
Card costs: $30 (near low end)
Result: INCLUDED and scored HIGH (95% budget match)

Card costs: $70 (near high end)
Result: INCLUDED but scored LOWER (75% budget match)

Reason: Both are acceptable, but mid-range is more comfortable
```

**SOFT FACTORS (Minor Scoring Impact)**
```typescript
// Use when:
// - Contextual enhancement
// - Bonus points for good timing
// - Example: Time of Day, Weather

Example:
User wants: "Afternoon" experience
Card: Brunch spot (best at 11am-1pm)
Result: INCLUDED but -5% score penalty for suboptimal timing

Reason: Still a valid choice, just not ideal for afternoon
```

---

## Filtering Pipeline (Step-by-Step)

### Complete Pipeline Visualization

```
┌─────────────────────────────────────────────────────────────┐
│              CARD GENERATION PIPELINE                        │
│                                                              │
│  INPUT: User Preferences + Current Location                 │
│  OUTPUT: Top 10 Matched & Scored Cards                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STEP 1: FETCH ALL CARDS                                      │
├─────────────────────────────────────────────────────────────┤
│ Source                     Priority    Count                 │
│ ────────────────────────────────────────────────            │
│ 1. Curator Cards           HIGH        ~50 cards             │
│ 2. Business Cards          MEDIUM      ~200 cards            │
│ 3. API-Generated Cards     LOW         ~1000+ cards          │
│                                                              │
│ Total Pool: ~1250 cards                                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: CATEGORY FILTER (HARD EXCLUSION)                    │
├─────────────────────────────────────────────────────────────┤
│ IF user selected categories:                                 │
│   KEEP only cards matching selectedCategories               │
│ ELSE:                                                        │
│   KEEP all cards                                            │
│                                                              │
│ Example:                                                     │
│   User selected: ["sipChill", "diningExp"]                  │
│   1250 cards → 350 cards (coffee shops + restaurants)       │
│                                                              │
│ Strictness: ABSOLUTE                                        │
│ Result: 350 cards remain                                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: BUDGET FILTER (HARD EXCLUSION)                      │
├─────────────────────────────────────────────────────────────┤
│ IF user set budget range:                                    │
│   KEEP only cards where:                                    │
│     card.pricePerPerson >= budgetMin AND                    │
│     card.pricePerPerson <= budgetMax                        │
│                                                              │
│ Example:                                                     │
│   User budget: $25-75                                       │
│   Card A: $20 → EXCLUDED (too cheap, might be low quality) │
│   Card B: $50 → INCLUDED                                    │
│   Card C: $100 → EXCLUDED (too expensive)                   │
│                                                              │
│ Strictness: ABSOLUTE                                        │
│ Result: 350 cards → 180 cards                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: DATE/TIME AVAILABILITY FILTER (HARD EXCLUSION)      │
├─────────────────────────────────────────────────────────────┤
│ IF user selected date/time:                                  │
│   FOR each card:                                            │
│     1. Check if venue operates on target day of week        │
│     2. Check if venue is open at target time                │
│     3. EXCLUDE if closed                                    │
│                                                              │
│ Example:                                                     │
│   User wants: Saturday 7:00 PM                              │
│                                                              │
│   Card A: Brunch cafe (closes 2pm)                          │
│     → operatesSaturday: true                                │
│     → openingHours: "8am-2pm"                               │
│     → isOpenAtTime(7pm)? FALSE → EXCLUDED                   │
│                                                              │
│   Card B: Wine bar (opens 5pm-midnight)                     │
│     → operatesSaturday: true                                │
│     → openingHours: "5pm-12am"                              │
│     → isOpenAtTime(7pm)? TRUE → INCLUDED                    │
│                                                              │
│ Strictness: ABSOLUTE                                        │
│ Result: 180 cards → 120 cards                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: TRAVEL TIME FILTER (HARD EXCLUSION)                 │
├─────────────────────────────────────────────────────────────┤
│ IF user set travel constraint:                               │
│   FOR each card:                                            │
│     1. Call Google Maps Distance Matrix API:                │
│        calculateRealTravelTime(                             │
│          origin: userLocation,                              │
│          destination: card.location,                        │
│          mode: preferences.travelMode,                      │
│          departureTime: preferences.scheduledTime           │
│        )                                                    │
│                                                              │
│     2. Check constraint:                                    │
│        IF constraintType === 'time':                        │
│          travelMinutes = result.durationSeconds / 60        │
│          EXCLUDE if travelMinutes > timeConstraint          │
│                                                              │
│        IF constraintType === 'distance':                    │
│          distanceKm = result.distanceMeters / 1000          │
│          EXCLUDE if distanceKm > distanceConstraint         │
│                                                              │
│ Example:                                                     │
│   User location: Ferry Building, San Francisco              │
│   Travel mode: walking                                      │
│   Constraint: 20 minutes max                                │
│                                                              │
│   Card A: Sightglass Coffee                                 │
│     → Google Maps: 5 minutes walking → INCLUDED             │
│                                                              │
│   Card B: Blue Bottle (Mission)                             │
│     → Google Maps: 32 minutes walking → EXCLUDED            │
│                                                              │
│   Card C: Ritual Coffee                                     │
│     → Google Maps: 18 minutes walking → INCLUDED            │
│                                                              │
│ Strictness: ABSOLUTE                                        │
│ Result: 120 cards → 65 cards                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: ARRIVAL TIME VALIDATION (HARD EXCLUSION)            │
├─────────────────────────────────────────────────────────────┤
│ IF user scheduled a specific time:                           │
│   FOR each card:                                            │
│     1. Calculate arrival time:                              │
│        arrivalTime = scheduledTime + travelTime             │
│                                                              │
│     2. Check if venue is still open at arrival:             │
│        isOpenAtTime(card.openingHours, arrivalTime)         │
│                                                              │
│     3. EXCLUDE if closed at arrival time                    │
│                                                              │
│ Example:                                                     │
│   User scheduled: 9:15 PM departure                         │
│                                                              │
│   Card A: Coffee shop (closes 10pm)                         │
│     → Travel time: 15 minutes                               │
│     → Arrival: 9:30 PM                                      │
│     → Still open? YES (closes 10pm) → INCLUDED              │
│                                                              │
│   Card B: Cafe (closes 9pm)                                 │
│     → Already past closing time → EXCLUDED                  │
│                                                              │
│   Card C: Wine bar (closes 10pm)                            │
│     → Travel time: 45 minutes                               │
│     → Arrival: 10:00 PM                                     │
│     → Still open? NO (arrives at closing) → EXCLUDED        │
│                                                              │
│ Strictness: ABSOLUTE                                        │
│ Result: 65 cards → 52 cards                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: SCORING (QUALITY RANKING)                           │
├─────────────────────────────────────────────────────────────┤
│ FOR each remaining card:                                     │
│   matchScore = calculateMatchScore(card, preferences)       │
│                                                              │
│ Uses category-specific algorithms:                          │
│   • Sip & Chill: Ambience + Experience Type Fit            │
│   • Dining: Cuisine + Formality + Romance Score            │
│   • Play & Move: Activity Level + Group Size               │
│   • Wellness: Intensity + Relaxation + Mindfulness         │
│   • Freestyle: Uniqueness + Surprise Factor                │
│   • etc.                                                    │
│                                                              │
│ Base Score Components:                                       │
│   1. Experience Type Fit    (40% weight)                    │
│   2. Location Proximity     (25% weight)                    │
│   3. Category Match         (20% weight)                    │
│   4. Budget Optimality      (10% weight)                    │
│   5. Popularity             (5% weight)                     │
│                                                              │
│ Bonuses:                                                     │
│   + Time of Day Fit         (+5% if optimal)                │
│   + Weather Suitability     (+3% if weather-good)           │
│   + Ambience Match          (+2% if vibes match)            │
│                                                              │
│ Maximum Score: 98%                                          │
│ (Intentionally not 100% to maintain authenticity)           │
│                                                              │
│ Result: 52 cards with scores ranging 62% - 94%             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: SORTING (RANK BY QUALITY)                           │
├─────────────────────────────────────────────────────────────┤
│ Sort cards by matchScore DESCENDING                         │
│                                                              │
│ Top 10:                                                      │
│   1. Card #247 - 94% match                                  │
│   2. Card #89  - 92% match                                  │
│   3. Card #412 - 91% match                                  │
│   4. Card #156 - 89% match                                  │
│   5. Card #332 - 87% match                                  │
│   6. Card #78  - 85% match                                  │
│   7. Card #501 - 83% match                                  │
│   8. Card #234 - 81% match                                  │
│   9. Card #445 - 79% match                                  │
│  10. Card #189 - 77% match                                  │
│                                                              │
│ Result: Sorted 52 cards                                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 9: PAGINATION (TOP N CARDS)                            │
├─────────────────────────────────────────────────────────────┤
│ Return top 10 cards for display                             │
│                                                              │
│ Why only 10?                                                 │
│   • Quality over quantity                                   │
│   • Users swipe through quickly                             │
│   • Can load more if needed                                 │
│   • Prevents decision fatigue                               │
│                                                              │
│ FINAL OUTPUT: 10 highly matched cards                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Match Score Calculation

### Base Score Formula

```typescript
/**
 * Calculate match score (0-100) for a card based on preferences
 */
function calculateMatchScore(
  card: Card,
  preferences: UserPreferences
): number {
  
  // STEP 1: Category-Specific Base Score (0-100)
  let baseScore = 0;
  
  if (card.category === 'sipChill') {
    baseScore = calculateSipChillScore(card, preferences);
  } else if (card.category === 'diningExp') {
    baseScore = calculateDiningScore(card, preferences);
  } else if (card.category === 'playMove') {
    baseScore = calculatePlayMoveScore(card, preferences);
  } else if (card.category === 'wellness') {
    baseScore = calculateWellnessScore(card, preferences);
  } else {
    baseScore = calculateGenericScore(card, preferences);
  }
  
  // STEP 2: Apply Universal Factors
  const locationScore = calculateLocationScore(card, preferences);
  const budgetScore = calculateBudgetScore(card, preferences);
  const popularityScore = calculatePopularityScore(card);
  
  // STEP 3: Weighted Combination
  const finalScore = 
    (baseScore * 0.5) +           // Category-specific: 50%
    (locationScore * 0.25) +      // Location proximity: 25%
    (budgetScore * 0.15) +        // Budget fit: 15%
    (popularityScore * 0.10);     // Popularity: 10%
  
  // STEP 4: Apply Bonuses
  let bonusedScore = finalScore;
  
  // Time of day bonus
  if (isOptimalTimeOfDay(card, preferences)) {
    bonusedScore += 5;
  }
  
  // Weather bonus (outdoor venues)
  if (card.isOutdoor && isGoodWeather(preferences)) {
    bonusedScore += 3;
  }
  
  // Ambience match bonus
  if (ambienceMatches(card, preferences)) {
    bonusedScore += 2;
  }
  
  // STEP 5: Cap at maximum
  return Math.min(bonusedScore, 98); // Max 98%
}
```

### Location Score (25% of total)

```typescript
/**
 * Score based on travel time/distance
 * Uses REAL Google Maps data in production
 */
function calculateLocationScore(
  card: Card,
  preferences: UserPreferences
): number {
  // Get real travel time from Google Maps
  const travelResult = card.travelData; // Pre-calculated in filtering stage
  
  if (!travelResult) return 75; // Default if no location data
  
  const travelMinutes = travelResult.durationSeconds / 60;
  
  // Scoring curve: Closer = Better
  // 0-10 min: 100 points
  // 10-20 min: 90-70 points (linear decline)
  // 20-30 min: 70-50 points (linear decline)
  // 30+ min: 50 points minimum
  
  if (travelMinutes <= 10) {
    return 100;
  } else if (travelMinutes <= 20) {
    return 100 - ((travelMinutes - 10) * 3); // 90 at 10min, 70 at 20min
  } else if (travelMinutes <= 30) {
    return 70 - ((travelMinutes - 20) * 2); // 70 at 20min, 50 at 30min
  } else {
    return 50; // Minimum for anything beyond 30 min
  }
}
```

### Budget Score (15% of total)

```typescript
/**
 * Score based on how well price fits within budget range
 */
function calculateBudgetScore(
  card: Card,
  preferences: UserPreferences
): number {
  const cardPrice = card.pricePerPerson || extractCardPrice(card);
  const budgetMin = preferences.budgetMin || 0;
  const budgetMax = preferences.budgetMax || 10000;
  
  // If no budget set, return neutral score
  if (!preferences.budgetMin && !preferences.budgetMax) {
    return 80;
  }
  
  // Card outside budget should have been filtered out
  // This is just for scoring within budget
  if (cardPrice < budgetMin || cardPrice > budgetMax) {
    return 0; // Should never happen if filtering works
  }
  
  // Calculate how "centered" the price is within budget
  const budgetRange = budgetMax - budgetMin;
  const budgetMid = budgetMin + (budgetRange / 2);
  const distanceFromMid = Math.abs(cardPrice - budgetMid);
  const maxDistance = budgetRange / 2;
  
  // Perfect score at mid-point, declining toward edges
  // Mid: 100 points
  // Edges: 75 points
  const score = 100 - ((distanceFromMid / maxDistance) * 25);
  
  return Math.max(score, 75);
  
  // Examples:
  // Budget: $25-75 (mid: $50)
  // Card $50 → 100 points (perfect)
  // Card $37.50 → 87.5 points (25% from mid)
  // Card $25 or $75 → 75 points (at edges)
}
```

### Popularity Score (10% of total)

```typescript
/**
 * Score based on ratings and social engagement
 */
function calculatePopularityScore(card: Card): number {
  // Rating component (60% of popularity)
  const ratingScore = (card.rating / 5) * 60;
  
  // Engagement component (40% of popularity)
  const totalEngagement = 
    (card.socialStats?.views || 0) * 0.1 +
    (card.socialStats?.likes || 0) * 1.0 +
    (card.socialStats?.saves || 0) * 2.0 +
    (card.socialStats?.shares || 0) * 3.0;
  
  // Normalize engagement (logarithmic scale)
  const engagementScore = Math.min(
    (Math.log(totalEngagement + 1) / Math.log(1000)) * 40,
    40
  );
  
  return ratingScore + engagementScore;
  
  // Examples:
  // Card with 4.8 rating, 1000 views, 50 likes → ~85 points
  // Card with 3.5 rating, 100 views, 5 likes → ~55 points
  // Card with 5.0 rating, 10000 views, 500 likes → ~95 points
}
```

---

## Category-Specific Algorithms

### Sip & Chill Scoring

```typescript
/**
 * Specialized scoring for coffee shops, bars, cafes
 * Emphasizes ambience, experience type fit, and timing
 */
function calculateSipChillScore(
  card: Card,
  preferences: UserPreferences
): number {
  const data = card.sipChillData;
  if (!data) return 75; // Fallback
  
  let score = 0;
  
  // 1. Experience Type Fit (40% weight)
  // How well venue matches the social context
  if (preferences.experienceTypes?.length > 0) {
    const fits = preferences.experienceTypes.map(type => 
      data.experienceTypeFit[type] || 50
    );
    const avgFit = fits.reduce((a, b) => a + b, 0) / fits.length;
    score += (avgFit / 100) * 40;
  } else {
    score += 32; // Default 80% if no preference
  }
  
  // 2. Ambience Score (30% weight)
  // Average of 5 ambience factors
  const ambienceAvg = (
    data.ambienceScore.quietness +
    data.ambienceScore.coziness +
    data.ambienceScore.intimacy +
    data.ambienceScore.sophistication +
    data.ambienceScore.casualness
  ) / 5;
  score += (ambienceAvg / 100) * 30;
  
  // 3. Beverage Quality (20% weight)
  const beverageAvg = (
    data.beverageQuality.coffee +
    data.beverageQuality.tea +
    data.beverageQuality.cocktails +
    data.beverageQuality.wine +
    data.beverageQuality.beer
  ) / 5;
  score += (beverageAvg / 100) * 20;
  
  // 4. Seating & Space (10% weight)
  const seatingScore = 
    data.seatingOptions.indoorSeating * 0.4 +
    data.seatingOptions.outdoorSeating * 0.3 +
    data.seatingOptions.barSeating * 0.2 +
    data.seatingOptions.loungeSeating * 0.1;
  score += (seatingScore / 100) * 10;
  
  // BONUSES
  
  // Romantic preference bonus
  if (preferences.experienceTypes?.includes('romantic')) {
    score += (data.ambienceScore.intimacy / 100) * 5;
    score += (data.specialFeatures.liveMusic ? 3 : 0);
    score += (data.specialFeatures.fireplace ? 2 : 0);
  }
  
  // Business preference bonus
  if (preferences.experienceTypes?.includes('business')) {
    score += (data.amenities.wifi ? 3 : 0);
    score += (data.amenities.outlets ? 2 : 0);
    score += (data.ambienceScore.quietness / 100) * 3;
  }
  
  // Social/Group preference bonus
  if (preferences.experienceTypes?.includes('groupFun')) {
    score += (data.groupFriendliness / 100) * 5;
    score += (data.seatingOptions.loungeSeating ? 3 : 0);
  }
  
  return Math.min(score, 100);
}

/**
 * Adjust Sip & Chill score based on time of day
 */
function adjustSipChillScoreForTime(
  baseScore: number,
  card: Card,
  timeOfDay: string
): number {
  const data = card.sipChillData;
  if (!data) return baseScore;
  
  // Morning (6am-11am) → Coffee shops shine
  if (timeOfDay === 'morning' && data.beverageQuality.coffee >= 80) {
    return baseScore + 5;
  }
  
  // Afternoon (2pm-5pm) → Cafes are perfect
  if (timeOfDay === 'afternoon') {
    return baseScore + 3;
  }
  
  // Evening (6pm-10pm) → Wine bars and cocktail lounges shine
  if (timeOfDay === 'evening' && 
      (data.beverageQuality.wine >= 75 || data.beverageQuality.cocktails >= 75)) {
    return baseScore + 5;
  }
  
  // Late night (10pm+) → Bars with late hours
  if (timeOfDay === 'lateNight' && data.lateNightFriendly) {
    return baseScore + 4;
  }
  
  return baseScore;
}
```

### Dining Experiences Scoring

```typescript
/**
 * Specialized scoring for restaurants
 * Emphasizes cuisine type, formality, and romance factor
 */
function calculateDiningScore(
  card: Card,
  preferences: UserPreferences
): number {
  const data = card.diningData;
  if (!data) return 75;
  
  let score = 0;
  
  // 1. Cuisine Match (35% weight)
  // If user has cuisine preferences, match them
  if (preferences.cuisinePreferences?.length > 0) {
    const cuisineMatch = preferences.cuisinePreferences.includes(data.cuisineType);
    score += cuisineMatch ? 35 : 15; // High penalty for wrong cuisine
  } else {
    score += 28; // Default 80% if no preference
  }
  
  // 2. Formality Level (25% weight)
  const formalityMatch = matchFormality(data.formalityLevel, preferences);
  score += (formalityMatch / 100) * 25;
  
  // 3. Dining Experience Quality (20% weight)
  const experienceAvg = (
    data.foodQuality +
    data.serviceQuality +
    data.platingPresentation +
    data.menuCreativity
  ) / 4;
  score += (experienceAvg / 100) * 20;
  
  // 4. Ambience (10% weight)
  const ambienceAvg = (
    data.ambience.lighting +
    data.ambience.noise +
    data.ambience.decor +
    data.ambience.spacing
  ) / 4;
  score += (ambienceAvg / 100) * 10;
  
  // 5. Value for Money (10% weight)
  score += (data.valueRating / 100) * 10;
  
  // BONUSES
  
  // Romantic dinner bonus
  if (preferences.experienceTypes?.includes('romantic')) {
    score += (data.romanceScore / 100) * 10;
    score += data.features.candlelight ? 3 : 0;
    score += data.features.privateBooths ? 2 : 0;
  }
  
  // Business dinner bonus
  if (preferences.experienceTypes?.includes('business')) {
    score += data.formalityLevel >= 70 ? 5 : 0;
    score += data.features.privateRooms ? 3 : 0;
  }
  
  // Group dining bonus
  if (preferences.experienceTypes?.includes('groupFun')) {
    score += data.features.largeTableAvailable ? 5 : 0;
    score += data.features.familyStyle ? 3 : 0;
  }
  
  return Math.min(score, 100);
}

function matchFormality(
  venueFormalityLevel: number,
  preferences: UserPreferences
): number {
  // Determine preferred formality from experience types
  let preferredFormality = 50; // Default mid-range
  
  if (preferences.experienceTypes?.includes('romantic')) {
    preferredFormality = 80; // Prefer upscale
  } else if (preferences.experienceTypes?.includes('business')) {
    preferredFormality = 75; // Prefer formal
  } else if (preferences.experienceTypes?.includes('friendly')) {
    preferredFormality = 40; // Prefer casual
  } else if (preferences.experienceTypes?.includes('groupFun')) {
    preferredFormality = 30; // Prefer very casual
  }
  
  // Calculate distance from preferred formality
  const distance = Math.abs(venueFormalityLevel - preferredFormality);
  
  // Perfect match = 100, max distance (100) = 0
  return 100 - distance;
}
```

### Play & Move Scoring

```typescript
/**
 * Specialized scoring for active/sports venues
 * Emphasizes activity level, group suitability, and fun factor
 */
function calculatePlayMoveScore(
  card: Card,
  preferences: UserPreferences
): number {
  const data = card.playMoveData;
  if (!data) return 75;
  
  let score = 0;
  
  // 1. Activity Type Match (30% weight)
  const activityMatch = preferences.activityTypes?.includes(data.activityType) ? 100 : 60;
  score += (activityMatch / 100) * 30;
  
  // 2. Physical Intensity Match (25% weight)
  const intensityMatch = matchIntensity(data.physicalIntensity, preferences);
  score += (intensityMatch / 100) * 25;
  
  // 3. Group Suitability (20% weight)
  const groupMatch = matchGroupSize(data.idealGroupSize, preferences);
  score += (groupMatch / 100) * 20;
  
  // 4. Fun Factor (15% weight)
  score += (data.funScore / 100) * 15;
  
  // 5. Accessibility (10% weight)
  const accessAvg = (
    data.accessibility.beginnerFriendly +
    data.accessibility.equipmentProvided +
    data.accessibility.instructionAvailable
  ) / 3;
  score += (accessAvg / 100) * 10;
  
  // BONUSES
  
  // First date bonus (low intensity activities)
  if (preferences.experienceTypes?.includes('firstDate')) {
    score += data.physicalIntensity <= 40 ? 5 : -5;
    score += data.competitiveness <= 30 ? 3 : 0;
  }
  
  // Group fun bonus
  if (preferences.experienceTypes?.includes('groupFun')) {
    score += data.idealGroupSize >= 4 ? 5 : 0;
    score += data.teamBased ? 3 : 0;
  }
  
  // Solo adventure bonus
  if (preferences.experienceTypes?.includes('soloAdventure')) {
    score += data.soloFriendly ? 5 : -3;
  }
  
  return Math.min(score, 100);
}

function matchIntensity(
  venueIntensity: number,
  preferences: UserPreferences
): number {
  // Determine preferred intensity from experience types
  let preferredIntensity = 50;
  
  if (preferences.experienceTypes?.includes('wellness')) {
    preferredIntensity = 30; // Low intensity
  } else if (preferences.experienceTypes?.includes('firstDate')) {
    preferredIntensity = 35; // Low-moderate
  } else if (preferences.experienceTypes?.includes('groupFun')) {
    preferredIntensity = 60; // Moderate-high
  } else if (preferences.experienceTypes?.includes('soloAdventure')) {
    preferredIntensity = 70; // High intensity
  }
  
  const distance = Math.abs(venueIntensity - preferredIntensity);
  return 100 - distance;
}
```

### Wellness Scoring

```typescript
/**
 * Specialized scoring for wellness venues
 * Emphasizes relaxation, mindfulness, and health focus
 */
function calculateWellnessScore(
  card: Card,
  preferences: UserPreferences
): number {
  const data = card.wellnessData;
  if (!data) return 75;
  
  let score = 0;
  
  // 1. Wellness Type Match (35% weight)
  const typeMatch = preferences.wellnessTypes?.includes(data.wellnessType) ? 100 : 65;
  score += (typeMatch / 100) * 35;
  
  // 2. Relaxation Score (25% weight)
  score += (data.relaxationScore / 100) * 25;
  
  // 3. Mindfulness Component (20% weight)
  score += (data.mindfulnessScore / 100) * 20;
  
  // 4. Health Focus (10% weight)
  const healthAvg = (
    data.healthFocus.physical +
    data.healthFocus.mental +
    data.healthFocus.spiritual
  ) / 3;
  score += (healthAvg / 100) * 10;
  
  // 5. Atmosphere (10% weight)
  const atmosphereAvg = (
    data.atmosphere.calming +
    data.atmosphere.serene +
    data.atmosphere.luxurious
  ) / 3;
  score += (atmosphereAvg / 100) * 10;
  
  // BONUSES
  
  // Romantic wellness bonus
  if (preferences.experienceTypes?.includes('romantic')) {
    score += data.features.couplesOptions ? 5 : 0;
    score += data.atmosphere.luxurious >= 80 ? 3 : 0;
  }
  
  // Solo adventure bonus
  if (preferences.experienceTypes?.includes('soloAdventure')) {
    score += data.features.soloFriendly ? 4 : 0;
  }
  
  return Math.min(score, 100);
}
```

---

## Real-World Examples

### Example 1: Romantic Dinner Date

**User Preferences:**
```typescript
{
  experienceTypes: ['romantic'],
  categories: ['diningExp', 'sipChill'],
  budgetMin: 75,
  budgetMax: 150,
  dateOption: 'pick',
  selectedDate: '2024-02-14', // Valentine's Day
  exactTime: '19:00',
  travelMode: 'driving',
  constraintType: 'time',
  timeConstraint: 30,
  useLocation: 'gps',
  location: { lat: 37.7749, lng: -122.4194 } // San Francisco
}
```

**Pipeline Processing:**

```
STEP 1: Fetch 1250 cards

STEP 2: Category Filter
  • Keep only "diningExp" and "sipChill" categories
  • 1250 → 420 cards

STEP 3: Budget Filter
  • Keep only $75-150 per person
  • 420 → 180 cards (excludes casual $20 places and ultra-luxury $300 places)

STEP 4: Date/Time Filter
  • Check if open on February 14 at 7:00 PM
  • 180 → 145 cards (excludes lunch-only spots, closed Wednesdays, etc.)

STEP 5: Travel Time Filter
  • Google Maps: Calculate driving time from user location
  • Keep only venues within 30 minutes
  • 145 → 98 cards (excludes distant restaurants in Oakland, Marin)

STEP 6: Arrival Time Validation
  • Scheduled departure: 7:00 PM
  • Calculate arrival time for each venue
  • Example: 25min drive → 7:25 PM arrival
  • Exclude venues closing before arrival + reasonable dining time (2hrs)
  • 98 → 82 cards (excludes early-closing cafes)

STEP 7: Scoring
  • Calculate match scores using Dining algorithm
  • Factors weighted:
    - Romance score (high weight for romantic preference)
    - Formality level (prefer upscale for $75-150 budget)
    - Cuisine quality
    - Ambience (intimacy, lighting, noise)
    - Special features (candlelight, private booths)

Top 3 Scored Cards:
  1. "Flour + Water" - 94% match
     - Italian fine dining
     - $90 avg per person (perfect budget fit)
     - 18 min drive
     - Romance score: 92/100
     - Features: Candlelit tables, wine pairings
     
  2. "State Bird Provisions" - 91% match
     - Contemporary American
     - $85 avg per person
     - 22 min drive
     - Romance score: 88/100
     - Features: Intimate seating, creative menu
     
  3. "Foreign Cinema" - 89% match
     - Mediterranean
     - $95 avg per person
     - 15 min drive
     - Romance score: 90/100
     - Features: Outdoor courtyard, film screenings

STEP 8: Sort by score (already shown above)

STEP 9: Return top 10 cards
```

**Result Explanation to User:**
```
"Flour + Water - 94% Match"

Why it's perfect:
✓ Romantic atmosphere with intimate candlelit seating
✓ $90 per person - Right in your $75-150 budget
✓ 18 minutes away by car from your location
✓ Open on Valentine's Day at 7 PM
✓ Upscale Italian cuisine with excellent wine selection
✓ Reservation available at your preferred time
```

### Example 2: Quick Coffee Meeting (Business)

**User Preferences:**
```typescript
{
  experienceTypes: ['business'],
  categories: ['sipChill'],
  budgetMin: 10,
  budgetMax: 30,
  dateOption: 'now',
  travelMode: 'walking',
  constraintType: 'time',
  timeConstraint: 15,
  useLocation: 'gps',
  location: { lat: 37.7956, lng: -122.3933 } // Ferry Building
}
```

**Pipeline Processing:**

```
STEP 1: Fetch 1250 cards

STEP 2: Category Filter
  • Keep only "sipChill"
  • 1250 → 280 cards

STEP 3: Budget Filter
  • Keep only $10-30 per person
  • 280 → 195 cards (excludes high-end cocktail bars)

STEP 4: Date/Time Filter
  • "Now" = Current time (let's say 10:30 AM on Tuesday)
  • Keep only venues open right now
  • 195 → 148 cards (excludes bars opening at 5pm, closed Tuesdays)

STEP 5: Travel Time Filter
  • Google Maps: Walking time from Ferry Building
  • Keep only venues within 15 minutes walking
  • 148 → 42 cards (very restrictive - only nearby downtown SF)

STEP 6: Arrival Time Validation
  • Departure: Now (10:30 AM)
  • Check each venue still open at arrival time
  • 42 → 41 cards (1 closes at 11am, 5min walk means 10:35 arrival, not enough time)

STEP 7: Scoring
  • Calculate match scores using Sip & Chill algorithm
  • Business preference bonuses:
    + WiFi availability
    + Power outlets
    + Quiet ambience
    + Professional atmosphere
    + Coffee quality (important for business meetings)

Top 3 Scored Cards:
  1. "Sightglass Coffee" - 96% match
     - 5 min walk (0.4 km)
     - $15 avg per person
     - Business amenities: WiFi ✓, Outlets ✓
     - Quietness: 75/100 (moderate conversation)
     - Coffee quality: 92/100
     
  2. "Blue Bottle Ferry Building" - 93% match
     - 2 min walk (0.2 km)
     - $18 avg per person
     - Business amenities: WiFi ✓, Outlets ✓
     - Quietness: 70/100
     - Coffee quality: 95/100
     
  3. "Ritual Coffee" - 88% match
     - 12 min walk (1.0 km)
     - $14 avg per person
     - Business amenities: WiFi ✓, Outlets ✓
     - Quietness: 80/100
     - Coffee quality: 88/100

STEP 8 & 9: Sort and return top 10
```

**Result Explanation:**
```
"Sightglass Coffee - 96% Match"

Perfect for your business meeting:
✓ Just 5 minutes walking from Ferry Building
✓ $15 per person - Within your $10-30 budget
✓ WiFi and power outlets available
✓ Moderately quiet (good for conversation)
✓ Excellent coffee quality
✓ Open now (10:30 AM)
```

### Example 3: Group Weekend Activity

**User Preferences:**
```typescript
{
  experienceTypes: ['groupFun'],
  categories: ['playMove', 'casualEats'],
  budgetMin: 20,
  budgetMax: 50,
  dateOption: 'weekend',
  exactTime: '14:00',
  travelMode: 'transit',
  constraintType: 'time',
  timeConstraint: 45,
  useLocation: 'search',
  searchLocation: 'Mission Dolores Park, San Francisco'
}
```

**Pipeline Processing:**

```
STEP 1: Fetch 1250 cards

STEP 2: Category Filter
  • Keep only "playMove" and "casualEats"
  • 1250 → 380 cards

STEP 3: Budget Filter
  • Keep only $20-50 per person
  • 380 → 240 cards

STEP 4: Date/Time Filter
  • Weekend = Next Saturday
  • Time = 2:00 PM
  • Keep venues open Saturday at 2pm
  • 240 → 210 cards (excludes Friday/Sunday only events)

STEP 5: Travel Time Filter
  • Google Maps: Public transit from Mission Dolores Park
  • Keep only venues within 45 minutes by transit
  • 210 → 125 cards (transit is slower than driving, more restrictive)

STEP 6: Arrival Time Validation
  • Departure: Saturday 2:00 PM
  • Typical activity: 2-3 hours
  • Ensure venue stays open until at least 5:00 PM
  • 125 → 118 cards

STEP 7: Scoring
  • Use Play & Move and Casual Eats algorithms
  • Group fun bonuses:
    + Large group capacity
    + Team-based activities
    + Casual atmosphere
    + Shareable food options

Top 3 Scored Cards:
  1. "Mission Bowling Club" - 92% match
     - Bowling alley + full bar/restaurant
     - $35 per person (game + food)
     - 8 min bus ride (0.5 miles)
     - Group capacity: Up to 24 people
     - Fun score: 95/100
     - Features: Multiple lanes, shareable appetizers
     
  2. "The Armory" - 89% match
     - Indoor rock climbing + cafe
     - $40 per person (climb + snack)
     - 15 min bus ride (1.2 miles)
     - Group capacity: Up to 20 people
     - Physical intensity: Moderate
     - Features: Group climbing sessions available
     
  3. "La Taqueria" - 85% match
     - Mission district taqueria (casual eats)
     - $22 per person
     - 6 min walk (0.3 miles)
     - Group capacity: Large communal tables
     - Food quality: 94/100
     - Features: Family-style ordering, outdoor seating

STEP 8 & 9: Sort and return top 10
```

---

## API Integration

### Frontend Implementation

```typescript
// CardGenerationService.ts

import { generateCards, CardGenerationPreferences, GeneratedCard } from './cardGenerator';

class CardGenerationService {
  /**
   * Generate cards based on user preferences
   */
  async generateRecommendations(
    preferences: CardGenerationPreferences,
    userLocation: { lat: number; lng: number }
  ): Promise<GeneratedCard[]> {
    try {
      // OPTION 1: Client-side generation (current implementation)
      const cards = generateCards(preferences, userLocation, 10);
      return cards;
      
      // OPTION 2: Server-side generation (production recommended)
      // const response = await fetch('/api/cards/generate', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ preferences, userLocation })
      // });
      // return await response.json();
      
    } catch (error) {
      console.error('Card generation failed:', error);
      return [];
    }
  }
  
  /**
   * Get more cards (pagination)
   */
  async loadMoreCards(
    preferences: CardGenerationPreferences,
    userLocation: { lat: number; lng: number },
    offset: number = 10,
    limit: number = 10
  ): Promise<GeneratedCard[]> {
    // Generate next batch
    const allCards = generateCards(preferences, userLocation, offset + limit);
    return allCards.slice(offset, offset + limit);
  }
  
  /**
   * Refresh cards (when preferences change)
   */
  async refreshRecommendations(
    preferences: CardGenerationPreferences,
    userLocation: { lat: number; lng: number }
  ): Promise<GeneratedCard[]> {
    // Clear cache and regenerate
    return this.generateRecommendations(preferences, userLocation);
  }
}

export const cardGenerationService = new CardGenerationService();
```

### Backend API (Production)

```typescript
// /api/cards/generate - POST

/**
 * Production card generation endpoint
 * Handles heavy processing server-side
 */
export async function POST(request: Request) {
  try {
    const { preferences, userLocation } = await request.json();
    
    // 1. Validate preferences
    if (!preferences || !userLocation) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }
    
    // 2. Fetch all available cards from database
    const allCards = await db.cards.findMany({
      where: {
        isActive: true,
        isApproved: true
      },
      include: {
        location: true,
        openingHours: true,
        categoryData: true
      }
    });
    
    // 3. Apply filters
    let filteredCards = allCards;
    
    // Category filter
    if (preferences.categories?.length > 0) {
      filteredCards = filteredCards.filter(card =>
        preferences.categories.includes(card.categoryId)
      );
    }
    
    // Budget filter
    if (preferences.budgetMin || preferences.budgetMax) {
      filteredCards = filteredCards.filter(card => {
        const price = card.pricePerPerson;
        return price >= (preferences.budgetMin || 0) &&
               price <= (preferences.budgetMax || 10000);
      });
    }
    
    // Date/time filter
    if (preferences.actualDateTime) {
      filteredCards = await filterByAvailability(
        filteredCards,
        preferences.actualDateTime
      );
    }
    
    // 4. Calculate travel times (batch Google Maps API call)
    const travelResults = await calculateBatchTravelTimes(
      userLocation,
      filteredCards.map(c => c.location),
      preferences.travelMode,
      preferences.actualDateTime?.scheduledDate
    );
    
    // 5. Apply travel constraint
    if (preferences.timeConstraint || preferences.distanceConstraint) {
      filteredCards = filteredCards.filter((card, index) => {
        const travelResult = travelResults[index];
        return isWithinTravelConstraint(
          travelResult,
          preferences.constraintType,
          preferences.constraintType === 'time' 
            ? preferences.timeConstraint 
            : preferences.distanceConstraint,
          preferences.measurementSystem
        );
      });
    }
    
    // 6. Score cards
    const scoredCards = filteredCards.map((card, index) => ({
      ...card,
      travelData: travelResults[index],
      matchScore: calculateMatchScore(card, preferences),
      source: card.creatorType,
      generatedAt: new Date().toISOString()
    }));
    
    // 7. Sort by score
    scoredCards.sort((a, b) => b.matchScore - a.matchScore);
    
    // 8. Return top 10
    const topCards = scoredCards.slice(0, 10);
    
    // 9. Log analytics
    await logCardGeneration({
      userId: request.userId,
      preferences,
      resultsCount: topCards.length,
      timestamp: new Date()
    });
    
    return Response.json({
      cards: topCards,
      totalMatches: scoredCards.length,
      preferences: preferences
    });
    
  } catch (error) {
    console.error('Card generation error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

---

## Testing & Validation

### Unit Tests

```typescript
// cardGenerator.test.ts

describe('Card Generation System', () => {
  describe('Category Filtering', () => {
    test('should filter by single category', () => {
      const preferences = {
        categories: ['sipChill']
      };
      
      const cards = generateCards(preferences, mockLocation);
      
      cards.forEach(card => {
        expect(card.category).toBe('sipChill');
      });
    });
    
    test('should filter by multiple categories', () => {
      const preferences = {
        categories: ['sipChill', 'diningExp']
      };
      
      const cards = generateCards(preferences, mockLocation);
      
      cards.forEach(card => {
        expect(['sipChill', 'diningExp']).toContain(card.category);
      });
    });
    
    test('should return all categories if none selected', () => {
      const preferences = {
        categories: []
      };
      
      const cards = generateCards(preferences, mockLocation);
      
      const categories = new Set(cards.map(c => c.category));
      expect(categories.size).toBeGreaterThan(1);
    });
  });
  
  describe('Budget Filtering', () => {
    test('should exclude cards outside budget range', () => {
      const preferences = {
        budgetMin: 25,
        budgetMax: 75
      };
      
      const cards = generateCards(preferences, mockLocation);
      
      cards.forEach(card => {
        const price = extractCardPrice(card);
        expect(price).toBeGreaterThanOrEqual(25);
        expect(price).toBeLessThanOrEqual(75);
      });
    });
    
    test('should handle free experiences', () => {
      const preferences = {
        budgetMin: 0,
        budgetMax: 25
      };
      
      const cards = generateCards(preferences, mockLocation);
      
      const hasFreeCards = cards.some(card => extractCardPrice(card) === 0);
      expect(hasFreeCards).toBe(true);
    });
  });
  
  describe('Match Scoring', () => {
    test('should score romantic venues higher for romantic preference', () => {
      const preferences = {
        experienceTypes: ['romantic'],
        categories: ['diningExp']
      };
      
      const cards = generateCards(preferences, mockLocation, 10);
      
      // Check that top cards have high romance scores
      const topCard = cards[0];
      expect(topCard.matchScore).toBeGreaterThan(80);
      
      if (topCard.diningData) {
        expect(topCard.diningData.romanceScore).toBeGreaterThan(70);
      }
    });
    
    test('should prioritize quiet venues for business preference', () => {
      const preferences = {
        experienceTypes: ['business'],
        categories: ['sipChill']
      };
      
      const cards = generateCards(preferences, mockLocation, 10);
      
      const topCard = cards[0];
      if (topCard.sipChillData) {
        expect(topCard.sipChillData.ambienceScore.quietness).toBeGreaterThan(60);
        expect(topCard.sipChillData.amenities.wifi).toBe(true);
      }
    });
  });
  
  describe('Travel Time Filtering', () => {
    test('should exclude cards beyond travel constraint', () => {
      const preferences = {
        travelMode: 'walking',
        constraintType: 'time',
        timeConstraint: 15
      };
      
      const cards = generateCards(preferences, mockLocation);
      
      cards.forEach(card => {
        const travelMinutes = card.travelData?.durationSeconds / 60;
        expect(travelMinutes).toBeLessThanOrEqual(15);
      });
    });
  });
});
```

### Integration Tests

```typescript
// e2e/cardGeneration.test.ts

describe('Card Generation E2E', () => {
  test('complete romantic dinner flow', async () => {
    // 1. User opens preferences
    await page.click('[data-testid="preferences-button"]');
    
    // 2. Select romantic
    await page.click('[data-testid="experience-romantic"]');
    
    // 3. Select dining category
    await page.click('[data-testid="category-dining"]');
    
    // 4. Set budget
    await page.fill('[data-testid="budget-min"]', '75');
    await page.fill('[data-testid="budget-max"]', '150');
    
    // 5. Set date/time
    await page.click('[data-testid="date-pick"]');
    await page.fill('[data-testid="date-input"]', '2024-02-14');
    await page.fill('[data-testid="time-input"]', '19:00');
    
    // 6. Apply preferences
    await page.click('[data-testid="apply-preferences"]');
    
    // 7. Wait for cards to generate
    await page.waitForSelector('[data-testid="swipeable-card"]');
    
    // 8. Verify first card
    const firstCard = await page.$('[data-testid="swipeable-card"]:first-child');
    const matchScore = await firstCard.textContent('[data-testid="match-score"]');
    
    expect(parseInt(matchScore)).toBeGreaterThan(80);
    
    // 9. Verify card details
    const category = await firstCard.textContent('[data-testid="card-category"]');
    expect(category).toContain('Dining');
    
    const price = await firstCard.textContent('[data-testid="card-price"]');
    const priceValue = parseInt(price.match(/\d+/)[0]);
    expect(priceValue).toBeGreaterThanOrEqual(75);
    expect(priceValue).toBeLessThanOrEqual(150);
  });
});
```

---

## Performance Optimization

### Caching Strategy

```typescript
// Cache generated cards for 5 minutes
const CARD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  cards: GeneratedCard[];
  preferences: CardGenerationPreferences;
  timestamp: number;
}

class CardCache {
  private cache: Map<string, CacheEntry> = new Map();
  
  /**
   * Generate cache key from preferences
   */
  private getCacheKey(preferences: CardGenerationPreferences): string {
    return JSON.stringify({
      categories: preferences.categories?.sort(),
      budgetMin: preferences.budgetMin,
      budgetMax: preferences.budgetMax,
      experienceTypes: preferences.experienceTypes?.sort(),
      // Exclude location for wider cache hits
    });
  }
  
  /**
   * Get cached cards if available and fresh
   */
  get(preferences: CardGenerationPreferences): GeneratedCard[] | null {
    const key = this.getCacheKey(preferences);
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // Check if expired
    const age = Date.now() - entry.timestamp;
    if (age > CARD_CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.cards;
  }
  
  /**
   * Store cards in cache
   */
  set(preferences: CardGenerationPreferences, cards: GeneratedCard[]): void {
    const key = this.getCacheKey(preferences);
    this.cache.set(key, {
      cards,
      preferences,
      timestamp: Date.now()
    });
    
    // Cleanup old entries
    this.cleanup();
  }
  
  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > CARD_CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }
}

export const cardCache = new CardCache();
```

### Batch Processing

```typescript
/**
 * Process cards in batches for better performance
 */
async function generateCardsInBatches(
  preferences: CardGenerationPreferences,
  userLocation: { lat: number; lng: number },
  totalCards: number = 100
): Promise<GeneratedCard[]> {
  const BATCH_SIZE = 25; // Google Maps API limit
  const batches = Math.ceil(totalCards / BATCH_SIZE);
  
  const allResults: GeneratedCard[] = [];
  
  for (let i = 0; i < batches; i++) {
    const offset = i * BATCH_SIZE;
    
    // Fetch batch from database
    const batchCards = await fetchCardBatch(offset, BATCH_SIZE);
    
    // Filter
    const filtered = applyFilters(batchCards, preferences);
    
    // Calculate travel times (batch API call)
    const travelResults = await calculateBatchTravelTimes(
      userLocation,
      filtered.map(c => c.location),
      preferences.travelMode
    );
    
    // Score and add to results
    const scored = filtered.map((card, index) => ({
      ...card,
      travelData: travelResults[index],
      matchScore: calculateMatchScore(card, preferences)
    }));
    
    allResults.push(...scored);
  }
  
  // Sort all results
  allResults.sort((a, b) => b.matchScore - a.matchScore);
  
  return allResults.slice(0, totalCards);
}
```

### Lazy Loading

```typescript
/**
 * Lazy load cards as user swipes
 */
class LazyCardLoader {
  private buffer: GeneratedCard[] = [];
  private isLoading: boolean = false;
  
  async getNextCard(): Promise<GeneratedCard | null> {
    // Ensure buffer has cards
    if (this.buffer.length < 3 && !this.isLoading) {
      this.loadMoreCards();
    }
    
    return this.buffer.shift() || null;
  }
  
  private async loadMoreCards(): Promise<void> {
    this.isLoading = true;
    
    try {
      const newCards = await cardGenerationService.loadMoreCards(
        this.preferences,
        this.userLocation,
        this.buffer.length,
        10
      );
      
      this.buffer.push(...newCards);
    } catch (error) {
      console.error('Failed to load more cards:', error);
    } finally {
      this.isLoading = false;
    }
  }
}
```

---

## Summary

### Key Takeaways for Developers

1. **ABSOLUTE FILTERS (Hard Exclusion)**
   - Categories, Budget, Travel Constraint, Availability
   - Cards that don't meet these are NEVER shown
   - No exceptions or "close enough" matches

2. **INTELLIGENT SCORING (Quality Ranking)**
   - Category-specific algorithms (Sip & Chill, Dining, Play & Move, etc.)
   - Weighted factors based on user intent
   - Transparent match percentages

3. **PRODUCTION-READY TRAVEL**
   - Use Google Maps Distance Matrix API for real travel times
   - Batch calls (25 cards per request)
   - Consider traffic, transit schedules, bike lanes

4. **PERFORMANCE OPTIMIZATION**
   - Cache results for 5 minutes
   - Batch process Google Maps calls
   - Lazy load cards as user swipes

5. **QUALITY OVER QUANTITY**
   - Show 10 great cards, not 100 mediocre ones
   - "No results" is better than bad matches
   - Help users refine preferences when too restrictive

### Implementation Checklist

- [ ] Implement category filtering (hard exclusion)
- [ ] Implement budget filtering (hard exclusion)
- [ ] Implement date/time availability checking
- [ ] Integrate Google Maps Distance Matrix API
- [ ] Implement travel constraint filtering
- [ ] Implement arrival time validation
- [ ] Create category-specific scoring algorithms
- [ ] Implement weighted score calculation
- [ ] Add caching layer
- [ ] Implement batch processing
- [ ] Add lazy loading
- [ ] Create unit tests for all filters
- [ ] Create integration tests for complete flow
- [ ] Add analytics logging
- [ ] Optimize database queries
- [ ] Add error handling and fallbacks
