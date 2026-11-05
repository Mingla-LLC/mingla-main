// Issue #4271 — door-pay-code. The host makes a one-time pay code for one door
// sale; the guest opens it on their own phone and pays through the normal
// online checkout (ticket-checkout-create with body.doorCode).
//
// verify_jwt = false at the gateway: `view` is public (the guest has no Mingla
// account). `quote`, `create`, `cancel` and `text_link` verify the bearer in
// code and require issue_4271_can_take_door_payment for the event.
//
// A code is a pay link, never a ticket credential. The server always prices.
//
// Closing a code (cancel, expiry, "Show a new code") goes through
// issue_4271_door_pay_code_revoke, which revokes every checkout session the
// code opened on the #1930 revocation rail, then expires the guest's Stripe
// Checkout page now on the brand's connected account (Stripe-Account header,
// the same idempotency key the checkout-sale-revocation worker uses, so the
// worker finishes the job if this call fails). Paystack has no page to
// expire: a payment that still lands is refused at finalize and refunded in
// full by the late-payment refund.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import { resolveBuyerPhone } from "../_shared/buyerPhone.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import {
  canTakeDoorPayment,
  quoteDoorSale,
} from "../_shared/doorPayServer.ts";
import {
  DOOR_CODE_RE,
  DOOR_CODE_TTL_MS,
  doorErrorFromDb,
  effectiveDoorCodeStatus,
  generateDoorCode,
  isUuid,
  last4,
  makeDoorPayUrl,
  parseDoorLines,
} from "../_shared/doorPay.ts";

export interface DoorPayCodeDeps {
  // deno-lint-ignore no-explicit-any
  serviceClient: () => any;
  userIdFromAuthHeader: (req: Request) => Promise<string | null>;
  now: () => number;
  generateCode: () => string;
  /** The ticket checkout Stripe client; only built when a page must expire. */
  // deno-lint-ignore no-explicit-any
  stripe?: () => any;
}

const defaultDeps: DoorPayCodeDeps = {
  serviceClient,
  userIdFromAuthHeader,
  now: () => Date.now(),
  generateCode: () => generateDoorCode(),
  stripe: stripeTicketCheckout,
};

type Body = Record<string, unknown>;

// deno-lint-ignore no-explicit-any
type Client = any;

interface StripeExpire {
  checkoutSessionId: string;
  stripeAccountId: string;
  idempotencyKey: string;
}

/**
 * Cancels or expires a code and closes every checkout it opened. Answers the
 * code's status afterwards ('cancelled', 'expired', 'paid' or 'not_found'),
 * or null when the database call failed.
 */
async function revokeDoorPayCode(
  supabase: Client,
  deps: DoorPayCodeDeps,
  codeId: string,
  status: "cancelled" | "expired",
): Promise<string | null> {
  const { data, error } = await supabase.rpc("issue_4271_door_pay_code_revoke", {
    p_code_id: codeId,
    p_status: status,
  });
  if (error || data === null || typeof data !== "object") {
    console.error("[door-pay-code] revoke failed", error?.message ?? "no_result");
    return null;
  }
  const result = data as { status?: unknown; stripeExpire?: unknown };
  const pages = Array.isArray(result.stripeExpire)
    ? (result.stripeExpire as StripeExpire[])
    : [];
  if (pages.length > 0) {
    try {
      const stripe = (deps.stripe ?? stripeTicketCheckout)();
      for (const page of pages) {
        try {
          // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
          await stripe.checkout.sessions.expire(
            page.checkoutSessionId,
            {},
            {
              stripeAccount: page.stripeAccountId,
              idempotencyKey: page.idempotencyKey,
            },
          );
        } catch (expireError) {
          // The session is already revoked locally and queued on the
          // revocation outbox; the worker retries the expiry with this key.
          console.warn(
            "[door-pay-code] stripe checkout expire deferred to the revocation worker",
            expireError instanceof Error ? expireError.message : "unknown",
          );
        }
      }
    } catch (clientError) {
      console.warn(
        "[door-pay-code] stripe client unavailable; the revocation worker expires the page",
        clientError instanceof Error ? clientError.message : "unknown",
      );
    }
  }
  return typeof result.status === "string" ? result.status : null;
}

