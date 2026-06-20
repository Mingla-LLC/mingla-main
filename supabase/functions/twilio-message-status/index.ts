import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ticketCorsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const sharedSecret = Deno.env.get("TWILIO_STATUS_CALLBACK_SECRET");
  if (sharedSecret && url.searchParams.get("secret") !== sharedSecret) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const form = await req.formData();
  const messageSid = String(form.get("MessageSid") ?? "");
  const status = String(form.get("MessageStatus") ?? form.get("SmsStatus") ?? "");
  if (!messageSid || !status) return jsonResponse({ error: "twilio_status_payload_invalid" }, 400);

  const payload: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    payload[key] = String(value);
  }

  const supabase = serviceClient();
  const { data: notification } = await supabase
    .from("ticket_order_notifications")
    .select("id")
    .eq("provider", "twilio")
    .eq("provider_message_id", messageSid)
    .maybeSingle();

  await supabase.from("twilio_message_status_events").insert({
    notification_id: notification?.id ?? null,
    message_sid: messageSid,
    message_status: status,
    raw_payload: payload,
  });

  if (notification?.id) {
    const delivered = status === "delivered";
    const failed = ["failed", "undelivered"].includes(status);
    await supabase.from("ticket_order_notifications").update({
      status: delivered ? "delivered" : failed ? "failed_terminal" : "sent",
      delivered_at: delivered ? new Date().toISOString() : undefined,
      last_error: failed ? (payload.ErrorMessage ?? status) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", notification.id);
  }

  // META-ORCH-1161 §5.6: ALSO reconcile the cross-channel delivery ledger keyed
  // by provider_message_id. Record SMS error codes (30034 unregistered 10DLC,
  // 30007 filtered/NG DND, 30032 toll-free not verified) into failed_reason for
  // the cost/deliverability alarm. Additive — does not touch the logic above.
  {
    const delivered = status === "delivered";
    const failed = ["failed", "undelivered"].includes(status);
    const errorCode = String(payload.ErrorCode ?? "").trim();
    const knownCodes = new Set(["30034", "30007", "30032"]);
    const failedReason = failed
      ? (knownCodes.has(errorCode)
          ? `twilio_${errorCode}:${payload.ErrorMessage ?? status}`
          : (payload.ErrorMessage ?? status))
      : null;
    const ledgerStatus = delivered ? "delivered" : failed ? "failed" : "sent";
    const { error: deliveryErr } = await supabase
      .from("notification_deliveries")
      .update({
        status: ledgerStatus,
        delivered_at: delivered ? new Date().toISOString() : null,
        failed_reason: failedReason,
      })
      .eq("provider_message_id", messageSid)
      .eq("channel", "sms");
    if (deliveryErr) {
      console.warn("[twilio-message-status] notification_deliveries reconcile note:", deliveryErr.message);
    }
  }

  return jsonResponse({ ok: true });
});
