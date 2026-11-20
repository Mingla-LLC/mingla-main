/**
 * issue #4522 — the #3859 contract path for v2 trip plans.
 *
 * On the contract path the edge used to plan in TypeScript
 * (`computeMultiLineInstallmentPlan`, legacy percent plans only). A package
 * with a v2 plan (`tier_metadata.payment_plan`) is planned by the database
 * instead (`issue_4522_checkout_v2_plan`, booked at the session's creation),
 * so the money math has one owner. The RPC answers NULL while the server switch
 * is off or the cart has no v2 line, and the caller keeps its legacy planner:
 * nothing changes for any checkout until the switch is on.
 */

import type { ComputedScheduledPayment } from "../_shared/installments/computeMultiLineInstallmentPlan.ts";

/** One v2 row, in the legacy row shape plus its spread add-on share. */
export interface TripPlanV2ScheduledPayment extends ComputedScheduledPayment {
  addonPortionCents: number;
}

export interface TripPlanV2ContractPlan {
  /** Net due today (the deposits plus every pay-in-full line). */
  dueTodayCents: number;
  dueTodayListCents: number;
  scheduled: TripPlanV2ScheduledPayment[];
  hasInstallments: boolean;
  /** Top-level schedule facts the buyer surfaces read. */
  summary: {
    planVersion: 2;
    availability: string | null;
    countOffered: number;
    countGiven: number;
    finalDueAt: string | null;
  };
}

/** Thrown when the RPC answers something this edge cannot trust. */
export class TripPlanV2ContractError extends Error {
  constructor() {
    super("checkout_contract_unavailable");
    this.name = "TripPlanV2ContractError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const wholeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

/** True when any selected package carries a v2 plan object. */
export function tierRowsCarryPlanV2(
  rows: ReadonlyArray<{ tier_metadata: unknown }>,
): boolean {
  return rows.some((row) =>
    isRecord(row.tier_metadata) && isRecord(row.tier_metadata.payment_plan)
  );
}

/**
 * Read `issue_4522_checkout_v2_plan`'s answer. NULL => the legacy planner owns
 * this cart. Anything malformed throws, so the caller fails closed.
 */
export function parseTripPlanV2ContractPlan(
  data: unknown,
): TripPlanV2ContractPlan | null {
  if (data === null || data === undefined) return null;
  if (!isRecord(data)) throw new TripPlanV2ContractError();
  const dueTodayNetCents = wholeNumber(data.dueTodayNetCents);
  const dueTodayListCents = wholeNumber(data.dueTodayListCents);
  if (
    dueTodayNetCents === null || dueTodayListCents === null ||
    dueTodayNetCents < 0 || dueTodayListCents < 0
  ) {
    throw new TripPlanV2ContractError();
  }
  const schedule = data.installmentSchedule;
  const scheduled: TripPlanV2ScheduledPayment[] = [];
  if (schedule !== null && schedule !== undefined) {
    if (!isRecord(schedule) || !Array.isArray(schedule.installments)) {
      throw new TripPlanV2ContractError();
    }
    for (const entry of schedule.installments) {
      if (!isRecord(entry)) throw new TripPlanV2ContractError();
      const ordinal = wholeNumber(entry.ordinal);
      const amountCents = wholeNumber(entry.amountCents);
      const addonPortionCents = wholeNumber(entry.addonPortionCents);
      const pct = typeof entry.pct === "number" ? entry.pct : null;
      if (
        ordinal === null || amountCents === null || amountCents <= 0 ||
        addonPortionCents === null || addonPortionCents < 0 || pct === null ||
        typeof entry.dueAt !== "string" ||
        typeof entry.sourceTicketTypeId !== "string"
      ) {
        throw new TripPlanV2ContractError();
      }
      scheduled.push({
        ordinal,
        amountCents,
        pct,
        dueAt: entry.dueAt,
        sourceTicketTypeId: entry.sourceTicketTypeId,
        sourceOrdinal: ordinal,
        addonPortionCents,
      });
    }
  }
  return {
    dueTodayCents: dueTodayNetCents,
    dueTodayListCents,
    scheduled,
    hasInstallments: scheduled.length > 0,
    summary: {
      planVersion: 2,
      availability: typeof data.availability === "string"
        ? data.availability
        : null,
      countOffered: wholeNumber(data.countOffered) ?? 0,
      countGiven: wholeNumber(data.countGiven) ?? 0,
      finalDueAt: typeof data.finalDueAt === "string" ? data.finalDueAt : null,
    },
  };
}
