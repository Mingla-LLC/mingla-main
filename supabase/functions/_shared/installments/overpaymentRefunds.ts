/**
 * issue #4522 (rework N2, third rework T3-1 / T3-2 / T3-6 / T3-7) — money a
 * trip order collected beyond what it owed goes back to the traveler
 * automatically, against the charge that carried it, exactly once.
 *
 * The database owns the state (issue_4522_begin_overpayment_refund plans the
 * next step, issue_4522_finish_overpayment_refund records each provider
 * answer; one row of order_overpayment_refund_attempts per provider refund,
 * and a hard guard keeps creating + pending + succeeded refunds of one
 * overpayment within its amount). This module only talks to the provider:
 *   Stripe   — a partial refund of the PaymentIntent on the brand's connected
 *              account (refund_application_fee, as every Mingla ticket
 *              refund), with the attempt's idempotency key and
 *              metadata.mingla_overpayment_id / mingla_overpayment_attempt;
 *   Paystack — a partial refund of the transaction (createPaystackRefund,
 *              merchant note = the attempt's key, so a re-send finds the same
 *              refund by reading the transaction's refund list).
 * An attempt the provider accepted is never re-created: its refund id is
 * stored the moment create returns (any status) and every later pass
 * retrieves THAT refund and moves on its real status
 *   succeeded → returned; failed / canceled → the next attempt may be made
 *   (new key) once every earlier refund was re-read at the provider;
 *   pending / requires_action → kept, ops alerted once past
 *   OVERPAYMENT_PENDING_CEILING_MS.
 * An attempt whose answer never arrived (timeout, lost write) is checked by
 * re-sending its own key inside the provider's key window, else by reading
 * the provider's refund list for its metadata; never by a new refund.
 * Three refusals in a row stop the lane (needs_ops) with one ops alert that
 * says exactly what is safe to do; a refund made in the provider dashboard
 * is matched back by the refund webhooks (issue_4522_overpayment_refund_event).
 * Callers: the success webhooks right after a settle that held money, the
 * cancel path, and the scheduled sweep (process-scheduled-installments).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createPaystackRefund,
  getPaystackRefund,
  isRetryablePaystackRefundError,
  PAYSTACK_MIN_REFUND_SUBUNITS,
  paystackRefundOutcomeStatus,
  paystackRefundTransaction,
} from "../paystackRefunds.ts";

/** Mirror of issue_4522_overpayment_pending_ceiling(). */
export const OVERPAYMENT_PENDING_CEILING_MS = 7 * 24 * 60 * 60 * 1000;
/** Mirror of issue_4522_overpayment_failure_limit(). */
export const OVERPAYMENT_FAILURE_LIMIT = 3;
/** Mirror of issue_4522_overpayment_min_refund_minor('paystack') (T3-7). */
export const OVERPAYMENT_PAYSTACK_MIN_REFUND_MINOR = PAYSTACK_MIN_REFUND_SUBUNITS;
/** Mirror of issue_4522_overpayment_max_refund_part() (T3-6: refunds.amount_cents is 32-bit). */
export const OVERPAYMENT_MAX_REFUND_PART_MINOR = 2_147_483_647;

interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

