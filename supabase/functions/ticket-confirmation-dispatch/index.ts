// ORCH-0788 — Buyer notification dispatcher (formerly ORCH-0785
// "ticket confirmation" dispatcher).
//
// Routes by `payload->>'template_key'` per notification row:
//   - NULL or missing → "buyer_ticket_confirmation" (legacy default,
//     preserves the W1 enqueue path from biz_ticket_checkout_finalize_session
//     which never sets template_key). Renders ticket body + PDF + .ics
//     attachment exactly as the ORCH-0785 baseline did.
//   - "buyer_refund_issued" → renders refund notification via
//     refundIssuedToGenericBody adapter through the existing
//     generic_notification variant; sender override to EMAIL_SENDERS.tickets.
//     No PDF, no calendar.
//   - "buyer_order_cancelled" → same shape with cancel adapter.
//   - "waitlist_spot_open" → renders a no-attachment claim-link email/SMS
//     for waitlist_entries rows whose notification has no parent order.
//   - Unknown template_key → immediate failed_terminal with
//     last_error="unknown_template_key:<value>" (defensive, I-PROPOSED-BA).
//
// Per SPEC §5.4: NO new EmailVariant union members. Refund/cancel ride
// through the existing generic_notification variant using adapter
// functions and a sender override.
//
// Service-role auth + ledger transition + rollup recompute behaviour
// preserved from ORCH-0777 baseline. PDF render failure remains RETRYABLE.

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
// ORCH-0859 (Tr2): trip-shaped confirmation email helper. Used only when
// event_type='trip' — event_type='event' path unchanged.
import { renderTripConfirmationEmail } from "../_shared/email/tripConfirmationEmail.ts";
import { buildCalendarLinks } from "../_shared/email/calendar.ts";
// ORCH-0869 (Tr3) Stage 1b: installment-kind renderers. Routed via body.kind
// from installmentWebhookHandlers.ts and process-scheduled-installments.
import { renderInstallmentDunningEmail } from "../_shared/email/installmentDunningEmail.ts";
import { renderInstallmentPlanPaidInFullEmail } from "../_shared/email/installmentPlanPaidInFullEmail.ts";
import { renderWaitlistSpotOpenEmail } from "../_shared/email/templates/waitlistSpotOpen.ts";
import { renderWaitlistSpotOpenSms } from "../_shared/sms/templates/waitlistSpotOpen.ts";
import {
  type BuyerContext,
  type IntakeFormReAnswerRequiredPayloadShape,
  intakeFormReAnswerRequiredToGenericBody,
  type OrderCancelledPayloadShape,
  orderCancelledToGenericBody,
  type RefundIssuedPayloadShape,
  refundIssuedToGenericBody,
} from "../_shared/email/buyerLifecycleAdapters.ts";

const MINGLA_LOGO_URL = Deno.env.get("MINGLA_LOGO_URL") ?? null;

