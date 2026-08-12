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
 *   action = create_recipient | update_recipient
 *     → resolves the name again server-side, creates an RCP_ transfer recipient,
 *       and stores masked truth without changing the legacy ACCT_ subaccount.
 *
 *   action = deactivate_recipient
 *     → deactivates the local transfer target before best-effort provider delete.
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
  paystackCreateTransferRecipient,
  paystackCreateSubaccount,
  paystackDeleteTransferRecipient,
  paystackFetchSubaccount,
  paystackListBanks,
  paystackResolveAccount,
  paystackUpdateSubaccount,
  resolvePaystackSecretKey,
} from "../_shared/paystack.ts";
import {
  BrandRecipientError,
  deactivateBrandPaystackRecipient,
  hmacPaystackAccountFingerprint,
  saveBrandPaystackRecipient,
  type BrandRecipientDeps,
  type BrandRecipientRow,
} from "./recipient.ts";
import { resolvePaystackPayoutHoldOnboardFlip } from "../_shared/secretBundle.ts";

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

type PaystackOnboardStampOutcome =
  | "dark_skip"
  | "flipped"
  | "skipped_already_stamped"
  | "stamp_failed"
  | "stamp_outcome_unknown";

type StampRpcOutcome = Exclude<
  PaystackOnboardStampOutcome,
  "dark_skip" | "stamp_failed" | "stamp_outcome_unknown"
>;

type StampSafeReason =
  | "RPC_RESPONSE_AMBIGUOUS"
  | "VISIBILITY_NOT_PROVEN"
  | "RECONCILIATION_ERROR"
  | "BATCH_IDENTITY_MISMATCH"
  | "BATCH_RESULT_CONFLICT"
  | "FAILURE_WRITE_UNCONFIRMED"
  | "BATCH_HAS_STALE_FAILURE";

type ReconciliationDecision =
  | { kind: "not_visible" }
  | { kind: "committed"; outcome: StampRpcOutcome; reason?: StampSafeReason }
  | { kind: "failure" }
  | { kind: "unknown"; reason: StampSafeReason };

interface PaystackOnboardStampDeps {
  resolveEnabled: () => boolean;
  randomUuid: () => string;
  stamp: (
    attemptId: string,
  ) => Promise<unknown>;
  reconcileAttempt?: (
    attemptId: string,
  ) => Promise<StampRpcOutcome | ReconciliationDecision | null>;
  delayUntil?: (offsetMs: number) => Promise<void>;
  recordFailure: (
    attemptId: string,
    errorClass: string,
    errorCode: string,
  ) => Promise<void>;
  recordApplicationOutcome(
    outcome: PaystackOnboardStampOutcome,
    attemptId: string | null,
    reason?: StampSafeReason,
  ): Promise<void>;
  log(
    outcome: PaystackOnboardStampOutcome,
    attemptId: string | null,
    errorClass?: string,
    errorCode?: string,
    reason?: StampSafeReason,
  ): void;
}

function safeStampError(error: unknown): {
  errorClass: string;
  errorCode: string;
} {
  const candidate = typeof error === "object" && error !== null
    ? error as { name?: unknown; code?: unknown }
    : null;
  const errorClass = typeof candidate?.name === "string" &&
      /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(candidate.name)
    ? candidate.name
    : "StampRpcError";
  const errorCode = typeof candidate?.code === "string" &&
      /^[A-Z0-9_]{1,32}$/.test(candidate.code)
    ? candidate.code
    : "STAMP_RPC_FAILED";
  return { errorClass, errorCode };
}

function classifyStampResponse(value: unknown):
  | { kind: "committed"; outcome: StampRpcOutcome }
  | { kind: "definite_no_commit"; error: unknown }
  | { kind: "ambiguous"; error: unknown } {
  if (value === "flipped" || value === "skipped_already_stamped") {
    return { kind: "committed", outcome: value };
  }
  if (typeof value !== "object" || value === null) {
    return { kind: "ambiguous", error: null };
  }
  const response = value as { data?: unknown; error?: unknown };
  if (
    (response.data === "flipped" ||
      response.data === "skipped_already_stamped") &&
    response.error == null
  ) {
    return { kind: "committed", outcome: response.data };
  }
  if (response.error != null && response.data == null) {
    return { kind: "definite_no_commit", error: response.error };
  }
  return { kind: "ambiguous", error: response.error };
}

