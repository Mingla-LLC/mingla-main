import { stripeTicketRefund } from "./stripe.ts";
import {
  createPaystackRefund,
  paystackRefundCanonicalState,
  reconcilePaystackRefund,
} from "./paystackRefunds.ts";
import { enqueueSourceRefundNotifications } from "./sourceRefundNotifications.ts";
import { resolvePaymentOperationFlagValue } from "./secretBundle.ts";

export type SourceRefundState =
  | "queued"
  | "provider_pending"
  | "needs_attention"
  | "processed"
  | "failed_retryable"
  | "failed_terminal";

export interface SourceRefundOperation {
  id: string;
  source_type:
    | "venue_reservation"
    | "rsvp_contribution"
    | "stay_reservation"
    | "venue_menu_order"
    | "ticket_checkout_session";
  source_id: string;
  subject_id: string;
  brand_id: string;
  provider: "stripe" | "paystack";
  currency: string;
  original_charge_cents: number;
  original_application_fee_cents: number | null;
  buyer_refund_requested_cents: number;
  fee_reversal_required_cents: number;
  buyer_state: SourceRefundState;
  fee_state: SourceRefundState | "not_required";
  active_buyer_attempt_no: number;
  active_fee_attempt_no: number;
  provider_payment_reference: string;
  paystack_transaction_id?: number | string | null;
  stripe_charge_id?: string | null;
  provider_account_reference: string | null;
  stripe_application_fee_id: string | null;
  provider_refund_id: string | null;
}

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

const KILL_SWITCH = "SOURCE_REFUNDS_POST_DISABLED";

export function sourceRefundPostsEnabled(): boolean {
  const postsDisabled = resolvePaymentOperationFlagValue(
    "source_refunds_post_disabled",
    KILL_SWITCH,
  ) ?? true;
  return postsDisabled === false;
}

function stripeState(status: string | null | undefined): SourceRefundState {
  switch ((status ?? "").toLowerCase()) {
    case "succeeded":
      return "processed";
    case "failed":
    case "canceled":
      return "failed_terminal";
    case "requires_action":
      return "needs_attention";
    default:
      return "provider_pending";
  }
}

async function record(
  client: ServiceClient,
  operation: SourceRefundOperation,
  legType: "buyer_refund" | "application_fee_reversal",
  attemptNo: number,
  nextState: SourceRefundState,
  amount: number,
  providerOperationId: string | null,
  reasonCode: string,
): Promise<void> {
  const fingerprint = providerOperationId?.slice(-12) ?? "none";
  const { data: recorded, error } = await client.rpc(
    "record_source_refund_provider_event",
    {
      p_refund_id: operation.id,
      p_leg_type: legType,
      p_attempt_no: attemptNo,
      p_event_key:
        `runner:${operation.id}:${legType}:${attemptNo}:${nextState}:${fingerprint}`,
      p_provider_event_type: "worker_reconciliation",
      p_provider_event_id:
        `worker:${operation.id}:${legType}:${attemptNo}:${fingerprint}`,
      p_next_state: nextState,
      p_amount_observed_cents: amount,
      p_provider_operation_id: providerOperationId,
      p_safe_reason_code: reasonCode,
    },
  );
  if (error) {
    throw new Error(`source_refund_state_commit_failed:${error.message}`);
  }
  if (legType === "buyer_refund") {
    let buyerUserId: string | null = null;
    let buyerEmail: string | null = null;
    let buyerPhone: string | null = null;
    let sourceLabel: string;
    switch (operation.source_type) {
      case "venue_reservation": {
        const { data } = await client.from("reservations")
          .select("consumer_user_id,guest_email,guest_phone_e164")
          .eq("id", operation.subject_id).maybeSingle();
        buyerUserId = data?.consumer_user_id ?? null;
        buyerEmail = data?.guest_email ?? null;
        buyerPhone = data?.guest_phone_e164 ?? null;
        sourceLabel = "Venue reservation";
        break;
      }
      case "stay_reservation": {
        const { data } = await client.from("stay_reservation_groups")
          .select("user_id,guest_snapshot")
          .eq("id", operation.subject_id).maybeSingle();
        const guest = data?.guest_snapshot &&
            typeof data.guest_snapshot === "object"
          ? data.guest_snapshot as Record<string, unknown>
          : {};
        buyerUserId = data?.user_id ?? null;
        buyerEmail = typeof guest.email === "string" ? guest.email : null;
        buyerPhone = typeof guest.phone === "string" ? guest.phone : null;
        sourceLabel = "Stay reservation";
        break;
      }
      case "rsvp_contribution": {
        const { data } = await client.from("event_rsvp_contributions")
          .select("user_id,guest_email")
          .eq("id", operation.subject_id).maybeSingle();
        buyerUserId = data?.user_id ?? null;
        buyerEmail = data?.guest_email ?? null;
        sourceLabel = "RSVP contribution";
        break;
      }
      case "venue_menu_order": {
        const { data } = await client.from("venue_orders")
          .select("buyer_user_id,buyer_email,buyer_phone_e164")
          .eq("id", operation.subject_id).maybeSingle();
        buyerUserId = data?.buyer_user_id ?? null;
        buyerEmail = data?.buyer_email ?? null;
        buyerPhone = data?.buyer_phone_e164 ?? null;
        sourceLabel = "Venue order";
        break;
      }
      case "ticket_checkout_session": {
        const { data } = await client.from("ticket_checkout_sessions")
          .select("buyer_user_id,buyer_email,buyer_phone_e164")
          .eq("id", operation.subject_id).maybeSingle();
        buyerUserId = data?.buyer_user_id ?? null;
        buyerEmail = data?.buyer_email ?? null;
        buyerPhone = data?.buyer_phone_e164 ?? null;
        sourceLabel = "Event ticket payment";
        break;
      }
      default:
        throw new Error("source_refund_unknown_source_type");
    }
    let amountLabel = `${
      (operation.buyer_refund_requested_cents / 100).toFixed(2)
    } ${operation.currency}`;
    try {
      amountLabel = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: operation.currency,
      }).format(operation.buyer_refund_requested_cents / 100);
    } catch {
      // ISO currency remains explicit; never substitute USD.
    }
    try {
      await enqueueSourceRefundNotifications(client, {
        refundId: operation.id,
        state: nextState,
        eventId: Number(recorded?.source_refund_event_id),
        attentionGeneration: Math.max(
          1,
          Number(recorded?.attention_generation ?? 0),
        ),
        buyerUserId,
        buyerEmail,
        buyerPhone,
        brandId: operation.brand_id,
        amountLabel,
        sourceLabel,
      });
    } catch {
      console.warn("source_refund_notification_enqueue_failed");
    }
  }
}

