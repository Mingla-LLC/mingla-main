/**
 * issue #4271 — the door pay code calls (edge function `door-pay-code`, the
 * door_pay_codes reads and RPCs, and the guest's checkout). Loaded on the first
 * call through doorPayCodeService.ts, which holds the types, DoorPayCodeError and
 * the row mapper; import from there, not from here, outside tests.
 */

import { supabase } from "./supabase";
import type { BuyerDetails } from "../components/checkout/CartContext";
import {
  ticketCheckoutProviderHandoff,
  type TicketCheckoutCreateResult,
  type TicketCheckoutProviderHandoff,
} from "./ticketCheckoutService";

import {
  DoorPayCodeError,
  DOOR_PAY_CODE_COLUMNS,
  isRecord,
  num,
  parseLines,
  str,
  mapDoorPayCodeRow,
  toDoorPayLiveStatus,
  type CreateDoorPayCodeInput,
  type DoorPayCodeCreated,
  type DoorPayCodeDbRow,
  type DoorPayCodeLine,
  type DoorPayCodeQuote,
  type DoorPayCodeRow,
  type DoorPayCodeView,
  type DoorPayLatePayment,
  type DoorPayLiveStatus,
  type DoorPayUnsettledStatus,
} from "./doorPayCodeService";

const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** Reads `{error, status}` off a FunctionsHttpError before the body is gone. */
const readDoorPayRefusal = async (error: unknown): Promise<DoorPayCodeError> => {
  const context = isRecord(error) ? error.context : null;
  const status = isRecord(context) && typeof context.status === "number" ? context.status : null;
  if (isRecord(context) && typeof context.json === "function") {
    try {
      const body: unknown = await (context.json as () => Promise<unknown>).call(context);
      if (isRecord(body) && typeof body.error === "string") {
        return new DoorPayCodeError(body.error, status, toDoorPayLiveStatus(body.status));
      }
    } catch {
      // Body already consumed or not JSON: the HTTP status still stands.
    }
  }
  return new DoorPayCodeError(status === null ? "network" : "request_failed", status);
};

const invokeDoorPayCode = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const { data, error } = await supabase.functions.invoke("door-pay-code", { body });
  if (error !== null && error !== undefined) throw await readDoorPayRefusal(error);
  if (!isRecord(data)) throw new DoorPayCodeError("empty_response");
  return data;
};

export const parseDoorPayCodeCreated = (data: Record<string, unknown>): DoorPayCodeCreated => {
  const codeId = str(data.codeId);
  const code = str(data.code);
  if (codeId.length === 0 || code.length === 0) throw new DoorPayCodeError("invalid_response");
  return {
    codeId,
    code,
    payUrl: str(data.payUrl),
    totalCents: num(data.totalCents),
    subtotalCents: num(data.subtotalCents),
    feeCents: num(data.feeCents),
    currency: str(data.currency),
    expiresAt: str(data.expiresAt),
    lines: parseLines(data.lines),
  };
};

export const parseDoorPayCodeView = (data: Record<string, unknown>): DoorPayCodeView => {
  const status = toDoorPayLiveStatus(data.status);
  if (status === null) throw new DoorPayCodeError("invalid_response");
  return {
    status,
    latePayment: parseDoorPayLatePayment(data.latePayment),
    ...(typeof data.eventId === "string" && data.eventId.length > 0 ? { eventId: data.eventId } : {}),
    eventName: str(data.eventName) || "Event",
    eventStartsAt: strOrNull(data.eventStartsAt),
    venueLabel: strOrNull(data.venueLabel),
    brandName: str(data.brandName),
    lines: parseLines(data.lines),
    subtotalCents: num(data.subtotalCents),
    feeCents: num(data.feeCents),
    totalCents: num(data.totalCents),
    currency: str(data.currency),
    expiresAt: str(data.expiresAt),
    provider: data.provider === "stripe" || data.provider === "paystack" ? data.provider : null,
  };
};

export const parseDoorPayCodeQuote = (data: Record<string, unknown>): DoorPayCodeQuote => {
  const currency = str(data.currency);
  const totalCents = num(data.totalCents);
  if (currency.length === 0 || totalCents <= 0) throw new DoorPayCodeError("invalid_response");
  return {
    subtotalCents: num(data.subtotalCents),
    feeCents: num(data.feeCents),
    totalCents,
    currency,
  };
};

export const quoteDoorPayCode = async (
  input: Omit<CreateDoorPayCodeInput, "replacesCodeId">,
): Promise<DoorPayCodeQuote> =>
  parseDoorPayCodeQuote(
    await invokeDoorPayCode({
      action: "quote",
      eventId: input.eventId,
      eventDateId: input.eventDateId,
      lines: input.lines.map((line) => ({
        ticketTypeId: line.ticketTypeId,
        quantity: line.quantity,
      })),
    }),
  );

export const createDoorPayCode = async (
  input: CreateDoorPayCodeInput,
): Promise<DoorPayCodeCreated> =>
  parseDoorPayCodeCreated(
    await invokeDoorPayCode({
      action: "create",
      eventId: input.eventId,
      eventDateId: input.eventDateId,
      lines: input.lines.map((line) => ({
        ticketTypeId: line.ticketTypeId,
        quantity: line.quantity,
      })),
      ...(typeof input.replacesCodeId === "string" && input.replacesCodeId.length > 0
        ? { replacesCodeId: input.replacesCodeId }
        : {}),
    }),
  );