function normalizeReconciliation(
  value: StampRpcOutcome | ReconciliationDecision | null,
): ReconciliationDecision {
  if (value === null) return { kind: "not_visible" };
  if (value === "flipped" || value === "skipped_already_stamped") {
    return { kind: "committed", outcome: value };
  }
  if (typeof value === "object" && value !== null) {
    if (value.kind === "not_visible") return { kind: "not_visible" };
    if (value.kind === "failure") return { kind: "failure" };
    if (
      value.kind === "committed" &&
      (value.outcome === "flipped" ||
        value.outcome === "skipped_already_stamped")
    ) {
      return value;
    }
    if (
      value.kind === "unknown" &&
      [
        "RPC_RESPONSE_AMBIGUOUS",
        "VISIBILITY_NOT_PROVEN",
        "RECONCILIATION_ERROR",
        "BATCH_IDENTITY_MISMATCH",
        "BATCH_RESULT_CONFLICT",
        "FAILURE_WRITE_UNCONFIRMED",
        "BATCH_HAS_STALE_FAILURE",
      ].includes(value.reason)
    ) {
      return value;
    }
  }
  return { kind: "unknown", reason: "RECONCILIATION_ERROR" };
}

async function reconcileSafely(
  deps: PaystackOnboardStampDeps,
  attemptId: string,
): Promise<ReconciliationDecision> {
  if (!deps.reconcileAttempt) return { kind: "not_visible" };
  try {
    return normalizeReconciliation(await deps.reconcileAttempt(attemptId));
  } catch {
    return { kind: "unknown", reason: "RECONCILIATION_ERROR" };
  }
}

async function emitStampOutcome(
  deps: PaystackOnboardStampDeps,
  outcome: PaystackOnboardStampOutcome,
  attemptId: string | null,
  safe?: { errorClass: string; errorCode: string },
  reason?: StampSafeReason,
): Promise<PaystackOnboardStampOutcome> {
  try {
    await deps.recordApplicationOutcome(outcome, attemptId, reason);
  } catch (auditError) {
    const auditSafe = safeStampError(auditError);
    deps.log(
      outcome,
      attemptId,
      auditSafe.errorClass,
      auditSafe.errorCode,
      reason,
    );
    return outcome;
  }
  deps.log(outcome, attemptId, safe?.errorClass, safe?.errorCode, reason);
  return outcome;
}

async function emitReconciledDecision(
  deps: PaystackOnboardStampDeps,
  attemptId: string,
  decision: ReconciliationDecision,
  safe: { errorClass: string; errorCode: string },
): Promise<PaystackOnboardStampOutcome | null> {
  if (decision.kind === "committed") {
    return await emitStampOutcome(
      deps,
      decision.outcome,
      attemptId,
      undefined,
      decision.reason,
    );
  }
  if (decision.kind === "failure") {
    return await emitStampOutcome(deps, "stamp_failed", attemptId, safe);
  }
  if (decision.kind === "unknown") {
    return await emitStampOutcome(
      deps,
      "stamp_outcome_unknown",
      attemptId,
      safe,
      decision.reason,
    );
  }
  return null;
}

/**
 * The sole Paystack automatic-stamp decision boundary. It is invoked only
 * after the rail-defining brand write. Sharing Stripe authority, accepting a
 * direct legacy Paystack authority, or moving this before that write can put a
 * real merchant onto event-anchored payouts prematurely.
 */
