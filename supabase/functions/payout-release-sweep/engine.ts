export const RELEASE_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
export const PAYSTACK_TRANSFER_MIN_KOBO = 5_000;
export const PAYSTACK_TRANSFER_CAP_KOBO = 1_000_000_000;
export const PAYSTACK_FEE_SCHEDULE_VERSION = "verified-2026-07-24";

export type Occurrence = { id: string; endAt: string };
export type MoneyCandidate = {
  sourceType: "order" | "rsvp_contribution" | "venue_reservation";
  sourceId: string;
  brandId: string;
  eventId: string;
  eventDateId: string | null;
  provider: "stripe" | "paystack";
  currency: string;
  finalizedAt: string;
  cutoverAt: string;
  eventStatus: string;
  occurrences: Occurrence[];
  reservationEndAt?: string;
  grossCents: number;
  refundedCents: number;
  disputedCents: number;
  minglaFeeCents: number;
  partnerShareCents: number;
  providerFeeCents: number;
};

export type PendingItem = MoneyCandidate & {
  anchorEndAt: string;
  releasableAt: string;
  netCents: number;
  releaseKey: string;
};

const ms = (value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_timestamp:${value}`);
  return parsed;
};

export function resolveLiveOccurrence(
  candidate: MoneyCandidate,
): Occurrence | null {
  if (candidate.sourceType === "venue_reservation") {
    return candidate.reservationEndAt
      ? {
        id: `reservation:${candidate.sourceId}`,
        endAt: candidate.reservationEndAt,
      }
      : null;
  }
  if (candidate.eventDateId) {
    return candidate.occurrences.find((row) =>
      row.id === candidate.eventDateId
    ) ??
      null;
  }
  const finalized = ms(candidate.finalizedAt);
  const sorted = [...candidate.occurrences].sort((a, b) =>
    ms(a.endAt) - ms(b.endAt)
  );
  return sorted.find((row) => ms(row.endAt) >= finalized) ??
    sorted.at(-1) ??
    null;
}

export function resolveLiveAnchor(candidate: MoneyCandidate): string | null {
  return resolveLiveOccurrence(candidate)?.endAt ?? null;
}

export function computePendingItems(
  candidates: MoneyCandidate[],
  nowIso: string,
  attachedSourceIds: ReadonlySet<string> = new Set(),
): PendingItem[] {
  const now = ms(nowIso);
  const seen = new Set(attachedSourceIds);
  const pending: PendingItem[] = [];
  for (const candidate of candidates) {
    if (seen.has(`${candidate.sourceType}:${candidate.sourceId}`)) continue;
    if (candidate.eventStatus === "cancelled") continue;
    // R4: finalized STRICTLY AFTER cutover; equality is excluded.
    if (ms(candidate.finalizedAt) <= ms(candidate.cutoverAt)) continue;
    const occurrence = resolveLiveOccurrence(candidate);
    if (!occurrence) continue;
    const anchorEndAt = occurrence.endAt;
    const releasableAt = new Date(ms(anchorEndAt) + RELEASE_DELAY_MS)
      .toISOString();
    if (ms(releasableAt) > now) continue;
    const netCents = Math.max(
      0,
      candidate.grossCents - candidate.refundedCents - candidate.disputedCents -
        candidate.minglaFeeCents - candidate.partnerShareCents -
        candidate.providerFeeCents,
    );
    const resolvedEventDateId = candidate.sourceType === "venue_reservation"
      ? null
      : occurrence.id;
    const occurrenceKey = resolvedEventDateId ?? occurrence.id;
    pending.push({
      ...candidate,
      eventDateId: resolvedEventDateId,
      anchorEndAt,
      releasableAt,
      netCents,
      releaseKey: [
        candidate.brandId,
        candidate.eventId,
        occurrenceKey,
        candidate.sourceType,
        candidate.provider,
        candidate.currency.toLowerCase(),
      ].join(":"),
    });
    seen.add(`${candidate.sourceType}:${candidate.sourceId}`);
  }
  return pending;
}

export type TransferLeg = {
  kind: "organiser" | "partner";
  principalCents: number;
  estimatedFeeCents: number;
  stampDutyCents: number;
  scheduleVersion: string;
};

export function estimatePaystackTransferCost(principalKobo: number): {
  feeKobo: number;
  stampDutyKobo: number;
} {
  if (
    !Number.isInteger(principalKobo) ||
    principalKobo < PAYSTACK_TRANSFER_MIN_KOBO
  ) {
    return { feeKobo: 0, stampDutyKobo: 0 };
  }
  const naira = principalKobo / 100;
  const feeNaira = naira <= 5_000 ? 10 : naira <= 50_000 ? 25 : 50;
  return {
    feeKobo: feeNaira * 100,
    stampDutyKobo: naira >= 10_000 ? 5_000 : 0,
  };
}

export function buildPaystackTransferLeg(
  kind: TransferLeg["kind"],
  principalCents: number,
): TransferLeg | null {
  const cost = estimatePaystackTransferCost(principalCents);
  if (principalCents < PAYSTACK_TRANSFER_MIN_KOBO) return null;
  return {
    kind,
    principalCents,
    estimatedFeeCents: cost.feeKobo,
    stampDutyCents: cost.stampDutyKobo,
    scheduleVersion: PAYSTACK_FEE_SCHEDULE_VERSION,
  };
}

export type TemporaryDebt = {
  id: string;
  originReleaseId: string;
  brandId: string;
  currency: string;
  principalCents: number;
  recoveredCents: number;
  maturityAt: string;
  status: "open" | "closed" | "converted";
};

export type DebtApplication = {
  debtId: string;
  releaseId: string;
  amountCents: number;
};

export function openPostponementDebt(args: {
  id: string;
  originReleaseId: string;
  brandId: string;
  currency: string;
  deliveredOrganiserCashCents: number;
  liveEndAt: string;
}): TemporaryDebt {
  return {
    id: args.id,
    originReleaseId: args.originReleaseId,
    brandId: args.brandId,
    currency: args.currency.toLowerCase(),
    principalCents: args.deliveredOrganiserCashCents,
    recoveredCents: 0,
    maturityAt: new Date(ms(args.liveEndAt) + RELEASE_DELAY_MS).toISOString(),
    status: "open",
  };
}

export function withholdTemporaryDebt(args: {
  debt: TemporaryDebt;
  releaseId: string;
  releaseBrandId: string;
  releaseCurrency: string;
  availableCents: number;
}): {
  debt: TemporaryDebt;
  application: DebtApplication | null;
  remainingCents: number;
} {
  const { debt } = args;
  if (
    debt.status !== "open" || debt.brandId !== args.releaseBrandId ||
    debt.currency !== args.releaseCurrency.toLowerCase()
  ) {
    return { debt, application: null, remainingCents: args.availableCents };
  }
  const amountCents = Math.min(
    args.availableCents,
    Math.max(0, debt.principalCents - debt.recoveredCents),
  );
  if (amountCents === 0) {
    return { debt, application: null, remainingCents: args.availableCents };
  }
  return {
    debt: { ...debt, recoveredCents: debt.recoveredCents + amountCents },
    application: { debtId: debt.id, releaseId: args.releaseId, amountCents },
    remainingCents: args.availableCents - amountCents,
  };
}

export function matureTemporaryDebt(
  debt: TemporaryDebt,
  nowIso: string,
): {
  debt: TemporaryDebt;
  recreditCents: number;
  unrecoveredClosedCents: number;
} {
  if (debt.status !== "open" || ms(nowIso) < ms(debt.maturityAt)) {
    return { debt, recreditCents: 0, unrecoveredClosedCents: 0 };
  }
  return {
    debt: { ...debt, status: "closed" },
    recreditCents: debt.recoveredCents,
    unrecoveredClosedCents: debt.principalCents - debt.recoveredCents,
  };
}

export type StripeReleaseCandidate = {
  release_id: string;
  brand_id: string;
  stripe_account_id: string;
  currency: string;
  net_release_cents: number;
  maturity_recredit_cents: number;
  attempt_count: number;
  claim_id: string;
};

export type StripeBalance = {
  available?: Array<{ amount?: number; currency?: string }>;
};

export type StripePayout = {
  id: string;
  amount: number;
  currency: string;
  status?: string | null;
};

export type StripeReleaseResult =
  | {
    outcome: "accepted";
    payoutId: string;
    amountCents: number;
  }
  | {
    outcome: "blocked_balance";
    amountCents: number;
    availableCents?: number;
    message: string;
  }
  | {
    outcome: "blocked_kyc" | "retryable_error" | "definitive_error";
    amountCents: number;
    message: string;
  }
  | {
    outcome: "not_authorized";
    amountCents: number;
    message: string;
  };

export type StripeReleaseDeps = {
  retrieveBalance: (
    stripeAccountId: string,
  ) => Promise<StripeBalance>;
  revalidateReleaseImmediatelyBeforePayout: (
    release: StripeReleaseCandidate,
    amountCents: number,
  ) => Promise<boolean>;
  createPayout: (input: {
    stripeAccountId: string;
    amountCents: number;
    currency: string;
    releaseId: string;
    idempotencyKey: string;
  }) => Promise<StripePayout>;
};

export function stripeReleaseAmountCents(
  release: Pick<
    StripeReleaseCandidate,
    "net_release_cents" | "maturity_recredit_cents"
  >,
): number {
  const amount = release.net_release_cents + release.maturity_recredit_cents;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("invalid_stripe_release_amount");
  }
  return amount;
}

export function stripePayoutIdempotencyKey(releaseId: string): string {
  if (releaseId.trim().length === 0) {
    throw new Error("stripe_release_id_required");
  }
  return `brand_payout_${releaseId}`;
}

export function stripeAvailableCents(
  balance: StripeBalance,
  currency: string,
): number {
  const normalized = currency.trim().toLowerCase();
  return (balance.available ?? []).reduce((total, row) => {
    if (
      row.currency?.trim().toLowerCase() !== normalized ||
      !Number.isSafeInteger(row.amount) ||
      (row.amount ?? 0) < 0
    ) {
      return total;
    }
    return total + (row.amount ?? 0);
  }, 0);
}

type StripeErrorShape = {
  code?: unknown;
  type?: unknown;
  statusCode?: unknown;
  message?: unknown;
  raw?: {
    code?: unknown;
    type?: unknown;
    message?: unknown;
  };
};

function stripeErrorField(
  error: StripeErrorShape,
  key: "code" | "type" | "message",
): string | null {
  const direct = error[key];
  if (typeof direct === "string" && direct.trim().length > 0) return direct;
  const raw = error.raw?.[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

export function classifyStripePayoutCreateError(
  error: unknown,
): {
  outcome:
    | "blocked_balance"
    | "blocked_kyc"
    | "retryable_error"
    | "definitive_error";
  message: string;
} {
  const stripeError = error && typeof error === "object"
    ? error as StripeErrorShape
    : {};
  const code = stripeErrorField(stripeError, "code");
  const type = stripeErrorField(stripeError, "type");
  const message = stripeErrorField(stripeError, "message") ??
    (error instanceof Error ? error.message : String(error));
  if (code === "balance_insufficient") {
    return { outcome: "blocked_balance", message };
  }
  // Stripe test-mode probes proved KYC payout rejection is an
  // invalid_request_error with no error.code.
  if (type === "invalid_request_error") {
    return { outcome: "blocked_kyc", message };
  }
  const statusCode = typeof stripeError.statusCode === "number"
    ? stripeError.statusCode
    : null;
  if (
    statusCode !== null && statusCode >= 400 && statusCode < 500 &&
    ![408, 409, 429].includes(statusCode)
  ) {
    return { outcome: "definitive_error", message };
  }
  return { outcome: "retryable_error", message };
}

export async function executeStripeRelease(
  release: StripeReleaseCandidate,
  deps: StripeReleaseDeps,
): Promise<StripeReleaseResult> {
  const amountCents = stripeReleaseAmountCents(release);
  const balance = await deps.retrieveBalance(release.stripe_account_id);
  const availableCents = stripeAvailableCents(balance, release.currency);
  if (availableCents < amountCents) {
    return {
      outcome: "blocked_balance",
      amountCents,
      availableCents,
      message: "stripe_available_balance_below_ledger_release",
    };
  }
  const authorized = await deps.revalidateReleaseImmediatelyBeforePayout(
    release,
    amountCents,
  );
  if (!authorized) {
    return {
      outcome: "not_authorized",
      amountCents,
      message: "live_release_authorization_revoked",
    };
  }
  try {
    const payout = await deps.createPayout({
      stripeAccountId: release.stripe_account_id,
      amountCents,
      currency: release.currency,
      releaseId: release.release_id,
      idempotencyKey: stripePayoutIdempotencyKey(release.release_id),
    });
    if (
      !payout.id || payout.amount !== amountCents ||
      payout.currency.toLowerCase() !== release.currency.toLowerCase()
    ) {
      throw new Error("stripe_payout_response_mismatch");
    }
    if (payout.status === "failed" || payout.status === "canceled") {
      return {
        outcome: "retryable_error",
        amountCents,
        message: `stripe_payout_${payout.status}:${payout.id}`,
      };
    }
    return { outcome: "accepted", payoutId: payout.id, amountCents };
  } catch (error) {
    const classified = classifyStripePayoutCreateError(error);
    return { ...classified, amountCents };
  }
}
