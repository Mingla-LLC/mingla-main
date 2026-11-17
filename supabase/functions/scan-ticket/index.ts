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
};

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
    const scan = data as Record<string, unknown> | null;
    const orderId = typeof scan?.orderId === "string" ? scan.orderId : null;
    if (scan !== null && orderId !== null) {
      const deadline = new AbortController();
      const timer = setTimeout(
        () => deadline.abort(),
        deps.deadlineMs ?? DOOR_EXTRAS_DEADLINE_MS,
      );
      try {
        const [extras, booked] = await Promise.all([
          readScanExtras(supabase, userData.user.id, eventId, orderId, deadline.signal),
          readBookedStart(supabase, eventId, orderId, deadline.signal),
        ]);
        return jsonResponse(withDoorFields(scan, extras, booked));
      } finally {
        clearTimeout(timer);
      }
    }

    return jsonResponse(data);
  };
}

export const handler = createHandler({
  client: () => serviceClient() as unknown as ScanTicketClient,
  pepper: qrTokenPepper,
});

if (import.meta.main) serve(handler);
