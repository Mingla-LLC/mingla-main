// #4514 wave 5 review fix 1: the checkout's form read (BUILD CONTRACT v2 §3.4,
// §3.6). The buyer checkout's Details step asks what the page's form needs with
// the SAME credential the buyer presents to ticket-checkout-create: the bearer
// (a signed-in buyer: #2101 / #1931 private access, and OP-5 "already answered")
// and the private ticket link (#3827), hashed here exactly as checkout hashes it.
//
//   {op:"checkout_form", eventId, ticketLinkToken?}
//     → 200 {ok:true, form:{active, mode, formId, name, questionCount, versionId,
//            definition, requiredForm, doorFullAnswers, brand, answered?}}
//     → 400 bad_request · 503 forms_paused handled by the caller · 500 server_error
//
// SQL decides (brand_form_checkout_form): the ONE visibility rule
// (brand_form_checkout_visible) that brand_form_checkout_check also applies, so
// a buyer is never refused for a form this read did not show. An absent or
// invalid credential on a page that needs one reads as no form. The payload is
// the form itself only (title, questions, brand header): never responses.
// The raw link token is never logged or stored.

import { TICKET_LINK_TOKEN } from "../_shared/ticketLinkToken.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CheckoutFormRequest {
  op: "checkout_form";
  eventId: string;
  ticketLinkToken: string | null;
}

export interface CheckoutFormDeps {
  checkoutForm(
    eventId: string,
    buyerUserId: string | null,
    ticketLinkHash: string | null,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  /** The #3827 lookup HMAC of a link token (the shared token helper). */
  hashTicketLink(token: string): Promise<string>;
  log: (line: string) => void;
}

export function isCheckoutFormOp(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).op === "checkout_form";
}

export function parseCheckoutFormRequest(
  raw: unknown,
): CheckoutFormRequest | null {
  if (!isCheckoutFormOp(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    Object.keys(r).some((k) =>
      !["op", "eventId", "ticketLinkToken"].includes(k)
    )
  ) return null;
  if (typeof r.eventId !== "string" || !UUID_RE.test(r.eventId)) return null;
  const link = r.ticketLinkToken;
  if (link !== undefined && link !== null) {
    if (typeof link !== "string" || !TICKET_LINK_TOKEN.test(link)) return null;
  }
  return {
    op: "checkout_form",
    eventId: r.eventId.toLowerCase(),
    ticketLinkToken: typeof link === "string" ? link : null,
  };
}

export async function handleCheckoutForm(
  req: CheckoutFormRequest,
  buyerUserId: string | null,
  deps: CheckoutFormDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const linkHash = req.ticketLinkToken === null
    ? null
    : await deps.hashTicketLink(req.ticketLinkToken);
  const { data, error } = await deps.checkoutForm(
    req.eventId,
    buyerUserId,
    linkHash,
  );
  if (error) {
    deps.log("[brand-form-submit] checkout_form server_error");
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  const form = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : { active: false };
  return { status: 200, body: { ok: true, form } };
}
