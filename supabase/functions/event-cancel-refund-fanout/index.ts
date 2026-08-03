/**
 * event-cancel-refund-fanout — issue #1179 (initiative #1013 sub-issue J).
 *
 * When an event is cancelled (business_cancel_event / admin_cancel_offering), this
 * SERVICE-ROLE fan-out refunds every paid, not-fully-refunded order (tickets AND
 * trips) exactly once on its own rail. It is invoked both by a best-effort client
 * kickoff (latency optimisation) and by a dedicated pg_cron backstop (correctness).
 *
 * verify_jwt = false (config.toml): callers are the cron (service-role bearer, not a
 * user JWT) and the client kickoffs. There is NO user gate — authorization is the
 * status-first precondition inside cancel_event_refund_prepare: a live (or
 * racing-not-yet-cancelled) event raises event_not_cancelled and yields ZERO refunds
 * regardless of caller (I-PROPOSED-1179-CANCEL-REFUNDS-ONLY-ON-CANCELLED).
 *
 * Idempotency is triple-guarded: event_cancel_refund_progress UNIQUE(source_type,
 * source_id) + the deterministic key cancel_refund:<event>:<order> (admin_refund_order
 * replay + Stripe/Paystack provider idempotency) + the claim lease. Every re-drive
 * (kickoff + cron + manual) is a no-op — each buyer is refunded exactly once
 * (I-PROPOSED-1179-ONE-REFUND-PER-OBJECT).
 *
 * The per-object refund MIRRORS admin-refund-order/index.ts (same crash-safe
 * pending-before-provider ordering, same Stripe direct-charge shape + tax reversal,
 * same Paystack reconcile path) but with cancellation-scoped idempotency keys and no
 * admin gate/audit. Buyer refund notifications are delivered by the EXISTING webhook
 * refund-reconciliation path (stripe/paystack) exactly once — the fan-out enqueues
 * NOTHING (mirrors admin-refund-order:20-23) to avoid double-notify.
 *
 * Temporary→permanent debt supersession for Stripe released occurrences is done ONCE,
 * atomically, inside cancel_event_refund_prepare BEFORE any refund fires (Paystack
 * supersession is owned by F's record_paystack_refund_outcome) — the Stripe refund
 * path here writes NO debt row (I-PROPOSED-1179-NO-DOUBLE-WITHHOLD).
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import {
  createPaystackRefund,
  isPaystackRefundBelowMinimumError,
  isRetryablePaystackRefundError,
  paystackRefundOutcomeStatus,
  paystackRefundTransaction,
  persistPaystackRefundOutcome,
} from "../_shared/paystackRefunds.ts";
import {
  runSourceRefundOperation,
  type SourceRefundOperation,
} from "../_shared/sourceRefundControlPlane.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// OQ-3 default buyer-facing cancellation refund reason (10–200 chars; final wording
// folds into K/#1180). Stored on refunds.reason; surfaced by the existing refund
// notification path. Kept CONSTANT so admin_refund_order's exact-request replay match
// holds across every re-drive.
const CANCELLATION_REFUND_REASON =
  "Your event was cancelled and you've been fully refunded.";

const CLAIM_BATCH = 25;

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RefundLine {
  order_line_item_id: string;
  quantity: number;
  amount_cents: number;
}

interface ProgressRow {
  id: string;
  event_id: string;
  source_type: string;
  source_id: string;
  provider: string;
  amount_cents: number;
  refund_id: string | null;
  status: string;
  attempt_count: number;
}

// deno-lint-ignore no-explicit-any
type Supa = any;

interface StripeRefundResult {
  id: string;
  status: string | null;
  amount: number;
}

/**
 * Build the FULL remaining-refund line manifest for an order — order_line_items
 * minus already-refunded quantity/amount from NON-failed refunds, EXCLUDING this
 * order's own cancellation refund (idempotency key `idemKey`). Excluding it is what
 * makes the recomputed manifest STABLE across re-drives, so admin_refund_order's
 * exact-request replay matches (no idempotency_request_mismatch, no double refund).
 */
