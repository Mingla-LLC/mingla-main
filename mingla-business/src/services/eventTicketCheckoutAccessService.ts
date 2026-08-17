/**
 * eventTicketCheckoutAccessService — issue #2101 [named-buyer checkout].
 *
 * The ONE service owner for the five authenticated Business RPCs plus the one
 * bounded public eligibility RPC. It imports the existing singleton
 * `services/supabase`; it creates NO client and subscribes to NO auth listener.
 *
 * SERVER IS AUTHORITATIVE. Everything here is advisory presentation state. The
 * real fence is `issue_2101_ticket_checkout_access_decision` in PostgreSQL,
 * re-decided at session creation, claim, commit, preflight and finalize. A
 * client that ignores every state below still gets 401/403 from
 * `ticket-checkout-create` with zero provider side effects.
 *
 * PRIVACY. The public read returns only a bounded state token — never a member
 * UUID, username, count, revision, epoch, or a distinction among absent,
 * private, inactive and blocked accounts.
 *
 * ERROR POSTURE. Services THROW on RPC error (Constitution #3). The stable
 * server codes (`FORBIDDEN`, `BUYER_NOT_AVAILABLE`, `STALE_ACCESS_POLICY`,
 * `IDEMPOTENCY_CONFLICT`, `ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE`,
 * `MAX_ACTIVE_BUYERS`) are surfaced verbatim so the card can map exact copy.
 */

import { supabase } from "./supabase";

/** The bounded public eligibility state. Advisory only. */
export type PublicTicketCheckoutAccessState =
  | "unrestricted"
  | "sign_in_required"
  | "allowed"
  | "restricted";

export interface PublicTicketCheckoutAccess {
  schemaVersion: 1;
  mode: "unrestricted" | "named_buyers";
  state: PublicTicketCheckoutAccessState;
}

