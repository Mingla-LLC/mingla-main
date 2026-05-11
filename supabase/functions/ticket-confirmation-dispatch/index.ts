// ORCH-0785 — Buyer ticket confirmation dispatcher.
// Sends branded HTML email + PDF ticket attachments via Resend, and SMS via
// Twilio. Service-role auth + ledger transition + rollup recompute behaviour
// preserved from ORCH-0777 baseline. PDF render failure is RETRYABLE.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  classifyNotificationProviderFailure,
  jsonResponse,
  ProviderFailure,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
  type TicketBodyInput,
} from "../_shared/email/index.ts";
import { buildTicketPdf } from "../_shared/ticketPdf.ts";

class ProviderSendError extends Error {
  retryable: boolean;
  constructor(failure: ProviderFailure) {
    super(failure.detail);
    this.name = "ProviderSendError";
    this.retryable = failure.retryable;
  }
}

async function sendResendEmailWithAttachment(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: Array<{ filename: string; content: string }>;
}): Promise<{ id: string | null }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("resend_api_key_missing");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = classifyNotificationProviderFailure(
      "resend",
      response.status,
      json,
    );
    throw new ProviderSendError(failure);
  }
  return { id: typeof json.id === "string" ? json.id : null };
}

async function sendTwilioMessage(
  input: { to: string; body: string },
): Promise<{ sid: string | null }> {
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
    const failure = classifyNotificationProviderFailure(
      "twilio",
      response.status,
      json,
    );
    throw new ProviderSendError(failure);
  }
  return { sid: typeof json.sid === "string" ? json.sid : null };
}

interface OrderJoin {
  id: string;
  event_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  total_cents: number;
  currency: string;
  payment_method: string | null;
  payment_status: string | null;
  confirmed_at: string | null;
  notification_status: string | null;
  events: {
    id: string;
    title: string | null;
    cover_media_url: string | null;
    cover_media_type: string | null;
    location_text: string | null;
    is_online: boolean | null;
    timezone: string | null;
    brand_id: string;
    brands: {
      id: string;
      name: string | null;
      profile_photo_url: string | null;
    };
  };
}

interface RenderContext {
  bodyInput: TicketBodyInput;
  ticketsForPdf: Array<{
    ticketId: string;
    ticketName: string;
    qrPayload: string;
  }>;
}

function shortId(id: string): string {
  return String(id).slice(0, 8);
}

