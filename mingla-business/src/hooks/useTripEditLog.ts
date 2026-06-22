/**
 * useTripEditLog — reader for the `trip_edit_log` audit table (ORCH-0876).
 *
 * RLS: owner brand at event_manager+ rank reads own brand's logs.
 * Only `biz_update_live_trip` writes to this table (no client INSERT/
 * UPDATE/DELETE policy).
 *
 * Used by:
 *   - EditPublishedTripScreen (optional) to show "Last edited by … N hours ago"
 *   - Future consumer-app buyer surface to read material-change history
 *
 * NOT a replacement for the in-modal diff — that's computed client-side
 * from the patch. The edit log is the permanent history.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { useAuth } from "../context/AuthContext";

const EDIT_LOG_STALE_MS = 30 * 1000;

export interface TripEditLogEntry {
  id: string;
  eventId: string;
  brandId: string;
  editedBy: string;
  reason: string;
  severity: "additive" | "material";
  changedFieldKeys: string[];
  diffSummary: Record<string, unknown>;
  affectedOrderIds: string[];
  occurredAt: string;
}

export const tripEditLogKeys = {
  byTrip: (eventId: string, limit: number) =>
    ["trip-edit-log", eventId, "limit", limit] as const,
};

const DISABLED_KEY = ["trip-edit-log", "__disabled__"] as const;

export const useTripEditLog = (
  tripEventId: string | null,
  limit = 20,
): UseQueryResult<TripEditLogEntry[], Error> => {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && tripEventId !== null && tripEventId.length > 0;
  return useQuery<TripEditLogEntry[], Error>({
    queryKey: enabled ? tripEditLogKeys.byTrip(tripEventId, limit) : DISABLED_KEY,
    enabled,
    staleTime: EDIT_LOG_STALE_MS,
    queryFn: async (): Promise<TripEditLogEntry[]> => {
      if (!enabled || tripEventId === null) return [];
      const { data, error } = await supabase
        .from("trip_edit_log")
        .select("*")
        .eq("event_id", tripEventId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error !== null) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];
      return rows.map(
        (r): TripEditLogEntry => ({
          id: r.id,
          eventId: r.event_id,
          brandId: r.brand_id,
          editedBy: r.edited_by,
          reason: r.reason,
          severity: r.severity,
          changedFieldKeys: Array.isArray(r.changed_field_keys)
            ? r.changed_field_keys
            : [],
          diffSummary: r.diff_summary ?? {},
          affectedOrderIds: Array.isArray(r.affected_order_ids)
            ? r.affected_order_ids
            : [],
          occurredAt: r.occurred_at,
        }),
      );
    },
  });
};
