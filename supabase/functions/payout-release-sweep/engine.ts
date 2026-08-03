export const RELEASE_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
export const PAYSTACK_TRANSFER_MIN_KOBO = 5_000;
export const PAYSTACK_TRANSFER_CAP_KOBO = 1_000_000_000;
export const PAYSTACK_FEE_SCHEDULE_VERSION = "verified-2026-07-24";

export type Occurrence = { id: string; endAt: string };
export type MoneyCandidate = {
  sourceType:
    | "order"
    | "rsvp_contribution"
    | "venue_reservation"
    | "stay_reservation";
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
  if (
    candidate.sourceType === "venue_reservation" ||
    candidate.sourceType === "stay_reservation"
  ) {
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
    const resolvedEventDateId = (
        candidate.sourceType === "venue_reservation" ||
        candidate.sourceType === "stay_reservation"
      )
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

// ───────────────────────────────────────────────────────────────────────────
// Issue #1177 (sub-issue H) — Nigerian organiser Paystack Transfer execution.
//
// The organiser pool arrives DEBT-ADJUSTED and PARTNER-COST-ADJUSTED from B/E
// (brand_payout_releases.net_release_cents after apply_open_payout_debts and
// plan_pending_payout_partner_legs). H turns that ledger truth into balance-
// sourced Paystack Transfers, brand-borne fees, deterministic ₦10M chunking and
// lost-response (#1030) reconciliation. Everything below is PURE (no IO) except
// executePaystackRelease, which is fully dependency-injected exactly like
// executeStripeRelease so it is unit-testable with mocked Paystack + RPC deps.
//
// FEE MODEL — RATIFIED MODEL B (#1013 SPEC v1.2 §1 "brand absorbs the transfer
// fee"): the fee is taken OUT of the organiser pool, so the organiser receives
// pool − fee. Partner PRINCIPAL is never reduced (partner fees were already
// removed from the pool by E). No hidden Mingla subsidy: estimate/actual fee
// variance nets forward as an append-only ledger adjustment, never a silent
// Mingla charge.
// ───────────────────────────────────────────────────────────────────────────

export type OrganiserChunk = {
  chunkIndex: number;
  principalCents: number;
  estimatedFeeCents: number;
  stampDutyCents: number;
  scheduleVersion: string;
};

export type OrganiserChunkPlan =
  | {
    chunks: OrganiserChunk[];
    organiserCashCents: number;
    feeTotalCents: number;
  }
  | { deferred: "sub_floor" };

/**
 * Deterministic organiser chunk plan (SPEC §4.2/§4.4, model B).
 *
 * `organiserPoolKobo` = the release's debt+partner-cost-adjusted pool
 * (net_release_cents + maturity_recredit_cents). The brand bears the transfer
 * fee, so the DELIVERED principal = pool − fee.
 *
 *  - pool < ₦50 floor                         → { deferred: "sub_floor" }
 *  - pool ≤ ₦10M cap                          → ONE chunk; fee pinned to the
 *    delivered principal via a deterministic 2-pass tier re-solve (fee tiers are
 *    coarse, so subtracting the fee can cross a tier boundary once).
 *  - pool > ₦10M cap                          → ceil(pool/cap) chunks, EVENLY
 *    distributed so every chunk lands in ~[cap/2, cap] (each > ₦50k and ≥ ₦10k →
 *    fixed top fee + stamp) with contiguous chunk_index and NO sub-₦50 final
 *    chunk. Even distribution is stable across re-plan (idempotent).
 *
 * If model B pushes the delivered principal below the ₦50 transfer floor even
 * though the pre-fee pool cleared it, defer rather than fire a sub-floor
 * transfer or drop the fee onto Mingla.
 */
export function planOrganiserTransferChunks(
  organiserPoolKobo: number,
): OrganiserChunkPlan {
  if (!Number.isSafeInteger(organiserPoolKobo) || organiserPoolKobo < 0) {
    throw new Error("invalid_organiser_pool");
  }
  if (organiserPoolKobo < PAYSTACK_TRANSFER_MIN_KOBO) {
    return { deferred: "sub_floor" };
  }

  if (organiserPoolKobo <= PAYSTACK_TRANSFER_CAP_KOBO) {
    // Single chunk. Model B: organiserCash = pool − fee(organiserCash).
    // Deterministic 2-pass tier re-solve.
    const pass1 = estimatePaystackTransferCost(organiserPoolKobo);
    const cashTmp = organiserPoolKobo - pass1.feeKobo - pass1.stampDutyKobo;
    const pass2 = estimatePaystackTransferCost(Math.max(0, cashTmp));
    const feeTotal = pass2.feeKobo + pass2.stampDutyKobo;
    const organiserCash = organiserPoolKobo - feeTotal;
    if (organiserCash < PAYSTACK_TRANSFER_MIN_KOBO) {
      return { deferred: "sub_floor" };
    }
    return {
      chunks: [{
        chunkIndex: 0,
        principalCents: organiserCash,
        estimatedFeeCents: pass2.feeKobo,
        stampDutyCents: pass2.stampDutyKobo,
        scheduleVersion: PAYSTACK_FEE_SCHEDULE_VERSION,
      }],
      organiserCashCents: organiserCash,
      feeTotalCents: feeTotal,
    };
  }

  // Multi-chunk. Every chunk lands in ~[cap/2, cap] (top fee tier + stamp), so
  // the per-chunk (fee + stamp) is fixed and feeTotal = n × (fee + stamp).
  const n = Math.ceil(organiserPoolKobo / PAYSTACK_TRANSFER_CAP_KOBO);
  const perChunk = estimatePaystackTransferCost(PAYSTACK_TRANSFER_CAP_KOBO);
  const feeTotal = n * (perChunk.feeKobo + perChunk.stampDutyKobo);
  const organiserCash = organiserPoolKobo - feeTotal;
  if (organiserCash < n * PAYSTACK_TRANSFER_MIN_KOBO) {
    return { deferred: "sub_floor" };
  }
  const base = Math.floor(organiserCash / n);
  const remainder = organiserCash - base * n;
  const chunks: OrganiserChunk[] = [];
  for (let i = 0; i < n; i++) {
    const principal = base + (i < remainder ? 1 : 0);
    const cost = estimatePaystackTransferCost(principal);
    chunks.push({
      chunkIndex: i,
      principalCents: principal,
      estimatedFeeCents: cost.feeKobo,
      stampDutyCents: cost.stampDutyKobo,
      scheduleVersion: PAYSTACK_FEE_SCHEDULE_VERSION,
    });
  }
  return { chunks, organiserCashCents: organiserCash, feeTotalCents: feeTotal };
}

/**
 * The NGN main-balance debit for this release (ceiling target, SPEC §4.4): the
 * sum over the un-succeeded organiser chunks AND the release's partner legs of
 * (principal + estimatedFee + stampDuty). The main-balance read is CEILING-ONLY
 * — a release amount is NEVER computed from a balance read (I-1013-LEDGER-ONLY).
 */
export function paystackReleaseCeilingKobo(
  organiserChunks: Array<
    Pick<OrganiserChunk, "principalCents" | "estimatedFeeCents" | "stampDutyCents">
  >,
  partnerLegKobo: number,
): number {
  const organiser = organiserChunks.reduce(
    (total, chunk) =>
      total + chunk.principalCents + chunk.estimatedFeeCents +
      chunk.stampDutyCents,
    0,
  );
  return organiser + Math.max(0, partnerLegKobo);
}

/**
 * Estimate-vs-actual fee reconciliation direction (SPEC §4.2 #3). variance =
 * actual − estimate; > 0 ⇒ debit (brand owes on next release), < 0 ⇒ credit.
 */
export function reconcilePaystackFee(
  estimatedFeeCents: number,
  estimatedStampCents: number,
  actualFeeCents: number,
  actualStampCents: number,
): { varianceCents: number; direction: "debit" | "credit" | "none" } {
  const variance = (actualFeeCents + actualStampCents) -
    (estimatedFeeCents + estimatedStampCents);
  return {
    varianceCents: variance,
    direction: variance > 0 ? "debit" : variance < 0 ? "credit" : "none",
  };
}

/**
 * Classify a synchronous transfer error — reimplemented IDENTICALLY to E's
 * classifyTransferError (paystackPartnerSplits.ts:298-324; that file is E-owned
 * and DO-NOT-TOUCH, so the taxonomy is re-encoded here rather than imported).
 * P2-1331: duplicate-reference and insufficient-balance are RETRYABLE (same
 * reference, no attempt bump) — the only money-safe posture, because re-using a
 * reference returns the ORIGINAL transfer so a duplicate can never double-pay.
 */
export function classifyPaystackTransferError(
  err: unknown,
): { kind: "retryable" | "definitive"; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (/insufficient/i.test(message) || /balance/i.test(message)) {
    return { kind: "retryable", message };
  }
  if (/duplicate/i.test(message) || /reference.*(exists|already)/i.test(message)) {
    return { kind: "retryable", message };
  }
  const status =
    err && typeof err === "object" &&
      typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : null;
  if (status !== null) {
    if (status >= 500 || status === 429) return { kind: "retryable", message };
    return { kind: "definitive", message };
  }
  // Network / timeout / non-HTTP throw — ambiguous; the transfer MAY have gone
  // through. Same reference on retry so a duplicate can never pay twice.
  return { kind: "retryable", message };
}

/**
 * Organiser chunk idempotency reference (SPEC §4.3). The reference IS the
 * Paystack idempotency key; retryable outcomes keep the SAME reference (no
 * attempt bump), only a definitive 4xx burns the attempt → a new reference.
 */
export function buildOrganiserTransferReference(
  releaseId: string,
  chunkIndex: number,
  attempt: number,
): string {
  if (releaseId.trim().length === 0) {
    throw new Error("organiser_release_id_required");
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error("organiser_chunk_index_invalid");
  }
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error("organiser_attempt_invalid");
  }
  return `bprel_${releaseId}_c${chunkIndex}_a${attempt}`;
}

/** Normalise a Paystack transfer `status` string to a decision bucket. */
export function mapPaystackTransferStatus(
  status: unknown,
):
  | "success"
  | "otp"
  | "failed"
  | "reversed"
  | "pending" {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "success") return "success";
  if (s === "otp") return "otp";
  if (s === "reversed") return "reversed";
  if (s === "failed" || s === "abandoned") return "failed";
  return "pending"; // pending | queued | processing | received | otp-less async
}

