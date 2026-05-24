import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

interface WaitlistSignupBody {
  event_id?: unknown;
  ticket_type_id?: unknown;
  email?: unknown;
  phone?: unknown;
  name?: unknown;
  qty_requested?: unknown;
  consent?: unknown;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const cleaned = cleanString(value);
  if (cleaned === null) return null;
  return cleaned.toLowerCase();
}

function parseQty(value: unknown): number | null {
  if (!Number.isInteger(value)) return null;
  const qty = Number(value);
  if (qty < 1 || qty > 20) return null;
  return qty;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: WaitlistSignupBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "invalid_input", detail: "Invalid JSON" },
      400,
    );
  }

  const eventId = cleanString(body.event_id);
  const ticketTypeId = cleanString(body.ticket_type_id);
  const email = normalizeEmail(body.email);
  const phone = cleanString(body.phone);
  const name = cleanString(body.name);
  const qtyRequested = parseQty(body.qty_requested);

  if (eventId === null || ticketTypeId === null) {
    return jsonResponse(
      {
        error: "invalid_input",
        detail: "event_id and ticket_type_id are required",
      },
      400,
    );
  }
  if (!UUID_RE.test(eventId) || !UUID_RE.test(ticketTypeId)) {
    return jsonResponse(
      {
        error: "invalid_input",
        detail: "event_id and ticket_type_id must be UUIDs",
      },
      400,
    );
  }
  if (body.consent !== true) {
    return jsonResponse(
      { error: "invalid_input", detail: "Consent is required" },
      400,
    );
  }
  if (qtyRequested === null) {
    return jsonResponse(
      {
        error: "invalid_input",
        detail: "qty_requested must be an integer from 1 to 20",
      },
      400,
    );
  }
  if (email === null && phone === null) {
    return jsonResponse({ error: "missing_contact" }, 422);
  }
  if (email !== null && !EMAIL_RE.test(email)) {
    return jsonResponse(
      { error: "invalid_input", detail: "Email address is invalid" },
      400,
    );
  }

  const supabase = serviceClient();
  const { data: ticketType, error: ticketTypeError } = await supabase
    .from("ticket_types")
    .select("id")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .eq("waitlist_enabled", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (ticketTypeError !== null) {
    console.error("[waitlist-signup] ticket type lookup failed", {
      event_id: eventId,
      ticket_type_id: ticketTypeId,
    });
    return jsonResponse({ error: "internal" }, 500);
  }
  if (ticketType === null) {
    console.info("[waitlist-signup] rejected", {
      event_id: eventId,
      ticket_type_id: ticketTypeId,
      outcome: "ticket_type_not_found_or_waitlist_disabled",
    });
    return jsonResponse(
      { error: "ticket_type_not_found_or_waitlist_disabled" },
      404,
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("waitlist_entries")
    .insert({
      event_id: eventId,
      ticket_type_id: ticketTypeId,
      email,
      phone,
      name,
      qty_requested: qtyRequested,
      status: "waiting",
      source: "buyer_web",
      consent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError === null && inserted !== null) {
    console.info("[waitlist-signup] created", {
      event_id: eventId,
      ticket_type_id: ticketTypeId,
      outcome: "waiting",
    });
    return jsonResponse({
      ok: true,
      waitlist_entry_id: inserted.id,
      status: "waiting",
    });
  }

  if (insertError?.code === "23505") {
    let query = supabase
      .from("waitlist_entries")
      .select("id")
      .eq("ticket_type_id", ticketTypeId)
      .in("status", ["waiting", "invited"])
      .limit(1);
    if (email !== null) {
      query = query.ilike("email", email);
    } else if (phone !== null) {
      query = query.eq("phone", phone);
    }
    const { data: existing } = await query.maybeSingle();
    const existingId = existing?.id;
    console.info("[waitlist-signup] dedupe", {
      event_id: eventId,
      ticket_type_id: ticketTypeId,
      outcome: "already_waiting",
    });
    return jsonResponse(
      {
        error: "already_waiting",
        waitlist_entry_id: typeof existingId === "string" ? existingId : null,
      },
      409,
    );
  }

  console.error("[waitlist-signup] insert failed", {
    event_id: eventId,
    ticket_type_id: ticketTypeId,
  });
  return jsonResponse({ error: "internal" }, 500);
});
