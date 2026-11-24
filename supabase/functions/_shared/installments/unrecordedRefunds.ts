/**
 * issue #4522 pass 6 (S9-1) — a trip refund the provider has made is never
 * left unrecorded in silence.
 *
 * - providerRefundsMade: what the provider has already returned for one local
 *   refund (card attempts holding a provider refund; second-provider attempts
 *   accepted, processed or carrying a provider id).
 * - alertUnrecordedTripRefund: the one ops alert when a cancel's recording
 *   failed after the provider moved money (order, amounts, provider ids).
 * - finishUnrecordedPlanRefunds: the instalment run finishes such a card
 *   refund by replaying its attempt with no provider call allowed (the same
 *   provider refund id is read back; nothing is ever sent again). Second-
 *   provider refunds are never re-sent automatically.
 */
import { executeTicketRefundWithFeeTruth } from "../issue2097TicketRefundTruth.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export interface ProviderRefundMade {
  provider: "stripe" | "paystack";
  charge: string;
  providerRefundId: string;
  amountMinor: number;
  recorded: boolean;
}

/** Provider refunds already made for this local refund (empty when none). */
export async function providerRefundsMade(
  supabase: Client,
  refundId: string,
): Promise<ProviderRefundMade[]> {
  if (refundId === "") return [];
  const made: ProviderRefundMade[] = [];
  const { data: card } = await supabase.from("ticket_refund_attempts")
    .select(
      "payment_intent_id, buyer_refund_id, buyer_refund_amount_text, status",
    )
    .eq("refund_id", refundId).not("buyer_refund_id", "is", null);
  for (const a of (card ?? []) as Record<string, unknown>[]) {
    made.push({
      provider: "stripe",
      charge: String(a.payment_intent_id ?? "?"),
      providerRefundId: String(a.buyer_refund_id),
      amountMinor: Number(a.buyer_refund_amount_text ?? 0),
      recorded: a.status === "succeeded_positive" ||
        a.status === "not_applicable",
    });
  }
  const { data: second } = await supabase.from("paystack_refund_attempts")
    .select("transaction_reference, provider_refund_id, amount_cents, status")
    .eq("local_refund_id", refundId);
  for (const a of (second ?? []) as Record<string, unknown>[]) {
    if (
      a.provider_refund_id == null && a.status !== "accepted" &&
      a.status !== "processed"
    ) continue;
    made.push({
      provider: "paystack",
      charge: String(a.transaction_reference ?? "?"),
      providerRefundId: String(a.provider_refund_id ?? "unknown"),
      amountMinor: Number(a.amount_cents ?? 0),
      // Seventh pass (H-2): a second-provider refund the provider confirmed
      // ('processed') is recorded against its charge the moment that is
      // written (issue_4522_record_confirmed_cancel_refund), even while
      // other refunds of the same cancel are still unknown.
      recorded: a.status === "processed",
    });
  }
  return made;
}

/** The one ops alert for a cancel whose provider refunds were not recorded. */
export async function alertUnrecordedTripRefund(
  alert: (subject: string, paragraphs: string[]) => Promise<void>,
  input: {
    orderId: string;
    refundId: string;
    currency: string;
    detail: string;
    made: ProviderRefundMade[];
  },
): Promise<void> {
  if (input.made.length === 0) return;
  const card = input.made.some((m) => m.provider === "stripe");
  await alert("A trip refund was made but not recorded", [
    "The payment provider returned money to a traveler for a cancelled trip booking, but Mingla's records did not save all of it. Payouts of the refunded instalments are held until it is recorded; check the deposit before the next payout.",
    `Order: ${input.orderId}; refund: ${input.refundId}`,
    ...input.made.map((m) =>
      `Charge ${m.charge}: ${m.amountMinor} ${input.currency.toUpperCase()} (minor units) refunded, provider refund ${m.providerRefundId}`
    ),
    `What failed: ${input.detail.slice(0, 300)}`,
    card
      // issue #4522 G-3 — this alert is sent only where the cancel cannot be
      // resumed (a database without the #4522 schema): nothing finishes it.
      ? "Nothing finishes this automatically: please record this refund against the booking. Mingla will not send it again; nothing is sent again."
      : "Second-provider refunds are never re-sent automatically; please reconcile this refund.",
  ]);
}