/**
 * Best-effort actual transfer cost from a transfer object (initiate / fetch /
 * verify / webhook payload). Returns null when Paystack has not yet exposed the
 * fee (async settlement) — the caller then marks the leg fee_unreconciled and
 * reconciles on a later sweep/webhook.
 *
 * #1218 — credit-only-what-is-returned. A read-only test-mode transfer-object
 * probe (2026-07-27) confirmed Paystack reports the fee as `fee_charged` and,
 * when it itemises, an optional `fees_breakdown` array of `{ amount, type }`
 * rows (this is where the separately-charged ₦50 stamp duty appears). When the
 * breakdown is present we reflect the ACTUAL stamp from it rather than hardcoding
 * zero; when only a combined charge is reported we treat it as the whole transfer
 * cost (stamp 0) — we never fabricate a stamp split we cannot see. Either way
 * the reconcile compares TOTALS (actualFee + actualStamp) and never silently
 * subsidises Mingla.
 */
export function parsePaystackTransferCost(
  data: Record<string, unknown> | null | undefined,
): { actualFeeCents: number; actualStampCents: number } | null {
  if (!data || typeof data !== "object") return null;
  // Prefer Paystack's itemised breakdown so the ACTUAL stamp is reflected.
  const breakdown = data.fees_breakdown;
  if (Array.isArray(breakdown) && breakdown.length > 0) {
    let feeCents = 0;
    let stampCents = 0;
    let sawNumeric = false;
    for (const item of breakdown as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      // #1237 — gate on genuine numeric PRESENCE, not the coerced value.
      // `Number(null)` / `Number("")` / `Number(false)` all === 0, so the old
      // `Number(row.amount)` gate accepted a falsy-but-absent amount as a real
      // 0-cost line, flipped `sawNumeric`, and returned a spurious {0,0} that
      // MASKED the combined `fee_charged` fallback below. Only a genuinely
      // present positive integer counts as an itemised fee line; any
      // falsy/absent/zero amount is ignored so the real fee is preserved.
      const rawAmount = row.amount;
      if (
        typeof rawAmount !== "number" ||
        !Number.isInteger(rawAmount) ||
        rawAmount <= 0
      ) continue;
      sawNumeric = true;
      const type = String(row.type ?? "").toLowerCase();
      if (type.includes("stamp")) stampCents += rawAmount;
      else feeCents += rawAmount;
    }
    if (sawNumeric) {
      return { actualFeeCents: feeCents, actualStampCents: stampCents };
    }
  }
  // No itemised breakdown → the reported charge is the combined transfer cost.
  const raw = data.fee ?? data.fees ?? data.fee_charged;
  if (raw === undefined || raw === null) return null;
  const fee = Number(raw);
  if (!Number.isInteger(fee) || fee < 0) return null;
  return { actualFeeCents: fee, actualStampCents: 0 };
}

