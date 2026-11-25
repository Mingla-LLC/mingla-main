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
  alertOrderRefundException,
  orderRefundInboxFields,
} from "../_shared/orderRefundWebhookOutcome.ts";
import {
  classifyStripeWebhookFailure,
  stripeWebhookResponseStatus,
} from "../_shared/stripeWebhookRetry.ts";
import {
  getStripeWebhookSecretsFromEnv,
  verifyStripeWebhookSignature,
} from "../_shared/stripeWebhookSignature.ts";
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
import { logError } from "../_shared/structuredLog.ts";
import { resolveAlertRecipientValue } from "../_shared/secretBundle.ts";
import { requestGigLateRefund } from "../_shared/gigPaymentCapture.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_WEBHOOK_ATTEMPTS = 5;

function plainResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function notifyWebhookSignatureFailure(
  signature: string | null,
  send: typeof sendOpsAlertEmail = sendOpsAlertEmail,
): Promise<number> {
  const value = resolveAlertRecipientValue(
    "stripe_webhook_failures",
    "STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS",
  );
  const emails = Array.isArray(value)
    ? value
    : (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (emails.length === 0) return 0;
  const sigPrefix = signature?.slice(0, 20) ?? "missing";
  const subject = "⚠️ [LIVE] Stripe webhook signature failure detected";
  const paragraphs = [
    "A Stripe webhook delivery failed signature verification.",
    "This typically means the live webhook signing secret is wrong, the request is being replayed, or a third party is probing the endpoint.",
    `Signature prefix: ${sigPrefix}`,
    `Timestamp: ${new Date().toISOString()}`,
    "Action: confirm STRIPE_WEBHOOK_SECRET_LIVE in Supabase secrets matches the active endpoint signing secret in Stripe Dashboard -> Developers -> Webhooks.",
  ];
  const result = await send({
    subject,
    paragraphs,
    recipients: emails,
    cta: {
      label: "Open Stripe webhooks dashboard",
      url: "https://dashboard.stripe.com/webhooks",
    },
  });
  return result.succeeded;
}

export async function stripeWebhookHandler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return plainResponse({ error: "method_not_allowed" }, 405);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return plainResponse({ error: "missing_signature" }, 400);

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    logError("stripe-webhook body read failed", err, { fn: "stripe-webhook" });
    return plainResponse({ error: "body_read_failed" }, 400);
  }

  const secrets = getStripeWebhookSecretsFromEnv();
  if (secrets.length === 0) {
    return plainResponse({ error: "webhook_secret_missing" }, 500);
  }

  const stripe = stripeWebhook();
  let verified;
  try {
    verified = await verifyStripeWebhookSignature(
      stripe,
      rawBody,
      signature,
      secrets,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("stripe-webhook signature verification failed", err, {
      fn: "stripe-webhook",
    });
    try {
      await notifyWebhookSignatureFailure(signature);
    } catch (notifyErr) {
      logError("stripe-webhook signature-failure alert failed", notifyErr, {
        fn: "stripe-webhook",
      });
    }
    return plainResponse({ error: "invalid_signature", detail: message }, 400);
  }

  const event = verified.event;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const ipAllowed = verifyStripeSourceIp(req);
  if (!ipAllowed) {
    const sourceIp = extractClientIp(req);
    console.warn(
      "[stripe-webhook] Stripe signature valid but source IP not allowlisted",
      {
        sourceIp,
        event_id: event.id,
      },
    );
    try {
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        // META-ORCH-1234: Stripe event id is not a Mingla event uuid; it is preserved in target_id (text) below.
        event_id: null,
        action: "stripe_connect.webhook_ip_soft_fail",
        target_type: "stripe_webhook_event",
        target_id: event.id,
        after: { source_ip: sourceIp, event_type: event.type },
      });
    } catch (auditErr) {
      logError("stripe-webhook IP soft-fail audit failed", auditErr, {
        fn: "stripe-webhook",
        eventId: event.id,
      });
    }
  }

  return await processVerifiedStripeEvent(event, {
    supabase,
    route: (routedEvent) =>
      routeStripeEvent(supabase, stripe, routedEvent, {
        // Issue #4402 — a late gig payment is refunded in full; reconcile
        // retries it if this call does not land.
        requestLateRefund: (contractId: string) =>
          requestGigLateRefund(contractId, {
            supabaseUrl: SUPABASE_URL,
            serviceKey: SUPABASE_SERVICE_ROLE_KEY,
          }),
      }),
  }, { secretName: verified.secretName, ipAllowed });
}

// deno-lint-ignore no-explicit-any
type WebhookEvent = any;
// deno-lint-ignore no-explicit-any
type WebhookSupabase = any;

export interface ProcessVerifiedStripeEventDeps {
  supabase: WebhookSupabase;
  route: (
    event: WebhookEvent,
  ) => Promise<{
    gigMismatchReason?: string | null;
    refundOutcome?: Parameters<typeof orderRefundInboxFields>[0];
  } | void>;
}

/**
 * Records a signature-verified event once, routes it, and answers Stripe.
 *
 * Issue #4420 — the answer tells Stripe whether to redeliver: 503/500 while a
 * transient or configuration failure has attempts left (and when the event
 * row itself could not be read or written), 200 for success, a replay of an
 * already processed event, a permanently invalid event, or an exhausted one.
 * A processed event is never routed again, so a redelivery cannot double a
 * sale, a refund, a ledger row or an email.
 */
