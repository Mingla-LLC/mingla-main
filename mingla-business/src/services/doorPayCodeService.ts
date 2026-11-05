/**
 * issue #4271 — door pay codes: the host creates a short-lived, pays-once code
 * for a locked basket; the guest opens `/pay/door/<code>` on their own phone
 * and pays through the normal checkout (Stripe hosted page or Paystack).
 *
 * Edge function `door-pay-code` (POST {action, ...}):
 *   quote     (host)   → DoorPayCodeQuote (same pricing as create, no row)
 *   create    (host)   → DoorPayCodeCreated (replacesCodeId closes the old code first)
 *   view      (public) → DoorPayCodeView, 404 {error:"not_found"}
 *   cancel    (host)   → {status:"cancelled"|"payment_landing"|"checking"}
 *   settle    (host)   → {status}: the server's answer once the host's clock
 *                        passes expires_at
 *   text_link (host)   → {sent:true, last4}
 * Checkout: `ticket-checkout-create` with `doorCode` (basket comes from the
 * code; 409 {error:"door_code_unavailable", status} when it can't be paid).
 *
 * Host screens read the `door_pay_codes` row directly (RLS: brand team with
 * door access) and listen to it on realtime.
 */

import { supabase } from "./supabase";
import type { BuyerDetails } from "../components/checkout/CartContext";
import {
  ticketCheckoutProviderHandoff,
  type TicketCheckoutCreateResult,
  type TicketCheckoutProviderHandoff,
} from "./ticketCheckoutService";

export type DoorPayCodeStatus =
  | "open"
  | "opened"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed";

/**
 * What the server says while a close can't finish. The code stays open:
 * payment_landing means the provider took the money and finalize makes the sale;
 * checking means the provider hasn't answered yet.
 */
export type DoorPayUnsettledStatus = "payment_landing" | "checking";
export type DoorPayLiveStatus = DoorPayCodeStatus | DoorPayUnsettledStatus;

const STATUSES: readonly DoorPayCodeStatus[] = [
  "open",
  "opened",
  "paid",
  "expired",
  "cancelled",
  "failed",
];

export interface DoorPayCodeLine {
  ticketTypeId: string;
  name: string;
  quantity: number;
  unitCents: number;
}

export interface DoorPayCodeCreated {
  codeId: string;
  code: string;
  payUrl: string;
  totalCents: number;
  subtotalCents: number;
  feeCents: number;
  currency: string;
  expiresAt: string;
  lines: DoorPayCodeLine[];
}

export interface DoorPayCodeView {
  status: DoorPayLiveStatus;
  /** A payment that landed after this code closed, and its refund. */
  latePayment: DoorPayLatePayment | null;
  /** Optional: forwarded to checkout when the server includes it. */
  eventId?: string;
  eventName: string;
  eventStartsAt: string | null;
  venueLabel: string | null;
  brandName: string;
  lines: DoorPayCodeLine[];
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  currency: string;
  expiresAt: string;
}

/** The host-side row, as RLS lets the brand team read it. */
export interface DoorPayCodeRow {
  id: string;
  eventId: string;
  eventDateId: string | null;
  code: string;
  status: DoorPayCodeStatus;
  provider: "stripe" | "paystack";
  lines: { ticketTypeId: string; quantity: number }[];
  currency: string;
  subtotalCents: number;
  totalCents: number;
  expiresAt: string;
  openedAt: string | null;
  paidAt: string | null;
  orderId: string | null;
  failureReason: string | null;
}

export class DoorPayCodeError extends Error {
  readonly code: string;
  readonly status: number | null;
  /** The code's status, when a 409 reports why it can't be paid. */
  readonly codeStatus: DoorPayLiveStatus | null;

  constructor(code: string, status: number | null = null, codeStatus: DoorPayLiveStatus | null = null) {
    super(code);
    this.name = "DoorPayCodeError";
    this.code = code;
    this.status = status;
    this.codeStatus = codeStatus;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const toDoorPayCodeStatus = (value: unknown): DoorPayCodeStatus | null =>
  typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as DoorPayCodeStatus)
    : null;

export const toDoorPayLiveStatus = (value: unknown): DoorPayLiveStatus | null =>
  value === "payment_landing" || value === "checking" ? value : toDoorPayCodeStatus(value);

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const parseLines = (value: unknown): DoorPayCodeLine[] =>
  Array.isArray(value)
    ? value.flatMap((line: unknown) => {
        if (!isRecord(line)) return [];
        const ticketTypeId = str(line.ticketTypeId ?? line.ticket_type_id);
        const quantity = num(line.quantity);
        if (ticketTypeId.length === 0 || quantity <= 0) return [];
        return [{
          ticketTypeId,
          name: str(line.name) || "Ticket",
          quantity,
          unitCents: num(line.unitCents ?? line.unit_cents),
        }];
      })
    : [];

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
  };
};

export interface CreateDoorPayCodeInput {
  eventId: string;
  eventDateId: string | null;
  lines: { ticketTypeId: string; quantity: number }[];
  /** "Show a new code": the server closes this code (and its checkout) first. */
  replacesCodeId?: string | null;
}

/** The server's price for a door basket, fees included, before any code. */
export interface DoorPayCodeQuote {
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  currency: string;
}

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

interface DoorPayCodeDbRow {
  id: string;
  event_id: string;
  event_date_id: string | null;
  code: string;
  status: string;
  provider: string | null;
  lines: unknown;
  currency: string | null;
  subtotal_cents: number | null;
  total_cents: number | null;
  expires_at: string;
  opened_at: string | null;
  paid_at: string | null;
  order_id: string | null;
  failure_reason: string | null;
}

export const DOOR_PAY_CODE_COLUMNS =
  "id,event_id,event_date_id,code,status,provider,lines,currency,subtotal_cents,total_cents,expires_at,opened_at,paid_at,order_id,failure_reason";

export const mapDoorPayCodeRow = (row: DoorPayCodeDbRow): DoorPayCodeRow => ({
  id: row.id,
  eventId: row.event_id,
  eventDateId: row.event_date_id ?? null,
  code: row.code,
  status: toDoorPayCodeStatus(row.status) ?? "failed",
  provider: row.provider === "paystack" ? "paystack" : "stripe",
  lines: parseLines(row.lines).map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity })),
  currency: row.currency ?? "",
  subtotalCents: row.subtotal_cents ?? 0,
  totalCents: row.total_cents ?? 0,
  expiresAt: row.expires_at,
  openedAt: row.opened_at,
  paidAt: row.paid_at,
  orderId: row.order_id,
  failureReason: row.failure_reason,
});

export const fetchDoorPayCode = async (codeId: string): Promise<DoorPayCodeRow> => {
  const { data, error } = await supabase
    .from("door_pay_codes")
    .select(DOOR_PAY_CODE_COLUMNS)
    .eq("id", codeId)
    .single();
  if (error !== null) throw new DoorPayCodeError(error.code ?? "door_pay_code_load_failed");
  return mapDoorPayCodeRow(data as unknown as DoorPayCodeDbRow);
};

/**
 * A payment that landed after the code closed is owed back in full: "refunding"
 * until the provider confirms, "refunded" after. "kept" is the backstop: it stood
 * as an online order, so no refund exists. Null when nothing was charged.
 */
export interface DoorPayLatePayment {
  state: "refunding" | "refunded" | "kept";
  amountCents: number;
  currency: string;
}

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