export const viewDoorPayCode = async (code: string): Promise<DoorPayCodeView> =>
  parseDoorPayCodeView(await invokeDoorPayCode({ action: "view", code }));

export const cancelDoorPayCode = async (
  codeId: string,
): Promise<"cancelled" | DoorPayUnsettledStatus> => {
  const data = await invokeDoorPayCode({ action: "cancel", codeId });
  if (data.status === "cancelled" || data.status === "payment_landing" || data.status === "checking") {
    return data.status;
  }
  throw new DoorPayCodeError("cancel_failed");
};

/** The host's clock passed expires_at: only the server says what that means. */
export const settleDoorPayCode = async (codeId: string): Promise<DoorPayLiveStatus> => {
  const data = await invokeDoorPayCode({ action: "settle", codeId });
  const status = toDoorPayLiveStatus(data.status);
  if (status === null) throw new DoorPayCodeError("invalid_response");
  return status;
};

export const textDoorPayLink = async (input: {
  codeId: string;
  phone: string;
  phoneCountryIso: string | null;
}): Promise<{ last4: string }> => {
  const data = await invokeDoorPayCode({
    action: "text_link",
    codeId: input.codeId,
    phone: input.phone,
    phoneCountryIso: input.phoneCountryIso,
  });
  if (data.sent !== true) throw new DoorPayCodeError("text_failed");
  return { last4: str(data.last4) };
};

export const fetchDoorPayCode = async (codeId: string): Promise<DoorPayCodeRow> => {
  const { data, error } = await supabase
    .from("door_pay_codes")
    .select(DOOR_PAY_CODE_COLUMNS)
    .eq("id", codeId)
    .single();
  if (error !== null) throw new DoorPayCodeError(error.code ?? "door_pay_code_load_failed");
  return mapDoorPayCodeRow(data as unknown as DoorPayCodeDbRow);
};

export const parseDoorPayLatePayment = (data: unknown): DoorPayLatePayment | null => {
  if (!isRecord(data)) return null;
  const state =
    data.state === "refunded" || data.state === "refunding" || data.state === "kept"
      ? data.state
      : null;
  if (state === null) return null;
  return { state, amountCents: num(data.amountCents), currency: str(data.currency) };
};

export const fetchDoorPayLatePayment = async (codeId: string): Promise<DoorPayLatePayment | null> => {
  const { data, error } = await supabase.rpc("biz_door_pay_code_late_payment", {
    p_code_id: codeId,
  });
  if (error !== null) throw new DoorPayCodeError(error.code ?? "door_late_payment_load_failed");
  return parseDoorPayLatePayment(data);
};

/**
 * The paid code's guest name for the host's paid screen; null for a walk-up.
 * Server path on purpose: a scanner allowed to take payments reaches that
 * screen but cannot read `orders` under RLS, and an empty read would look like
 * a false "Walk-up".
 */
export const fetchDoorPayGuestName = async (codeId: string): Promise<string | null> => {
  const { data, error } = await supabase.rpc("biz_door_pay_code_guest_name", {
    p_code_id: codeId,
  });
  if (error !== null) throw new DoorPayCodeError(error.code ?? "door_guest_load_failed");
  const name = typeof data === "string" ? data.trim() : "";
  return name.length > 0 ? name : null;
};

/** issue #4271 — server answer to "may this user take money at this door?" */
export const fetchCanTakeDoorPayment = async (eventId: string): Promise<boolean> => {
  const { data, error } = await supabase.rpc("biz_can_take_door_payment", {
    p_event_id: eventId,
  });
  if (error !== null) throw new DoorPayCodeError(error.code ?? "door_permission_load_failed");
  return data === true;
};

/**
 * issue #4271 — the guest's checkout for a door code. The server takes the
 * basket from the code (client lines are ignored) and forces the web surface;
 * we hand back exactly what online checkout follows (Stripe hosted URL or
 * Paystack authorization URL).
 */
export const createDoorCodeCheckout = async (input: {
  doorCode: string;
  eventId?: string;
  buyer: BuyerDetails;
}): Promise<TicketCheckoutProviderHandoff> => {
  const { data, error } = await supabase.functions.invoke("ticket-checkout-create", {
    body: {
      doorCode: input.doorCode,
      ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
      returnContract: "host_v1",
      surface: "web",
      buyer: input.buyer,
      // The server's door arm keeps only guest fields and requires this flag
      // (or buyer.termsAccepted); refuses with 400 purchase_terms_required.
      purchaseTermsAccepted: input.buyer.termsAccepted === true,
      lines: [],
    },
  });
  // A 409 door_code_unavailable carries the code's status (paid, expired...).
  if (error !== null && error !== undefined) throw await readDoorPayRefusal(error);
  const handoff = isRecord(data)
    ? ticketCheckoutProviderHandoff(data as unknown as TicketCheckoutCreateResult)
    : null;
  if (handoff === null) throw new DoorPayCodeError("no_handoff");
  return handoff;
};
