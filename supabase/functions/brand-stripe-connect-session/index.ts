/**
 * brand-stripe-connect-session — Create Stripe Express account (if needed) + Account Session
 * for embedded Connect onboarding (Cycle B2 / issue #47).
 *
 * POST JSON: { brandId: uuid }
 * Returns: { clientSecret, publishableKey, stripeAccountId }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17.4.0";
import { corsJson, requirePaymentsManager, requireUser, serviceRoleClient } from "../_shared/stripeEdgeAuth.ts";
import { projectStripeAccountToConnectRow } from "../_shared/stripeConnectProjection.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function countryFromDefaultCurrency(currency: string): string {
  const c = currency.trim().toUpperCase();
  if (c === "USD") return "US";
  if (c === "EUR") return "IE";
  if (c === "GBP") return "GB";
  if (c === "CAD") return "CA";
  if (c === "AUD") return "AU";
  return "GB";
}

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
  const publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY");
  if (secretKey === undefined || secretKey === "" || publishableKey === undefined || publishableKey === "") {
    console.error("[brand-stripe-connect-session] Missing STRIPE_SECRET_KEY or STRIPE_PUBLISHABLE_KEY");
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
  const { data: brand, error: brandErr } = await admin
    .from("brands")
    .select("id, default_currency, contact_email")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (brandErr !== null) {
    console.error("[brand-stripe-connect-session] brand read:", brandErr.message);
    return new Response(JSON.stringify({ error: "Brand lookup failed" }), {
      status: 500,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }
  if (brand === null) {
    return new Response(JSON.stringify({ error: "Brand not found" }), {
      status: 404,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: "2024-11-20.acacia",
    typescript: true,
  });

  const { data: existingLink } = await admin
    .from("stripe_connect_accounts")
    .select("stripe_account_id")
    .eq("brand_id", brandId)
    .maybeSingle();

  let stripeAccountId: string;

  if (existingLink !== null && existingLink.stripe_account_id !== null && existingLink.stripe_account_id !== "") {
    stripeAccountId = existingLink.stripe_account_id as string;
  } else {
    const currency = String(brand.default_currency ?? "GBP");
    const country = countryFromDefaultCurrency(currency);

    const account = await stripe.accounts.create({
      type: "express",
      country,
      email: brand.contact_email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { brand_id: brandId },
    });

    stripeAccountId = account.id;
    const proj = projectStripeAccountToConnectRow(account);

    const { error: insErr } = await admin.from("stripe_connect_accounts").insert({
      brand_id: brandId,
      stripe_account_id: proj.stripe_account_id,
      account_type: proj.account_type,
      charges_enabled: proj.charges_enabled,
      payouts_enabled: proj.payouts_enabled,
      requirements: proj.requirements,
    });

    if (insErr !== null) {
      console.error("[brand-stripe-connect-session] insert stripe_connect_accounts:", insErr.message);
      return new Response(JSON.stringify({ error: "Failed to persist Connect account" }), {
        status: 500,
        headers: { ...corsJson, "Content-Type": "application/json" },
      });
    }

    const { error: brandUpdErr } = await admin
      .from("brands")
      .update({
        stripe_connect_id: stripeAccountId,
        stripe_charges_enabled: proj.charges_enabled,
        stripe_payouts_enabled: proj.payouts_enabled,
      })
      .eq("id", brandId);

    if (brandUpdErr !== null) {
      console.error("[brand-stripe-connect-session] update brands:", brandUpdErr.message);
    }
  }

  try {
    const session = await stripe.accountSessions.create({
      account: stripeAccountId,
      components: {
        account_onboarding: { enabled: true },
      },
    });

    return new Response(
      JSON.stringify({
        clientSecret: session.client_secret,
        publishableKey,
        stripeAccountId,
      }),
      { status: 200, headers: { ...corsJson, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[brand-stripe-connect-session] accountSessions.create:", e);
    return new Response(JSON.stringify({ error: "Could not start onboarding session" }), {
      status: 502,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }
});
