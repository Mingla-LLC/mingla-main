import { supabase } from "./supabase";
import { RsvpRpcError } from "./rsvpRpcFailure";

export type RsvpScanResult = "success" | "duplicate" | "not_found" |
  "wrong_event" | "not_eligible" | "revoked" | "not_yet_open" | "event_ended";
export interface RsvpDoorAnswers {
  state: "answered" | "not_answered" | "unavailable";
  header: string | null;
  lines: string[];
  fullAnswers: boolean;
}
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
  /** #4541 — optional, server-built and never changes the admission result. */
  doorAnswers?: RsvpDoorAnswers | null;
}
/** #4541 — a malformed door-answers payload becomes `null`; it never breaks an admitted result. */
export function parseDoorAnswers(value: unknown): RsvpDoorAnswers | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const state = row.state;
  if (state !== "answered" && state !== "not_answered" && state !== "unavailable") return null;
  if (!Array.isArray(row.lines) || !row.lines.every((line) => typeof line === "string")) return null;
  if (row.header !== null && row.header !== undefined && typeof row.header !== "string") return null;
  if (typeof row.fullAnswers !== "boolean") return null;
  return {
    state,
    header: typeof row.header === "string" ? row.header : null,
    lines: row.lines as string[],
    fullAnswers: row.fullAnswers,
  };
}

function withSafeDoorAnswers(data: unknown): RsvpScanResponse {
  const body = (data ?? {}) as RsvpScanResponse;
  if (body.doorAnswers === undefined) return body;
  return { ...body, doorAnswers: parseDoorAnswers(body.doorAnswers) };
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
  return withSafeDoorAnswers(data);
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
  return withSafeDoorAnswers(data);
}
