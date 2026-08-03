import { supabase } from "./supabase";

export type RsvpScanResult = "success" | "duplicate" | "not_found" |
  "wrong_event" | "not_eligible" | "revoked" | "not_yet_open" | "event_ended";
export interface RsvpScanResponse {
  result: RsvpScanResult;
  scanId: string | null;
  entityId: string | null;
  attendeeDisplayName: string | null;
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
