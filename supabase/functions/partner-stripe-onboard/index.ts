/**
 * partner-stripe-onboard — initiates embedded Stripe Connect onboarding for a
 * Mingla partner (account-level, NOT brand-level). ORCH-1052.
 *
 * Why account-level?
 *   Partners share revenue with brand owners across many brands; the Stripe
 *   payout identity belongs to the partner (creator_accounts.id), not to any
 *   one brand. Brand-level Stripe Connect (brand-stripe-onboard) continues to
 *   exist independently — partners get a SEPARATE Stripe account they own,
 *   which we transfer to via ORCH-1054's split pipeline.
 *
 * POST body:
 *   { country: string, return_url: string,
 *     business_web_origin_override?: string }
 *
 * Response (200):
 *   { client_secret, account_id, onboarding_url }
 *
 * Auth: Bearer JWT (verify_jwt=true). Caller's auth.uid() must satisfy
 * creator_accounts.partner_enabled = true (403 'not_a_partner' otherwise).
 *
 * Stripe API:
 *   - POST /v2/core/accounts — Accounts v2 with the Mingla recipient
 *     blueprint (controller dashboard:'none', losses/fees collector:'stripe',
 *     requirement_collection:'application' via the shared
 *     STRIPE_MANAGED_RISK_CONTROLLER). Cites
 *     https://docs.stripe.com/api/v2/accounts/create.md.
 *   - POST /v1/account_sessions — short-lived embedded session for the
 *     hosted /connect-partner-onboarding page. Cites
 *     https://docs.stripe.com/api/account_sessions/create.md.
 *
 * Mirrors brand-stripe-onboard's controller/account-session shape; the
 * country-replacement / money-movement preflight machinery from the brand
 * function isn't needed here because partner accounts are new-only for
 * ORCH-1052 (re-onboarding after detach is deferred to ORCH-1054).
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
  createAccountSession,
  createRecipientAccount,
} from "../_shared/stripeBlueprintClient.ts";
import { resolveBusinessWebOrigin } from "../_shared/businessWebOrigin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUSINESS_WEB_ORIGIN = Deno.env.get("BUSINESS_WEB_ORIGIN");
if (!BUSINESS_WEB_ORIGIN) {
  throw new Error(
    "BUSINESS_WEB_ORIGIN env var is not set. Configure in Supabase secrets.",
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
  country: string;
  return_url: string;
  business_web_origin_override?: string;
}

function isValidReturnUrl(s: unknown, businessWebOrigin: string): s is string {
  if (typeof s !== "string") return false;
  if (s.startsWith("mingla-business://")) return true;
  if (s.startsWith(`${businessWebOrigin}/`)) return true;
  return false;
}

interface JwtClaims {
  sub: string;
  email: string | null;
}

async function decodeAndVerifyJwt(token: string): Promise<JwtClaims | null> {
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;
  return { sub: data.user.id, email: data.user.email ?? null };
}

interface CreatorAccountRow {
  id: string;
  partner_enabled: boolean;
  partner_country: string | null;
  display_name: unknown;
}

interface ExistingPartnerScaRow {
  id: string;
  stripe_account_id: string;
  detached_at: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    let body: OnboardRequestBody;
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
      override: body?.business_web_origin_override,
    });
    if (!businessWebOriginResult.ok) {
      return jsonResponse(
        { error: "validation_error", detail: businessWebOriginResult.detail },
        400,
      );
    }
    const businessWebOrigin = businessWebOriginResult.origin;

    if (!isValidReturnUrl(body?.return_url, businessWebOrigin)) {
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

    // Auth.
    const authHeader = req.headers.get("authorization") ?? "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) return jsonResponse({ error: "unauthenticated" }, 401);
    const claims = await decodeAndVerifyJwt(tokenMatch[1]);
    if (!claims) return jsonResponse({ error: "unauthenticated" }, 401);
    const userId = claims.sub;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Gate: caller must be a flagged partner. NOTE: creator_accounts.id IS
    // auth.users.id — no separate user_id column. Per ORCH-1050/1051 lesson.
    const { data: account, error: accountErr } = await supabase
      .from("creator_accounts")
      .select("id, partner_enabled, partner_country, display_name")
      .eq("id", userId)
      .maybeSingle<CreatorAccountRow>();
    if (accountErr) {
      console.error("[partner-stripe-onboard] account lookup failed:", accountErr);
      return jsonResponse({ error: "internal_error" }, 500);
    }
    if (!account) {
      return jsonResponse(
        { error: "forbidden", detail: "creator_account_missing" },
        403,
      );
    }
    if (account.partner_enabled !== true) {
      return jsonResponse(
        { error: "forbidden", detail: "not_a_partner" },
        403,
      );
    }

    // Existing partner row? If active, reuse + mint a fresh AccountSession.
    const { data: existingSca, error: existingErr } = await supabase
      .from("partner_stripe_connect_accounts")
      .select("id, stripe_account_id, detached_at")
      .eq("account_id", userId)
      .maybeSingle<ExistingPartnerScaRow>();
    if (existingErr) {
      console.error("[partner-stripe-onboard] sca read failed:", existingErr);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    let stripeAccountId: string;
    let scaRowId: string | null = null;

    if (existingSca?.stripe_account_id && existingSca.detached_at === null) {
      // Active partner Stripe account — reuse.
      stripeAccountId = existingSca.stripe_account_id;
      scaRowId = existingSca.id;
    } else {
      // Fresh create — Accounts v2 with the Mingla recipient blueprint.
      // Cites https://docs.stripe.com/api/v2/accounts/create.md.
      const safeDisplay =
        typeof account.display_name === "string" &&
        account.display_name.trim().length > 0
          ? account.display_name.trim()
          : "Mingla partner";
      const contactEmail = (claims.email && claims.email.trim().length > 0)
        ? claims.email.trim()
        : "support@usemingla.com";

      let stripeAccount: { id: string };
      try {
        stripeAccount = await createRecipientAccount({
          displayName: safeDisplay,
          contactEmail,
          country,
          idempotencyKey: generateIdempotencyKey(
            userId,
            `partner_onboard_create:${country}`,
          ),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[partner-stripe-onboard] v2 account create failed:", message);
        return jsonResponse(
          { error: "stripe_api_error", detail: message },
          502,
        );
      }
      stripeAccountId = stripeAccount.id;

      // Persist mirror row.
      const { data: upserted, error: upsertErr } = await supabase
        .from("partner_stripe_connect_accounts")
        .upsert(
          {
            account_id: userId,
            stripe_account_id: stripeAccountId,
            controller_dashboard_type: "none",
            charges_enabled: false,
            payouts_enabled: false,
            requirements: {},
            country,
            // external_account_currencies left at default '[]'::jsonb;
            // ORCH-1054 wires the account.updated webhook to populate.
            detached_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "account_id" },
        )
        .select("id")
        .single();
      if (upsertErr || !upserted) {
        console.error("[partner-stripe-onboard] sca upsert failed:", upsertErr);
        return jsonResponse(
          { error: "internal_error", detail: "sca_upsert_failed" },
          500,
        );
      }
      scaRowId = upserted.id;

      // Also persist partner_country on creator_accounts so the SPEC's
      // "country chosen at partner-Stripe onboarding" column stays in sync.
      const { error: caUpdateErr } = await supabase
        .from("creator_accounts")
        .update({ partner_country: country })
        .eq("id", userId);
      if (caUpdateErr) {
        // Non-fatal: the source of truth is partner_stripe_connect_accounts.country.
        console.error(
          "[partner-stripe-onboard] partner_country update failed:",
          caUpdateErr,
        );
      }
    }

    // Mint embedded Account Session.
    // Cites https://docs.stripe.com/api/account_sessions/create.md.
    let accountSession: { client_secret: string };
    try {
      accountSession = await createAccountSession({
        accountId: stripeAccountId,
        components: {
          account_onboarding: {
            enabled: true,
            features: {
              external_account_collection: true,
            },
          },
        },
        idempotencyKey: generateIdempotencyKey(
          userId,
          `partner_onboard_session:${stripeAccountId}`,
        ),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        "[partner-stripe-onboard] account_session create failed:",
        message,
      );
      return jsonResponse(
        { error: "stripe_api_error", detail: message },
        502,
      );
    }

    const onboardingUrl = `${businessWebOrigin}/connect-partner-onboarding` +
      `?session=${encodeURIComponent(accountSession.client_secret)}` +
      `&account_id=${encodeURIComponent(userId)}` +
      `&return_to=${encodeURIComponent(body.return_url)}`;

    try {
      await writeAudit(supabase, {
        user_id: userId,
        brand_id: null,
        action: "partner_stripe_connect.onboard_initiated",
        target_type: "partner_stripe_connect_account",
        target_id: scaRowId ?? stripeAccountId,
        after: {
          stripe_account_id: stripeAccountId,
          controller_dashboard_type: "none",
          country,
          default_currency: defaultCurrencyForCountry(country),
          onboarding_surface: "mingla_hosted_embedded_components",
        },
      });
    } catch (auditErr) {
      console.error("[partner-stripe-onboard] audit write failed:", auditErr);
    }

    return jsonResponse({
      client_secret: accountSession.client_secret,
      account_id: stripeAccountId,
      onboarding_url: onboardingUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[partner-stripe-onboard] unhandled error:", message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
