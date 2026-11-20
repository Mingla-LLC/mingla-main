import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  qrTokenPepper,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import {
  type DoorReadClient,
  readBookedStart,
  readDoorAnswers,
  readScanExtras,
  withDoorFields,
} from "../_shared/doorBookedStart.ts";

// issue #3281 — how long a scan waits for its optional door fields (extras
// still owed, the booked start) before the door gets the recorded scan
// without them.
export const DOOR_EXTRAS_DEADLINE_MS = 1500;

/** The service client, as narrowly as this function uses it. */
export type ScanTicketClient = DoorReadClient & {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
};

export type ScanTicketDeps = {
  client: () => ScanTicketClient;
  pepper: () => string;
  deadlineMs?: number;
  now?: () => number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// #4514 wave 6 — "See all answers" opens the full answers only for a ticket
// this same person scanned at this event, recently, and that the door let in
// (or had already let in). The SQL read checks door authority, the host switch,
// rank, one current guest of this event, the rate limit and logs the read.
export const DOOR_FULL_ANSWERS_WINDOW_MS = 30 * 60 * 1000;
const ADMITTED = new Set(["success", "duplicate"]);

type QueryResult = { data: unknown; error: unknown };

async function doorFullAnswers(
  supabase: ScanTicketClient,
  actorId: string,
  body: Record<string, unknown>,
  now: () => number,
): Promise<Response> {
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const scanId = typeof body.scanId === "string" ? body.scanId : "";
  if (!UUID.test(eventId) || !UUID.test(scanId)) {
    return jsonResponse({ error: "door_answers_payload_required" }, 400);
  }
  const scan = await supabase
    .from("scan_events")
    .select("ticket_id, event_id, scanner_user_id, scan_result, scanned_at")
    .eq("id", scanId)
    .maybeSingle() as QueryResult;
  if (scan.error) {
    console.error("[scan-ticket] door answers scan read failed");
    return jsonResponse({ error: "door_answers_failed" }, 500);
  }
  const row = scan.data as {
    ticket_id?: unknown;
    event_id?: unknown;
    scanner_user_id?: unknown;
    scan_result?: unknown;
    scanned_at?: unknown;
  } | null;
  const scannedAt = typeof row?.scanned_at === "string" ? Date.parse(row.scanned_at) : NaN;
  if (
    row === null || row.scanner_user_id !== actorId || row.event_id !== eventId ||
    typeof row.scan_result !== "string" || !ADMITTED.has(row.scan_result) ||
    typeof row.ticket_id !== "string" || Number.isNaN(scannedAt) ||
    now() - scannedAt > DOOR_FULL_ANSWERS_WINDOW_MS
  ) {
    // One answer for every refusal: never says whether a scan exists.
    return jsonResponse({ error: "door_answers_scan_required" }, 403);
  }
  const ticket = await supabase
    .from("tickets")
    .select("order_id")
    .eq("id", row.ticket_id)
    .eq("event_id", eventId)
    .maybeSingle() as QueryResult;
  const orderId = (ticket.data as { order_id?: unknown } | null)?.order_id;
  if (ticket.error || typeof orderId !== "string") {
    console.error("[scan-ticket] door answers ticket read failed");
    return jsonResponse({ error: "door_answers_failed" }, 500);
  }
  const { data, error } = await supabase.rpc("brand_form_door_full_answers", {
    p_actor_id: actorId,
    p_event_id: eventId,
    p_subject: { kind: "order", id: orderId, ticketId: row.ticket_id },
    p_via: "scan",
  });
  if (error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (/forbidden|subject_other_event|subject_not_current/.test(message)) {
      return jsonResponse({ error: "door_answers_forbidden" }, 403);
    }
    console.error("[scan-ticket] door answers read failed");
    return jsonResponse({ error: "door_answers_failed" }, 500);
  }
  return jsonResponse(data ?? { state: "no_form" });
}

export function createHandler(deps: ScanTicketDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: ticketCorsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    const authorization = req.headers.get("authorization");
    if (!authorization) return jsonResponse({ error: "auth_required" }, 401);

    const supabase = deps.client();
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ error: "auth_required" }, 401);

    const body = await req.json().catch(() => ({}));
    if (body !== null && typeof body === "object" && body.action === "door_full_answers") {
      return await doorFullAnswers(supabase, userData.user.id, body, deps.now ?? Date.now);
    }
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const qrPayload = typeof body.qrPayload === "string" ? body.qrPayload : "";
    if (!eventId || !qrPayload) return jsonResponse({ error: "scan_payload_required" }, 400);

    let qrPepper: string;
    try {
      qrPepper = deps.pepper();
    } catch {
      return jsonResponse({ error: "qr_token_pepper_missing" }, 500);
    }

    const { data, error } = await supabase.rpc("biz_ticket_scan", {
      p_event_id: eventId,
      p_qr_payload: qrPayload,
      p_scanner_user_id: userData.user.id,
      p_qr_token_pepper: qrPepper,
    });
    if (error) {
      const message = String((error as { message?: unknown }).message ?? "");
      const status = message.includes("scanner_not_authorized") ? 403 : 400;
      return jsonResponse({ error: "scan_failed", detail: message }, status);
    }

    // issue #3281 — the extras this order still owes and the start the guest
    // booked, for the door. Both optional, read side by side and each failing
    // on its own (the readers never throw): the scan is already recorded, so a
    // slow or failed read never changes the answer, and an order with neither
    // keeps the body byte-identical. The booked-start read is pinned to this
    // event: on `wrong_event` the RPC names another event's order.
    //
    // #4514 §6 — the guest's door line rides alongside, inside the same
    // deadline, only for a ticket the door let in (or had let in). It can
    // never change the scan result: a failed or slow read is "unavailable".
    const scan = data as Record<string, unknown> | null;
    const orderId = typeof scan?.orderId === "string" ? scan.orderId : null;
    const admitted = typeof scan?.result === "string" && ADMITTED.has(scan.result);
    const ticketId = typeof scan?.ticketId === "string" ? scan.ticketId : null;
    if (scan !== null && orderId !== null) {
      const deadline = new AbortController();
      const timer = setTimeout(
        () => deadline.abort(),
        deps.deadlineMs ?? DOOR_EXTRAS_DEADLINE_MS,
      );
      try {
        const [extras, booked, doorAnswers] = await Promise.all([
          readScanExtras(supabase, userData.user.id, eventId, orderId, deadline.signal),
          readBookedStart(supabase, eventId, orderId, deadline.signal),
          admitted
            ? readDoorAnswers(supabase, userData.user.id, eventId, orderId, ticketId, deadline.signal)
            : Promise.resolve(null),
        ]);
        return jsonResponse(withDoorFields(scan, extras, booked, doorAnswers));
      } finally {
        clearTimeout(timer);
      }
    }

    return jsonResponse(data);
  };
}

export const handler = createHandler({
  client: () => serviceClient() as unknown as ScanTicketClient,
  pepper: () => qrTokenPepper(),
});

if (import.meta.main) serve(handler);
