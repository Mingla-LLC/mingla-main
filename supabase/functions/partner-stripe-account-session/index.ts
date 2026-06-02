/**
 * partner-stripe-account-session — mints a fresh embedded Account Session
 * for an already-onboarding partner. ORCH-1052.
 *
 * Mirrors brand-stripe-account-session but keyed on
 * creator_accounts.id / partner_stripe_connect_accounts (no brand_id).
 *
 * POST body:
 *   { surface: "account_management" | "onboarding",
 *     business_web_origin_override?: string }
 *
 * Response (200):
 *   { client_secret, account_id, target_url }
 *
 * Stripe API: POST /v1/account_sessions. Cites
 * https://docs.stripe.com/api/account_sessions/create.md.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  type AccountSessionComponents,
  createAccountSession,
} from "../_shared/stripeBlueprintClient.ts";
import { resolveBusinessWebOrigin } from "../_shared/businessWebOrigin.ts";
import {
  corsHeaders,
  jsonResponse,
  requireUserId,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";

const BUSINESS_WEB_ORIGIN = Deno.env.get("BUSINESS_WEB_ORIGIN");
if (!BUSINESS_WEB_ORIGIN) {
  throw new Error(
    "BUSINESS_WEB_ORIGIN env var is not set. Configure in Supabase secrets.",
  );
}

type AccountSessionSurface = "account_management" | "onboarding";

interface RequestBody {
  surface?: AccountSessionSurface;
  business_web_origin_override?: string;
}

interface PartnerScaRow {
  id: string;
  stripe_account_id: string | null;
  detached_at: string | null;
  country: string | null;
}

function isSurface(value: unknown): value is AccountSessionSurface {
  return value === "account_management" || value === "onboarding";
}

function targetPathForSurface(surface: AccountSessionSurface): string {
  return surface === "account_management"
    ? "/connect-partner-account-management"
    : "/connect-partner-onboarding";
}

function componentsForSurface(
  surface: AccountSessionSurface,
): AccountSessionComponents {
  if (surface === "account_management") {
    return {
      account_management: {
        enabled: true,
        features: {
          external_account_collection: true,
          disable_stripe_user_authentication: false,
        },
      },
      notification_banner: {
        enabled: true,
        features: { external_account_collection: true },
      },
    };
  }
  return {
    account_onboarding: {
      enabled: true,
      features: { external_account_collection: true },
    },
  };
}

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

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "validation_error", detail: "invalid_json" },
      400,
    );
  }

  const businessWebOriginResult = resolveBusinessWebOrigin({
    configuredOrigin: BUSINESS_WEB_ORIGIN,
    override: body.business_web_origin_override,
  });
  if (!businessWebOriginResult.ok) {
    return jsonResponse(
      { error: "validation_error", detail: businessWebOriginResult.detail },
      400,
    );
  }
  const businessWebOrigin = businessWebOriginResult.origin;

  if (!isSurface(body.surface)) {
    return jsonResponse(
      { error: "validation_error", detail: "surface_invalid" },
      400,
    );
  }

  const supabase = serviceRoleClient();

  // Gate: partner_enabled true.
  const { data: account, error: accountErr } = await supabase
    .from("creator_accounts")
    .select("id, partner_enabled")
    .eq("id", userId)
    .maybeSingle();
  if (accountErr) {
    console.error("[partner-stripe-account-session] account read failed:", accountErr);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!account || account.partner_enabled !== true) {
    return jsonResponse(
      { error: "forbidden", detail: "not_a_partner" },
      403,
    );
  }

  const { data: scaRow, error: scaErr } = await supabase
    .from("partner_stripe_connect_accounts")
    .select("id, stripe_account_id, detached_at, country")
    .eq("account_id", userId)
    .maybeSingle<PartnerScaRow>();
  if (scaErr) {
    console.error("[partner-stripe-account-session] sca read failed:", scaErr);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!scaRow?.stripe_account_id || scaRow.detached_at !== null) {
    return jsonResponse({ error: "partner_not_onboarded" }, 404);
  }

  let accountSession: { client_secret: string };
  try {
    accountSession = await createAccountSession({
      accountId: scaRow.stripe_account_id,
      components: componentsForSurface(body.surface),
      idempotencyKey: generateIdempotencyKey(
        userId,
        `partner_${body.surface}:${scaRow.stripe_account_id}`,
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[partner-stripe-account-session] account_session create failed:",
      message,
    );
    return jsonResponse({ error: "stripe_api_error", detail: message }, 502);
  }

  const url = new URL(targetPathForSurface(body.surface), `${businessWebOrigin}/`);
  url.searchParams.set("session", accountSession.client_secret);
  url.searchParams.set("account_id", userId);
  url.searchParams.set("return_to", "mingla-business://partner-onboarding-complete");

  await writeAudit(supabase as never, {
    user_id: userId,
    brand_id: null,
    action: "partner_stripe_connect.account_session_created",
    target_type: "partner_stripe_connect_account",
    target_id: scaRow.id,
    after: {
      stripe_account_id: scaRow.stripe_account_id,
      surface: body.surface,
    },
  });

  return jsonResponse({
    client_secret: accountSession.client_secret,
    account_id: scaRow.stripe_account_id,
    target_url: url.toString(),
  });
});
