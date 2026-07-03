/**
 * admin-stripe-connect-action — ORCH-1278 [Admin Money console — WAVE-2 ACT].
 * The admin (service_role) twin of brand-stripe-refresh-status / brand-stripe-onboard,
 * scoped to two read-through / session-mint modes over an EXISTING Connect account:
 *   - mode:'refresh'          → stripe.accounts.retrieve → sync stripe_connect_accounts
 *                               → pg_derive_brand_stripe_status.
 *   - mode:'onboarding_link'  → account_sessions.create (embedded account_onboarding)
 *                               → Mingla-hosted onboarding URL (admin sends out-of-band).
 *
 * verify_jwt = true (config.toml): no-JWT callers rejected at the gateway (401); this fn
 * re-verifies the JWT is a real user AND an active admin (else 403). Moves NO money.
 *
 * HARD out-of-scope (SPEC §5B.6): admin MUST NOT create or replace a Stripe account
 * (createRecipientAccount / accounts.del). If the brand has no stripe_connect_accounts
 * row → 422; fresh onboarding stays the brand's own brand-stripe-onboard flow.
 *
 * Audit (I-PROPOSED-1278-MONEY-ACT-AUDITED): one admin_write_audit row per action,
 * via the ORCH-1271 helper (service_role path → actor passed explicitly).
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripeRefreshStatus, STRIPE_API_VERSION } from "../_shared/stripe.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { createAccountSession } from "../_shared/stripeBlueprintClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUSINESS_WEB_ORIGIN = Deno.env.get("BUSINESS_WEB_ORIGIN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVISIBLE_WS = /[\s\u00A0\u200B\u200C\u200D\u2028\u2029\uFEFF]/g;

interface ConnectActionBody {
  brand_id?: string;
  mode?: string;
  reason?: string;
}

interface AccountResponse {
  id: string;
  details_submitted?: boolean;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: Record<string, unknown>;
  country?: string;
  default_currency?: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body: ConnectActionBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const brandId = typeof body.brand_id === "string" ? body.brand_id : "";
  const mode = typeof body.mode === "string" ? body.mode : "";
  const rawReason = typeof body.reason === "string" ? body.reason : "";
  if (!UUID_REGEX.test(brandId)) {
    return json({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }
  if (mode !== "refresh" && mode !== "onboarding_link") {
    return json({ error: "validation_error", detail: "mode_invalid" }, 400);
  }
  if (rawReason.replace(INVISIBLE_WS, "") === "") {
    return json({ error: "reason_required", field: "reason" }, 400);
  }
  const reason = rawReason.trim();

  // ── ADMIN GATE (mirrors admin-write-primitive). ─────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  // ── Read the EXISTING Connect account (admin never creates one). ────────────
  const { data: scaRow, error: scaReadError } = await supabase
    .from("stripe_connect_accounts")
    .select("stripe_account_id, charges_enabled, payouts_enabled, requirements, detached_at, country, default_currency")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (scaReadError) {
    console.error("[admin-stripe-connect-action] sca read failed", scaReadError.message);
    return json({ error: "internal_error" }, 500);
  }
  if (!scaRow || !scaRow.stripe_account_id) {
    return json({ error: "no_connect_account", detail: "brand has no Stripe connected account; admin cannot create one" }, 422);
  }

  // ── mode: refresh ───────────────────────────────────────────────────────────
  if (mode === "refresh") {
    let account: AccountResponse;
    try {
      const stripe = stripeRefreshStatus();
      // @ts-ignore — Stripe SDK accounts namespace is runtime-provided in Deno.
      account = await stripe.accounts.retrieve(scaRow.stripe_account_id, {
        apiVersion: STRIPE_API_VERSION,
        idempotencyKey: generateIdempotencyKey(brandId, "admin_refresh_status"),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-stripe-connect-action] accounts.retrieve failed", detail);
      return json({ error: "stripe_api_error", detail }, 502);
    }

    const { error: scaUpdateError } = await supabase
      .from("stripe_connect_accounts")
      .update({
        charges_enabled: account.charges_enabled ?? false,
        payouts_enabled: account.payouts_enabled ?? false,
        requirements: account.requirements ?? {},
        country: account.country?.toUpperCase() ?? scaRow.country ?? null,
        default_currency: account.default_currency?.toUpperCase() ?? scaRow.default_currency ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("brand_id", brandId);
    if (scaUpdateError) {
      console.error("[admin-stripe-connect-action] sca update failed", scaUpdateError.message);
      return json({ error: "internal_error" }, 500);
    }

    const { data: derivedStatus, error: deriveError } = await supabase.rpc(
      "pg_derive_brand_stripe_status",
      { p_brand_id: brandId },
    );
    if (deriveError) {
      console.error("[admin-stripe-connect-action] derive RPC failed", deriveError.message);
      return json({ error: "internal_error" }, 500);
    }

    const { error: auditError } = await supabase.rpc("admin_write_audit", {
      p_action: "connect.refresh",
      p_entity_type: "stripe_connect_account",
      p_entity_id: scaRow.stripe_account_id,
      p_reason: reason,
      p_metadata: {
        before: { charges_enabled: scaRow.charges_enabled ?? null, payouts_enabled: scaRow.payouts_enabled ?? null },
        after: {
          charges_enabled: account.charges_enabled ?? false,
          payouts_enabled: account.payouts_enabled ?? false,
          derived_status: derivedStatus ?? "onboarding",
        },
      },
      p_actor_email: user.email,
      p_actor_uid: user.id,
    });
    if (auditError) {
      console.error("[admin-stripe-connect-action] audit failed (non-fatal)", auditError.message);
    }

    return json({
      status: derivedStatus ?? "onboarding",
      charges_enabled: account.charges_enabled ?? false,
      payouts_enabled: account.payouts_enabled ?? false,
      requirements: account.requirements ?? {},
      detached_at: scaRow.detached_at,
      country: account.country ?? scaRow.country ?? null,
      default_currency: account.default_currency ?? scaRow.default_currency ?? null,
    });
  }

  // ── mode: onboarding_link (existing account ONLY) ───────────────────────────
  if (!BUSINESS_WEB_ORIGIN) {
    console.error("[admin-stripe-connect-action] BUSINESS_WEB_ORIGIN not configured");
    return json({ error: "internal_error", detail: "onboarding origin not configured" }, 500);
  }
  let accountSession: { client_secret: string };
  try {
    accountSession = await createAccountSession({
      accountId: scaRow.stripe_account_id,
      components: {
        account_onboarding: {
          enabled: true,
          features: { external_account_collection: true },
        },
      },
      idempotencyKey: generateIdempotencyKey(brandId, "admin_onboarding_link"),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[admin-stripe-connect-action] account_session create failed", detail);
    return json({ error: "stripe_api_error", detail }, 502);
  }

  const onboardingUrl = `${BUSINESS_WEB_ORIGIN}/connect-onboarding` +
    `?session=${encodeURIComponent(accountSession.client_secret)}` +
    `&brand_id=${encodeURIComponent(brandId)}`;

  const { error: auditError } = await supabase.rpc("admin_write_audit", {
    p_action: "connect.onboarding_link",
    p_entity_type: "stripe_connect_account",
    p_entity_id: scaRow.stripe_account_id,
    p_reason: reason,
    p_metadata: { account_id: scaRow.stripe_account_id },
    p_actor_email: user.email,
    p_actor_uid: user.id,
  });
  if (auditError) {
    console.error("[admin-stripe-connect-action] audit failed (non-fatal)", auditError.message);
  }

  return json({
    onboarding_url: onboardingUrl,
    client_secret: accountSession.client_secret,
    account_id: scaRow.stripe_account_id,
  });
});
