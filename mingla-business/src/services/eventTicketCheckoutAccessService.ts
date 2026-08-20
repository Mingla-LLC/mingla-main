import { supabase } from "./supabase";

export type TicketCheckoutAccessMode = "unrestricted" | "named_buyers";
export type TicketCheckoutEligibilityState =
  | "unrestricted"
  | "sign_in_required"
  | "allowed"
  | "restricted";

export interface TicketCheckoutAccessMember {
  membershipId: string;
  label: string;
  isSelf: boolean;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface EventTicketCheckoutAccess {
  schemaVersion: 1;
  eventId: string;
  mode: TicketCheckoutAccessMode;
  configRevision: number;
  restrictiveEpoch: number;
  maxActiveBuyers: 20;
  members: TicketCheckoutAccessMember[];
}

export interface TicketCheckoutEligibility {
  schemaVersion: 1;
  mode: TicketCheckoutAccessMode;
  state: TicketCheckoutEligibilityState;
}

export interface TicketCheckoutAccessMutationResult {
  schemaVersion: 1;
  outcome: "changed" | "noop";
  eventId: string;
  mode: TicketCheckoutAccessMode;
  configRevision: number;
  restrictiveEpoch: number;
  membershipId?: string;
}

const rpcOrThrow = async <T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> => {
  const { data, error } = await supabase.rpc(name, args);
  if (error !== null) throw new Error(error.message);
  if (data === null) throw new Error("ticket_checkout_access_response_missing");
  return data as T;
};

export const getEventTicketCheckoutAccess = (
  eventId: string,
): Promise<EventTicketCheckoutAccess> =>
  rpcOrThrow<EventTicketCheckoutAccess>("biz_event_ticket_checkout_access_get", {
    p_event_id: eventId,
  });

export const addSelfToEventTicketCheckoutAccess = (
  eventId: string,
  expectedConfigRevision: number,
  requestId: string,
): Promise<TicketCheckoutAccessMutationResult> =>
  rpcOrThrow<TicketCheckoutAccessMutationResult>(
    "biz_event_ticket_checkout_access_add_self",
    {
      p_event_id: eventId,
      p_expected_config_revision: expectedConfigRevision,
      p_request_id: requestId,
    },
  );

export const addUsernameToEventTicketCheckoutAccess = (
  eventId: string,
  username: string,
  expectedConfigRevision: number,
  requestId: string,
): Promise<TicketCheckoutAccessMutationResult> =>
  rpcOrThrow<TicketCheckoutAccessMutationResult>(
    "biz_event_ticket_checkout_access_add_username",
    {
      p_event_id: eventId,
      p_username: username.trim().toLowerCase(),
      p_expected_config_revision: expectedConfigRevision,
      p_request_id: requestId,
    },
  );

export const removeEventTicketCheckoutAccessMember = (
  eventId: string,
  membershipId: string,
  expectedConfigRevision: number,
  requestId: string,
): Promise<TicketCheckoutAccessMutationResult> =>
  rpcOrThrow<TicketCheckoutAccessMutationResult>(
    "biz_event_ticket_checkout_access_remove",
    {
      p_event_id: eventId,
      p_membership_id: membershipId,
      p_expected_config_revision: expectedConfigRevision,
      p_request_id: requestId,
    },
  );

export const setEventTicketCheckoutAccessMode = (
  eventId: string,
  mode: TicketCheckoutAccessMode,
  expectedConfigRevision: number,
  requestId: string,
): Promise<TicketCheckoutAccessMutationResult> =>
  rpcOrThrow<TicketCheckoutAccessMutationResult>(
    "biz_event_ticket_checkout_access_set_mode",
    {
      p_event_id: eventId,
      p_mode: mode,
      p_expected_config_revision: expectedConfigRevision,
      p_request_id: requestId,
    },
  );

export const getPublicTicketCheckoutEligibility = async (
  eventId: string,
): Promise<TicketCheckoutEligibility | null> => {
  const { data, error } = await supabase.rpc(
    "pg_public_ticket_checkout_access_state",
    { p_event_id: eventId },
  );
  if (error !== null) throw new Error(error.message);
  return data === null ? null : (data as TicketCheckoutEligibility);
};

export const newTicketCheckoutAccessRequestId = (): string => {
  const cryptoWithUuid = globalThis.crypto as Crypto & {
    randomUUID?: () => string;
  };
  if (typeof cryptoWithUuid.randomUUID !== "function") {
    throw new Error("secure_request_id_unavailable");
  }
  return cryptoWithUuid.randomUUID();
};
