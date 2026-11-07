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
 *
 * This module is the shared core: the types, DoorPayCodeError, the status
 * readers and the row mapper the realtime listener needs. doorPayCodeService.ts
 * re-exports it beside one async wrapper per call; the calls themselves live in
 * doorPayCodeServiceImpl.ts, loaded on the first call. Both import this file,
 * never each other statically, so there is no require cycle.
 */

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
  /**
   * Who takes the money. Null when the server did not say: the guest page then
   * uses the Paystack wording, since it can't know no payment can still land.
   */
  provider: "stripe" | "paystack" | null;
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

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const toDoorPayCodeStatus = (value: unknown): DoorPayCodeStatus | null =>
  typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as DoorPayCodeStatus)
    : null;

export const toDoorPayLiveStatus = (value: unknown): DoorPayLiveStatus | null =>
  value === "payment_landing" || value === "checking" ? value : toDoorPayCodeStatus(value);

export const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const str = (value: unknown): string => (typeof value === "string" ? value : "");

export const parseLines = (value: unknown): DoorPayCodeLine[] =>
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

export interface DoorPayCodeDbRow {
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

