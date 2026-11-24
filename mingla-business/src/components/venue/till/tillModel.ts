/**
 * #4490 spec 08 O1 — pure display state for the Till. No money is decided
 * here: totals, service charge and what is due come from the server. The only
 * sums are for display before a tap (change to give, a tip amount offered as a
 * chip), and the server checks both again.
 */

import type { TillCatalog, TillLine, TillMenuItem, TillSale, TillServer, TillShare } from "../../../services/venueTillService";

// ---------------------------------------------------------------- O3 A2
/** #4490 spec 08 §11 T7: a sent round reads "Not accepted" from this many minutes. */
export const NOT_ACCEPTED_AFTER_MINUTES = 3;

export type RoundKitchenState =
  | { kind: "waiting" }
  | { kind: "not_accepted"; minutes: number }
  | { kind: "accepted" }
  | { kind: "ready"; readyAt: string };

/**
 * What the kitchen says about a sent menu round (T5/T7): ready once every
 * station with lines marked it ready; not accepted from 3 minutes after it was
 * sent; nothing once it was picked up, delivered, voided or never sent.
 */
export function roundKitchenState(line: TillLine, nowMs: number): RoundKitchenState | null {
  if (line.kind !== "menu_round" || line.sentAt === null || line.state === "voided") return null;
  if (line.fulfillmentStatus === "delivered" || line.fulfillmentStatus === "cancelled" || line.fulfillmentStatus === "refunded") return null;
  const tickets = line.stationTickets;
  if (tickets.length > 0 && tickets.every((t) => t.pickedUpAt !== null)) return null;
  if (tickets.length > 0 && tickets.every((t) => t.readyAt !== null)) {
    const latest = tickets.map((t) => t.readyAt as string).sort().slice(-1)[0];
    return { kind: "ready", readyAt: latest };
  }
  if (line.acknowledgedAt !== null) return { kind: "accepted" };
  const sent = Date.parse(line.sentAt);
  const minutes = Number.isFinite(sent) ? Math.max(0, Math.floor((nowMs - sent) / 60_000)) : 0;
  return minutes >= NOT_ACCEPTED_AFTER_MINUTES ? { kind: "not_accepted", minutes } : { kind: "waiting" };
}

/** Rounds with a station ticket on the pass (ready, not picked up). */
export function readyToTakeOut(sale: TillSale | null): Array<{ orderId: string; stations: Array<"kitchen" | "bar"> }> {
  if (sale === null) return [];
  return sale.lines
    .filter((l) => l.kind === "menu_round" && l.orderId !== null && l.sentAt !== null && l.state !== "voided"
      && l.fulfillmentStatus !== "delivered")
    .map((l) => ({
      orderId: l.orderId as string,
      stations: l.stationTickets.filter((t) => t.readyAt !== null && t.pickedUpAt === null).map((t) => t.station),
    }))
    .filter((r) => r.stations.length > 0);
}

/** The oldest sent round nobody accepted for 3 minutes, with a station to print for. */
export function unacceptedRound(
  sale: TillSale | null,
  nowMs: number,
): { orderId: string; station: "kitchen" | "bar"; minutes: number } | null {
  if (sale === null) return null;
  for (const line of sale.lines) {
    const state = roundKitchenState(line, nowMs);
    if (state?.kind === "not_accepted" && line.orderId !== null) {
      const ticket = line.stationTickets.find((t) => t.acceptedAt === null) ?? line.stationTickets[0];
      return { orderId: line.orderId, station: ticket?.station ?? "kitchen", minutes: state.minutes };
    }
  }
  return null;
}

/** "HH:MM" from an instant, on the device clock (the Till is at the venue). */
export function clockTime(iso: string): string {
  const d = new Date(Date.parse(iso));
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Where a check's food goes, for the ready / not accepted banners. */
export function tillDestination(sale: TillSale | null, fallback: string): string {
  if (sale === null) return fallback;
  const pickup = sale.lines.find((l) => l.pickupCode !== null)?.pickupCode ?? null;
  return sale.spotLabel ?? sale.checkLabel ?? (pickup !== null ? `Pickup ${pickup}` : fallback);
}

// Spec 08 §2: phone < 600, tablet 600–1023, desk ≥ 1024, on every platform.
// One owner since O3: src/utils/floorLayout.ts (also used by useFloorLayout).
import type { FloorLayout } from "../../../utils/floorLayout";
export { floorLayoutFor, type FloorLayout } from "../../../utils/floorLayout";

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
  /** 08-O4: "deposit" = a booking's paid deposit (money off); "session" = by the hour. */
  kind: "item" | "offer" | "balance" | "deposit" | "session";
  label: string;
  detail: string | null;
  quantity: number;
  amountMinor: number;
  sent: boolean;
  voided: boolean;
  /** Void target: a menu item of a round, or a whole Till line. */
  orderItemId: string | null;
  lineId: string | null;
  /** The server line's state: held until the check is fully paid. */
  lineState: TillLine["state"];
  /** #4490 O3 A2: the round's kitchen state (sent menu items only). */
  kitchen: RoundKitchenState | null;
  /** #4490 08-O5 fix 1: the menu item of an item row (whether its void can restock). */
  menuItemId?: string | null;
}

