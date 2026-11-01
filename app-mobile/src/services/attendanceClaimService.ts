import { secureDeleteItem, secureGetItem, secureSetItem } from "../lib/secureStoreSafe";
import {
  reactivateExplorerForVerifiedSession,
  supabase,
} from "./supabase";
import {
  parseAttendanceClaimUrl as parseClaimUrl,
  type AttendanceClaimCredential,
} from "../utils/attendanceClaimDeepLink";
import { withExplorerReactivationIntent } from "../utils/explorerReactivation";

export { isAttendanceClaimUrl } from "../utils/attendanceClaimDeepLink";

export type ClaimNoun = "ticket" | "pass" | "booking" | "receipt";
export type ClaimPreferredProof = "email" | "phone" | "any";

export type PendingClaim = {
  code: string;
  noun: ClaimNoun;
  title: string;
  orderLabel: string | null;
  startsAt: string | null;
  timezone: string;
  emailMasked: string | null;
  phoneLast4: string | null;
  preferredProof: ClaimPreferredProof;
  expired: boolean;
};

export type ClaimedEntry = {
  kind:
    | "order"
    | "rsvp"
    | "rsvp_guest"
    | "reservation"
    | "stay_group"
    | "venue_order"
    | "ticket";
  id: string;
  routeKind:
    | "order"
    | "rsvp"
    | "reservation"
    | "stay"
    | "venue_order"
    | "held_ticket";
  routeId: string;
  offeringType:
    | "event"
    | "trip"
    | "experience"
    | "rsvp"
    | "venue"
    | "stay"
    | "food";
  noun: ClaimNoun;
  title: string;
  orderLabel: string | null;
  startsAt: string | null;
  timezone: string;
  venueLine: string | null;
  quantity: number;
  source: "purchase" | "comp" | "door" | "food" | "transfer" | "rsvp" | "booking";
  sentByFirstName: string | null;
  chatJoined: boolean | null;
  conversationId: string | null;
};

const CLAIM_KINDS = new Set<ClaimedEntry["kind"]>([
  "order",
  "rsvp",
  "rsvp_guest",
  "reservation",
  "stay_group",
  "venue_order",
  "ticket",
]);
const CLAIM_ROUTE_KINDS = new Set<ClaimedEntry["routeKind"]>([
  "order",
  "rsvp",
  "reservation",
  "stay",
  "venue_order",
  "held_ticket",
]);
const CLAIM_OFFERING_TYPES = new Set<ClaimedEntry["offeringType"]>([
  "event",
  "trip",
  "experience",
  "rsvp",
  "venue",
  "stay",
  "food",
]);
const CLAIM_SOURCES = new Set<ClaimedEntry["source"]>([
  "purchase",
  "comp",
  "door",
  "food",
  "transfer",
  "rsvp",
  "booking",
]);

function isClaimedEntryEnum<T extends string>(
  values: ReadonlySet<T>,
  value: unknown,
): value is T {
  return typeof value === "string" && values.has(value as T);
}

export function parseClaimedEntries(value: unknown): ClaimedEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const noun = claimNoun(row.noun);
    if (
      noun === null || !isClaimedEntryEnum(CLAIM_KINDS, row.kind) ||
      typeof row.id !== "string" ||
      !isClaimedEntryEnum(CLAIM_ROUTE_KINDS, row.routeKind) ||
      typeof row.routeId !== "string" ||
      !isClaimedEntryEnum(CLAIM_OFFERING_TYPES, row.offeringType) ||
      typeof row.title !== "string" || typeof row.timezone !== "string" ||
      !isClaimedEntryEnum(CLAIM_SOURCES, row.source)
    ) return [];
    return [{
      kind: row.kind,
      id: row.id,
      routeKind: row.routeKind,
      routeId: row.routeId,
      offeringType: row.offeringType,
      noun,
      title: row.title,
      orderLabel: typeof row.orderLabel === "string" ? row.orderLabel : null,
      startsAt: typeof row.startsAt === "string" ? row.startsAt : null,
      timezone: row.timezone,
      venueLine: typeof row.venueLine === "string" ? row.venueLine : null,
      quantity: typeof row.quantity === "number" ? row.quantity : 1,
      source: row.source,
      sentByFirstName: typeof row.sentByFirstName === "string"
        ? row.sentByFirstName
        : null,
      chatJoined: typeof row.chatJoined === "boolean" ? row.chatJoined : null,
      conversationId: typeof row.conversationId === "string"
        ? row.conversationId
        : null,
    }];
  });
}

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
const CLAIM_LINK_KEY = "mingla.claimLink.pending.v1";
const CLAIM_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_LINK_CODE = /^[0-9A-Za-z]{10}$/;

type StoredClaimLink = { code: string; savedAt: number };

function claimNoun(value: unknown): ClaimNoun | null {
  return value === "ticket" || value === "pass" || value === "booking" ||
      value === "receipt"
    ? value
    : null;
}

function preferredProof(value: unknown): ClaimPreferredProof {
  return value === "email" || value === "phone" ? value : "any";
}