export async function processVerifiedStripeEvent(
  event: WebhookEvent,
  deps: ProcessVerifiedStripeEventDeps,
  meta: { secretName: string | null; ipAllowed: boolean },
): Promise<Response> {
  const { supabase } = deps;
  const { data: existingRow, error: selectError } = await supabase
    .from("payment_webhook_events")
    .select("id, processed, retry_count, retries_exhausted")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (selectError) {
    logError("stripe-webhook select existing failed", selectError, {
      fn: "stripe-webhook",
      eventId: event.id,
    });
    // #4420 — the event was not recorded; Stripe must redeliver it.
    return plainResponse({ status: "select_failed" }, 503);
  }

  let eventRowId: string;
  let priorRetryCount = 0;
  if (existingRow) {
    eventRowId = existingRow.id;
    priorRetryCount = Number(existingRow.retry_count ?? 0);
    if (existingRow.processed === true) {
      return plainResponse(
        { status: "replayed_processed", event_id: event.id },
        200,
      );
    }
    if (
      existingRow.retries_exhausted === true ||
      priorRetryCount >= MAX_WEBHOOK_ATTEMPTS
    ) {
      await supabase
        .from("payment_webhook_events")
        .update({ retries_exhausted: true })
        .eq("id", eventRowId);
      return plainResponse(
        { status: "retries_exhausted", event_id: event.id },
        200,
      );
    }
  } else {
    const { data: insertedRow, error: insertError } = await supabase
      .from("payment_webhook_events")
      .insert({
        stripe_event_id: event.id,
        type: event.type,
        payload: event,
        provider: "stripe",
        provider_event_type: event.type,
        provider_event_id: event.id,
        match_status: "not_applicable",
        processed: false,
        retry_count: 0,
        retries_exhausted: false,
      })
      .select("id")
      .single();
    if (insertError || !insertedRow) {
      logError("stripe-webhook insert failed", insertError, {
        fn: "stripe-webhook",
        eventId: event.id,
      });
      // #4420 — not recorded (or a concurrent delivery holds the id): Stripe
      // redelivers, and the redelivery reads the recorded row.
      return plainResponse({ status: "insert_failed" }, 503);
    }
    eventRowId = insertedRow.id;
  }

  let processingError: string | null = null;
  let failureClass: "transient" | "config" | "permanent" | null = null;
  let refundFields: ReturnType<typeof orderRefundInboxFields> | undefined;
  try {
    const routed = await deps.route(event);
    if (routed?.refundOutcome) {
      const refundId = String(event.data.object.id ?? "");
      refundFields = orderRefundInboxFields(routed.refundOutcome, refundId);
      await alertOrderRefundException("stripe", refundId, routed.refundOutcome);
    }
    if (routed && routed.gigMismatchReason) {
      await supabase.from("payment_webhook_events").update({
        match_status: "mismatched",
        match_reason_code: `gig_${routed.gigMismatchReason}`,
        first_response_due_at: new Date(Date.now() + 4 * 60 * 60 * 1000)
          .toISOString(),
      }).eq("id", eventRowId);
    }
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err);
    failureClass = classifyStripeWebhookFailure(err);
    if (
      processingError.includes("source_refund_exact_match_missing") ||
      processingError.includes("source_identity_missing")
    ) {
      await supabase.from("payment_webhook_events").update({
        match_status: "unmatched",
        match_reason_code: "source_refund_exact_match_missing",
        first_response_due_at: new Date(Date.now() + 4 * 60 * 60 * 1000)
          .toISOString(),
      }).eq("id", eventRowId);
    } else if (
      processingError.includes("source_refund_") &&
      processingError.includes("mismatch")
    ) {
      await supabase.from("payment_webhook_events").update({
        match_status: "mismatched",
        match_reason_code: "source_refund_provider_evidence_mismatch",
        first_response_due_at: new Date(Date.now() + 4 * 60 * 60 * 1000)
          .toISOString(),
      }).eq("id", eventRowId);
    }
    logError("stripe-webhook processing failed", err, {
      fn: "stripe-webhook",
      eventId: event.id,
      eventType: event.type,
    });
  }

  const nextRetryCount = priorRetryCount + 1;
  const exhausted = processingError !== null &&
    nextRetryCount >= MAX_WEBHOOK_ATTEMPTS;
  const updatePayload: Record<string, unknown> = {
    ...refundFields,
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
  if (markError) {
    logError("stripe-webhook mark processed failed", markError, {
      fn: "stripe-webhook",
      eventId: event.id,
    });
  }

  // Issue #3645 / #4420 — a transient (503) or configuration (500) failure
  // with attempts left asks Stripe to redeliver; success, a permanent failure
  // and an exhausted event answer 200.
  const responseStatus = stripeWebhookResponseStatus({
    processingFailed: processingError !== null,
    retryable: failureClass === "transient" || failureClass === "config",
    exhausted,
    config: failureClass === "config",
  });

  return plainResponse({
    status: processingError === null
      ? "ok"
      : responseStatus === 503 || responseStatus === 500
      ? "processing_retry"
      : "processing_failed",
    event_id: event.id,
    attempts: nextRetryCount,
    failure_class: failureClass,
    signature_secret: meta.secretName,
    ip_allowed: meta.ipAllowed,
  }, responseStatus);
}

if (Deno.env.get("DENO_TESTING") !== "1") {
  serve(stripeWebhookHandler);
}
