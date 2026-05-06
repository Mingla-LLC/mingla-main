/**
 * stripe-webhook — receives + verifies + idempotently records Stripe webhook events.
 *
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.2.4.
 *
 * Auth: NO JWT — Stripe signature verification via STRIPE_WEBHOOK_SECRET only.
 *
 * Architecture (R3 mitigation — durable queue pattern):
 *  1. Verify Stripe signature on raw body (CRITICAL — reject 400 if absent/invalid)
 *  2. Idempotently insert into payment_webhook_events (unique idx on stripe_event_id)
 *  3. Return 200 OK to Stripe immediately
 *  4. Process inline for B2a (account.updated only); other event types recorded but no-op
 *  5. UPDATE row to processed=true on success or error=... on failure
 *
 * Event types processed in B2a:
 *  - account.updated → updates stripe_connect_accounts; trigger mirrors to brands cache
 *
 * Event types recorded but no-op (B3/B4 will wire processing):
 *  - payout.* / charge.* / refund.* / application_fee.* / transfer.*
 *  - account.application.deauthorized (B2b detach detection)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripe } from "../_shared/stripe.ts";
import { writeAudit } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

if (!STRIPE_WEBHOOK_SECRET) {
  throw new Error(
    "STRIPE_WEBHOOK_SECRET environment variable is not set. Configure in Supabase Dashboard → Project Settings → Edge Functions → Secrets after creating the webhook endpoint in Stripe Dashboard.",
  );
}

// Stripe webhooks do NOT include CORS headers (server-to-server calls).
// We do not respond with CORS — direct 200/400/etc.
function plainResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface AccountObject {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: Record<string, unknown>;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: AccountObject };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return plainResponse({ error: "method_not_allowed" }, 405);
  }

  // Step 2 — Verify Stripe-Signature header
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return plainResponse({ error: "missing_signature" }, 400);
  }

  // Step 3 — Read raw body BEFORE JSON parse (signature verification needs raw bytes)
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    console.error("[stripe-webhook] body read failed:", err);
    return plainResponse({ error: "body_read_failed" }, 400);
  }

  // Step 4-5 — Verify signature; reject if invalid
  let event: StripeEvent;
  try {
    // @ts-ignore — Stripe SDK webhooks namespace
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] signature verification failed:", message);
    return plainResponse(
      { error: "invalid_signature", detail: message },
      400,
    );
  }

  // Step 6 — Idempotently INSERT into payment_webhook_events
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: existingRow, error: selectError } = await supabase
    .from("payment_webhook_events")
    .select("id, processed")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (selectError) {
    console.error("[stripe-webhook] select existing failed:", selectError);
    // Return 200 so Stripe doesn't retry-storm; we already failed durably
    return plainResponse({ status: "select_failed" }, 200);
  }

  if (existingRow) {
    // Replayed event — idempotent skip per SC-09
    console.log(
      `[stripe-webhook] replayed event ${event.id} skipped (already processed=${existingRow.processed})`,
    );
    return plainResponse({ status: "replayed_skipped" }, 200);
  }

  const { data: insertedRow, error: insertError } = await supabase
    .from("payment_webhook_events")
    .insert({
      stripe_event_id: event.id,
      type: event.type,
      payload: event,
      processed: false,
    })
    .select("id")
    .single();

  if (insertError || !insertedRow) {
    console.error("[stripe-webhook] insert failed:", insertError);
    // Return 200 to avoid Stripe retry-storm; row may exist via race
    return plainResponse({ status: "insert_failed" }, 200);
  }

  const eventRowId = insertedRow.id;

  // Step 7 — Process inline based on event type
  let processingError: string | null = null;
  try {
    if (event.type === "account.updated") {
      const account = event.data.object;
      if (!account?.id) {
        throw new Error("account.updated event missing account.id");
      }

      // Read prior state for audit before/after
      const { data: priorRow } = await supabase
        .from("stripe_connect_accounts")
        .select("brand_id, charges_enabled, payouts_enabled, requirements")
        .eq("stripe_account_id", account.id)
        .maybeSingle();

      // UPDATE stripe_connect_accounts; trigger mirrors to brands.stripe_*
      const { error: scaUpdateError } = await supabase
        .from("stripe_connect_accounts")
        .update({
          charges_enabled: account.charges_enabled ?? false,
          payouts_enabled: account.payouts_enabled ?? false,
          requirements: account.requirements ?? {},
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_account_id", account.id);

      if (scaUpdateError) {
        throw new Error(`sca update failed: ${scaUpdateError.message}`);
      }

      // Audit log
      if (priorRow) {
        try {
          await writeAudit(supabase, {
            user_id: null,
            brand_id: priorRow.brand_id,
            action: "stripe_connect.account_updated",
            target_type: "stripe_connect_account",
            target_id: account.id,
            before: {
              charges_enabled: priorRow.charges_enabled,
              payouts_enabled: priorRow.payouts_enabled,
              requirements: priorRow.requirements,
            },
            after: {
              charges_enabled: account.charges_enabled ?? false,
              payouts_enabled: account.payouts_enabled ?? false,
              requirements: account.requirements ?? {},
            },
          });
        } catch (auditErr) {
          // Audit failure should not block webhook processing
          console.error("[stripe-webhook] audit write failed:", auditErr);
        }
      }
    } else {
      // Other event types: recorded but processing deferred to B3/B4
      console.log(
        `[stripe-webhook] event ${event.type} recorded; B3/B4 will wire processing`,
      );
    }
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err);
    console.error(
      `[stripe-webhook] processing failed for ${event.type} (event_id=${event.id}):`,
      processingError,
    );
  }

  // Step 8 — Mark row processed (or error) — durable queue pattern
  const updatePayload: Record<string, unknown> = {
    processed: processingError === null,
    processed_at: new Date().toISOString(),
  };
  if (processingError !== null) {
    updatePayload.error = processingError;
  }
  const { error: markError } = await supabase
    .from("payment_webhook_events")
    .update(updatePayload)
    .eq("id", eventRowId);

  if (markError) {
    console.error("[stripe-webhook] mark processed failed:", markError);
  }

  // Step 9-10 — Always return 200 to Stripe (durable queue handles errors)
  return plainResponse({ status: "ok", event_id: event.id }, 200);
});
