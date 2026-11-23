/**
 * #4490 spec 08 O4 — the split sheet's display state. DISPLAY ONLY: every
 * amount the Till sends or records is the server's (issue_4490_till_set_split
 * computes the shares; a share pays exactly its own amount). The previews here
 * use the server's own rules (floor, remainder minor units to the first
 * shares, service charge pro rata to food and drink) so what the sheet shows
 * before "Split" is what the server answers; after "Split" the sheet shows the
 * server's shares, never these.
 */

import type { TillSale, TillShare } from "../../../services/venueTillService";

export const SPLIT_MIN_PEOPLE = 2;
export const SPLIT_MAX_PEOPLE = 20;
/** The quick chips under the amount due (spec 08 §11 A5). */
export const SPLIT_QUICK_WAYS = [2, 3, 4] as const;

/** One thing on the check that can go to a share, with how many units are left. */
export interface SplitUnit {
  /** `i:<orderItemId>` or `l:<lineId>`. */
  key: string;
  ref: { orderItemId: string } | { lineId: string };
  label: string;
  unitsLeft: number;
  /** What the units left are worth before service charge (display). */
  valueLeft: number;
  isFoodAndDrink: boolean;
}

/** Who has what: share index → unit key → units. */
export type SplitAssignment = ReadonlyArray<Readonly<Record<string, number>>>;

const paidShareItemValue = (shares: readonly TillShare[], ref: { orderItemId?: string; lineId?: string }): number =>
  shares
    .filter((s) => s.state === "paid")
    .flatMap((s) => s.items)
    .filter((i) => (ref.orderItemId !== undefined ? i.orderItemId === ref.orderItemId : i.lineId === ref.lineId))
    .reduce((n, i) => n + i.amountMinor, 0);

/** Everything a by-item split must place: the unpaid units on the check. */
export function splitUnits(sale: TillSale | null): SplitUnit[] {
  if (sale === null) return [];
  const out: SplitUnit[] = [];
  for (const line of sale.lines) {
    if (line.state !== "held") continue;
    if (line.kind === "menu_round") {
      for (const item of line.items) {
        if (item.voided) continue;
        const left = item.quantity - (sale.split?.unitsPaid?.[item.id] ?? 0);
        if (left <= 0) continue;
        out.push({
          key: `i:${item.id}`,
          ref: { orderItemId: item.id },
          label: item.name,
          unitsLeft: left,
          valueLeft: item.lineTotalMinor - paidShareItemValue(sale.shares ?? [], { orderItemId: item.id }),
          isFoodAndDrink: true,
        });
      }
    } else if (line.kind !== "deposit_credit") {
      if ((sale.split?.unitsPaid?.[line.id] ?? 0) > 0) continue;
      out.push({
        key: `l:${line.id}`,
        ref: { lineId: line.id },
        label: line.label ?? "",
        unitsLeft: 1,
        valueLeft: line.amountMinor,
        isFoodAndDrink: false,
      });
    }
  }
  return out;
}

/** The shares still to pay, in order; the paid ones after them are history. */
export const openShares = (sale: TillSale | null): TillShare[] =>
  (sale?.shares ?? []).filter((s) => s.state !== "paid");

export const isSplit = (sale: TillSale | null): boolean => openShares(sale).length > 0;

/** Units of a unit already given to shares other than `shareIdx`. */
export function unitsElsewhere(assign: SplitAssignment, key: string, shareIdx: number): number {
  return assign.reduce((n, share, i) => (i === shareIdx ? n : n + (share[key] ?? 0)), 0);
}

export function setUnits(assign: SplitAssignment, shareIdx: number, key: string, units: number): SplitAssignment {
  return assign.map((share, i) => {
    if (i !== shareIdx) return share;
    const next = { ...share };
    if (units <= 0) delete next[key];
    else next[key] = units;
    return next;
  });
}

/** A new assignment for n shares, keeping what the first shares already had. */
export function resizeAssignment(assign: SplitAssignment, n: number): SplitAssignment {
  const next: Array<Readonly<Record<string, number>>> = [];
  for (let i = 0; i < n; i += 1) next.push(assign[i] ?? {});
  return next;
}