async function ensureAttempt(
  client: ServiceClient,
  operation: SourceRefundOperation,
  legType: "buyer_refund" | "application_fee_reversal",
): Promise<{
  attemptNo: number;
  idempotencyKey: string;
  merchantNote: string | null;
  providerOperationId: string | null;
  reconcileOnly: boolean;
}> {
  const { data, error } = await client.rpc("ensure_source_refund_attempt", {
    p_refund_id: operation.id,
    p_leg_type: legType,
  });
  if (error || !data) {
    throw new Error(
      `source_refund_attempt_prepare_failed:${error?.message ?? "no_data"}`,
    );
  }
  return {
    attemptNo: Number(data.attempt_no),
    idempotencyKey: String(data.idempotency_key),
    merchantNote: data.merchant_note == null
      ? null
      : String(data.merchant_note),
    providerOperationId: data.provider_operation_id == null
      ? null
      : String(data.provider_operation_id),
    reconcileOnly: data.reconcile_only === true,
  };
}

async function reconcileAdoptedPaystackAttempt(params: {
  operation: SourceRefundOperation;
  merchantNote: string;
  providerOperationId: string | null;
}): Promise<{
  id: string | null;
  amount: number;
  status: string;
}> {
  const match = await reconcilePaystackRefund({
    transaction: params.operation.provider_payment_reference,
    expectedTransactionId: params.operation.source_type ===
        "ticket_checkout_session"
      ? Number(params.operation.paystack_transaction_id)
      : undefined,
    merchantNote: params.merchantNote,
    amountSubunits: params.operation.buyer_refund_requested_cents,
    currency: params.operation.currency,
    providerRefundId: params.providerOperationId,
  });
  if (!match) {
    return {
      id: params.providerOperationId,
      amount: 0,
      status: "needs-attention",
    };
  }
  return {
    id: match.id || params.providerOperationId,
    amount: match.amount,
    status: match.status,
  };
}

function isStripeFeeIdentityPermissionDenied(error: unknown): boolean {
  const row = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  return row.type === "StripePermissionError" ||
    row.statusCode === 401 ||
    row.statusCode === 403;
}

