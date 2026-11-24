/**
 * #4490 spec 08 O5 part B — the daily close, the cash drawer, the day export
 * and Settings › Selling in person (edge function `venue-till`, its O5 part B
 * actions). Every number here is the server's: the client sends only the
 * counted cash, a float or paid-out amount, a reason, and a request id for
 * anything that may be retried. A close is a snapshot; money that lands later
 * for a closed day comes back as its late list.
 */

import { tillAction } from "./venueTillService";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type DayPersonKind = "person" | "device" | "mingla_support" | "system";

export interface DayPerson {
  userId: string | null;
  kind: DayPersonKind;
  name: string | null;
}

export interface DayPersonTotals extends DayPerson {
  salesCount: number;
  salesMinor: number;
  tipsTakenMinor: number;
  cashTakenMinor: number;
  tipsServedMinor: number;
  refundCount: number;
  refundMinor: number;
  voidCount: number;
  voidMinor: number;
}

export interface DayMethodRow {
  method: string;
  count: number;
  amountMinor: number;
  tipMinor: number;
}

export interface DayCountAmount {
  count: number;
  amountMinor: number;
}

export interface DayTotals {
  currency: string;
  takings: { count: number; amountMinor: number; tipMinor: number; serviceChargeMinor: number; guestFeesMinor: number };
  byMethod: DayMethodRow[];
  people: DayPersonTotals[];
  tipsByServer: DayPersonTotals[];
  tipsOtherMinor: number;
  refunds: DayCountAmount & { tipMinor: number; byMethod: DayMethodRow[] };
  voids: DayCountAmount;
  serviceChargeMinor: number;
  net: { takingsMinor: number; tipMinor: number };
  depositsUsed: DayCountAmount;
  depositRefunded: DayCountAmount;
  orderedOnline: DayCountAmount;
  door: DayCountAmount & { byMethod: DayMethodRow[] };
  categories: { bookingsMinor: number; onOpenChecksMinor: number; foodAndDrinkMinor: number };
  card: { chargedMinor: number; minglaFeesMinor: number; refundedMinor: number; toBankMinor: number };
  cash: {
    floatMinor: number;
    floatSetAtLocal: string | null;
    cashPaymentsMinor: number;
    cashTipsMinor: number;
    doorCashMinor: number;
    cashRefundsMinor: number;
    paidOutMinor: number;
    paidOuts: Array<{ id: string; amountMinor: number; note: string; atLocal: string }>;
    expectedMinor: number;
  };
  paidInToday: { paidInMinor: number; atVenueMinor: number; onlineMinor: number } | null;
  reconciles: boolean;
}

export interface DayOpenCheck {
  saleId: string;
  label: string | null;
  server: DayPerson;
  ageMinutes: number;
  dueMinor: number;
  state: string;
  version: number;
  waitingForScan: boolean;
  carriedPast: string | null;
  blocks: boolean;
}

export interface DayLatePayment {
  paymentId: string;
  method: string;
  amountMinor: number;
  tipMinor: number;
  paidAtLocal: string;
  checkLabel: string | null;
  /** #4490 08-O5 fix 4: who took the payment (null from a server before it). */
  takenBy: DayPerson | null;
}

export interface DayClose {
  closedAtLocal: string | null;
  closedBy: DayPerson | null;
  cashCountedMinor: number | null;
  cashExpectedMinor: number | null;
  differenceMinor: number | null;
  reopenCount: number;
  canReopen: boolean;
}

export interface DayHistoryEntry {
  closedAtLocal: string | null;
  reopenedAtLocal: string | null;
  reopenedBy: DayPerson | null;
  reason: string;
  differenceMinor: number | null;
  takingsMinor: number | null;
}

export type DayState = "open" | "closed" | "reopened";

export interface DaySummary {
  venueId: string;
  venueName: string;
  businessDate: string;
  today: string;
  timezone: string;
  currency: string;
  state: DayState;
  close: DayClose | null;
  totals: DayTotals;
  late: { count: number; amountMinor: number; tipMinor: number; payments: DayLatePayment[]; refundCount: number; refundMinor: number };
  openChecks: DayOpenCheck[];
  blockingCount: number;
  canClose: boolean;
  history: DayHistoryEntry[];
  replayed: boolean;
}

function mapPerson(v: unknown): DayPerson {
  const r = obj(v);
  const kind = str(r.kind);
  return {
    userId: strOrNull(r.userId),
    kind: kind === "device" || kind === "mingla_support" || kind === "system" ? kind : "person",
    name: strOrNull(r.name),
  };
}