function claimLinkCodeFromPath(path: string): string | null {
  const match = path.match(/(?:^|\/)c\/([0-9A-Za-z]{10})(?:[/?#]|$)/);
  return match?.[1]?.toUpperCase() ?? null;
}

/** Parse a direct /c link or the equivalent AppsFlyer deferred payload. */
export function pendingClaimCodeFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const direct = claimLinkCodeFromPath(
      parsed.protocol === "com.mingla.app.v2:" && parsed.host
        ? `/${parsed.host}${parsed.pathname}`
        : parsed.pathname,
    );
    if (direct) return direct;
    if (
      parsed.searchParams.get("deep_link_value") === "claim" &&
      CLAIM_LINK_CODE.test(parsed.searchParams.get("deep_link_sub1") ?? "")
    ) {
      return String(parsed.searchParams.get("deep_link_sub1")).toUpperCase();
    }
  } catch {
    const relative = claimLinkCodeFromPath(url);
    if (relative) return relative;
  }
  return null;
}

export async function savePendingClaimCode(code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  if (!CLAIM_LINK_CODE.test(normalized)) return;
  await secureSetItem(
    CLAIM_LINK_KEY,
    JSON.stringify({ code: normalized, savedAt: Date.now() } satisfies StoredClaimLink),
  );
}

export async function clearPendingClaimIntent(): Promise<void> {
  await secureDeleteItem(CLAIM_LINK_KEY);
}

export type ClaimLinkResolution =
  | { status: "claim"; claim: PendingClaim }
  | { status: "redirect"; url: string }
  | { status: "unavailable" };

export type PendingClaimEmailError =
  | "invalid"
  | "no_email"
  | "rate_limited"
  | "bad_code"
  | "expired"
  | "locked"
  | "auth_unavailable"
  | "send_failed"
  | "unavailable";

export type PendingClaimEmailResult =
  | { ok: true; challengeId: string; sentTo: string }
  | { ok: false; error: PendingClaimEmailError; message: string };

export type PendingClaimEmailVerification =
  | { ok: true }
  | { ok: false; error: PendingClaimEmailError; message: string };

export type PendingClaimPrefill = {
  firstName: string | null;
  lastName: string | null;
  phoneE164: string | null;
};

const PENDING_CLAIM_EMAIL_ERRORS = new Set<PendingClaimEmailError>([
  "invalid",
  "no_email",
  "rate_limited",
  "bad_code",
  "expired",
  "locked",
  "auth_unavailable",
  "send_failed",
  "unavailable",
]);

function pendingClaimEmailError(value: unknown): PendingClaimEmailError {
  return typeof value === "string" &&
      PENDING_CLAIM_EMAIL_ERRORS.has(value as PendingClaimEmailError)
    ? value as PendingClaimEmailError
    : "unavailable";
}

function pendingClaimEmailMessage(
  code: PendingClaimEmailError,
  phase: "send" | "verify",
): string {
  if (code === "rate_limited" || code === "locked") {
    return "Too many tries. Wait a few minutes, or use another sign-in option.";
  }
  if (code === "expired") return "That code expired. Send a new code and try again.";
  if (code === "bad_code") return "That code didn't match. Check it and try again.";
  if (code === "no_email") return "Use another sign-in option for this purchase.";
  return phase === "send"
    ? "We couldn\u2019t send the code. Try again."
    : "We couldn\u2019t verify that code. Try again.";
}

/** The masked-address sign-in rail accepts only the opaque claim code. */
export function pendingClaimEmailSendBody(code: string): {
  op: "email_code_send";
  code: string;
} {
  return { op: "email_code_send", code: code.trim().toUpperCase() };
}

export function pendingClaimEmailVerifyBody(
  challengeId: string,
  otp: string,
): { op: "email_code_verify"; challengeId: string; otp: string } {
  return { op: "email_code_verify", challengeId, otp };
}

async function claimLinkErrorPayload(error: unknown): Promise<Record<string, unknown>> {
  const response = (error as { context?: Response } | null)?.context;
  if (!response || typeof response.clone !== "function") return {};
  try {
    const payload = await response.clone().json();
    return typeof payload === "object" && payload !== null
      ? payload as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function sendPendingClaimEmailCode(
  code: string,
): Promise<PendingClaimEmailResult> {
  const { data, error } = await supabase.functions.invoke("claim-link", {
    body: pendingClaimEmailSendBody(code),
  });
  const payload = error
    ? await claimLinkErrorPayload(error)
    : typeof data === "object" && data !== null
    ? data as Record<string, unknown>
    : {};
  if (
    !error && payload.ok === true && typeof payload.challengeId === "string" &&
    typeof payload.sentTo === "string"
  ) {
    return {
      ok: true,
      challengeId: payload.challengeId,
      sentTo: payload.sentTo,
    };
  }
  const errorCode = pendingClaimEmailError(payload.error);
  return {
    ok: false,
    error: errorCode,
    message: pendingClaimEmailMessage(errorCode, "send"),
  };
}

export async function verifyPendingClaimEmailCode(input: {
  challengeId: string;
  otp: string;
}): Promise<PendingClaimEmailVerification> {
  const { data, error } = await supabase.functions.invoke("claim-link", {
    body: pendingClaimEmailVerifyBody(input.challengeId, input.otp),
  });
  const payload = error
    ? await claimLinkErrorPayload(error)
    : typeof data === "object" && data !== null
    ? data as Record<string, unknown>
    : {};
  if (!error && payload.ok === true && typeof payload.tokenHash === "string") {
    const tokenHash = payload.tokenHash;
    const { auth, reactivation } = await withExplorerReactivationIntent(async () => {
      const auth = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });
      const session = auth.data.session;
      const reactivation = !auth.error && session
        ? await reactivateExplorerForVerifiedSession({
          accessToken: session.access_token,
          userId: session.user.id,
        })
        : null;
      return { auth, reactivation };
    });
    if (
      !auth.error && reactivation &&
      reactivation.kind !== "reactivation_failed"
    ) return { ok: true };
    return {
      ok: false,
      error: "auth_unavailable",
      message: pendingClaimEmailMessage("auth_unavailable", "verify"),
    };
  }
  const errorCode = pendingClaimEmailError(payload.error);
  return {
    ok: false,
    error: errorCode,
    message: pendingClaimEmailMessage(errorCode, "verify"),
  };
}

/**
 * Reads prefill only through the authenticated, proof-gated claim endpoint.
 * Link possession alone never reveals or supplies the purchase contact.
 */
export async function fetchPendingClaimPrefill(
  code: string,
): Promise<PendingClaimPrefill | null> {
  const { data, error } = await supabase.functions.invoke("claim-link", {
    body: { op: "prefill", code: code.trim().toUpperCase() },
  });
  if (error || typeof data !== "object" || data === null) return null;
  const payload = data as Record<string, unknown>;
  if (payload.ok !== true || payload.reason === "not_proven") return null;
  return {
    firstName: typeof payload.firstName === "string" ? payload.firstName : null,
    lastName: typeof payload.lastName === "string" ? payload.lastName : null,
    phoneE164: typeof payload.phoneE164 === "string" ? payload.phoneE164 : null,
  };
}

export async function resolvePendingClaimCode(
  code: string,
): Promise<ClaimLinkResolution> {
  const response = await supabase.functions.invoke("claim-link", {
    body: { op: "resolve", code },
  });
  if (response.error) return { status: "unavailable" };
  const payload = response.data as Record<string, unknown> | null;
  if (
    payload?.ok === true && payload.status === "redirect" &&
    typeof payload.url === "string" && /^https:\/\//i.test(payload.url)
  ) {
    return { status: "redirect", url: payload.url };
  }
  const noun = claimNoun(payload?.noun);
  if (
    payload?.ok !== true || noun === null ||
    (payload.status !== "active" && payload.status !== "expired") ||
    typeof payload.title !== "string"
  ) return { status: "unavailable" };
  return {
    status: "claim",
    claim: {
      code,
      noun,
      title: payload.title,
      orderLabel: typeof payload.orderLabel === "string" ? payload.orderLabel : null,
      startsAt: typeof payload.startsAt === "string" ? payload.startsAt : null,
      timezone: typeof payload.timezone === "string" ? payload.timezone : "UTC",
      emailMasked: typeof payload.emailMasked === "string" ? payload.emailMasked : null,
      phoneLast4: typeof payload.phoneLast4 === "string" ? payload.phoneLast4 : null,
      preferredProof: preferredProof(payload.preferredProof),
      expired: payload.status === "expired",
    },
  };
}

export async function getPendingClaimIntent(): Promise<PendingClaim | null> {
  const raw = await secureGetItem(CLAIM_LINK_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Partial<StoredClaimLink>;
    if (
      typeof stored.code === "string" && CLAIM_LINK_CODE.test(stored.code) &&
      typeof stored.savedAt === "number" &&
      Date.now() - stored.savedAt <= CLAIM_LINK_TTL_MS
    ) {
      const resolution = await resolvePendingClaimCode(stored.code.toUpperCase());
      if (resolution.status === "claim") return resolution.claim;
      if (resolution.status === "unavailable") return null;
    }
  } catch {
    // Corrupt/expired pointers are removed below. No claim detail is logged.
  }
  await clearPendingClaimIntent();
  return null;
}

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
  claimed: ClaimedEntry[];
  more: boolean;
  rateLimited: boolean;
}> => {
  const { data, error } = await supabase.functions.invoke(
    "attendance-claim-identity",
    { body: {} },
  );
  if (error) {
    const contextStatus = (error.context as Response | undefined)?.status;
    return {
      count: 0,
      eventIds: [],
      claims: [],
      claimed: [],
      more: false,
      rateLimited: contextStatus === 429 || /rate.?limit/i.test(error.message),
    };
  }
  const payload = data as
    | { count?: unknown; eventIds?: unknown; claims?: unknown; claimed?: unknown; more?: unknown }
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
  const claimed = parseClaimedEntries(payload?.claimed);
  return {
    count: typeof payload?.count === "number" ? payload.count : claimed.length,
    eventIds,
    claims,
    claimed,
    more: payload?.more === true,
    rateLimited: false,
  };
};