async function proveStripeApplicationFee(
  client: ServiceClient,
  operation: SourceRefundOperation,
): Promise<string | null> {
  if (
    operation.provider !== "stripe" ||
    operation.fee_reversal_required_cents <= 0
  ) return null;
  if (operation.stripe_application_fee_id) {
    return operation.stripe_application_fee_id;
  }
  if (
    !operation.provider_account_reference ||
    operation.original_application_fee_cents === null
  ) return null;
  const stripe = stripeTicketRefund();
  let chargeId = operation.provider_payment_reference.startsWith("ch_")
    ? operation.provider_payment_reference
    : "";
  if (!chargeId && operation.provider_payment_reference.startsWith("pi_")) {
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only identity proof; Stripe retrievals do not accept idempotency keys
    // @ts-ignore Stripe's Deno SDK types are runtime provided.
    const intent = await stripe.paymentIntents.retrieve(
      operation.provider_payment_reference,
      { expand: ["latest_charge"] },
      { stripeAccount: operation.provider_account_reference },
    );
    chargeId = typeof intent.latest_charge === "string"
      ? intent.latest_charge
      : String(intent.latest_charge?.id ?? "");
  }
  if (!chargeId.startsWith("ch_")) return null;
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only identity proof; Stripe retrievals do not accept idempotency keys
  // @ts-ignore Stripe's Deno SDK types are runtime provided.
  const charge = await stripe.charges.retrieve(
    chargeId,
    {},
    { stripeAccount: operation.provider_account_reference },
  );
  if (
    Number(charge.amount ?? -1) !== operation.original_charge_cents ||
    String(charge.currency ?? "").toUpperCase() !== operation.currency
  ) return null;
  const feeId = typeof charge.application_fee === "string"
    ? charge.application_fee
    : String(charge.application_fee?.id ?? "");
  if (!feeId.startsWith("fee_")) return null;
  // Application Fees belong to the platform account even when the charge is direct.
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only identity proof; Stripe retrievals do not accept idempotency keys
  // @ts-ignore Stripe's Deno SDK types are runtime provided.
  const fee = await stripe.applicationFees.retrieve(feeId);
  const feeAccount = typeof fee.account === "string"
    ? fee.account
    : String(fee.account?.id ?? "");
  if (
    feeAccount !== operation.provider_account_reference ||
    String(fee.charge ?? "") !== chargeId ||
    Number(fee.amount ?? -1) !== operation.original_application_fee_cents ||
    String(fee.currency ?? "").toUpperCase() !== operation.currency
  ) return null;
  const { error } = await client.rpc(
    "set_source_refund_stripe_fee_identity",
    {
      p_refund_id: operation.id,
      p_application_fee_id: feeId,
      p_connected_account: operation.provider_account_reference,
      p_fee_amount_cents: operation.original_application_fee_cents,
    },
  );
  if (error) {
    throw new Error(
      `source_refund_fee_identity_commit_failed:${error.message}`,
    );
  }
  operation.stripe_application_fee_id = feeId;
  return feeId;
}

