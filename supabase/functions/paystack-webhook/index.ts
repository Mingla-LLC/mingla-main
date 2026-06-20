/**
 * paystack-webhook (META-ORCH-1076 Phase 1).
 *
 * Receives Paystack webhooks, verifies x-paystack-signature (HMAC-SHA512 of the
 * RAW body with the secret key), enqueues to the idempotent payment_webhook_events
 * inbox, routes charge.success → verify-by-reference → biz_ticket_checkout_finalize,
 * and acks 200 fast. verify_jwt MUST be false (Paystack sends no Supabase JWT —
 * config.toml [functions.paystack-webhook] verify_jwt=false).
 *
 * Source of truth: the verified charge.success webhook (the buyer redirect is
 * unreliable). Idempotency: payment_webhook_events.stripe_event_id keyed on
 * `paystack:<event>:<reference>` (Paystack has no evt_… id) PLUS the finalize
 * RPC's order_id early-return (callback + webhook can both fire).
 *
 * Paystack docs (COMMS-0003):
 *   - Webhook signature (x-paystack-signature = HMAC-SHA512 of RAW body, secret key),
 *     ack 200 fast, 30s timeout, retries on non-200:
 *       https://paystack.com/docs/payments/webhooks/
 *   - charge.success event name + envelope { event, data }:
 *       https://paystack.com/docs/payments/webhooks/
 *   - Verify transaction (gate on data.status==="success" + amount + currency):
 *       https://paystack.com/docs/api/transaction/#verify
 *   - Webhook source IPs (static trio; soft check Phase 1):
 *       https://paystack.com/docs/payments/webhooks/
 * Reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md (Part 4).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PAYSTACK_WEBHOOK_IPS,
  paystackVerifyTransaction,
  resolvePaystackSecretKey,
  verifyPaystackSignature,
} from "../_shared/paystack.ts";
import { handlePaystackChargeSuccess } from "../_shared/paystackWebhookRouter.ts";
import { writeAudit } from "../_shared/audit.ts";
import { dispatchTicketConfirmation } from "../_shared/ticketCheckout.ts";
// META-ORCH-1161 §7.1 — buyer purchase-confirmation push (the Paystack-equivalent
// of the Stripe finalize path). Email stays owned by dispatchTicketConfirmation.
import { fireBuyerPurchaseConfirmationPush } from "../_shared/businessNotifyTriggers.ts";

// Match the stripe-webhook retry-budget posture.
const MAX_WEBHOOK_ATTEMPTS = 6;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Raw body is REQUIRED for signature verification — do not parse before hashing.
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  let secret: string;
  try {
    secret = resolvePaystackSecretKey();
  } catch (err) {
    console.error("[paystack-webhook] key resolution failed:", String(err));
    return json({ error: "server_misconfigured" }, 500);
  }

  const valid = await verifyPaystackSignature(rawBody, signature, secret);
  if (!valid) {
    console.warn("[paystack-webhook] REJECTED — bad signature", {
      sigPrefix: signature?.slice(0, 16) ?? "missing",
    });
    return json({ error: "invalid_signature" }, 401);
  }

  // Soft IP check (log only — Paystack delivers from a static trio; Supabase
  // edge may rewrite x-forwarded-for so signature is the HARD gate, IP is
  // belt-and-suspenders). Hardening to a hard IP gate is a deferred item.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ipKnown = PAYSTACK_WEBHOOK_IPS.includes(ip);

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const eventName = typeof event?.event === "string" ? event.event : "unknown";
  const data = (event?.data ?? {}) as Record<string, unknown>;
  const reference = typeof data?.reference === "string"
    ? data.reference
    : (data?.id !== undefined && data?.id !== null ? String(data.id) : "unknown");

  console.log("[paystack-webhook] VERIFIED event", {
    event: eventName,
    reference,
    status: data?.status ?? null,
    amount: data?.amount ?? null,
    currency: data?.currency ?? null,
    channel: data?.channel ?? null,
    ipKnown,
  });

  const supabase = serviceClient();

  // ---- Idempotent inbox (reuse payment_webhook_events) ----
  // Paystack has no evt_… id; derive a stable key from event + reference.
  const idempotencyKey = `paystack:${eventName}:${reference}`;

  const { data: existingRow, error: selectError } = await supabase
    .from("payment_webhook_events")
    .select("id, processed, retry_count, retries_exhausted")
    .eq("stripe_event_id", idempotencyKey)
    .maybeSingle();
  if (selectError) {
    console.error("[paystack-webhook] inbox select failed:", selectError);
    // 200 so Paystack does not hammer-retry on a transient DB read; the row
    // (if absent) will be created on the next delivery.
    return json({ status: "select_failed" }, 200);
  }

  let eventRowId: string;
  let priorRetryCount = 0;
  if (existingRow) {
    eventRowId = existingRow.id;
    priorRetryCount = Number(existingRow.retry_count ?? 0);
    if (existingRow.processed === true) {
      return json({ status: "replayed_processed", reference }, 200);
    }
    if (existingRow.retries_exhausted === true || priorRetryCount >= MAX_WEBHOOK_ATTEMPTS) {
      await supabase
        .from("payment_webhook_events")
        .update({ retries_exhausted: true })
        .eq("id", eventRowId);
      return json({ status: "retries_exhausted", reference }, 200);
    }
  } else {
    const { data: insertedRow, error: insertError } = await supabase
      .from("payment_webhook_events")
      .insert({
        stripe_event_id: idempotencyKey,
        type: eventName,
        payload: event,
        processed: false,
        retry_count: 0,
        retries_exhausted: false,
      })
      .select("id")
      .single();
    if (insertError || !insertedRow) {
      console.error("[paystack-webhook] inbox insert failed:", insertError);
      return json({ status: "insert_failed" }, 200);
    }
    eventRowId = insertedRow.id;
  }

  // ---- Route on top-level event ----
  let processingError: string | null = null;
  let finalizedOrderId: string | null = null;
  try {
    if (eventName === "charge.success") {
      const result = await handlePaystackChargeSuccess(
        supabase,
        data,
        paystackVerifyTransaction,
      );
      if (result.status === "finalized" || result.status === "replayed") {
        finalizedOrderId = result.orderId ?? null;
      }
    } else {
      // Unhandled event — audit + no-op (Phase 1 only routes charge.success).
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        action: "paystack.webhook_unhandled_event",
        target_type: "paystack_webhook_event",
        target_id: idempotencyKey,
        after: { event: eventName, reference },
      });
    }
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err);
    console.error(
      `[paystack-webhook] processing failed for ${eventName} reference=${reference}:`,
      processingError,
    );
  }

  // Fire-and-forget the confirmation dispatch only on a fresh finalize.
  if (finalizedOrderId) {
    await dispatchTicketConfirmation(finalizedOrderId);

    // META-ORCH-1161 §7.1 — buyer purchase-confirmation PUSH+in-app (Paystack
    // equivalent of the Stripe finalize push). Email already went via
    // dispatchTicketConfirmation; the helper passes contact=null so the v2
    // dispatcher never re-emails (push+inapp only). Best-effort; never throws.
    try {
      const { data: orderRow } = await supabase
        .from("orders")
        .select("event_id, events(title, brand_id)")
        .eq("id", finalizedOrderId)
        .maybeSingle();
      const eventId = (orderRow as Record<string, unknown> | null)?.event_id as
        | string
        | undefined;
      const joinedEvent = (orderRow as Record<string, unknown> | null)?.events as
        | { title?: string | null; brand_id?: string | null }
        | Array<{ title?: string | null; brand_id?: string | null }>
        | null
        | undefined;
      const eventRow = Array.isArray(joinedEvent) ? joinedEvent[0] ?? null : joinedEvent ?? null;
      if (eventId) {
        await fireBuyerPurchaseConfirmationPush(supabase as never, {
          orderId: finalizedOrderId,
          eventId,
          brandId: (eventRow?.brand_id as string | null) ?? null,
          eventTitle: (eventRow?.title as string | null) ?? "your event",
          startAtIso: null,
        });
      }
    } catch (pushErr) {
      console.warn(
        "[paystack-webhook] purchase-confirmation push failed (non-fatal):",
        pushErr instanceof Error ? pushErr.message : String(pushErr),
      );
    }
  }

  // ---- Mark processed / retry_count++ / error (mirror stripe-webhook) ----
  const nextRetryCount = priorRetryCount + 1;
  const exhausted = processingError !== null && nextRetryCount >= MAX_WEBHOOK_ATTEMPTS;
  const { error: markError } = await supabase
    .from("payment_webhook_events")
    .update({
      processed: processingError === null,
      processed_at: new Date().toISOString(),
      retry_count: nextRetryCount,
      retries_exhausted: exhausted,
      error: processingError,
    })
    .eq("id", eventRowId);
  if (markError) {
    console.error("[paystack-webhook] mark processed failed:", markError);
  }

  // Ack: 200 when processed; non-2xx when we want Paystack to retry the event.
  if (processingError !== null && !exhausted) {
    return json({ status: "processing_failed", reference }, 500);
  }
  return json({ received: true, reference }, 200);
});
