// Issue #4271 — door-pay-code. The host makes a one-time pay code for one door
// sale; the guest opens it on their own phone and pays through the normal
// online checkout (ticket-checkout-create with body.doorCode).
//
// verify_jwt = false at the gateway: `view` is public (the guest has no Mingla
// account). `create`, `cancel` and `text_link` verify the bearer in code and
// require issue_4271_can_take_door_payment for the event.
//
// A code is a pay link, never a ticket credential. The server always prices.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
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
}

const defaultDeps: DoorPayCodeDeps = {
  serviceClient,
  userIdFromAuthHeader,
  now: () => Date.now(),
  generateCode: () => generateDoorCode(),
};

type Body = Record<string, unknown>;

// deno-lint-ignore no-explicit-any
type Client = any;


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
    await supabase.from("door_pay_codes")
      .update({ status: "expired", updated_at: new Date(deps.now()).toISOString() })
      .eq("id", row.id)
      .in("status", ["open", "opened"]);
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
  const { data: updated, error } = await supabase.from("door_pay_codes")
    .update({ status: "cancelled", updated_at: new Date(deps.now()).toISOString() })
    .eq("id", row.id)
    .in("status", ["open", "opened", "expired", "failed"])
    .select("status")
    .maybeSingle();
  if (error) return jsonResponse({ error: "server_error" }, 500);
  if (!updated) {
    // Paid between the read and the write, or already cancelled.
    const { data: now } = await supabase.from("door_pay_codes")
      .select("status").eq("id", row.id).maybeSingle();
    if (now?.status === "paid") {
      return jsonResponse({ error: "door_code_unavailable", status: "paid" }, 409);
    }
  }
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