function buildRenderContext(args: {
  order: OrderJoin;
  lineItems: Array<{
    quantity: number | null;
    unit_price_cents: number | null;
    total_cents: number | null;
    ticket_types: { name: string | null };
  }>;
  ticketRows: Array<{
    id: string;
    qr_code: string;
    ticket_types: { name: string | null };
  }>;
  masterDate: {
    start_at: string | null;
    timezone: string | null;
  } | null;
}): RenderContext {
  const { order, lineItems, ticketRows, masterDate } = args;
  const eventTitle = order.events.title ?? "your event";
  const eventTimezone = (masterDate?.timezone && masterDate.timezone.length > 0
    ? masterDate.timezone
    : order.events.timezone) ?? "UTC";
  const variant: TicketBodyInput["variant"] = order.payment_method === "free"
    ? "ticket_confirmation_free"
    : "ticket_confirmation_paid";

  const bodyInput: TicketBodyInput = {
    variant,
    event: {
      title: eventTitle,
      coverMediaUrl: order.events.cover_media_url ?? null,
      coverMediaType: ((): "image" | "video" | "gif" | null => {
        const t = order.events.cover_media_type;
        if (t === "image" || t === "video" || t === "gif") return t;
        return null;
      })(),
      locationText: order.events.location_text ?? null,
      isOnline: Boolean(order.events.is_online),
      startAt: masterDate?.start_at ?? null,
      timezone: eventTimezone,
    },
    brand: {
      name: order.events.brands.name ?? "your host",
      profilePhotoUrl: order.events.brands.profile_photo_url ?? null,
    },
    order: {
      shortId: shortId(order.id),
      totalCents: Number(order.total_cents ?? 0),
      currency: order.currency ?? "GBP",
      buyerName: order.buyer_name,
      lineItems: (lineItems ?? []).map((li) => ({
        ticketName: li.ticket_types?.name ?? "Ticket",
        quantity: Number(li.quantity ?? 0),
        unitPriceCents: Number(li.unit_price_cents ?? 0),
        totalCents: Number(li.total_cents ?? 0),
      })),
      tickets: (ticketRows ?? []).map((t) => ({
        ticketId: t.id,
        ticketName: t.ticket_types?.name ?? "Ticket",
      })),
    },
  };

  const ticketsForPdf = (ticketRows ?? []).map((t) => ({
    ticketId: t.id,
    ticketName: t.ticket_types?.name ?? "Ticket",
    qrPayload: t.qr_code,
  }));

  return { bodyInput, ticketsForPdf };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!orderId) return jsonResponse({ error: "order_id_required" }, 400);

  const supabase = serviceClient();
  const { data: orderRaw, error: orderError } = await supabase
    .from("orders")
    .select(`
      id,
      event_id,
      buyer_name,
      buyer_email,
      total_cents,
      currency,
      payment_method,
      payment_status,
      confirmed_at,
      notification_status,
      events!inner (
        id,
        title,
        cover_media_url,
        cover_media_type,
        location_text,
        is_online,
        timezone,
        brand_id,
        brands!inner ( id, name, profile_photo_url )
      )
    `)
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !orderRaw) {
    return jsonResponse(
      { error: "order_not_found", detail: orderError?.message },
      404,
    );
  }
  const order = orderRaw as unknown as OrderJoin;

  const { data: lineItems } = await supabase
    .from("order_line_items")
    .select("quantity, unit_price_cents, total_cents, ticket_types!inner ( name )")
    .eq("order_id", orderId)
    .order("id", { ascending: true });

  const { data: ticketRows } = await supabase
    .from("tickets")
    .select("id, qr_code, ticket_types!inner ( name )")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  const { data: masterDate } = await supabase
    .from("event_dates")
    .select("start_at, end_at, timezone, is_master")
    .eq("event_id", order.events.id)
    .eq("is_master", true)
    .maybeSingle();

  const context = buildRenderContext({
    order,
    lineItems: (lineItems ?? []) as unknown as Array<{
      quantity: number | null;
      unit_price_cents: number | null;
      total_cents: number | null;
      ticket_types: { name: string | null };
    }>,
    ticketRows: (ticketRows ?? []) as unknown as Array<{
      id: string;
      qr_code: string;
      ticket_types: { name: string | null };
    }>,
    masterDate: (masterDate ?? null) as
      | { start_at: string | null; timezone: string | null }
      | null,
  });

  const ticketCount = context.bodyInput.order.tickets.length;
  const eventTitle = context.bodyInput.event.title;
  const smsBody = `Mingla: your ${ticketCount} ticket${
    ticketCount === 1 ? "" : "s"
  } for ${eventTitle} are confirmed. Order ${shortId(order.id)}.`;

  // Render email + PDF once per dispatch; reused across email ledger rows.
  let renderedEmail: ReturnType<typeof renderTransactionalEmail> | null = null;
  let renderedPdf: Awaited<ReturnType<typeof buildTicketPdf>> | null = null;
  let renderError: { code: string; message: string } | null = null;

  try {
    renderedEmail = renderTransactionalEmail({
      variant: context.bodyInput.variant,
      recipient: {
        name: order.buyer_name,
        email: order.buyer_email ?? "",
      },
      body: context.bodyInput,
    });
    assertNotResendSandbox(renderedEmail.from);
    renderedPdf = await buildTicketPdf({
      event: {
        title: context.bodyInput.event.title,
        startAtIso: context.bodyInput.event.startAt,
        timezone: context.bodyInput.event.timezone,
        locationText: context.bodyInput.event.locationText,
        brandName: context.bodyInput.brand.name,
      },
      order: { shortId: context.bodyInput.order.shortId },
      tickets: context.ticketsForPdf,
      attendeeNameHint: order.buyer_name,
    });
    console.log(
      `[ticket-confirmation-dispatch] order=${context.bodyInput.order.shortId} html_bytes=${renderedEmail.html.length} pdf_bytes=${renderedPdf.byteLength}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderError = {
      code: message.startsWith("ticket_pdf_")
        ? message
        : `email_render_input_incomplete:${message}`,
      message,
    };
  }

  const { data: notifications, error: notificationError } = await supabase
    .from("ticket_order_notifications")
    .select("id, channel, recipient, status, attempt_count")
    .eq("order_id", orderId)
    .in("status", ["pending", "failed_retryable"]);
  if (notificationError) {
    return jsonResponse(
      {
        error: "notification_lookup_failed",
        detail: notificationError.message,
      },
      500,
    );
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
        if (!renderedEmail || !renderedPdf) {
          // Render failure surfaces as retryable. Either render input is
          // transiently incomplete (missing event/brand row) or the PDF
          // library hit a recoverable issue.
          throw new ProviderSendError({
            retryable: true,
            detail: renderError?.code ?? "email_render_unknown_failure",
            status: 0,
          });
        }
        const sent = await sendResendEmailWithAttachment({
          from: formatSenderHeader(renderedEmail.from),
          to: notification.recipient,
          subject: renderedEmail.subject,
          html: renderedEmail.html,
          text: renderedEmail.text,
          attachments: [{
            filename: renderedPdf.filename,
            content: renderedPdf.contentBase64,
          }],
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
      outcomes.push({
        channel: notification.channel,
        status: terminal ? "failed_terminal" : "failed_retryable",
      });
    }
  }

  const failed = outcomes.some((row) => row.status.startsWith("failed"));
  const sent = outcomes.some((row) => row.status === "sent");
  await supabase.from("orders").update({
    notification_status: failed ? (sent ? "partial" : "failed") : "sent",
    updated_at: new Date().toISOString(),
  }).eq("id", orderId);

  // EMAIL_SENDERS reference kept live so dead-code elimination can't drop it.
  void EMAIL_SENDERS;

  return jsonResponse({ orderId, outcomes });
});
