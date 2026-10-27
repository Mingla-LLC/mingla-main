export type GigQuote = {
  feeMinor: number;
  bookingFeeMinor: number;
  totalMinor: number;
  currency: string;
};

export function quoteGig(feeMinor: number, currency: string): GigQuote {
  if (!Number.isSafeInteger(feeMinor) || feeMinor <= 0) {
    throw new Error("fee_minor_invalid");
  }
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("currency_invalid");
  const bookingFeeMinor = Math.floor((feeMinor * 1500 + 5000) / 10000);
  return {
    feeMinor,
    bookingFeeMinor,
    totalMinor: feeMinor + bookingFeeMinor,
    currency: normalized,
  };
}

export function gigStripeIntent(
  input: { contractId: string; termsVersion: number; quote: GigQuote },
) {
  return {
    amount: input.quote.totalMinor,
    currency: input.quote.currency.toLowerCase(),
    payment_method_types: ["card", "link"],
    transfer_group: `gig_${input.contractId}`,
    metadata: {
      mingla_kind: "gig_hold",
      contract_id: input.contractId,
      terms_version: String(input.termsVersion),
      fee_minor: String(input.quote.feeMinor),
      booking_fee_minor: String(input.quote.bookingFeeMinor),
    },
    statement_descriptor_suffix: "CREATOR GIG",
  };
}

export function gigPaystackInitialize(
  input: {
    contractId: string;
    termsVersion: number;
    quote: GigQuote;
    email: string;
    callbackUrl?: string | null;
  },
) {
  if (input.quote.currency !== "NGN") throw new Error("paystack_requires_ngn");
  return {
    email: input.email,
    amountSubunits: input.quote.totalMinor,
    currency: "NGN",
    reference: `ghold_${
      input.contractId.replaceAll("-", "")
    }_v${input.termsVersion}`,
    callbackUrl: input.callbackUrl ?? undefined,
    metadata: {
      mingla_kind: "gig_hold",
      contract_id: input.contractId,
      terms_version: input.termsVersion,
      fee_minor: input.quote.feeMinor,
      booking_fee_minor: input.quote.bookingFeeMinor,
    },
  };
}

export type RefundBranch =
  | "upload_missed"
  | "counter_lower"
  | "host_before_accept"
  | "host_after_accept_before_lock"
  | "creator_after_accept"
  | "creator_decline"
  | "declined_or_expired"
  | "resolved_partial"
  | "resolved_refund";
export function gigRefund(
  input: {
    branch: RefundBranch;
    feeMinor: number;
    bookingFeeMinor: number;
    refundBps?: number;
  },
): { hostRefundMinor: number; creatorFeeMinor: number } {
  const total = input.feeMinor + input.bookingFeeMinor;
  if (input.branch === "host_after_accept_before_lock") {
    return {
      hostRefundMinor: Math.floor(input.feeMinor * 7500 / 10000) +
        input.bookingFeeMinor,
      creatorFeeMinor: input.feeMinor -
        Math.floor(input.feeMinor * 7500 / 10000),
    };
  }
  if (input.branch === "resolved_partial") {
    const bps = input.refundBps ?? -1;
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
      throw new Error("refund_bps_invalid");
    }
    const feeRefund = Math.floor(input.feeMinor * bps / 10000);
    return {
      hostRefundMinor: feeRefund + (bps === 10000 ? input.bookingFeeMinor : 0),
      creatorFeeMinor: input.feeMinor - feeRefund,
    };
  }
  if (
    [
      "upload_missed",
      "host_before_accept",
      "creator_after_accept",
      "creator_decline",
      "declined_or_expired",
      "resolved_refund",
    ].includes(input.branch)
  ) return { hostRefundMinor: total, creatorFeeMinor: 0 };
  throw new Error("refund_branch_invalid");
}

export function gigStripeRelease(
  input: {
    contractId: string;
    feeMinor: number;
    destination: string;
    sourceTransaction: string;
  },
) {
  return {
    amount: input.feeMinor,
    destination: input.destination,
    transfer_group: `gig_${input.contractId}`,
    source_transaction: input.sourceTransaction,
    metadata: { mingla_kind: "gig_fee", contract_id: input.contractId },
  };
}

/**
 * Split an amount across captured provider payments in order (the base hold
 * first, then counter-offer top-ups). Each part never exceeds what that
 * payment still holds; anything left over means the ledger is short.
 */
export function allocateAcrossSources<T extends { availableMinor: number }>(
  amountMinor: number,
  sources: T[],
): Array<{ source: T; amountMinor: number }> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("amount_invalid");
  }
  let left = amountMinor;
  const parts: Array<{ source: T; amountMinor: number }> = [];
  for (const source of sources) {
    if (left <= 0) break;
    const part = Math.min(left, Math.max(0, source.availableMinor));
    if (part > 0) {
      parts.push({ source, amountMinor: part });
      left -= part;
    }
  }
  if (left > 0) throw new Error("sources_insufficient");
  return parts;
}

/** A counter-offer top-up charge on the hold's rail, same response shape. */
export function gigTopupStripeIntent(
  input: { contractId: string; termsVersion: number; quote: GigQuote },
) {
  const intent = gigStripeIntent(input);
  return {
    ...intent,
    metadata: { ...intent.metadata, mingla_kind: "gig_topup" },
  };
}

export function gigTopupPaystackInitialize(
  input: {
    contractId: string;
    termsVersion: number;
    quote: GigQuote;
    email: string;
    callbackUrl?: string | null;
  },
) {
  const init = gigPaystackInitialize(input);
  return {
    ...init,
    reference: `gtop_${
      input.contractId.replaceAll("-", "")
    }_v${input.termsVersion}`,
    metadata: { ...init.metadata, mingla_kind: "gig_topup" },
  };
}