function icsToBase64(ics: string): string {
  const bytes = new TextEncoder().encode(ics);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

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
    ? `${
      Deno.env.get("SUPABASE_URL")
    }/functions/v1/twilio-message-status?secret=${
      encodeURIComponent(statusSecret)
    }`
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
    // ORCH-0859 (Tr2): event_type discriminator + theme jsonb for trip-specific
    // confirmation branching. event_type='trip' rows carry trip details in
    // theme.business_trip.{startAt,endAt,destinationLocationText,capacity}.
    event_type: string | null;
    theme: Record<string, unknown> | null;
    brands: {
      id: string;
      name: string | null;
      profile_photo_url: string | null;
      // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]: brand contact_email
      // surfaced to refund/cancel email body adapters via BuyerContext.organizerEmail.
      contact_email: string | null;
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

interface NotificationRow {
  id: string;
  channel: string;
  recipient: string;
  status: string;
  attempt_count: number | null;
  payload: Record<string, unknown> | null;
}

function shortId(id: string): string {
  return String(id).slice(0, 8);
}

function publicBuyerBaseUrl(): string {
  const raw = Deno.env.get("PUBLIC_BUYER_BASE_URL") ??
    Deno.env.get("MINGLA_BUSINESS_WEB_URL") ??
    "https://business.usemingla.com";
  return raw.replace(/\/+$/, "");
}

async function markNotificationTerminal(
  supabase: ReturnType<typeof serviceClient>,
  notificationId: string,
  lastError: string,
): Promise<void> {
  await supabase.from("ticket_order_notifications").update({
    status: "failed_terminal",
    last_error: lastError,
    updated_at: new Date().toISOString(),
  }).eq("id", notificationId);
}

async function deliverWaitlistSpotOpenNotification(
  supabase: ReturnType<typeof serviceClient>,
  notification: NotificationRow,
): Promise<"sent" | "failed_terminal" | "skipped"> {
  const payload = notification.payload ?? {};
  const waitlistEntryId = typeof payload.waitlist_entry_id === "string"
    ? payload.waitlist_entry_id
    : "";
  const eventId = typeof payload.event_id === "string" ? payload.event_id : "";
  const ticketTypeId = typeof payload.ticket_type_id === "string"
    ? payload.ticket_type_id
    : "";
  const qtyRequested = Number.isInteger(payload.qty_requested)
    ? Number(payload.qty_requested)
    : 1;
  const inviteExpiresAt = typeof payload.invite_expires_at === "string"
    ? payload.invite_expires_at
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  if (!waitlistEntryId || !eventId || !ticketTypeId) {
    await markNotificationTerminal(
      supabase,
      notification.id,
      "waitlist_payload_invalid",
    );
    return "failed_terminal";
  }

  const { data: eventRaw, error: eventError } = await supabase
    .from("events")
    .select("id,title,brands!inner(id,name)")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError !== null || eventRaw === null) {
    throw new ProviderSendError({
      retryable: true,
      detail: eventError?.message ?? "waitlist_event_not_found",
      status: 0,
    });
  }

  const { data: ticketTypeRaw, error: ticketTypeError } = await supabase
    .from("ticket_types")
    .select("id,name")
    .eq("id", ticketTypeId)
    .maybeSingle();
  if (ticketTypeError !== null || ticketTypeRaw === null) {
    throw new ProviderSendError({
      retryable: true,
      detail: ticketTypeError?.message ?? "waitlist_ticket_type_not_found",
      status: 0,
    });
  }

  const event = eventRaw as unknown as {
    title: string | null;
    brands: { name: string | null };
  };
  const ticketType = ticketTypeRaw as unknown as { name: string | null };
  const claimUrl = `${publicBuyerBaseUrl()}/checkout/${eventId}?wl=${
    encodeURIComponent(waitlistEntryId)
  }`;

  if (notification.channel === "email") {
    const email = renderWaitlistSpotOpenEmail({
      brand: { name: event.brands.name ?? "Mingla" },
      event: { title: event.title ?? "your event" },
      ticketType: { name: ticketType.name ?? "ticket" },
      qtyRequested,
      expiresAt: inviteExpiresAt,
      claimUrl,
    });
    assertNotResendSandbox(EMAIL_SENDERS.tickets);
    const sent = await sendResendEmailWithAttachment({
      from: formatSenderHeader(EMAIL_SENDERS.tickets),
      to: notification.recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [],
    });
    await supabase.from("ticket_order_notifications").update({
      status: "sent",
      provider: "resend",
      provider_message_id: sent.id,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", notification.id);
    return "sent";
  }

  if (notification.channel === "sms") {
    const sent = await sendTwilioMessage({
      to: notification.recipient,
      body: renderWaitlistSpotOpenSms({
        eventTitle: event.title ?? "your event",
        ticketTypeName: ticketType.name ?? "ticket",
        claimUrl,
      }),
    });
    await supabase.from("ticket_order_notifications").update({
      status: "sent",
      provider: "twilio",
      provider_message_id: sent.sid,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", notification.id);
    return "sent";
  }

  await supabase.from("ticket_order_notifications").update({
    status: "skipped",
    last_error: "channel_not_supported_for_template",
    updated_at: new Date().toISOString(),
  }).eq("id", notification.id);
  return "skipped";
}

async function handleWaitlistNotificationDispatch(
  supabase: ReturnType<typeof serviceClient>,
  notificationId: string,
): Promise<Response> {
  const { data, error } = await supabase
    .from("ticket_order_notifications")
    .select("id, channel, recipient, status, attempt_count, payload")
    .eq("id", notificationId)
    .maybeSingle();
  if (error !== null || data === null) {
    return jsonResponse(
      { error: "notification_not_found", detail: error?.message },
      404,
    );
  }

  const notification = data as unknown as NotificationRow;
  const rawPayload = notification.payload ?? {};
  if (rawPayload.template_key !== "waitlist_spot_open") {
    await markNotificationTerminal(
      supabase,
      notification.id,
      `unknown_template_key:${String(rawPayload.template_key)}`,
    );
    return jsonResponse({
      notificationId,
      outcomes: [{
        channel: notification.channel,
        status: "failed_terminal",
        templateKey: String(rawPayload.template_key),
      }],
    });
  }

  await supabase
    .from("ticket_order_notifications")
    .update({
      status: "sending",
      attempt_count: Number(notification.attempt_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", notification.id);

  try {
    const status = await deliverWaitlistSpotOpenNotification(
      supabase,
      notification,
    );
    return jsonResponse({
      notificationId,
      outcomes: [{
        channel: notification.channel,
        status,
        templateKey: "waitlist_spot_open",
      }],
    });
  } catch (err) {
    const attemptCount = Number(notification.attempt_count ?? 0) + 1;
    const retryable = err instanceof ProviderSendError ? err.retryable : true;
    const terminal = !retryable || attemptCount >= 3;
    await supabase.from("ticket_order_notifications").update({
      status: terminal ? "failed_terminal" : "failed_retryable",
      last_error: err instanceof Error ? err.message : String(err),
      updated_at: new Date().toISOString(),
    }).eq("id", notification.id);
    return jsonResponse({
      notificationId,
      outcomes: [{
        channel: notification.channel,
        status: terminal ? "failed_terminal" : "failed_retryable",
        templateKey: "waitlist_spot_open",
      }],
    });
  }
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
    // ORCH-0877 — master end_at carried into the email body input so the
    // ticket confirmation can render a real date range + ICS DTEND.
    end_at: string | null;
    timezone: string | null;
  } | null;
}): RenderContext {
  const { order, lineItems, ticketRows, masterDate } = args;
  const eventTitle = order.events.title ?? "your event";
  const eventTimezone =
    (masterDate?.timezone && masterDate.timezone.length > 0
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
      // ORCH-0877 — carry the real master end_at into the email body so the
      // date line renders as a true range and the ICS attachment gets a
      // real DTEND (closes the 3-hour fabrication Constitution #9 violation).
      endAt: masterDate?.end_at ?? null,
      timezone: eventTimezone,
    },
    brand: {
      name: order.events.brands.name ?? "your host",
      profilePhotoUrl: order.events.brands.profile_photo_url ?? null,
    },
    order: {
      id: order.id,
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

// ORCH-0869 (Tr3) Stage 1b helpers — kind-routed installment email senders.
// Shared shape: fetch order + event + brand once, render the appropriate
// template, send via Resend with NO attachments + NO calendar link (dunning
// and paid-in-full are notification emails, not ticket emails).

interface InstallmentEmailOrderJoin {
  id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  total_cents: number;
  currency: string;
  events: {
    title: string | null;
    brand_id: string;
    brands: {
      name: string | null;
      contact_email: string | null;
    };
  };
}

async function fetchInstallmentEmailContext(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
): Promise<InstallmentEmailOrderJoin | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,
      buyer_name,
      buyer_email,
      total_cents,
      currency,
      events!inner (
        title,
        brand_id,
        brands!inner ( name, contact_email )
      )
    `)
    .eq("id", orderId)
    .maybeSingle();
  if (error || data === null) return null;
  return data as unknown as InstallmentEmailOrderJoin;
}

async function handleInstallmentDunning(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const installmentId = typeof body.installmentId === "string"
    ? body.installmentId
    : "";
  if (installmentId === "") {
    return jsonResponse({ error: "installment_id_required" }, 400);
  }
  const ordinal = Number(body.installmentOrdinal ?? 0);
  const failureReason = typeof body.failureReason === "string"
    ? body.failureReason
    : "payment_failed_no_detail";

  const order = await fetchInstallmentEmailContext(supabase, orderId);
  if (order === null) return jsonResponse({ error: "order_not_found" }, 404);
  if (order.buyer_email === null || order.buyer_email === "") {
    // Buyers without an email on file silently no-op rather than error —
    // the order still exists, the dispatcher should not 500 the webhook
    // handler upstream.
    return jsonResponse({
      kind: "installment_dunning",
      skipped: "no_buyer_email",
    });
  }

  const { data: installment, error: installmentError } = await supabase
    .from("order_installments")
    .select("id, ordinal, amount_cents, currency, retry_count, next_retry_at")
    .eq("id", installmentId)
    .maybeSingle();
  if (installmentError !== null || installment === null) {
    return jsonResponse({ error: "installment_not_found" }, 404);
  }
  const inst = installment as {
    id: string;
    ordinal: number;
    amount_cents: number;
    currency: string;
    retry_count: number;
    next_retry_at: string | null;
  };

  const rendered = renderInstallmentDunningEmail({
    recipient: { name: order.buyer_name, email: order.buyer_email },
    trip: { title: order.events.title ?? "your trip" },
    installment: {
      ordinal: Number(inst.ordinal ?? ordinal),
      amountCents: Number(inst.amount_cents),
      currency: inst.currency,
      failureReason,
      retryCount: Number(inst.retry_count ?? 0),
      nextRetryAt: inst.next_retry_at,
    },
    brand: {
      name: order.events.brands.name ?? "your host",
      contactEmail: order.events.brands.contact_email,
    },
    order: { shortId: shortId(order.id) },
  });

  assertNotResendSandbox(rendered.from);
  const sent = await sendResendEmailWithAttachment({
    from: formatSenderHeader(rendered.from),
    to: order.buyer_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: [],
  });

  return jsonResponse({
    kind: "installment_dunning",
    orderId,
    installmentId,
    providerMessageId: sent.id,
  });
}

async function handleInstallmentPaidInFull(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
): Promise<Response> {
  const order = await fetchInstallmentEmailContext(supabase, orderId);
  if (order === null) return jsonResponse({ error: "order_not_found" }, 404);
  if (order.buyer_email === null || order.buyer_email === "") {
    return jsonResponse({
      kind: "installment_plan_paid_in_full",
      skipped: "no_buyer_email",
    });
  }

  const rendered = renderInstallmentPlanPaidInFullEmail({
    recipient: { name: order.buyer_name, email: order.buyer_email },
    trip: { title: order.events.title ?? "your trip" },
    brand: {
      name: order.events.brands.name ?? "your host",
      contactEmail: order.events.brands.contact_email,
    },
    order: {
      shortId: shortId(order.id),
      totalCents: Number(order.total_cents ?? 0),
      currency: order.currency ?? "GBP",
    },
  });

  assertNotResendSandbox(rendered.from);
  const sent = await sendResendEmailWithAttachment({
    from: formatSenderHeader(rendered.from),
    to: order.buyer_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: [],
  });

  return jsonResponse({
    kind: "installment_plan_paid_in_full",
    orderId,
    providerMessageId: sent.id,
  });
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
  const supabase = serviceClient();
  const notificationId = typeof body.notificationId === "string"
    ? body.notificationId
    : "";
  if (notificationId) {
    return await handleWaitlistNotificationDispatch(supabase, notificationId);
  }

  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!orderId) return jsonResponse({ error: "order_id_required" }, 400);

  // ORCH-0869 (Tr3) Stage 1b: kind-based routing. When `kind` is one of the
  // Tr3 installment kinds, bypass the legacy ticket_order_notifications
  // polling loop and render+send directly. Non-installment kinds (the legacy
  // ticket-confirmation flow used by every existing caller) fall through to
  // the existing implementation unchanged.
  const kind = typeof body.kind === "string" ? body.kind : null;
  if (kind === "installment_dunning") {
    return await handleInstallmentDunning(supabase, orderId, body);
  }
  if (kind === "installment_plan_paid_in_full") {
    return await handleInstallmentPaidInFull(supabase, orderId);
  }
  if (kind !== null) {
    // Defensive: unknown kind. Surface as 400 so the caller's logs make the
    // misroute obvious — silent fall-through to legacy would render a ticket
    // confirmation email for a webhook that meant something else entirely.
    return jsonResponse(
      { error: "unknown_kind", kind },
      400,
    );
  }

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
        event_type,
        theme,
        brands!inner ( id, name, profile_photo_url, contact_email )
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
    .select(
      "quantity, unit_price_cents, total_cents, ticket_types!inner ( name )",
    )
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
      | {
        start_at: string | null;
        // ORCH-0877 — end_at carried through to email body (already selected
        // at line 541; type narrowed here so buildRenderContext compiles).
        end_at: string | null;
        timezone: string | null;
      }
      | null,
  });

  const ticketCount = context.bodyInput.order.tickets.length;
  const eventTitle = context.bodyInput.event.title;
  // ORCH-0859 (Tr2): trip-shaped SMS copy when event_type='trip'. Event copy
  // is byte-equivalent for event_type='event' (the default branch).
  const isTrip = order.events.event_type === "trip";
  const smsBody = isTrip
    ? `Mingla: you're booked on ${eventTitle}. Order ${shortId(order.id)}.`
    : `Mingla: your ${ticketCount} ticket${
      ticketCount === 1 ? "" : "s"
    } for ${eventTitle} are confirmed. Order ${shortId(order.id)}.`;

  // Render email + PDF once per dispatch; reused across email ledger rows.
  let renderedEmail: ReturnType<typeof renderTransactionalEmail> | null = null;
  let renderedPdf: Awaited<ReturnType<typeof buildTicketPdf>> | null = null;
  let renderError: { code: string; message: string } | null = null;

  try {
    // ORCH-0859 (Tr2): branch by event_type. Trip orders use trip-shaped
    // template; event orders use the existing renderTransactionalEmail
    // (byte-equivalent for event_type='event' — the new branch is fully
    // gated on isTrip).
    if (isTrip) {
      // Fetch trip-specific sidecar data for the email body.
      const [tripDaysResp, tripInclusionsResp] = await Promise.all([
        supabase
          .from("trip_days")
          .select("ordinal, title")
          .eq("event_id", order.events.id)
          .order("ordinal"),
        supabase
          .from("trip_inclusions")
          .select("kind, item, ordinal")
          .eq("event_id", order.events.id)
          .order("kind")
          .order("ordinal"),
      ]);
      const tripDays = (tripDaysResp.data ?? []) as Array<{
        ordinal: number;
        title: string;
      }>;
      const tripInclusions = (tripInclusionsResp.data ?? []) as Array<{
        kind: "included" | "excluded";
        item: string;
      }>;
      const themeBT = ((order.events.theme as Record<string, unknown> | null)
        ?.business_trip as
          | Record<string, unknown>
          | undefined) ?? {};
      renderedEmail = renderTripConfirmationEmail({
        recipient: {
          name: order.buyer_name,
          email: order.buyer_email ?? "",
        },
        trip: {
          title: context.bodyInput.event.title,
          startAtIso: typeof themeBT.startAt === "string"
            ? themeBT.startAt
            : null,
          endAtIso: typeof themeBT.endAt === "string" ? themeBT.endAt : null,
          destinationText: typeof themeBT.destinationLocationText === "string"
            ? themeBT.destinationLocationText
            : null,
          timezone: context.bodyInput.event.timezone,
          days: tripDays,
          inclusions: tripInclusions,
        },
        brand: {
          name: context.bodyInput.brand.name,
          profilePhotoUrl: context.bodyInput.brand.profilePhotoUrl,
        },
        order: {
          id: context.bodyInput.order.id,
          shortId: context.bodyInput.order.shortId,
          totalCents: order.total_cents,
          currency: order.currency,
        },
      });
    } else {
      renderedEmail = renderTransactionalEmail({
        variant: context.bodyInput.variant,
        recipient: {
          name: order.buyer_name,
          email: order.buyer_email ?? "",
        },
        body: context.bodyInput,
      });
    }
    assertNotResendSandbox(renderedEmail.from);
    renderedPdf = await buildTicketPdf({
      event: {
        title: context.bodyInput.event.title,
        startAtIso: context.bodyInput.event.startAt,
        // ORCH-0877 — propagate master end_at into the PDF date line.
        endAtIso: context.bodyInput.event.endAt,
        timezone: context.bodyInput.event.timezone,
        locationText: context.bodyInput.event.locationText,
        brandName: context.bodyInput.brand.name,
      },
      order: { shortId: context.bodyInput.order.shortId },
      tickets: context.ticketsForPdf,
      attendeeNameHint: order.buyer_name,
      logoUrl: MINGLA_LOGO_URL ?? undefined,
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

  // ORCH-0842: persist the rendered PDF to the private `ticket-pdfs` bucket
  // so the consumer app can fetch it on demand via `ticket-pdf-fetch`.
  // Failure is logged + swallowed; the email is the customer-facing artifact
  // and the fetch endpoint can lazy-backfill on first open. `upsert: true`
  // makes this safe under Resend retry (same bytes, same path).
  if (renderedPdf) {
    try {
      const pdfBytes = Uint8Array.from(
        atob(renderedPdf.contentBase64),
        (c) => c.charCodeAt(0),
      );
      const pdfPath = `tickets/${order.id}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("ticket-pdfs")
        .upload(pdfPath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadError) {
        console.warn(
          `[ticket-confirmation-dispatch] storage upload failed for order=${order.id}: ${uploadError.message}`,
        );
      } else {
        const { error: updateError } = await supabase
          .from("orders")
          .update({
            ticket_pdf_path: pdfPath,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
        if (updateError) {
          console.warn(
            `[ticket-confirmation-dispatch] orders.ticket_pdf_path update failed for order=${order.id}: ${updateError.message}`,
          );
        }
      }
    } catch (uploadErr) {
      const message = uploadErr instanceof Error
        ? uploadErr.message
        : String(uploadErr);
      console.warn(
        `[ticket-confirmation-dispatch] storage upload threw for order=${order.id}: ${message}`,
      );
    }
  }

  // ORCH-0788: SELECT payload so we can route by template_key per row.
  const { data: notifications, error: notificationError } = await supabase
    .from("ticket_order_notifications")
    .select("id, channel, recipient, status, attempt_count, payload")
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

  // ORCH-0788: BuyerContext shared by refund/cancel adapters. Built once
  // from the order join; cheap to materialise even on rows that don't use it.
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]: extended with
  // organizerEmail (from existing brands.contact_email join) + cardLast4
  // (null in v1 — we don't store the card last4 locally; Tr4 adapters
  // gracefully fall back to "your original payment method" when null).
  const buyerContext: BuyerContext = {
    buyerName: order.buyer_name,
    eventTitle: context.bodyInput.event.title,
    brandName: context.bodyInput.brand.name,
    orderShortId: context.bodyInput.order.shortId,
    organizerEmail: order.events?.brands?.contact_email ?? null,
    cardLast4: null,
  };

  const outcomes: Array<
    { channel: string; status: string; templateKey: string }
  > = [];
  for (const notification of notifications ?? []) {
    // ORCH-0788 I-PROPOSED-BA: COALESCE template_key with legacy default.
    const rawPayload = (notification.payload ?? {}) as Record<string, unknown>;
    const templateKey = typeof rawPayload.template_key === "string"
      ? rawPayload.template_key
      : "buyer_ticket_confirmation";

    await supabase
      .from("ticket_order_notifications")
      .update({
        status: "sending",
        attempt_count: Number(notification.attempt_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", notification.id);

    try {
      if (templateKey === "buyer_ticket_confirmation") {
        // Legacy path — preserved exactly as ORCH-0785 baseline.
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
          const attachments: Array<{ filename: string; content: string }> = [{
            filename: renderedPdf.filename,
            content: renderedPdf.contentBase64,
          }];
          const calendarLinks = buildCalendarLinks({
            title: context.bodyInput.event.title,
            startAtIso: context.bodyInput.event.startAt,
            // ORCH-0877 — pass real master end_at instead of fabricating a
            // 3h default. Closes the latent Constitution #9 violation.
            endAtIso: context.bodyInput.event.endAt,
            locationText: context.bodyInput.event.locationText,
            isOnline: context.bodyInput.event.isOnline,
            description:
              `${context.bodyInput.event.title} — hosted by ${context.bodyInput.brand.name}. Order #${context.bodyInput.order.shortId}.`,
          });
          if (calendarLinks) {
            attachments.push({
              filename: calendarLinks.icsFilename,
              content: icsToBase64(calendarLinks.icsContent),
            });
          }
          const sent = await sendResendEmailWithAttachment({
            from: formatSenderHeader(renderedEmail.from),
            to: notification.recipient,
            subject: renderedEmail.subject,
            html: renderedEmail.html,
            text: renderedEmail.text,
            attachments,
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
        outcomes.push({
          channel: notification.channel,
          status: "sent",
          templateKey,
        });
      } else if (templateKey === "buyer_refund_issued") {
        // ORCH-0788 §5: refund email via generic_notification adapter.
        // Email-only per SPEC §10.1 (CF-1 SMS deferred).
        if (notification.channel !== "email") {
          await supabase.from("ticket_order_notifications").update({
            status: "skipped",
            last_error: "channel_not_supported_for_template",
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
          outcomes.push({
            channel: notification.channel,
            status: "skipped",
            templateKey,
          });
          continue;
        }
        const refundBody = refundIssuedToGenericBody(
          rawPayload as unknown as RefundIssuedPayloadShape,
          buyerContext,
        );
        const refundEmail = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: order.buyer_name, email: order.buyer_email ?? "" },
          body: refundBody,
          sender: EMAIL_SENDERS.tickets, // ORCH-0788 §5.2 — same sender as purchase
        });
        assertNotResendSandbox(refundEmail.from);
        const sent = await sendResendEmailWithAttachment({
          from: formatSenderHeader(refundEmail.from),
          to: notification.recipient,
          subject: refundEmail.subject,
          html: refundEmail.html,
          text: refundEmail.text,
          attachments: [], // ORCH-0788 §5.3 — no PDF, no calendar
        });
        await supabase.from("ticket_order_notifications").update({
          status: "sent",
          provider: "resend",
          provider_message_id: sent.id,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        outcomes.push({
          channel: notification.channel,
          status: "sent",
          templateKey,
        });
      } else if (templateKey === "buyer_order_cancelled") {
        // ORCH-0788 §5: cancel email via generic_notification adapter.
        if (notification.channel !== "email") {
          await supabase.from("ticket_order_notifications").update({
            status: "skipped",
            last_error: "channel_not_supported_for_template",
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
          outcomes.push({
            channel: notification.channel,
            status: "skipped",
            templateKey,
          });
          continue;
        }
        const cancelBody = orderCancelledToGenericBody(
          rawPayload as unknown as OrderCancelledPayloadShape,
          buyerContext,
        );
        const cancelEmail = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: order.buyer_name, email: order.buyer_email ?? "" },
          body: cancelBody,
          sender: EMAIL_SENDERS.tickets,
        });
        assertNotResendSandbox(cancelEmail.from);
        const sent = await sendResendEmailWithAttachment({
          from: formatSenderHeader(cancelEmail.from),
          to: notification.recipient,
          subject: cancelEmail.subject,
          html: cancelEmail.html,
          text: cancelEmail.text,
          attachments: [],
        });
        await supabase.from("ticket_order_notifications").update({
          status: "sent",
          provider: "resend",
          provider_message_id: sent.id,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        outcomes.push({
          channel: notification.channel,
          status: "sent",
          templateKey,
        });
      } else if (templateKey === "buyer_intake_form_re_answer_required") {
        // ORCH-0880 [Tr5 Traveler Intake Forms] — re-answer notification via
        // generic_notification adapter. Email-only in v1 (push deferred to a
        // follow-up once push token plumbing for anon buyers exists).
        // Triggered by the `tg_trip_intake_schemas_re_answer_dispatch` trigger
        // after planner edits a published-trip tier's schema in a way that
        // changes question shape; the trigger INSERTs a ticket_order_
        // notifications row per affected order which this dispatcher then
        // delivers via the standard ORCH-0788 retry-cron loop.
        if (notification.channel !== "email") {
          await supabase.from("ticket_order_notifications").update({
            status: "skipped",
            last_error: "channel_not_supported_for_template",
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
          outcomes.push({
            channel: notification.channel,
            status: "skipped",
            templateKey,
          });
          continue;
        }
        const reAnswerBody = intakeFormReAnswerRequiredToGenericBody(
          rawPayload as unknown as IntakeFormReAnswerRequiredPayloadShape,
          buyerContext,
        );
        const reAnswerEmail = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: order.buyer_name, email: order.buyer_email ?? "" },
          body: reAnswerBody,
          sender: EMAIL_SENDERS.tickets,
        });
        assertNotResendSandbox(reAnswerEmail.from);
        const sent = await sendResendEmailWithAttachment({
          from: formatSenderHeader(reAnswerEmail.from),
          to: notification.recipient,
          subject: reAnswerEmail.subject,
          html: reAnswerEmail.html,
          text: reAnswerEmail.text,
          attachments: [],
        });
        await supabase.from("ticket_order_notifications").update({
          status: "sent",
          provider: "resend",
          provider_message_id: sent.id,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        outcomes.push({
          channel: notification.channel,
          status: "sent",
          templateKey,
        });
      } else if (templateKey === "waitlist_spot_open") {
        const status = await deliverWaitlistSpotOpenNotification(
          supabase,
          notification as unknown as NotificationRow,
        );
        outcomes.push({ channel: notification.channel, status, templateKey });
      } else {
        // ORCH-0788 I-PROPOSED-BA defensive: unknown template_key flips to
        // failed_terminal immediately so the row surfaces visibly via the
        // brand-team SELECT RLS policy instead of silently rendering the
        // wrong template. No retry attempts consumed.
        await supabase.from("ticket_order_notifications").update({
          status: "failed_terminal",
          last_error: `unknown_template_key:${templateKey}`,
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        outcomes.push({
          channel: notification.channel,
          status: "failed_terminal",
          templateKey,
        });
      }
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
        templateKey,
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