export async function attemptPaystackOnboardStamp(
  deps: PaystackOnboardStampDeps,
): Promise<PaystackOnboardStampOutcome> {
  if (deps.resolveEnabled() !== true) {
    deps.log("dark_skip", null);
    return "dark_skip";
  }

  const attemptId = deps.randomUuid();
  let response: unknown;
  let thrown: unknown = null;
  try {
    response = await deps.stamp(attemptId);
  } catch (stampError) {
    thrown = stampError;
  }

  const stampDecision = thrown === null
    ? classifyStampResponse(response)
    : { kind: "ambiguous" as const, error: thrown };
  if (stampDecision.kind === "committed") {
    return await emitStampOutcome(deps, stampDecision.outcome, attemptId);
  }

  const safe = safeStampError(stampDecision.error);
  if (stampDecision.kind === "ambiguous") {
    // Compatibility adapters that predate reconciliation retain their bounded
    // failure behavior; every production adapter injects reconciliation.
    if (!deps.reconcileAttempt) {
      try {
        await deps.recordFailure(attemptId, safe.errorClass, safe.errorCode);
        return await emitStampOutcome(
          deps,
          "stamp_failed",
          attemptId,
          safe,
        );
      } catch (recordError) {
        const recordSafe = safeStampError(recordError);
        deps.log(
          "stamp_failed",
          attemptId,
          recordSafe.errorClass,
          recordSafe.errorCode,
        );
        return "stamp_failed";
      }
    }

    let reconciliationFailed = false;
    for (const offsetMs of [0, 100, 250, 500, 1000, 2000]) {
      if (offsetMs > 0) await deps.delayUntil?.(offsetMs);
      const decision = await reconcileSafely(deps, attemptId);
      if (
        decision.kind === "unknown" &&
        decision.reason === "RECONCILIATION_ERROR"
      ) {
        reconciliationFailed = true;
        continue;
      }
      const terminal = await emitReconciledDecision(
        deps,
        attemptId,
        decision,
        safe,
      );
      if (terminal !== null) return terminal;
    }
    return await emitStampOutcome(
      deps,
      "stamp_outcome_unknown",
      attemptId,
      safe,
      reconciliationFailed ? "RECONCILIATION_ERROR" : "VISIBILITY_NOT_PROVEN",
    );
  }

  const beforeInsert = await reconcileSafely(deps, attemptId);
  const preexisting = await emitReconciledDecision(
    deps,
    attemptId,
    beforeInsert,
    safe,
  );
  if (preexisting !== null) return preexisting;

  try {
    await deps.recordFailure(attemptId, safe.errorClass, safe.errorCode);
    return await emitStampOutcome(deps, "stamp_failed", attemptId, safe);
  } catch (recordError) {
    const recordSafe = safeStampError(recordError);
    const afterInsert = await reconcileSafely(deps, attemptId);
    const reconciled = await emitReconciledDecision(
      deps,
      attemptId,
      afterInsert,
      recordSafe,
    );
    if (reconciled !== null) return reconciled;
    return await emitStampOutcome(
      deps,
      "stamp_outcome_unknown",
      attemptId,
      recordSafe,
      "FAILURE_WRITE_UNCONFIRMED",
    );
  }
}

