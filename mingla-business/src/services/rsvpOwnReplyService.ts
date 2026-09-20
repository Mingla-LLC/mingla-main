/** #3416 FINDING-1 — a signed-in guest's own going RSVP for one event.
 *
 * Reads through `fetch_user_going_rsvps`, the self-scoped authenticated RPC the
 * Explorer calendar already uses (SECURITY DEFINER, EXECUTE for authenticated
 * only, and it refuses any p_user_id other than auth.uid()). It returns the
 * caller's going RSVPs, approved or awaiting approval, with the server-minted
 * pass QR. Only the caller's own primary row for this event is used here.
 *
 * Loaded on demand by the public RSVP page's recovery hook only, so neither it
 * nor its client import is evaluated for anonymous visitors.
 */
import { supabase } from "./supabase";

export interface OwnGoingRsvp {
  rsvpId: string;
  approvalStatus: "pending" | "approved";
  qrCode: string | null;
  displayName: string | null;
}

export const fetchOwnGoingRsvp = async (
  userId: string,
  eventId: string,
): Promise<OwnGoingRsvp | null> => {
  const { data, error } = await supabase.rpc("fetch_user_going_rsvps", {
    p_user_id: userId,
  });
  if (error) throw error;
  const row = ((data ?? []) as Array<Record<string, unknown>>).find(
    (candidate) => candidate.event_id === eventId && candidate.role === "primary",
  );
  if (row === undefined || typeof row.rsvp_id !== "string") return null;
  return {
    rsvpId: row.rsvp_id,
    approvalStatus: row.approval_status === "approved" ? "approved" : "pending",
    qrCode: typeof row.qr_code === "string" && row.qr_code.trim().length > 0 ? row.qr_code : null,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
  };
};
