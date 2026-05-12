/**
 * brand-stripe-tax-dashboard-link — generate a short-lived Stripe Express
 * Dashboard login link for a brand admin to manage their tax registrations.
 *
 * Why this exists: Stripe Tax registration is a brand-side compliance step.
 * Stripe ships an embedded `<TaxSettings />` component on web, but the
 * React Native preview SDK doesn't include it yet (confirmed via
 * https://docs.stripe.com/connect/supported-embedded-components on 2026-05-12
 * — Tax Settings is web-only GA). The brand opens Stripe Express Dashboard
 * via this login-link, navigates to "Tax registrations", and registers in
 * each jurisdiction they sell tickets in. Stripe Tax then automatically
 * collects + remits via those registrations on every tax-enabled Checkout
 * Session (ORCH-0804 / I-PROPOSED-BF).
 *
 * Auth: brand_admin+ required (uses requirePaymentsManager; same gate as
 * brand-stripe-balances).
 *
 * Audit: emits `stripe_tax.registration_link_opened` on every successful
 * call so the brand audit log captures who opened the dashboard when.
 *
 * Per ORCH-0804 SPEC §5.4.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { stripeTaxDashboardLink } from "../_shared/stripe.ts";
import { writeAudit } from "../_shared/audit.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  requirePaymentsManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

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
  const forbidden = await requirePaymentsManager(supabase, brandId, userId);
  if (forbidden) return forbidden;

  const { data: account, error: accountError } = await supabase
    .from("stripe_connect_accounts")
    .select("stripe_account_id, detached_at")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (accountError) {
    console.error(
      "[brand-stripe-tax-dashboard-link] account read failed:",
      accountError,
    );
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!account || !account.stripe_account_id) {
    return jsonResponse(
      { error: "stripe_account_not_connected" },
      409,
    );
  }
  if (account.detached_at !== null) {
    return jsonResponse(
      { error: "stripe_account_detached" },
      409,
    );
  }

  let loginLink: { url: string };
  try {
    const stripe = stripeTaxDashboardLink();
    // @ts-ignore — Stripe SDK namespace runtime-provided in Deno.
    loginLink = await stripe.accounts.createLoginLink(
      account.stripe_account_id,
      undefined,
      {
        idempotencyKey: generateIdempotencyKey(brandId, "tax_dashboard_link"),
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown_error";
    console.error(
      "[brand-stripe-tax-dashboard-link] createLoginLink failed:",
      detail,
    );
    return jsonResponse(
      { error: "stripe_login_link_failed", detail },
      502,
    );
  }

  if (typeof loginLink?.url !== "string" || loginLink.url.length === 0) {
    return jsonResponse(
      { error: "stripe_login_link_empty" },
      502,
    );
  }

  await writeAudit(supabase, {
    user_id: userId,
    brand_id: brandId,
    action: "stripe_tax.registration_link_opened",
    target_type: "stripe_connect_account",
    target_id: account.stripe_account_id,
  });

  return jsonResponse({ url: loginLink.url }, 200);
});
