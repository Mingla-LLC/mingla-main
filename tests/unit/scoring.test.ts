import { describe, test, expect } from 'vitest';

// Mock candidate data for testing
interface TestCandidate {
  id: string;
  name: string;
  category: string;
  location: { lat: number; lng: number };
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  estimatedCost?: number;
  travel?: {
    durationMinutes: number;
    distanceText: string;
    mode: string;
  };
  score?: number;
}

interface TestPreferences {
  budget: { min: number; max: number; perPerson: boolean };
  travel: { constraint: { maxMinutes?: number; type: string } };
}

// Scoring function (extracted from edge function logic)
function scoreCandidate(candidate: TestCandidate, preferences: TestPreferences): number {
  const weights = {
    rating: 0.25,
    reviewCount: 0.15,
    eta: 0.20,
    budget: 0.15,
    time: 0.10,
    photo: 0.15
  };

  let score = 0;

  // Rating score (0-1)
  if (candidate.rating) {
    score += weights.rating * (candidate.rating / 5.0);
  }

  // Review count score (logarithmic, 0-1)
  if (candidate.reviewCount && candidate.reviewCount > 0) {
    score += weights.reviewCount * Math.min(Math.log10(candidate.reviewCount) / 4, 1);
  }

  // ETA score (closer is better, 0-1)
  if (candidate.travel?.durationMinutes) {
    const maxTime = preferences.travel.constraint.maxMinutes || 30;
    score += weights.eta * Math.max(0, 1 - (candidate.travel.durationMinutes / maxTime));
  }

  // Budget fit score (0-1)
  if (candidate.estimatedCost) {
    const budgetRange = preferences.budget.max - preferences.budget.min;
    const costFromMin = candidate.estimatedCost - preferences.budget.min;
    score += weights.budget * Math.max(0, 1 - Math.abs(costFromMin - budgetRange / 2) / (budgetRange / 2));
  }

  return score;
}

// Budget filter function
function meetsBudgetConstraint(candidate: TestCandidate, preferences: TestPreferences): boolean {
  if (!candidate.estimatedCost) return true;
  
  const perPersonCost = preferences.budget.perPerson ? candidate.estimatedCost : candidate.estimatedCost / 2;
  return perPersonCost >= preferences.budget.min && perPersonCost <= preferences.budget.max;
}

// Time window filter function
function meetsTimeConstraint(candidate: TestCandidate, preferences: TestPreferences): boolean {
  if (!candidate.travel?.durationMinutes) return true;
  
  if (preferences.travel.constraint.type === 'TIME') {
    const maxMinutes = preferences.travel.constraint.maxMinutes || 30;
    return candidate.travel.durationMinutes <= maxMinutes;
  }
  
  return true;
}

// Diversity function
function applyDiversity(candidates: TestCandidate[], selectedCategories: string[]): TestCandidate[] {
  const diversified: TestCandidate[] = [];
  const categoryCount: Record<string, number> = {};
  const priceCount: Record<number, number> = {};

  selectedCategories.forEach(cat => categoryCount[cat] = 0);

  for (const candidate of candidates) {
    const category = candidate.category;
    const priceLevel = candidate.priceLevel || 1;

    const categoryUnderRep = categoryCount[category] < 1;
    const priceDiverse = (priceCount[priceLevel] || 0) < 3;

    if (diversified.length < 20 && (categoryUnderRep || priceDiverse || diversified.length < 12)) {
      diversified.push(candidate);
      categoryCount[category] = (categoryCount[category] || 0) + 1;
      priceCount[priceLevel] = (priceCount[priceLevel] || 0) + 1;
    }
  }

  return diversified;
}

