// Issue #2097 — the only shared owner of ticket Application Fee Refund truth.
// This module deliberately uses structural provider/client types so importing its
// pure guards in tests never initializes Stripe or Supabase clients.

export const ISSUE_2097_STATUSES = [
  "awaiting_application_fee",
  "application_fee_timeout",
  "application_fee_conflict",
  "rejected_preflight",
  "pending_visibility",
  "succeeded_positive",
  "fee_evidence_unavailable",
  "evidence_conflict",
  "not_applicable",
  "unknown_legacy",
] as const;

export type Issue2097Status = typeof ISSUE_2097_STATUSES[number];
export type Issue2097PreflightReason =
  | "invalid_provider_amount"
  | "partial_fee_below_provider_cent"
  | "fee_preflight_conflict";

const CANONICAL_PROVIDER_INTEGER = /^(0|[1-9][0-9]{0,15})$/;

export function canonicalProviderInteger(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string" && CANONICAL_PROVIDER_INTEGER.test(value)) {
    return value;
  }
  return null;
}

export type PreflightDecision =
  | { allowed: true; kind: "full" | "partial" }
  | {
    allowed: false;
    status: "rejected_preflight";
    reason: Issue2097PreflightReason;
  };

export function decideFeeRefundPreflight(
  feeAmount: unknown,
  requestedRefund: unknown,
  capturedAmount: unknown,
): PreflightDecision {
  const f = canonicalProviderInteger(feeAmount);
  const r = canonicalProviderInteger(requestedRefund);
  const c = canonicalProviderInteger(capturedAmount);
  if (f === null || r === null || c === null) {
    return {
      allowed: false,
      status: "rejected_preflight",
      reason: "invalid_provider_amount",
    };
  }
  const F = BigInt(f);
  const R = BigInt(r);
  const C = BigInt(c);
  if (F <= 0n || R <= 0n || C <= 0n || R > C || F >= C) {
    return {
      allowed: false,
      status: "rejected_preflight",
      reason: "invalid_provider_amount",
    };
  }
  if (R === C) return { allowed: true, kind: "full" };
  if (F * R < C) {
    return {
      allowed: false,
      status: "rejected_preflight",
      reason: "partial_fee_below_provider_cent",
    };
  }
  return { allowed: true, kind: "partial" };
}

export interface FeeRefundEvidence {
  id: string;
  fee: string;
  amount: unknown;
  currency: string;
}

export type FeeEvidenceDecision =
  | { status: "pending_visibility" }
  | {
    status: "succeeded_positive";
    feeRefundId: string;
    amountText: string;
    afterAmountText: string;
  }
  | {
    status: "evidence_conflict";
    feeRefundId: string | null;
    observedAmountText: string | null;
  };

export function classifyFeeRefundEvidence(input: {
  applicationFeeId: string;
  currency: string;
  originalFeeAmount: unknown;
  baselineAmountRefunded: unknown;
  baselineIds: readonly string[];
  afterAmountRefunded: unknown;
  afterRefunds: readonly FeeRefundEvidence[];
  listComplete: boolean;
}): FeeEvidenceDecision {
  if (!input.listComplete) {
    return {
      status: "evidence_conflict",
      feeRefundId: null,
      observedAmountText: null,
    };
  }
  const original = canonicalProviderInteger(input.originalFeeAmount);
  const before = canonicalProviderInteger(input.baselineAmountRefunded);
  const after = canonicalProviderInteger(input.afterAmountRefunded);
  if (original === null || before === null || after === null) {
    return {
      status: "evidence_conflict",
      feeRefundId: null,
      observedAmountText: null,
    };
  }
  const baseline = new Set(input.baselineIds);
  if (baseline.size !== input.baselineIds.length) {
    return {
      status: "evidence_conflict",
      feeRefundId: null,
      observedAmountText: null,
    };
  }
  const novel = input.afterRefunds.filter((item) => !baseline.has(item.id));
  if (novel.length === 0 && BigInt(after) === BigInt(before)) {
    return { status: "pending_visibility" };
  }
  if (novel.length !== 1) {
    return {
      status: "evidence_conflict",
      feeRefundId: null,
      observedAmountText: null,
    };
  }
  const one = novel[0];
  const amount = canonicalProviderInteger(one.amount);
  if (
    amount === null || one.fee !== input.applicationFeeId ||
    one.currency.toLowerCase() !== input.currency.toLowerCase()
  ) {
    return {
      status: "evidence_conflict",
      feeRefundId: one.id,
      observedAmountText: amount,
    };
  }
  const delta = BigInt(after) - BigInt(before);
  if (
    BigInt(amount) <= 0n || delta !== BigInt(amount) ||
    BigInt(after) > BigInt(original)
  ) {
    return {
      status: "evidence_conflict",
      feeRefundId: one.id,
      observedAmountText: amount,
    };
  }
  return {
    status: "succeeded_positive",
    feeRefundId: one.id,
    amountText: amount,
    afterAmountText: after,
  };
}