export type PaystackOrganiserLeg = {
  legId: string;
  chunkIndex: number;
  principalCents: number;
  estimatedFeeCents: number;
  stampDutyCents: number;
  status: string;
  providerReference: string | null;
  providerTransferCode: string | null;
  attemptCount: number;
};

export type PaystackReleaseCandidate = {
  release_id: string;
  brand_id: string;
  recipient_code: string;
  currency: string;
  organiser_legs: PaystackOrganiserLeg[];
  partner_ceiling_kobo: number;
};

export type PaystackLegOutcome =
  | "in_flight"
  | "succeeded"
  | "otp"
  | "blocked_balance"
  | "retryable_error"
  | "definitive_error";

export type PaystackReleaseDeps = {
  getBalanceNgnKobo: () => Promise<number>;
  fetchTransfer: (transferCode: string) => Promise<Record<string, unknown>>;
  verifyTransferByReference: (
    reference: string,
  ) => Promise<Record<string, unknown>>;
  authorize: () => Promise<boolean>;
  initiateTransfer: (input: {
    amountSubunits: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }) => Promise<Record<string, unknown>>;
  recordLegOutcome: (input: {
    legId: string;
    outcome: PaystackLegOutcome;
    transferCode: string | null;
    reference: string | null;
    error: string | null;
  }) => Promise<void>;
  reconcileLegFee: (input: {
    legId: string;
    actualFeeCents: number | null;
    actualStampCents: number | null;
  }) => Promise<void>;
  reverseLeg: (
    input: { legId: string; returnedPrincipalCents: number },
  ) => Promise<void>;
};

