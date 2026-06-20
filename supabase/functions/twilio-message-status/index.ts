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

  // META-ORCH-1161 Sub-B (§6.9 deliverability): reconcile MARKETING SMS by
  // provider_message_id and auto-suppress hard failures. A delivered status
  // upgrades the marketing_messages row; a failed/undelivered marks it failed
  // with the Twilio error and — for opt-out / unreachable codes — writes a
  // channel_suppressions(channel='sms', scope='marketing') row so we never text
  // that number again (R-2/R-6). Additive; does not touch the logic above.
  {
    const delivered = status === "delivered";
    const failed = ["failed", "undelivered"].includes(status);
    if (delivered || failed) {
      const errorCode = String(payload.ErrorCode ?? "").trim();
      const { data: mktRows, error: mktErr } = await supabase
        .from("marketing_messages")
        .select("id, recipient_phone, status")
        .eq("provider_message_id", messageSid)
        .eq("channel", "sms");
      if (mktErr) {
        console.warn("[twilio-message-status] marketing_messages lookup note:", mktErr.message);
      } else {
        for (const row of (mktRows ?? []) as Array<{ id: string; recipient_phone: string | null; status: string }>) {
          await supabase
            .from("marketing_messages")
            .update({
              status: delivered ? "delivered" : "failed",
              delivered_at: delivered ? new Date().toISOString() : null,
              failure_reason: failed ? (payload.ErrorMessage ?? `twilio_${errorCode || status}`) : null,
            })
            .eq("id", row.id);

          // Hard-failure / opt-out codes → auto-suppress the phone for marketing
          // SMS (21610 opted-out, 30007 filtered/DND, 30034 unregistered, 30032
          // toll-free unverified, 21211 invalid number). Suppress on these so a
          // bad/opted-out number is never retried (TCPA + deliverability hygiene).
          const hardSuppressCodes = new Set(["21610", "30007", "30034", "30032", "21211"]);
          if (failed && row.recipient_phone !== null && hardSuppressCodes.has(errorCode)) {
            const reason = errorCode === "21610" ? "stop_keyword" : "twilio_blacklist";
            // The channel_suppressions unique index is expression-based
            // (COALESCE(user_id::text, contact), channel, scope, COALESCE(...)),
            // so PostgREST onConflict can't target it by column name. Guard with
            // an existence check, then insert — idempotent across re-deliveries.
            const { data: existing } = await supabase
              .from("channel_suppressions")
              .select("id")
              .eq("contact", row.recipient_phone)
              .eq("channel", "sms")
              .eq("scope", "marketing")
              .is("brand_id", null)
              .maybeSingle();
            if (existing === null) {
              const { error: suppErr } = await supabase
                .from("channel_suppressions")
                .insert({
                  contact: row.recipient_phone,
                  channel: "sms",
                  scope: "marketing",
                  reason,
                });
              if (suppErr) {
                console.warn("[twilio-message-status] marketing suppress note:", suppErr.message);
              }
            }
          }
        }
      }
    }
  }

  return jsonResponse({ ok: true });
});
