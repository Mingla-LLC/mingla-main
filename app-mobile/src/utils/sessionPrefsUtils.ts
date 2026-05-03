import type { BoardSessionPreferences } from '../hooks/useBoardSession';

/**
 * ORCH-0446: Corrected aggregation for collaboration sessions.
 *
 * Aggregation rules (all confirmed by user in 50-question design session):
 * - categories:           UNION (R3.1)
 * - intents:              UNION (R3.9)
 * - travelMode:           MOST PERMISSIVE — driving > transit > biking > walking (R3.2)
 * - travelConstraintValue: MAX — longest distance wins (R3.3)
 * - dates:                INTERSECTION first, UNION fallback if 0 results (R3.4, R3.5)
 * - location:             midpoint of all participants' GPS (R3.6)
 * - selectedDates:        UNION for pick_dates participants
 *
 * Previous bugs fixed:
 * - travelMode was majority vote → now most permissive
 * - travelConstraintValue was median → now MAX
 * - dateOption was "most permissive single window" → now dateWindows array for AND logic
 */

export interface AggregatedCollabPrefs {
  categories: string[];
  intents: string[];
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref: string | null;
  dateOption: string;
  dateWindows: string[];
  selectedDates: string[];
  location: { lat: number; lng: number } | null;
}

const MODE_RANK: Record<string, number> = {
  walking: 1,
  biking: 2,
  bicycling: 2,
  transit: 3,
  driving: 4,
};

const DATE_RANK: Record<string, number> = {
  'now': 1, 'today': 2,
  'this-weekend': 3, 'this weekend': 3, 'this_weekend': 3,
  'pick-a-date': 4, 'pick_dates': 4,
};

export function aggregateCollabPrefs(
  rows: BoardSessionPreferences[]
): AggregatedCollabPrefs {
  if (rows.length === 0) {
    return {
      categories: [],
      intents: [],
      travelMode: 'walking',
      travelConstraintType: 'time',
      travelConstraintValue: 30,
      datetimePref: null,
      dateOption: 'today',
      dateWindows: [],
      selectedDates: [],
      location: null,
    };
  }

  // Categories: UNION (R3.1) — combine everyone's categories, deduplicate.
  // ORCH-0699: Per-row toggle gate. If a participant flipped "See popular options?"
  // OFF in their preferences sheet, their selected categories MUST be excluded from
  // the union — otherwise their hidden pills would contaminate everyone's deck.
  // The gate is per-row (not per-aggregator) so opted-in participants still get
  // their R3.1 UNION semantics; opted-out participants contribute zero category
  // signal. `?? true` defensive default for legacy collab rows that pre-date
  // ORCH-0434 (BoardSessionPreferences.category_toggle is optional in the type).
  // DO NOT remove without first plumbing toggle data through the deck wire payload.
  const categorySet = new Set<string>();
  for (const row of rows) {
    if (!(row.category_toggle ?? true)) continue;
    for (const cat of (row.categories || [])) {
      categorySet.add(cat);
    }
  }

  // Intents: UNION (R3.9) — combine everyone's intents, deduplicate.
  // ORCH-0699: Per-row toggle gate (mirrors categories above). Skip rows whose
  // intent_toggle is false — see comment block on the categories loop for full
  // rationale.
  const intentSet = new Set<string>();
  for (const row of rows) {
    if (!(row.intent_toggle ?? true)) continue;
    for (const intent of (row.intents || [])) {
      intentSet.add(intent);
    }
  }

  // Travel mode: MOST PERMISSIVE (R3.2) — highest MODE_RANK wins
  const travelMode = rows
    .map(r => r.travel_mode || 'walking')
    .sort((a, b) => (MODE_RANK[b] ?? 0) - (MODE_RANK[a] ?? 0))[0] || 'walking';

  // Travel constraint: MAX (R3.3) — longest travel time wins
  const travelConstraintValue = Math.max(
    ...rows.map(r => r.travel_constraint_value ?? 30)
  );

  // Date windows: collect ALL unique date options for AND logic (R3.4)
  const dateWindows: string[] = [];
  for (const row of rows) {
    const opt = row.date_option || 'today';
    if (!dateWindows.includes(opt)) {
      dateWindows.push(opt);
    }
  }

  // Selected dates: UNION — combine all pick_dates participants' selected dates
  const dateSet = new Set<string>();
  for (const row of rows) {
    const dates = row.selected_dates;
    if (Array.isArray(dates)) {
      for (const d of dates) dateSet.add(d);
    }
  }

  // Datetime pref: earliest (for filtering reference)
  const datetimes = rows
    .map(r => r.datetime_pref)
    .filter((d): d is string => d !== null && d !== undefined)
    .sort();

  // Location: midpoint of all participants' GPS coordinates (R3.6)
  const coords = rows
    .filter(r => r.custom_lat != null && r.custom_lng != null)
    .map(r => ({ lat: r.custom_lat!, lng: r.custom_lng! }));

  let location: { lat: number; lng: number } | null = null;
  if (coords.length > 0) {
    location = {
      lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length,
      lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length,
    };
  }

  // Date option: most permissive single window (backward compat for discover-cards solo mode)
  const dateOption = rows
    .map(r => r.date_option || 'today')
    .sort((a, b) => (DATE_RANK[b] ?? 0) - (DATE_RANK[a] ?? 0))[0] || 'today';

  return {
    categories: Array.from(categorySet),
    intents: Array.from(intentSet),
    travelMode,
    travelConstraintType: 'time',
    travelConstraintValue,
    datetimePref: datetimes.length > 0 ? datetimes[0] : null,
    dateOption,
    dateWindows,
    selectedDates: Array.from(dateSet),
    location,
  };
}

// Legacy export for any remaining callers (will be removed in cleanup)
export const aggregateAllPrefs = aggregateCollabPrefs;