export const brandPaystackOnboardHandler = async (req: Request): Promise<Response> => {
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
      action !== "create_recipient" && action !== "update_recipient" &&
      action !== "deactivate_recipient" &&
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

    // Read the brand once for create/refresh. default_currency included so
    // clear_provider can symmetrically unstamp the issue #1014 NGN signal.
    const { data: brand, error: brandErr } = await supabase
      .from("brands")
      .select("id, name, payment_provider, payment_country, paystack_subaccount_code, default_currency")
      .eq("id", brandId)
      .maybeSingle();
    if (brandErr || !brand) {
      return jsonResponse({ error: "brand_not_found" }, 404);
    }

    const recipientDeps: BrandRecipientDeps = {
      resolveAccount: paystackResolveAccount,
      createRecipient: paystackCreateTransferRecipient,
      deleteRecipient: paystackDeleteTransferRecipient,
      fingerprintAccount: (input) =>
        hmacPaystackAccountFingerprint(resolvePaystackSecretKey(), input),
      loadRecipient: async (recipientBrandId) => {
        const { data, error } = await supabase
          .from("brand_paystack_recipients")
          .select(
            "recipient_code, bank_code, account_fingerprint, account_number_masked, account_name, is_active",
          )
          .eq("brand_id", recipientBrandId)
          .maybeSingle<BrandRecipientRow>();
        if (error) throw error;
        return data;
      },
      persistRecipient: async (recipientBrandId, recipient) => {
        const { error } = await supabase
          .from("brand_paystack_recipients")
          .upsert(
            {
              brand_id: recipientBrandId,
              ...recipient,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "brand_id" },
          );
        if (error) throw error;
      },
      deactivateRecipient: async (recipientBrandId) => {
        const { error } = await supabase
          .from("brand_paystack_recipients")
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq("brand_id", recipientBrandId);
        if (error) throw error;
      },
      audit: async (recipientAction, recipient) => {
        await writeAudit(supabase, {
          user_id: userId,
          brand_id: brandId,
          action: `paystack.recipient_${recipientAction}`,
          target_type: "brand_paystack_recipient",
          target_id: brandId,
          after: {
            recipient_code: recipient.recipient_code,
            bank_code: recipient.bank_code,
            account_number_masked: recipient.account_number_masked,
            account_name: recipient.account_name,
            is_active: recipient.is_active,
          },
        });
      },
      warn: (message, error) =>
        console.error(
          `[brand-paystack-onboard] ${message}:`,
          error instanceof Error ? error.message : String(error),
        ),
    };

    // ── action: refresh_status ───────────────────────────────────────────────
    if (action === "refresh_status") {
      let recipient: BrandRecipientRow | null;
      try {
        recipient = await recipientDeps.loadRecipient(brandId);
      } catch (error) {
        console.error(
          "[brand-paystack-onboard] recipient status read failed:",
          error,
        );
        return jsonResponse({ error: "internal_error" }, 500);
      }
      const code = brand.paystack_subaccount_code as string | null;
      if (!code) {
        return jsonResponse({
          connected: false,
          is_verified: false,
          settlement_bank: null,
          account_number_masked: null,
          recipient_connected: recipient?.is_active === true,
          recipient_code: recipient?.is_active === true
            ? recipient.recipient_code
            : null,
          recipient_account_number_masked: recipient?.is_active === true
            ? recipient.account_number_masked
            : null,
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
        recipient_connected: recipient?.is_active === true,
        recipient_code: recipient?.is_active === true
          ? recipient.recipient_code
          : null,
        recipient_account_number_masked: recipient?.is_active === true
          ? recipient.account_number_masked
          : null,
      });
    }

    if (action === "deactivate_recipient") {
      try {
        await deactivateBrandPaystackRecipient(brandId, recipientDeps);
        return jsonResponse({ deactivated: true });
      } catch (error) {
        const recipientError = error instanceof BrandRecipientError
          ? error
          : new BrandRecipientError("recipient_deactivate_failed", 500, error);
        return jsonResponse(
          { error: recipientError.code, detail: recipientError.message },
          recipientError.status,
        );
      }
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
      // issue #1014 — symmetric removal of the explicit NGN signal when the
      // brand leaves the NG rail pre-subaccount: a lingering NGN would leak
      // into a later Stripe-rail brand until the SCA sync wins the COALESCE.
      // ONLY 'NGN' is unstamped (never a Stripe-synced/other currency).
      const clearNgnStamp = brand.default_currency === "NGN";
      const clearUpdate: Record<string, unknown> = {
        payment_provider: "stripe",
        payment_country: null,
        ...(clearNgnStamp ? { default_currency: null } : {}),
      };
      const { error: updErr } = await supabase
        .from("brands")
        .update(clearUpdate)
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
        after: {
          payment_provider: "stripe",
          payment_country: null,
          ...(clearNgnStamp ? { default_currency: null } : {}),
        },
      });
      return jsonResponse({ payment_provider: "stripe", payment_country: null });
    }

    // ── action: disconnect ───────────────────────────────────────────────────
    // Stop receiving payouts: null the brand's subaccount code (checkout then
    // full-settles to the Mingla main account, as before onboarding) and
    // best-effort deactivate the Paystack subaccount so it isn't reused.
    if (action === "disconnect") {
      try {
        await deactivateBrandPaystackRecipient(brandId, recipientDeps);
      } catch (error) {
        const recipientError = error instanceof BrandRecipientError
          ? error
          : new BrandRecipientError("recipient_deactivate_failed", 500, error);
        return jsonResponse(
          { error: recipientError.code, detail: recipientError.message },
          recipientError.status,
        );
      }
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

    if (action === "create_recipient" || action === "update_recipient") {
      try {
        const recipient = await saveBrandPaystackRecipient(
          {
            action,
            brandId,
            accountNumber: body.account_number as string,
            bankCode: body.bank_code,
          },
          recipientDeps,
        );
        return jsonResponse(recipient);
      } catch (error) {
        const recipientError = error instanceof BrandRecipientError
          ? error
          : new BrandRecipientError("recipient_create_failed", 500, error);
        return jsonResponse(
          { error: recipientError.code, detail: recipientError.message },
          recipientError.status,
        );
      }
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
    // issue #1014 — stamp default_currency='NGN': an EXPLICIT NG signal
    // (ORCH-0769-compatible — the brand completed NG bank onboarding, this is
    // not an implicit default). The brands trigger
    // trg_brands_derive_pricing_from_default (META-ORCH-1236) atomically
    // derives pricing_currency='NGN' + pricing_region='NG' — do NOT write
    // those two directly. This is what lets a subsequent publish stamp
    // events.currency='NGN' (whitelist admits NGN per the #1014 migration).
    const { error: updErr } = await supabase
      .from("brands")
      .update({
        paystack_subaccount_code: subaccountCode,
        payment_provider: "paystack",
        payment_country: "NG",
        default_currency: "NGN",
      })
      .eq("id", brandId);
    if (updErr) {
      console.error("[brand-paystack-onboard] brand update failed:", updErr);
      return jsonResponse({ error: "internal_error", detail: "brand_update_failed" }, 500);
    }

    let stampReconciliationStartedAt: number | null = null;
    await attemptPaystackOnboardStamp(
      {
        resolveEnabled: resolvePaystackPayoutHoldOnboardFlip,
        randomUuid: () => crypto.randomUUID(),
        stamp: async (attemptId) => {
          return await supabase.rpc(
            "stamp_payout_hold_cutover",
            {
              p_brand_id: brandId,
              p_stripe_account_id: null,
              p_batch_id: attemptId,
              p_actor_email: null,
              p_actor_uid: userId,
              p_reason: "paystack_onboarding_auto_stamp",
            },
          );
        },
        reconcileAttempt: async (attemptId) => {
          stampReconciliationStartedAt ??= Date.now();
          const { data, error } = await supabase
            .from("payout_hold_cutover_migrations")
            .select("batch_id, brand_id, direction, reason, result")
            .eq("batch_id", attemptId);
          if (error || !Array.isArray(data)) {
            return { kind: "unknown", reason: "RECONCILIATION_ERROR" };
          }
          if (data.length === 0) return { kind: "not_visible" };

          let hasFlip = false;
          let hasSkip = false;
          let hasFailure = false;
          for (const row of data) {
            if (
              row?.batch_id !== attemptId || row?.brand_id !== brandId ||
              row?.direction !== "hold" ||
              row?.reason !== "paystack_onboarding_auto_stamp"
            ) {
              return {
                kind: "unknown",
                reason: "BATCH_IDENTITY_MISMATCH",
              };
            }
            if (row.result === "flipped") hasFlip = true;
            else if (row.result === "skipped_already_stamped") hasSkip = true;
            else if (row.result === "stamp_failed") hasFailure = true;
            else {
              return { kind: "unknown", reason: "BATCH_RESULT_CONFLICT" };
            }
          }
          if (hasFlip && hasSkip) {
            return { kind: "unknown", reason: "BATCH_RESULT_CONFLICT" };
          }
          if (hasFlip || hasSkip) {
            return {
              kind: "committed",
              outcome: hasFlip ? "flipped" : "skipped_already_stamped",
              ...(hasFailure
                ? { reason: "BATCH_HAS_STALE_FAILURE" as const }
                : {}),
            };
          }
          if (hasFailure) return { kind: "failure" };
          return { kind: "unknown", reason: "BATCH_RESULT_CONFLICT" };
        },
        delayUntil: async (offsetMs) => {
          stampReconciliationStartedAt ??= Date.now();
          const remainingMs = stampReconciliationStartedAt + offsetMs -
            Date.now();
          if (remainingMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, remainingMs));
          }
        },
        recordFailure: async (attemptId, errorClass, errorCode) => {
          const { error } = await supabase
            .from("payout_hold_cutover_migrations")
            .insert({
              batch_id: attemptId,
              brand_id: brandId,
              stripe_account_id: null,
              direction: "hold",
              prior_interval: null,
              new_interval: null,
              cutover_before: null,
              cutover_after: null,
              result: "stamp_failed",
              error_message:
                `paystack_onboarding_auto_stamp:${errorClass}:${errorCode}`,
              actor_email: null,
              actor_uid: userId,
              reason: "paystack_onboarding_auto_stamp",
            });
          if (error) {
            throw {
              name: "LedgerWriteError",
              code: typeof error.code === "string" ? error.code : undefined,
            };
          }
        },
        recordApplicationOutcome: async (outcome, attemptId, safeReason) => {
          await writeAudit(supabase, {
            user_id: userId,
            brand_id: brandId,
            action: `payout_hold.paystack_onboarding_${outcome}`,
            target_type: "brand",
            target_id: brandId,
            after: {
              outcome,
              attempt_id: attemptId,
              reason: "paystack_onboarding_auto_stamp",
              ...(safeReason ? { safe_reason: safeReason } : {}),
            },
          });
        },
        log: (outcome, attemptId, errorClass, errorCode, safeReason) => {
          const event = {
            event: "paystack_onboarding_auto_stamp",
            outcome,
            brand_id: brandId,
            actor_uid: userId,
            ...(attemptId ? { attempt_id: attemptId } : {}),
            ...(errorClass ? { error_class: errorClass } : {}),
            ...(errorCode ? { error_code: errorCode } : {}),
            ...(safeReason ? { safe_reason: safeReason } : {}),
          };
          if (
            outcome === "stamp_failed" || outcome === "stamp_outcome_unknown"
          ) console.error(JSON.stringify(event));
          else console.info(JSON.stringify(event));
        },
      },
    );

    await writeAudit(supabase, {
      user_id: userId,
      brand_id: brandId,
      action: "paystack.subaccount_created",
      target_type: "brand",
      target_id: brandId,
      after: {
        paystack_subaccount_code: subaccountCode,
        payment_country: "NG",
        default_currency: "NGN",
      },
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
};

if (import.meta.main) serve(brandPaystackOnboardHandler);
