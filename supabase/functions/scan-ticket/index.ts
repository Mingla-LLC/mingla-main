import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  qrTokenPepper,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

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

  return jsonResponse(data);
});
