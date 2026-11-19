import { supabase } from "./supabase";
import { RsvpRpcError } from "./rsvpRpcFailure";

export type RsvpScanResult = "success" | "duplicate" | "not_found" |
  "wrong_event" | "not_eligible" | "revoked" | "not_yet_open" | "event_ended";
export interface RsvpScanResponse {
  result: RsvpScanResult;
  scanId: string | null;
  entityId: string | null;
  attendeeDisplayName: string | null;
  // #4508 1.25 — who brought a guest-pass holder; absent for primary guests.
  invitedByName?: string | null;
  // #4508 N-5 — a guest pass: whether it is claimed, and (only while it is
  // not) the last four digits of the number it was sent to.
  claimed?: boolean | null;
  phoneLast4?: string | null;
  entityType: "primary" | "guest" | null;
  nextStartAt: string | null;
  lastEndAt: string | null;
  checkedInAt: string | null;
}
export class ScanRsvpError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ScanRsvpError"; }
}
export async function scanRsvp(eventId: string, qrPayload: string): Promise<RsvpScanResponse> {
  const { data, error } = await supabase.functions.invoke("scan-rsvp", {
    body: { eventId, payload: qrPayload },
  });
  if (error) {
    let code = error.message || "scan_failed";
    const body = (error as { context?: { body?: unknown } }).context?.body;
    try {
      const parsed = typeof body === "string" ? JSON.parse(body) : body;
      if (parsed && typeof (parsed as { error?: unknown }).error === "string") {
        code = (parsed as { error: string }).error;
      }
    } catch { /* keep safe code */ }
    throw new ScanRsvpError(code);
  }
  return data as RsvpScanResponse;
}

export async function fetchRsvpCheckinSummary(eventId: string): Promise<{
  going: number; capacity: number | null; checkedIn: number;
}> {
  const { data, error } = await supabase.rpc("rsvp_event_checkin_summary", { p_event_id: eventId });
  if (error) throw error;
  const value = (data ?? {}) as { going?: number; capacity?: number | null; checkedIn?: number };
  return { going: value.going ?? 0, capacity: value.capacity ?? null, checkedIn: value.checkedIn ?? 0 };
}

/**
 * #4508 C7 - a host admits one plus-one by hand. Same people, rules and answer
 * shape as a door scan. A refusal (not approved, not open yet, ended ...) comes
 * back as a normal answer in `result`; a thrown RsvpRpcError means the call
 * itself failed (for example `scanner_not_authorized`).
 */
export async function checkInRsvpGuestByHand(guestId: string): Promise<RsvpScanResponse> {
  const { data, error } = await supabase.rpc("host_check_in_rsvp_guest", {
    p_guest_id: guestId,
  });
  if (error !== null) throw new RsvpRpcError(error, "rsvp_guest_check_in_failed");
  return (data ?? {}) as RsvpScanResponse;
}
