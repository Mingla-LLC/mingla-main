/**
 * ORCH-1150 — consumer-app RSVP write (Going / Not-going) for the discover deck.
 *
 * A discoverable RSVP event (host opted in via rsvp_discoverable) surfaces on the
 * deck with a Going/Not-going CTA instead of Book. The consumer app user is
 * authenticated, so the write rides the logged-in path: the JWT on the supabase
 * client lets the public-submit-rsvp edge fn resolve user_id (the link-guest
 * name+email+phone requirement does NOT apply — profile supplies contact + push).
 *
 * do NOT merge back into the checkout/booking path — RSVP writes a Going/Not-going
 * row, never an order. See SPEC §4.8 / §5.3.
 */

import { supabase } from "./supabase";

export interface SubmitDeckRsvpResult {
  status: "going" | "not_going" | "waitlisted";
  approvalStatus: "pending" | "approved";
}

/**
 * Write the signed-in user's Going/Not-going for a discoverable RSVP event.
 * Throws an Error whose message is the edge-fn error code (rsvp_full /
 * rsvp_not_open / …) so the caller can show the right toast.
 */
export const submitDeckRsvp = async (
  eventId: string,
  rsvpStatus: "going" | "not_going",
): Promise<SubmitDeckRsvpResult> => {
  const { data, error } = await supabase.functions.invoke("public-submit-rsvp", {
    body: { eventId, rsvpStatus },
  });
  if (error !== null) {
    let code = error.message ?? "rsvp_write_failed";
    const ctx = (error as { context?: { body?: unknown } }).context;
    if (ctx?.body !== undefined && ctx.body !== null) {
      try {
        const parsed =
          typeof ctx.body === "string"
            ? (JSON.parse(ctx.body) as { error?: string })
            : (ctx.body as { error?: string });
        if (typeof parsed.error === "string" && parsed.error.length > 0) {
          code = parsed.error;
        }
      } catch {
        // keep default code
      }
    }
    throw new Error(code);
  }
  const res = (data ?? {}) as {
    status?: "going" | "not_going" | "waitlisted";
    approvalStatus?: "pending" | "approved";
  };
  return {
    status: res.status ?? rsvpStatus,
    approvalStatus: res.approvalStatus ?? "approved",
  };
};
