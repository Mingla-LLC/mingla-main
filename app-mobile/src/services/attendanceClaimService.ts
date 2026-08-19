import { secureDeleteItem, secureGetItem, secureSetItem } from "../lib/secureStoreSafe";
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
  secureSetItem(KEY, JSON.stringify(intent));

export const clearAttendanceClaimIntent = (): Promise<void> => secureDeleteItem(KEY);

export const readAttendanceClaimIntent = async (): Promise<AttendanceClaimIntent | null> => {
  const raw = await secureGetItem(KEY);
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

/**
 * #2217 — the post-sign-in reconnect sweep.
 *
 * Sends NO identifier. `attendance-claim-identity` matches the identifiers this
 * account has itself proven (an `auth.identities` row written by GoTrue only
 * after a code was delivered, or an IdP asserted the mailbox), so there is no
 * parameter through which a guessed email could enter. See the #2217 migration.
 *
 * Fails SILENTLY by design: this runs on every sign-in, it is an enhancement to
 * an account that is already usable, and a guest who never bought anything must
 * not be shown an error for a sweep they did not ask for.
 */
export const claimAttendanceByVerifiedIdentity = async (): Promise<{
  count: number;
  eventIds: string[];
}> => {
  const { data, error } = await supabase.functions.invoke(
    "attendance-claim-identity",
    { body: {} },
  );
  if (error) return { count: 0, eventIds: [] };
  const payload = data as { count?: unknown; eventIds?: unknown } | null;
  const eventIds = Array.isArray(payload?.eventIds)
    ? payload.eventIds.filter((id): id is string => typeof id === "string")
    : [];
  return { count: eventIds.length, eventIds };
};
