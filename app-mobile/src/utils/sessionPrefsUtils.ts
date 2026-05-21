/**
 * ORCH-0902 [Collab session deck deterministic rewrite] — DEPRECATED.
 *
 * `aggregateCollabPrefs` and the legacy MOST-PERMISSIVE / MAX / midpoint
 * aggregation rules were RETIRED by CR-9 (full single-shot cutover,
 * 2026-05-21). All aggregation now happens server-side in the SQL function
 * `pg_aggregate_collab_prefs(session_id)`, called by the `discover-cards`
 * edge function's deterministic-v2 path.
 *
 * Client code MUST NOT call this function. The collab deck fetch payload
 * is now exactly `{ session_id, expected_deck_version }` — no aggregation
 * happens client-side at all (CR-1 determinism contract).
 *
 * This stub is retained for ONE release cycle so any forgotten import
 * surfaces with a clear error pointing at the replacement. Permanent
 * deletion of the file is queued for the follow-up cleanup ORCH.
 *
 * Why this memory exists: the original client-side aggregation produced
 * silently divergent decks across participants (the location MIDPOINT rule
 * read only custom_lat/lng and ignored GPS, plus the per-client GPS
 * fallback at RecommendationsContext.tsx:697). See the full investigation
 * at Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md.
 */
import type { BoardSessionPreferences } from '../hooks/useBoardSession';

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

export function aggregateCollabPrefs(
  _rows: BoardSessionPreferences[],
): AggregatedCollabPrefs {
  throw new Error(
    'aggregateCollabPrefs has been removed in ORCH-0902. ' +
      'Client-side aggregation is forbidden under CR-1 (deck is a pure function of session state). ' +
      'Use server-side pg_aggregate_collab_prefs via the discover-cards deterministic-v2 path instead. ' +
      'See Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md.',
  );
}

// Legacy export retained for ONE release cycle. Throws on call.
export const aggregateAllPrefs = aggregateCollabPrefs;