async function buildRemainingManifest(
  supabase: Supa,
  orderId: string,
  idemKey: string,
): Promise<RefundLine[]> {
  const { data: items, error: itemsErr } = await supabase
    .from("order_line_items")
    .select("id, quantity, total_cents")
    .eq("order_id", orderId);
  if (itemsErr) {
    throw new Error(`line_items_lookup_failed: ${itemsErr.message}`);
  }
  if (!items || items.length === 0) return [];

  const { data: refunds, error: refundsErr } = await supabase
    .from("refunds")
    .select("id, status, metadata")
    .eq("order_id", orderId)
    .in("status", ["pending", "succeeded"]);
  if (refundsErr) {
    throw new Error(`refunds_lookup_failed: ${refundsErr.message}`);
  }

  // Exclude THIS cancellation refund; only "other" refunds reduce the remaining.
  const otherRefundIds = (refunds ?? [])
    .filter((r: Record<string, unknown>) =>
      ((r.metadata as Record<string, unknown> | null)?.idempotency_key ??
        "") !==
        idemKey
    )
    .map((r: Record<string, unknown>) => String(r.id));

  const doneByLine = new Map<string, { qty: number; amt: number }>();
  if (otherRefundIds.length > 0) {
    const { data: rlis, error: rliErr } = await supabase
      .from("refund_line_items")
      .select("order_line_item_id, quantity, amount_cents")
      .in("refund_id", otherRefundIds);
    if (rliErr) {
      throw new Error(`refund_lines_lookup_failed: ${rliErr.message}`);
    }
    for (const rli of rlis ?? []) {
      const key = String(rli.order_line_item_id);
      const acc = doneByLine.get(key) ?? { qty: 0, amt: 0 };
      acc.qty += Number(rli.quantity ?? 0);
      acc.amt += Number(rli.amount_cents ?? 0);
      doneByLine.set(key, acc);
    }
  }

  const lines: RefundLine[] = [];
  for (const item of items) {
    const done = doneByLine.get(String(item.id)) ?? { qty: 0, amt: 0 };
    const remQty = Number(item.quantity ?? 0) - done.qty;
    const remAmt = Number(item.total_cents ?? 0) - done.amt;
    if (remQty > 0 && remAmt > 0) {
      lines.push({
        order_line_item_id: String(item.id),
        quantity: remQty,
        amount_cents: remAmt,
      });
    }
  }
  return lines;
}

type RefundOutcome =
  | { result: "refunded"; refundId: string | null }
  | { result: "failed_retryable"; error: string; refundId: string | null }
  | { result: "failed"; error: string; refundId: string | null };

/**
 * Refund a single order for a cancelled event. Mirrors admin-refund-order's flow:
 * pending row (service-role twin) → provider refund → commit twin. Returns an
 * outcome; NEVER throws (partial failure is first-class).
 */
