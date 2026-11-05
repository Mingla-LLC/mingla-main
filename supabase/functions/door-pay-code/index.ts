// Issue #4271 — door-pay-code. The host makes a one-time pay code for one door
// sale; the guest opens it on their own phone and pays through the normal
// online checkout (ticket-checkout-create with body.doorCode).
//
// verify_jwt = false at the gateway: `view` is public (the guest has no Mingla
// account). `quote`, `create`, `cancel`, `settle` and `text_link` verify the
// bearer in code and require issue_4271_can_take_door_payment for the event.
// `sweep` is cron only and checks the service role key.
//
// A code is a pay link, never a ticket credential. The server always prices.
//
// Closing a code (cancel, expiry, "Show a new code", the sweep) asks Stripe
// first. Stripe expires the guest's Checkout page or says a payment has already
// gone through; only then does issue_4271_door_pay_code_close close the code
// and revoke its checkout sessions on the #1930 rail. A payment that went
// through leaves the code open so finalize makes the sale ("payment_landing").
// An answer we can't get leaves it open too ("checking"): nobody is told
// nothing was charged on a guess. Paystack has no page to expire: a payment that
// still lands is refused at finalize and refunded in full, fee included.

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
  serviceRoleKey?: () => string | undefined;
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

type ClosedStatus =
  | "cancelled"
  | "expired"
  | "paid"
  | "not_found"
  | "payment_landing"
  | "checking";

type PageAnswer = "expired" | "complete" | "unconfirmed";

const pageAnswerFromStatus = (status: unknown): PageAnswer =>
  status === "expired" ? "expired" : status === "complete" ? "complete" : "unconfirmed";

/**
 * Asks Stripe to expire the page. Stripe refuses a page that is no longer open,
 * so a refusal reads the page instead: `complete` means the guest's payment went
 * through, and anything we can't read stays unconfirmed.
 */
async function expirePage(
  // deno-lint-ignore no-explicit-any
  stripe: any,
  page: StripeExpire,
): Promise<PageAnswer> {
  try {
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    const expired = await stripe.checkout.sessions.expire(
      page.checkoutSessionId,
      {},
      {
        stripeAccount: page.stripeAccountId,
        idempotencyKey: page.idempotencyKey,
      },
    );
    return pageAnswerFromStatus(expired?.status);
  } catch (expireError) {
    console.warn(
      "[door-pay-code] stripe refused the expiry; reading the page",
      expireError instanceof Error ? expireError.message : "unknown",
    );
  }
  try {
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only; Stripe retrievals do not accept idempotency keys
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    const read = await stripe.checkout.sessions.retrieve(
      page.checkoutSessionId,
      {},
      { stripeAccount: page.stripeAccountId },
    );
    return pageAnswerFromStatus(read?.status);
  } catch (readError) {
    console.warn(
      "[door-pay-code] stripe page read failed",
      readError instanceof Error ? readError.message : "unknown",
    );
    return "unconfirmed";
  }
}

/**
 * Closes a code in the only safe order: Stripe first, then our row. Answers the
 * code's state afterwards, or null when the database call failed.
 */
async function closeDoorPayCode(
  supabase: Client,
  deps: DoorPayCodeDeps,
  codeId: string,
  status: "cancelled" | "expired",
): Promise<ClosedStatus | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: live, error: liveError } = await supabase.rpc(
      "issue_4271_door_pay_code_live_pages",
      { p_code_id: codeId },
    );
    if (liveError || live === null || typeof live !== "object") {
      console.error("[door-pay-code] live page read failed", liveError?.message ?? "no_result");
      return null;
    }
    if (live.status === "paid") return "paid";
    if (live.status === "not_found") return "not_found";
    const pages = Array.isArray(live.pages) ? (live.pages as StripeExpire[]) : [];
    if (pages.length > 0) {
      // deno-lint-ignore no-explicit-any
      let stripe: any;
      try {
        stripe = (deps.stripe ?? stripeTicketCheckout)();
      } catch (clientError) {
        console.warn(
          "[door-pay-code] stripe client unavailable; the code stays open",
          clientError instanceof Error ? clientError.message : "unknown",
        );
        return "checking";
      }
      for (const page of pages) {
        const answer = await expirePage(stripe, page);
        if (answer === "complete") return "payment_landing";
        if (answer === "unconfirmed") return "checking";
      }
    }
    const { data, error } = await supabase.rpc("issue_4271_door_pay_code_close", {
      p_code_id: codeId,
      p_status: status,
      p_confirmed_pages: pages.map((page) => page.checkoutSessionId),
    });
    if (error || data === null || typeof data !== "object") {
      console.error("[door-pay-code] close failed", error?.message ?? "no_result");
      return null;
    }
    const closed = (data as { status?: unknown }).status;
    if (closed === "retry") continue; // A page opened meanwhile: ask Stripe again.
    if (
      closed === "cancelled" || closed === "expired" || closed === "paid" ||
      closed === "not_found"
    ) {
      return closed;
    }
    return null;
  }
  return "checking";
}

