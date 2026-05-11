import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  classifyNotificationProviderFailure,
  jsonResponse,
  ProviderFailure,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ id: string | null }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("resend_api_key_missing");
  const from = Deno.env.get("RESEND_TICKET_FROM") ?? "Mingla <tickets@usemingla.com>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = classifyNotificationProviderFailure("resend", response.status, json);
    throw new ProviderSendError(failure);
  }
  return { id: typeof json.id === "string" ? json.id : null };
}

async function sendTwilioMessage(input: { to: string; body: string }): Promise<{ sid: string | null }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error("twilio_env_missing");
  }
  const statusSecret = Deno.env.get("TWILIO_STATUS_CALLBACK_SECRET");
  const statusCallback = statusSecret && Deno.env.get("SUPABASE_URL")
    ? `${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-message-status?secret=${encodeURIComponent(statusSecret)}`
    : undefined;
  const params = new URLSearchParams({
    To: input.to,
    MessagingServiceSid: messagingServiceSid,
    Body: input.body,
  });
  if (statusCallback) params.set("StatusCallback", statusCallback);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = classifyNotificationProviderFailure("twilio", response.status, json);
    throw new ProviderSendError(failure);
  }
  return { sid: typeof json.sid === "string" ? json.sid : null };
}

class ProviderSendError extends Error {
  retryable: boolean;

  constructor(failure: ProviderFailure) {
    super(failure.detail);
    this.name = "ProviderSendError";
    this.retryable = failure.retryable;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ticketCorsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!orderId) return jsonResponse({ error: "order_id_required" }, 400);

  const supabase = serviceClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, event_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, events(title, slug)")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) {
    return jsonResponse({ error: "order_not_found", detail: orderError?.message }, 404);
  }

  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, qr_code, ticket_types(name)")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  const ticketCount = tickets?.length ?? 0;
  const eventTitle = (order.events as { title?: string } | null)?.title ?? "your event";
  const subject = `Your Mingla tickets for ${eventTitle}`;
  const html = [
    `<p>Hi ${order.buyer_name ?? "there"},</p>`,
    `<p>Your ${ticketCount} ticket${ticketCount === 1 ? "" : "s"} for <strong>${eventTitle}</strong> are confirmed.</p>`,
    `<p>Order: ${order.id}</p>`,
    `<p>Open the Mingla confirmation screen for QR codes. Keep this email for your records.</p>`,
  ].join("");
  const smsBody = `Mingla: your ${ticketCount} ticket${ticketCount === 1 ? "" : "s"} for ${eventTitle} are confirmed. Order ${String(order.id).slice(0, 8)}.`;

  const { data: notifications, error: notificationError } = await supabase
    .from("ticket_order_notifications")
    .select("id, channel, recipient, status, attempt_count")
    .eq("order_id", orderId)
    .in("status", ["pending", "failed_retryable"]);
  if (notificationError) {
    return jsonResponse({ error: "notification_lookup_failed", detail: notificationError.message }, 500);
  }

  const outcomes: Array<{ channel: string; status: string }> = [];
  for (const notification of notifications ?? []) {
    await supabase
      .from("ticket_order_notifications")
      .update({
        status: "sending",
        attempt_count: Number(notification.attempt_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", notification.id);
    try {
      if (notification.channel === "email") {
        const sent = await sendResendEmail({
          to: notification.recipient,
          subject,
          html,
        });
        await supabase.from("ticket_order_notifications").update({
          status: "sent",
          provider: "resend",
          provider_message_id: sent.id,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
      } else {
        const sent = await sendTwilioMessage({
          to: notification.recipient,
          body: smsBody,
        });
        await supabase.from("ticket_order_notifications").update({
          status: "sent",
          provider: "twilio",
          provider_message_id: sent.sid,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
      }
      outcomes.push({ channel: notification.channel, status: "sent" });
    } catch (err) {
      const attemptCount = Number(notification.attempt_count ?? 0) + 1;
      const retryable = err instanceof ProviderSendError ? err.retryable : true;
      const terminal = !retryable || attemptCount >= 3;
      await supabase.from("ticket_order_notifications").update({
        status: terminal ? "failed_terminal" : "failed_retryable",
        last_error: err instanceof Error ? err.message : String(err),
        updated_at: new Date().toISOString(),
      }).eq("id", notification.id);
      outcomes.push({ channel: notification.channel, status: terminal ? "failed_terminal" : "failed_retryable" });
    }
  }

  const failed = outcomes.some((row) => row.status.startsWith("failed"));
  const sent = outcomes.some((row) => row.status === "sent");
  await supabase.from("orders").update({
    notification_status: failed ? (sent ? "partial" : "failed") : "sent",
    updated_at: new Date().toISOString(),
  }).eq("id", orderId);

  return jsonResponse({ orderId, outcomes });
});