export type PaystackReleaseCounts = {
  reconciled: number;
  initiated: number;
  succeeded: number;
  inFlight: number;
  blockedBalance: number;
  blockedOtp: number;
  feeUnreconciled: number;
  retryable: number;
  definitive: number;
  reversed: number;
};

const emptyCounts = (): PaystackReleaseCounts => ({
  reconciled: 0,
  initiated: 0,
  succeeded: 0,
  inFlight: 0,
  blockedBalance: 0,
  blockedOtp: 0,
  feeUnreconciled: 0,
  retryable: 0,
  definitive: 0,
  reversed: 0,
});

const legMayInitiate = (status: string): boolean =>
  status === "planned" || status === "in_flight" ||
  status === "fee_unreconciled";

const legIsReconcilable = (leg: PaystackOrganiserLeg): boolean =>
  (leg.status === "in_flight" || leg.status === "fee_unreconciled") &&
  (leg.providerTransferCode !== null || leg.providerReference !== null);

/**
 * Apply a reconciled/initiated transfer object to a leg. Returns whether the leg
 * remains eligible for an initiate THIS sweep (`initiate`) — false for any leg
 * that is settled or still genuinely in-flight at Paystack, so a leg that
 * Paystack reports as pending is NEVER re-initiated (no double-pay).
 */