function mapPersonTotals(v: unknown): DayPersonTotals {
  const r = obj(v);
  return {
    ...mapPerson(r),
    salesCount: num(r.salesCount),
    salesMinor: num(r.salesMinor),
    tipsTakenMinor: num(r.tipsTakenMinor),
    cashTakenMinor: num(r.cashTakenMinor),
    tipsServedMinor: num(r.tipsServedMinor),
    refundCount: num(r.refundCount),
    refundMinor: num(r.refundMinor),
    voidCount: num(r.voidCount),
    voidMinor: num(r.voidMinor),
  };
}

function mapMethod(v: unknown): DayMethodRow {
  const r = obj(v);
  return { method: str(r.method), count: num(r.count), amountMinor: num(r.amountMinor), tipMinor: num(r.tipMinor) };
}

function mapCountAmount(v: unknown): DayCountAmount {
  const r = obj(v);
  return { count: num(r.count), amountMinor: num(r.amountMinor) };
}

export function mapDayTotals(v: unknown): DayTotals {
  const t = obj(v);
  const takings = obj(t.takings);
  const refunds = obj(t.refunds);
  const door = obj(t.door);
  const categories = obj(t.categories);
  const card = obj(t.card);
  const cash = obj(t.cash);
  const net = obj(t.net);
  const paidIn = obj(t.paidInToday);
  const paidInParts = obj(paidIn.paidIn);
  const reconcile = obj(t.reconcile);
  return {
    currency: str(t.currency, "NGN"),
    takings: {
      count: num(takings.count),
      amountMinor: num(takings.amountMinor),
      tipMinor: num(takings.tipMinor),
      serviceChargeMinor: num(takings.serviceChargeMinor),
      guestFeesMinor: num(takings.guestFeesMinor),
    },
    byMethod: arr(t.byMethod).map(mapMethod),
    people: arr(t.people).map(mapPersonTotals),
    tipsByServer: arr(t.tipsByServer).map(mapPersonTotals),
    tipsOtherMinor: num(t.tipsOtherMinor),
    refunds: { ...mapCountAmount(refunds), tipMinor: num(refunds.tipMinor), byMethod: arr(refunds.byMethod).map(mapMethod) },
    voids: mapCountAmount(t.voids),
    serviceChargeMinor: num(t.serviceChargeMinor),
    net: { takingsMinor: num(net.takingsMinor), tipMinor: num(net.tipMinor) },
    depositsUsed: mapCountAmount(t.depositsUsed),
    depositRefunded: mapCountAmount(t.depositRefunded),
    orderedOnline: mapCountAmount(t.orderedOnline),
    door: { ...mapCountAmount(door), byMethod: arr(door.byMethod).map(mapMethod) },
    categories: {
      bookingsMinor: num(categories.bookingsMinor),
      onOpenChecksMinor: num(categories.onOpenChecksMinor),
      foodAndDrinkMinor: num(categories.foodAndDrinkMinor),
    },
    card: {
      chargedMinor: num(card.chargedMinor),
      minglaFeesMinor: num(card.minglaFeesMinor),
      refundedMinor: num(card.refundedMinor),
      toBankMinor: num(card.toBankMinor),
    },
    cash: {
      floatMinor: num(cash.floatMinor),
      floatSetAtLocal: strOrNull(cash.floatSetAtLocal),
      cashPaymentsMinor: num(cash.cashPaymentsMinor),
      cashTipsMinor: num(cash.cashTipsMinor),
      doorCashMinor: num(cash.doorCashMinor),
      cashRefundsMinor: num(cash.cashRefundsMinor),
      paidOutMinor: num(cash.paidOutMinor),
      paidOuts: arr(cash.paidOuts).map((p) => {
        const r = obj(p);
        return { id: str(r.id), amountMinor: num(r.amountMinor), note: str(r.note), atLocal: str(r.atLocal) };
      }),
      expectedMinor: num(cash.expectedMinor),
    },
    paidInToday: Object.keys(paidIn).length === 0 ? null : {
      paidInMinor: num(paidIn.paidInMinor),
      atVenueMinor: num(paidInParts.atVenue),
      onlineMinor: num(paidInParts.online),
    },
    reconciles: reconcile.byMethodMatches === true && reconcile.byPersonMatches === true
      && reconcile.atVenueMatches === true && reconcile.onlineMatches === true,
  };
}