export interface StripeRefundLike {
  id?: string;
  status?: string | null;
  amount?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface OverpaymentStripe {
  refunds: {
    create(
      params: Record<string, unknown>,
      options: { idempotencyKey: string; stripeAccount: string },
    ): Promise<StripeRefundLike>;
    retrieve(
      id: string,
      params: Record<string, unknown>,
      options: { stripeAccount: string },
    ): Promise<StripeRefundLike>;
    list(
      params: Record<string, unknown>,
      options: { stripeAccount: string },
    ): Promise<{ data?: StripeRefundLike[] | null }>;
  };
}

export interface OverpaymentRefundDeps {
  supabase: RpcClient;
  stripe: () => OverpaymentStripe;
  stripeAccountForBrand: (brandId: string) => Promise<string | null>;
  createPaystackRefund: typeof createPaystackRefund;
  getPaystackRefund?: typeof getPaystackRefund;
  alertOps: (subject: string, paragraphs: string[]) => Promise<void>;
  now?: () => number;
}

export type OverpaymentOutcome =
  | "succeeded"
  | "pending"
  | "unknown"
  | "failed"
  | "done"
  | "skipped"
  | "needs_ops";

/** One provider answer, as the database records it. */
export type AttemptAnswer = "succeeded" | "pending" | "unknown" | "failed" | "not_found";

interface AttemptRow {
  attemptNo: number;
  origin?: string;
  state: string;
  amountMinor: number;
  providerRefundId: string | null;
  idempotencyKey: string | null;
  withinKeyWindow?: boolean;
}

interface Plan {
  ok?: boolean;
  done?: boolean;
  reason?: string;
  needsOpsReason?: string;
  action?: "verify" | "verify_prior" | "create";
  overpaymentId?: string;
  orderId?: string;
  installmentId?: string;
  brandId?: string;
  provider?: string;
  providerRef?: string;
  refundMinor?: number;
  remainingMinor?: number;
  currency?: string;
  refundId?: string;
  attemptNo?: number;
  amountMinor?: number;
  idempotencyKey?: string;
  attempts?: AttemptRow[];
  alertOps?: boolean;
  alertKind?: string;
  minRefundMinor?: number;
}

interface Recorded {
  ok?: boolean;
  state?: string;
  alertOps?: boolean;
  alertKind?: string | null;
  remainingMinor?: number;
  reason?: string;
}

/** Stripe answered for good (a 4xx refusal other than a conflict or rate limit). */
export function isDefinitiveStripeRefusal(error: unknown): boolean {
  const e = error as { statusCode?: unknown; type?: unknown } | null;
  const status = typeof e?.statusCode === "number" ? e.statusCode : null;
  if (status === null) return false;
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

/** A Stripe Refund status as the attempt records it. */
export function stripeRefundAnswer(status: string | null | undefined): "succeeded" | "pending" | "failed" {
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "canceled") return "failed";
  // pending, requires_action and anything new stay open (never re-created).
  return "pending";
}

/** A Paystack refund status as the attempt records it. */
export function paystackRefundAnswer(status: string | null | undefined): "succeeded" | "pending" | "failed" {
  const s = paystackRefundOutcomeStatus(status ?? null);
  return s === "processed" ? "succeeded" : s === "failed" ? "failed" : "pending";
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message.slice(0, 280) : fallback;
}

function money(plan: { remainingMinor?: number; currency?: string }, minor?: number): string {
  return `${String(minor ?? plan.remainingMinor ?? "?")} (${plan.currency ?? "?"} minor units)`;
}

/** The ops alert for a stopped or slow overpayment refund (ops-internal copy). */
export function overpaymentAlert(
  kind: string,
  plan: Plan,
  lastError: string | null,
): { subject: string; paragraphs: string[] } | null {
  const where = [
    `Order: ${plan.orderId ?? "?"}`,
    `Overpayment: ${plan.overpaymentId ?? "?"}`,
    `Charge (${plan.provider ?? "?"}): ${plan.providerRef ?? "?"}`,
    `Still owed back to the traveler: ${money(plan)}`,
  ];
  const howToRecord =
    "If you return it any other way, record it with issue_4522_resolve_overpayment_by_ops(<overpayment>, 'refunded_by_hand', <your user id>, <refund reference>).";
  switch (kind) {
    case "refund_failed_repeatedly":
      return {
        subject: "Trip overpayment refund stopped after 3 refusals",
        paragraphs: [
          "The provider refused Mingla's automatic refund of a traveler's overpayment three times in a row. Automatic retries have STOPPED: Mingla will not send this refund again on its own.",
          ...where,
          `Last error: ${lastError ?? "unknown"}`,
          `Safe to do: refund exactly ${money(plan)} on the charge above in the provider dashboard. Mingla matches that refund to this overpayment automatically and closes it. Do not refund more than that amount for this overpayment.`,
          "Or, once the cause is fixed, restart automatic refunding with issue_4522_resolve_overpayment_by_ops(<overpayment>, 'retry', <your user id>).",
          howToRecord,
          "The host's payout for this charge stays held until it is resolved.",
        ],
      };
    case "below_provider_minimum":
      return {
        subject: "Trip overpayment below the provider's minimum refund",
        paragraphs: [
          `A traveler's overpayment of ${money(plan)} is below the smallest partial refund the provider accepts (${String(plan.minRefundMinor ?? "?")}), so Mingla cannot refund it automatically. Nothing will be retried.`,
          ...where,
          "Safe to do: return it to the traveler another way, or refund it in the provider dashboard if the provider allows it there (Mingla matches a dashboard refund on this charge automatically).",
          howToRecord,
          "The host's payout for this charge stays held until it is resolved.",
        ],
      };
    case "refund_pending_too_long":
      return {
        subject: "Trip overpayment refund still pending at the provider",
        paragraphs: [
          "A refund of a traveler's overpayment has been pending at the provider for more than 7 days. Mingla keeps checking it and will not send another refund while it is pending.",
          ...where,
          "Do NOT refund it by hand: it may still complete, and the traveler would be refunded twice. Check its status in the provider dashboard; if the provider marks it failed, Mingla retries automatically.",
          "The host's payout for this charge stays held until it completes.",
        ],
      };
    case "provider_reversed_refund":
      return {
        subject: "Trip overpayment refund reversed by the provider",
        paragraphs: [
          "The provider reversed a refund of a traveler's overpayment after it had completed (the money is back on the charge). Automatic refunding has STOPPED.",
          ...where,
          `Safe to do: refund exactly ${money(plan)} on the charge above in the provider dashboard (Mingla matches it automatically), or restart automatic refunding with issue_4522_resolve_overpayment_by_ops(<overpayment>, 'retry', <your user id>).`,
          howToRecord,
        ],
      };
    default:
      return null;
  }
}

async function alertFor(
  deps: OverpaymentRefundDeps,
  plan: Plan,
  recorded: { alertOps?: boolean; alertKind?: string | null; remainingMinor?: number },
  lastError: string | null,
): Promise<void> {
  if (recorded.alertOps !== true || !recorded.alertKind) return;
  const alert = overpaymentAlert(recorded.alertKind, {
    ...plan,
    remainingMinor: recorded.remainingMinor ?? plan.remainingMinor,
  }, lastError);
  if (alert !== null) await deps.alertOps(alert.subject, alert.paragraphs);
}

async function record(
  deps: OverpaymentRefundDeps,
  plan: Plan,
  attemptNo: number,
  answer: AttemptAnswer,
  providerRefundId: string | null,
  error: string | null,
): Promise<Recorded> {
  const { data, error: rpcError } = await deps.supabase.rpc("issue_4522_finish_overpayment_refund", {
    p_overpayment_id: plan.overpaymentId,
    p_attempt_no: attemptNo,
    p_outcome: answer,
    p_provider_refund_id: providerRefundId,
    p_error: error,
  });
  if (rpcError !== null) throw new Error(`overpayment_finish_failed:${rpcError.message ?? "unknown"}`);
  const recorded = (data ?? {}) as Recorded;
  await alertFor(deps, plan, recorded, error);
  return recorded;
}

interface ProviderAnswer {
  answer: AttemptAnswer;
  providerRefundId: string | null;
  error: string | null;
}

async function stripeAccount(deps: OverpaymentRefundDeps, plan: Plan): Promise<string | null> {
  return await deps.stripeAccountForBrand(String(plan.brandId ?? ""));
}

function stripeCreateParams(plan: Plan, attemptNo: number, amount: number, refundId: string | null) {
  return {
    payment_intent: String(plan.providerRef),
    amount,
    reason: "requested_by_customer",
    refund_application_fee: true,
    metadata: {
      mingla_overpayment_id: String(plan.overpaymentId),
      mingla_overpayment_attempt: String(attemptNo),
      mingla_order_id: String(plan.orderId ?? ""),
      mingla_refund_id: String(refundId ?? ""),
      mingla_installment_id: String(plan.installmentId ?? ""),
    },
  };
}

/** Send (or re-send with the SAME key) one Stripe attempt. */
async function stripeSend(
  deps: OverpaymentRefundDeps,
  plan: Plan,
  attempt: { attemptNo: number; amountMinor: number; idempotencyKey: string; refundId: string | null },
): Promise<ProviderAnswer> {
  const account = await stripeAccount(deps, plan);
  if (account === null) return { answer: "unknown", providerRefundId: null, error: "no_connected_account" };
  try {
    const refund = await deps.stripe().refunds.create(
      stripeCreateParams(plan, attempt.attemptNo, attempt.amountMinor, attempt.refundId),
      { idempotencyKey: attempt.idempotencyKey, stripeAccount: account },
    );
    const id = typeof refund.id === "string" && refund.id !== "" ? refund.id : null;
    const answer = stripeRefundAnswer(refund.status);
    // A pending answer without an id cannot be followed: keep it creating.
    return { answer: answer === "pending" && id === null ? "unknown" : answer, providerRefundId: id, error: null };
  } catch (err) {
    return {
      answer: isDefinitiveStripeRefusal(err) ? "failed" : "unknown",
      providerRefundId: null,
      error: errorText(err, "stripe_refund_error"),
    };
  }
}

/** Read one Stripe refund by its id. */
async function stripeRead(deps: OverpaymentRefundDeps, plan: Plan, refundId: string): Promise<ProviderAnswer> {
  const account = await stripeAccount(deps, plan);
  if (account === null) return { answer: "unknown", providerRefundId: refundId, error: "no_connected_account" };
  try {
    const stripe = deps.stripe();
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
    const refund = await stripe.refunds.retrieve(refundId, {}, { stripeAccount: account });
    return { answer: stripeRefundAnswer(refund.status), providerRefundId: refundId, error: null };
  } catch (err) {
    return { answer: "unknown", providerRefundId: refundId, error: errorText(err, "stripe_refund_retrieve_error") };
  }
}

/**
 * An attempt whose create answer never arrived, outside the key window: the
 * provider's refunds on the charge are read for this attempt's metadata.
 * Found → its real status; read but absent → it was never created.
 */
async function stripeFindByMetadata(
  deps: OverpaymentRefundDeps,
  plan: Plan,
  attemptNo: number,
): Promise<ProviderAnswer> {
  const account = await stripeAccount(deps, plan);
  if (account === null) return { answer: "unknown", providerRefundId: null, error: "no_connected_account" };
  try {
    const stripe = deps.stripe();
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only list (GET; no mutation to dedupe)
    const page = await stripe.refunds.list({ payment_intent: String(plan.providerRef), limit: 100 }, {
      stripeAccount: account,
    });
    const rows = Array.isArray(page.data) ? page.data : [];
    const match = rows.find((r) =>
      String(r.metadata?.mingla_overpayment_id ?? "") === String(plan.overpaymentId) &&
      String(r.metadata?.mingla_overpayment_attempt ?? "") === String(attemptNo)
    );
    if (match === undefined) {
      // 100 refunds on one charge cannot all be ours; a full page is ambiguous.
      if (rows.length >= 100) return { answer: "unknown", providerRefundId: null, error: "refund_list_full_page" };
      return { answer: "not_found", providerRefundId: null, error: "not_created_at_provider" };
    }
    return {
      answer: stripeRefundAnswer(match.status),
      providerRefundId: typeof match.id === "string" ? match.id : null,
      error: null,
    };
  } catch (err) {
    return { answer: "unknown", providerRefundId: null, error: errorText(err, "stripe_refund_list_error") };
  }
}

/** Send (or re-send: the merchant note finds the same refund) one Paystack attempt. */
async function paystackSend(
  deps: OverpaymentRefundDeps,
  plan: Plan,
  attempt: { amountMinor: number; idempotencyKey: string },
): Promise<ProviderAnswer> {
  const transaction = paystackRefundTransaction(String(plan.providerRef ?? ""), null);
  if (transaction === null) return { answer: "failed", providerRefundId: null, error: "no_transaction" };
  try {
    const refund = await deps.createPaystackRefund({
      transaction,
      merchantNote: attempt.idempotencyKey,
      amountSubunits: attempt.amountMinor,
      currency: String(plan.currency ?? "NGN").toUpperCase(),
    });
    const id = typeof refund.id === "string" && refund.id !== "" ? refund.id : null;
    const answer = paystackRefundAnswer(refund.status ?? null);
    return { answer: answer === "pending" && id === null ? "unknown" : answer, providerRefundId: id, error: null };
  } catch (err) {
    return {
      answer: isRetryablePaystackRefundError(err) ? "unknown" : "failed",
      providerRefundId: null,
      error: errorText(err, "paystack_refund_error"),
    };
  }
}

async function paystackRead(deps: OverpaymentRefundDeps, refundId: string): Promise<ProviderAnswer> {
  const read = deps.getPaystackRefund ?? getPaystackRefund;
  try {
    const refund = await read(refundId);
    return { answer: paystackRefundAnswer(refund.status), providerRefundId: refundId, error: null };
  } catch (err) {
    return { answer: "unknown", providerRefundId: refundId, error: errorText(err, "paystack_refund_lookup_error") };
  }
}

/** What the provider says about one attempt that is creating or pending. */
async function checkOpenAttempt(deps: OverpaymentRefundDeps, plan: Plan, a: AttemptRow): Promise<ProviderAnswer> {
  if (a.providerRefundId !== null && a.providerRefundId !== "") {
    return plan.provider === "stripe"
      ? await stripeRead(deps, plan, a.providerRefundId)
      : await paystackRead(deps, a.providerRefundId);
  }
  // Never answered (creating). Only Mingla's own attempts can be here.
  if (a.idempotencyKey === null || a.idempotencyKey === "") {
    return { answer: "unknown", providerRefundId: null, error: "attempt_without_key" };
  }
  if (plan.provider === "stripe") {
    return a.withinKeyWindow === true
      ? await stripeSend(deps, plan, {
        attemptNo: a.attemptNo,
        amountMinor: a.amountMinor,
        idempotencyKey: a.idempotencyKey,
        refundId: null,
      })
      : await stripeFindByMetadata(deps, plan, a.attemptNo);
  }
  return await paystackSend(deps, plan, { amountMinor: a.amountMinor, idempotencyKey: a.idempotencyKey });
}

async function plan(deps: OverpaymentRefundDeps, overpaymentId: string, verifiedThrough: number | null): Promise<Plan> {
  const { data, error } = await deps.supabase.rpc("issue_4522_begin_overpayment_refund", {
    p_overpayment_id: overpaymentId,
    p_verified_through: verifiedThrough,
  });
  if (error !== null) throw new Error(`overpayment_begin_failed:${error.message ?? "unknown"}`);
  return (data ?? {}) as Plan;
}

/** Return one overpayment (plan → provider → record). Never throws on a provider error. */
export async function returnOverpayment(
  deps: OverpaymentRefundDeps,
  overpaymentId: string,
): Promise<OverpaymentOutcome> {
  let verifiedThrough: number | null = null;
  let last: OverpaymentOutcome | null = null;
  // At most: verify open attempts, re-read earlier refunds, create parts.
  for (let step = 0; step < 6; step += 1) {
    const p = await plan(deps, overpaymentId, verifiedThrough);
    if (p.ok === true && p.done === true) return last === "succeeded" ? "succeeded" : "done";
    if (p.reason === "needs_ops") {
      await alertFor(deps, p, p, null);
      return "needs_ops";
    }
    if (p.ok !== true) return last ?? "skipped";

    if (p.action === "verify") {
      // pending past the ceiling: ops is told once; the refund stays.
      await alertFor(deps, p, p, null);
      let open: OverpaymentOutcome | null = null;
      for (const a of p.attempts ?? []) {
        const answer = await checkOpenAttempt(deps, p, a);
        await record(deps, p, a.attemptNo, answer.answer, answer.providerRefundId, answer.error);
        if (answer.answer === "succeeded") last = "succeeded";
        else if (answer.answer === "failed" || answer.answer === "not_found") last = "failed";
        if (answer.answer === "unknown") open = "unknown";
        else if (answer.answer === "pending" && open === null) open = "pending";
      }
      if (open !== null) return open;
      // Every open attempt is settled: plan again (done, a next part, a
      // retry later, or stopped for ops).
      continue;
    }

    if (p.action === "verify_prior") {
      // T3-1: every earlier provider refund is re-read before a new one.
      let revived = false;
      let highest: number = verifiedThrough ?? 0;
      for (const a of p.attempts ?? []) {
        if (a.providerRefundId === null) continue;
        const answer = p.provider === "stripe"
          ? await stripeRead(deps, p, a.providerRefundId)
          : await paystackRead(deps, a.providerRefundId);
        if (answer.answer === "unknown") return "unknown"; // cannot prove it is dead: create nothing
        if (answer.answer !== "failed") {
          await record(deps, p, a.attemptNo, answer.answer, a.providerRefundId, answer.error);
          revived = true;
        }
        highest = Math.max(highest, a.attemptNo);
      }
      if (revived) return "pending";
      verifiedThrough = highest;
      continue;
    }

    if (p.action === "create") {
      const attemptNo = Number(p.attemptNo);
      const amount = Number(p.amountMinor);
      const key = String(p.idempotencyKey ?? "");
      if (!Number.isSafeInteger(amount) || amount <= 0 || key === "" || !p.providerRef) {
        await record(deps, p, attemptNo, "failed", null, "overpayment_attempt_invalid");
        return "failed";
      }
      let answer: ProviderAnswer;
      if (p.provider === "stripe") {
        answer = await stripeSend(deps, p, {
          attemptNo,
          amountMinor: amount,
          idempotencyKey: key,
          refundId: p.refundId ?? null,
        });
      } else if (p.provider === "paystack") {
        answer = await paystackSend(deps, p, { amountMinor: amount, idempotencyKey: key });
      } else {
        answer = { answer: "failed", providerRefundId: null, error: "unknown_provider" };
      }
      const recorded = await record(deps, p, attemptNo, answer.answer, answer.providerRefundId, answer.error);
      if (recorded.state === "refunded") return "succeeded";
      if (recorded.state === "needs_ops") return "needs_ops";
      if (answer.answer === "succeeded" && recorded.state === "held") { // next part (T3-6)
        last = "succeeded";
        continue;
      }
      return answer.answer === "not_found" ? "failed" : answer.answer;
    }
    return last ?? "skipped";
  }
  return last ?? "pending";
}

/** Return every overpayment the database says is due (one order, or all). */
export async function returnDueOverpayments(
  deps: OverpaymentRefundDeps,
  orderId: string | null,
  limit = 100,
): Promise<Record<OverpaymentOutcome, number>> {
  const counts: Record<OverpaymentOutcome, number> = {
    succeeded: 0,
    pending: 0,
    unknown: 0,
    failed: 0,
    done: 0,
    skipped: 0,
    needs_ops: 0,
  };
  const { data, error } = await deps.supabase.rpc("issue_4522_overpayments_due", {
    p_order_id: orderId,
    p_limit: limit,
  });
  if (error !== null) throw new Error(`overpayments_due_failed:${error.message ?? "unknown"}`);
  for (const row of Array.isArray(data) ? data : []) {
    const id = (row as { overpaymentId?: unknown } | null)?.overpaymentId;
    if (typeof id !== "string") continue;
    try {
      counts[await returnOverpayment(deps, id)] += 1;
    } catch (err) {
      console.error(JSON.stringify({
        event: "overpayment_return_failed",
        overpaymentId: id,
        reason: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      }));
      counts.unknown += 1;
    }
  }
  return counts;
}

/** The brand's connected Stripe account (null when none is attached). */
export async function stripeAccountForBrandFrom(
  supabase: SupabaseClient,
  brandId: string,
): Promise<string | null> {
  if (brandId === "") return null;
  const { data } = await supabase.from("stripe_connect_accounts").select("stripe_account_id")
    .eq("brand_id", brandId).is("detached_at", null).maybeSingle();
  const id = (data as { stripe_account_id?: unknown } | null)?.stripe_account_id;
  return typeof id === "string" ? id : null;
}

// ---------------------------------------------------------------------------
// Refund webhooks (T3-1 / T3-2): resolve overpayment refunds by stored refund
// id, then by Mingla's own metadata, then (a refund NOT made by Mingla, e.g.
// in the provider dashboard) by the charge; never an orphan.
// ---------------------------------------------------------------------------

export interface OverpaymentRefundEvent {
  provider: "stripe" | "paystack";
  providerRefundId: string | null;
  paymentRef: string | null;
  amountMinor: number | null;
  status: "succeeded" | "pending" | "failed";
  overpaymentId: string | null;
  attemptNo: number | null;
  minglaCreated: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Stripe Refund object (refund.* / charge.refund.updated) as an overpayment event. */
export function stripeOverpaymentRefundEvent(refund: Record<string, unknown>): OverpaymentRefundEvent {
  const metadata = (refund.metadata ?? {}) as Record<string, unknown>;
  const op = typeof metadata.mingla_overpayment_id === "string" && UUID_RE.test(metadata.mingla_overpayment_id)
    ? metadata.mingla_overpayment_id
    : null;
  const attempt = Number(metadata.mingla_overpayment_attempt);
  const amount = Number(refund.amount);
  return {
    provider: "stripe",
    providerRefundId: typeof refund.id === "string" ? refund.id : null,
    paymentRef: typeof refund.payment_intent === "string" ? refund.payment_intent : null,
    amountMinor: Number.isSafeInteger(amount) ? amount : null,
    status: stripeRefundAnswer(typeof refund.status === "string" ? refund.status : null),
    overpaymentId: op,
    attemptNo: op !== null && Number.isSafeInteger(attempt) && attempt > 0 ? attempt : null,
    // Any Mingla marker means Mingla made it (cancel refunds, ticket refunds,
    // source refunds ...): never allocated to an overpayment as a dashboard refund.
    minglaCreated: Object.keys(metadata).some((k) => k.startsWith("mingla_") || k === "source_refund_id"),
  };
}

/** A Paystack refund event (refund.pending/processing/needs-attention/processed/failed). */
export function paystackOverpaymentRefundEvent(
  eventName: string,
  providerRefundId: string,
  merchantNote: string,
  transaction: string,
  amount: number,
): OverpaymentRefundEvent {
  const m = merchantNote.match(/^mingla_overpay_refund:([0-9a-f-]{36}):([1-9][0-9]*)$/i);
  return {
    provider: "paystack",
    providerRefundId: providerRefundId || null,
    paymentRef: transaction || null,
    amountMinor: Number.isSafeInteger(amount) && amount > 0 ? amount : null,
    status: eventName === "refund.processed" ? "succeeded" : eventName === "refund.failed" ? "failed" : "pending",
    overpaymentId: m ? m[1] : null,
    attemptNo: m ? Number(m[2]) : null,
    minglaCreated: merchantNote.toLowerCase().startsWith("mingla") || merchantNote.startsWith("ad_credit_wd:"),
  };
}

interface EventResult {
  handled?: boolean;
  results?: Array<Recorded & {
    overpaymentId?: string;
    orderId?: string;
    installmentId?: string;
    currency?: string;
    providerRef?: string;
  }>;
}

/**
 * Apply a provider refund event to the overpayment lane. Returns true when
 * it was an overpayment refund (the caller then stops); false leaves it to
 * the caller's existing path. Throws on a database error (the webhook retries).
 */
export async function applyOverpaymentRefundEvent(
  supabase: RpcClient,
  event: OverpaymentRefundEvent,
  alertOps: (subject: string, paragraphs: string[]) => Promise<void>,
): Promise<boolean> {
  if (event.providerRefundId === null && event.overpaymentId === null) return false;
  const { data, error } = await supabase.rpc("issue_4522_overpayment_refund_event", {
    p_provider: event.provider,
    p_provider_refund_id: event.providerRefundId,
    p_payment_ref: event.paymentRef,
    p_amount_minor: event.amountMinor,
    p_status: event.status,
    p_overpayment_id: event.overpaymentId,
    p_attempt_no: event.attemptNo,
    p_mingla_created: event.minglaCreated,
  });
  if (error !== null) throw new Error(`overpayment_refund_event_failed:${error.message ?? "unknown"}`);
  const result = (data ?? {}) as EventResult;
  for (const r of result.results ?? []) {
    if (r.alertOps === true && r.alertKind) {
      const alert = overpaymentAlert(r.alertKind, {
        orderId: r.orderId,
        overpaymentId: r.overpaymentId,
        provider: event.provider,
        providerRef: r.providerRef,
        currency: r.currency,
        remainingMinor: r.remainingMinor,
      }, null);
      if (alert !== null) await alertOps(alert.subject, alert.paragraphs);
    }
  }
  return result.handled === true;
}