async function settleTransferData(
  leg: PaystackOrganiserLeg,
  data: Record<string, unknown>,
  deps: PaystackReleaseDeps,
  counts: PaystackReleaseCounts,
): Promise<{ initiate: boolean; stopRail: boolean }> {
  const bucket = mapPaystackTransferStatus(data.status);
  const transferCode = typeof data.transfer_code === "string"
    ? data.transfer_code
    : leg.providerTransferCode;
  const reference = typeof data.reference === "string"
    ? data.reference
    : leg.providerReference;
  if (bucket === "success") {
    await deps.recordLegOutcome({
      legId: leg.legId,
      outcome: "succeeded",
      transferCode,
      reference,
      error: null,
    });
    const cost = parsePaystackTransferCost(data);
    await deps.reconcileLegFee({
      legId: leg.legId,
      actualFeeCents: cost?.actualFeeCents ?? null,
      actualStampCents: cost?.actualStampCents ?? null,
    });
    if (cost) counts.succeeded += 1;
    else counts.feeUnreconciled += 1;
    return { initiate: false, stopRail: false };
  }
  if (bucket === "reversed") {
    // #1219 — credit ONLY what Paystack actually returned. `data` here is the
    // authoritative fetch/verify object (reconcile-by-fetch), so its amount is
    // Paystack's truth. When it is missing/invalid we credit 0 — mirroring the
    // webhook (paystackOrganiserRelease.ts) so the two paths agree — and NEVER
    // fabricate the full leg principal. A 0 credit still marks the leg reversed;
    // if the SQL is called with NULL it parks + alerts (reversal_unreconciled).
    const amount = Number(data.amount);
    const returned = Number.isInteger(amount) && amount > 0 ? amount : 0;
    await deps.reverseLeg({ legId: leg.legId, returnedPrincipalCents: returned });
    counts.reversed += 1;
    return { initiate: false, stopRail: false };
  }
  if (bucket === "failed") {
    await deps.recordLegOutcome({
      legId: leg.legId,
      outcome: "definitive_error",
      transferCode,
      reference,
      error: typeof data.reason === "string" ? data.reason : "transfer.failed",
    });
    counts.definitive += 1;
    return { initiate: false, stopRail: false };
  }
  if (bucket === "otp") {
    await deps.recordLegOutcome({
      legId: leg.legId,
      outcome: "otp",
      transferCode,
      reference,
      error: "otp_required",
    });
    counts.blockedOtp += 1;
    return { initiate: false, stopRail: true };
  }
  // pending / queued / processing — genuinely in flight at Paystack; never
  // re-initiate (that is the #1030 double-pay seam).
  counts.inFlight += 1;
  return { initiate: false, stopRail: false };
}

/**
 * Execute one claimed Paystack organiser release (SPEC §4.2 #4 / §4.5) —
 * dependency-injected, mirroring executeStripeRelease so it is unit-testable.
 * Order is BINDING and structurally enforced by tests:
 *   1. reconcile-first (fetch by code, else verify by reference) — the #1030 fix
 *      so a lost initiate response is resolved by READING Paystack, never a
 *      blind re-initiate;
 *   2. main-balance ceiling check (principal + fee + stamp of organiser + partner);
 *   3. authorize (re-anchor / cancellation guard) immediately before initiate;
 *   4. initiate each un-succeeded chunk oldest-first with a stable reference.
 */
