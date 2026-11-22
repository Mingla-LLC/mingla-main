/**
 * Issue #4522 — dependency-free buyer balance contract and display math.
 *
 * The database remains authoritative for the per-ticket-line rebalance. This
 * module only previews the aggregate schedule the buyer can already see; a
 * successful payment always refreshes the server-owned schedule.
 */

export interface TripBalanceScheduleRow {
  installmentId: string;
  dueAt: string;
  amountMinor: number;
  addonPortionMinor?: number;
  /** Opaque package/line grouping used only to mirror server rebalance math. */
  planLineId?: string | null;
  status?: string;
}

export interface TripBalanceHistoryRow {
  installmentId: string;
  kind: string;
  status: string;
  amountMinor: number;
  collectedAt?: string | null;
  refundedMinor?: number;
}

export interface TripBalance {
  orderId: string;
  currency: string;
  depositMinor: number;
  paidMinor: number;
  remainingMinor: number;
  totalMinor: number;
  canPayAnyAmount: boolean;
  minPaymentMinor: number | null;
  paymentInFlight: boolean;
  nextPayment: TripBalanceScheduleRow | null;
  openRows: TripBalanceScheduleRow[];
  history: TripBalanceHistoryRow[];
}

export type TripBalanceProvider = "stripe" | "paystack";

export interface TripBalanceView {
  state: "payable" | "paid" | "no_longer_due";
  tripTitle?: string;
  brandName?: string;
  provider?: TripBalanceProvider;
  savedCardLast4?: string;
  balance: TripBalance | null;
}

export type TripBalanceChoice = "minimum" | "next" | "full" | "other";

export interface TripBalanceOption {
  key: TripBalanceChoice;
  label: string;
  amountMinor: number | null;
}

const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function scheduleRow(value: unknown): TripBalanceScheduleRow | null {
  if (
    !record(value) || !text(value.installmentId) || !text(value.dueAt) ||
    !integer(value.amountMinor) || value.amountMinor < 0
  ) return null;
  if (
    value.addonPortionMinor !== undefined &&
    (!integer(value.addonPortionMinor) || value.addonPortionMinor < 0 ||
      value.addonPortionMinor > value.amountMinor)
  ) return null;
  if (
    value.planLineId !== undefined && value.planLineId !== null &&
    !text(value.planLineId)
  ) return null;
  return {
    installmentId: value.installmentId,
    dueAt: value.dueAt,
    amountMinor: value.amountMinor,
    ...(integer(value.addonPortionMinor)
      ? { addonPortionMinor: value.addonPortionMinor }
      : {}),
    ...(value.planLineId === null || text(value.planLineId)
      ? { planLineId: value.planLineId as string | null }
      : {}),
    ...(text(value.status) ? { status: value.status } : {}),
  };
}

function historyRow(value: unknown): TripBalanceHistoryRow | null {
  if (
    !record(value) || !text(value.installmentId) || !text(value.kind) ||
    !text(value.status) || !integer(value.amountMinor) || value.amountMinor < 0
  ) return null;
  return {
    installmentId: value.installmentId,
    kind: value.kind,
    status: value.status,
    amountMinor: value.amountMinor,
    ...(value.collectedAt === null || text(value.collectedAt)
      ? { collectedAt: value.collectedAt as string | null }
      : {}),
    ...(integer(value.refundedMinor) && value.refundedMinor >= 0
      ? { refundedMinor: value.refundedMinor }
      : {}),
  };
}

