/**
 * ORCH-1150 — host RSVP approve/deny/remove service callers (A2).
 *
 * setRsvpStatus is the SINGLE caller serving Approve ('approved'), Deny
 * ('denied' from pending) AND Remove ('denied' from approved — the A2-NEW
 * host-remove). The server disambiguates by the source state; there is no
 * separate remove RPC. host_bulk_approve_rsvps approves all pending up to cap.
 *
 * ORCH-1150: do NOT merge back into the event/ticket path. See SPEC §5.4.
 */

import { supabase } from "./supabase";
import { createGuestRosterRequestId } from "./guestRosterService";
import { RsvpRpcError } from "./rsvpRpcFailure";

export type RsvpStatusValue = "going" | "not_going" | "waitlisted" | "maybe";
export type RsvpApprovalValue = "pending" | "approved" | "denied";

/** ORCH-1334 — where the RSVP came from. 'app' = a signed-in Mingla member
 *  (identity resolved from their profile at read time); 'web' = an anonymous
 *  link guest who typed their details. */
export type RsvpSourceValue = "app" | "web";

export interface RsvpGuest {
  id: string;
  eventId: string;
  userId: string | null;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  rsvpStatus: RsvpStatusValue;
  approvalStatus: RsvpApprovalValue;
  plusCount: number;
  waitlistedAt: string | null;
  promotedAt: string | null;
  createdAt: string;
  // ORCH-1334 — read-time identity + provenance resolved from profiles by
  // host_list_rsvp_guests. `displayName` is always the real name for app members
  // (never the 'Guest' sentinel) and the typed name for web guests. `phone` is
  // NULL when absent — never fabricated. `email` is always present for app rows.
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
  source: RsvpSourceValue;
  checkedInAt: string | null;
  checkedInBy: string | null;
  plusCheckedInCount: number;
  plusCheckins: Array<{ id: string; name: string; checkedInAt: string | null; checkedInBy: string | null }>;
}

interface RsvpGuestRow {
  id: string;
  event_id: string;
  user_id: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  rsvp_status: RsvpStatusValue;
  approval_status: RsvpApprovalValue;
  plus_count: number;
  waitlisted_at: string | null;
  promoted_at: string | null;
  created_at: string;
  // ORCH-1334 appended identity/provenance columns.
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  source: RsvpSourceValue;
  checked_in_at: string | null;
  checked_in_by: string | null;
  plus_checked_in_count: number | null;
  plus_checkins: Array<{
    id: string; name: string; checkedInAt: string | null; checkedInBy: string | null;
  }> | null;
}

const rowToGuest = (r: RsvpGuestRow): RsvpGuest => ({
  id: r.id,
  eventId: r.event_id,
  userId: r.user_id,
  guestName: r.guest_name,
  guestEmail: r.guest_email,
  guestPhone: r.guest_phone,
  rsvpStatus: r.rsvp_status,
  approvalStatus: r.approval_status,
  plusCount: r.plus_count,
  waitlistedAt: r.waitlisted_at,
  promotedAt: r.promoted_at,
  createdAt: r.created_at,
  // ORCH-1334 — resolved identity/provenance. Defensive fallbacks keep older
  // cached rows (pre-migration shape) from crashing the mapper: displayName falls
  // back to the raw guest_name, source to a user_id-derived binary.
  displayName:
    typeof r.display_name === "string" && r.display_name.length > 0
      ? r.display_name
      : r.guest_name,
  username: r.username ?? null,
  avatarUrl: r.avatar_url ?? null,
  email: r.email ?? r.guest_email ?? null,
  phone: r.phone ?? null,
  source: r.source ?? (r.user_id !== null ? "app" : "web"),
  checkedInAt: r.checked_in_at ?? null,
  checkedInBy: r.checked_in_by ?? null,
  plusCheckedInCount: r.plus_checked_in_count ?? 0,
  plusCheckins: r.plus_checkins ?? [],
});

export const listRsvpGuests = async (eventId: string): Promise<RsvpGuest[]> => {
  const { data, error } = await supabase.rpc("host_list_rsvp_guests", {
    p_event_id: eventId,
  });
  // issue #3047 — see the note on setRsvpStatus below.
  if (error !== null) throw new RsvpRpcError(error, "rsvp_guest_list_failed");
  const rows = (data ?? []) as RsvpGuestRow[];
  return rows.map(rowToGuest);
};

export interface SetRsvpStatusResult {
  ok: boolean;
  rsvpId: string;
  approvalStatus: RsvpApprovalValue;
  wasRemoved: boolean;
  pendingCountRemaining: number;
  goingCountRemaining: number;
}

export const setRsvpStatus = async (
  eventId: string,
  rsvpId: string,
  status: "approved" | "denied",
): Promise<SetRsvpStatusResult> => {
  const { data, error } = await supabase.rpc("business_set_rsvp_guest_status", {
    p_event_id: eventId,
    p_decision: status === "approved" ? "approve" : "deny",
    p_scope: "selected",
    p_roster_keys: [`rsvp:${rsvpId}`],
    p_expected_watermark: null,
    p_client_request_id: createGuestRosterRequestId(),
  });
  // issue #3047 — a PostgREST failure is a PLAIN OBJECT, not an Error. Thrown
  // raw, React Query hands the mutation's onError a value whose `.message` no
  // `instanceof Error` reader can see, so approve/deny could only ever produce
  // a generic "Try again." — including for the TERMINAL 404 this RPC returns
  // in production today, where retrying can never succeed. RsvpRpcError keeps
  // the message and carries the code that separates terminal from transient.
  if (error !== null) throw new RsvpRpcError(error, "rsvp_guest_status_failed");
  const res = (data ?? {}) as {
    appliedCount?: number;
    pendingRemaining?: number;
    goingPersonCount?: number;
    outcomes?: Array<{ outcome?: string; wasRemoved?: boolean }>;
  };
  return {
    ok: (res.appliedCount ?? 0) > 0 || res.outcomes?.[0]?.outcome === "unchanged",
    rsvpId,
    approvalStatus: status,
    wasRemoved: res.outcomes?.[0]?.wasRemoved === true,
    pendingCountRemaining: res.pendingRemaining ?? 0,
    goingCountRemaining: res.goingPersonCount ?? 0,
  };
};

export interface BulkApproveResult {
  approvedCount: number;
  skippedForCapacity: number;
}

export const bulkApproveRsvps = async (
  eventId: string,
): Promise<BulkApproveResult> => {
  const { data, error } = await supabase.rpc("business_set_rsvp_guest_status", {
    p_event_id: eventId,
    p_decision: "approve",
    p_scope: "all_pending",
    p_roster_keys: null,
    p_expected_watermark: null,
    p_client_request_id: createGuestRosterRequestId(),
  });
  // issue #3047 — same PostgREST-plain-object hazard as setRsvpStatus above.
  if (error !== null) throw new RsvpRpcError(error, "rsvp_bulk_approve_failed");
  const res = (data ?? {}) as {
    appliedCount?: number;
    skippedForCapacity?: number;
  };
  return {
    approvedCount: res.appliedCount ?? 0,
    skippedForCapacity: res.skippedForCapacity ?? 0,
  };
};
