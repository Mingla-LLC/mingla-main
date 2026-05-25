/**
 * brand-stripe-onboard — initiates embedded Stripe Connect onboarding for a brand.
 *
 * POST request body:
 *   { brand_id: string (UUID), return_url: string }
 *
 * Response (200 OK):
 *   { client_secret: string, account_id: string, onboarding_url: string }
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
 *  - Creates Account Session via POST /v1/account_sessions.
 *  - Returns Mingla-hosted onboarding URL for Stripe embedded components.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { writeAudit } from "../_shared/audit.ts";
import { stripeDetach, stripeRefreshStatus } from "../_shared/stripe.ts";
import {
  buildStripeAccountSessionOperation,
  buildStripeOnboardCreateOperation,
  decideStripeCountryReplacement,
} from "../_shared/stripeCountryReplacement.ts";
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
  brand_id: string;
  return_url: string;
  country: string;
  business_web_origin_override?: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_REGEX.test(s);
}

function isValidReturnUrl(s: unknown, businessWebOrigin: string): s is string {
  // B2a Path C V3 forensics C-2: was hardcoded to business.mingla.com (NXDOMAIN).
  // Now reads from env-backed ONBOARDING_PAGE_URL so the validation matches the
  // canonical platform URL whatever the operator configures.
  if (typeof s !== "string") return false;
  if (s.startsWith("mingla-business://")) return true;
  if (s.startsWith(`${businessWebOrigin}/`)) return true;
  return false;
}

interface JwtClaims {
  sub: string;
  email: string | null;
  exp?: number;
}

interface ExistingScaRow {
  id: string;
  stripe_account_id: string | null;
  detached_at: string | null;
  country: string | null;
  default_currency: string | null;
  charges_enabled: boolean | null;
  payouts_enabled: boolean | null;
  requirements: Record<string, unknown> | null;
}

interface BrandRow {
  name: unknown;
  contact_email: unknown;
  default_currency?: unknown;
}

interface StripeAccountState {
  id: string;
  details_submitted?: boolean | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  requirements?: Record<string, unknown> | null;
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

function isNonEmptyRows(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

async function hasLocalMoneyMovement(
  supabase: any,
  brandId: string,
  stripeAccountId: string,
): Promise<boolean> {
  const { data: payoutsRows, error: payoutsError } = await supabase
    .from("payouts")
    .select("id")
    .eq("brand_id", brandId)
    .limit(1);
  if (payoutsError) throw payoutsError;
  if (isNonEmptyRows(payoutsRows)) return true;

  const { data: revenueRows, error: revenueError } = await supabase
    .from("mingla_revenue_log")
    .select("id")
    .eq("stripe_account_id", stripeAccountId)
    .limit(1);
  if (revenueError) throw revenueError;
  if (isNonEmptyRows(revenueRows)) return true;

  const { data: eventRows, error: eventsError } = await supabase
    .from("events")
    .select("id")
    .eq("brand_id", brandId)
    .limit(1000);
  if (eventsError) throw eventsError;
  const eventIds = Array.isArray(eventRows)
    ? eventRows.map((row: { id?: unknown }) => row.id).filter((
      id: unknown,
    ): id is string => typeof id === "string")
    : [];
  if (eventIds.length === 0) return false;

  const { data: orderRows, error: ordersError } = await supabase
    .from("orders")
    .select("id")
    .in("event_id", eventIds)
    .or("stripe_payment_intent_id.not.is.null,stripe_charge_id.not.is.null")
    .limit(1);
  if (ordersError) throw ordersError;
  return isNonEmptyRows(orderRows);
}

async function retrieveStripeAccountState(
  stripeAccountId: string,
): Promise<StripeAccountState> {
  const stripe = stripeRefreshStatus();
  // @ts-ignore — Stripe SDK accounts namespace.
  return await stripe.accounts.retrieve(stripeAccountId) as StripeAccountState;
}

async function deleteReplaceableStripeAccount(
  brandId: string,
  stripeAccountId: string,
): Promise<unknown> {
  const stripe = stripeDetach();
  // @ts-ignore — Stripe SDK accounts namespace + request options overload.
  return await stripe.accounts.del(stripeAccountId, undefined, {
    idempotencyKey: generateIdempotencyKey(
      brandId,
      `detach_account:${stripeAccountId}`,
    ),
  });
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
      .select(
        "id, stripe_account_id, detached_at, country, default_currency, charges_enabled, payouts_enabled, requirements",
      )
      .eq("brand_id", brand_id)
      .maybeSingle<ExistingScaRow>();
    if (scaReadError) {
      console.error("[brand-stripe-onboard] sca read failed:", scaReadError);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    // Read brand details for replacement/fresh creation.
    const { data: brandRow, error: brandReadError } = await supabase
      .from("brands")
      .select("name, contact_email, default_currency")
      .eq("id", brand_id)
      .is("deleted_at", null)
      .maybeSingle<BrandRow>();
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

    let stripeAccountId: string;
    let scaRowId: string | null = null;
    let replacementAudit:
      | {
        oldStripeAccountId: string;
        oldCountry: string | null;
        oldChargesEnabled: boolean | null;
        oldPayoutsEnabled: boolean | null;
        oldRequirementsDisabledReason: unknown;
        stripeDeleteResult: unknown;
      }
      | null = null;

    const createAndPersistStripeAccount = async (
      oldStripeAccountId: string | null,
    ): Promise<{ id: string; scaRowId: string }> => {
      const defaultCurrency = defaultCurrencyForCountry(country);
      let stripeAccount: { id: string };
      try {
        stripeAccount = await createRecipientAccount({
          displayName: safeDisplayName(brandRow.name),
          contactEmail: safeContactEmail(brandRow.contact_email, claims.email),
          country,
          idempotencyKey: generateIdempotencyKey(
            brand_id,
            buildStripeOnboardCreateOperation(country, oldStripeAccountId),
          ),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[brand-stripe-onboard] v2 account create failed:",
          message,
        );
        throw new Error(`stripe_api_error:${message}`);
      }

      const { data: scaUpsert, error: scaUpsertError } = await supabase
        .from("stripe_connect_accounts")
        .upsert(
          {
            brand_id,
            stripe_account_id: stripeAccount.id,
            controller_dashboard_type: "none",
            charges_enabled: false,
            payouts_enabled: false,
            requirements: {},
            country,
            default_currency: defaultCurrency,
            detached_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "brand_id" },
        )
        .select("id, stripe_account_id")
        .single();
      if (scaUpsertError || !scaUpsert) {
        console.error(
          "[brand-stripe-onboard] sca upsert failed:",
          scaUpsertError,
        );
        throw new Error("internal_error:sca_upsert_failed");
      }

      return {
        id: scaUpsert.stripe_account_id,
        scaRowId: scaUpsert.id,
      };
    };

    if (existingSca?.stripe_account_id) {
      const existingCountry = normalizeStripeCountry(existingSca.country);
      const countryMatches = existingCountry === country;

      if (countryMatches) {
        // Same-country reactivation: reuse Stripe account and clear local soft detach.
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
      } else if (existingSca.detached_at !== null) {
        try {
          const created = await createAndPersistStripeAccount(
            existingSca.stripe_account_id,
          );
          stripeAccountId = created.id;
          scaRowId = created.scaRowId;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.startsWith("stripe_api_error:")) {
            return jsonResponse(
              {
                error: "stripe_api_error",
                detail: message.replace("stripe_api_error:", ""),
              },
              502,
            );
          }
          return jsonResponse(
            { error: "internal_error", detail: "sca_upsert_failed" },
            500,
          );
        }
      } else {
        let accountState: StripeAccountState;
        let localMoneyMovement = false;
        try {
          accountState = await retrieveStripeAccountState(
            existingSca.stripe_account_id,
          );
          localMoneyMovement = await hasLocalMoneyMovement(
            supabase,
            brand_id,
            existingSca.stripe_account_id,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            "[brand-stripe-onboard] replacement preflight failed:",
            message,
          );
          await writeAudit(supabase, {
            user_id: userId,
            brand_id,
            action: "stripe_connect.country_change_locked",
            target_type: "stripe_connect_account",
            target_id: existingSca.stripe_account_id,
            before: {
              country: existingSca.country,
              requested_country: country,
            },
            after: { reason: "stripe_state_unknown" },
          });
          return jsonResponse(
            {
              error: "country_locked",
              detail: "stripe_account_country_locked_after_onboarding",
              existing_country: existingSca.country,
              requested_country: country,
              reason: "stripe_state_unknown",
            },
            409,
          );
        }

        const replacementDecision = decideStripeCountryReplacement({
          details_submitted: accountState.details_submitted,
          charges_enabled: accountState.charges_enabled ??
            existingSca.charges_enabled,
          payouts_enabled: accountState.payouts_enabled ??
            existingSca.payouts_enabled,
          hasLocalMoneyMovement: localMoneyMovement,
          stripeStateKnown: true,
        });

        if (!replacementDecision.replaceable) {
          await writeAudit(supabase, {
            user_id: userId,
            brand_id,
            action: "stripe_connect.country_change_locked",
            target_type: "stripe_connect_account",
            target_id: existingSca.stripe_account_id,
            before: {
              country: existingSca.country,
              charges_enabled: existingSca.charges_enabled,
              payouts_enabled: existingSca.payouts_enabled,
              requirements_disabled_reason:
                existingSca.requirements?.disabled_reason ?? null,
            },
            after: {
              requested_country: country,
              reason: replacementDecision.reason,
            },
          });
          return jsonResponse(
            {
              error: "country_locked",
              detail: "stripe_account_country_locked_after_onboarding",
              existing_country: existingSca.country,
              requested_country: country,
              reason: replacementDecision.reason,
            },
            409,
          );
        }

        let deleteResult: unknown;
        try {
          deleteResult = await deleteReplaceableStripeAccount(
            brand_id,
            existingSca.stripe_account_id,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            "[brand-stripe-onboard] replacement delete failed:",
            message,
          );
          await writeAudit(supabase, {
            user_id: userId,
            brand_id,
            action: "stripe_connect.country_change_locked",
            target_type: "stripe_connect_account",
            target_id: existingSca.stripe_account_id,
            before: {
              country: existingSca.country,
              charges_enabled: existingSca.charges_enabled,
              payouts_enabled: existingSca.payouts_enabled,
            },
            after: {
              requested_country: country,
              reason: "stripe_delete_rejected",
            },
          });
          return jsonResponse(
            {
              error: "country_locked",
              detail: "stripe_account_country_locked_after_onboarding",
              existing_country: existingSca.country,
              requested_country: country,
              reason: "stripe_delete_rejected",
            },
            409,
          );
        }

        try {
          const created = await createAndPersistStripeAccount(
            existingSca.stripe_account_id,
          );
          stripeAccountId = created.id;
          scaRowId = created.scaRowId;
          replacementAudit = {
            oldStripeAccountId: existingSca.stripe_account_id,
            oldCountry: existingSca.country,
            oldChargesEnabled: existingSca.charges_enabled,
            oldPayoutsEnabled: existingSca.payouts_enabled,
            oldRequirementsDisabledReason:
              existingSca.requirements?.disabled_reason ?? null,
            stripeDeleteResult: deleteResult,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.startsWith("stripe_api_error:")) {
            return jsonResponse(
              {
                error: "stripe_api_error",
                detail: message.replace("stripe_api_error:", ""),
              },
              502,
            );
          }
          return jsonResponse(
            { error: "internal_error", detail: "sca_upsert_failed" },
            500,
          );
        }
      }
    } else {
      try {
        const created = await createAndPersistStripeAccount(null);
        stripeAccountId = created.id;
        scaRowId = created.scaRowId;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("stripe_api_error:")) {
          return jsonResponse(
            {
              error: "stripe_api_error",
              detail: message.replace("stripe_api_error:", ""),
            },
            502,
          );
        }
        return jsonResponse(
          { error: "internal_error", detail: "sca_upsert_failed" },
          500,
        );
      }
    }

    if (replacementAudit !== null) {
      await writeAudit(supabase, {
        user_id: userId,
        brand_id,
        action: "stripe_connect.country_change_replaced_before_completion",
        target_type: "stripe_connect_account",
        target_id: stripeAccountId,
        before: {
          stripe_account_id: replacementAudit.oldStripeAccountId,
          country: replacementAudit.oldCountry,
          charges_enabled: replacementAudit.oldChargesEnabled,
          payouts_enabled: replacementAudit.oldPayoutsEnabled,
          requirements_disabled_reason:
            replacementAudit.oldRequirementsDisabledReason,
        },
        after: {
          stripe_account_id: stripeAccountId,
          country,
          default_currency: defaultCurrencyForCountry(country),
          stripe_delete_result: replacementAudit.stripeDeleteResult,
        },
      });
    }

    // Mint embedded Account Session for the Mingla-hosted onboarding page.
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
          brand_id,
          buildStripeAccountSessionOperation(country, stripeAccountId),
        ),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        "[brand-stripe-onboard] account_session create failed:",
        message,
      );
      return jsonResponse(
        { error: "stripe_api_error", detail: message },
        502,
      );
    }

    const onboardingUrl = `${businessWebOrigin}/connect-onboarding` +
      `?session=${encodeURIComponent(accountSession.client_secret)}` +
      `&brand_id=${encodeURIComponent(brand_id)}` +
      `&return_to=${encodeURIComponent(return_url)}`;

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
          controller_dashboard_type: "none",
          country,
          onboarding_surface: "mingla_hosted_embedded_components",
        },
      });
    } catch (auditErr) {
      // Per Const #3: surface but don't fail the onboarding (link was created).
      console.error("[brand-stripe-onboard] audit write failed:", auditErr);
    }

    return jsonResponse({
      client_secret: accountSession.client_secret,
      account_id: stripeAccountId,
      onboarding_url: onboardingUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brand-stripe-onboard] unhandled error:", message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