export function mapDaySummary(v: unknown): DaySummary {
  const r = obj(v);
  const close = r.close === null || r.close === undefined ? null : obj(r.close);
  const late = obj(r.late);
  const state = str(r.state);
  return {
    venueId: str(r.venueId),
    venueName: str(r.venueName),
    businessDate: str(r.businessDate),
    today: str(r.today),
    timezone: str(r.timezone, "UTC"),
    currency: str(r.currency, "NGN"),
    state: state === "closed" || state === "reopened" ? state : "open",
    close: close === null ? null : {
      closedAtLocal: strOrNull(close.closedAtLocal),
      closedBy: close.closedBy ? mapPerson(close.closedBy) : null,
      cashCountedMinor: numOrNull(close.cashCountedMinor),
      cashExpectedMinor: numOrNull(close.cashExpectedMinor),
      differenceMinor: numOrNull(close.differenceMinor),
      reopenCount: num(close.reopenCount),
      canReopen: close.canReopen === true,
    },
    totals: mapDayTotals(r.totals),
    late: {
      count: num(late.count),
      amountMinor: num(late.amountMinor),
      tipMinor: num(late.tipMinor),
      payments: arr(late.payments).map((p) => {
        const x = obj(p);
        return {
          paymentId: str(x.paymentId),
          method: str(x.method),
          amountMinor: num(x.amountMinor),
          tipMinor: num(x.tipMinor),
          paidAtLocal: str(x.paidAtLocal),
          checkLabel: strOrNull(x.checkLabel),
          takenBy: x.takenBy === undefined || x.takenBy === null ? null : mapPerson(x.takenBy),
        };
      }),
      refundCount: num(late.refundCount),
      refundMinor: num(late.refundMinor),
    },
    openChecks: arr(r.openChecks).map((c) => {
      const x = obj(c);
      return {
        saleId: str(x.saleId),
        label: strOrNull(x.checkLabel) ?? strOrNull(x.spotLabel),
        server: mapPerson(x.server),
        ageMinutes: num(x.ageMinutes),
        dueMinor: num(x.dueMinor),
        state: str(x.state),
        version: num(x.version),
        waitingForScan: x.waitingForScan === true,
        carriedPast: strOrNull(x.carriedPast),
        blocks: x.blocks === true,
      };
    }),
    blockingCount: num(r.blockingCount),
    canClose: r.canClose === true,
    history: arr(r.history).map((h) => {
      const x = obj(h);
      return {
        closedAtLocal: strOrNull(x.closedAtLocal),
        reopenedAtLocal: strOrNull(x.reopenedAtLocal),
        reopenedBy: x.reopenedBy ? mapPerson(x.reopenedBy) : null,
        reason: str(x.reason),
        differenceMinor: numOrNull(x.differenceMinor),
        takingsMinor: numOrNull(x.takingsMinor),
      };
    }),
    replayed: r.replayed === true,
  };
}

export interface CashMovement {
  id: string;
  kind: "float" | "paid_out";
  amountMinor: number;
  note: string | null;
  atLocal: string;
  by: DayPerson;
  current: boolean;
}

export interface CashDrawer {
  businessDate: string;
  currency: string;
  floatMinor: number;
  previousFloatMinor: number | null;
  dayClosed: boolean;
  movements: CashMovement[];
}

export function mapCashDrawer(v: unknown): CashDrawer {
  const r = obj(v);
  return {
    businessDate: str(r.businessDate),
    currency: str(r.currency, "NGN"),
    floatMinor: num(r.floatMinor),
    previousFloatMinor: numOrNull(r.previousFloatMinor),
    dayClosed: r.dayClosed === true,
    movements: arr(r.movements).map((m) => {
      const x = obj(m);
      return {
        id: str(x.id),
        kind: x.kind === "paid_out" ? "paid_out" : "float",
        amountMinor: num(x.amountMinor),
        note: strOrNull(x.note),
        atLocal: str(x.atLocal),
        by: mapPerson(x.by),
        current: x.current === true,
      };
    }),
  };
}

export interface DayExportRow {
  paymentId: string;
  reference: string;
  paidAtLocal: string;
  check: string | null;
  method: string;
  amountMinor: number;
  serviceChargeMinor: number;
  tipMinor: number;
  guestFeeMinor: number;
  refundedMinor: number;
  takenBy: DayPerson;
  server: DayPerson;
  paidAfterCancel: boolean;
  late: boolean;
}

export interface DayExport {
  venueName: string;
  businessDate: string;
  currency: string;
  rows: DayExportRow[];
}