async function handleQuote(
  req: Request,
  body: Body,
  deps: DoorPayCodeDeps,
): Promise<Response> {
  const actorId = await deps.userIdFromAuthHeader(req);
  if (actorId === null) return jsonResponse({ error: "door_access_denied" }, 401);
  const eventId = body.eventId;
  const eventDateId = body.eventDateId ?? null;
  if (!isUuid(eventId) || (eventDateId !== null && !isUuid(eventDateId))) {
    return jsonResponse({ error: "invalid_lines" }, 400);
  }
  const supabase = deps.serviceClient();
  if (!(await canTakeDoorPayment(supabase, eventId, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  // Same pricing as create; nothing is written.
  const quote = await quoteDoorSale(supabase, {
    eventId,
    eventDateId: eventDateId as string | null,
    lines: body.lines,
  });
  if (!quote.ok) return jsonResponse({ error: quote.error }, quote.status);
  return jsonResponse({
    subtotalCents: quote.money.subtotalCents,
    feeCents: quote.money.feeCents,
    totalCents: quote.money.totalCents,
    currency: quote.money.currency,
  });
}


async function handleCreate(
  req: Request,
  body: Body,
  deps: DoorPayCodeDeps,
): Promise<Response> {
  const actorId = await deps.userIdFromAuthHeader(req);
  if (actorId === null) return jsonResponse({ error: "door_access_denied" }, 401);
  const eventId = body.eventId;
  const eventDateId = body.eventDateId ?? null;
  if (!isUuid(eventId) || (eventDateId !== null && !isUuid(eventDateId))) {
    return jsonResponse({ error: "invalid_lines" }, 400);
  }
  const supabase = deps.serviceClient();
  if (!(await canTakeDoorPayment(supabase, eventId, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const quote = await quoteDoorSale(supabase, {
    eventId,
    eventDateId: eventDateId as string | null,
    lines: body.lines,
  });
  if (!quote.ok) return jsonResponse({ error: quote.error }, quote.status);

  // "Show a new code": the code it replaces stops being payable first, so the
  // guest can never pay both.
  if (body.replacesCodeId !== undefined && body.replacesCodeId !== null) {
    if (!isUuid(body.replacesCodeId)) return jsonResponse({ error: "not_found" }, 404);
    const { data: previous, error: previousError } = await supabase
      .from("door_pay_codes")
      .select("id, event_id, status")
      .eq("id", body.replacesCodeId)
      .maybeSingle();
    if (previousError) return jsonResponse({ error: "server_error" }, 500);
    if (!previous || previous.event_id !== eventId) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    const closed = await revokeDoorPayCode(supabase, deps, previous.id, "expired");
    if (closed === null) return jsonResponse({ error: "server_error" }, 500);
    if (closed === "paid") {
      return jsonResponse({ error: "door_code_unavailable", status: "paid" }, 409);
    }
  }

  const expiresAt = new Date(deps.now() + DOOR_CODE_TTL_MS).toISOString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = deps.generateCode();
    const { data: inserted, error } = await supabase
      .from("door_pay_codes")
      .insert({
        brand_id: quote.brandId,
        event_id: eventId,
        event_date_id: eventDateId,
        code,
        lines: quote.lines.map((l) => ({
          ticketTypeId: l.ticketTypeId,
          quantity: l.quantity,
        })),
        currency: quote.money.currency,
        subtotal_cents: quote.money.subtotalCents,
        fee_cents: quote.money.feeCents,
        total_cents: quote.money.totalCents,
        provider: quote.provider,
        status: "open",
        expires_at: expiresAt,
        created_by: actorId,
      })
      .select("id, code, expires_at")
      .single();
    if (error) {
      if (error.code === "23505") continue; // code collision: draw again
      console.error("[door-pay-code] insert failed", error.message);
      return jsonResponse({ error: "server_error" }, 500);
    }
    return jsonResponse({
      codeId: inserted.id,
      code: inserted.code,
      payUrl: makeDoorPayUrl(PRODUCTION_BUSINESS_WEB_ORIGIN, inserted.code),
      totalCents: quote.money.totalCents,
      subtotalCents: quote.money.subtotalCents,
      feeCents: quote.money.feeCents,
      currency: quote.money.currency,
      expiresAt: inserted.expires_at,
      lines: quote.lines,
    });
  }
  return jsonResponse({ error: "server_error" }, 500);
}

async function handleView(body: Body, deps: DoorPayCodeDeps): Promise<Response> {
  const raw = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!DOOR_CODE_RE.test(raw)) return jsonResponse({ error: "not_found" }, 404);
  const supabase = deps.serviceClient();
  const { data: row, error } = await supabase
    .from("door_pay_codes")
    .select(
      "id, event_id, event_date_id, lines, currency, subtotal_cents, fee_cents, total_cents, status, expires_at, events!inner(title, location_text, city, brands!inner(name))",
    )
    .eq("code", raw)
    .maybeSingle();
  if (error) {
    console.error("[door-pay-code] view lookup failed", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  if (!row) return jsonResponse({ error: "not_found" }, 404);

  let status = effectiveDoorCodeStatus(row.status, row.expires_at, deps.now());
  if (status === "expired" && row.status !== "expired") {
    // Persist the expiry and close the checkout it opened. A payment that
    // landed meanwhile wins: the code then reads as paid.
    const closed = await revokeDoorPayCode(supabase, deps, row.id, "expired");
    if (closed === "paid") status = "paid";
  } else if (status === "open") {
    const { data: flipped } = await supabase.from("door_pay_codes")
      .update({
        status: "opened",
        opened_at: new Date(deps.now()).toISOString(),
        updated_at: new Date(deps.now()).toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "open")
      .select("status")
      .maybeSingle();
    if (flipped?.status === "opened") status = "opened";
  }

  const lineInput = Array.isArray(row.lines) ? row.lines : [];
  const ids = lineInput.map((l: { ticketTypeId: string }) => l.ticketTypeId);
  const { data: tiers } = ids.length > 0
    ? await supabase.from("ticket_types").select("id, name, price_cents").in("id", ids)
    : { data: [] };
  const tierById = new Map<string, { name: string; price_cents: number }>(
    (tiers ?? []).map((t: { id: string; name: string; price_cents: number }) => [t.id, t]),
  );
  const lines = lineInput.map((l: { ticketTypeId: string; quantity: number }) => ({
    ticketTypeId: l.ticketTypeId,
    name: tierById.get(l.ticketTypeId)?.name ?? "Ticket",
    quantity: l.quantity,
    unitCents: tierById.get(l.ticketTypeId)?.price_cents ?? 0,
  }));

  let startsAt: string | null = null;
  {
    const query = supabase.from("event_dates").select("start_at")
      .eq("event_id", row.event_id);
    const { data: dates } = row.event_date_id
      ? await query.eq("id", row.event_date_id).limit(1)
      : await query.is("cancelled_at", null).order("start_at", { ascending: true }).limit(1);
    startsAt = Array.isArray(dates) && dates.length > 0 ? dates[0].start_at : null;
  }
  const event = Array.isArray(row.events) ? row.events[0] : row.events;
  const brand = Array.isArray(event?.brands) ? event.brands[0] : event?.brands;
  const venue = typeof event?.location_text === "string" && event.location_text.trim()
    ? event.location_text.trim()
    : typeof event?.city === "string" && event.city.trim()
    ? event.city.trim()
    : null;

  // No buyer data of any kind leaves this public read.
  return jsonResponse({
    status,
    eventId: row.event_id,
    eventDateId: row.event_date_id ?? null,
    eventName: event?.title ?? "",
    eventStartsAt: startsAt,
    venueLabel: venue,
    brandName: brand?.name ?? "",
    lines,
    subtotalCents: row.subtotal_cents,
    feeCents: row.fee_cents,
    totalCents: row.total_cents,
    currency: row.currency,
    expiresAt: row.expires_at,
  });
}

async function loadCodeForActor(
  req: Request,
  body: Body,
  deps: DoorPayCodeDeps,
): Promise<
  | { ok: true; supabase: Client; actorId: string; row: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const actorId = await deps.userIdFromAuthHeader(req);
  if (actorId === null) {
    return { ok: false, response: jsonResponse({ error: "door_access_denied" }, 401) };
  }
  if (!isUuid(body.codeId)) {
    return { ok: false, response: jsonResponse({ error: "not_found" }, 404) };
  }
  const supabase = deps.serviceClient();
  const { data: row, error } = await supabase
    .from("door_pay_codes")
    .select("id, event_id, code, status, expires_at")
    .eq("id", body.codeId)
    .maybeSingle();
  if (error) {
    return { ok: false, response: jsonResponse({ error: "server_error" }, 500) };
  }
  if (!row) return { ok: false, response: jsonResponse({ error: "not_found" }, 404) };
  if (!(await canTakeDoorPayment(supabase, String(row.event_id), actorId))) {
    return { ok: false, response: jsonResponse({ error: "door_access_denied" }, 400) };
  }
  return { ok: true, supabase, actorId, row };
}

async function handleCancel(
  req: Request,
  body: Body,
  deps: DoorPayCodeDeps,
): Promise<Response> {
  const loaded = await loadCodeForActor(req, body, deps);
  if (!loaded.ok) return loaded.response;
  const { supabase, row } = loaded;
  if (row.status === "paid") {
    return jsonResponse({ error: "door_code_unavailable", status: "paid" }, 409);
  }
  // The host is told "Nothing was charged": the code and every checkout it
  // opened close together, under the session + code locks.
  const closed = await revokeDoorPayCode(supabase, deps, String(row.id), "cancelled");
  if (closed === null) return jsonResponse({ error: "server_error" }, 500);
  if (closed === "paid") {
    return jsonResponse({ error: "door_code_unavailable", status: "paid" }, 409);
  }
  if (closed === "not_found") return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse({ status: "cancelled" });
}

async function handleTextLink(
  req: Request,
  body: Body,
  deps: DoorPayCodeDeps,
): Promise<Response> {
  const loaded = await loadCodeForActor(req, body, deps);
  if (!loaded.ok) return loaded.response;
  const { supabase, row } = loaded;
  const phone = resolveBuyerPhone(body.phone, body.phoneCountryIso);
  if (phone.e164 === null || phone.legacyNanpGuess) {
    return jsonResponse({ error: "buyer_phone_invalid", message: phone.message }, 400);
  }
  const { error } = await supabase.rpc("issue_4271_door_pay_code_text_link", {
    p_code_id: row.id,
    p_phone_e164: phone.e164,
    p_pay_url: makeDoorPayUrl(PRODUCTION_BUSINESS_WEB_ORIGIN, String(row.code)),
  });
  if (error) {
    const mapped = doorErrorFromDb(error.message);
    return jsonResponse({ error: mapped.error }, mapped.status);
  }
  return jsonResponse({ sent: true, last4: last4(phone.e164) });
}

export const createDoorPayCodeHandler = (
  deps: DoorPayCodeDeps = defaultDeps,
): (req: Request) => Promise<Response> =>
  wrapEdgeHandler("door-pay-code", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "invalid_request" }, 405);
    }
    let body: Body;
    try {
      const parsed = await req.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return jsonResponse({ error: "invalid_request" }, 400);
      }
      body = parsed as Body;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    switch (body.action) {
      case "quote":
        return await handleQuote(req, body, deps);
      case "create":
        return await handleCreate(req, body, deps);
      case "view":
        return await handleView(body, deps);
      case "cancel":
        return await handleCancel(req, body, deps);
      case "text_link":
        return await handleTextLink(req, body, deps);
      default:
        return jsonResponse({ error: "invalid_request" }, 400);
    }
  }, {
    onError: (_err, requestId) =>
      jsonResponse({ error: "server_error", requestId }, 500),
  });

if (import.meta.main) {
  serve(createDoorPayCodeHandler());
}
