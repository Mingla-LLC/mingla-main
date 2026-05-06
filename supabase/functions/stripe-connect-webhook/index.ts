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
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  mapStripePayoutStatus,
  projectStripeAccountToConnectRow,
} from "../_shared/stripeConnectProjection.ts";
import { serviceRoleClient } from "../_shared/stripeEdgeAuth.ts";

type ConnectEvent = Stripe.Event & { account?: string | null };

function connectedAccountId(event: ConnectEvent): string | null {
  const a = event.account;
  if (typeof a === "string" && a.length > 0) return a;
  const obj = event.data?.object as { id?: string } | undefined;
  if (event.type === "account.updated") {
    return typeof obj?.id === "string" ? obj.id : null;
  }
  return null;
}

async function syncAccountById(
  admin: SupabaseClient,
  stripe: Stripe,
  accountId: string,
): Promise<void> {
  const account = await stripe.accounts.retrieve(accountId);
  const { data: row } = await admin
    .from("stripe_connect_accounts")
    .select("brand_id")
    .eq("stripe_account_id", account.id)
    .maybeSingle();

  const brandId =
    (row?.brand_id as string | undefined) ??
    (account.metadata?.brand_id !== undefined && account.metadata.brand_id !== ""
      ? account.metadata.brand_id
      : undefined);

  if (brandId === undefined || brandId === "") {
    console.warn("[stripe-connect-webhook] syncAccountById: no brand for", account.id);
    return;
  }

  const proj = projectStripeAccountToConnectRow(account);
  const { error: upErr } = await admin.from("stripe_connect_accounts").upsert(
    {
      brand_id: brandId,
      stripe_account_id: proj.stripe_account_id,
      account_type: proj.account_type,
      charges_enabled: proj.charges_enabled,
      payouts_enabled: proj.payouts_enabled,
      requirements: proj.requirements,
    },
    { onConflict: "brand_id" },
  );
  if (upErr !== null) {
    throw new Error(`stripe_connect_accounts upsert: ${upErr.message}`);
  }

  const { error: bErr } = await admin
    .from("brands")
    .update({
      stripe_connect_id: account.id,
      stripe_charges_enabled: proj.charges_enabled,
      stripe_payouts_enabled: proj.payouts_enabled,
    })
    .eq("id", brandId);

  if (bErr !== null) {
    console.error("[stripe-connect-webhook] brands update:", bErr.message);
  }
}

async function handleDeauthorize(
  admin: SupabaseClient,
  connectedAccountId: string,
): Promise<void> {
  const { data: row } = await admin
    .from("stripe_connect_accounts")
    .select("brand_id")
    .eq("stripe_account_id", connectedAccountId)
    .maybeSingle();

  const brandId = row?.brand_id as string | undefined;
  if (brandId === undefined) return;

  await admin.from("stripe_connect_accounts").delete().eq("brand_id", brandId);
  await admin
    .from("brands")
    .update({
      stripe_connect_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    })
    .eq("id", brandId);
}

async function upsertPayout(
  admin: SupabaseClient,
  brandId: string,
  p: Stripe.Payout,
): Promise<void> {
  const cur = (p.currency ?? "gbp").toUpperCase().padEnd(3, " ").slice(0, 3);
  const { error } = await admin.from("payouts").upsert(
    {
      brand_id: brandId,
      stripe_payout_id: p.id,
      amount_cents: p.amount,
      currency: cur,
      status: mapStripePayoutStatus(p.status),
      arrival_date: p.arrival_date ?? null,
    },
    { onConflict: "stripe_payout_id" },
  );
  if (error !== null) {
    throw new Error(`payouts upsert: ${error.message}`);
  }
}

async function processConnectEvent(
  admin: SupabaseClient,
  stripe: Stripe,
  event: ConnectEvent,
): Promise<void> {
  const type = event.type;
  const acctHeader = connectedAccountId(event);

  switch (type) {
    case "account.updated": {
      const obj = event.data.object as Stripe.Account;
      await syncAccountById(admin, stripe, obj.id);
      break;
    }
    case "capability.updated":
    case "person.updated":
    case "person.created": {
      if (acctHeader === null) break;
      await syncAccountById(admin, stripe, acctHeader);
      break;
    }
    case "account.application.deauthorized": {
      if (acctHeader === null) break;
      await handleDeauthorize(admin, acctHeader);
      break;
    }
    case "payout.created":
    case "payout.updated":
    case "payout.paid":
    case "payout.failed":
    case "payout.canceled": {
      if (acctHeader === null) break;
      const p = event.data.object as Stripe.Payout;
      const { data: link } = await admin
        .from("stripe_connect_accounts")
        .select("brand_id")
        .eq("stripe_account_id", acctHeader)
        .maybeSingle();
      const brandId = link?.brand_id as string | undefined;
      if (brandId === undefined) break;
      await upsertPayout(admin, brandId, p);
      break;
    }
    default:
      break;
  }
}

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
