/**
 * tripPlanV2Math — issue #4522 [trip payment plans v2].
 *
 * DISPLAY-ONLY mirror of `issue_4522_plan_v2_schedule` (migration
 * 20281123034522). The SQL function is the one owner of the money math at
 * checkout; this file lets the host editor preview and buyer surfaces explain a
 * plan before the server quote arrives. A parity test
 * (`__tests__/issue_4522_trip_plan_v2_parity.implementor.test.ts`) runs the
 * spec §6.2 vectors and 200 seeded random cases and must match the pg17 suite's
 * digest of the SQL outputs byte for byte.
 *
 * All amounts are integers in minor units (kobo, cents). Days are calendar days
 * in the trip's time zone; every due instant is 09:00 local.
 *
 * Pure and dependency-free (I-MOR-0827-PACKAGE-ISOLATION).
 */

/** The deposit of a v2 plan. Shared with venue deposits (#4490) by shape. */
export type DepositRule =
  | { mode: "percent"; pct: number }
  | { mode: "amount"; amount_minor: number };

/** `tier_metadata.payment_plan` (v = 2). Amounts are per traveler. */
export interface TripPaymentPlanV2 {
  v: 2;
  deposit: DepositRule;
  count: number;
  final_due_days_before_start: number;
  auto_adjust?: boolean;
  flex?: { enabled: false } | { enabled: true; min_payment_minor: number };
  custom_amounts_minor?: number[] | null;
}

export const TRIP_PLAN_V2_LIMITS = {
  countMin: 1,
  countMax: 12,
  finalDaysMin: 0,
  finalDaysMax: 180,
  defaultFinalDays: 30,
  minGapDays: 7,
  presets: [3, 4, 6],
} as const;

export type TripPlanV2Availability =
  | "plan"
  | "full_deposit"
  | "full_window"
  | "full_only"
  | "closed";

export interface TripPlanV2Row {
  /** ISO instant, `YYYY-MM-DDTHH:MM:SSZ`, 09:00 in the trip time zone. */
  due_at: string;
  amount_minor: number;
  addon_portion_minor: number;
}

export interface TripPlanV2Schedule {
  availability: TripPlanV2Availability;
  /** Everything due at booking: the deposit, today add-ons, or the full total. */
  deposit_minor: number;
  rows: TripPlanV2Row[];
  count_offered: number;
  count_given: number;
  final_due_at: string;
}

export interface TripPlanV2Input {
  lineNetMinor: number;
  units: number;
  plan: TripPaymentPlanV2;
  tripStartAt: Date;
  timeZone: string;
  bookedAt: Date;
  addonTodayMinor?: number;
  addonSpreadMinor?: number;
  /**
   * The line's list total (list unit price × units). Custom amounts are set
   * against the list price; when the net line total is below it (a sale, a
   * discount code) they scale by the trip part's ratio, in whole units.
   */
  lineListMinor?: number | null;
}

/** Raised with the same code the SQL function raises. */
export class TripPlanV2Error extends Error {
  readonly code: "plan_schedule_input_invalid" | "installment_rounding_invalid";
  constructor(code: TripPlanV2Error["code"]) {
    super(code);
    this.code = code;
    this.name = "TripPlanV2Error";
  }
}

const UNIT = 100;
const DAY_MS = 86_400_000;

interface CivilDate {
  y: number;
  m: number;
  d: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatterCache.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
};

/** Wall-clock parts of an instant in a time zone. */
const zonedParts = (
  instantMs: number,
  timeZone: string,
): CivilDate & { h: number; mi: number; s: number } => {
  const parts: Record<string, number> = {};
  for (
    const part of formatterFor(timeZone).formatToParts(new Date(instantMs))
  ) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    y: parts.year,
    m: parts.month,
    d: parts.day,
    h: parts.hour,
    mi: parts.minute,
    s: parts.second,
  };
};

const civilDayNumber = ({ y, m, d }: CivilDate): number =>
  Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

const civilFromDayNumber = (day: number): CivilDate => {
  const date = new Date(day * DAY_MS);
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
};

/** The local calendar day of an instant, as a day number. */
const localDay = (instant: Date, timeZone: string): number =>
  civilDayNumber(zonedParts(instant.getTime(), timeZone));

/** The UTC instant of 09:00 local time on a local day (PostgreSQL semantics). */
const nineAmLocal = (day: number, timeZone: string): number => {
  const civil = civilFromDayNumber(day);
  const wall = Date.UTC(civil.y, civil.m - 1, civil.d, 9, 0, 0);
  const offsetAt = (instantMs: number): number => {
    const p = zonedParts(instantMs, timeZone);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - instantMs;
  };
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return guess;
};

