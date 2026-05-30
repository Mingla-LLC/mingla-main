// ORCH-1006 — Surface 4. Business-callable probe: does this brand have an
// ACTIVE Stripe tax registration? Drives the authoring VAT row (a brand can
// only choose "VAT included in price" / pass VAT once Stripe knows where they
// are registered). Read-only. Fail-closed: any ambiguity → hasActiveRegistration
// false (the UI then shows the "Set up VAT" nudge and the VAT stays absorbed).
//
// Mirrors the registration gate the checkout engine already runs server-side
// (ticket-checkout-create/index.ts:1048), using the SAME restricted key
// (STRIPE_RAK_TICKET_CHECKOUT) and the same Connect direct-charge pattern
// (per-request { stripeAccount } header — the registration lives on the
// connected account, not the platform).
//
// Stripe API doc: https://docs.stripe.com/api/tax/registrations/list

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  requirePaymentsManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: { brand_id?: string; brandId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "validation_error", detail: "invalid_json" },
      400,
    );
  }

  const brandId = body.brand_id ?? body.brandId;
  if (!isValidUuid(brandId)) {
    return jsonResponse(
      { error: "validation_error", detail: "brand_id_invalid_uuid" },
      400,
    );
  }

  const supabase = serviceRoleClient();
  // Owner gate — only a payments manager for this brand may probe its account.
  const forbidden = await requirePaymentsManager(supabase, brandId, userId);
  if (forbidden) return forbidden;

  const { data: account, error: accountError } = await supabase
    .from("stripe_connect_accounts")
    .select("stripe_account_id, detached_at")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (accountError) return jsonResponse({ error: "internal_error" }, 500);

  // No connected account (or detached) → cannot have a tax registration.
  // Return a clean negative (200), NOT an error — the UI just wants the boolean.
  if (!account?.stripe_account_id || account.detached_at !== null) {
    return jsonResponse({
      hasActiveRegistration: false,
      reason: "not_connected",
    });
  }

  try {
    const stripe = stripeTicketCheckout();
    // @ts-ignore — Stripe SDK Tax namespace is runtime-provided in Deno.
    const regs = await stripe.tax.registrations.list(
      { status: "active" },
      { stripeAccount: account.stripe_account_id },
    );
    const hasActiveRegistration =
      Array.isArray(regs?.data) && regs.data.length > 0;
    return jsonResponse({ hasActiveRegistration });
  } catch (err) {
    // Fail-closed: probe failure → treat as unregistered (non-fatal). The
    // engine likewise degrades to brand-absorbed VAT at checkout, so the UI
    // and the money path agree even when this probe can't resolve.
    console.error(
      "[brand-tax-registrations-list] registrations.list failed (degrade):",
      err instanceof Error ? err.message : err,
    );
    return jsonResponse({
      hasActiveRegistration: false,
      reason: "probe_failed",
    });
  }
});