export interface EventTicketCheckoutAccessMember {
  membershipId: string;
  addedAt: string;
  isSelf: boolean;
  /** Caller-relative label: "My account", a public name, or the neutral
   * "Approved private account". Never leaks a private profile. */
  label: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface EventTicketCheckoutAccess {
  schemaVersion: 1;
  eventId: string;
  mode: "unrestricted" | "named_buyers";
  configRevision: number;
  restrictiveEpoch: number;
  maxActiveBuyers: number;
  members: EventTicketCheckoutAccessMember[];
}

export interface EventTicketCheckoutAccessMutationResult {
  schemaVersion: 1;
  outcome: "changed" | "noop";
  eventId: string;
  mode: "unrestricted" | "named_buyers";
  configRevision: number;
  restrictiveEpoch: number;
  membershipId: string | null;
}

/** Stable server codes the Business card maps to exact remediation copy. */
export const EVENT_TICKET_CHECKOUT_ACCESS_ERRORS = [
  "FORBIDDEN",
  "BUYER_NOT_AVAILABLE",
  "STALE_ACCESS_POLICY",
  "IDEMPOTENCY_CONFLICT",
  "ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE",
  "MAX_ACTIVE_BUYERS",
  "INVALID_ACCESS_MODE",
] as const;

export type EventTicketCheckoutAccessErrorCode =
  (typeof EVENT_TICKET_CHECKOUT_ACCESS_ERRORS)[number];

/**
 * PostgREST errors are PLAIN OBJECTS, not Error instances, and the stable code
 * arrives inside `message`. Extract it without pattern-matching on a class.
 */
export const eventTicketCheckoutAccessErrorCode = (
  error: unknown,
): EventTicketCheckoutAccessErrorCode | null => {
  const message =
    typeof error === "string"
      ? error
      : typeof (error as { message?: unknown })?.message === "string"
        ? ((error as { message: string }).message)
        : "";
  for (const code of EVENT_TICKET_CHECKOUT_ACCESS_ERRORS) {
    if (message.includes(code)) return code;
  }
  return null;
};

const throwRpc = (error: { message?: string } | null): void => {
  if (error !== null && error !== undefined) {
    throw new Error(error.message ?? "event_ticket_checkout_access_failed");
  }
};

/**
 * The bounded public eligibility read. Anon-tolerant: the buyer routes never
 * gate on auth. A `null` payload (event not publicly reachable) is normalised
 * to `unrestricted` so an unreachable event never becomes a phantom fence on
 * the client — the server still decides.
 */
export const fetchPublicTicketCheckoutAccess = async (
  eventId: string,
): Promise<PublicTicketCheckoutAccess> => {
  const { data, error } = await supabase.rpc(
    "pg_public_ticket_checkout_access_state",
    { p_event_id: eventId },
  );
  throwRpc(error);
  if (data === null || data === undefined) {
    // WHY THIS IS NOT A FAIL-OPEN. `pg_public_ticket_checkout_access_state`
    // returns NULL for exactly one reason: the event is deleted, or its
    // visibility is neither 'public' nor 'hidden'. No purchasable page can
    // reach that state — an unreachable event has no checkout entry to enable.
    // An RPC that FAILS throws above and the adapter reports `error`, which is
    // fail-closed. This branch only stops an unreachable event from rendering a
    // phantom restriction, and the server decides regardless.
    return { schemaVersion: 1, mode: "unrestricted", state: "unrestricted" };
  }
  return data as PublicTicketCheckoutAccess;
};

export const fetchEventTicketCheckoutAccess = async (
  eventId: string,
): Promise<EventTicketCheckoutAccess> => {
  const { data, error } = await supabase.rpc(
    "biz_event_ticket_checkout_access_get",
    { p_event_id: eventId },
  );
  throwRpc(error);
  return data as EventTicketCheckoutAccess;
};

export const addSelfToEventTicketCheckoutAccess = async (input: {
  eventId: string;
  expectedConfigRevision: number;
  requestId: string;
}): Promise<EventTicketCheckoutAccessMutationResult> => {
  const { data, error } = await supabase.rpc(
    "biz_event_ticket_checkout_access_add_self",
    {
      p_event_id: input.eventId,
      p_expected_config_revision: input.expectedConfigRevision,
      p_request_id: input.requestId,
    },
  );
  throwRpc(error);
  return data as EventTicketCheckoutAccessMutationResult;
};

export const addUsernameToEventTicketCheckoutAccess = async (input: {
  eventId: string;
  username: string;
  expectedConfigRevision: number;
  requestId: string;
}): Promise<EventTicketCheckoutAccessMutationResult> => {
  const { data, error } = await supabase.rpc(
    "biz_event_ticket_checkout_access_add_username",
    {
      p_event_id: input.eventId,
      p_username: input.username,
      p_expected_config_revision: input.expectedConfigRevision,
      p_request_id: input.requestId,
    },
  );
  throwRpc(error);
  return data as EventTicketCheckoutAccessMutationResult;
};

export const removeEventTicketCheckoutAccessMember = async (input: {
  eventId: string;
  membershipId: string;
  expectedConfigRevision: number;
  requestId: string;
}): Promise<EventTicketCheckoutAccessMutationResult> => {
  const { data, error } = await supabase.rpc(
    "biz_event_ticket_checkout_access_remove",
    {
      p_event_id: input.eventId,
      p_membership_id: input.membershipId,
      p_expected_config_revision: input.expectedConfigRevision,
      p_request_id: input.requestId,
    },
  );
  throwRpc(error);
  return data as EventTicketCheckoutAccessMutationResult;
};

export const setEventTicketCheckoutAccessMode = async (input: {
  eventId: string;
  mode: "unrestricted" | "named_buyers";
  expectedConfigRevision: number;
  requestId: string;
}): Promise<EventTicketCheckoutAccessMutationResult> => {
  const { data, error } = await supabase.rpc(
    "biz_event_ticket_checkout_access_set_mode",
    {
      p_event_id: input.eventId,
      p_mode: input.mode,
      p_expected_config_revision: input.expectedConfigRevision,
      p_request_id: input.requestId,
    },
  );
  throwRpc(error);
  return data as EventTicketCheckoutAccessMutationResult;
};
