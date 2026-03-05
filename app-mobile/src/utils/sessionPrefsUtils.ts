import type { BoardSessionPreferences } from '../hooks/useBoardSession';

export interface AggregatedNonRotatingPrefs {
  priceTiers: string[];
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: string;
  travelConstraintValue: number;
  datetimePref: string | null;
  location: { lat: number; lng: number } | null;
}

/**
 * Aggregate NON-ROTATING preferences across all participants.
 * Categories and intents are NOT aggregated — they come from the active
 * rotation participant only.
 *
 * Aggregation rules:
 * - priceTiers: union
 * - budgetMin: Math.min()
 * - budgetMax: Math.max()
 * - travelMode: most common, default 'walking'
 * - travelConstraintType: most common, default 'time'
 * - travelConstraintValue: median (not min — avoids extreme restriction)
 * - datetimePref: earliest ISO string
 * - location: midpoint of all custom_lat/custom_lng, null if none
 */
export function aggregateNonRotatingPrefs(
  rows: BoardSessionPreferences[]
): AggregatedNonRotatingPrefs {
  if (rows.length === 0) {
    return {
      priceTiers: ['chill', 'comfy', 'bougie', 'lavish'],
      budgetMin: 0,
      budgetMax: 1000,
      travelMode: 'walking',
      travelConstraintType: 'time',
      travelConstraintValue: 30,
      datetimePref: null,
      location: null,
    };
  }

  // Price tiers: union
  const tierSet = new Set<string>();
  for (const row of rows) {
    for (const tier of (row.price_tiers || [])) {
      tierSet.add(tier);
    }
  }
  const priceTiers = tierSet.size > 0
    ? Array.from(tierSet)
    : ['chill', 'comfy', 'bougie', 'lavish'];

  // Budget: widest range
  const budgetMin = Math.min(...rows.map((r) => r.budget_min ?? 0));
  const budgetMax = Math.max(...rows.map((r) => r.budget_max ?? 1000));

  // Travel mode: majority vote
  const travelMode = majorityVote(
    rows.map((r) => r.travel_mode || 'walking'),
    'walking'
  );

  // Travel constraint type: majority vote
  const travelConstraintType = majorityVote(
    rows.map((r) => r.travel_constraint_type || 'time'),
    'time'
  );

  // Travel constraint value: MEDIAN (not min)
  const constraintValues = rows
    .map((r) => r.travel_constraint_value ?? 30)
    .sort((a, b) => a - b);
  const mid = Math.floor(constraintValues.length / 2);
  const travelConstraintValue = constraintValues.length % 2 === 0
    ? Math.round((constraintValues[mid - 1] + constraintValues[mid]) / 2)
    : constraintValues[mid];

  // Datetime: earliest
  const datetimes = rows
    .map((r) => r.datetime_pref)
    .filter((d): d is string => d !== null && d !== undefined)
    .sort();
  const datetimePref = datetimes.length > 0 ? datetimes[0] : null;

  // Location: midpoint of custom coordinates
  const coords = rows
    .filter((r) => r.custom_lat != null && r.custom_lng != null)
    .map((r) => ({ lat: r.custom_lat!, lng: r.custom_lng! }));

  let location: { lat: number; lng: number } | null = null;
  if (coords.length > 0) {
    const avgLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
    const avgLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
    location = { lat: avgLat, lng: avgLng };
  }

  return {
    priceTiers,
    budgetMin,
    budgetMax,
    travelMode,
    travelConstraintType,
    travelConstraintValue,
    datetimePref,
    location,
  };
}

function majorityVote(values: string[], fallback: string): string {
  const counts: Record<string, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  let best = fallback;
  let bestCount = 0;
  for (const [val, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}
