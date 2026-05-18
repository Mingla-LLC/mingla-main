/**
 * ORCH-0869 [Tr3 Installment Payments] — Stage 1 cron edge function.
 *
 * Per SPEC §3.2.1.
 *
 * CONTRACT (per I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER):
 * - This file is the SINGLE OWNER of installment PI creation. No other code
 *   path may create a PaymentIntent that carries metadata `mingla_installment_id`.
 * - PI metadata MUST include mingla_installment_id, mingla_installment_ordinal,
 *   mingla_order_id, mingla_brand_id (webhook router discriminates on these).
 * - Idempotency key MUST include retry_count so each retry attempt is
 *   independently idempotent (Stripe returns existing PI on duplicate; new PI
 *   on next retry attempt).
 * - Customer + PaymentMethod live on the CONNECTED account — Stripe-Account
 *   header on every API call (no exceptions).
 * - Application fee = Math.round(amount * 0.015) per ORCH-0843 rate.
 * - At-risk flag flips on retry_count >= 3 + cron halts further retries.
 * - Dunning email fires on each failure attempt until success or at_risk.
 *
 * Refund logic = Tr4 scope, NOT here.
 *
 * Invoked by pg_cron schedule 'orch-0869-process-scheduled-installments'
 * every 6 hours (see migration 20260610000000_tr3_installments.sql). Safe
 * to invoke twice — Stripe idempotency + DB predicate UPDATE serialise.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { writeAudit } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const MINGLA_APPLICATION_FEE_RATE = 0.015 as const;
const MAX_RETRY_ATTEMPTS = 3 as const;
const DEFAULT_BATCH_LIMIT = 500 as const;

// Retry cadence (per SPEC §3.2.1 + Open Polish §9): Day-3 then Day-7 then at-risk.
const RETRY_INTERVAL_HOURS_BY_RETRY_COUNT = {
  1: 72,   // first retry 3 days after initial fail
  2: 168,  // second retry 7 days after first retry
  // After retry_count=3, no next_retry_at; at_risk=true.
} as const;

type InstallmentRow = {
  id: string;
  order_id: string;
  ordinal: number;
  amount_cents: number;
  currency: string;
  due_at: string;
  status: string;
  retry_count: number;
  stripe_payment_intent_id: string | null;
};

type OrderRow = {
  id: string;
  event_id: string;
  // orders has NO brand_id column — brand reachable via orders.event_id ->
  // events.brand_id. Cron fetches brand_id from a separate events query.
  stripe_customer_id_on_connected_account: string | null;
  saved_payment_method_id: string | null;
  buyer_user_id: string | null;
  buyer_email: string;
  at_risk: boolean;
};

type EventRow = {
  id: string;
  brand_id: string;
};

type BrandRow = {
  id: string;
  contact_email: string | null;
  name: string;
};

type StripeAccount = {
  brand_id: string;
  stripe_account_id: string;
};

type ProcessResult = {
  processed: number;
  collected: number;
  failed: number;
  at_risk_flagged: number;
  errors: Array<{ installment_id: string; reason: string }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function nextRetryAtFor(retryCount: number): string | null {
  const hours = RETRY_INTERVAL_HOURS_BY_RETRY_COUNT[
    retryCount as keyof typeof RETRY_INTERVAL_HOURS_BY_RETRY_COUNT
  ];
  if (hours === undefined) return null;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

async function fireDunningEmail(
  supabase: SupabaseClient,
  installment: InstallmentRow,
  order: OrderRow,
  brand: BrandRow,
  failureReason: string,
): Promise<void> {
  // Dispatch via the existing ticket-confirmation-dispatch pipeline. The
  // dispatcher routes by event_type and email_kind. For Tr3 dunning, the
  // kind is 'installment_dunning' (handled in installmentDunningEmail.ts —
  // imported by the dispatcher via the shared email index).
  try {
    if (SUPABASE_URL === undefined || SUPABASE_SERVICE_ROLE_KEY === undefined) {
      return;
    }
    await fetch(`${SUPABASE_URL}/functions/v1/ticket-confirmation-dispatch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "installment_dunning",
        orderId: order.id,
        installmentId: installment.id,
        installmentOrdinal: installment.ordinal,
        amountCents: installment.amount_cents,
        currency: installment.currency,
        failureReason,
        brandContactEmail: brand.contact_email,
        brandName: brand.name,
      }),
    });
  } catch (err) {
    console.error(
      "[process-scheduled-installments] dunning email dispatch failed",
      err instanceof Error ? err.message : err,
    );
    // Non-fatal — webhook on next failed attempt will retry the dispatch.
  }
}

async function processInstallment(
  supabase: SupabaseClient,
  installment: InstallmentRow,
  order: OrderRow,
  brand: BrandRow,
  stripeAccount: StripeAccount,
  dryRun: boolean,
): Promise<{
  outcome: "collected" | "failed" | "skipped" | "at_risk_flagged";
  reason?: string;
}> {
  // Guard: order must have saved PM + Customer on connected account
  if (
    order.stripe_customer_id_on_connected_account === null ||
    order.saved_payment_method_id === null
  ) {
    // Cannot charge without saved PM — mark as failed with clear reason.
    if (!dryRun) {
      await supabase
        .from("order_installments")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          failure_reason: "saved_payment_method_missing",
          retry_count: installment.retry_count + 1,
          next_retry_at: null, // no retry — operator must contact buyer
          updated_at: new Date().toISOString(),
        })
        .eq("id", installment.id)
        .eq("status", "scheduled");
    }
    return { outcome: "failed", reason: "saved_payment_method_missing" };
  }

  // Cron is conditional on order not already being at_risk.
  if (order.at_risk) {
    return { outcome: "skipped", reason: "order_at_risk_no_more_retries" };
  }

  if (dryRun) {
    console.log(
      `[process-scheduled-installments] DRY RUN — would charge installment ${installment.id} (order ${installment.order_id} ordinal ${installment.ordinal}) for ${installment.amount_cents} ${installment.currency}`,
    );
    return { outcome: "collected", reason: "dry_run" };
  }

  const stripe = stripeTicketCheckout();
  const applicationFeeAmountCents = Math.round(
    installment.amount_cents * MINGLA_APPLICATION_FEE_RATE,
  );

  // Idempotency key includes retry_count so each retry attempt is independently
  // idempotent. Stripe returns existing PI on duplicate; new PI on next retry.
  // Format `installment:{order_id}:{ordinal}:{retry_count}` is intentional per
  // SPEC §3.2.1 (retry-aware uniqueness) — diverges from the canonical
  // `{brand_id}:{op}:{epoch_ms}` shape because the cron must produce a
  // DETERMINISTIC key per (installment, attempt) so concurrent cron + webhook
  // arrivals never double-charge. The key IS passed at the call below (line
  // ~30 down via the request-options second arg); the I-PROPOSED-R gate
  // looks within ~10 lines of the create( call and so does not see it.
  const idempotencyKey = `installment:${installment.order_id}:${installment.ordinal}:${installment.retry_count}`;

  try {
    // orch-strict-grep-allow stripe-no-idempotency-key — idempotencyKey IS passed via the request-options second arg (~30 lines below); SPEC §3.2.1 retry-aware format diverges from generateIdempotencyKey's epoch-ms shape because cron + webhook need deterministic per-(installment,attempt) keys to prevent double-charge.
    // @ts-ignore — Stripe SDK namespace runtime-provided in Deno.
    const pi = await stripe.paymentIntents.create(
      {
        amount: installment.amount_cents,
        currency: installment.currency.toLowerCase(),
        customer: order.stripe_customer_id_on_connected_account,
        payment_method: order.saved_payment_method_id,
        confirm: true,
        off_session: true,
        payment_method_types: ["card"], // installment plans card-only (SPEC §3.2.2)
        ...(applicationFeeAmountCents > 0
          ? { application_fee_amount: applicationFeeAmountCents }
          : {}),
        metadata: {
          mingla_installment_id: installment.id,
          mingla_installment_ordinal: String(installment.ordinal),
          mingla_order_id: order.id,
          mingla_brand_id: brand.id,
        },
      },
      {
        idempotencyKey,
        stripeAccount: stripeAccount.stripe_account_id,
      },
    );

    // Stripe accepted the PI. The webhook handler will write status=collected
    // when payment_intent.succeeded fires. For sync-confirm PIs (the typical
    // case with off_session card charges that succeed without 3DS), the PI
    // may already be in 'succeeded' status here. Either way, the webhook is
    // authoritative — we ONLY write the PI id here, not the success state.
    await supabase
      .from("order_installments")
      .update({
        stripe_payment_intent_id: pi.id,
        // Reset failure fields in case this is a retry
        failed_at: null,
        failure_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", installment.id);

    await writeAudit(supabase, {
      user_id: null,
      brand_id: brand.id,
      event_id: order.event_id,
      action: "tr3.installment_pi_created",
      target_type: "order_installment",
      target_id: installment.id,
      after: {
        ordinal: installment.ordinal,
        amount_cents: installment.amount_cents,
        stripe_payment_intent_id: pi.id,
        retry_count: installment.retry_count,
      },
    });

    return { outcome: "collected", reason: "pi_created" };
  } catch (err) {
    const stripeErr = err as { message?: string; code?: string; type?: string; statusCode?: number };
    const reason = `${stripeErr.code ?? stripeErr.type ?? "unknown"}:${stripeErr.message ?? ""}`.slice(0, 500);
    const nextRetryCount = installment.retry_count + 1;
    const willBeAtRisk = nextRetryCount >= MAX_RETRY_ATTEMPTS;
    const nextRetryAt = willBeAtRisk ? null : nextRetryAtFor(nextRetryCount);

    // Atomic-ish update — predicate on status='scheduled' so a concurrent
    // cron run cannot double-write.
    await supabase
      .from("order_installments")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_reason: reason,
        retry_count: nextRetryCount,
        next_retry_at: nextRetryAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", installment.id)
      .eq("status", "scheduled");

    if (willBeAtRisk) {
      await supabase
        .from("orders")
        .update({
          at_risk: true,
          at_risk_since: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("at_risk", false);
    }

    await writeAudit(supabase, {
      user_id: null,
      brand_id: brand.id,
      event_id: order.event_id,
      action: "tr3.installment_pi_failed",
      target_type: "order_installment",
      target_id: installment.id,
      after: {
        ordinal: installment.ordinal,
        retry_count: nextRetryCount,
        next_retry_at: nextRetryAt,
        failure_reason: reason,
        at_risk_flipped: willBeAtRisk,
      },
    });

    // Fire dunning email. Non-fatal — logged + audit captures.
    await fireDunningEmail(supabase, installment, order, brand, reason);

    return willBeAtRisk
      ? { outcome: "at_risk_flagged", reason }
      : { outcome: "failed", reason };
  }
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (SUPABASE_URL === undefined || SUPABASE_SERVICE_ROLE_KEY === undefined) {
    return jsonResponse({ error: "supabase_env_missing" }, 500);
  }

  // Service-role auth check: pg_cron's net.http_post sends the
  // SUPABASE_SERVICE_ROLE_KEY in the authorization header. Reject any other
  // caller. (For local Deno tests, the test fixture sets the same header.)
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (authHeader !== expected) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: { dryRun?: boolean; limit?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const dryRun = body.dryRun === true;
  const limit = typeof body.limit === "number" && body.limit > 0 && body.limit <= 5000
    ? body.limit
    : DEFAULT_BATCH_LIMIT;

  // [TRANSITIONAL] Typed as untyped SupabaseClient because order_installments
  // + new orders columns (at_risk, saved_payment_method_id, etc.) don't exist
  // in the regenerated DB types until the operator runs `supabase db push` on
  // migration 20260610000000_tr3_installments.sql. Tighten generic after that.
  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Query 1: due scheduled installments (initial attempts).
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — belt-and-braces filter
  // `is("cancelled_at", null)` per I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED.
  // The DB-level CHECK constraint order_installments_cancelled_at_status_consistent
  // already enforces (status='cancelled') ⟺ (cancelled_at IS NOT NULL), so the
  // existing status='scheduled' filter would already exclude cancelled rows.
  // The explicit cancelled_at filter is defense-in-depth against transaction-
  // visibility lag during a rare race between cancel-trip-booking commit and
  // this cron query.
  const { data: dueRows, error: dueError } = await supabase
    .from("order_installments")
    .select(`
      id, order_id, ordinal, amount_cents, currency, due_at, status,
      retry_count, stripe_payment_intent_id
    `)
    .eq("status", "scheduled")
    .is("cancelled_at", null)
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(limit);

  if (dueError !== null) {
    console.error("[process-scheduled-installments] due query failed", dueError);
    return jsonResponse({ error: "due_query_failed", detail: dueError.message }, 500);
  }

  // Query 2: failed-then-retry-eligible installments.
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — same belt-and-braces
  // cancelled_at filter as Query 1 (I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED).
  const { data: retryRows, error: retryError } = await supabase
    .from("order_installments")
    .select(`
      id, order_id, ordinal, amount_cents, currency, due_at, status,
      retry_count, stripe_payment_intent_id
    `)
    .eq("status", "failed")
    .is("cancelled_at", null)
    .lte("next_retry_at", new Date().toISOString())
    .lt("retry_count", MAX_RETRY_ATTEMPTS)
    .order("next_retry_at", { ascending: true })
    .limit(Math.max(0, limit - (dueRows?.length ?? 0)));

  if (retryError !== null) {
    console.error("[process-scheduled-installments] retry query failed", retryError);
    return jsonResponse({ error: "retry_query_failed", detail: retryError.message }, 500);
  }

  // Flip retry rows back to 'scheduled' for processing (matches biz_retry_installment shape).
  const retryIds = (retryRows ?? []).map((r) => r.id);
  if (retryIds.length > 0) {
    await supabase
      .from("order_installments")
      .update({ status: "scheduled", updated_at: new Date().toISOString() })
      .in("id", retryIds)
      .eq("status", "failed");
  }

  const allRows: InstallmentRow[] = [...(dueRows ?? []), ...(retryRows ?? [])] as InstallmentRow[];

  const result: ProcessResult = {
    processed: 0,
    collected: 0,
    failed: 0,
    at_risk_flagged: 0,
    errors: [],
  };

  for (const installment of allRows) {
    result.processed += 1;
    try {
      // Per-row joins (small N per run; could batch-join in future if N grows)
      const { data: order } = await supabase
        .from("orders")
        .select("id, event_id, stripe_customer_id_on_connected_account, saved_payment_method_id, buyer_user_id, buyer_email, at_risk")
        .eq("id", installment.order_id)
        .maybeSingle();
      if (order === null) {
        result.errors.push({ installment_id: installment.id, reason: "order_not_found" });
        continue;
      }
      // orders has no brand_id column — resolve via events FK.
      const { data: eventRow } = await supabase
        .from("events")
        .select("id, brand_id")
        .eq("id", (order as OrderRow).event_id)
        .maybeSingle();
      if (eventRow === null) {
        result.errors.push({ installment_id: installment.id, reason: "event_not_found" });
        continue;
      }
      const brandId = String((eventRow as Record<string, unknown>).brand_id);
      const { data: brand } = await supabase
        .from("brands")
        .select("id, contact_email, name")
        .eq("id", brandId)
        .maybeSingle();
      if (brand === null) {
        result.errors.push({ installment_id: installment.id, reason: "brand_not_found" });
        continue;
      }
      const { data: stripeAccount } = await supabase
        .from("stripe_connect_accounts")
        .select("brand_id, stripe_account_id")
        .eq("brand_id", brandId)
        .is("detached_at", null)
        .maybeSingle();
      if (stripeAccount === null) {
        result.errors.push({ installment_id: installment.id, reason: "stripe_account_missing" });
        continue;
      }

      const outcome = await processInstallment(
        supabase,
        installment,
        order as OrderRow,
        brand as BrandRow,
        stripeAccount as StripeAccount,
        dryRun,
      );

      switch (outcome.outcome) {
        case "collected":
          result.collected += 1;
          break;
        case "failed":
          result.failed += 1;
          break;
        case "at_risk_flagged":
          result.failed += 1;
          result.at_risk_flagged += 1;
          break;
        case "skipped":
          // do not count toward collected/failed; skip silently
          break;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ installment_id: installment.id, reason });
      console.error(
        `[process-scheduled-installments] row processing crashed for ${installment.id}:`,
        reason,
      );
    }
  }

  console.log(
    `[process-scheduled-installments] run complete: processed=${result.processed} collected=${result.collected} failed=${result.failed} at_risk=${result.at_risk_flagged} errors=${result.errors.length}`,
  );

  return jsonResponse(result, 200);
});
