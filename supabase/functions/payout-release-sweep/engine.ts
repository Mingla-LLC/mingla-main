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

export function resolveLiveAnchor(candidate: MoneyCandidate): string | null {
  if (candidate.sourceType === "venue_reservation") {
    return candidate.reservationEndAt ?? null;
  }
  if (candidate.eventDateId) {
    return candidate.occurrences.find((row) => row.id === candidate.eventDateId)
      ?.endAt ?? null;
  }
  const finalized = ms(candidate.finalizedAt);
  const sorted = [...candidate.occurrences].sort((a, b) =>
    ms(a.endAt) - ms(b.endAt)
  );
  return sorted.find((row) => ms(row.endAt) >= finalized)?.endAt ??
    sorted.at(-1)?.endAt ??
    null;
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
    const anchorEndAt = resolveLiveAnchor(candidate);
    if (!anchorEndAt) continue;
    const releasableAt = new Date(ms(anchorEndAt) + RELEASE_DELAY_MS)
      .toISOString();
    if (ms(releasableAt) > now) continue;
    const netCents = Math.max(
      0,
      candidate.grossCents - candidate.refundedCents - candidate.disputedCents -
        candidate.minglaFeeCents - candidate.partnerShareCents -
        candidate.providerFeeCents,
    );
    const occurrenceKey = candidate.eventDateId ??
      (candidate.sourceType === "venue_reservation"
        ? `reservation:${candidate.sourceId}`
        : `fallback:${anchorEndAt}`);
    pending.push({
      ...candidate,
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
