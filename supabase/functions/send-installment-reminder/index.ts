import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  userClient,
} from "../_shared/ticketCheckout.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
} from "../_shared/email/index.ts";
import { renderInstallmentReminderEmail } from "../_shared/email/installmentReminderEmail.ts";

interface SendReminderBody {
  orderId?: unknown;
}

type DeliveryState = "sent" | "failed" | "skipped";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDueDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<DeliveryState> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return "failed";
  try {
    assertNotResendSandbox(EMAIL_SENDERS.system);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatSenderHeader(EMAIL_SENDERS.system),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    return res.ok ? "sent" : "failed";
  } catch (err) {
    console.warn(
      "[send-installment-reminder] email failed",
      err instanceof Error ? err.message : err,
    );
    return "failed";
  }
}

async function sendPush(input: {
  userId: string | null;
  brandId: string;
  orderId: string;
  title: string;
  body: string;
}): Promise<DeliveryState> {
  if (input.userId === null) return "skipped";
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return "failed";
  try {
    const res = await fetch(`${url}/functions/v1/notify-dispatch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: input.userId,
        type: "installment_reminder",
        title: input.title,
        body: input.body,
        data: { orderId: input.orderId },
        brandId: input.brandId,
        relatedId: input.orderId,
        relatedType: "order",
        idempotencyKey: `installment_reminder:${input.orderId}:${Date.now()}`,
      }),
    });
    if (!res.ok) return "failed";
    const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
    return payload.pushSent === true ? "sent" : "skipped";
  } catch (err) {
    console.warn(
      "[send-installment-reminder] push failed",
      err instanceof Error ? err.message : err,
    );
    return "failed";
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: SendReminderBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json_body" }, 400);
  }

  if (typeof body.orderId !== "string" || !UUID_REGEX.test(body.orderId)) {
    return jsonResponse({ ok: false, error: "invalid_order_id" }, 400);
  }

  const { data, error } = await userClient(req).rpc(
    "biz_send_installment_reminder",
    { p_order_id: body.orderId },
  );
  if (error !== null) {
    return jsonResponse(
      { ok: false, error: `send_reminder_rpc_failed:${error.message}` },
      500,
    );
  }

  const rpc = (data ?? {}) as Record<string, unknown>;
  if (rpc.ok !== true) {
    const reason = typeof rpc.reason === "string" ? rpc.reason : "unknown";
    if (reason === "rate_limited") {
      return jsonResponse(
        { ok: false, error: "Rate limited: 1 reminder per buyer per 24h." },
        429,
      );
    }
    if (reason === "forbidden") {
      return jsonResponse(
        { ok: false, error: "Not authorised to send reminders for this brand." },
        403,
      );
    }
    return jsonResponse({ ok: false, error: reason }, 409);
  }

  const reminderId = typeof rpc.reminder_id === "string" ? rpc.reminder_id : null;
  const brandId = typeof rpc.brand_id === "string" ? rpc.brand_id : null;
  if (reminderId === null || brandId === null) {
    return jsonResponse({ ok: false, error: "reminder_context_missing" }, 500);
  }

  const admin = serviceClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, event_id, buyer_name, buyer_email, buyer_user_id, total_cents, currency")
    .eq("id", body.orderId)
    .maybeSingle();
  if (order === null) {
    return jsonResponse({ ok: false, error: "order_not_found" }, 404);
  }

  const orderRow = order as {
    id: string;
    event_id: string;
    buyer_name: string | null;
    buyer_email: string | null;
    buyer_user_id: string | null;
    total_cents: number;
    currency: string;
  };
  const { data: eventRow } = await admin
    .from("events")
    .select("id, title")
    .eq("id", orderRow.event_id)
    .maybeSingle();
  const { data: brand } = await admin
    .from("brands")
    .select("id, name")
    .eq("id", brandId)
    .maybeSingle();
  const { data: nextInstallment } = await admin
    .from("order_installments")
    .select("id, amount_cents, currency, due_at")
    .eq("order_id", body.orderId)
    .in("status", ["scheduled", "failed"])
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const eventTitle = (eventRow as { title?: string } | null)?.title ??
    "your trip";
  const brandName = (brand as { name?: string } | null)?.name ?? "Mingla";
  const inst = nextInstallment as {
    amount_cents?: number;
    currency?: string;
    due_at?: string;
  } | null;
  const amount = formatMoney(
    inst?.amount_cents ?? orderRow.total_cents,
    inst?.currency ?? orderRow.currency,
  );
  const dueAt = inst?.due_at !== undefined ? formatDueDate(inst.due_at) : "soon";
  const buyerEmail = orderRow.buyer_email?.trim() ?? "";
  const template = renderInstallmentReminderEmail({
    buyerName: orderRow.buyer_name,
    buyerEmail,
    tripTitle: eventTitle,
    brandDisplayName: brandName,
    nextInstallmentAmount: amount,
    nextInstallmentDueAt: dueAt,
    bookingId: body.orderId.slice(0, 8),
    unsubscribeUrl: `${
      Deno.env.get("MINGLA_CONSUMER_WEB_URL") ?? "https://usemingla.com"
    }/unsubscribe`,
  });

  const email: DeliveryState = buyerEmail.length > 0
    ? await sendEmail({
      to: buyerEmail,
      subject: template.subject,
      html: template.htmlBody,
      text: template.textBody,
    })
    : "skipped";
  const push = await sendPush({
    userId: orderRow.buyer_user_id,
    brandId,
    orderId: body.orderId,
    title: "Installment reminder",
    body: `${amount} for ${eventTitle} is due ${dueAt}.`,
  });

  await admin
    .from("manual_buyer_reminders")
    .update({ delivery_results: { email, push } })
    .eq("id", reminderId);

  const deliveredVia: Array<"email" | "push"> = [
    ...(email === "sent" ? ["email" as const] : []),
    ...(push === "sent" ? ["push" as const] : []),
  ];
  return jsonResponse({ ok: true, deliveredVia });
});
