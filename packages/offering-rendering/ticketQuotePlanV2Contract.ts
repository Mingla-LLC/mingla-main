/** issue #4522 — strict client decoder for the database-owned v2 quote. */

export type TicketQuotePlanV2Availability =
  | "plan"
  | "full_deposit"
  | "full_window"
  | "full_only"
  | "closed";

export interface TicketQuotePlanV2Installment {
  ordinal: number;
  pct: number;
  amountCents: number;
  dueAt: string;
  addonPortionCents: number;
  sourceTicketTypeId: string;
}

export interface TicketQuotePlanV2Schedule {
  fullPriceCents: number;
  depositCents: number;
  currency: string;
  planVersion: 2;
  availability: "plan";
  countOffered: number;
  countGiven: number;
  finalDueAt: string;
  installments: TicketQuotePlanV2Installment[];
}

export interface TicketQuotePlanV2 {
  availability: TicketQuotePlanV2Availability;
  countOffered: number;
  countGiven: number;
  finalDueAt: string | null;
  installmentSchedule: TicketQuotePlanV2Schedule | null;
}

export function decodeTicketQuoteAddOnPaymentMode(
  value: unknown,
): "today" | "spread" | undefined {
  return value === "today" || value === "spread" ? value : undefined;
}

/**
 * The quote's `addonPaymentMode` field as sent on the wire: the SQL emits JSON
 * null whenever the v2 cart has no add-on choice, and older bodies omit it.
 * Both mean "no choice"; any other non-null value is refused (fail closed).
 */
export type TicketQuoteAddOnPaymentModeField =
  | { ok: true; mode: "today" | "spread" | undefined }
  | { ok: false };

export function readTicketQuoteAddOnPaymentModeField(
  value: unknown,
): TicketQuoteAddOnPaymentModeField {
  if (value === undefined || value === null) return { ok: true, mode: undefined };
  const mode = decodeTicketQuoteAddOnPaymentMode(value);
  return mode === undefined ? { ok: false } : { ok: true, mode };
}

const AVAILABILITIES: ReadonlySet<string> = new Set([
  "plan",
  "full_deposit",
  "full_window",
  "full_only",
  "closed",
]);

const nonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0;

/** Malformed or contradictory server truth stays unavailable. */
export function decodeTicketQuotePlanV2(
  value: unknown,
): TicketQuotePlanV2 | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.availability !== "string" ||
    !AVAILABILITIES.has(row.availability) ||
    !nonNegativeInteger(row.countOffered) ||
    !nonNegativeInteger(row.countGiven) ||
    (row.finalDueAt !== null &&
      (typeof row.finalDueAt !== "string" ||
        !Number.isFinite(Date.parse(row.finalDueAt))))
  )
    return undefined;

  const availability = row.availability as TicketQuotePlanV2Availability;
  if (row.installmentSchedule === null) {
    if (
      availability === "plan" ||
      Number(row.countGiven) !== 0 ||
      row.finalDueAt !== null
    )
      return undefined;
    return {
      availability,
      countOffered: Number(row.countOffered),
      countGiven: Number(row.countGiven),
      finalDueAt: row.finalDueAt as string | null,
      installmentSchedule: null,
    };
  }
  if (
    availability !== "plan" ||
    typeof row.installmentSchedule !== "object" ||
    Array.isArray(row.installmentSchedule)
  )
    return undefined;

  const schedule = row.installmentSchedule as Record<string, unknown>;
  if (
    !nonNegativeInteger(schedule.fullPriceCents) ||
    !nonNegativeInteger(schedule.depositCents) ||
    typeof schedule.currency !== "string" ||
    !/^[A-Za-z]{3}$/.test(schedule.currency) ||
    schedule.planVersion !== 2 ||
    schedule.availability !== "plan" ||
    !nonNegativeInteger(schedule.countOffered) ||
    !nonNegativeInteger(schedule.countGiven) ||
    Number(schedule.countGiven) < 1 ||
    Number(schedule.countGiven) > Number(schedule.countOffered) ||
    typeof schedule.finalDueAt !== "string" ||
    !Number.isFinite(Date.parse(schedule.finalDueAt)) ||
    !Array.isArray(schedule.installments) ||
    schedule.installments.length === 0
  )
    return undefined;

  const installments: TicketQuotePlanV2Installment[] = [];
  const ordinals = new Set<number>();
  for (const candidate of schedule.installments) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    )
      return undefined;
    const installment = candidate as Record<string, unknown>;
    if (
      !Number.isInteger(installment.ordinal) ||
      Number(installment.ordinal) < 1 ||
      ordinals.has(Number(installment.ordinal)) ||
      typeof installment.pct !== "number" ||
      !Number.isFinite(installment.pct) ||
      installment.pct < 0 ||
      !nonNegativeInteger(installment.amountCents) ||
      Number(installment.amountCents) < 1 ||
      typeof installment.dueAt !== "string" ||
      !Number.isFinite(Date.parse(installment.dueAt)) ||
      !nonNegativeInteger(installment.addonPortionCents) ||
      Number(installment.addonPortionCents) >
        Number(installment.amountCents) ||
      typeof installment.sourceTicketTypeId !== "string" ||
      installment.sourceTicketTypeId.length === 0
    )
      return undefined;
    ordinals.add(Number(installment.ordinal));
    installments.push({
      ordinal: Number(installment.ordinal),
      pct: installment.pct,
      amountCents: Number(installment.amountCents),
      dueAt: installment.dueAt,
      addonPortionCents: Number(installment.addonPortionCents),
      sourceTicketTypeId: installment.sourceTicketTypeId,
    });
  }
  installments.sort((a, b) => a.ordinal - b.ordinal);
  if (
    installments.some((installment, index) => installment.ordinal !== index + 1) ||
    installments[installments.length - 1]?.dueAt !== schedule.finalDueAt ||
    Number(schedule.depositCents) +
        installments.reduce((sum, installment) => sum + installment.amountCents, 0) !==
      Number(schedule.fullPriceCents)
  )
    return undefined;
  const decodedSchedule: TicketQuotePlanV2Schedule = {
    fullPriceCents: Number(schedule.fullPriceCents),
    depositCents: Number(schedule.depositCents),
    currency: schedule.currency.toUpperCase(),
    planVersion: 2,
    availability: "plan",
    countOffered: Number(schedule.countOffered),
    countGiven: Number(schedule.countGiven),
    finalDueAt: schedule.finalDueAt,
    installments,
  };
  if (
    decodedSchedule.countOffered !== Number(row.countOffered) ||
    decodedSchedule.countGiven !== Number(row.countGiven) ||
    decodedSchedule.finalDueAt !== row.finalDueAt
  )
    return undefined;
  return {
    availability,
    countOffered: Number(row.countOffered),
    countGiven: Number(row.countGiven),
    finalDueAt: row.finalDueAt as string,
    installmentSchedule: decodedSchedule,
  };
}
