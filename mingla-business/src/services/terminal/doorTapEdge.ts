/**
 * #4271 — client for the Tap to Pay edge functions.
 *
 *  terminal-connection-token  {eventId | brandId, platform}   → {secret, locationId}
 *  door-tap-intent  location  {eventId | brandId, platform}   → {locationId}
 *  door-tap-intent  create    {eventId, platform, eventDateId, lines, clientRequestId, buyerPhone, phoneCountryIso, buyerName}
 *                             → {paymentIntentId, clientSecret, totalCents, currency, stripeAccountId, locationId}
 *  door-tap-intent  complete  {paymentIntentId, clientRequestId} → biz_door_tap_record result
 *  door-tap-intent  cancel    {paymentIntentId, clientRequestId} → {status:"cancelled"}
 *                             (409 payment_succeeded when the guest already paid)
 *  door-pay-code    create    {eventId, eventDateId, lines}    → {codeId, ...}
 *
 * The server prices every sale, checks the door-payment permission and only
 * records an order once Stripe says the PaymentIntent succeeded. Every call
 * throws a DoorTapError on failure (never returns a silent fallback).
 */
import { Platform } from "react-native";

import { supabase } from "../supabase";
import type { TapToPayDraftLine } from "./tapToPayDraft";

export type DoorTapErrorCode =
  | "door_access_denied"
  | "tap_not_available"
  | "payment_not_succeeded"
  | "payment_succeeded"
  | "offline_pin_required"
  | "buyer_phone_invalid"
  | "buyer_name_invalid"
  | "not_found"
  | "invalid_request"
  | "server_error"
  | "door_ticket_capacity_exceeded"
  | "ticket_not_valid_on_chosen_days"
  | "stripe_account_not_ready"
  | "door_tax_added_at_checkout"
  | "invalid_lines"
  | "network_error"
  | "invalid_response"
  | "unknown";

const KNOWN_CODES: ReadonlySet<string> = new Set<DoorTapErrorCode>([
  "door_access_denied",
  "tap_not_available",
  "payment_not_succeeded",
  "payment_succeeded",
  "offline_pin_required",
  "buyer_phone_invalid",
  "buyer_name_invalid",
  "not_found",
  "invalid_request",
  "server_error",
  "door_ticket_capacity_exceeded",
  "ticket_not_valid_on_chosen_days",
  "stripe_account_not_ready",
  "door_tax_added_at_checkout",
  "invalid_lines",
  "network_error",
  "invalid_response",
  "unknown",
]);

export class DoorTapError extends Error {
  readonly code: DoorTapErrorCode;
  readonly detail: string | null;

  constructor(code: DoorTapErrorCode, detail: string | null = null) {
    super(detail ?? code);
    this.name = "DoorTapError";
    this.code = code;
    this.detail = detail;
  }
}

export interface DoorTapIntent {
  paymentIntentId: string;
  clientSecret: string;
  totalCents: number;
  currency: string;
  stripeAccountId: string;
  locationId: string;
  /** What the guest pays in fees; null from a server that doesn't say. */
  feeCents?: number | null;
  subtotalCents?: number | null;
}

export interface DoorTapCompleteResult {
  orderId: string;
  ticketIds: string[];
  receiptQueued: boolean;
  replayed: boolean;
}

export interface DoorPayCodeCreated {
  codeId: string;
}

export interface CreateDoorTapIntentInput {
  eventId: string;
  eventDateId: string | null;
  lines: TapToPayDraftLine[];
  clientRequestId: string;
  buyerPhone: string | null;
  phoneCountryIso: string | null;
  /** What the host typed as the buyer's name; saved on the sale. Null when none. */
  buyerName: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readErrorPayload = async (error: unknown): Promise<{ code: string; detail: string | null }> => {
  const context = isRecord(error) ? (error.context as unknown) : undefined;
  if (isRecord(context) && typeof (context as { text?: unknown }).text === "function") {
    try {
      const text = await (context as unknown as Response).text();
      const payload: unknown = text.length > 0 ? JSON.parse(text) : null;
      if (isRecord(payload) && typeof payload.error === "string") {
        // The server explains a refusal in `reason` (tap_not_available:
        // address_missing), `message` (buyer_phone_invalid) or `detail`.
        const explained = [payload.reason, payload.message, payload.detail].find(
          (value): value is string => typeof value === "string" && value.length > 0,
        );
        return { code: payload.error, detail: explained ?? null };
      }
    } catch {
      // A non-JSON error body is reported as "unknown" below with the message.
    }
  }
  return {
    code: "unknown",
    detail: error instanceof Error ? error.message : null,
  };
};

const invoke = async (fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.functions.invoke(fn, { body });
  } catch (error) {
    throw new DoorTapError("network_error", error instanceof Error ? error.message : String(error));
  }
  if (response.error) {
    const { code, detail } = await readErrorPayload(response.error);
    throw new DoorTapError(
      KNOWN_CODES.has(code) ? (code as DoorTapErrorCode) : "unknown",
      detail ?? code,
    );
  }
  if (!isRecord(response.data)) {
    throw new DoorTapError("invalid_response", `${fn} returned no body`);
  }
  return response.data;
};

