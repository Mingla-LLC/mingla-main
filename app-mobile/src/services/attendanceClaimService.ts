import { secureDeleteItem, secureGetItem, secureSetItem } from "../lib/secureStoreSafe";
import { supabase } from "./supabase";
import {
  parseAttendanceClaimUrl as parseClaimUrl,
  type AttendanceClaimCredential,
} from "../utils/attendanceClaimDeepLink";

export { isAttendanceClaimUrl } from "../utils/attendanceClaimDeepLink";

export type AttendanceClaimIntent = {
  version: 1;
  kind: "order" | "rsvp";
  eventId: string;
  sourceId: string;
  /** #3524 — replaces the bare `token` field, so a call site cannot send a
   * handoff code where the server expects an emailed token. */
  credential: AttendanceClaimCredential;
  savedAt: number;
};

export class AttendanceClaimError extends Error {
  /**
   * #3524 adds two codes, and BOTH ARE NON-TERMINAL FOR THE TICKET:
   *
   *   claim_identity_mismatch — this account has not proved it owns the purchase
   *     contact. `contactMasked` is a hint the SERVER masked; this client never
   *     holds an unmasked purchase contact to leak.
   *   claim_expired — the emailed link aged out at 30 days. The identity rail
   *     still picks the order up on the next sign-in, which is what the copy says.
   *
   * Neither consumes the token, so the pending intent is deliberately NOT cleared
   * on either.
   */
  readonly contactMasked: string | null;
  readonly contactChannel: "email" | "phone" | null;
  constructor(
    readonly code:
      | "claim_invalid"
      | "claim_ineligible"
      | "claim_rate_limited"
      | "claim_identity_mismatch"
      | "claim_contact_unproved"
      | "claim_expired"
      | "network",
    detail?: {
      contactMasked?: string | null;
      contactChannel?: "email" | "phone" | null;
    },
  ) {
    super(code);
    this.contactMasked = detail?.contactMasked ?? null;
    this.contactChannel = detail?.contactChannel ?? null;
  }
}

const KEY = "mingla_attendance_claim_v1";
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * #3524 — the DELIBERATE-ACCOUNT-HANDOFF marker.
 *
 * Written by exactly one action: the guest tapping "Use a different account" on
 * the claim sheet, immediately before sign-out. Its only job is to tell
 * `attendanceClaimAuthAction` that THIS FLOW caused the account change, so the
 * pending claim is preserved across the sign-out instead of cleared.
 *
 * 30 minutes. Long enough to read an email and type a six-digit code, short
 * enough that it cannot sit around waiting to be abused — and abuse buys nothing
 * anyway, because the server still requires the new account to prove it owns the
 * purchase contact.
 *
 * NOTHING ELSE WRITES THIS KEY.
 */
const HANDOFF_KEY = "mingla_attendance_claim_handoff_v1";
/**
 * #3524 — EXPORTED so the shell's in-memory flag ages out on the SAME 30
 * minutes this record does. Two copies of the number would be two things to
 * keep in step, and the one that drifted would be the one nobody tested.
 */
export const ATTENDANCE_CLAIM_HANDOFF_TTL_MS = 30 * 60 * 1000;
const HANDOFF_TTL_MS = ATTENDANCE_CLAIM_HANDOFF_TTL_MS;

export type AttendanceClaimHandoffMarker = {
  version: 1;
  startedAt: number;
  maskedContact: string | null;
};

export const saveAttendanceClaimHandoffMarker = (
  maskedContact: string | null,
): Promise<void> =>
  secureSetItem(
    HANDOFF_KEY,
    JSON.stringify(
      { version: 1, startedAt: Date.now(), maskedContact } satisfies
        AttendanceClaimHandoffMarker,
    ),
  );

export const clearAttendanceClaimHandoffMarker = (): Promise<void> =>
  secureDeleteItem(HANDOFF_KEY);

export const readAttendanceClaimHandoffMarker = async (): Promise<
  AttendanceClaimHandoffMarker | null
