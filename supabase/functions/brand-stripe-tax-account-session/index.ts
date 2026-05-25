// ORCH-0955 — mints a Stripe AccountSession for embedded Tax components.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createStripeClient } from "../_shared/stripe.ts";
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
    return jsonResponse({
      error: "validation_error",
      detail: "brand_id_invalid_uuid",
    }, 400);
  }

  const supabase = serviceRoleClient();
  const forbidden = await requirePaymentsManager(supabase, brandId, userId);
  if (forbidden) return forbidden;

  const { data: account, error: accountError } = await supabase
    .from("stripe_connect_accounts")
    .select("stripe_account_id, detached_at")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (accountError) return jsonResponse({ error: "internal_error" }, 500);
  if (!account?.stripe_account_id) {
    return jsonResponse({ error: "stripe_account_not_connected" }, 409);
  }
  if (account.detached_at !== null) {
    return jsonResponse({ error: "stripe_account_detached" }, 409);
  }

  let sessionResult: { client_secret?: string; expires_at?: number };
  try {
    const stripe = createStripeClient("STRIPE_RAK_ONBOARD");
    // orch-strict-grep-allow stripe-no-tos-gate — ToS is enforced upstream by requirePaymentsManager (line 56) which checks biz_can_manage_payments_for_brand RPC; that RPC verifies brand_team_members.mingla_tos_accepted_at IS NOT NULL. No state mutation on the Stripe side until the embedded Tax UI itself prompts brand admin to enable a registration; this call only mints a short-lived session secret.
    // @ts-ignore — Stripe SDK AccountSessions namespace is runtime-provided.
    sessionResult = await stripe.accountSessions.create(
      {
        account: account.stripe_account_id,
        components: {
          tax_registrations: { enabled: true },
          tax_settings: { enabled: true },
        },
      },
      {
        idempotencyKey: generateIdempotencyKey(brandId, "tax_account_session"),
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown_error";
    console.error(
      "[brand-stripe-tax-account-session] accountSessions.create failed:",
      detail,
    );
    return jsonResponse(
      { error: "stripe_account_session_failed", detail },
      502,
    );
  }

  if (
    typeof sessionResult.client_secret !== "string" ||
    sessionResult.client_secret.length === 0
  ) {
    return jsonResponse({ error: "stripe_account_session_empty" }, 502);
  }

  await writeAudit(supabase as never, {
    user_id: userId,
    brand_id: brandId,
    action: "stripe_tax.account_session_minted",
    target_type: "stripe_connect_account",
    target_id: account.stripe_account_id,
  });

  return jsonResponse({
    clientSecret: sessionResult.client_secret,
    expiresAt: sessionResult.expires_at ?? null,
    brandStripeAccountId: account.stripe_account_id,
  });
});