export async function listAllFeeRefunds(
  listPage: (
    startingAfter?: string,
  ) => Promise<{ data: FeeRefundEvidence[]; has_more: boolean }>,
): Promise<FeeRefundEvidence[]> {
  const rows: FeeRefundEvidence[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await listPage(cursor);
    rows.push(...result.data);
    if (!result.has_more) return rows;
    const last = result.data.at(-1)?.id;
    if (!last || last === cursor) {
      throw new Error("fee_refund_pagination_conflict");
    }
    cursor = last;
  }
  throw new Error("fee_refund_pagination_incomplete");
}

export const ISSUE_2097_OBSERVATION_DELAYS_SECONDS = [
  0,
  5,
  30,
  120,
  600,
  1800,
  7200,
  86400,
] as const;

export function publicFeeTruth(
  amount: unknown,
  status: Issue2097Status,
): number | null {
  if (status === "not_applicable") return 0;
  if (status !== "succeeded_positive") return null;
  const canonical = canonicalProviderInteger(amount);
  return canonical === null || BigInt(canonical) <= 0n
    ? null
    : Number(canonical);
}

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => any;
  from: (table: string) => any;
};

type StripeRefundClient = {
  paymentIntents: {
    retrieve: (id: string, params: unknown, options: unknown) => Promise<any>;
  };
  charges: {
    retrieve: (id: string, params: unknown, options: unknown) => Promise<any>;
  };
  applicationFees: {
    retrieve: (id: string) => Promise<any>;
    listRefunds: (id: string, params: Record<string, unknown>) => Promise<any>;
  };
  refunds: {
    create: (
      params: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<any>;
  };
};

export interface ExecuteTicketRefundInput {
  supabase: RpcClient;
  stripe: StripeRefundClient;
  refundId: string;
  orderId: string;
  paymentIntentId: string;
  knownChargeId?: string | null;
  connectedAccountId: string;
  expectedCurrency: string;
  expectedApplicationFeeAmount: unknown;
  requestedRefundAmount: unknown;
  requestFingerprint: string;
  providerIdempotencyKey?: string;
  expectedAttemptCount?: number;
  createBuyerRefund?: () => Promise<any>;
  allowProviderMutation?: boolean;
}

export interface ExecuteTicketRefundResult {
  status: Issue2097Status;
  terminalReason?: Issue2097PreflightReason;
  buyerRefundId: string | null;
  applicationFeeRefundedCents: number | null;
  attemptId: string | null;
  httpStatus: number;
}

export function isFeeTruthTerminalSuccess(
  result: ExecuteTicketRefundResult | null,
): result is ExecuteTicketRefundResult & {
  status: "succeeded_positive" | "not_applicable";
  buyerRefundId: string;
} {
  return result !== null &&
    (result.status === "succeeded_positive" ||
      result.status === "not_applicable") &&
    typeof result.buyerRefundId === "string" && result.buyerRefundId.length > 0;
}

const rpc = async (
  client: RpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<any> => {
  const result = await client.rpc(name, args);
  if (result.error) {
    throw new Error(`${name}:${result.error.message ?? "failed"}`);
  }
  return result.data;
};

async function feeRefundSnapshot(
  stripe: StripeRefundClient,
  feeId: string,
): Promise<{ ids: string[]; rows: FeeRefundEvidence[] }> {
  const rows = await listAllFeeRefunds(async (startingAfter) => {
    const page = await stripe.applicationFees.listRefunds(feeId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    return {
      data: page.data.map((row: any) => ({
        id: String(row.id),
        fee: String(row.fee),
        amount: row.amount,
        currency: String(row.currency),
      })),
      has_more: page.has_more === true,
    };
  });
  return { ids: rows.map((row) => row.id), rows };
}

/**
 * Executes the one #2097 Stripe mutation boundary. Provider reads happen first;
 * the durable DB preflight/lease commits before refunds.create, and every replay
 * adopts the same attempt rather than creating another refund.
 */
export async function executeTicketRefundWithFeeTruth(
  input: ExecuteTicketRefundInput,
): Promise<ExecuteTicketRefundResult> {
  const persistedExpectedFee = input.expectedApplicationFeeAmount == null
    ? null
    : canonicalProviderInteger(input.expectedApplicationFeeAmount);
  const requested = canonicalProviderInteger(input.requestedRefundAmount);
  const pi = await input.stripe.paymentIntents.retrieve(
    input.paymentIntentId,
    { expand: ["latest_charge.application_fee"] },
    { stripeAccount: input.connectedAccountId },
  );
  const chargeId = input.knownChargeId ||
    (typeof pi.latest_charge === "string"
      ? pi.latest_charge
      : pi.latest_charge?.id);
  if (!chargeId) throw new Error("application_fee_conflict");
  const charge =
    typeof pi.latest_charge === "object" && pi.latest_charge?.id === chargeId
      ? pi.latest_charge
      : await input.stripe.charges.retrieve(chargeId, {
        expand: ["application_fee"],
      }, { stripeAccount: input.connectedAccountId });
  const captured = canonicalProviderInteger(charge.amount_captured);
  const feeIdentity = typeof charge.application_fee === "string"
    ? charge.application_fee
    : charge.application_fee?.id;
  const preRefundLeaseOwner = crypto.randomUUID();
  const recordPreRefundState = async (
    status: "awaiting_application_fee" | "application_fee_conflict",
  ) => {
    const result = await rpc(
      input.supabase,
      "issue_2097_record_pre_refund_state",
      {
        p_refund_id: input.refundId,
        p_request_fingerprint: input.requestFingerprint,
        p_provider_mode: charge.livemode ? "live" : "test",
        p_connected_account_id: input.connectedAccountId,
        p_currency: input.expectedCurrency,
        p_charge_id: chargeId,
        p_payment_intent_id: input.paymentIntentId,
        p_application_fee_amount_text: persistedExpectedFee,
        p_captured_charge_amount_text: captured,
        p_requested_refund_amount_text: requested,
        p_status: status,
        p_expected_attempt_count: input.expectedAttemptCount ?? 1,
        p_lease_owner: preRefundLeaseOwner,
      },
    );
    return result;
  };
  if (!feeIdentity && persistedExpectedFee !== "0") {
    const state = await recordPreRefundState("awaiting_application_fee");
    return {
      status: state.status as Issue2097Status,
      buyerRefundId: null,
      applicationFeeRefundedCents: null,
      attemptId: state.attempt_id as string,
      httpStatus: state.status === "awaiting_application_fee" ? 202 : 409,
    };
  }
  if (persistedExpectedFee === "0" && !feeIdentity) {
    const state = await recordPreRefundState("awaiting_application_fee");
    if (state.provider_call_permitted !== true) {
      return {
        status: state.status as Issue2097Status,
        buyerRefundId: null,
        applicationFeeRefundedCents: null,
        attemptId: state.attempt_id as string,
        httpStatus: state.status === "awaiting_application_fee" ? 202 : 409,
      };
    }
    if (input.allowProviderMutation === false) {
      return {
        status: "awaiting_application_fee",
        buyerRefundId: null,
        applicationFeeRefundedCents: null,
        attemptId: state.attempt_id as string,
        httpStatus: 202,
      };
    }
    const created = input.createBuyerRefund
      ? await input.createBuyerRefund()
      : await input.stripe.refunds.create({
        payment_intent: input.paymentIntentId,
        amount: Number(requested),
        reason: "requested_by_customer",
        refund_application_fee: false,
        metadata: {
          mingla_refund_id: input.refundId,
          mingla_order_id: input.orderId,
        },
      }, {
        idempotencyKey: input.providerIdempotencyKey ??
          `ticket_refund:${input.refundId}`,
        stripeAccount: input.connectedAccountId,
      });
    await rpc(input.supabase, "issue_2097_record_buyer_refund", {
      p_attempt_id: state.attempt_id,
      p_lease_owner: preRefundLeaseOwner,
      p_lease_epoch: state.lease_epoch,
      p_buyer_refund_id: String(created.id),
      p_buyer_refund_amount_text: canonicalProviderInteger(created.amount),
    });
    await rpc(input.supabase, "issue_2097_finalize_refund_attempt", {
      p_attempt_id: state.attempt_id,
      p_lease_owner: preRefundLeaseOwner,
      p_lease_epoch: state.lease_epoch,
      p_status: "not_applicable",
      p_fee_refund_id: null,
      p_fee_refund_amount_text: "0",
      p_after_amount_refunded_text: "0",
      p_stripe_event_id: null,
    });
    return {
      status: "not_applicable",
      buyerRefundId: String(created.id),
      applicationFeeRefundedCents: 0,
      attemptId: state.attempt_id as string,
      httpStatus: 200,
    };
  }
  if (!feeIdentity || requested === null || captured === null) {
    const state = await recordPreRefundState("application_fee_conflict");
    return {
      status: state.status as Issue2097Status,
      buyerRefundId: null,
      applicationFeeRefundedCents: null,
      attemptId: state.attempt_id as string,
      httpStatus: 409,
    };
  }
  const fee = await input.stripe.applicationFees.retrieve(feeIdentity);
  const feeAmount = canonicalProviderInteger(fee.amount);
  // Legacy trip installments did not persist their per-PI fee, so their
  // immutable provider Fee becomes the adopted exact value. New single-PI
  // checkout paths must match their persisted value byte-for-byte.
  const expectedFee = persistedExpectedFee ?? feeAmount;
  const feeRefundedBefore = canonicalProviderInteger(fee.amount_refunded);
  if (
    feeAmount !== expectedFee ||
    fee.currency?.toLowerCase() !== input.expectedCurrency.toLowerCase() ||
    fee.charge !== chargeId || fee.account !== input.connectedAccountId ||
    fee.livemode !== charge.livemode || feeRefundedBefore === null
  ) {
    const state = await recordPreRefundState("application_fee_conflict");
    return {
      status: state.status as Issue2097Status,
      buyerRefundId: null,
      applicationFeeRefundedCents: null,
      attemptId: state.attempt_id as string,
      httpStatus: 409,
    };
  }
  const baseline = await feeRefundSnapshot(input.stripe, feeIdentity);
  const preflight = decideFeeRefundPreflight(feeAmount, requested, captured);
  const leaseOwner = crypto.randomUUID();
  const prepared = await rpc(
    input.supabase,
    "issue_2097_prepare_refund_attempt",
    {
      p_refund_id: input.refundId,
      p_request_fingerprint: input.requestFingerprint,
      p_provider_mode: fee.livemode ? "live" : "test",
      p_connected_account_id: input.connectedAccountId,
      p_currency: input.expectedCurrency,
      p_charge_id: chargeId,
      p_payment_intent_id: input.paymentIntentId,
      p_application_fee_id: feeIdentity,
      p_application_fee_amount_text: feeAmount,
      p_captured_charge_amount_text: captured,
      p_requested_refund_amount_text: requested,
      p_baseline_fee_refund_ids: baseline.ids,
      p_baseline_amount_refunded_text: feeRefundedBefore,
      p_typescript_preflight: preflight.allowed,
      p_expected_attempt_count: input.expectedAttemptCount ?? 1,
      p_lease_owner: leaseOwner,
    },
  );
  if (prepared.status === "rejected_preflight") {
    return {
      status: "rejected_preflight",
      terminalReason: prepared.terminal_reason,
      buyerRefundId: null,
      applicationFeeRefundedCents: null,
      attemptId: prepared.attempt_id,
      httpStatus: 422,
    };
  }
  let buyerRefundId: string | null = null;
  let durableBaselineIds = baseline.ids;
  let durableBaselineAmount = feeRefundedBefore;
  if (prepared.idempotent_replay === true) {
    const { data: existingAttempt, error: existingAttemptError } = await input
      .supabase.from("ticket_refund_attempts")
      .select(
        "buyer_refund_id,baseline_fee_refund_ids,baseline_amount_refunded_text,fee_refund_amount_text",
      )
      .eq("id", prepared.attempt_id).single();
    if (existingAttemptError || !existingAttempt) {
      throw new Error("refund_attempt_replay_lookup_failed");
    }
    buyerRefundId = existingAttempt.buyer_refund_id ?? null;
    durableBaselineIds = existingAttempt.baseline_fee_refund_ids;
    durableBaselineAmount = existingAttempt.baseline_amount_refunded_text;
    if (
      [
        "succeeded_positive",
        "not_applicable",
        "rejected_preflight",
        "fee_evidence_unavailable",
        "evidence_conflict",
      ].includes(prepared.status)
    ) {
      const proven = canonicalProviderInteger(
        existingAttempt.fee_refund_amount_text,
      );
      return {
        status: prepared.status as Issue2097Status,
        terminalReason: prepared.terminal_reason,
        buyerRefundId,
        applicationFeeRefundedCents:
          prepared.status === "succeeded_positive" && proven
            ? Number(proven)
            : prepared.status === "not_applicable"
            ? 0
            : null,
        attemptId: prepared.attempt_id,
        httpStatus:
          ["succeeded_positive", "not_applicable"].includes(prepared.status)
            ? 200
            : 409,
      };
    }
    const claimed = await rpc(
      input.supabase,
      "issue_2097_claim_refund_attempt",
      {
        p_attempt_id: prepared.attempt_id,
        p_lease_owner: leaseOwner,
      },
    );
    if (claimed.status === "retry_not_due") {
      return {
        status: prepared.status as Issue2097Status,
        buyerRefundId,
        applicationFeeRefundedCents: null,
        attemptId: prepared.attempt_id,
        httpStatus: 202,
      };
    }
    if (claimed.claimed !== true) {
      return {
        status: prepared.status as Issue2097Status,
        buyerRefundId,
        applicationFeeRefundedCents: null,
        attemptId: prepared.attempt_id,
        httpStatus: 202,
      };
    }
    prepared.provider_call_permitted = !buyerRefundId;
    prepared.lease_epoch = claimed.lease_epoch;
  }
  if (
    prepared.provider_call_permitted === true &&
    input.allowProviderMutation === false
  ) {
    return {
      status: prepared.status as Issue2097Status,
      buyerRefundId: null,
      applicationFeeRefundedCents: null,
      attemptId: prepared.attempt_id,
      httpStatus: 202,
    };
  }
  if (prepared.provider_call_permitted === true) {
    const created = input.createBuyerRefund
      ? await input.createBuyerRefund()
      : await input.stripe.refunds.create({
        payment_intent: input.paymentIntentId,
        amount: Number(requested),
        reason: "requested_by_customer",
        refund_application_fee: true,
        metadata: {
          mingla_refund_id: input.refundId,
          mingla_order_id: input.orderId,
        },
      }, {
        idempotencyKey: input.providerIdempotencyKey ??
          `ticket_refund:${input.refundId}`,
        stripeAccount: input.connectedAccountId,
      });
    buyerRefundId = String(created.id);
    await rpc(input.supabase, "issue_2097_record_buyer_refund", {
      p_attempt_id: prepared.attempt_id,
      p_lease_owner: leaseOwner,
      p_lease_epoch: prepared.lease_epoch,
      p_buyer_refund_id: buyerRefundId,
      p_buyer_refund_amount_text: canonicalProviderInteger(created.amount),
    });
  } else {
    // The durable replay lookup above owns provider identity adoption.
  }
  const afterFee = await input.stripe.applicationFees.retrieve(feeIdentity);
  const after = await feeRefundSnapshot(input.stripe, feeIdentity);
  const decision = classifyFeeRefundEvidence({
    applicationFeeId: feeIdentity,
    currency: input.expectedCurrency,
    originalFeeAmount: feeAmount,
    baselineAmountRefunded: durableBaselineAmount,
    baselineIds: durableBaselineIds,
    afterAmountRefunded: afterFee.amount_refunded,
    afterRefunds: after.rows,
    listComplete: true,
  });
  if (decision.status === "pending_visibility") {
    const observed = await rpc(
      input.supabase,
      "issue_2097_record_pending_observation",
      {
        p_attempt_id: prepared.attempt_id,
        p_lease_owner: leaseOwner,
        p_lease_epoch: prepared.lease_epoch,
        p_after_amount_refunded_text: canonicalProviderInteger(
          afterFee.amount_refunded,
        ),
      },
    );
    if (observed.status !== "fee_evidence_unavailable") {
      return {
        status: decision.status,
        buyerRefundId,
        applicationFeeRefundedCents: null,
        attemptId: prepared.attempt_id,
        httpStatus: 202,
      };
    }
    await rpc(input.supabase, "issue_2097_finalize_refund_attempt", {
      p_attempt_id: prepared.attempt_id,
      p_lease_owner: leaseOwner,
      p_lease_epoch: prepared.lease_epoch,
      p_status: "fee_evidence_unavailable",
      p_fee_refund_id: null,
      p_fee_refund_amount_text: null,
      p_after_amount_refunded_text: canonicalProviderInteger(
        afterFee.amount_refunded,
      ),
      p_stripe_event_id: null,
    });
    return {
      status: "fee_evidence_unavailable",
      buyerRefundId,
      applicationFeeRefundedCents: null,
      attemptId: prepared.attempt_id,
      httpStatus: 409,
    };
  }
  await rpc(input.supabase, "issue_2097_finalize_refund_attempt", {
    p_attempt_id: prepared.attempt_id,
    p_lease_owner: leaseOwner,
    p_lease_epoch: prepared.lease_epoch,
    p_status: decision.status,
    p_fee_refund_id: decision.feeRefundId,
    p_fee_refund_amount_text: decision.status === "succeeded_positive"
      ? decision.amountText
      : decision.observedAmountText,
    p_after_amount_refunded_text: canonicalProviderInteger(
      afterFee.amount_refunded,
    ),
    p_stripe_event_id: null,
  });
  return {
    status: decision.status,
    buyerRefundId,
    applicationFeeRefundedCents: decision.status === "succeeded_positive"
      ? Number(decision.amountText)
      : null,
    attemptId: prepared.attempt_id,
    httpStatus: decision.status === "succeeded_positive" ? 200 : 409,
  };
}
