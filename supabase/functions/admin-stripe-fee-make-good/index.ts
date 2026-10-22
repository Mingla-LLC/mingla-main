/**
 * admin-stripe-fee-make-good \u2014 Issue #3645 option b.
 *
 * Accounts created before #4044 keep defaults.responsibilities.fees_collector
 * = 'stripe', so Stripe deducts its processing fee from the CONNECTED balance
 * on every direct charge while the payout ledger (gross \u2212 refunds \u2212 disputes \u2212
 * Mingla fee) assumes Mingla paid it. Stripe does not let a platform change
 * that responsibility on an existing account:
 *   "You must define defaults.responsibilities properties when you add the
 *    Merchant configuration to an account. You can't update their values later."
 *   https://docs.stripe.com/connect/accounts-v2/connected-account-configuration#set-responsibilities
 * (v1 POST /v1/accounts/:id has no `controller` parameter either.) The only way
 * onto 'application' is a NEW account through the brand's own onboarding.
 *
 * Modes (admin-only; verify_jwt = true, then an active admin_users row):
 *   - census               read-only: what each unpaid Stripe release is owed
 *                           (stripe_fee_make_good_census). No Stripe call.
 *   - fees_collector_check read-only Stripe GET of the brand's account; reports
 *                           controller.fees.payer and, when it is not
 *                           'application', that Stripe forbids the change and the
 *                           path is re-onboarding. One admin_write_audit row.
 *   - make_good            ONE platform \u2192 connected-account Transfer equal to
 *                           the release's ledger processing-fee gap
 *                           (plan_stripe_fee_make_good). The caller must send the
 *                           expected amount; the RPC refuses any other number.
 *                           Deterministic idempotency key per release + covered
 *                           total, so a retry after a lost response returns the
 *                           same Transfer. One admin_write_audit row.
 *
 * The amount is never derived from a balance read: it is the sum of the
 * release's payout_release_items.provider_fee_cents (stored balance-transaction
 * fee minus Mingla's application fee, #3872) less what was already made good.
 * After a make-good the payout sweep's existing balance check lets the ledger
 * payout through; this function never creates a payout itself.
 *
 * Stripe key: PAYOUT_RELEASE role (STRIPE_RAK_PAYOUT_RELEASE_{TEST|LIVE}). The
 * Transfer is a platform call (no Stripe-Account header), so the key needs the
 * platform "Transfers: Write" permission in addition to Connect Balance read +
 * Payouts write. fees_collector_check uses REFRESH_STATUS (Connect accounts read).
 *   https://docs.stripe.com/api/transfers/create
 *   https://docs.stripe.com/api/idempotent_requests
 */

// @ts-ignore \u2014 Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore \u2014 Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  STRIPE_API_VERSION,
  stripePayoutRelease,
  stripeRefreshStatus,
} from "../_shared/stripe.ts";

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

export const RE_ONBOARD_PATH =
  "Stripe does not allow fees_collector to change on an existing account. " +
  "The brand detaches its Stripe account and connects again through its own " +
  "onboarding (brand-stripe-detach, then brand-stripe-onboard), which creates " +
  "an account with fees_collector=application. Make good every unpaid release " +
  "on the old account first: releases pay out from the brand's current account.";

export type TransferInput = {
  amountCents: number;
  currency: string;
  destination: string;
  releaseId: string;
  makeGoodId: string;
  idempotencyKey: string;
};

export type TransferResult = {
  id: string;
  amount: number;
  currency: string;
  destination: string | { id: string } | null;
};

export type MakeGoodDeps = {
  env: (key: string) => string | undefined;
  createAdmin: typeof createClient;
  createTransfer: (input: TransferInput) => Promise<TransferResult>;
  retrieveFeesPayer: (
    stripeAccountId: string,
  ) => Promise<{ feesPayer: string | null; lossesPayments: string | null }>;
};

