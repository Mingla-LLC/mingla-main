/**
 * #3872 R2 — referral-payee Stripe recipient onboarding.
 *
 * The account is recipient-only Accounts v2: it can receive platform
 * transfers, but it is not a merchant and cannot take card payments. Provider
 * calls are dependency-injected so the regression suite never contacts Stripe.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { isWellFormedEmail } from "../_shared/organiserContactEmail.ts";
import {
  createPayoutRecipientAccount,
  createPayoutRecipientAccountLink,
  type CreateRecipientAccountInput,
  type CreateRecipientAccountLinkInput,
  type StripeV2Account,
  type StripeV2AccountLink,
} from "../_shared/stripeBlueprintClient.ts";
import { normalizeStripeCountry } from "../_shared/stripeSupportedCountries.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import { writeAudit } from "../_shared/audit.ts";

export const PAYEE_NATIVE_RETURN_URL =
  "mingla://payout-account/return" as const;
export const PAYEE_WEB_RETURN_PATH = "/connect-payee-onboarding" as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isAllowedPayeeReturnUrl(
  value: unknown,
  businessOrigin: string,
): value is string {
  return value === PAYEE_NATIVE_RETURN_URL ||
    value === `${businessOrigin}${PAYEE_WEB_RETURN_PATH}`;
}

export interface PayeeStripeAccountRow {
  user_id: string;
  stripe_account_id: string | null;
  stripe_status: string;
  stripe_country: string | null;
}

export interface PayeeStripeDeps {
  businessOrigin: string;
  resolveUser: (
    token: string,
  ) => Promise<
    {
      id: string;
      email: string | null;
      emailVerified: boolean;
    } | null
  >;
  loadProfile: (userId: string) => Promise<{
    data: { display_name: string | null } | null;
    error: unknown;
  }>;
  loadAccount: (userId: string) => Promise<{
    data: PayeeStripeAccountRow | null;
    error: unknown;
  }>;
  upsertAccount: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  createAccount: (
    input: CreateRecipientAccountInput,
  ) => Promise<StripeV2Account>;
  createLink: (
    input: CreateRecipientAccountLinkInput,
  ) => Promise<StripeV2AccountLink>;
  idempotencyKey: (userId: string, operation: string) => string;
  audit: (input: {
    userId: string;
    accountId: string;
    country: string;
  }) => Promise<void>;
}

function defaultDeps(): PayeeStripeDeps {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const client = createClient(url, key, { auth: { persistSession: false } });
  return {
    businessOrigin: (Deno.env.get("BUSINESS_WEB_ORIGIN") ?? "").trim() ||
      PRODUCTION_BUSINESS_WEB_ORIGIN,
    resolveUser: async (token) => {
      const userClient = createClient(url, key, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await userClient.auth.getUser(token);
      if (error || !data.user) return null;
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        emailVerified: Boolean(data.user.email_confirmed_at),
      };
    },
    loadProfile: async (userId) => {
      const result = await client.from("profiles")
        .select("display_name").eq("id", userId).maybeSingle();
      return { data: result.data, error: result.error };
    },
    loadAccount: async (userId) => {
      const result = await client.from("payee_accounts")
        .select("user_id,stripe_account_id,stripe_status,stripe_country")
        .eq("user_id", userId).maybeSingle();
      return {
        data: result.data as PayeeStripeAccountRow | null,
        error: result.error,
      };
    },
    upsertAccount: async (row) => {
      const result = await client.from("payee_accounts").upsert(row, {
        onConflict: "user_id",
      });
      return { error: result.error };
    },
    createAccount: createPayoutRecipientAccount,
    createLink: createPayoutRecipientAccountLink,
    idempotencyKey: generateIdempotencyKey,
    audit: async ({ userId, accountId, country }) => {
      await writeAudit(client, {
        user_id: userId,
        brand_id: null,
        action: "payee_stripe.onboard_initiated",
        target_type: "payee_account",
        target_id: userId,
        after: { stripe_account_id: accountId, country },
      });
    },
  };
}

interface Body {
  action?: "link" | "status";
  country?: string;
  return_url?: string;
}

export async function handler(
  req: Request,
  deps: PayeeStripeDeps = defaultDeps(),
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  const action = body.action ?? "link";
  if (action !== "link" && action !== "status") {
    return json({ error: "validation_error", detail: "unknown_action" }, 400);
  }

  const match = (req.headers.get("authorization") ?? "").match(
    /^Bearer\s+(.+)$/i,
  );
  if (!match) return json({ error: "unauthenticated" }, 401);
  const user = await deps.resolveUser(match[1]);
  if (!user) return json({ error: "unauthenticated" }, 401);

  const accountResult = await deps.loadAccount(user.id);
  if (accountResult.error) return json({ error: "internal_error" }, 500);
  if (action === "status") {
    const account = accountResult.data;
    return json({
      connected: Boolean(account?.stripe_account_id),
      status: account?.stripe_status ?? "none",
      country: account?.stripe_country ?? null,
    });
  }

  if (!isAllowedPayeeReturnUrl(body.return_url, deps.businessOrigin)) {
    return json(
      { error: "validation_error", detail: "return_url_not_allowed" },
      400,
    );
  }
  const country = normalizeStripeCountry(body.country);
  if (!country) {
    return json(
      { error: "validation_error", detail: "country_unsupported" },
      400,
    );
  }
  if (!user.emailVerified || !isWellFormedEmail(user.email)) {
    return json({ error: "verified_email_required" }, 422);
  }

  let stripeAccountId = accountResult.data?.stripe_account_id ?? null;
  if (
    stripeAccountId && accountResult.data?.stripe_country &&
    accountResult.data.stripe_country !== country
  ) {
    return json({ error: "payout_country_mismatch" }, 409);
  }
  if (!stripeAccountId) {
    const profileResult = await deps.loadProfile(user.id);
    if (profileResult.error) return json({ error: "internal_error" }, 500);
    const displayName = profileResult.data?.display_name?.trim() ||
      "Mingla member";
    try {
      const created = await deps.createAccount({
        displayName,
        contactEmail: user.email.trim(),
        country,
        idempotencyKey: deps.idempotencyKey(
          user.id,
          `payee_recipient_create:${country}`,
        ),
      });
      stripeAccountId = created.id;
    } catch (error) {
      console.error("[payee-account-stripe-link] account create failed", error);
      return json({ error: "stripe_api_error" }, 502);
    }
  }

  const upsert = await deps.upsertAccount({
    user_id: user.id,
    stripe_account_id: stripeAccountId,
    stripe_status: "onboarding",
    stripe_country: country,
    updated_at: new Date().toISOString(),
  });
  if (upsert.error) return json({ error: "internal_error" }, 500);

  let link: StripeV2AccountLink;
  try {
    link = await deps.createLink({
      accountId: stripeAccountId,
      refreshUrl: body.return_url,
      returnUrl: body.return_url,
      idempotencyKey: deps.idempotencyKey(
        user.id,
        `payee_recipient_link:${stripeAccountId}`,
      ),
    });
  } catch (error) {
    console.error("[payee-account-stripe-link] account link failed", error);
    return json({ error: "stripe_api_error" }, 502);
  }

  try {
    await deps.audit({ userId: user.id, accountId: stripeAccountId, country });
  } catch (error) {
    console.error("[payee-account-stripe-link] audit failed", error);
  }
  return json({ account_id: stripeAccountId, onboarding_url: link.url });
}

if (import.meta.main) serve((req) => handler(req));