/** Fail closed at the client boundary; money never becomes a permissive cast. */
export function decodeTripBalance(value: unknown): TripBalance | null {
  if (!record(value)) return null;
  const required = [
    value.depositMinor,
    value.paidMinor,
    value.remainingMinor,
    value.totalMinor,
  ];
  if (
    !text(value.orderId) || !text(value.currency) ||
    value.currency.trim().length === 0 ||
    required.some((entry) => !integer(entry) || entry < 0) ||
    typeof value.canPayAnyAmount !== "boolean" ||
    typeof value.paymentInFlight !== "boolean" ||
    !Array.isArray(value.openRows) || !Array.isArray(value.history)
  ) return null;
  const openRows = value.openRows.map(scheduleRow);
  const history = value.history.map(historyRow);
  if (
    openRows.some((row) => row === null) || history.some((row) => row === null)
  ) {
    return null;
  }
  const nextPayment =
    value.nextPayment === null || value.nextPayment === undefined
      ? null
      : scheduleRow(value.nextPayment);
  if (
    value.nextPayment !== null && value.nextPayment !== undefined &&
    nextPayment === null
  ) {
    return null;
  }
  const minPaymentMinor =
    value.minPaymentMinor === null || value.minPaymentMinor === undefined
      ? null
      : integer(value.minPaymentMinor) && value.minPaymentMinor >= 0
      ? value.minPaymentMinor
      : undefined;
  if (minPaymentMinor === undefined) return null;
  const depositMinor = value.depositMinor as number;
  const paidMinor = value.paidMinor as number;
  const remainingMinor = value.remainingMinor as number;
  const totalMinor = value.totalMinor as number;
  if (
    paidMinor + remainingMinor !== totalMinor ||
    (openRows as TripBalanceScheduleRow[]).reduce(
        (sum, row) => sum + row.amountMinor,
        0,
      ) !== remainingMinor ||
    (value.canPayAnyAmount === true &&
      (minPaymentMinor === null || minPaymentMinor <= 0 ||
        minPaymentMinor > remainingMinor)) ||
    (value.canPayAnyAmount === false && minPaymentMinor !== null) ||
    (nextPayment !== null && nextPayment.amountMinor > remainingMinor)
  ) return null;
  return {
    orderId: value.orderId,
    currency: value.currency.trim().toUpperCase(),
    depositMinor,
    paidMinor,
    remainingMinor,
    totalMinor,
    canPayAnyAmount: value.canPayAnyAmount,
    minPaymentMinor,
    paymentInFlight: value.paymentInFlight,
    nextPayment,
    openRows: openRows as TripBalanceScheduleRow[],
    history: history as TripBalanceHistoryRow[],
  };
}

export function tripBalanceOptions(balance: TripBalance): TripBalanceOption[] {
  const options: TripBalanceOption[] = [];
  if (balance.canPayAnyAmount && balance.minPaymentMinor !== null) {
    options.push({
      key: "minimum",
      label: "Minimum",
      amountMinor: balance.minPaymentMinor,
    });
  }
  if (balance.nextPayment !== null) {
    options.push({
      key: "next",
      label: "Next payment",
      amountMinor: balance.nextPayment.amountMinor,
    });
  }
  options.push({
    key: "full",
    label: "Pay it all",
    amountMinor: balance.remainingMinor,
  });
  if (balance.canPayAnyAmount) {
    options.push({ key: "other", label: "Other amount", amountMinor: null });
  }
  return options;
}

export type TripBalanceAmountResult =
  | { ok: true; amountMinor: number }
  | {
    ok: false;
    error: "empty" | "invalid" | "below_minimum" | "over_balance";
  };

/** Parse a two-decimal buyer input without binary-float money arithmetic. */
export function parseTripBalanceAmount(
  input: string,
  balance: Pick<TripBalance, "remainingMinor" | "minPaymentMinor">,
): TripBalanceAmountResult {
  const normalized = input.trim().replaceAll(",", "");
  if (normalized.length === 0) return { ok: false, error: "empty" };
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (match === null) return { ok: false, error: "invalid" };
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) {
    return { ok: false, error: "invalid" };
  }
  const amountMinor = whole * 100 + fraction;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, error: "invalid" };
  }
  if (amountMinor > balance.remainingMinor) {
    return { ok: false, error: "over_balance" };
  }
  if (
    balance.minPaymentMinor !== null && amountMinor < balance.minPaymentMinor
  ) {
    return { ok: false, error: "below_minimum" };
  }
  return { ok: true, amountMinor };
}

const floorToUnit = (value: number, unit: number): number =>
  Math.floor(value / unit) * unit;

const proportionalFloor = (
  whole: number,
  part: number,
  total: number,
): number =>
  total <= 0 ? 0 : Number((BigInt(whole) * BigInt(part)) / BigInt(total));

