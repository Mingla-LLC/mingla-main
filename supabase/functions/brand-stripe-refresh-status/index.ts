/**
 * brand-stripe-refresh-status — Pull latest Account object from Stripe and sync DB.
 *
 * POST JSON: { brandId: uuid }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17.4.0";
import { projectStripeAccountToConnectRow } from "../_shared/stripeConnectProjection.ts";
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
  const { data: link, error: linkErr } = await admin
    .from("stripe_connect_accounts")
    .select("stripe_account_id")
    .eq("brand_id", brandId)
    .maybeSingle();

  if (linkErr !== null) {
    console.error("[brand-stripe-refresh-status] link read:", linkErr.message);
    return new Response(JSON.stringify({ error: "Lookup failed" }), {
      status: 500,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  if (link === null || link.stripe_account_id === null || link.stripe_account_id === "") {
    return new Response(JSON.stringify({ error: "No Connect account for brand" }), {
      status: 404,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(secretKey, { apiVersion: "2024-11-20.acacia", typescript: true });

  try {
    const account = await stripe.accounts.retrieve(link.stripe_account_id as string);
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
      console.error("[brand-stripe-refresh-status] upsert connect:", upErr.message);
      return new Response(JSON.stringify({ error: "Persist failed" }), {
        status: 500,
        headers: { ...corsJson, "Content-Type": "application/json" },
      });
    }

    const { error: brandErr } = await admin
      .from("brands")
      .update({
        stripe_connect_id: account.id,
        stripe_charges_enabled: proj.charges_enabled,
        stripe_payouts_enabled: proj.payouts_enabled,
      })
      .eq("id", brandId);

    if (brandErr !== null) {
      console.error("[brand-stripe-refresh-status] update brands:", brandErr.message);
    }

    return new Response(
      JSON.stringify({
        stripeAccountId: account.id,
        chargesEnabled: proj.charges_enabled,
        payoutsEnabled: proj.payouts_enabled,
        requirements: proj.requirements,
      }),
      { status: 200, headers: { ...corsJson, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[brand-stripe-refresh-status] Stripe retrieve:", e);
    return new Response(JSON.stringify({ error: "Stripe retrieve failed" }), {
      status: 502,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }
});
