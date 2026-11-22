/**
 * #4490 spec 08 O1 — pure display state for the Till. No money is decided
 * here: totals, service charge and what is due come from the server. The only
 * sums are for display before a tap (change to give, a tip amount offered as a
 * chip), and the server checks both again.
 */

import type { TillCatalog, TillMenuItem, TillSale } from "../../../services/venueTillService";

export type FloorLayout = "phone" | "tablet" | "desk";

/** Spec 08 §2: phone < 600, tablet 600–1023, desk ≥ 1024, on every platform. */
export function floorLayoutFor(width: number): FloorLayout {
  if (width >= 1024) return "desk";
  if (width >= 600) return "tablet";
  return "phone";
}

/** A line not yet on the check: chosen on this device, priced by the server on add. */
export interface DraftLine {
  key: string;
  menuItemId: string;
  name: string;
  quantity: number;
  modifierIds: string[];
  modifierNames: string[];
  notes: string | null;
  station: string | null;
}

export interface BasketRow {
  key: string;
  kind: "item" | "offer" | "balance";
  label: string;
  detail: string | null;
  quantity: number;
  amountMinor: number;
  sent: boolean;
  voided: boolean;
  /** Void target: a menu item of a round, or a whole Till line. */
  orderItemId: string | null;
  lineId: string | null;
}

/** The check's server lines as rows: one per menu item, one per offer line. */
export function basketRows(sale: TillSale | null): BasketRow[] {
  if (sale === null) return [];
  const rows: BasketRow[] = [];
  for (const line of sale.lines) {
    if (line.kind === "menu_round") {
      const sent = line.sent === true;
      for (const item of line.items) {
        rows.push({
          key: `item:${item.id}`,
          kind: "item",
          label: item.name,
          detail: [...item.modifiers, item.notes].filter((x): x is string => typeof x === "string" && x.length > 0).join(" · ") || null,
          quantity: item.quantity,
          amountMinor: item.lineTotalMinor,
          sent,
          voided: item.voided || line.state === "voided",
          orderItemId: item.id,
          lineId: null,
        });
      }
    } else {
      rows.push({
        key: `line:${line.id}`,
        kind: line.kind === "balance" ? "balance" : "offer",
        label: line.label ?? "",
        detail: null,
        quantity: 1,
        amountMinor: line.amountMinor,
        sent: true,
        voided: line.state === "voided",
        orderItemId: null,
        lineId: line.id,
      });
    }
  }
  return rows;
}

/** The Send button names the one station the unsent lines go to. */
export function sendLabel(
  sale: TillSale | null,
  draft: DraftLine[],
  catalog: TillCatalog | null,
): "kitchen" | "bar" | "both" | null {
  const stations = new Set<string>();
  const stationOf = (menuItemId: string): string => {
    for (const menu of catalog?.menus ?? []) {
      const found = menu.items.find((i) => i.id === menuItemId);
      if (found) return found.station === "bar" ? "bar" : "kitchen";
    }
    return "kitchen";
  };
  for (const d of draft) stations.add(d.station === "bar" ? "bar" : "kitchen");
  for (const line of sale?.lines ?? []) {
    if (line.kind !== "menu_round" || line.sent !== false || line.state === "voided") continue;
    for (const item of line.items) if (!item.voided) stations.add(stationOf(item.menuItemId));
  }
  if (stations.size === 0) return null;
  if (stations.size > 1) return "both";
  return stations.has("bar") ? "bar" : "kitchen";
}

/** Food and drink on the check before service charge (the tip base, §12.2). */
export function foodAndDrinkMinor(sale: TillSale | null): number {
  if (sale === null) return 0;
  let total = 0;
  for (const line of sale.lines) {
    if (line.kind !== "menu_round" || line.state === "voided") continue;
    for (const item of line.items) if (!item.voided) total += item.lineTotalMinor;
  }
  return total;
}

/** Tip chips: "No tip" plus each configured percentage of food and drink. */
export function tipChoices(foodMinor: number, bpsOptions: readonly number[]): Array<{ bps: number; minor: number }> {
  return [{ bps: 0, minor: 0 }, ...bpsOptions.filter((b) => b > 0).map((bps) => ({ bps, minor: Math.round((foodMinor * bps) / 10000) }))];
}

/** Cash presets: exact, then the next round notes (1,000 / 5,000 / 10,000 major units). */
export function cashPresets(dueMinor: number, minorFactor = 100): number[] {
  if (dueMinor <= 0) return [];
  const out = [dueMinor];
  for (const step of [1000, 5000, 10000]) {
    const unit = step * minorFactor;
    const up = Math.ceil(dueMinor / unit) * unit;
    if (!out.includes(up)) out.push(up);
  }
  return out.slice(0, 4);
}

/** Change to give for display; null while the cash given is short. */
export function changeDue(givenMinor: number | null, dueMinor: number, tipMinor: number): number | null {
  if (givenMinor === null) return null;
  const change = givenMinor - dueMinor - tipMinor;
  return change >= 0 ? change : null;
}

/** An item a seller can add now (orderable, priced). */
export function itemSellable(item: TillMenuItem): boolean {
  return item.orderable && item.priceMinor !== null;
}

/** An item that needs the choices sheet first (modifier groups). */
export function itemNeedsChoices(item: TillMenuItem): boolean {
  return item.modifierGroups.some((g) => g.modifiers.length > 0);
}

/** Add one unit of an item to the draft, merging identical choices. */
export function addToDraft(draft: DraftLine[], line: Omit<DraftLine, "key">): DraftLine[] {
  const same = draft.find(
    (d) =>
      d.menuItemId === line.menuItemId &&
      d.notes === line.notes &&
      d.modifierIds.length === line.modifierIds.length &&
      d.modifierIds.every((id) => line.modifierIds.includes(id)),
  );
  if (same) {
    return draft.map((d) => (d === same ? { ...d, quantity: Math.min(99, d.quantity + line.quantity) } : d));
  }
  return [...draft, { ...line, key: `${line.menuItemId}:${draft.length}:${Date.now()}` }];
}

export function setDraftQuantity(draft: DraftLine[], key: string, quantity: number): DraftLine[] {
  if (quantity <= 0) return draft.filter((d) => d.key !== key);
  return draft.map((d) => (d.key === key ? { ...d, quantity: Math.min(99, quantity) } : d));
}

/** Totals read "--" until the server priced every line (rule 9). */
export function totalsReady(sale: TillSale | null, draft: DraftLine[]): boolean {
  return sale !== null && draft.length === 0;
}

/** What Pay can take now: the server's remaining amount. */
export function amountDue(sale: TillSale | null): number | null {
  if (sale === null) return null;
  return sale.remainingMinor;
}

// ------------------------------------------------------------ route params

export interface TillPrefill {
  tab: "menu" | "entry";
  offerId: string | null;
  priceOptionId: string | null;
  count: number | null;
  guestListEntryId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function tillUuid(value: string | string[] | undefined): string | null {
  const raw = one(value);
  return raw !== null && UUID.test(raw) ? raw.toLowerCase() : null;
}

/** Route params → Entry prefill (spec 07 §11 B3); opaque ids only. */
export function tillPrefillFrom(params: Record<string, string | string[] | undefined>): TillPrefill | null {
  const tab = one(params.tab);
  const offerId = tillUuid(params.offer);
  if (tab !== "entry" && offerId === null) return null;
  const count = Number(one(params.count));
  return {
    tab: "entry",
    offerId,
    priceOptionId: tillUuid(params.option),
    count: Number.isInteger(count) && count >= 1 && count <= 50 ? count : null,
    guestListEntryId: tillUuid(params.entry),
  };
}

