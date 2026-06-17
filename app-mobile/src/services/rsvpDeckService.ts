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

/**
 * ORCH-1156 [rsvp-public-redesign] OQ-1 (resolved = option a) — the consumer RSVP
 * detail needs the live going-count + capacity + waitlist/approval to render the
 * Direction-C momentum unit, but the deck seed does NOT carry them (investigation
 * F-6). Rather than widen the deck-supply RPC (option b → would trip the
 * COMMS-0002 backend-allowlist gate), the consumer reads the SAME anon-safe
 * `business_public_events_view` the buyer-web page uses — one data contract, NO
 * migration, NO edge function. The view is security_invoker=false (definer) so the
 * anon/authenticated read is safe; it never touches `.from('brands')`.
 *
 * Returns null on a missing row (deleted/unpublished) — the screen then renders
 * the decision + chips WITHOUT a fabricated count (still honest, rule 9).
 */
export interface RsvpMomentumSnapshot {
  goingCount: number;
  capacity: number | null;
  allowPlusOnes: boolean;
  plusOnesMax: number;
  waitlistEnabled: boolean;
  manualApproval: boolean;
}

interface RsvpMomentumRow {
  rsvp_going_count: number | null;
  rsvp_capacity: number | null;
  rsvp_allow_plus_ones: boolean | null;
  rsvp_plus_ones_max: number | null;
  rsvp_waitlist_enabled: boolean | null;
  rsvp_approval_mode: "auto" | "manual" | null;
}

export const fetchRsvpMomentum = async (
  eventId: string,
): Promise<RsvpMomentumSnapshot | null> => {
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select(
      "rsvp_going_count,rsvp_capacity,rsvp_allow_plus_ones,rsvp_plus_ones_max,rsvp_waitlist_enabled,rsvp_approval_mode",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error !== null) throw error;
  const row = data as RsvpMomentumRow | null;
  if (row === null) return null;
  return {
    goingCount: row.rsvp_going_count ?? 0,
    capacity: row.rsvp_capacity ?? null,
    allowPlusOnes: row.rsvp_allow_plus_ones ?? false,
    plusOnesMax: row.rsvp_plus_ones_max ?? 0,
    waitlistEnabled: row.rsvp_waitlist_enabled ?? false,
    manualApproval: row.rsvp_approval_mode === "manual",
  };
};

export interface SubmitDeckRsvpResult {
  status: "going" | "not_going" | "waitlisted" | "maybe";
  approvalStatus: "pending" | "approved";
}

/**
 * Write the signed-in user's Going / Maybe / Not-going for a discoverable RSVP
 * event. Throws an Error whose message is the edge-fn error code (rsvp_full /
 * rsvp_not_open / …) so the caller can show the right toast.
 *
 * ORCH-1156 [rsvp-public-redesign] — "maybe" added to the write enum so the
 * consumer RSVP detail reaches parity with the shared RsvpPublicBody (which has
 * had Maybe since ORCH-1150 R2). The public-submit-rsvp edge fn already accepts
 * "maybe"; this only widens the consumer caller (was narrowed to going/not_going).
 */
export const submitDeckRsvp = async (
  eventId: string,
  rsvpStatus: "going" | "not_going" | "maybe",
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
    status?: "going" | "not_going" | "waitlisted" | "maybe";
    approvalStatus?: "pending" | "approved";
  };
  return {
    status: res.status ?? rsvpStatus,
    approvalStatus: res.approvalStatus ?? "approved",
  };
};