export async function runSourceRefundOperation(
  client: ServiceClient,
  operation: SourceRefundOperation,
): Promise<void> {
  if (!sourceRefundPostsEnabled()) return;

  if (
    operation.provider === "stripe" &&
    operation.fee_reversal_required_cents > 0 &&
    !operation.stripe_application_fee_id
  ) {
    let feeId: string | null;
    try {
      feeId = await proveStripeApplicationFee(client, operation);
    } catch (error) {
      if (!isStripeFeeIdentityPermissionDenied(error)) throw error;
      const attempt = await ensureAttempt(
        client,
        operation,
        "application_fee_reversal",
      );
      await record(
        client,
        operation,
        "application_fee_reversal",
        attempt.attemptNo,
        "needs_attention",
        0,
        null,
        "stripe_fee_identity_permission_denied",
      );
      return;
    }
    if (!feeId) {
      const attempt = await ensureAttempt(
        client,
        operation,
        "application_fee_reversal",
      );
      await record(
        client,
        operation,
        "application_fee_reversal",
        attempt.attemptNo,
        "needs_attention",
        0,
        null,
        "application_fee_identity_unproven",
      );
      return;
    }
  }

  if (operation.buyer_state !== "processed") {
    const attempt = await ensureAttempt(client, operation, "buyer_refund");
    if (operation.provider === "stripe") {
      if (!operation.provider_account_reference) {
        await record(
          client,
          operation,
          "buyer_refund",
          attempt.attemptNo,
          "needs_attention",
          0,
          null,
          "connected_account_unproven",
        );
        return;
      }
      const stripe = stripeTicketRefund();
      if (operation.source_type === "ticket_checkout_session") {
        if (
          !operation.provider_payment_reference.startsWith("pi_") ||
          !operation.stripe_charge_id?.startsWith("ch_")
        ) {
          await record(
            client,
            operation,
            "buyer_refund",
            attempt.attemptNo,
            "needs_attention",
            0,
            null,
            "stripe_ticket_identity_incomplete",
          );
          return;
        }
        // @ts-ignore Stripe's Deno SDK types are runtime provided.
        const paymentIntent = await stripe.paymentIntents.retrieve(
          operation.provider_payment_reference,
          { expand: ["latest_charge"] },
          { stripeAccount: operation.provider_account_reference },
        );
        const latestCharge = typeof paymentIntent.latest_charge === "string"
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge?.id ??
            paymentIntent.charges?.data?.[0]?.id ?? null;
        if (latestCharge !== operation.stripe_charge_id) {
          await record(
            client,
            operation,
            "buyer_refund",
            attempt.attemptNo,
            "needs_attention",
            0,
            null,
            "stripe_ticket_charge_mismatch",
          );
          return;
        }
      }
      // @ts-ignore Stripe's Deno SDK types are runtime provided.
      const refund = await stripe.refunds.create({
        payment_intent: operation.provider_payment_reference,
        amount: operation.buyer_refund_requested_cents,
        reason: "requested_by_customer",
        refund_application_fee: false,
        metadata: {
          source_refund_id: operation.id,
          source_type: operation.source_type,
        },
      }, {
        idempotencyKey: attempt.idempotencyKey,
        stripeAccount: operation.provider_account_reference,
      });
      await record(
        client,
        operation,
        "buyer_refund",
        attempt.attemptNo,
        stripeState(refund.status),
        Number(refund.amount ?? 0),
        String(refund.id),
        "stripe_verified_refund",
      );
    } else {
      const merchantNote = attempt.merchantNote ??
        `mingla_source_refund:${operation.id}:${attempt.attemptNo}`;
      const refund = attempt.reconcileOnly
        ? await reconcileAdoptedPaystackAttempt({
          operation,
          merchantNote,
          providerOperationId: attempt.providerOperationId,
        })
        : await createPaystackRefund({
          transaction: operation.provider_payment_reference,
          expectedTransactionId: operation.source_type ===
              "ticket_checkout_session"
            ? Number(operation.paystack_transaction_id)
            : undefined,
          merchantNote,
          amountSubunits: operation.buyer_refund_requested_cents,
          currency: operation.currency,
        });
      await record(
        client,
        operation,
        "buyer_refund",
        attempt.attemptNo,
        paystackRefundCanonicalState(refund.status),
        Number(refund.amount ?? 0),
        refund.id,
        attempt.reconcileOnly
          ? "paystack_adopted_attempt_reconciled"
          : "paystack_verified_refund",
      );
      if (
        operation.fee_reversal_required_cents > 0 &&
        operation.fee_state !== "processed"
      ) {
        const feeAttempt = await ensureAttempt(
          client,
          operation,
          "application_fee_reversal",
        );
        // Paystack exposes no fee-refund API. Posting this leg is the exact
        // platform/organizer allocation committed under the source lock.
        await record(
          client,
          operation,
          "application_fee_reversal",
          feeAttempt.attemptNo,
          "processed",
          operation.fee_reversal_required_cents,
          `paystack-ledger:${operation.id}`,
          "paystack_exact_ledger_allocation",
        );
      }
    }
  }

  if (
    operation.provider === "stripe" &&
    operation.fee_reversal_required_cents > 0 &&
    operation.fee_state !== "processed"
  ) {
    if (!operation.stripe_application_fee_id) return;
    const attempt = await ensureAttempt(
      client,
      operation,
      "application_fee_reversal",
    );
    const stripe = stripeTicketRefund();
    // @ts-ignore Stripe's Deno SDK types are runtime provided.
    const feeRefund = await stripe.applicationFees.createRefund(
      operation.stripe_application_fee_id,
      {
        amount: operation.fee_reversal_required_cents,
        metadata: {
          source_refund_id: operation.id,
          source_type: operation.source_type,
        },
      },
      { idempotencyKey: attempt.idempotencyKey },
    );
    await record(
      client,
      operation,
      "application_fee_reversal",
      attempt.attemptNo,
      feeRefund.amount === operation.fee_reversal_required_cents
        ? "processed"
        : "needs_attention",
      Number(feeRefund.amount ?? 0),
      String(feeRefund.id),
      "stripe_verified_application_fee_refund",
    );
  }
}

export function safeSourceRefundSummary(operation: SourceRefundOperation) {
  return {
    refundId: operation.id,
    sourceType: operation.source_type,
    buyerState: operation.buyer_state,
    feeState: operation.fee_state,
    amountCents: operation.buyer_refund_requested_cents,
    currency: operation.currency,
  };
}