async function refundOneOrder(
  supabase: Supa,
  eventId: string,
  row: ProgressRow,
): Promise<RefundOutcome> {
  const orderId = row.source_id;
  const idemKey = `cancel_refund:${eventId}:${orderId}`;

  let lines: RefundLine[];
  try {
    lines = await buildRemainingManifest(supabase, orderId, idemKey);
  } catch (err) {
    return {
      result: "failed_retryable",
      error: err instanceof Error ? err.message : String(err),
      refundId: row.refund_id,
    };
  }
  // Nothing left to refund (already fully refunded elsewhere) — idempotent success.
  if (lines.length === 0) {
    return { result: "refunded", refundId: row.refund_id };
  }

  // ── Step 1: pending refund row (service_role twin). ──────────────────────────
  const { data: pendingResult, error: pendingError } = await supabase.rpc(
    "admin_refund_order",
    {
      p_order_id: orderId,
      p_lines: lines,
      p_reason: CANCELLATION_REFUND_REASON,
      p_idempotency_key: idemKey,
    },
  );
  if (pendingError || !pendingResult) {
    const msg = (pendingError?.message ?? "admin_refund_order_failed")
      .toLowerCase();
    // Order already fully refunded by someone else → buyer has their money.
    if (
      msg.includes("order_not_refundable") || msg.includes("refund_amount_zero")
    ) {
      return { result: "refunded", refundId: row.refund_id };
    }
    return {
      result: "failed",
      error: pendingError?.message ?? "admin_refund_order_failed",
      refundId: row.refund_id,
    };
  }

  const pending = pendingResult as Record<string, unknown>;
  const refundId = String(pending.refund_id ?? "");
  const amountCents = Number(pending.amount_cents ?? 0);
  const paymentIntentId = typeof pending.stripe_payment_intent_id === "string"
    ? pending.stripe_payment_intent_id
    : null;
  const chargeId = typeof pending.stripe_charge_id === "string"
    ? pending.stripe_charge_id
    : null;
  const applicationFeeAmountCents = Number(
    pending.application_fee_amount_cents ?? 0,
  );
  const isFullRefund = pending.is_full_refund === true;
  const isIdempotentReplay = pending.idempotent_replay === true;

  if (isIdempotentReplay) {
    // Pending row already existed. If already committed succeeded, do not re-charge.
    const { data: existing } = await supabase
      .from("refunds")
      .select("id, status")
      .eq("id", refundId)
      .maybeSingle();
    if (existing?.status === "succeeded") {
      return { result: "refunded", refundId };
    }
    // pending / failed → fall through and (re)try the provider call (idempotency-keyed).
  }

  if (!paymentIntentId) {
    // No provider reference at all — definitively unrefundable via this path.
    await supabase.rpc("admin_refund_order_commit", {
      p_refund_id: refundId,
      p_stripe_refund_id: null,
      p_application_fee_refunded_cents: 0,
      p_status: "failed",
    });
    return {
      result: "failed",
      error: "missing_payment_intent",
      refundId,
    };
  }

  // ── Step 2: resolve provider + connected account (orders → events → brands). ─
  const { data: brandRow, error: brandErr } = await supabase
    .from("orders")
    .select(
      "event_id, events(brand_id, brands(stripe_connect_id, payment_provider))",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (brandErr || !brandRow) {
    return {
      result: "failed_retryable",
      error: `connected_account_lookup_failed: ${
        brandErr?.message ?? "no row"
      }`,
      refundId,
    };
  }
  type JoinedBrand = {
    stripe_connect_id?: string | null;
    payment_provider?: string | null;
  };
  type JoinedEvents = { brands?: JoinedBrand | JoinedBrand[] | null };
  const eventsJoined = (brandRow as Record<string, unknown>).events as
    | JoinedEvents
    | JoinedEvents[]
    | null;
  const eventsRow = Array.isArray(eventsJoined)
    ? eventsJoined[0] ?? null
    : eventsJoined;
  const brandsJoined = eventsRow?.brands ?? null;
  const brandsRow = Array.isArray(brandsJoined)
    ? brandsJoined[0] ?? null
    : brandsJoined;
  const connectedAccountId = typeof brandsRow?.stripe_connect_id === "string" &&
      brandsRow.stripe_connect_id.length > 0
    ? brandsRow.stripe_connect_id
    : null;
  const paymentProvider = brandsRow?.payment_provider === "paystack"
    ? "paystack"
    : "stripe";
  if (paymentProvider === "stripe" && !connectedAccountId) {
    return {
      result: "failed",
      error: "missing_connected_account",
      refundId,
    };
  }

  // ── Step 3: provider refund (cancellation-scoped idempotency keys). ──────────
  let providerRefund: StripeRefundResult;
  if (paymentProvider === "paystack") {
    const transaction = paystackRefundTransaction(paymentIntentId, chargeId);
    if (!transaction) {
      await supabase.rpc("admin_refund_order_commit", {
        p_refund_id: refundId,
        p_stripe_refund_id: null,
        p_application_fee_refunded_cents: 0,
        p_status: "failed",
      });
      return {
        result: "failed",
        error: "missing_paystack_transaction",
        refundId,
      };
    }
    try {
      const paystackRefund = await createPaystackRefund({
        transaction,
        merchantNote: `mingla_cancel_refund:${refundId}`,
        amountSubunits: isFullRefund ? undefined : amountCents,
        currency: "NGN",
      });
      providerRefund = {
        id: paystackRefund.id,
        status: paystackRefund.status,
        amount: paystackRefund.amount || amountCents,
      };
      // record_paystack_refund_outcome ALSO supersedes any Paystack temp postponement
      // debt (post_release_refund) exactly once — this is why prepare EXCLUDES
      // Paystack from its Stripe-only cancellation-debt conversion.
      await persistPaystackRefundOutcome(
        () =>
          supabase.rpc("record_paystack_refund_outcome", {
            p_source_type: "order",
            p_source_id: orderId,
            p_local_refund_id: refundId,
            p_transaction_reference: transaction,
            p_merchant_note: `mingla_cancel_refund:${refundId}`,
            p_provider_refund_id: paystackRefund.id,
            p_amount_cents: amountCents,
            p_status: paystackRefundOutcomeStatus(paystackRefund.status),
          }),
        "event-cancel-refund-fanout",
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const retryable = isRetryablePaystackRefundError(err);
      const belowMinimum = isPaystackRefundBelowMinimumError(err);
      if (!retryable) {
        await supabase.rpc("admin_refund_order_commit", {
          p_refund_id: refundId,
          p_stripe_refund_id: null,
          p_application_fee_refunded_cents: 0,
          p_status: "failed",
        });
        return {
          result: "failed",
          error: belowMinimum
            ? `paystack_refund_below_minimum: ${detail}`
            : `paystack_refund_failed: ${detail}`,
          refundId,
        };
      }
      // Retryable: leave the pending refund row for the cron re-drive.
      return {
        result: "failed_retryable",
        error: `paystack_refund_retryable: ${detail}`,
        refundId,
      };
    }
  } else {
    try {
      const stripe = stripeTicketRefund();
      // @ts-ignore — Stripe SDK namespace is runtime-provided in Deno.
      const created = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: amountCents,
          reason: "requested_by_customer",
          refund_application_fee: applicationFeeAmountCents > 0,
          metadata: {
            mingla_refund_id: refundId,
            mingla_order_id: orderId,
            mingla_event_id: eventId,
            mingla_cancel_refund: "true",
          },
        },
        {
          // Stripe dedupes on this key across re-drives → no second refund.
          idempotencyKey: `cancel_refund:${refundId}`,
          stripeAccount: connectedAccountId,
        },
      );
      providerRefund = {
        id: String(created.id),
        status: created.status ?? null,
        amount: Number(created.amount ?? amountCents),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Cancellation MUST eventually refund — treat unclassified Stripe throws as
      // retryable (leave the pending row; the same idempotency key makes the retry
      // a no-op if Stripe actually succeeded). The attempt cap in the claim RPC
      // stops runaway retries and surfaces the object to ops via the run counters.
      return {
        result: "failed_retryable",
        error: `stripe_refund_retryable: ${detail}`,
        refundId,
      };
    }
  }

  if (
    providerRefund.status === "failed" || providerRefund.status === "canceled"
  ) {
    await supabase.rpc("admin_refund_order_commit", {
      p_refund_id: refundId,
      p_stripe_refund_id: providerRefund.id,
      p_application_fee_refunded_cents: 0,
      p_status: "failed",
    });
    return {
      result: "failed",
      error: `provider_refund_status=${providerRefund.status}`,
      refundId,
    };
  }

  // ── Step 4: tax reversal (Stripe only; mirror admin-refund-order verbatim). ──
  let reversalTaxTransactionId: string | null = null;
  if (paymentProvider === "stripe") {
    const { data: orderTaxRow, error: orderTaxError } = await supabase
      .from("orders")
      .select("stripe_tax_transaction_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderTaxError) {
      return {
        result: "failed_retryable",
        error: `tax_lookup_failed: ${orderTaxError.message}`,
        refundId,
      };
    }
    const originalTaxTransactionId =
      typeof orderTaxRow?.stripe_tax_transaction_id === "string" &&
        orderTaxRow.stripe_tax_transaction_id.length > 0
        ? orderTaxRow.stripe_tax_transaction_id
        : null;
    if (originalTaxTransactionId !== null) {
      try {
        const stripeForTax = stripeTicketRefund();
        // @ts-ignore — Stripe SDK Tax namespace is runtime-provided in Deno.
        const reversal = await stripeForTax.tax.transactions.createReversal(
          {
            mode: isFullRefund ? "full" : "partial",
            original_transaction: originalTaxTransactionId,
            reference: `mingla_cancel_refund:${refundId}`,
            expand: ["line_items"],
            ...(isFullRefund ? {} : {
              line_items: lines.map((line) => ({
                amount: -line.amount_cents,
                reference: `line:${line.order_line_item_id}`,
              })),
            }),
          },
          {
            stripeAccount: connectedAccountId,
            idempotencyKey: `cancel_tax_reversal:${refundId}`,
          },
        );
        reversalTaxTransactionId = String(reversal.id);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // Stripe refund already succeeded; leave the pending row and let the cron
        // re-drive complete the tax reversal + commit (idempotency-keyed no-op).
        return {
          result: "failed_retryable",
          error: `stripe_tax_reversal_retryable: ${detail}`,
          refundId,
        };
      }
    }
  }

  // ── Step 5: commit the refund (service_role twin). ──────────────────────────
  const { data: commitResult, error: commitError } = await supabase.rpc(
    "admin_refund_order_commit",
    {
      p_refund_id: refundId,
      p_stripe_refund_id: providerRefund.id,
      p_application_fee_refunded_cents: 0,
      p_status: "succeeded",
      p_stripe_tax_transaction_id: reversalTaxTransactionId,
    },
  );
  if (commitError || !commitResult) {
    // Provider refund succeeded but our commit failed — the webhook reconciles and
    // the cron re-drive retries the commit. Never silently lost.
    return {
      result: "failed_retryable",
      error: `commit_failed_after_provider_success: ${
        commitError?.message ?? "no result"
      }`,
      refundId,
    };
  }

  return { result: "refunded", refundId };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  if (!eventId || !UUID_RE.test(eventId)) {
    return json({ error: "event_id_required" }, 400);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "service_misconfigured" }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Prepare (status-first guard + stop releases + atomic Stripe debt
  //       conversion + enumerate). A non-cancelled event is a 409 no-op. ────────
  const { data: prep, error: prepError } = await supabase.rpc(
    "cancel_event_refund_prepare",
    { p_event_id: eventId },
  );
  if (prepError) {
    const msg = (prepError.message ?? "").toLowerCase();
    if (msg.includes("event_not_cancelled")) {
      return json({ error: "event_not_cancelled" }, 409);
    }
    if (msg.includes("event_not_found")) {
      return json({ error: "event_not_found" }, 404);
    }
    console.error(
      "[event-cancel-refund-fanout] prepare failed",
      prepError.message,
    );
    return json({ error: "prepare_failed", detail: prepError.message }, 500);
  }

  // RSVP contributions have no order. Prepare their typed source refunds after
  // the same cancelled-event precondition, then let the shared sweep remain the
  // correctness backstop if this best-effort kickoff cannot reach a provider.
  const { data: rsvpOperations, error: rsvpPrepareError } = await supabase.rpc(
    "prepare_event_cancel_rsvp_source_refunds",
    { p_event_id: eventId },
  );
  if (rsvpPrepareError) {
    console.error("event_cancel_rsvp_refund_prepare_failed", {
      event_id: eventId,
      error_code: "rsvp_prepare_failed",
    });
    return json({ error: "rsvp_prepare_failed" }, 500);
  }
  let rsvpRefundsPrepared = 0;
  for (const operation of (rsvpOperations ?? []) as SourceRefundOperation[]) {
    rsvpRefundsPrepared++;
    try {
      await runSourceRefundOperation(supabase, operation);
    } catch (caught) {
      console.warn("event_cancel_rsvp_refund_deferred", {
        refund_id: operation.id,
        error_code: caught instanceof Error
          ? caught.message.split(":")[0]
          : "runner_failed",
      });
    }
  }

  // ── 2. Drain: claim a batch, refund each object in its own try/catch, mark. ──
  let refunded = 0;
  let failedRetryable = 0;
  let failed = 0;
  // Bound total iterations defensively (each object is claimed at most once per
  // invocation because a fresh lease excludes it from re-claim; the cap is a
  // belt-and-suspenders stop for pathological states).
  for (let iteration = 0; iteration < 10_000; iteration++) {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "cancel_event_refund_claim",
      { p_event_id: eventId, p_limit: CLAIM_BATCH },
    );
    if (claimError) {
      console.error(
        "[event-cancel-refund-fanout] claim failed",
        claimError.message,
      );
      return json({ error: "claim_failed", detail: claimError.message }, 500);
    }
    const rows = (claimed ?? []) as ProgressRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const outcome = await refundOneOrder(supabase, eventId, row);
      const markStatus = outcome.result;
      const { error: markError } = await supabase.rpc(
        "cancel_event_refund_mark",
        {
          p_progress_id: row.id,
          p_status: markStatus,
          p_refund_id: outcome.refundId,
          p_error: outcome.result === "refunded" ? null : outcome.error,
        },
      );
      if (markError) {
        console.error(
          "[event-cancel-refund-fanout] mark failed",
          row.id,
          markError.message,
        );
      }
      if (outcome.result === "refunded") refunded++;
      else if (outcome.result === "failed_retryable") failedRetryable++;
      else failed++;
    }
  }

  const { data: runRow } = await supabase
    .from("event_cancel_refund_runs")
    .select("status, total_objects, refunded_objects, failed_objects")
    .eq("event_id", eventId)
    .maybeSingle();

  return json({
    event_id: eventId,
    run_status: runRow?.status ??
      (prep as Record<string, unknown>)?.run_status ??
      "unknown",
    total_objects: runRow?.total_objects ?? 0,
    refunded,
    rsvp_refunds_prepared: rsvpRefundsPrepared,
    failed_retryable: failedRetryable,
    failed,
  });
});
