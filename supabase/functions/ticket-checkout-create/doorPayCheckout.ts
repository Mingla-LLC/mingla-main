// Issue #4271 — the door pay code arm of ticket-checkout-create.
//
// When the guest's browser sends `doorCode`, the basket is the code's lines and
// nothing the client sent about tickets, prices, dates, discounts or plans is
// read: the request body is REBUILT from the code plus the guest's own contact
// fields. The surface is forced to web, and the code must be open or opened
// and unexpired.

import {
  DOOR_CODE_RE,
  doorPayReturnUrl,
  effectiveDoorCodeStatus,
  makeDoorPayUrl,
} from "../_shared/doorPay.ts";

export interface DoorPayCheckoutContext {
  codeId: string;
  code: string;
  /** When the host's code stops being offered (the code row's expires_at). */
  expiresAt: string;
}

/** Stripe's floor for a Checkout Session's expires_at is 30 minutes after
 * creation (docs.stripe.com/api/checkout/sessions/create, `expires_at`: "from
 * 30 minutes to 24 hours"); one more minute absorbs clock skew. */
export const STRIPE_CHECKOUT_MIN_EXPIRY_MS = 31 * 60 * 1000;

/**
 * The guest's Stripe Checkout page closes when the code does, or at Stripe's
 * 30-minute floor if the code ends sooner (never the 24-hour default). Epoch
 * seconds, as Stripe takes it.
 */
export function doorStripeExpiresAt(
  door: DoorPayCheckoutContext,
  nowMs: number = Date.now(),
): number {
  const codeEnds = Date.parse(door.expiresAt);
  const floor = nowMs + STRIPE_CHECKOUT_MIN_EXPIRY_MS;
  const ends = Number.isFinite(codeEnds) ? Math.max(codeEnds, floor) : floor;
  return Math.ceil(ends / 1000);
}

/** The only guest-supplied fields a door checkout keeps. */
const GUEST_FIELDS = [
  "buyer",
  "intake_form_data",
  "intake_upload_session_id",
  "buyerStatusToken",
  "ad_tracking_opt_out",
  "purchaseTermsAccepted",
] as const;

export function isDoorCheckoutRequest(body: Record<string, unknown>): boolean {
  return body.doorCode !== undefined && body.doorCode !== null;
}

export async function resolveDoorPayCheckout(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  body: Record<string, unknown>,
  nowMs: number = Date.now(),
): Promise<
  | { ok: true; door: DoorPayCheckoutContext; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const raw = typeof body.doorCode === "string"
    ? body.doorCode.trim().toUpperCase()
    : "";
  if (!DOOR_CODE_RE.test(raw)) {
    return {
      ok: false,
      status: 409,
      body: { error: "door_code_unavailable", status: "not_found" },
    };
  }
  const { data: row, error } = await supabase
    .from("door_pay_codes")
    .select("id, code, event_id, event_date_id, lines, status, expires_at")
    .eq("code", raw)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      body: { error: "checkout_session_failed", detail: "door_code_lookup_failed" },
    };
  }
  if (!row) {
    return {
      ok: false,
      status: 409,
      body: { error: "door_code_unavailable", status: "not_found" },
    };
  }
  const status = effectiveDoorCodeStatus(row.status, row.expires_at, nowMs);
  if (status !== "open" && status !== "opened") {
    return { ok: false, status: 409, body: { error: "door_code_unavailable", status } };
  }
  // A browser that names an event must name this code's event.
  if (
    body.eventId !== undefined && body.eventId !== null &&
    body.eventId !== row.event_id
  ) {
    return {
      ok: false,
      status: 409,
      body: { error: "door_code_unavailable", status: "not_found" },
    };
  }
  // Purchase terms: the guest ticks the same consent box as online checkout.
  const buyer = (body.buyer ?? {}) as Record<string, unknown>;
  if (body.purchaseTermsAccepted !== true && buyer.termsAccepted !== true) {
    return { ok: false, status: 400, body: { error: "purchase_terms_required" } };
  }
  const rebuilt: Record<string, unknown> = {};
  for (const key of GUEST_FIELDS) {
    if (body[key] !== undefined) rebuilt[key] = body[key];
  }
  rebuilt.eventId = row.event_id;
  if (typeof row.event_date_id === "string" && row.event_date_id.length > 0) {
    rebuilt.eventDateId = row.event_date_id;
  }
  rebuilt.lines = (Array.isArray(row.lines) ? row.lines : []).map(
    (line: { ticketTypeId: string; quantity: number }) => ({
      ticketTypeId: line.ticketTypeId,
      quantity: line.quantity,
    }),
  );
  rebuilt.purchaseTermsAccepted = true;
  rebuilt.surface = "web";
  rebuilt.mode = "create";
  rebuilt.doorCode = row.code;
  return {
    ok: true,
    door: { codeId: row.id, code: row.code, expiresAt: String(row.expires_at) },
    body: rebuilt,
  };
}

/**
 * Links the fresh checkout session to its code under the code row lock. A code
 * paid, cancelled or expired in the meantime refuses with its status.
 */
export async function linkDoorPaySession(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  door: DoorPayCheckoutContext,
  checkoutSessionId: string,
): Promise<{ ok: true } | { ok: false; status: string }> {
  const { data, error } = await supabase.rpc(
    "issue_4271_door_pay_code_link_session",
    { p_code_id: door.codeId, p_checkout_session_id: checkoutSessionId },
  );
  if (error) return { ok: false, status: "failed" };
  if (data === "linked") return { ok: true };
  return { ok: false, status: typeof data === "string" ? data : "failed" };
}

export function doorPayStripeUrls(
  baseUrl: string,
  door: DoorPayCheckoutContext,
): { successUrl: string; cancelUrl: string } {
  return {
    successUrl: doorPayReturnUrl(baseUrl, door.code),
    cancelUrl: makeDoorPayUrl(baseUrl, door.code),
  };
}