/** One intended refund of a cancel, as begin wrote it. */
export interface IntendedTripRefund {
  installment_id: string | null;
  source_pi: string | null;
  refund_cents: number;
}

/**
 * issue #4522 G-3 / G-4 — the one ops alert for a trip cancel that cannot
 * finish on its own: after its 3rd failed attempt, or (second provider) when
 * a refund was sent and the provider never answered. It says, per intended
 * refund, what is true now and what happens next.
 */
export async function alertTripCancelNotFinished(
  alert: (subject: string, paragraphs: string[]) => Promise<void>,
  input: {
    orderId: string;
    refundId: string;
    currency: string;
    detail: string;
    made: ProviderRefundMade[];
    intended: IntendedTripRefund[];
    unconfirmed: string[];
    cause: "failure" | "unconfirmed" | "stuck";
  },
): Promise<void> {
  const cur = input.currency.toUpperCase();
  const lines = input.intended.filter((e) => e.refund_cents > 0).map((e) => {
    const which = e.installment_id === null ? "deposit" : `instalment ${e.installment_id}`;
    const made = input.made.find((m) => m.charge === e.source_pi);
    const sentNoAnswer = input.unconfirmed.some((n) => n.endsWith(`:${e.installment_id ?? "deposit"}`));
    const state = made && made.recorded
      ? `refunded and recorded (provider refund ${made.providerRefundId})`
      : made
      ? `refunded at the provider, not yet recorded (provider refund ${made.providerRefundId})`
      : sentNoAnswer
      ? "sent to the provider, no answer yet (never re-sent automatically)"
      : "not refunded yet";
    return `Charge ${e.source_pi ?? "?"} (${which}): ${e.refund_cents} ${cur} (minor units): ${state}`;
  });
  await alert("A trip cancel refund could not be finished", [
    input.cause === "unconfirmed"
      ? "A cancelled trip booking's refund was sent to the second payment provider, which has not confirmed it. Mingla never sends it again automatically. The booking's payouts stay held until the refund is recorded."
      : input.cause === "stuck"
      ? "A cancelled trip booking's refund is still not finished 24 hours after the cancel: the payment provider has not confirmed or has refused part of it. Mingla keeps checking. The booking's payouts stay held until it is finished. The traveler has not been told the refund is done."
      : "A cancelled trip booking still owes the traveler a refund, and three attempts to finish it failed, so Mingla has stopped retrying it automatically. The booking's payouts stay held until it is finished. The traveler has not been told the refund is done.",
    `Order: ${input.orderId}; refund: ${input.refundId}`,
    ...lines,
    `What failed: ${input.detail.slice(0, 300)}`,
    input.cause === "unconfirmed" || input.cause === "stuck"
      ? "Next: check this refund with the provider. When the provider shows it, the next instalment run or the host pressing Cancel & refund again records it."
      : "Next: fix the cause, then the host can press Cancel & refund again on this booking to finish it; refunds already made are never sent again.",
  ]);
}

/**
 * issue #4522 G-3 / G-4 — the instalment run's read-back of trip cancels in
 * progress: each is resumed by the cancel function itself (mode 'resume',
 * service role), which records what the provider already refunded and sends
 * only what was never sent. It never starts a cancel.
 */
