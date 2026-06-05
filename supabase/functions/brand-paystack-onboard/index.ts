/**
 * brand-paystack-onboard — Paystack payout onboarding for a Nigerian brand
 * (META-ORCH-1076 Phase 2). The Paystack analog of brand-stripe-onboard.
 *
 * Paystack has NO embedded KYC component for subaccounts — onboarding is a plain
 * Mingla-owned bank-details form. This function is the multiplexed backend for
 * that form, selected by `action`:
 *
 *   action = list_banks
 *     → NG NUBAN settlement banks for the picker. Requires any authenticated
 *       business user (static list; not brand-scoped).
 *
 *   action = resolve_account  (brand_id, account_number, bank_code)
 *     → verified account holder name (shown for confirmation before create).
 *       Gate: biz_can_manage_payments_for_brand(brand_id, user_id).
 *
 *   action = create_subaccount  (brand_id, account_number, bank_code)
 *     → resolves the name, POST /subaccount, then flips the brand onto Paystack:
 *       paystack_subaccount_code + payment_provider=paystack + payment_country=Nigeria.
 *       Gate: biz_can_manage_payments_for_brand(brand_id, user_id).
 *
 *   action = refresh_status  (brand_id)
 *     → re-poll subaccount verification/active state for the readiness card.
 *       Gate: biz_can_manage_payments_for_brand(brand_id, user_id).
 *
 * Auth: Bearer JWT (Supabase auth), verified via supabase-js getUser. Mirrors
 * brand-stripe-onboard's decodeAndVerifyJwt + service-role DB writes.
 *
 * Paystack docs:
 *   - Subaccount API:   https://paystack.com/docs/api/subaccount/
 *   - Verification API: https://paystack.com/docs/api/verification/#resolve-account
 *   - Miscellaneous (List Banks): https://paystack.com/docs/api/miscellaneous/#bank
 *   - Split Payments:   https://paystack.com/docs/payments/split-payments/
 * Full reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeAudit } from "../_shared/audit.ts";
import {
  paystackCreateSubaccount,
  paystackFetchSubaccount,
  paystackListBanks,
  paystackResolveAccount,
  paystackUpdateSubaccount,
} from "../_shared/paystack.ts";

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Nigerian NUBAN account numbers are exactly 10 digits.
function isValidNuban(v: unknown): v is string {
  return typeof v === "string" && /^\d{10}$/.test(v);
}

async function resolveUserId(token: string): Promise<string | null> {
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

interface OnboardBody {
  action?: string;
  brand_id?: string;
  account_number?: string;
  bank_code?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    let body: OnboardBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
    }

    const action = body?.action;
    if (
      action !== "list_banks" && action !== "resolve_account" &&
      action !== "create_subaccount" && action !== "update_subaccount" &&
      action !== "disconnect" && action !== "refresh_status" &&
      action !== "select_provider" && action !== "clear_provider"
    ) {
      return jsonResponse({ error: "validation_error", detail: "unknown_action" }, 400);
    }

    // Authenticate the caller (all actions require a valid JWT).
    const authHeader = req.headers.get("authorization") ?? "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) return jsonResponse({ error: "unauthenticated" }, 401);
    const userId = await resolveUserId(tokenMatch[1]);
    if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── action: list_banks ───────────────────────────────────────────────────
    // Static NG NUBAN list; any authenticated business user may fetch it.
    if (action === "list_banks") {
      const banks = await paystackListBanks({
        country: "nigeria",
        currency: "NGN",
        type: "nuban",
      });
      // Trim to picker-relevant fields.
      const slim = banks.map((b) => ({ name: b.name, code: b.code }));
      return jsonResponse({ banks: slim });
    }

    // All remaining actions are brand-scoped → validate brand_id + permission.
    if (!isValidUuid(body?.brand_id)) {
      return jsonResponse(
        { error: "validation_error", detail: "brand_id_invalid_uuid" },
        400,
      );
    }
    const brandId = body.brand_id as string;

    const { data: canManage, error: permError } = await supabase.rpc(
      "biz_can_manage_payments_for_brand",
      { p_brand_id: brandId, p_user_id: userId },
    );
    if (permError) {
      console.error("[brand-paystack-onboard] permission RPC failed:", permError);
      return jsonResponse({ error: "internal_error" }, 500);
    }
    if (canManage !== true) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    // ── action: resolve_account ──────────────────────────────────────────────
    if (action === "resolve_account") {
      if (!isValidNuban(body?.account_number)) {
        return jsonResponse(
          { error: "validation_error", detail: "account_number_must_be_10_digits" },
          400,
        );
      }
      if (typeof body?.bank_code !== "string" || body.bank_code.length === 0) {
        return jsonResponse(
          { error: "validation_error", detail: "bank_code_required" },
          400,
        );
      }
      try {
        const resolved = await paystackResolveAccount({
          accountNumber: body.account_number as string,
          bankCode: body.bank_code,
        });
        return jsonResponse({
          account_name: resolved.account_name,
          account_number: resolved.account_number,
        });
      } catch (err) {
        // Paystack returns non-200 for an unresolvable account; surface as 422.
        return jsonResponse(
          { error: "account_unresolved", detail: String((err as Error)?.message ?? err) },
          422,
        );
      }
    }

    // Read the brand once for create/refresh.
    const { data: brand, error: brandErr } = await supabase
      .from("brands")
      .select("id, name, payment_provider, payment_country, paystack_subaccount_code")
      .eq("id", brandId)
      .maybeSingle();
    if (brandErr || !brand) {
      return jsonResponse({ error: "brand_not_found" }, 404);
    }

    // ── action: refresh_status ───────────────────────────────────────────────
    if (action === "refresh_status") {
      const code = brand.paystack_subaccount_code as string | null;
      if (!code) {
        return jsonResponse({
          connected: false,
          is_verified: false,
          settlement_bank: null,
          account_number_masked: null,
        });
      }
      const sub = await paystackFetchSubaccount(code);
      const acct = sub.account_number ?? "";
      return jsonResponse({
        connected: true,
        is_verified: sub.is_verified === true,
        active: sub.active !== false,
        settlement_bank: sub.settlement_bank ?? null,
        account_number_masked: acct ? `••••${acct.slice(-4)}` : null,
      });
    }

    // ── action: select_provider ──────────────────────────────────────────────
    // Entry point: the brand picked Nigeria in the payout country picker. Flip
    // it onto the Paystack rail (payment_provider='paystack', payment_country='NG')
    // WITHOUT a subaccount yet — the Payments tab then renders the bank-details
    // form (create_subaccount). Refuses if Stripe is already wired (a Stripe
    // brand can't reach NG, but be explicit).
    if (action === "select_provider") {
      if (brand.payment_provider === "paystack") {
        // Already on Paystack — idempotent success.
        return jsonResponse({ payment_provider: "paystack", payment_country: "NG" });
      }
      const { error: updErr } = await supabase
        .from("brands")
        .update({ payment_provider: "paystack", payment_country: "NG" })
        .eq("id", brandId);
      if (updErr) {
        console.error("[brand-paystack-onboard] select_provider update failed:", updErr);
        return jsonResponse({ error: "internal_error", detail: "brand_update_failed" }, 500);
      }
      await writeAudit(supabase, {
        user_id: userId,
        brand_id: brandId,
        action: "paystack.provider_selected",
        target_type: "brand",
        target_id: brandId,
        after: { payment_provider: "paystack", payment_country: "NG" },
      });
      return jsonResponse({ payment_provider: "paystack", payment_country: "NG" });
    }

    // ── action: clear_provider ───────────────────────────────────────────────
    // Reverse of select_provider: a brand that picked Nigeria but hasn't
    // connected a bank chooses a different country. Revert to the Stripe rail
    // (payment_provider='stripe', payment_country=null). Refuses once a
    // subaccount exists (use disconnect first).
    if (action === "clear_provider") {
      if (brand.paystack_subaccount_code != null) {
        return jsonResponse({ error: "conflict", detail: "disconnect_first" }, 409);
      }
      const { error: updErr } = await supabase
        .from("brands")
        .update({ payment_provider: "stripe", payment_country: null })
        .eq("id", brandId);
      if (updErr) {
        console.error("[brand-paystack-onboard] clear_provider update failed:", updErr);
        return jsonResponse({ error: "internal_error", detail: "brand_update_failed" }, 500);
      }
      await writeAudit(supabase, {
        user_id: userId,
        brand_id: brandId,
        action: "paystack.provider_cleared",
        target_type: "brand",
        target_id: brandId,
        after: { payment_provider: "stripe", payment_country: null },
      });
      return jsonResponse({ payment_provider: "stripe", payment_country: null });
    }

    // ── action: disconnect ───────────────────────────────────────────────────
    // Stop receiving payouts: null the brand's subaccount code (checkout then
    // full-settles to the Mingla main account, as before onboarding) and
    // best-effort deactivate the Paystack subaccount so it isn't reused.
    if (action === "disconnect") {
      const code = brand.paystack_subaccount_code as string | null;
      if (code) {
        try {
          await paystackUpdateSubaccount(code, { active: false });
        } catch (err) {
          // Non-fatal: still clear the local link so the brand can re-onboard.
          console.error("[brand-paystack-onboard] deactivate subaccount failed:", err);
        }
      }
      const { error: updErr } = await supabase
        .from("brands")
        .update({ paystack_subaccount_code: null })
        .eq("id", brandId);
      if (updErr) {
        console.error("[brand-paystack-onboard] disconnect update failed:", updErr);
        return jsonResponse({ error: "internal_error", detail: "brand_update_failed" }, 500);
      }
      await writeAudit(supabase, {
        user_id: userId,
        brand_id: brandId,
        action: "paystack.subaccount_disconnected",
        target_type: "brand",
        target_id: brandId,
        before: { paystack_subaccount_code: code },
      });
      return jsonResponse({ disconnected: true });
    }

    // Both create_subaccount + update_subaccount require bank details.
    if (!isValidNuban(body?.account_number)) {
      return jsonResponse(
        { error: "validation_error", detail: "account_number_must_be_10_digits" },
        400,
      );
    }
    if (typeof body?.bank_code !== "string" || body.bank_code.length === 0) {
      return jsonResponse(
        { error: "validation_error", detail: "bank_code_required" },
        400,
      );
    }

    // ── action: update_subaccount ────────────────────────────────────────────
    // Change the settlement bank/account on the EXISTING subaccount (same code).
    if (action === "update_subaccount") {
      const code = brand.paystack_subaccount_code as string | null;
      if (!code) {
        // Nothing to update — caller should create instead.
        return jsonResponse({ error: "conflict", detail: "no_subaccount_to_update" }, 409);
      }
      let accountName: string;
      try {
        const resolved = await paystackResolveAccount({
          accountNumber: body.account_number as string,
          bankCode: body.bank_code,
        });
        accountName = resolved.account_name;
      } catch (err) {
        return jsonResponse(
          { error: "account_unresolved", detail: String((err as Error)?.message ?? err) },
          422,
        );
      }
      try {
        await paystackUpdateSubaccount(code, {
          settlementBank: body.bank_code,
          accountNumber: body.account_number as string,
          active: true,
        });
      } catch (err) {
        return jsonResponse(
          { error: "subaccount_update_failed", detail: String((err as Error)?.message ?? err) },
          502,
        );
      }
      await writeAudit(supabase, {
        user_id: userId,
        brand_id: brandId,
        action: "paystack.subaccount_updated",
        target_type: "brand",
        target_id: brandId,
        after: { account_number_last4: (body.account_number as string).slice(-4) },
      });
      return jsonResponse({
        subaccount_code: code,
        account_name: accountName,
        account_number_masked: `••••${(body.account_number as string).slice(-4)}`,
      });
    }

    // ── action: create_subaccount ────────────────────────────────────────────
    // Guard: do not silently clobber an existing Stripe-active brand. A brand
    // already on Stripe cannot reach Nigeria (Stripe has no NG payouts), but be
    // explicit — only an unconfigured or already-Paystack brand may onboard here.
    if (brand.payment_provider === "stripe" && brand.paystack_subaccount_code) {
      return jsonResponse({ error: "conflict", detail: "provider_already_set" }, 409);
    }

    // Verify the account name first (Paystack disclaims wrong-account liability).
    let accountName: string;
    try {
      const resolved = await paystackResolveAccount({
        accountNumber: body.account_number as string,
        bankCode: body.bank_code,
      });
      accountName = resolved.account_name;
    } catch (err) {
      return jsonResponse(
        { error: "account_unresolved", detail: String((err as Error)?.message ?? err) },
        422,
      );
    }

    // percentage_charge is REQUIRED by Paystack but overridden per-transaction by
    // the flat transaction_charge set at checkout. Use the brand's effective
    // take-rate (bps → %) as a sane fallback so the economics never go to zero.
    let percentageCharge = 1.5; // platform default 150 bps; overwritten below if RPC succeeds
    const { data: takeRows } = await supabase.rpc(
      "resolve_effective_take_rate_bps",
      { p_brand_id: brandId },
    );
    const bps = Array.isArray(takeRows)
      ? Number(takeRows[0]?.effective_take_rate_bps)
      : Number((takeRows as { effective_take_rate_bps?: number })?.effective_take_rate_bps);
    if (Number.isFinite(bps) && bps >= 0) percentageCharge = bps / 100;

    let subaccountCode: string;
    try {
      const sub = await paystackCreateSubaccount({
        businessName: (brand.name as string) ?? "Mingla brand",
        settlementBank: body.bank_code,
        accountNumber: body.account_number as string,
        percentageCharge,
      });
      subaccountCode = sub.subaccount_code;
    } catch (err) {
      return jsonResponse(
        { error: "subaccount_create_failed", detail: String((err as Error)?.message ?? err) },
        502,
      );
    }

    // Flip the brand onto Paystack. This is what makes the checkout deferred-split
    // fire (ticket-checkout-create attaches the subaccount once this column is set).
    const { error: updErr } = await supabase
      .from("brands")
      .update({
        paystack_subaccount_code: subaccountCode,
        payment_provider: "paystack",
        payment_country: "NG",
      })
      .eq("id", brandId);
    if (updErr) {
      console.error("[brand-paystack-onboard] brand update failed:", updErr);
      return jsonResponse({ error: "internal_error", detail: "brand_update_failed" }, 500);
    }

    await writeAudit(supabase, {
      user_id: userId,
      brand_id: brandId,
      action: "paystack.subaccount_created",
      target_type: "brand",
      target_id: brandId,
      after: { paystack_subaccount_code: subaccountCode, payment_country: "NG" },
    });

    return jsonResponse({
      subaccount_code: subaccountCode,
      account_name: accountName,
      account_number_masked: `••••${(body.account_number as string).slice(-4)}`,
      payment_provider: "paystack",
      payment_country: "NG",
    });
  } catch (err) {
    console.error("[brand-paystack-onboard] unhandled error:", err);
    return jsonResponse(
      { error: "internal_error", detail: String((err as Error)?.message ?? err) },
      500,
    );
  }
});
