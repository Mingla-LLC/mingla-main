/**
 * brand-stripe-account-session — mints embedded Connect Account Sessions.
 *
 * POST body:
 *   { brand_id: string, surface: "account_management" | "onboarding" }
 *
 * The function never creates connected accounts. It only looks up the active
 * stripe_connect_accounts row and returns a short-lived Mingla-hosted target URL.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { writeAudit } from "../_shared/audit.ts";
import { buildStripeAccountSessionOperation } from "../_shared/stripeCountryReplacement.ts";
import {
  type AccountSessionComponents,
  createAccountSession,
} from "../_shared/stripeBlueprintClient.ts";
import { resolveBusinessWebOrigin } from "../_shared/businessWebOrigin.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  requirePaymentsManager,
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
  brand_id?: string;
  brandId?: string;
  surface?: AccountSessionSurface;
  business_web_origin_override?: string;
}

interface StripeConnectAccountRow {
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
    ? "/connect-account-management"
    : "/connect-onboarding";
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
        features: {
          external_account_collection: true,
        },
      },
    };
  }

  return {
    account_onboarding: {
      enabled: true,
      features: {
        external_account_collection: true,
      },
    },
  };
}

function buildTargetUrl(input: {
  clientSecret: string;
  brandId: string;
  surface: AccountSessionSurface;
  returnTo: string;
  businessWebOrigin: string;
}): string {
  const url = new URL(
    targetPathForSurface(input.surface),
    `${input.businessWebOrigin}/`,
  );
  url.searchParams.set("session", input.clientSecret);
  url.searchParams.set("brand_id", input.brandId);
  url.searchParams.set("return_to", input.returnTo);
  return url.toString();
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

  const brandId = body.brand_id ?? body.brandId;
  const businessWebOriginResult = resolveBusinessWebOrigin({
    configuredOrigin: BUSINESS_WEB_ORIGIN,
    override: body.business_web_origin_override,
  });
  if (!businessWebOriginResult.ok) {
    return jsonResponse({
      error: "validation_error",
      detail: businessWebOriginResult.detail,
    }, 400);
  }
  const businessWebOrigin = businessWebOriginResult.origin;

  if (!isValidUuid(brandId)) {
    return jsonResponse({
      error: "validation_error",
      detail: "brand_id_invalid_uuid",
    }, 400);
  }
  if (!isSurface(body.surface)) {
    return jsonResponse({
      error: "validation_error",
      detail: "surface_invalid",
    }, 400);
  }

  const supabase = serviceRoleClient();
  const forbidden = await requirePaymentsManager(supabase, brandId, userId);
  if (forbidden) return forbidden;

  const { data: account, error: accountError } = await supabase
    .from("stripe_connect_accounts")
    .select("id, stripe_account_id, detached_at, country")
    .eq("brand_id", brandId)
    .maybeSingle<StripeConnectAccountRow>();
  if (accountError) {
    console.error(
      "[brand-stripe-account-session] account read failed:",
      accountError,
    );
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!account?.stripe_account_id || account.detached_at !== null) {
    return jsonResponse({ error: "brand_not_onboarded" }, 404);
  }

  let accountSession: { client_secret: string };
  try {
    accountSession = await createAccountSession({
      accountId: account.stripe_account_id,
      components: componentsForSurface(body.surface),
      idempotencyKey: generateIdempotencyKey(
        brandId,
        `${body.surface}:${
          buildStripeAccountSessionOperation(
            account.country ?? "UNKNOWN",
            account.stripe_account_id,
          )
        }`,
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[brand-stripe-account-session] account_session create failed:",
      message,
    );
    return jsonResponse({ error: "stripe_api_error", detail: message }, 502);
  }

  const targetUrl = buildTargetUrl({
    clientSecret: accountSession.client_secret,
    brandId,
    surface: body.surface,
    returnTo: "mingla-business://onboarding-complete",
    businessWebOrigin,
  });

  await writeAudit(supabase as never, {
    user_id: userId,
    brand_id: brandId,
    action: "stripe_connect.account_session_created",
    target_type: "stripe_connect_account",
    target_id: account.id,
    after: {
      stripe_account_id: account.stripe_account_id,
      surface: body.surface,
    },
  });

  return jsonResponse({
    client_secret: accountSession.client_secret,
    account_id: account.stripe_account_id,
    target_url: targetUrl,
  });
});