> => {
  const raw = await secureGetItem(HANDOFF_KEY);
  if (!raw) return null;
  try {
    const marker = JSON.parse(raw) as AttendanceClaimHandoffMarker;
    if (
      marker.version === 1 && typeof marker.startedAt === "number" &&
      Date.now() - marker.startedAt <= HANDOFF_TTL_MS
    ) return marker;
  } catch {
    // Generic terminal cleanup; nothing from this record is ever logged.
  }
  // A stale or unreadable marker is DELETED on read, so it cannot preserve a
  // claim across an unrelated account switch later.
  await clearAttendanceClaimHandoffMarker();
  return null;
};
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
    const stored = JSON.parse(raw) as Partial<AttendanceClaimIntent> & {
      /** The pre-#3524 shape. MIGRATED, never dropped: a guest mid-claim when the
       * OTA lands must not silently lose their pending ticket. */
      token?: unknown;
    };
    const credential: AttendanceClaimCredential | null =
      stored.credential !== undefined && stored.credential !== null
        ? stored.credential
        : typeof stored.token === "string"
        ? { kind: "token", value: stored.token }
        : null;
    if (
      credential !== null && typeof stored.savedAt === "number" &&
      (stored.kind === "order" || stored.kind === "rsvp") &&
      typeof stored.eventId === "string" && typeof stored.sourceId === "string" &&
      Date.now() - stored.savedAt <= TTL_MS
    ) {
      return {
        version: 1,
        kind: stored.kind,
        eventId: stored.eventId,
        sourceId: stored.sourceId,
        credential,
        savedAt: stored.savedAt,
      };
    }
  } catch {
    // Generic terminal cleanup; the bearer is never logged.
  }
  await clearAttendanceClaimIntent();
  return null;
};

const CLAIM_ERROR_CODES = [
  "claim_invalid",
  "claim_ineligible",
  "claim_rate_limited",
  "claim_identity_mismatch",
  // #3524 — the rightful buyer whose inbox is not yet proved. Carries the same
  // server-masked hint as the mismatch and, like it, consumes nothing.
  "claim_contact_unproved",
  "claim_expired",
] as const;

export const claimAttendance = async (intent: AttendanceClaimIntent): Promise<{
  status: "claimed" | "already_claimed";
  eventId: string;
  /** #3524 — whether the guest actually joined the event chat. An `experience`
   * legitimately has none, so this can be false on a completely successful claim
   * and the UI must say so rather than promise a chat. */
  chatJoined: boolean;
  conversationId: string | null;
}> => {
  const { data, error } = await supabase.functions.invoke("claim-attendance", {
    body: {
      version: 1,
      kind: intent.kind,
      eventId: intent.eventId,
      sourceId: intent.sourceId,
      // Exactly one credential key reaches the server, chosen by the discriminant.
      ...(intent.credential.kind === "handoff"
        ? { handoffCode: intent.credential.value }
        : { token: intent.credential.value }),
    },
  });
  if (error) {
    try {
      const response = (error as { context?: Response }).context;
      const body = response
        ? await response.clone().json() as {
          error?: string;
          contactMasked?: string | null;
          contactChannel?: "email" | "phone" | null;
        }
        : null;
      const code = CLAIM_ERROR_CODES.find((known) => known === body?.error);
      if (code !== undefined) {
        throw new AttendanceClaimError(code, {
          contactMasked: body?.contactMasked ?? null,
          contactChannel: body?.contactChannel ?? null,
        });
      }
    } catch (parsed) {
      if (parsed instanceof AttendanceClaimError) throw parsed;
    }
    throw new AttendanceClaimError("network");
  }
  const payload = (data ?? {}) as {
    status?: "claimed" | "already_claimed";
    eventId?: string;
    chatJoined?: unknown;
    conversationId?: unknown;
  };
  return {
    status: payload.status ?? "claimed",
    eventId: payload.eventId ?? intent.eventId,
    chatJoined: payload.chatJoined === true,
    conversationId: typeof payload.conversationId === "string"
      ? payload.conversationId
      : null,
  };
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
export type VerifiedIdentityClaim = {
  orderId: string | null;
  eventId: string;
  chatJoined: boolean;
  conversationId: string | null;
};

export const claimAttendanceByVerifiedIdentity = async (): Promise<{
  count: number;
  eventIds: string[];
  /** #3524 — observability parity with the token rail. Nothing renders this yet;
   * it exists so the silent sweep is no longer silent about the chat half. */
  claims: VerifiedIdentityClaim[];
}> => {
  const { data, error } = await supabase.functions.invoke(
    "attendance-claim-identity",
    { body: {} },
  );
  if (error) return { count: 0, eventIds: [], claims: [] };
  const payload = data as
    | { count?: unknown; eventIds?: unknown; claims?: unknown }
    | null;
  const eventIds = Array.isArray(payload?.eventIds)
    ? payload.eventIds.filter((id): id is string => typeof id === "string")
    : [];
  const claims: VerifiedIdentityClaim[] = Array.isArray(payload?.claims)
    ? payload.claims.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const row = entry as Record<string, unknown>;
      if (typeof row.eventId !== "string") return [];
      return [{
        orderId: typeof row.orderId === "string" ? row.orderId : null,
        eventId: row.eventId,
        chatJoined: row.chatJoined === true,
        conversationId: typeof row.conversationId === "string"
          ? row.conversationId
          : null,
      }];
    })
    : [];
  return { count: eventIds.length, eventIds, claims };
};