const defaultDeps: MakeGoodDeps = {
  // Literal reads only: the function-secret contract audits every env name.
  env: (key) =>
    key === "SUPABASE_URL"
      ? Deno.env.get("SUPABASE_URL")
      : key === "SUPABASE_SERVICE_ROLE_KEY"
      ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      : undefined,
  createAdmin: createClient,
  createTransfer: async (input) => {
    const stripe = stripePayoutRelease();
    // @ts-ignore \u2014 Stripe SDK Transfers namespace is runtime-provided.
    return await stripe.transfers.create(
      {
        amount: input.amountCents,
        currency: input.currency,
        destination: input.destination,
        transfer_group: `mingla_release_${input.releaseId}`,
        description: "Mingla covers the Stripe processing fee on this payout",
        metadata: {
          mingla_release_id: input.releaseId,
          mingla_make_good_id: input.makeGoodId,
          mingla_kind: "processing_fee_make_good",
          mingla_issue: "3645",
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );
  },
  retrieveFeesPayer: async (stripeAccountId) => {
    const stripe = stripeRefreshStatus();
    // orch-strict-grep-allow stripe-no-idempotency-key \u2014 read-only retrieve (GET; no mutation to dedupe)
    // @ts-ignore \u2014 Stripe SDK accounts namespace is runtime-provided in Deno.
    const account = await stripe.accounts.retrieve(stripeAccountId, {
      apiVersion: STRIPE_API_VERSION,
    });
    const controller = (account as {
      controller?: {
        fees?: { payer?: string };
        losses?: { payments?: string };
      };
    }).controller;
    return {
      feesPayer: controller?.fees?.payer ?? null,
      lossesPayments: controller?.losses?.payments ?? null,
    };
  },
};

/**
 * A Stripe error that will fail the same way on retry (bad request, missing
 * permission, insufficient platform balance) is definitive: the planned row is
 * marked failed so a later attempt gets a fresh key. Anything else (network,
 * 5xx, rate limit, idempotency in flight) stays planned and is resumed with the
 * SAME key. https://docs.stripe.com/error-handling
 */
export function isDefinitiveStripeError(error: unknown): boolean {
  const e = error as { type?: string; statusCode?: number } | null;
  if (!e || typeof e !== "object") return false;
  if (e.type === "StripeConnectionError" || e.type === "StripeAPIError") {
    return false;
  }
  if (e.type === "StripeRateLimitError") return false;
  if (e.type === "StripeIdempotencyError") return false;
  const status = Number(e.statusCode ?? 0);
  if (status === 409 || status === 429 || status >= 500 || status === 0) {
    return false;
  }
  return status >= 400 && status < 500;
}

function transferDestinationId(
  destination: TransferResult["destination"],
): string | null {
  if (!destination) return null;
  return typeof destination === "string" ? destination : destination.id;
}

type Body = {
  mode?: unknown;
  brand_id?: unknown;
  release_id?: unknown;
  expected_amount_cents?: unknown;
  reason?: unknown;
};

export async function handleAdminStripeFeeMakeGood(
  req: Request,
  deps: MakeGoodDeps = defaultDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const mode = typeof body.mode === "string" ? body.mode : "";
  if (
    mode !== "census" && mode !== "fees_collector_check" &&
    mode !== "make_good"
  ) {
    return json({ error: "validation_error", detail: "mode_invalid" }, 400);
  }
  const rawReason = typeof body.reason === "string" ? body.reason : "";
  if (mode !== "census" && rawReason.replace(INVISIBLE_WS, "") === "") {
    return json({ error: "reason_required", field: "reason" }, 400);
  }
  const reason = rawReason.trim();

  // \u2500\u2500 ADMIN GATE (mirrors admin-stripe-connect-action). \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = deps.createAdmin(
    deps.env("SUPABASE_URL") ?? "",
    deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    token,
  );
  if (authError || !user || !user.email) {
    return json({ error: "unauthorized" }, 401);
  }
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  // \u2500\u2500 mode: census (read-only, no Stripe) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (mode === "census") {
    const { data, error } = await supabase.rpc(
      "stripe_fee_make_good_census",
      {},
    );
    if (error) {
      console.error("[admin-stripe-fee-make-good] census failed", error.message);
      return json({ error: "internal_error" }, 500);
    }
    return json({ releases: data ?? [] });
  }

  // \u2500\u2500 mode: fees_collector_check (read-only Stripe GET + audit) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (mode === "fees_collector_check") {
    const brandId = typeof body.brand_id === "string" ? body.brand_id : "";
    if (!UUID_REGEX.test(brandId)) {
      return json(
        { error: "validation_error", detail: "brand_id_invalid_uuid" },
        400,
      );
    }
    const { data: sca, error: scaError } = await supabase
      .from("stripe_connect_accounts")
      .select("stripe_account_id, detached_at")
      .eq("brand_id", brandId)
      .maybeSingle();
    if (scaError) return json({ error: "internal_error" }, 500);
    if (!sca?.stripe_account_id) {
      return json({ error: "no_connect_account" }, 422);
    }
    let payer: { feesPayer: string | null; lossesPayments: string | null };
    try {
      payer = await deps.retrieveFeesPayer(sca.stripe_account_id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return json({ error: "stripe_api_error", detail }, 502);
    }
    const onApplication = payer.feesPayer === "application";
    const verdict = onApplication ? "already_application" : "re_onboard_required";
    const { error: auditError } = await supabase.rpc("admin_write_audit", {
      p_action: "connect.fees_collector_check",
      p_entity_type: "stripe_connect_account",
      p_entity_id: sca.stripe_account_id,
      p_reason: reason,
      p_metadata: {
        brand_id: brandId,
        fees_payer: payer.feesPayer,
        losses_payments: payer.lossesPayments,
        verdict,
        issue: 3645,
      },
      p_actor_email: user.email,
      p_actor_uid: user.id,
    });
    if (auditError) {
      console.error(
        "[admin-stripe-fee-make-good] audit failed",
        auditError.message,
      );
      return json({ error: "audit_failed" }, 500);
    }
    return json({
      brand_id: brandId,
      stripe_account_id: sca.stripe_account_id,
      detached: sca.detached_at !== null,
      fees_payer: payer.feesPayer,
      losses_payments: payer.lossesPayments,
      migration_supported: false,
      verdict,
      path: onApplication ? null : RE_ONBOARD_PATH,
    });
  }

  // \u2500\u2500 mode: make_good (one ledger-recorded Transfer) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const releaseId = typeof body.release_id === "string" ? body.release_id : "";
  if (!UUID_REGEX.test(releaseId)) {
    return json(
      { error: "validation_error", detail: "release_id_invalid_uuid" },
      400,
    );
  }
  const expected = body.expected_amount_cents;
  if (
    typeof expected !== "number" || !Number.isInteger(expected) ||
    expected < 0
  ) {
    return json(
      { error: "validation_error", detail: "expected_amount_cents_invalid" },
      400,
    );
  }

  const { data: plan, error: planError } = await supabase.rpc(
    "plan_stripe_fee_make_good",
    {
      p_release_id: releaseId,
      p_expected_amount_cents: expected,
      p_actor_email: user.email,
      p_reason: reason,
    },
  );
  if (planError) {
    // Refusals (amount mismatch, release paid, account mismatch \u2026) are the
    // ledger saying no; surface the code, send nothing.
    return json({ error: "make_good_refused", detail: planError.message }, 409);
  }
  const planned = plan as {
    outcome: "planned" | "resumed" | "nothing_owed";
    make_good_id?: string;
    amount_cents: number;
    currency?: string;
    stripe_account_id?: string;
    idempotency_key?: string;
  };
  if (planned.outcome === "nothing_owed") {
    return json({ outcome: "nothing_owed", release_id: releaseId });
  }

  const input: TransferInput = {
    amountCents: planned.amount_cents,
    currency: String(planned.currency),
    destination: String(planned.stripe_account_id),
    releaseId,
    makeGoodId: String(planned.make_good_id),
    idempotencyKey: String(planned.idempotency_key),
  };

  let transfer: TransferResult;
  try {
    transfer = await deps.createTransfer(input);
    if (
      !transfer?.id || transfer.amount !== input.amountCents ||
      String(transfer.currency).toLowerCase() !== input.currency.toLowerCase() ||
      transferDestinationId(transfer.destination) !== input.destination
    ) {
      // Stripe answered with something we did not ask for. Leave the row
      // planned (the same key returns the same object) and stop for a human.
      console.error("[admin-stripe-fee-make-good] transfer response mismatch", {
        releaseId,
        transferId: transfer?.id ?? null,
      });
      return json({
        error: "stripe_transfer_response_mismatch",
        make_good_id: input.makeGoodId,
      }, 502);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (isDefinitiveStripeError(err)) {
      await supabase.rpc("record_stripe_fee_make_good", {
        p_make_good_id: input.makeGoodId,
        p_outcome: "failed",
        p_stripe_transfer_id: null,
        p_amount_cents: input.amountCents,
        p_error_message: detail,
      });
      await supabase.rpc("admin_write_audit", {
        p_action: "payout.stripe_fee_make_good_failed",
        p_entity_type: "brand_payout_release",
        p_entity_id: releaseId,
        p_reason: reason,
        p_metadata: {
          make_good_id: input.makeGoodId,
          amount_cents: input.amountCents,
          currency: input.currency,
          stripe_account_id: input.destination,
          error: detail,
          issue: 3645,
        },
        p_actor_email: user.email,
        p_actor_uid: user.id,
      });
      return json({
        error: "stripe_transfer_refused",
        detail,
        make_good_id: input.makeGoodId,
      }, 502);
    }
    return json({
      error: "stripe_transfer_retryable",
      detail,
      make_good_id: input.makeGoodId,
    }, 503);
  }

  const { error: recordError } = await supabase.rpc(
    "record_stripe_fee_make_good",
    {
      p_make_good_id: input.makeGoodId,
      p_outcome: "sent",
      p_stripe_transfer_id: transfer.id,
      p_amount_cents: transfer.amount,
      p_error_message: null,
    },
  );
  if (recordError) {
    // The money moved but the ledger write failed. The row stays planned, so
    // the next call resumes it with the same key, Stripe returns this same
    // Transfer and the record succeeds. Never re-plan by hand.
    console.error("[admin-stripe-fee-make-good] record failed after transfer", {
      releaseId,
      transferId: transfer.id,
      message: recordError.message,
    });
    return json({
      error: "ledger_record_failed_after_transfer",
      transfer_id: transfer.id,
      make_good_id: input.makeGoodId,
    }, 500);
  }

  const { error: auditError } = await supabase.rpc("admin_write_audit", {
    p_action: "payout.stripe_fee_make_good",
    p_entity_type: "brand_payout_release",
    p_entity_id: releaseId,
    p_reason: reason,
    p_metadata: {
      make_good_id: input.makeGoodId,
      transfer_id: transfer.id,
      amount_cents: input.amountCents,
      currency: input.currency,
      stripe_account_id: input.destination,
      idempotency_key: input.idempotencyKey,
      resumed: planned.outcome === "resumed",
      issue: 3645,
    },
    p_actor_email: user.email,
    p_actor_uid: user.id,
  });
  if (auditError) {
    console.error(
      "[admin-stripe-fee-make-good] audit failed (transfer recorded)",
      auditError.message,
    );
  }

  return json({
    outcome: "sent",
    release_id: releaseId,
    make_good_id: input.makeGoodId,
    transfer_id: transfer.id,
    amount_cents: input.amountCents,
    currency: input.currency,
    stripe_account_id: input.destination,
    resumed: planned.outcome === "resumed",
  });
}

if (import.meta.main) {
  serve((req: Request) => handleAdminStripeFeeMakeGood(req));
}