const isoSeconds = (instantMs: number): string =>
  new Date(instantMs).toISOString().replace(/\.\d{3}Z$/, "Z");

const floorDiv = (a: number, b: number): number => Math.floor(a / b);

/**
 * One cart line's schedule, exactly as `issue_4522_plan_v2_schedule` computes
 * it (spec §6.1). Throws TripPlanV2Error with the SQL function's code.
 */
export function computeTripPlanV2Schedule(
  input: TripPlanV2Input,
): TripPlanV2Schedule {
  const p = input.lineNetMinor;
  const units = input.units;
  const addonToday = input.addonTodayMinor ?? 0;
  const addonSpread = input.addonSpreadMinor ?? 0;
  const tz = input.timeZone.length > 0 ? input.timeZone : "UTC";
  if (
    !Number.isInteger(p) || p < 0 || !Number.isInteger(units) || units < 1 ||
    addonToday < 0 || addonSpread < 0
  ) {
    throw new TripPlanV2Error("plan_schedule_input_invalid");
  }
  const plan = input.plan;

  const d0 = plan.deposit.mode === "amount"
    ? Math.min(plan.deposit.amount_minor * units, p)
    : Math.floor((p * plan.deposit.pct) / 100);
  const t = p - d0;
  const count = plan.count;
  const auto = plan.auto_adjust ?? true;
  const fDay = localDay(input.tripStartAt, tz) -
    plan.final_due_days_before_start;
  const finalAt = nineAmLocal(fDay, tz);
  const bDay = localDay(input.bookedAt, tz);
  const days = fDay - bDay;

  let availability: TripPlanV2Availability;
  let n = 0;
  if (t + addonSpread === 0) availability = "full_deposit";
  else if (input.bookedAt.getTime() >= input.tripStartAt.getTime()) {
    availability = "closed";
  } else if (days < 7) availability = "full_window";
  else if (floorDiv(days, 7) < count && !auto) availability = "full_only";
  else {
    availability = "plan";
    n = Math.min(count, floorDiv(days, 7));
  }

  const rows: TripPlanV2Row[] = [];
  let sum = 0;
  if (availability === "plan") {
    let dates: number[] = [];
    for (let i = 1; i <= n; i += 1) {
      dates.push(bDay + floorDiv(2 * i * days + n, 2 * n));
    }
    let trip: number[] = [];
    const custom = plan.custom_amounts_minor;
    if (Array.isArray(custom) && custom.length > 0) {
      let c = custom.map((amount) => amount * units);
      const list = input.lineListMinor ?? null;
      if (list !== null && list > p) {
        const tList = list - (plan.deposit.mode === "amount"
          ? Math.min(plan.deposit.amount_minor * units, list)
          : Math.floor((list * plan.deposit.pct) / 100));
        if (tList > 0) {
          c = c.map((amount) =>
            Math.floor(Number((BigInt(amount) * BigInt(t)) / BigInt(tList)) / UNIT) *
            UNIT
          );
        }
      }
      c.push(t - c.reduce((acc, amount) => acc + amount, 0));
      let fold = 0;
      for (let i = 0; i < count - n + 1; i += 1) fold += c[i];
      trip = [fold, ...c.slice(count - n + 1, count)];
    } else {
      let base = floorDiv(floorDiv(t, n), UNIT) * UNIT;
      while (n > 1 && base === 0) {
        dates = dates.slice(1);
        n -= 1;
        base = floorDiv(floorDiv(t, n), UNIT) * UNIT;
      }
      for (let i = 1; i <= n; i += 1) {
        trip.push(i < n ? base : t - base * (n - 1));
      }
    }
    const abase = floorDiv(floorDiv(addonSpread, n), UNIT) * UNIT;
    let degrade = false;
    for (let i = 0; i < n; i += 1) {
      const addon = i < n - 1 ? abase : addonSpread - abase * (n - 1);
      // Custom rows that cannot hold degrade the line to full_only (as SQL).
      if (trip[i] < 0 || trip[i] + addon <= 0) {
        degrade = true;
        break;
      }
      rows.push({
        due_at: isoSeconds(nineAmLocal(dates[i], tz)),
        amount_minor: trip[i] + addon,
        addon_portion_minor: addon,
      });
      sum += trip[i] + addon;
    }
    if (degrade) {
      availability = "full_only";
      n = 0;
      rows.length = 0;
      sum = 0;
    }
  }

  const deposit = p + addonToday + addonSpread - sum;
  if (availability === "plan" && deposit !== d0 + addonToday) {
    throw new TripPlanV2Error("installment_rounding_invalid");
  }
  return {
    availability,
    deposit_minor: deposit,
    rows,
    count_offered: count,
    count_given: n,
    final_due_at: isoSeconds(finalAt),
  };
}