/** The check's server lines as rows: one per menu item, one per offer line. */
export function basketRows(sale: TillSale | null, nowMs: number = Date.now()): BasketRow[] {
  if (sale === null) return [];
  const rows: BasketRow[] = [];
  for (const line of sale.lines) {
    if (line.kind === "menu_round") {
      const sent = line.sent === true;
      const kitchen = roundKitchenState(line, nowMs);
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
          lineState: line.state,
          kitchen: item.voided ? null : kitchen,
          menuItemId: item.menuItemId,
        });
      }
    } else {
      rows.push({
        key: `line:${line.id}`,
        kind: line.kind === "balance"
          ? "balance"
          : line.kind === "deposit_credit"
          ? "deposit"
          : line.kind === "by_the_hour"
          ? "session"
          : "offer",
        label: line.label ?? "",
        detail: null,
        quantity: 1,
        // 08-O4 (T12): the deposit is shown as money off the bill.
        amountMinor: line.kind === "deposit_credit" ? -line.amountMinor : line.amountMinor,
        sent: true,
        voided: line.state === "voided",
        orderItemId: null,
        lineId: line.id,
        lineState: line.state,
        kitchen: null,
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

/**
 * #4490 08-O4 fix 2 (O4-B1): what a tip percentage is taken on for THIS
 * payment. Spec 08 §2 pay sheet: a tip percentage is taken on food and drink
 * before service charge; a payment that pays only part of the check (a share,
 * a typed part, what is left after one) tips on its own part of that base.
 * A by-item share: the food and drink it holds. Otherwise: food and drink
 * scaled by this payment's part of the check (so the parts add up to the
 * whole). Display only: the server takes the tip as sent (never more than
 * the payment, spec §4 item 1).
 */
export function tipBaseMinor(sale: TillSale | null, share: TillShare | null, payAmountMinor: number): number {
  if (sale === null) return 0;
  const food = foodAndDrinkMinor(sale);
  if (share !== null && share.mode === "by_item") {
    return share.items.reduce((n, i) => n + (i.orderItemId !== null ? i.amountMinor : 0), 0);
  }
  const amount = share !== null ? share.amountMinor : payAmountMinor;
  if (sale.totalDueMinor <= 0 || amount <= 0) return 0;
  return Math.min(food, Math.round((food * amount) / sale.totalDueMinor));
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

/**
 * An item a seller can add now (orderable, priced). A counted item at 0 is
 * never addable, whatever else the tile says (O5-B2): the count is the
 * server's, read again after every send, void and restock.
 */
export function itemSellable(item: TillMenuItem): boolean {
  return item.orderable && item.priceMinor !== null && item.stockLeft !== 0;
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

/**
 * #4490 08-O4 fix 1 (O4-T2): the table deposit pays the whole bill, so there
 * is nothing to take: the check only needs closing (the server closes it with
 * no payment and refuses if anything is due). Display rule only; the server
 * decides.
 */
export function coveredByCredit(sale: TillSale | null): boolean {
  return sale !== null && sale.state === "open" && !sale.pendingPayment && sale.totalDueMinor === 0
    && sale.paidMinor === 0 && (sale.creditMinor ?? 0) > 0 && sale.subtotalMinor + sale.serviceChargeMinor > 0;
}

/**
 * #4490 08-O5 fix 4: a check that is paid (or refunded or voided) takes no
 * more money and has nothing left to save.
 */
export function checkSettled(sale: TillSale | null): boolean {
  return sale !== null && sale.state !== "open" && sale.state !== "paying";
}

/**
 * #4490 08-O5 fix 4: the Pay button shows only while something is due (or
 * while unsent lines are still to be priced, or a deposit closes the check);
 * a paid check never offers "Pay 0.00". Display rule only; the server decides.
 */
export function payActionShown(sale: TillSale | null, draft: readonly DraftLine[]): boolean {
  if (draft.length > 0) return !checkSettled(sale);
  if (sale === null) return true;
  if (checkSettled(sale)) return false;
  return sale.remainingMinor > 0 || coveredByCredit(sale);
}

/**
 * #4490 08-O5 fix 4: "Save check" saves new lines (or a new check); with
 * nothing changed, or on a paid check, there is nothing to save.
 */
export function saveCheckEnabled(sale: TillSale | null, draft: readonly DraftLine[]): boolean {
  return draft.length > 0 && !checkSettled(sale);
}

/**
 * #4490 08-O4 fix 3 (spec 08 §15): the part of the deposit the bill does not
 * need (it goes back to the guest when the check is finished). Display only.
 */
export function depositExcessMinor(sale: TillSale | null): number {
  if (sale === null) return 0;
  return Math.max((sale.creditMinor ?? 0) - (sale.creditUsedMinor ?? 0), 0);
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


// ---------------------------------------------------------------- receipts

export type ReceiptChannel = "text" | "email" | "both";

const RECEIPT_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Which receipt buttons can send: a valid mobile for Text, an email for Email. */
export function receiptChannelsReady(input: {
  phoneE164: string | null;
  phoneEmpty: boolean;
  email: string;
}): Record<ReceiptChannel, boolean> {
  const email = input.email.trim();
  const emailOk = email.length > 0 && email.length <= 254 && RECEIPT_EMAIL.test(email);
  const phoneOk = !input.phoneEmpty && input.phoneE164 !== null;
  return { text: phoneOk, email: emailOk, both: phoneOk && emailOk };
}

/** Where the receipt phone picker starts: the check's currency country. */
export function receiptPhoneStartCountry(currency: string): string | null {
  switch (currency.toUpperCase()) {
    case "NGN":
      return "NG";
    case "GBP":
      return "GB";
    case "USD":
      return "US";
    case "GHS":
      return "GH";
    case "KES":
      return "KE";
    default:
      return null;
  }
}

// ------------------------------------------------- corrections (O1 fix 1)

/**
 * A row can be voided while the check is open and the row is not final: a
 * part payment does not freeze the check (the server decides who may void a
 * sent item, and closes the check if what was paid then covers the rest).
 */
export function rowCanVoid(sale: TillSale | null, row: BasketRow): boolean {
  return sale !== null && sale.state === "open" && !sale.pendingPayment && !row.voided && row.lineState === "held";
}

/** A paid entry or package line can be refunded in full by money rights. */
export function rowRefundable(row: BasketRow, canManageMoney: boolean): boolean {
  return canManageMoney && row.kind === "offer" && row.lineId !== null && row.lineState === "committed";
}

/**
 * Money taken beyond what the check now costs (kept to refund, never dropped).
 * #4490 08-O1 fix 2 (O1-B2): never more than is still refundable on the
 * check's payments, so once the extra is refunded the banner goes, even if a
 * stale read still carries the old figure.
 */
export function overpaidToRefund(sale: TillSale | null): number {
  if (sale === null || sale.state === "open") return 0;
  const refundable = sale.payments
    .filter((p) => p.state === "paid" || p.state === "partially_refunded")
    // refundedMinor counts the tip too (the server sums amount + tip refunded).
    .reduce((sum, p) => sum + Math.max(0, p.amountMinor + p.tipMinor - p.refundedMinor), 0);
  return Math.max(0, Math.min(sale.overpaidMinor, refundable));
}

export interface MoveTarget {
  id: string;
  label: string;
  /** Another open check sits there: pay or move that one first. */
  busy: boolean;
  current: boolean;
}

/** Tables a check can move to; the one it is on is marked, busy ones can't be picked. */
export function moveTargets(spots: TillCatalog["spots"], sale: TillSale | null): MoveTarget[] {
  return spots.map((spot) => {
    const current = sale !== null && sale.spotId === spot.id;
    return { id: spot.id, label: spot.label, busy: spot.hasCheck && !current, current };
  });
}

/** Who a check can be handed to: everyone who may sell here except whoever serves it now. */
export function handoverChoices(servers: TillServer[], currentServerId: string | null): TillServer[] {
  return servers.filter((s) => s.userId !== currentServerId);
}

/** A person's name as the Till shows it (a fallback when none is on file). */
export function serverName(servers: TillServer[], userId: string | null, fallback: string): string {
  const found = servers.find((s) => s.userId === userId);
  return found?.name ?? fallback;
}

/**
 * #4490 O1 fix 1 (O1-N7) — realtime binds by the VENUE (a primary-key `id=eq.` filter is silently
 * dropped by realtime under RLS: I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME);
 * the handler keeps only this check's rows.
 */
export function tillSaleChangeMatches(payload: unknown, saleId: string): boolean {
  if (payload === null || typeof payload !== "object") return false;
  const row = (payload as { new?: unknown; old?: unknown }).new ?? (payload as { old?: unknown }).old;
  return row !== null && typeof row === "object" && (row as { id?: unknown }).id === saleId;
}

/**
 * #4490 spec 08 O4 (A10): a by-the-hour session's clock on the check, from the
 * server's booked end. Before the end: "{n} min left"; after: "Over by {n} min".
 */
export interface SessionClock {
  lineId: string;
  rootLineId: string;
  unitName: string;
  endsAt: string | null;
  stepMinutes: number;
  minutesLeft: number | null;
  overBy: number | null;
}

export function sessionClocks(sale: TillSale | null, nowMs: number): SessionClock[] {
  if (sale === null) return [];
  // One clock per session (its root line), ending where its last block ends.
  const byRoot = new Map<string, SessionClock>();
  for (const s of sale.hourSessions ?? []) {
    const end = s.endsAt !== null ? Date.parse(s.endsAt) : Number.NaN;
    const current = byRoot.get(s.rootLineId);
    const currentEnd = current?.endsAt != null ? Date.parse(current.endsAt) : Number.NaN;
    if (current !== undefined && !(end > currentEnd)) continue;
    const minutes = Number.isFinite(end) ? Math.round((end - nowMs) / 60000) : null;
    byRoot.set(s.rootLineId, {
      lineId: s.rootLineId,
      rootLineId: s.rootLineId,
      unitName: s.unitName ?? "",
      endsAt: s.endsAt,
      stepMinutes: s.stepMinutes,
      minutesLeft: minutes !== null && minutes >= 0 ? minutes : null,
      overBy: minutes !== null && minutes < 0 ? -minutes : null,
    });
  }
  return [...byRoot.values()];
}

/** "Add 30 min" adds one step of the offer, at least 30 minutes. */
export const extendMinutes = (stepMinutes: number): number =>
  stepMinutes >= 30 ? stepMinutes : Math.ceil(30 / Math.max(1, stepMinutes)) * Math.max(1, stepMinutes);

/** The lengths a session can start with (from the offer's shortest, by its step; at most 8). */
export function sessionLengths(minMinutes: number, maxMinutes: number, stepMinutes: number): number[] {
  const out: number[] = [];
  for (let m = minMinutes; m <= maxMinutes && out.length < 8; m += Math.max(15, stepMinutes)) out.push(m);
  return out;
}

/**
 * #4490 08-O5 fix 1 (O5-T4): whether the void sheet asks "Put it back in
 * stock". Only a SENT menu item took units from the count, and only an item
 * the venue counts has a count to give back to. The switch starts on; the
 * server decides what comes back (at a station with a kitchen screen only a
 * line the screen never started; with no screen, what the switch says).
 */
export function voidAsksRestock(row: BasketRow | null, catalog: TillCatalog | null | undefined): boolean {
  if (row === null || row.kind !== "item" || !row.sent || row.voided || !row.menuItemId || !catalog) return false;
  for (const menu of catalog.menus) {
    for (const item of menu.items) {
      if (item.id === row.menuItemId) return item.stockLeft !== null;
    }
  }
  return false;
}

/**
 * #4490 08-O5 fix 5: a paid (or voided, refunded) check takes no more items.
 * After its pay sheet is closed with Close the paid check stays on screen to
 * read; the next item picked starts a new sale instead of landing on it (the
 * server would refuse it: "This check is closed").
 */
export function saleTakesItems(sale: TillSale | null): boolean {
  return !checkSettled(sale);
}

/**
 * #4490 08-O5 fix 5: on a phone (< 600 wide) the Till header stacks: Close
 * and the venue on top, then all its actions in a row that wraps, so Close
 * the day and Checks are always reachable (a Till device has no other way to
 * close the day) and the page never scrolls sideways.
 */
export function tillHeaderStacked(layout: FloorLayout): boolean {
  return layout === "phone";
}
