/**
 * brand-stripe-balances — Connected account Balance (available + pending) for KPI tiles.
 *
 * POST JSON: { brandId: uuid }
 * Returns: { availableMinor, pendingMinor, currency } (minor units = cents).
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
  const { data: brand, error: bErr } = await admin
    .from("brands")
    .select("default_currency")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (bErr !== null || brand === null) {
    return new Response(JSON.stringify({ error: "Brand not found" }), {
      status: 404,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }

  const { data: link } = await admin
    .from("stripe_connect_accounts")
    .select("stripe_account_id")
    .eq("brand_id", brandId)
    .maybeSingle();

  const acct = link?.stripe_account_id as string | undefined;
  if (acct === undefined || acct === "") {
    return new Response(
      JSON.stringify({ availableMinor: 0, pendingMinor: 0, currency: String(brand.default_currency).trim().toUpperCase() }),
      { status: 200, headers: { ...corsJson, "Content-Type": "application/json" } },
    );
  }

  const cur = String(brand.default_currency).trim().toLowerCase();
  const stripe = new Stripe(secretKey, { apiVersion: "2024-11-20.acacia", typescript: true });

  try {
    const balance = await stripe.balance.retrieve({ stripeAccount: acct });
    const avail = balance.available.find((x) => x.currency === cur)?.amount ?? 0;
    const pend = balance.pending.find((x) => x.currency === cur)?.amount ?? 0;
    return new Response(
      JSON.stringify({
        availableMinor: avail,
        pendingMinor: pend,
        currency: cur.toUpperCase(),
      }),
      { status: 200, headers: { ...corsJson, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[brand-stripe-balances]", e);
    return new Response(JSON.stringify({ error: "Stripe balance failed" }), {
      status: 502,
      headers: { ...corsJson, "Content-Type": "application/json" },
    });
  }
});