export async function executePaystackRelease(
  candidate: PaystackReleaseCandidate,
  deps: PaystackReleaseDeps,
): Promise<PaystackReleaseCounts> {
  const counts = emptyCounts();
  const legs = [...candidate.organiser_legs].sort(
    (a, b) => a.chunkIndex - b.chunkIndex,
  );
  const eligible = new Set<string>();
  let stopRail = false;

  // 1. Reconcile-first — BEFORE any initiate (#1030 / I-PROPOSED-1177-VERIFY-
  // BEFORE-INITIATE). A leg carrying a transfer code reconciles by code; a leg
  // that has a reference but NO code (initiate response was lost) reconciles by
  // reference. This guarantees a lost initiate response can never double-pay.
  for (const leg of legs) {
    if (!legMayInitiate(leg.status)) continue; // succeeded/failed/reversed: done
    if (!legIsReconcilable(leg)) {
      // Never carried a code/reference (freshly planned) — safe to initiate.
      eligible.add(leg.legId);
      continue;
    }
    counts.reconciled += 1;
    try {
      const data = leg.providerTransferCode
        ? await deps.fetchTransfer(leg.providerTransferCode)
        : await deps.verifyTransferByReference(leg.providerReference as string);
      const outcome = await settleTransferData(leg, data, deps, counts);
      if (outcome.stopRail) stopRail = true;
      // If not settled and not in-flight, settleTransferData returns
      // initiate:false — we do NOT initiate a leg Paystack is still processing.
    } catch (error) {
      const classified = classifyPaystackTransferError(error);
      if (classified.kind === "definitive") {
        // The transfer for this reference/code does not exist (e.g. 404): the
        // initiate never processed, so re-initiating with the SAME reference is
        // money-safe (Paystack reference-idempotency returns the original if it
        // ever existed).
        eligible.add(leg.legId);
      } else {
        // Transient reconcile failure — outcome unknown; do NOT initiate this
        // sweep. Resolve on the next sweep.
        counts.retryable += 1;
      }
    }
  }

  if (stopRail || eligible.size === 0) return counts;

  const pending = legs.filter((leg) => eligible.has(leg.legId));

  // 2. Ceiling check (CEILING-ONLY — never a release amount). Sum the remaining
  // un-succeeded organiser debit plus the release's partner legs.
  const ceiling = paystackReleaseCeilingKobo(
    pending.map((leg) => ({
      principalCents: leg.principalCents,
      estimatedFeeCents: leg.estimatedFeeCents,
      stampDutyCents: leg.stampDutyCents,
    })),
    candidate.partner_ceiling_kobo,
  );
  const balance = await deps.getBalanceNgnKobo();
  if (balance < ceiling) {
    await deps.recordLegOutcome({
      legId: pending[0].legId,
      outcome: "blocked_balance",
      transferCode: null,
      reference: null,
      error: "paystack_balance_below_release_ceiling",
    });
    counts.blockedBalance += 1;
    return counts;
  }

  // 3. Authorize (re-anchor / cancellation guard) immediately before initiate.
  const authorized = await deps.authorize();
  if (!authorized) return counts;

  // 4. Initiate each remaining chunk oldest-first with a stable reference.
  for (const leg of pending) {
    const reference = buildOrganiserTransferReference(
      candidate.release_id,
      leg.chunkIndex,
      leg.attemptCount,
    );
    try {
      const result = await deps.initiateTransfer({
        amountSubunits: leg.principalCents,
        recipientCode: candidate.recipient_code,
        reference,
        reason: `Mingla organiser payout ${candidate.release_id}`,
      });
      counts.initiated += 1;
      const bucket = mapPaystackTransferStatus(result.status);
      const transferCode = typeof result.transfer_code === "string"
        ? result.transfer_code
        : null;
      if (bucket === "success") {
        await deps.recordLegOutcome({
          legId: leg.legId,
          outcome: "succeeded",
          transferCode,
          reference,
          error: null,
        });
        const cost = parsePaystackTransferCost(result);
        await deps.reconcileLegFee({
          legId: leg.legId,
          actualFeeCents: cost?.actualFeeCents ?? null,
          actualStampCents: cost?.actualStampCents ?? null,
        });
        if (cost) counts.succeeded += 1;
        else counts.feeUnreconciled += 1;
      } else if (bucket === "otp") {
        // OTP blocks the whole rail; stop initiating further chunks.
        await deps.recordLegOutcome({
          legId: leg.legId,
          outcome: "otp",
          transferCode,
          reference,
          error: "otp_required",
        });
        counts.blockedOtp += 1;
        break;
      } else if (bucket === "reversed") {
        // #1219 — credit ONLY what Paystack returned; 0 when absent (mirror the
        // webhook), never the fabricated full leg principal.
        const amount = Number(result.amount);
        await deps.reverseLeg({
          legId: leg.legId,
          returnedPrincipalCents: Number.isInteger(amount) && amount > 0
            ? amount
            : 0,
        });
        counts.reversed += 1;
      } else if (bucket === "failed") {
        await deps.recordLegOutcome({
          legId: leg.legId,
          outcome: "definitive_error",
          transferCode,
          reference,
          error: typeof result.reason === "string"
            ? result.reason
            : "transfer_failed",
        });
        counts.definitive += 1;
      } else {
        // pending / queued — settle via webhook or next-sweep reconcile.
        await deps.recordLegOutcome({
          legId: leg.legId,
          outcome: "in_flight",
          transferCode,
          reference,
          error: null,
        });
        counts.inFlight += 1;
      }
    } catch (error) {
      const classified = classifyPaystackTransferError(error);
      if (classified.kind === "retryable") {
        // Ambiguous / operational — same reference next sweep (no attempt bump);
        // reconcile-first will resolve any transfer that actually went through.
        await deps.recordLegOutcome({
          legId: leg.legId,
          outcome: "retryable_error",
          transferCode: null,
          reference,
          error: classified.message,
        });
        counts.retryable += 1;
      } else {
        await deps.recordLegOutcome({
          legId: leg.legId,
          outcome: "definitive_error",
          transferCode: null,
          reference,
          error: classified.message,
        });
        counts.definitive += 1;
      }
    }
  }
  return counts;
}
