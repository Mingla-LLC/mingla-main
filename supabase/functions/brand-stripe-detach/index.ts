/**
 * brand-stripe-detach — Disconnect Stripe Express account from a brand (J-B2.5).
 *
 * POST JSON: { brandId: uuid }
 * Deletes the connected account in Stripe when possible, then clears local rows.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17.4.0";
import { corsJson, requirePaymentsManager, requireUser, serviceRoleClient } from "../_shared/stripeEdgeAuth.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsJson });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (secretKey === undefined || secretKey === "") {
    return new Response(JSON.stringify({ error: "Stripe not configured" }), {
      status: 500,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  const auth = await requireUser(req);
  if (auth instanceof Response) {
    const text = await auth.text();
    return new Response(text, {
      status: auth.status,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  let body: { brandId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  const brandId = body.brandId;
  if (brandId === undefined || !UUID_RE.test(brandId)) {
    return new Response(JSON.stringify({ error: "brandId must be a UUID" }), {
      status: 400,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  const forbidden = await requirePaymentsManager(auth.userClient, brandId);
  if (forbidden !== null) {
    const text = await forbidden.text();
    return new Response(text, {
      status: forbidden.status,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  const admin = serviceRoleClient();
  const { data: link } = await admin
    .from("stripe_connect_accounts")
    .select("stripe_account_id")
    .eq("brand_id", brandId)
    .maybeSingle();

  const stripeAccountId = link?.stripe_account_id as string | undefined;

  const stripe = new Stripe(secretKey, { apiVersion: "2024-11-20.acacia", typescript: true });

  if (stripeAccountId !== undefined && stripeAccountId !== "") {
    try {
      await stripe.accounts.del(stripeAccountId);
    } catch (e) {
      console.warn("[brand-stripe-detach] accounts.del:", e);
      // Continue with local cleanup — Stripe may reject if balance due, etc.
    }
  }

  const { error: delErr } = await admin.from("stripe_connect_accounts").delete().eq("brand_id", brandId);
  if (delErr !== null) {
    console.error("[brand-stripe-detach] delete stripe_connect_accounts:", delErr.message);
  }

  const { error: brandErr } = await admin
    .from("brands")
    .update({
      stripe_connect_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    })
    .eq("id", brandId);

  if (brandErr !== null) {
    console.error("[brand-stripe-detach] update brands:", brandErr.message);
    return new Response(JSON.stringify({ error: "Failed to clear brand Stripe fields" }), {
      status: 500,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsJson, "Content-Type": "application/json" },
  });
});
