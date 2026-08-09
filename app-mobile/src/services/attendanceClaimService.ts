import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";
import {
  parseAttendanceClaimUrl as parseClaimUrl,
} from "../utils/attendanceClaimDeepLink";

export { isAttendanceClaimUrl } from "../utils/attendanceClaimDeepLink";

export type AttendanceClaimIntent = {
  version: 1;
  kind: "order" | "rsvp";
  eventId: string;
  sourceId: string;
  token: string;
  savedAt: number;
};

export class AttendanceClaimError extends Error {
  constructor(readonly code: "claim_invalid" | "claim_ineligible" | "claim_rate_limited" | "network") {
    super(code);
  }
}

const KEY = "mingla_attendance_claim_v1";
const TTL_MS = 24 * 60 * 60 * 1000;
export const parseAttendanceClaimUrl = (url: string): AttendanceClaimIntent | null => {
  const parsed = parseClaimUrl(url);
  return parsed ? { ...parsed, savedAt: Date.now() } : null;
};

export const saveAttendanceClaimIntent = (intent: AttendanceClaimIntent): Promise<void> =>
  SecureStore.setItemAsync(KEY, JSON.stringify(intent));

export const clearAttendanceClaimIntent = (): Promise<void> => SecureStore.deleteItemAsync(KEY);

export const readAttendanceClaimIntent = async (): Promise<AttendanceClaimIntent | null> => {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw) as AttendanceClaimIntent;
    if (Date.now() - intent.savedAt <= TTL_MS) return intent;
  } catch {
    // Generic terminal cleanup; the bearer is never logged.
  }
  await clearAttendanceClaimIntent();
  return null;
};

export const claimAttendance = async (intent: AttendanceClaimIntent): Promise<{
  status: "claimed" | "already_claimed";
  eventId: string;
}> => {
  const { data, error } = await supabase.functions.invoke("claim-attendance", {
    body: { version: 1, kind: intent.kind, eventId: intent.eventId, sourceId: intent.sourceId, token: intent.token },
  });
  if (error) {
    try {
      const response = (error as { context?: Response }).context;
      const body = response ? await response.clone().json() as { error?: string } : null;
      if (body?.error === "claim_invalid" || body?.error === "claim_ineligible" || body?.error === "claim_rate_limited") {
        throw new AttendanceClaimError(body.error);
      }
    } catch (parsed) {
      if (parsed instanceof AttendanceClaimError) throw parsed;
    }
    throw new AttendanceClaimError("network");
  }
  return data as { status: "claimed" | "already_claimed"; eventId: string };
};

export type AttendanceRosterProbe = "authorized" | "private" | "unavailable" | "error";

export const probeAttendanceRoster = async (eventId: string): Promise<AttendanceRosterProbe> => {
  const { error } = await supabase.rpc("peer_list_event_guests", {
    p_event_id: eventId, p_limit: 1, p_offset: 0,
  });
  if (!error) return "authorized";
  if (error.message.includes("guest_list_private")) return "private";
  if (error.message.includes("event_not_available") || error.message.includes("attendance_required")) return "unavailable";
  return "error";
};

export const resolveAttendanceOfferingPath = async (eventId: string): Promise<string | null> => {
  const { data, error } = await supabase.from("business_public_events_view")
    .select("event_type,brand_slug,slug")
    .eq("id", eventId).maybeSingle();
  if (error) throw new Error("offering_lookup_failed");
  if (!data?.brand_slug || !data?.slug) return null;
  if (!["rsvp", "event", "trip", "experience"].includes(data.event_type)) return null;
  const prefix = data.event_type === "trip" ? "t" : data.event_type === "experience" ? "exp" : "e";
  return `/${prefix}/${encodeURIComponent(data.brand_slug)}/${encodeURIComponent(data.slug)}?landing=guest-list`;
};
