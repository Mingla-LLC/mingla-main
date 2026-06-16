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

export type RsvpStatusValue = "going" | "not_going" | "waitlisted";
export type RsvpApprovalValue = "pending" | "approved" | "denied";

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