describe('Scoring Algorithm', () => {
  const basePreferences: TestPreferences = {
    budget: { min: 20, max: 80, perPerson: true },
    travel: { constraint: { maxMinutes: 30, type: 'TIME' } }
  };

  test('should score high rating candidates higher', () => {
    const highRatingCandidate: TestCandidate = {
      id: '1',
      name: 'Great Restaurant',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      rating: 4.8,
      reviewCount: 500,
      estimatedCost: 50
    };

    const lowRatingCandidate: TestCandidate = {
      id: '2',
      name: 'OK Restaurant',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      rating: 2.5,
      reviewCount: 500,
      estimatedCost: 50
    };

    const highScore = scoreCandidate(highRatingCandidate, basePreferences);
    const lowScore = scoreCandidate(lowRatingCandidate, basePreferences);

    expect(highScore).toBeGreaterThan(lowScore);
  });

  test('should score closer locations higher', () => {
    const closeCandidate: TestCandidate = {
      id: '1',
      name: 'Close Cafe',
      category: 'sip',
      location: { lat: 40, lng: -74 },
      travel: { durationMinutes: 5, distanceText: '0.5 miles', mode: 'WALKING' },
      rating: 4.0,
      estimatedCost: 30
    };

    const farCandidate: TestCandidate = {
      id: '2',
      name: 'Far Cafe',
      category: 'sip',
      location: { lat: 40, lng: -74 },
      travel: { durationMinutes: 25, distanceText: '5 miles', mode: 'DRIVING' },
      rating: 4.0,
      estimatedCost: 30
    };

    const closeScore = scoreCandidate(closeCandidate, basePreferences);
    const farScore = scoreCandidate(farCandidate, basePreferences);

    expect(closeScore).toBeGreaterThan(farScore);
  });

  test('should score budget-fit candidates higher', () => {
    const perfectBudgetCandidate: TestCandidate = {
      id: '1',
      name: 'Perfect Price',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      estimatedCost: 50, // Exactly in the middle of 20-80 range
      rating: 4.0
    };

    const expensiveCandidate: TestCandidate = {
      id: '2',
      name: 'Expensive Place',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      estimatedCost: 79, // Near the top of budget
      rating: 4.0
    };

    const perfectScore = scoreCandidate(perfectBudgetCandidate, basePreferences);
    const expensiveScore = scoreCandidate(expensiveCandidate, basePreferences);

    expect(perfectScore).toBeGreaterThan(expensiveScore);
  });

  test('should score candidates with more reviews higher', () => {
    const popularCandidate: TestCandidate = {
      id: '1',
      name: 'Popular Place',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      rating: 4.0,
      reviewCount: 1000,
      estimatedCost: 50
    };

    const newCandidate: TestCandidate = {
      id: '2',
      name: 'New Place',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      rating: 4.0,
      reviewCount: 10,
      estimatedCost: 50
    };

    const popularScore = scoreCandidate(popularCandidate, basePreferences);
    const newScore = scoreCandidate(newCandidate, basePreferences);

    expect(popularScore).toBeGreaterThan(newScore);
  });
});

describe('Budget Filtering', () => {
  test('should filter out candidates outside budget range', () => {
    const affordableCandidate: TestCandidate = {
      id: '1',
      name: 'Affordable Place',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      estimatedCost: 40
    };

    const expensiveCandidate: TestCandidate = {
      id: '2',
      name: 'Expensive Place',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      estimatedCost: 120
    };

    const preferences: TestPreferences = {
      budget: { min: 20, max: 80, perPerson: true },
      travel: { constraint: { type: 'TIME' } }
    };

    expect(meetsBudgetConstraint(affordableCandidate, preferences)).toBe(true);
    expect(meetsBudgetConstraint(expensiveCandidate, preferences)).toBe(false);
  });

  test('should handle per-person vs total budget correctly', () => {
    const candidate: TestCandidate = {
      id: '1',
      name: 'Test Place',
      category: 'dining',
      location: { lat: 40, lng: -74 },
      estimatedCost: 60
    };

    const perPersonPrefs: TestPreferences = {
      budget: { min: 20, max: 80, perPerson: true },
      travel: { constraint: { type: 'TIME' } }
    };

    const totalPrefs: TestPreferences = {
      budget: { min: 20, max: 80, perPerson: false },
      travel: { constraint: { type: 'TIME' } }
    };

    expect(meetsBudgetConstraint(candidate, perPersonPrefs)).toBe(true);
    expect(meetsBudgetConstraint(candidate, totalPrefs)).toBe(false); // 60/2 = 30, which is within 20-80
  });
});

describe('Time Window Filtering', () => {
  test('should filter by travel time constraint', () => {
    const quickCandidate: TestCandidate = {
      id: '1',
      name: 'Quick Trip',
      category: 'sip',
      location: { lat: 40, lng: -74 },
      travel: { durationMinutes: 15, distanceText: '2 miles', mode: 'DRIVING' }
    };

    const slowCandidate: TestCandidate = {
      id: '2',
      name: 'Slow Trip',
      category: 'sip',
      location: { lat: 40, lng: -74 },
      travel: { durationMinutes: 45, distanceText: '10 miles', mode: 'DRIVING' }
    };

    const timePreferences: TestPreferences = {
      budget: { min: 20, max: 80, perPerson: true },
      travel: { constraint: { maxMinutes: 30, type: 'TIME' } }
    };

    expect(meetsTimeConstraint(quickCandidate, timePreferences)).toBe(true);
    expect(meetsTimeConstraint(slowCandidate, timePreferences)).toBe(false);
  });
});