export async function resumeTripCancels(
  supabase: Client,
  limit: number,
  invoke: (body: Record<string, unknown>, key: string) => Promise<Response> = defaultResumeInvoke,
): Promise<{ completed: number; in_progress: number; error: number }> {
  const out = { completed: 0, in_progress: 0, error: 0 };
  const { data, error } = await supabase.rpc("issue_4522_trip_cancels_to_resume", {
    p_limit: Math.min(Math.max(limit, 1), 10),
  });
  if (error) throw new Error(`trip_cancel_resume_query_failed:${error.message}`);
  for (const row of (Array.isArray(data) ? data : []) as unknown[]) {
    const orderId = typeof row === "string" ? row : String((row as Record<string, unknown>)?.issue_4522_trip_cancels_to_resume ?? "");
    if (orderId.length === 0) continue;
    try {
      const { data: op } = await supabase.rpc("issue_4522_trip_cancel_operation", { p_order_id: orderId });
      if (op === null || op === undefined) continue;
      const res = await invoke({
        mode: "resume",
        orderId,
        expectedRefundTotalCents: Number((op as Record<string, unknown>).amount_cents ?? 0),
      }, `trip-cancel-resume:${String((op as Record<string, unknown>).refund_id)}`);
      if (res.ok) out.completed += 1;
      else if (res.status === 409) out.in_progress += 1;
      else out.error += 1;
      await res.body?.cancel();
    } catch (err) {
      out.error += 1;
      console.error(JSON.stringify({
        event: "trip_cancel_resume_failed",
        orderId,
        reason: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      }));
    }
  }
  return out;
}

function defaultResumeInvoke(body: Record<string, unknown>, key: string): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return fetch(`${url}/functions/v1/cancel-trip-booking`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Card refunds of plan orders whose provider refund is known but not yet
 * recorded (attempt not terminal, untouched for 2 minutes): replayed with no
 * provider call allowed, so the finalize records them on their rows.
 */
export async function finishUnrecordedPlanRefunds(
  supabase: Client,
  stripe: () => unknown,
  limit: number,
  now: Date = new Date(),
): Promise<{ finished: number; waiting: number; error: number }> {
  const out = { finished: 0, waiting: 0, error: 0 };
  const { data, error } = await supabase.from("ticket_refund_attempts")
    .select(
      "refund_id,order_id,request_fingerprint,connected_account_id,currency,charge_id,payment_intent_id,application_fee_amount_text,requested_refund_amount_text,expected_attempt_count",
    )
    .not("buyer_refund_id", "is", null)
    .in("status", ["pending_visibility", "awaiting_application_fee"])
    .lte("updated_at", new Date(now.getTime() - 2 * 60 * 1000).toISOString())
    .order("updated_at", { ascending: true }).limit(Math.min(limit, 20));
  if (error) throw new Error(`unrecorded_refund_query_failed:${error.message}`);
  const attempts = (data ?? []) as Record<string, string | number | null>[];
  if (attempts.length === 0) return out;
  const client = stripe();
  const { data: plans } = await supabase.from("orders").select("id")
    .in("id", [...new Set(attempts.map((a) => String(a.order_id)))]).eq(
      "installment_plan_root",
      true,
    );
  const planOrders = new Set(
    ((plans ?? []) as { id: string }[]).map((o) => o.id),
  );
  for (const a of attempts) {
    if (!planOrders.has(String(a.order_id))) continue;
    try {
      const result = await executeTicketRefundWithFeeTruth({
        supabase,
        // deno-lint-ignore no-explicit-any
        stripe: client as any,
        refundId: String(a.refund_id),
        orderId: String(a.order_id),
        paymentIntentId: String(a.payment_intent_id),
        knownChargeId: a.charge_id == null ? undefined : String(a.charge_id),
        connectedAccountId: String(a.connected_account_id),
        expectedCurrency: String(a.currency),
        expectedApplicationFeeAmount: a.application_fee_amount_text == null
          ? null
          : String(a.application_fee_amount_text),
        requestedRefundAmount: String(a.requested_refund_amount_text),
        requestFingerprint: String(a.request_fingerprint),
        expectedAttemptCount: Number(a.expected_attempt_count ?? 1),
        allowProviderMutation: false,
      });
      if (
        result.status === "succeeded_positive" ||
        result.status === "not_applicable"
      ) out.finished += 1;
      else out.waiting += 1;
    } catch (err) {
      out.error += 1;
      console.error(JSON.stringify({
        event: "unrecorded_plan_refund_replay_failed",
        refundId: a.refund_id,
        reason: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      }));
    }
  }
  return out;
}
