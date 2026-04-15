import type { BoardSessionPreferences } from '../hooks/useBoardSession';

// ORCH-0434: Removed priceTiers, budgetMin, budgetMax. Added selectedDates.
export interface AggregatedCollaborationPrefs {
  categories: string[];
  intents: string[];
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref: string | null;
  location: { lat: number; lng: number } | null;
  selectedDates: string[];
}

/**
 * Aggregate ALL preferences across all participants using union logic.
 *
 * Aggregation rules:
 * - categories: union of all participants' categories (deduplicated)
 * - intents: union of all participants' intents (deduplicated)
 * - priceTiers: union
 * - budgetMin: Math.min()
 * - budgetMax: Math.max()
 * - travelMode: most common, default 'walking'
 * - travelConstraintType: always 'time' (distance option removed)
 * - travelConstraintValue: median (not min — avoids extreme restriction)
 * - datetimePref: earliest ISO string
 * - location: midpoint of all custom_lat/custom_lng, null if none
 */
export function aggregateAllPrefs(
  rows: BoardSessionPreferences[]
): AggregatedCollaborationPrefs {
  if (rows.length === 0) {
    return {
      categories: [],
      intents: [],
      travelMode: 'walking',
      travelConstraintType: 'time',
      travelConstraintValue: 30,
      datetimePref: null,
      location: null,
      selectedDates: [],
    };
  }

  // Categories: union of all participants
  const categorySet = new Set<string>();
  for (const row of rows) {
    for (const cat of (row.categories || [])) {
      categorySet.add(cat);
    }
  }
  const categories = Array.from(categorySet);

  // Intents: union of all participants
  const intentSet = new Set<string>();
  for (const row of rows) {
    for (const intent of (row.intents || [])) {
      intentSet.add(intent);
    }
  }
  const intents = Array.from(intentSet);

  // ORCH-0434: Price tiers and budget removed from aggregation.

  // Selected dates: union of all participants' dates
  const dateSet = new Set<string>();
  for (const row of rows) {
    const dates = (row as any).selected_dates;
    if (Array.isArray(dates)) {
      for (const d of dates) dateSet.add(d);
    }
  }
  const selectedDates = Array.from(dateSet);

  // Travel mode: majority vote
  const travelMode = majorityVote(
    rows.map((r) => r.travel_mode || 'walking'),
    'walking'
  );

  // Travel constraint type: always 'time' (distance option removed)
  const travelConstraintType = 'time' as const;

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

  // Note: dateOption, timeSlot, and exactTime are NOT aggregated.
  // These are solo-mode UI concepts (date picker selections). In collab mode,
  // the edge function falls back to datetimePref-based filtering, which IS aggregated
  // above as the earliest participant's datetime preference.

  return {
    categories,
    intents,
    travelMode,
    travelConstraintType,
    travelConstraintValue,
    datetimePref,
    location,
    selectedDates,
  };
}

/**
 * M7 FIX: Deterministic tie-breaking.
 * When two values have the same count, the previous implementation relied on
 * Object.entries() iteration order, which is insertion-order and thus
 * non-deterministic when values arrive in different orders across clients.
 * Fix: on tie, sort alphabetically so all clients pick the same winner.
 */
function majorityVote(values: string[], fallback: string): string {
  const counts: Record<string, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }

  // Sort entries by count descending, then alphabetically for deterministic tie-breaking
  const sorted = Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // higher count first
    return a[0].localeCompare(b[0]);        // alphabetical tie-break
  });

  return sorted.length > 0 ? sorted[0][0] : fallback;
}