const requireString = (data: Record<string, unknown>, key: string): string => {
  const value = data[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DoorTapError("invalid_response", `missing ${key}`);
  }
  return value;
};

const requireInt = (data: Record<string, unknown>, key: string): number => {
  const value = data[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DoorTapError("invalid_response", `missing ${key}`);
  }
  return value;
};

const optionalInt = (data: Record<string, unknown>, key: string): number | null => {
  const value = data[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
};

/** Who the Terminal session is for: the door's event when there is one, else the brand. */
export interface TapToPayScopeIds {
  brandId: string | null;
  eventId?: string | null;
}

const scopeBody = (scope: TapToPayScopeIds): Record<string, string> => {
  if (scope.eventId !== null && scope.eventId !== undefined) return { eventId: scope.eventId };
  if (scope.brandId !== null) return { brandId: scope.brandId };
  throw new DoorTapError("invalid_request", "no event or brand");
};

/** Setup and warm-up: the brand's Terminal Location, so the reader connects before the first sale. */
export const fetchDoorTapLocation = async (scope: TapToPayScopeIds): Promise<string> => {
  const data = await invoke("door-tap-intent", { action: "location", ...scopeBody(scope), platform: Platform.OS });
  return requireString(data, "locationId");
};

/**
 * "Show a pay code instead": cancel the unpaid PaymentIntent so it can never be
 * charged later. Throws DoorTapError("payment_succeeded") when the guest
 * already paid (the sale must be recorded, not replaced).
 */
export const cancelDoorTapIntent = async (input: {
  paymentIntentId: string;
  clientRequestId: string;
}): Promise<void> => {
  const data = await invoke("door-tap-intent", {
    action: "cancel",
    paymentIntentId: input.paymentIntentId,
    clientRequestId: input.clientRequestId,
  });
  if (data.status !== "cancelled") {
    throw new DoorTapError("invalid_response", "cancel did not report cancelled");
  }
};

/** Tells the server the host saw how this tap ended, so no "not finished" push follows. */
export const markDoorTapOutcomeSeen = async (input: {
  paymentIntentId: string;
  clientRequestId: string;
}): Promise<void> => {
  await invoke("door-tap-intent", {
    action: "seen",
    paymentIntentId: input.paymentIntentId,
    clientRequestId: input.clientRequestId,
  });
};

/** Connection token for the brand's connected Stripe account. */
export const fetchTerminalConnectionToken = async (scope: TapToPayScopeIds): Promise<string> => {
  const data = await invoke("terminal-connection-token", { ...scopeBody(scope), platform: Platform.OS });
  return requireString(data, "secret");
};

export const createDoorTapIntent = async (
  input: CreateDoorTapIntentInput,
): Promise<DoorTapIntent> => {
  const data = await invoke("door-tap-intent", {
    action: "create",
    platform: Platform.OS,
    eventId: input.eventId,
    eventDateId: input.eventDateId,
    lines: input.lines,
    clientRequestId: input.clientRequestId,
    buyerPhone: input.buyerPhone,
    phoneCountryIso: input.phoneCountryIso,
    buyerName: input.buyerName,
  });
  return {
    paymentIntentId: requireString(data, "paymentIntentId"),
    clientSecret: requireString(data, "clientSecret"),
    totalCents: requireInt(data, "totalCents"),
    currency: requireString(data, "currency"),
    stripeAccountId: requireString(data, "stripeAccountId"),
    locationId: requireString(data, "locationId"),
    feeCents: optionalInt(data, "feeCents"),
    subtotalCents: optionalInt(data, "subtotalCents"),
  };
};

export const completeDoorTapIntent = async (input: {
  paymentIntentId: string;
  clientRequestId: string;
}): Promise<DoorTapCompleteResult> => {
  const data = await invoke("door-tap-intent", {
    action: "complete",
    paymentIntentId: input.paymentIntentId,
    clientRequestId: input.clientRequestId,
  });
  // Same result shape as biz_door_sale_record (snake or camel case accepted).
  const orderId = data.orderId ?? data.order_id;
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new DoorTapError("invalid_response", "missing orderId");
  }
  const ticketIdsRaw = data.ticketIds ?? data.ticket_ids;
  return {
    orderId,
    ticketIds: Array.isArray(ticketIdsRaw)
      ? ticketIdsRaw.filter((id): id is string => typeof id === "string")
      : [],
    receiptQueued: (data.receiptQueued ?? data.receipt_queued) === true,
    replayed: data.replayed === true,
  };
};

/** "Show a pay code instead": same lines, new door pay code. */
export const createDoorPayCodeForLines = async (input: {
  eventId: string;
  eventDateId: string | null;
  lines: TapToPayDraftLine[];
}): Promise<DoorPayCodeCreated> => {
  const data = await invoke("door-pay-code", {
    action: "create",
    eventId: input.eventId,
    eventDateId: input.eventDateId,
    lines: input.lines,
  });
  return { codeId: requireString(data, "codeId") };
};
