import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  qrTokenPepper,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

// issue #3281 — how long a scan waits for its optional extras before the
// door gets the recorded scan without them.
const DOOR_EXTRAS_DEADLINE_MS = 1500;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ticketCorsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("authorization");
  if (!authorization) return jsonResponse({ error: "auth_required" }, 401);

  const supabase = serviceClient();
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse({ error: "auth_required" }, 401);

  const body = await req.json().catch(() => ({}));
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const qrPayload = typeof body.qrPayload === "string" ? body.qrPayload : "";
  if (!eventId || !qrPayload) return jsonResponse({ error: "scan_payload_required" }, 400);

  let qrPepper: string;
  try {
    qrPepper = qrTokenPepper();
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
    const status = error.message.includes("scanner_not_authorized") ? 403 : 400;
    return jsonResponse({ error: "scan_failed", detail: error.message }, status);
  }

  // issue #3281 — the extras this order still owes, for the door. Optional:
  // the scan is already recorded, so a slow or failed read never changes the
  // answer (it gets DOOR_EXTRAS_DEADLINE_MS, then the scan goes back as is),
  // and an order without extras keeps the body byte-identical.
  const scan = data as Record<string, unknown> | null;
  const orderId = typeof scan?.orderId === "string" ? scan.orderId : null;
  if (scan !== null && orderId !== null) {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), DOOR_EXTRAS_DEADLINE_MS);
    try {
      const extras = await supabase
        .rpc("issue_3281_door_order_extras", {
          p_actor_id: userData.user.id,
          p_event_id: eventId,
          p_order_ids: [orderId],
        })
        .abortSignal(deadline.signal);
      if (extras.error) {
        console.error("[scan-ticket] door extras unavailable");
      } else {
        const items = (extras.data as Record<string, unknown> | null)?.[orderId];
        if (Array.isArray(items) && items.length > 0) {
          return jsonResponse({ ...scan, extras: items });
        }
      }
    } catch {
      console.error("[scan-ticket] door extras unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  return jsonResponse(data);
});