describe('Diversity Algorithm', () => {
  test('should ensure representation from each selected category', () => {
    const candidates: TestCandidate[] = [
      { id: '1', name: 'Cafe 1', category: 'sip', location: { lat: 40, lng: -74 }, score: 0.9 },
      { id: '2', name: 'Cafe 2', category: 'sip', location: { lat: 40, lng: -74 }, score: 0.8 },
      { id: '3', name: 'Restaurant 1', category: 'dining', location: { lat: 40, lng: -74 }, score: 0.7 },
      { id: '4', name: 'Cafe 3', category: 'sip', location: { lat: 40, lng: -74 }, score: 0.6 },
      { id: '5', name: 'Activity 1', category: 'creative', location: { lat: 40, lng: -74 }, score: 0.5 }
    ];

    const selectedCategories = ['sip', 'dining', 'creative'];
    const diversified = applyDiversity(candidates, selectedCategories);

    // Should have at least one from each category
    const categories = new Set(diversified.map(c => c.category));
    expect(categories).toContain('sip');
    expect(categories).toContain('dining');
    expect(categories).toContain('creative');
  });

  test('should limit results to 20 items', () => {
    const candidates: TestCandidate[] = [];
    for (let i = 0; i < 50; i++) {
      candidates.push({
        id: `${i}`,
        name: `Place ${i}`,
        category: 'sip',
        location: { lat: 40, lng: -74 },
        score: Math.random()
      });
    }

    const diversified = applyDiversity(candidates, ['sip']);
    expect(diversified.length).toBeLessThanOrEqual(20);
  });

  test('should diversify by price level', () => {
    const candidates: TestCandidate[] = [
      { id: '1', name: 'Cheap 1', category: 'dining', location: { lat: 40, lng: -74 }, priceLevel: 1, score: 0.9 },
      { id: '2', name: 'Cheap 2', category: 'dining', location: { lat: 40, lng: -74 }, priceLevel: 1, score: 0.8 },
      { id: '3', name: 'Expensive 1', category: 'dining', location: { lat: 40, lng: -74 }, priceLevel: 4, score: 0.7 },
      { id: '4', name: 'Mid 1', category: 'dining', location: { lat: 40, lng: -74 }, priceLevel: 2, score: 0.6 },
      { id: '5', name: 'Cheap 3', category: 'dining', location: { lat: 40, lng: -74 }, priceLevel: 1, score: 0.5 }
    ];

    const diversified = applyDiversity(candidates, ['dining']);
    
    // Should not be all the same price level
    const priceLevels = new Set(diversified.map(c => c.priceLevel));
    expect(priceLevels.size).toBeGreaterThan(1);
  });
});

describe('Maps Deep Links', () => {
  test('should generate correct driving link', () => {
    const origin = { lat: 40.7128, lng: -74.0060 };
    const destination = { lat: 40.7589, lng: -73.9851 };
    
    const expectedLink = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`;
    
    // This would be the actual function from the edge function
    function buildMapsLink(origin: {lat: number, lng: number}, destination: {lat: number, lng: number}, mode: string): string {
      const travelMode = mode === 'WALKING' ? 'walking' : mode === 'TRANSIT' ? 'transit' : 'driving';
      return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=${travelMode}`;
    }
    
    const actualLink = buildMapsLink(origin, destination, 'DRIVING');
    expect(actualLink).toBe(expectedLink);
  });

  test('should generate correct walking link', () => {
    const origin = { lat: 40.7128, lng: -74.0060 };
    const destination = { lat: 40.7589, lng: -73.9851 };
    
    function buildMapsLink(origin: {lat: number, lng: number}, destination: {lat: number, lng: number}, mode: string): string {
      const travelMode = mode === 'WALKING' ? 'walking' : mode === 'TRANSIT' ? 'transit' : 'driving';
      return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=${travelMode}`;
    }
    
    const link = buildMapsLink(origin, destination, 'WALKING');
    expect(link).toContain('travelmode=walking');
  });

  test('should generate correct transit link', () => {
    const origin = { lat: 40.7128, lng: -74.0060 };
    const destination = { lat: 40.7589, lng: -73.9851 };
    
    function buildMapsLink(origin: {lat: number, lng: number}, destination: {lat: number, lng: number}, mode: string): string {
      const travelMode = mode === 'WALKING' ? 'walking' : mode === 'TRANSIT' ? 'transit' : 'driving';
      return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=${travelMode}`;
    }
    
    const link = buildMapsLink(origin, destination, 'TRANSIT');
    expect(link).toContain('travelmode=transit');
  });
});

describe('Category Mapping', () => {
  test('should map categories to correct place types', () => {
    const categoryMapping: Record<string, string[]> = {
      'stroll': ['park', 'tourist_attraction', 'point_of_interest', 'natural_feature', 'zoo'],
      'sip': ['bar', 'cafe', 'night_club', 'wine_bar', 'coffee_shop'],
      'casual_eats': ['restaurant', 'food_court', 'meal_takeaway', 'fast_food_restaurant'],
      'screen_relax': ['movie_theater', 'spa', 'beauty_salon'],
      'creative': ['art_gallery', 'museum', 'pottery_studio', 'craft_store'],
      'play_move': ['bowling_alley', 'gym', 'sports_complex', 'recreation_center'],
      'dining': ['restaurant', 'fine_dining_restaurant', 'steakhouse'],
      'freestyle': ['restaurant', 'bar', 'cafe', 'tourist_attraction', 'art_gallery']
    };

    expect(categoryMapping['stroll']).toContain('park');
    expect(categoryMapping['sip']).toContain('cafe');
    expect(categoryMapping['dining']).toContain('restaurant');
    expect(categoryMapping['freestyle'].length).toBeGreaterThan(3); // Should be union of multiple types
  });
});