/** Combine the server's package rows into the dates a buyer sees. */
export function aggregateTripBalanceSchedule(
  rows: readonly TripBalanceScheduleRow[],
): TripBalanceScheduleRow[] {
  const byDate = new Map<string, TripBalanceScheduleRow[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.dueAt) ?? [];
    bucket.push(row);
    byDate.set(row.dueAt, bucket);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dueAt, bucket]) => ({
      installmentId: bucket.map((row) => row.installmentId).sort().join(":"),
      dueAt,
      amountMinor: bucket.reduce((sum, row) => sum + row.amountMinor, 0),
      addonPortionMinor: bucket.reduce(
        (sum, row) => sum + (row.addonPortionMinor ?? 0),
        0,
      ),
      status: bucket.some((row) => row.status === "failed")
        ? "failed"
        : "scheduled",
    }));
}

/**
 * Buyer-visible preview of issue_4522_rebalance_order. It allocates the
 * payment pro rata across package lines, preserves add-on portions, applies
 * the shared date-drop rule, and then aggregates the per-line result by date.
 */
export function rebalanceTripPlan(
  openRows: readonly TripBalanceScheduleRow[],
  paymentMinor: number,
  minPaymentMinor: number | null,
): TripBalanceScheduleRow[] {
  const rows = [...openRows].sort((a, b) =>
    a.dueAt.localeCompare(b.dueAt) ||
    a.installmentId.localeCompare(b.installmentId)
  );
  const before = rows.reduce((sum, row) => sum + row.amountMinor, 0);
  const paid = Math.min(before, Math.max(0, paymentMinor));
  const remaining = before - paid;
  if (remaining === 0 || rows.length === 0) return [];

  const allDates = [...new Set(rows.map((row) => row.dueAt))].sort();
  let count = allDates.length;
  const minimum = Math.max(0, minPaymentMinor ?? 0);
  while (count > 1 && floorToUnit(remaining / count, 100) < minimum) count -= 1;
  const keptDates = new Set(allDates.slice(allDates.length - count));

  const groups = new Map<string | null, TripBalanceScheduleRow[]>();
  for (const row of rows) {
    const key = row.planLineId ?? null;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });
  // Largest remainder, as issue_4522_begin_flex_payment allocates: each line
  // takes floor(paid × line / before); the leftover minor units go one each
  // to the lines with the largest remainders (ties by line order). A line
  // never takes more than it owes, so every amount allocates exactly.
  const lineTotals = ordered.map(([, group]) =>
    group.reduce((sum, row) => sum + row.amountMinor, 0)
  );
  const bases = lineTotals.map((total) =>
    proportionalFloor(paid, total, before)
  );
  let leftover = paid - bases.reduce((sum, base) => sum + base, 0);
  const byRemainder = lineTotals
    .map((total, index) => ({
      index,
      remainder: before <= 0
        ? BigInt(0)
        : (BigInt(paid) * BigInt(total)) % BigInt(before),
    }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : (a.remainder > b.remainder ? -1 : 1)
    );
  const linePaidByIndex = [...bases];
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    linePaidByIndex[index] += 1;
    leftover -= 1;
  }
  const rebalanced: TripBalanceScheduleRow[] = [];
  ordered.forEach(([, group], groupIndex) => {
    const lineBefore = lineTotals[groupIndex];
    const lineAddonBefore = group.reduce(
      (sum, row) => sum + (row.addonPortionMinor ?? 0),
      0,
    );
    const linePaid = Math.min(linePaidByIndex[groupIndex], lineBefore);
    const addonPaid = proportionalFloor(linePaid, lineAddonBefore, lineBefore);
    const tripRemaining = lineBefore - lineAddonBefore - (linePaid - addonPaid);
    const addonRemaining = lineAddonBefore - addonPaid;
    if (tripRemaining + addonRemaining <= 0) return;

    let kept = group.filter((row) => keptDates.has(row.dueAt));
    if (kept.length === 0) kept = [group[group.length - 1]];
    const tripBase = floorToUnit(tripRemaining / kept.length, 100);
    const addonBase = floorToUnit(addonRemaining / kept.length, 100);
    let tripRun = 0;
    let addonRun = 0;
    kept.forEach((row, index) => {
      const trip = index < kept.length - 1 ? tripBase : tripRemaining - tripRun;
      const addon = index < kept.length - 1
        ? addonBase
        : addonRemaining - addonRun;
      tripRun += trip;
      addonRun += addon;
      rebalanced.push({
        ...row,
        amountMinor: trip + addon,
        addonPortionMinor: addon,
      });
    });
  });
  return aggregateTripBalanceSchedule(rebalanced);
}
