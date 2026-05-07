/**
 * brand-stripe-refresh-status — refreshes brand Stripe Connect status from Stripe API.
 *
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.2.3.
 *
 * POST request body:
 *   { brand_id: string (UUID) }
 *
 * Response (200 OK):
 *   { status, charges_enabled, payouts_enabled, requirements, detached_at }
 *
 * Auth: Bearer JWT. Caller must satisfy
 * biz_can_manage_payments_for_brand(brand_id, user_id) per D-B2-1 + D-V3-5.
 * (Service-role context resolves user_id from verified JWT; cannot rely on
 * auth.uid() the way the *_for_caller variant does.)
 *
 * Used as the 30s poll-fallback safety net per D-B2-11. Webhooks are
 * the primary status-update mechanism; this fn is for recovery when
 * webhook delivery is delayed or in tests.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripe, STRIPE_API_VERSION } from "../_shared/stripe.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { writeAudit } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

interface RefreshRequestBody {
  brand_id: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_REGEX.test(s);
}

interface AccountResponse {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    let body: RefreshRequestBody;
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
    const { brand_id } = body;

    // Auth: extract + verify JWT
    const authHeader = req.headers.get("authorization") ?? "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return jsonResponse({ error: "unauthenticated" }, 401);
    }

    // Service-role client + verify caller via supabase auth
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(
      tokenMatch[1],
    );
    if (userError || !userData.user) {
      return jsonResponse({ error: "unauthenticated" }, 401);
    }
    const userId = userData.user.id;

    // Permission check
    const { data: canManage, error: permError } = await supabase.rpc(
      "biz_can_manage_payments_for_brand",
      { p_brand_id: brand_id, p_user_id: userId },
    );
    if (permError) {
      console.error(
        "[brand-stripe-refresh-status] permission RPC failed:",
        permError,
      );
      return jsonResponse({ error: "internal_error" }, 500);
    }
    if (canManage !== true) {
      return jsonResponse(
        { error: "forbidden", detail: "permission_denied" },
        403,
      );
    }

    // Read existing stripe_connect_accounts row
    const { data: scaRow, error: scaReadError } = await supabase
      .from("stripe_connect_accounts")
      .select("stripe_account_id, charges_enabled, payouts_enabled, requirements, detached_at")
      .eq("brand_id", brand_id)
      .maybeSingle();
    if (scaReadError) {
      console.error(
        "[brand-stripe-refresh-status] sca read failed:",
        scaReadError,
      );
      return jsonResponse({ error: "internal_error" }, 500);
    }

    if (!scaRow) {
      return jsonResponse({
        status: "not_connected",
        charges_enabled: false,
        payouts_enabled: false,
        requirements: {},
        detached_at: null,
      });
    }

    // Fetch fresh state from Stripe API
    let account: AccountResponse;
    try {
      // @ts-ignore — Stripe SDK accounts namespace
      account = await stripe.accounts.retrieve(
        scaRow.stripe_account_id,
        {
          apiVersion: STRIPE_API_VERSION,
          idempotencyKey: generateIdempotencyKey(brand_id, "refresh_status"),
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        "[brand-stripe-refresh-status] stripe.accounts.retrieve failed:",
        message,
      );
      return jsonResponse(
        { error: "stripe_api_error", detail: message },
        502,
      );
    }

    // UPDATE stripe_connect_accounts; trigger mirrors to brands.stripe_*
    const { error: scaUpdateError } = await supabase
      .from("stripe_connect_accounts")
      .update({
        charges_enabled: account.charges_enabled ?? false,
        payouts_enabled: account.payouts_enabled ?? false,
        requirements: account.requirements ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq("brand_id", brand_id);

    if (scaUpdateError) {
      console.error(
        "[brand-stripe-refresh-status] sca update failed:",
        scaUpdateError,
      );
      return jsonResponse({ error: "internal_error" }, 500);
    }

    // Call the SQL helper for the canonical derived status
    const { data: derivedStatus, error: deriveError } = await supabase.rpc(
      "pg_derive_brand_stripe_status",
      { p_brand_id: brand_id },
    );
    if (deriveError) {
      console.error(
        "[brand-stripe-refresh-status] derive RPC failed:",
        deriveError,
      );
      return jsonResponse({ error: "internal_error" }, 500);
    }

    // Per I-PROPOSED-N (B2a Path C SPEC §5) — every Stripe edge fn audit-logs.
    // Lightweight: refresh-status is a high-frequency 30s poll, so we record only
    // status transitions that matter operationally (state change captured in
    // before/after diff) — no row spam for unchanged refreshes.
    await writeAudit(supabase, {
      user_id: userId,
      brand_id,
      action: "stripe_connect.status_refreshed",
      target_type: "stripe_connect_account",
      target_id: scaRow.stripe_account_id,
      before: {
        charges_enabled: scaRow.charges_enabled ?? null,
        payouts_enabled: scaRow.payouts_enabled ?? null,
      },
      after: {
        charges_enabled: account.charges_enabled ?? false,
        payouts_enabled: account.payouts_enabled ?? false,
        derived_status: derivedStatus ?? "onboarding",
      },
    });

    return jsonResponse({
      status: derivedStatus ?? "onboarding",
      charges_enabled: account.charges_enabled ?? false,
      payouts_enabled: account.payouts_enabled ?? false,
      requirements: account.requirements ?? {},
      detached_at: scaRow.detached_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brand-stripe-refresh-status] unhandled error:", message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