export function mapDayExport(v: unknown): DayExport {
  const r = obj(v);
  return {
    venueName: str(r.venueName),
    businessDate: str(r.businessDate),
    currency: str(r.currency, "NGN"),
    rows: arr(r.rows).map((row) => {
      const x = obj(row);
      return {
        paymentId: str(x.paymentId),
        reference: str(x.reference),
        paidAtLocal: str(x.paidAtLocal),
        check: strOrNull(x.check),
        method: str(x.method),
        amountMinor: num(x.amountMinor),
        serviceChargeMinor: num(x.serviceChargeMinor),
        tipMinor: num(x.tipMinor),
        guestFeeMinor: num(x.guestFeeMinor),
        refundedMinor: num(x.refundedMinor),
        takenBy: mapPerson(x.takenBy),
        server: mapPerson(x.server),
        paidAfterCancel: x.paidAfterCancel === true,
        late: x.late === true,
      };
    }),
  };
}

export async function fetchDaySummary(venueId: string, date: string | null): Promise<DaySummary> {
  return mapDaySummary(await tillAction<unknown>({ action: "day_summary", venueId, ...(date ? { date } : {}) }));
}

export async function closeDay(input: {
  venueId: string;
  date: string;
  countedMinor: number;
  clientRequestId: string;
}): Promise<DaySummary> {
  return mapDaySummary(await tillAction<unknown>({ action: "day_close", ...input }));
}

export async function reopenDay(input: { venueId: string; date: string; reason: string }): Promise<DaySummary> {
  return mapDaySummary(await tillAction<unknown>({ action: "day_reopen", ...input }));
}

export async function carryCheckOver(input: { venueId: string; saleId: string; date: string }): Promise<void> {
  await tillAction<unknown>({ action: "day_carry_over", ...input });
}

export async function fetchCashDrawer(venueId: string, date: string): Promise<CashDrawer> {
  return mapCashDrawer(await tillAction<unknown>({ action: "cash_movements", venueId, date }));
}

export async function recordCashMovement(input: {
  venueId: string;
  date: string;
  kind: "float" | "paid_out";
  amountMinor: number;
  note: string | null;
  clientRequestId: string;
}): Promise<CashDrawer> {
  const { note, ...rest } = input;
  return mapCashDrawer(await tillAction<unknown>({ action: "cash_movement", ...rest, ...(note ? { note } : {}) }));
}

export async function fetchDayExport(venueId: string, date: string): Promise<DayExport> {
  return mapDayExport(await tillAction<unknown>({ action: "day_export", venueId, date }));
}

// ---------------------------------------------------------------- settings

export type TillPrintPaper = "a4" | "roll_80" | "roll_58";
export type TillStation = "kitchen" | "bar";

export interface TillSettings {
  venueName: string;
  brandId: string;
  currency: string;
  version: number;
  tipsEnabled: boolean;
  tipBpsOptions: number[];
  autoLockMinutes: number;
  printPaper: TillPrintPaper;
  defaultStation: TillStation;
  targetMinutes: { kitchen: number; bar: number };
  screenStations: TillStation[];
  receiptFooter: string | null;
  serviceChargeBps: number;
  kitchenScreensOn: boolean;
  pastMidnightDays: number;
}

export function mapTillSettings(v: unknown): TillSettings {
  const r = obj(v);
  const target = obj(r.targetMinutes);
  const paper = str(r.printPaper);
  return {
    venueName: str(r.venueName),
    brandId: str(r.brandId),
    currency: str(r.currency, "NGN"),
    version: num(r.version),
    tipsEnabled: r.tipsEnabled !== false,
    tipBpsOptions: arr(r.tipBpsOptions).filter((x): x is number => typeof x === "number"),
    autoLockMinutes: num(r.autoLockMinutes, 2),
    printPaper: paper === "roll_80" || paper === "roll_58" ? paper : "a4",
    defaultStation: r.defaultStation === "bar" ? "bar" : "kitchen",
    targetMinutes: { kitchen: num(target.kitchen, 15), bar: num(target.bar, 5) },
    screenStations: arr(r.screenStations).filter((x): x is TillStation => x === "kitchen" || x === "bar"),
    receiptFooter: strOrNull(r.receiptFooter),
    serviceChargeBps: num(r.serviceChargeBps),
    kitchenScreensOn: r.kitchenScreensOn === true,
    pastMidnightDays: num(r.pastMidnightDays),
  };
}

export type TillSettingsPatch = Partial<Pick<TillSettings,
  "tipsEnabled" | "tipBpsOptions" | "autoLockMinutes" | "printPaper" | "defaultStation" | "targetMinutes" |
  "screenStations" | "receiptFooter">>;

export async function fetchTillSettings(venueId: string): Promise<TillSettings> {
  return mapTillSettings(await tillAction<unknown>({ action: "settings_get", venueId }));
}

export async function saveTillSettings(input: {
  venueId: string;
  patch: TillSettingsPatch;
  expectedVersion: number;
}): Promise<TillSettings> {
  return mapTillSettings(await tillAction<unknown>({ action: "settings_set", ...input }));
}
