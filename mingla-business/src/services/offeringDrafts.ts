// ORCH-1123 [Hub multi-select draft delete] — batch draft-discard service.
//
// Thin wrapper over the business_discard_offering_drafts RPC (event/trip/
// experience — one events table). The server SKIPs-and-reports per row and
// never aborts the batch, so this returns the per-row outcome array verbatim
// for the caller to tally into a no-silent-failure toast.
//
// supabase.rpc is untyped in mingla-business (no generated Database type) —
// matches the existing discardServerDraft pattern in eventDrafts.ts.

import { supabase } from "./supabase";

export type DraftDiscardOutcome =
  | "deleted"
  | "skipped_not_draft"
  | "skipped_not_found"
  | "forbidden";

export interface DraftDiscardRow {
  eventId: string;
  outcome: DraftDiscardOutcome;
}

/**
 * Batch soft-delete draft offerings (event/trip/experience — one events table).
 * Server SKIPs-and-reports per row; never aborts the batch.
 * Returns the per-row outcome array.
 */
export async function discardOfferingDrafts(
  eventIds: string[],
): Promise<DraftDiscardRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase.rpc(
    "business_discard_offering_drafts",
    { p_event_ids: eventIds },
  );
  if (error !== null) throw error;
  const rows = (data ?? []) as Array<{ event_id: string; outcome: string }>;
  return rows.map((r) => ({
    eventId: r.event_id,
    outcome: r.outcome as DraftDiscardOutcome,
  }));
}