/** A late payment on a closed code, for the guest's page. Null when none. */
async function readLatePayment(
  supabase: Client,
  codeId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc("issue_4271_door_pay_code_late_read", {
    p_code_id: codeId,
  });
  if (error) {
    console.error("[door-pay-code] late payment read failed", error.message);
    return null;
  }
  return data !== null && typeof data === "object" ? data as Record<string, unknown> : null;
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
    const closed = await closeDoorPayCode(supabase, deps, previous.id, "expired");
    if (closed === null) return jsonResponse({ error: "server_error" }, 500);
    if (closed === "paid" || closed === "payment_landing" || closed === "checking") {
      return jsonResponse({ error: "door_code_unavailable", status: closed }, 409);
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

  let status: string = effectiveDoorCodeStatus(row.status, row.expires_at, deps.now());
  if (status === "expired" && row.status !== "expired") {
    // Past its time: the same Stripe-first close as everything else, so a
    // guest's view can never kill a payment that is going through.
    const closed = await closeDoorPayCode(supabase, deps, row.id, "expired");
    status = closed ?? "checking";
    if (status === "not_found") return jsonResponse({ error: "not_found" }, 404);
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
  const latePayment = status === "expired" || status === "cancelled" || status === "failed"
    ? await readLatePayment(supabase, String(row.id))
    : null;

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
    // Only a closed code with money on it adds this: amount and refund state,
    // never who paid.
    ...(latePayment !== null ? { latePayment } : {}),
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
  const closed = await closeDoorPayCode(supabase, deps, String(row.id), "cancelled");
  if (closed === null) return jsonResponse({ error: "server_error" }, 500);
  if (closed === "paid") {
    return jsonResponse({ error: "door_code_unavailable", status: "paid" }, 409);
  }
  if (closed === "not_found") return jsonResponse({ error: "not_found" }, 404);
  // "payment_landing" and "checking" leave the code open and say so.
  return jsonResponse({ status: closed });
}

// The host's clock passed expires_at. Only the server may say what that means.
async function handleSettle(
  req: Request,
  body: Body,
  deps: DoorPayCodeDeps,
): Promise<Response> {
  const loaded = await loadCodeForActor(req, body, deps);
  if (!loaded.ok) return loaded.response;
  const { supabase, row } = loaded;
  const status = String(row.status);
  if (effectiveDoorCodeStatus(status, String(row.expires_at), deps.now()) !== "expired" ||
    status === "expired") {
    return jsonResponse({ status });
  }
  const closed = await closeDoorPayCode(supabase, deps, String(row.id), "expired");
  if (closed === null) return jsonResponse({ error: "server_error" }, 500);
  if (closed === "not_found") return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse({ status: closed });
}

// Cron only: closes codes past their time with the same Stripe-first order.
async function handleSweep(req: Request, deps: DoorPayCodeDeps): Promise<Response> {
  const expected = (deps.serviceRoleKey ?? (() => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")))();
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return jsonResponse({ error: "not_authorized" }, 401);
  }
  const supabase = deps.serviceClient();
  const { data, error } = await supabase.rpc("issue_4271_door_pay_codes_due", { p_limit: 50 });
  if (error) {
    console.error("[door-pay-code] sweep read failed", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const tally: Record<string, number> = {};
  for (const codeId of Array.isArray(data) ? data as string[] : []) {
    const closed = await closeDoorPayCode(supabase, deps, codeId, "expired") ?? "failed";
    tally[closed] = (tally[closed] ?? 0) + 1;
  }
  return jsonResponse({ swept: tally });
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
      case "settle":
        return await handleSettle(req, body, deps);
      case "sweep":
        return await handleSweep(req, deps);
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
