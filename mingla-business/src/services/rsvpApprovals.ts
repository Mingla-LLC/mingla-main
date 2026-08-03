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
  if (error !== null) throw error;
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
  rsvpId: string,
  status: "approved" | "denied",
): Promise<SetRsvpStatusResult> => {
  const { data, error } = await supabase.rpc("host_set_rsvp_status", {
    p_rsvp_id: rsvpId,
    p_status: status,
  });
  if (error !== null) throw error;
  const res = (data ?? {}) as {
    ok?: boolean;
    rsvpId?: string;
    approvalStatus?: RsvpApprovalValue;
    wasRemoved?: boolean;
    pendingCountRemaining?: number;
    goingCountRemaining?: number;
  };
  return {
    ok: res.ok ?? false,
    rsvpId: res.rsvpId ?? rsvpId,
    approvalStatus: res.approvalStatus ?? status,
    wasRemoved: res.wasRemoved ?? false,
    pendingCountRemaining: res.pendingCountRemaining ?? 0,
    goingCountRemaining: res.goingCountRemaining ?? 0,
  };
};

export interface BulkApproveResult {
  approvedCount: number;
  skippedForCapacity: number;
}

export const bulkApproveRsvps = async (
  eventId: string,
): Promise<BulkApproveResult> => {
  const { data, error } = await supabase.rpc("host_bulk_approve_rsvps", {
    p_event_id: eventId,
  });
  if (error !== null) throw error;
  const res = (data ?? {}) as {
    approvedCount?: number;
    skippedForCapacity?: number;
  };
  return {
    approvedCount: res.approvedCount ?? 0,
    skippedForCapacity: res.skippedForCapacity ?? 0,
  };
};
