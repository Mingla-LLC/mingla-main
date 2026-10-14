/**
 * rsvpLifecycleService — #3645: a published RSVP can be returned to draft, and
 * a host can know whether guests have paid chip-ins before cancelling it.
 *
 * Kept out of `rsvpEvents.ts` on purpose: that module is imported by screens
 * every visitor loads, and these two calls are only made from the host's
 * lazily loaded RSVP lifecycle dialogs.
 */

import { supabase } from "./supabase";
import { RsvpRpcError } from "./rsvpRpcFailure";

/**
 * Returns a published RSVP to draft (`business_unpublish_rsvp_to_draft`).
 * The server refuses when anyone has responded or paid a chip-in
 * (`rsvp_unpublish_has_commitments`); see `rsvpUnpublishFailureCopy`.
 */
export const unpublishRsvpToDraft = async (
  eventId: string,
): Promise<{ eventId: string }> => {
  const { data, error } = await supabase.rpc("business_unpublish_rsvp_to_draft", {
    p_event_id: eventId,
  });
  if (error !== null) throw new RsvpRpcError(error, "rsvp_unpublish_failed");
  const id = (data as { event?: { id?: unknown } } | null)?.event?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("rsvp_unpublish_empty_response");
  }
  return { eventId: id };
};

/**
 * How many chip-ins guests have PAID for this RSVP and not been fully
 * refunded: the ones a cancel queues for refund. Throws when the read fails,
 * so the caller can say "not known" instead of "none".
 */
export const countPaidRsvpChipIns = async (eventId: string): Promise<number> => {
  const { data, error } = await supabase
    .from("event_rsvp_contributions")
    .select("buyer_total_cents, refunded_amount_cents")
    .eq("event_id", eventId)
    .in("status", ["paid", "partially_refunded"]);
  if (error !== null) throw error;
  if (!Array.isArray(data)) {
    throw new Error("rsvp_chip_in_count_unavailable");
  }
  // The server's own rule: only a chip-in with money left to refund is queued.
  return (data as {
    buyer_total_cents: number | null;
    refunded_amount_cents: number | null;
  }[]).filter(
    (row) => (row.buyer_total_cents ?? 0) > (row.refunded_amount_cents ?? 0),
  ).length;
};
