/**
 * brand-stripe-onboard — initiates Stripe Accounts v2 hosted onboarding for a brand.
 *
 * POST request body:
 *   { brand_id: string (UUID), return_url: string }
 *
 * Response (200 OK):
 *   { client_secret: null, account_id: string, onboarding_url: string }
 *
 * Auth: Bearer JWT (Supabase auth). Caller must satisfy
 * biz_can_manage_payments_for_brand(brand_id, user_id) per D-B2-1 + D-V3-5.
 * (Service-role context resolves user_id from verified JWT; cannot rely on
 * auth.uid() the way the *_for_caller variant does.)
 *
 * Architecture:
 *  - Creates Stripe Accounts v2 account via POST /v2/core/accounts using the
 *    ORCH-0764 recipient configuration blueprint.
 *  - Inserts/upserts stripe_connect_accounts row; trigger tg_sync_brand_stripe_cache
 *    mirrors stripe_account_id to brands.stripe_connect_id.
 *  - Creates hosted Account Link via POST /v2/core/account_links.
 *  - Returns Stripe-hosted onboarding URL.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  defaultCurrencyForCountry,
  normalizeStripeCountry,
} from "../_shared/stripeSupportedCountries.ts";
import {
  createRecipientAccount,
  createRecipientAccountLink,
} from "../_shared/stripeBlueprintClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// B2a Path C V3 forensics R-1: was `?? "https://business.mingla.com"` —
// that domain isn't Mingla-owned (NXDOMAIN). Now strictly required from env
// to prevent silent fallback to a broken URL. Operator sets via
// `supabase secrets set MINGLA_BUSINESS_WEB_URL=https://business.usemingla.com`.
const ONBOARDING_PAGE_URL = Deno.env.get("MINGLA_BUSINESS_WEB_URL");
if (!ONBOARDING_PAGE_URL) {
  throw new Error(
    "MINGLA_BUSINESS_WEB_URL env var is not set. Configure in Supabase secrets.",
  );
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface OnboardRequestBody {
  brand_id: string;
  return_url: string;
  country: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_REGEX.test(s);
}

function isValidReturnUrl(s: unknown): s is string {
  // B2a Path C V3 forensics C-2: was hardcoded to business.mingla.com (NXDOMAIN).
  // Now reads from env-backed ONBOARDING_PAGE_URL so the validation matches the
  // canonical platform URL whatever the operator configures.
  if (typeof s !== "string") return false;
  if (s.startsWith("mingla-business://")) return true;
  if (s.startsWith(`${ONBOARDING_PAGE_URL}/`)) return true;
  return false;
}

interface JwtClaims {
  sub: string;
  email: string | null;
  exp?: number;
}

async function decodeAndVerifyJwt(
  token: string,
): Promise<JwtClaims | null> {
  // Use Supabase Auth's verify by calling getUser via the supabase-js client
  // with the raw token. This avoids needing JWT secret + manual signature check.
  // The service-role client below will still be used for DB writes.
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;
  return { sub: data.user.id, email: data.user.email ?? null };
}

function buildStripeAccountLinkRedirectUrl(
  appReturnUrl: string,
  kind: "return" | "refresh",
): string {
  const url = new URL("/stripe-onboarding-return", `${ONBOARDING_PAGE_URL}/`);
  url.searchParams.set("return_to", appReturnUrl);
  if (kind === "refresh") {
    url.searchParams.set("stripe_onboarding_refresh", "1");
  }
  return url.toString();
}

function safeDisplayName(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "Mingla organiser";
}

function safeContactEmail(
  brandEmail: unknown,
  userEmail: string | null,
): string {
  if (typeof brandEmail === "string" && brandEmail.trim().length > 0) {
    return brandEmail.trim();
  }
  if (userEmail && userEmail.trim().length > 0) {
    return userEmail.trim();
  }
  return "support@usemingla.com";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    // Parse and validate body.
    let body: OnboardRequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: "validation_error", detail: "invalid_json" },
        400,
      );
    }
    if (!isValidUuid(body?.brand_id)) {
      return jsonResponse(
        { error: "validation_error", detail: "brand_id_invalid_uuid" },
        400,
      );
    }
    if (!isValidReturnUrl(body?.return_url)) {
      return jsonResponse(
        { error: "validation_error", detail: "return_url_invalid_scheme" },
        400,
      );
    }
    const country = normalizeStripeCountry(body?.country);
    if (!country) {
      return jsonResponse(
        { error: "validation_error", detail: "country_unsupported" },
        400,
      );
    }
    const { brand_id, return_url } = body;

    // Authenticate caller.
    const authHeader = req.headers.get("authorization") ?? "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return jsonResponse({ error: "unauthenticated" }, 401);
    }
    const claims = await decodeAndVerifyJwt(tokenMatch[1]);
    if (!claims) {
      return jsonResponse({ error: "unauthenticated" }, 401);
    }
    const userId = claims.sub;

    // Service-role client for DB writes.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Permission check via biz_can_manage_payments_for_brand RPC.
    const { data: canManage, error: permError } = await supabase.rpc(
      "biz_can_manage_payments_for_brand",
      { p_brand_id: brand_id, p_user_id: userId },
    );
    if (permError) {
      console.error("[brand-stripe-onboard] permission RPC failed:", permError);
      return jsonResponse({ error: "internal_error" }, 500);
    }
    if (canManage !== true) {
      return jsonResponse(
        { error: "forbidden", detail: "permission_denied" },
        403,
      );
    }

    const { data: tosRow, error: tosError } = await supabase
      .from("brand_team_members")
      .select("mingla_tos_accepted_at")
      .eq("brand_id", brand_id)
      .eq("user_id", userId)
      .is("removed_at", null)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (tosError) {
      console.error("[brand-stripe-onboard] ToS lookup failed:", tosError);
      return jsonResponse({ error: "internal_error" }, 500);
    }
    if (!tosRow?.mingla_tos_accepted_at) {
      return jsonResponse(
        { error: "forbidden", detail: "mingla_tos_not_accepted" },
        403,
      );
    }

    // Read existing stripe_connect_accounts row for brand_id.
    const { data: existingSca, error: scaReadError } = await supabase
      .from("stripe_connect_accounts")
      .select("id, stripe_account_id, detached_at, country, default_currency")
      .eq("brand_id", brand_id)
      .maybeSingle();
    if (scaReadError) {
      console.error("[brand-stripe-onboard] sca read failed:", scaReadError);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    let stripeAccountId: string;
    let scaRowId: string | null = null;

    if (existingSca?.stripe_account_id) {
      // V2 reactivation: reuse Stripe account and clear the local soft detach.
      stripeAccountId = existingSca.stripe_account_id;
      scaRowId = existingSca.id;
      if (
        existingSca.detached_at !== null &&
        existingSca.detached_at !== undefined
      ) {
        const { error: reactivateError } = await supabase
          .from("stripe_connect_accounts")
          .update({
            detached_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingSca.id);
        if (reactivateError) {
          console.error(
            "[brand-stripe-onboard] reactivation update failed:",
            reactivateError,
          );
          return jsonResponse({ error: "internal_error" }, 500);
        }
        await writeAudit(supabase, {
          user_id: userId,
          brand_id,
          action: "stripe_connect.reactivated",
          target_type: "stripe_connect_account",
          target_id: stripeAccountId,
          before: { detached_at: existingSca.detached_at },
          after: { detached_at: null },
        });
      }
    } else {
      // Read brand details for currency, display name, and contact email.
      const { data: brandRow, error: brandReadError } = await supabase
        .from("brands")
        .select("name, contact_email, default_currency")
        .eq("id", brand_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (brandReadError) {
        console.error(
          "[brand-stripe-onboard] brand read failed:",
          brandReadError,
        );
        return jsonResponse({ error: "internal_error" }, 500);
      }
      if (!brandRow) {
        return jsonResponse(
          { error: "validation_error", detail: "brand_not_found" },
          400,
        );
      }
      const defaultCurrency = defaultCurrencyForCountry(country);

      // Create Stripe Accounts v2 recipient account.
      let stripeAccount: { id: string };
      try {
        stripeAccount = await createRecipientAccount({
          displayName: safeDisplayName(brandRow.name),
          contactEmail: safeContactEmail(brandRow.contact_email, claims.email),
          country,
          idempotencyKey: generateIdempotencyKey(brand_id, "onboard_create"),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[brand-stripe-onboard] v2 account create failed:",
          message,
        );
        return jsonResponse(
          { error: "stripe_api_error", detail: message },
          502,
        );
      }
      stripeAccountId = stripeAccount.id;

      // Insert stripe_connect_accounts row (ON CONFLICT handles race).
      const { data: scaInsert, error: scaInsertError } = await supabase
        .from("stripe_connect_accounts")
        .upsert(
          {
            brand_id,
            stripe_account_id: stripeAccountId,
            controller_dashboard_type: "express",
            charges_enabled: false,
            payouts_enabled: false,
            requirements: {},
            country,
            default_currency: defaultCurrency,
          },
          { onConflict: "brand_id" },
        )
        .select("id, stripe_account_id")
        .single();
      if (scaInsertError || !scaInsert) {
        console.error(
          "[brand-stripe-onboard] sca insert failed:",
          scaInsertError,
        );
        return jsonResponse(
          { error: "internal_error", detail: "sca_insert_failed" },
          500,
        );
      }
      // If a race occurred, the upsert returns the existing row's account_id
      // which Stripe's idempotency-key ensured is the SAME account we just created.
      stripeAccountId = scaInsert.stripe_account_id;
      scaRowId = scaInsert.id;
    }

    // Create hosted Account Link.
    let accountLink: { url: string };
    try {
      accountLink = await createRecipientAccountLink({
        accountId: stripeAccountId,
        refreshUrl: buildStripeAccountLinkRedirectUrl(return_url, "refresh"),
        returnUrl: buildStripeAccountLinkRedirectUrl(return_url, "return"),
        idempotencyKey: generateIdempotencyKey(
          brand_id,
          existingSca?.detached_at
            ? "onboard_reactivate_link"
            : "onboard_account_link",
        ),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        "[brand-stripe-onboard] v2 account link create failed:",
        message,
      );
      return jsonResponse(
        { error: "stripe_api_error", detail: message },
        502,
      );
    }

    // Audit log.
    try {
      await writeAudit(supabase, {
        user_id: userId,
        brand_id,
        action: "stripe_connect.onboard_initiated",
        target_type: "stripe_connect_account",
        target_id: scaRowId ?? stripeAccountId,
        after: {
          stripe_account_id: stripeAccountId,
          controller_dashboard_type: "express",
          country,
          onboarding_surface: "stripe_hosted_account_link",
        },
      });
    } catch (auditErr) {
      // Per Const #3: surface but don't fail the onboarding (link was created).
      console.error("[brand-stripe-onboard] audit write failed:", auditErr);
    }

    // Return success. client_secret stays null for typed backward compatibility;
    // hosted Account Link onboarding does not depend on embedded components.
    return jsonResponse({
      client_secret: null,
      account_id: stripeAccountId,
      onboarding_url: accountLink.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brand-stripe-onboard] unhandled error:", message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