/** What is not placed yet (display): units and their value. */
export function unassigned(units: readonly SplitUnit[], assign: SplitAssignment): { units: number; valueMinor: number } {
  let count = 0;
  let value = 0;
  for (const u of units) {
    const given = assign.reduce((n, share) => n + (share[u.key] ?? 0), 0);
    const missing = Math.max(0, u.unitsLeft - given);
    count += missing;
    value += Math.floor((u.valueLeft * missing) / u.unitsLeft);
  }
  return { units: count, valueMinor: value };
}

/** Every unit placed exactly once and every share has something. */
export function assignmentComplete(units: readonly SplitUnit[], assign: SplitAssignment): boolean {
  if (assign.length < SPLIT_MIN_PEOPLE) return false;
  for (const u of units) {
    const given = assign.reduce((n, share) => n + (share[u.key] ?? 0), 0);
    if (given !== u.unitsLeft) return false;
  }
  return assign.every((share) => Object.values(share).some((n) => n > 0));
}

/** The by-item payload the server takes (units only, never an amount). */
export function byItemPayload(
  units: readonly SplitUnit[],
  assign: SplitAssignment,
): Array<{ items: Array<{ orderItemId: string; units: number } | { lineId: string; units: number }> }> {
  return assign.map((share) => ({
    items: units
      .filter((u) => (share[u.key] ?? 0) > 0)
      .map((u) => ({ ...u.ref, units: share[u.key] as number })),
  }));
}

/** Floor split with the remainder minor units on the first parts (the server's rule). */
export function floorSplit(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Preview of an even split: base and service charge each split by the server's rule. */
export function evenPreview(remainingMinor: number, serviceChargeLeftMinor: number, n: number): number[] {
  const sc = Math.min(serviceChargeLeftMinor, remainingMinor);
  const bases = floorSplit(remainingMinor - sc, n);
  const scs = floorSplit(sc, n);
  return bases.map((b, i) => b + (scs[i] as number));
}

/** Preview of a by-item split (complete assignments only; the server's rule). */
export function byItemPreview(units: readonly SplitUnit[], assign: SplitAssignment, serviceChargeLeftMinor: number): number[] {
  const n = assign.length;
  const bases = new Array<number>(n).fill(0);
  const menus = new Array<number>(n).fill(0);
  for (const u of units) {
    let given = 0;
    let first = -1;
    for (let i = 0; i < n; i += 1) {
      const k = assign[i]?.[u.key] ?? 0;
      if (k <= 0) continue;
      const v = Math.floor((u.valueLeft * k) / u.unitsLeft);
      bases[i] = (bases[i] as number) + v;
      if (u.isFoodAndDrink) menus[i] = (menus[i] as number) + v;
      given += v;
      if (first < 0) first = i;
    }
    if (first >= 0) {
      bases[first] = (bases[first] as number) + (u.valueLeft - given);
      if (u.isFoodAndDrink) menus[first] = (menus[first] as number) + (u.valueLeft - given);
    }
  }
  const menuTotal = menus.reduce((a, b) => a + b, 0);
  const scs = menus.map((m) => (menuTotal > 0 ? Math.floor((serviceChargeLeftMinor * m) / menuTotal) : 0));
  scs[0] = (scs[0] ?? 0) + (serviceChargeLeftMinor - scs.reduce((a, b) => a + b, 0));
  return bases.map((b, i) => b + (scs[i] as number));
}

/** The share a payment pays, for the paid step's "Share {n} paid". */
export const shareOf = (sale: TillSale | null, shareId: string | null): TillShare | null =>
  shareId === null ? null : (sale?.shares ?? []).find((s) => s.id === shareId) ?? null;

/**
 * The share's live payment to resume on opening (a scan code or tap for THIS
 * share), mirroring resumeLivePayment for the whole check.
 */
export const shareLivePaymentId = (share: TillShare | null): string | null =>
  share !== null && share.state === "paying" ? share.paymentId : null;
