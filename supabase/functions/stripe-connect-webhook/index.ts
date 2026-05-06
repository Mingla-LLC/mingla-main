/**
 * stripe-connect-webhook — Connect-scoped Stripe webhooks (issue #47).
 *
 * Configure in Stripe Dashboard with "Connected accounts" scope, or API connect=true.
 * Verifies signature, stores idempotent row in payment_webhook_events, applies handlers.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_CONNECT_WEBHOOK_SECRET
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17.4.0";
import {
  type ConnectEvent,
  processConnectEvent,
} from "../_shared/stripeConnectWebhookProcess.ts";
import { serviceRoleClient } from "../_shared/stripeEdgeAuth.ts";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (secretKey === undefined || secretKey === "" || webhookSecret === undefined || webhookSecret === "") {
    console.error("[stripe-connect-webhook] Missing STRIPE_SECRET_KEY or STRIPE_CONNECT_WEBHOOK_SECRET");
    return new Response("Server misconfigured", { status: 500 });
  }

  const stripe = new Stripe(secretKey, { apiVersion: "2024-11-20.acacia", typescript: true });
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (sig === null || sig === "") {
    return new Response("No signature", { status: 400 });
  }

  let event: ConnectEvent;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret) as ConnectEvent;
  } catch (e) {
    console.error("[stripe-connect-webhook] signature:", e);
    return new Response("Bad signature", { status: 400 });
  }

  const admin = serviceRoleClient();

  const { data: existingRow } = await admin
    .from("payment_webhook_events")
    .select("processed")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existingRow?.processed === true) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (existingRow === null) {
    const { error: insErr } = await admin.from("payment_webhook_events").insert({
      stripe_event_id: event.id,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
    });
    if (insErr !== null) {
      if (insErr.code === "23505") {
        // concurrent insert — continue to process
      } else {
        console.error("[stripe-connect-webhook] inbox insert:", insErr.message);
        return new Response("DB error", { status: 500 });
      }
    }
  }

  try {
    await processConnectEvent(admin, stripe, event);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe-connect-webhook] process:", msg);
    await admin
      .from("payment_webhook_events")
      .update({ error: msg })
      .eq("stripe_event_id", event.id);
    return new Response(JSON.stringify({ error: "process failed" }), { status: 500 });
  }

  await admin
    .from("payment_webhook_events")
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
      error: null,
    })
    .eq("stripe_event_id", event.id);

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
