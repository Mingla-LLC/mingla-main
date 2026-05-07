/**
 * stripe-webhook — verifies Stripe webhooks, records idempotently, then routes
 * 14 Connect-context + 2 platform-context B2a Path C V3 events.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripeWebhook } from "../_shared/stripe.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  extractClientIp,
  verifyStripeSourceIp,
} from "../_shared/stripeIpAllowlist.ts";
import { routeStripeEvent } from "../_shared/stripeWebhookRouter.ts";
import {
  getStripeWebhookSecretsFromEnv,
  verifyStripeWebhookSignature,
} from "../_shared/stripeWebhookSignature.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_WEBHOOK_ATTEMPTS = 5;

function plainResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return plainResponse({ error: "method_not_allowed" }, 405);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return plainResponse({ error: "missing_signature" }, 400);

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    console.error("[stripe-webhook] body read failed:", err);
    return plainResponse({ error: "body_read_failed" }, 400);
  }

  const secrets = getStripeWebhookSecretsFromEnv();
  if (secrets.length === 0) {
    return plainResponse({ error: "webhook_secret_missing" }, 500);
  }

  const stripe = stripeWebhook();
  let verified;
  try {
    verified = await verifyStripeWebhookSignature(stripe, rawBody, signature, secrets);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] signature verification failed:", message);
    return plainResponse({ error: "invalid_signature", detail: message }, 400);
  }

  const event = verified.event;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const ipAllowed = verifyStripeSourceIp(req);
  if (!ipAllowed) {
    const sourceIp = extractClientIp(req);
    console.warn("[stripe-webhook] Stripe signature valid but source IP not allowlisted", {
      sourceIp,
      event_id: event.id,
    });
    try {
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        event_id: event.id,
        action: "stripe_connect.webhook_ip_soft_fail",
        target_type: "stripe_webhook_event",
        target_id: event.id,
        after: { source_ip: sourceIp, event_type: event.type },
      });
    } catch (auditErr) {
      console.error("[stripe-webhook] IP soft-fail audit failed:", auditErr);
    }
  }

  const { data: existingRow, error: selectError } = await supabase
    .from("payment_webhook_events")
    .select("id, processed, retry_count, retries_exhausted")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (selectError) {
    console.error("[stripe-webhook] select existing failed:", selectError);
    return plainResponse({ status: "select_failed" }, 200);
  }

  let eventRowId: string;
  let priorRetryCount = 0;
  if (existingRow) {
    eventRowId = existingRow.id;
    priorRetryCount = Number(existingRow.retry_count ?? 0);
    if (existingRow.processed === true) {
      return plainResponse({ status: "replayed_processed", event_id: event.id }, 200);
    }
    if (existingRow.retries_exhausted === true || priorRetryCount >= MAX_WEBHOOK_ATTEMPTS) {
      await supabase
        .from("payment_webhook_events")
        .update({ retries_exhausted: true })
        .eq("id", eventRowId);
      return plainResponse({ status: "retries_exhausted", event_id: event.id }, 200);
    }
  } else {
    const { data: insertedRow, error: insertError } = await supabase
      .from("payment_webhook_events")
      .insert({
        stripe_event_id: event.id,
        type: event.type,
        payload: event,
        processed: false,
        retry_count: 0,
        retries_exhausted: false,
      })
      .select("id")
      .single();
    if (insertError || !insertedRow) {
      console.error("[stripe-webhook] insert failed:", insertError);
      return plainResponse({ status: "insert_failed" }, 200);
    }
    eventRowId = insertedRow.id;
  }

  let processingError: string | null = null;
  try {
    await routeStripeEvent(supabase, stripe, event);
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err);
    console.error(
      `[stripe-webhook] processing failed for ${event.type} event_id=${event.id}:`,
      processingError,
    );
  }

  const nextRetryCount = priorRetryCount + 1;
  const exhausted = processingError !== null && nextRetryCount >= MAX_WEBHOOK_ATTEMPTS;
  const updatePayload: Record<string, unknown> = {
    processed: processingError === null,
    processed_at: new Date().toISOString(),
    retry_count: nextRetryCount,
    retries_exhausted: exhausted,
    error: processingError,
  };

  const { error: markError } = await supabase
    .from("payment_webhook_events")
    .update(updatePayload)
    .eq("id", eventRowId);
  if (markError) console.error("[stripe-webhook] mark processed failed:", markError);

  return plainResponse({
    status: processingError === null ? "ok" : "processing_failed",
    event_id: event.id,
    attempts: nextRetryCount,
    signature_secret: verified.secretName,
    ip_allowed: ipAllowed,
  }, 200);
});
