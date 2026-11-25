/**
 * #4490 spec 08 O1 — the Till (edge function `venue-till`, staff JWT).
 *
 * Every number here comes from the server: a check's subtotal, service charge
 * and total are written by the database from its children. The client sends
 * only what a person chose (items, quantities, cash given, tip, refund
 * amount) and the check version it last saw (T10).
 */

import { Platform } from "react-native";
import { supabase } from "./supabase";
import {
  clearTillStaffSession,
  getTillStaffSession,
  requestStepUp,
  setTillStaffSession,
} from "./tillStaffSession";
import { pinRetryMessage, type TillPinPerson } from "../components/venue/till/pinModel";
import { TillError, mapTillPinStaff, tillOnce } from "./tillPinService";

// #4490 O5 — the PIN calls and TillError live in tillPinService (the Team page
// and the device sign-out check load only that); re-exported for the Till.
export {
  TillError,
  fetchMyTillPin,
  fetchTeamTillPins,
  fetchTillPinStaff,
  mapTillPinStaff,
  mapTillPinStatus,
  resetTillPin,
  setMyTillPin,
  type TillPinMember,
  type TillPinStaff,
  type TillPinStatus,
} from "./tillPinService";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type TillLineKind =
  | "menu_round"
  | "entry"
  | "group_package"
  | "by_the_hour"
  | "table"
  | "plan"
  | "balance"
  /** 08-O4 (T12): a booking's paid table deposit, money off the bill. */
  | "deposit_credit";
export type TillPaymentMethod = "tap" | "scan" | "cash" | "own_machine" | "room";

export interface TillItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitMinor: number;
  lineTotalMinor: number;
  notes: string | null;
  modifiers: string[];
  voided: boolean;
  prepState: string;
}

export interface TillLine {
  id: string;
  kind: TillLineKind;
  state: "held" | "committed" | "voided" | "refunded";
  amountMinor: number;
  label: string | null;
  orderId: string | null;
  groupId: string | null;
  sent: boolean | null;
  fulfillmentStatus: string | null;
  pickupCode: string | null;
  /** #4490 O3 A2: when the round went to the kitchen, and when a station accepted it. */
  sentAt: string | null;
  acknowledgedAt: string | null;
  /** One entry per station with live lines on this round (spec 08 §11 T5/T7). */
  stationTickets: TillStationTicket[];
  items: TillItem[];
}

export interface TillStationTicket {
  station: "kitchen" | "bar";
  acceptedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
}

export interface TillPayment {
  id: string;
  method: TillPaymentMethod;
  state: string;
  amountMinor: number;
  serviceChargeMinor: number;
  tipMinor: number;
  cashGivenMinor: number | null;
  changeMinor: number | null;
  paidLate: boolean;
  paidAt: string | null;
  reference: string;
  refundedMinor: number;
  /** Receipts already sent for this payment (the server allows three). */
  receiptSends: number;
  /** #4490 O2: what the card or scan took (fees passed to the guest included). */
  chargedMinor: number | null;
  /** card | bank_transfer | ussd | bank, from the provider; null otherwise. */
  providerChannel: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  /** A late payment staff kept as payment for the check. */
  lateKept: boolean;
  payCode: TillPayCodeState | null;
  /** 08-O4: the share of a split check this payment pays (null: the whole check). */
  shareId?: string | null;
}

/** 08-O4: one share of a split check (every amount is the server's). */
export interface TillShare {
  id: string;
  shareNo: number;
  mode: "by_item" | "even";
  state: "unpaid" | "paying" | "paid";
  amountMinor: number;
  serviceChargeMinor: number;
  setVersion: number;
  paymentId: string | null;
  items: Array<{ orderItemId: string | null; lineId: string | null; units: number; amountMinor: number }>;
}

/** 08-O4: a by-the-hour session on the check. */
export interface TillHourSession {
  lineId: string;
  rootLineId: string;
  startsAt: string | null;
  endsAt: string | null;
  unitName: string | null;
  stepMinutes: number;
}

/** A scan payment's code as the staff side sees it. */
export interface TillPayCodeState {
  code: string;
  status: "open" | "opened" | "paid" | "expired" | "cancelled" | "failed";
  expiresAt: string | null;
  payStarted: boolean;
  textLinksLeft: number;
}

export interface TillSale {
  id: string;
  venueId: string;
  state: "open" | "paying" | "paid" | "voided" | "refunded" | "partially_refunded";
  checkLabel: string | null;
  spotId: string | null;
  spotLabel: string | null;
  serverUserId: string;
  currency: string;
  subtotalMinor: number;
  serviceChargeMinor: number;
  totalDueMinor: number;
  paidMinor: number;
  remainingMinor: number;
  overpaidMinor: number;
  /** Closed on the old order pad (its tab was paid there), never by the Till. */
  settledOutside: "venue_collected" | "bill_to_phone" | null;
  version: number;
  businessDate: string | null;
  pendingPayment: boolean;
  lines: TillLine[];
  payments: TillPayment[];
  /** 08-O4: the split (empty when paid in one go). Optional only for older cached shapes. */
  shares?: TillShare[];
  split?: {
    /** Only an even split of what is left is possible (part paid, refunded, a deposit). */
    evenOnly: boolean;
    /** Units already paid by a share, per order item or line id. */
    unitsPaid: Record<string, number>;
    /** The service charge payments still carry (the server's; previews use it). */
    serviceChargeLeftMinor: number;
  };
  /** 08-O4 (T12): the booking's paid deposit on this check, and how much of it the bill uses. */
  creditMinor?: number;
  creditUsedMinor?: number;
  /** 08-O4 fix 3 (spec 08 §15): the part of the deposit refunded to the guest when the check finished (null: none). */
  depositRefundMinor?: number | null;
  reservation?: { id: string; name: string | null; partySize: number; reservedFor: string | null; source: string | null } | null;
  /** The table's minimum spend (null when there is none). */
  minimumSpend?: { minimumMinor: number; spentMinor: number; shortMinor: number } | null;
  hourSessions?: TillHourSession[];
}

export interface TillMenuModifier {
  id: string;
  name: string;
  priceDeltaMinor: number;
  available: boolean;
}

export interface TillModifierGroup {
  id: string;
  name: string;
  selectionMode: string;
  minSelect: number;
  maxSelect: number;
  modifiers: TillMenuModifier[];
}

export interface TillMenuItem {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number | null;
  orderable: boolean;
  allowsNotes: boolean;
  station: string | null;
  modifierGroups: TillModifierGroup[];
  /** #4490 O5 part C: units left; null = not counted. */
  stockLeft: number | null;
  /** #4490 O5 part C: "Warn me at"; null = no warning. */
  stockWarnAt: number | null;
}

export interface TillCatalog {
  venueId: string;
  brandId: string;
  venueName: string;
  currency: string;
  serviceChargeBps: number;
  canManageMoney: boolean;
  tipsEnabled: boolean;
  tipBpsOptions: number[];
  tapAvailable: boolean;
  menus: Array<{ id: string; name: string; items: TillMenuItem[] }>;
  spots: Array<{ id: string; label: string; hasCheck: boolean }>;
  /** 08-O4: tables (spots with a table), their minimum spend and bookings for about now. */
  tableReservationsOn: boolean;
  tables: TillTable[];
  /** 08-O4: by-the-hour offers staff can start at the Till. */
  hourOffers: TillHourOffer[];
}

export interface TillTableBooking {
  reservationId: string;
  name: string | null;
  partySize: number;
  reservedFor: string | null;
  /** A paid deposit that will come off the bill (null: none, or already used / refunded). */
  depositMinor: number | null;
  depositUsed: boolean;
  note: string | null;
}

export interface TillTable {
  spotId: string;
  tableId: string;
  name: string;
  capacity: number;
  minSpendMinor: number | null;
  hasCheck: boolean;
  bookings: TillTableBooking[];
}

export interface TillHourOffer {
  id: string;
  name: string;
  allocation: "all" | "any_one";
  stepMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  guestMin: number;
  guestMax: number;
  pricePerHourMinor: number | null;
  units: Array<{ spaceId: string; name: string; busy: boolean }>;
}

export interface TillCheckRow {
  id: string;
  checkLabel: string | null;
  spotLabel: string | null;
  state: string;
  currency: string;
  totalDueMinor: number;
  paidMinor: number;
  createdAt: string | null;
  paidAt: string | null;
  waitingForPayment: boolean;
}

export interface TillChecks {
  open: TillCheckRow[];
  paid: TillCheckRow[];
}

function mapItem(v: unknown): TillItem {
  const i = obj(v);
  return {
    id: str(i.id),
    menuItemId: str(i.menuItemId),
    name: str(i.name),
    quantity: num(i.quantity, 1),
    unitMinor: num(i.unitMinor),
    lineTotalMinor: num(i.lineTotalMinor),
    notes: strOrNull(i.notes),
    modifiers: arr(i.modifiers).filter((m): m is string => typeof m === "string"),
    voided: i.voided === true,
    prepState: str(i.prepState, "pending"),
  };
}

export function mapTillSale(v: unknown): TillSale {
  const s = obj(v);
  return {
    id: str(s.id),
    venueId: str(s.venueId),
    state: str(s.state, "open") as TillSale["state"],
    checkLabel: strOrNull(s.checkLabel),
    spotId: strOrNull(s.spotId),
    spotLabel: strOrNull(s.spotLabel),
    serverUserId: str(s.serverUserId),
    currency: str(s.currency, "NGN"),
    subtotalMinor: num(s.subtotalMinor),
    serviceChargeMinor: num(s.serviceChargeMinor),
    totalDueMinor: num(s.totalDueMinor),
    paidMinor: num(s.paidMinor),
    remainingMinor: num(s.remainingMinor),
    overpaidMinor: num(s.overpaidMinor),
    settledOutside: s.settledOutside === "venue_collected" || s.settledOutside === "bill_to_phone" ? s.settledOutside : null,
    version: num(s.version, 1),
    businessDate: strOrNull(s.businessDate),
    pendingPayment: s.pendingPayment === true,
    lines: arr(s.lines).map((l) => {
      const line = obj(l);
      return {
        id: str(line.id),
        kind: str(line.kind, "menu_round") as TillLineKind,
        state: str(line.state, "held") as TillLine["state"],
        amountMinor: num(line.amountMinor),
        label: strOrNull(line.label),
        orderId: strOrNull(line.orderId),
        groupId: strOrNull(line.groupId),
        sent: typeof line.sent === "boolean" ? line.sent : null,
        fulfillmentStatus: strOrNull(line.fulfillmentStatus),
        pickupCode: strOrNull(line.pickupCode),
        sentAt: strOrNull(line.sentAt),
        acknowledgedAt: strOrNull(line.acknowledgedAt),
        stationTickets: arr(line.stationTickets).map((t): TillStationTicket => {
          const ticket = obj(t);
          return {
            station: ticket.station === "bar" ? "bar" : "kitchen",
            acceptedAt: strOrNull(ticket.acceptedAt),
            readyAt: strOrNull(ticket.readyAt),
            pickedUpAt: strOrNull(ticket.pickedUpAt),
          };
        }),
        items: arr(line.items).map(mapItem),
      };
    }),
    payments: arr(s.payments).map((p) => {
      const pay = obj(p);
      return {
        id: str(pay.id),
        method: str(pay.method, "cash") as TillPaymentMethod,
        state: str(pay.state),
        amountMinor: num(pay.amountMinor),
        serviceChargeMinor: num(pay.serviceChargeMinor),
        tipMinor: num(pay.tipMinor),
        cashGivenMinor: numOrNull(pay.cashGivenMinor),
        changeMinor: numOrNull(pay.changeMinor),
        paidLate: pay.paidLate === true,
        paidAt: strOrNull(pay.paidAt),
        reference: str(pay.reference),
        refundedMinor: num(pay.refundedMinor),
        receiptSends: num(pay.receiptSends),
        chargedMinor: numOrNull(pay.chargedMinor),
        providerChannel: strOrNull(pay.providerChannel),
        cardBrand: strOrNull(pay.cardBrand),
        cardLast4: strOrNull(pay.cardLast4),
        lateKept: pay.lateKept === true,
        payCode: pay.payCode !== null && typeof pay.payCode === "object" ? mapPayCodeState(pay.payCode) : null,
        shareId: strOrNull(pay.shareId),
      };
    }),
    shares: arr(s.shares).map((v2): TillShare => {
      const sh = obj(v2);
      return {
        id: str(sh.id),
        shareNo: num(sh.shareNo, 1),
        mode: sh.mode === "even" ? "even" : "by_item",
        state: sh.state === "paid" || sh.state === "paying" ? sh.state : "unpaid",
        amountMinor: num(sh.amountMinor),
        serviceChargeMinor: num(sh.serviceChargeMinor),
        setVersion: num(sh.setVersion, 1),
        paymentId: strOrNull(sh.paymentId),
        items: arr(sh.items).map((it) => {
          const item = obj(it);
          return {
            orderItemId: strOrNull(item.orderItemId),
            lineId: strOrNull(item.lineId),
            units: num(item.units, 1),
            amountMinor: num(item.amountMinor),
          };
        }),
      };
    }),
    split: (() => {
      const sp = obj(s.split);
      const unitsPaid: Record<string, number> = {};
      for (const [k, n] of Object.entries(obj(sp.unitsPaid))) {
        if (typeof n === "number") unitsPaid[k] = n;
      }
      return { evenOnly: sp.evenOnly === true, unitsPaid, serviceChargeLeftMinor: num(sp.serviceChargeLeftMinor) };
    })(),
    creditMinor: num(s.creditMinor),
    creditUsedMinor: num(s.creditUsedMinor),
    depositRefundMinor: numOrNull(s.depositRefundMinor),
    reservation: s.reservation !== null && typeof s.reservation === "object"
      ? (() => {
        const r = obj(s.reservation);
        return {
          id: str(r.id),
          name: strOrNull(r.name),
          partySize: num(r.partySize, 1),
          reservedFor: strOrNull(r.reservedFor),
          source: strOrNull(r.source),
        };
      })()
      : null,
    minimumSpend: s.minimumSpend !== null && typeof s.minimumSpend === "object"
      ? (() => {
        const m = obj(s.minimumSpend);
        return { minimumMinor: num(m.minimumMinor), spentMinor: num(m.spentMinor), shortMinor: num(m.shortMinor) };
      })()
      : null,
    hourSessions: arr(s.hourSessions).map((h) => {
      const hs = obj(h);
      return {
        lineId: str(hs.lineId),
        rootLineId: str(hs.rootLineId),
        startsAt: strOrNull(hs.startsAt),
        endsAt: strOrNull(hs.endsAt),
        unitName: strOrNull(hs.unitName),
        stepMinutes: num(hs.stepMinutes, 60),
      };
    }),
  };
}

export function mapTillCatalog(v: unknown): TillCatalog {
  const c = obj(v);
  const settings = obj(c.settings);
  return {
    venueId: str(c.venueId),
    brandId: str(c.brandId),
    venueName: str(c.venueName),
    currency: str(c.currency, "NGN"),
    serviceChargeBps: num(c.serviceChargeBps),
    canManageMoney: c.canManageMoney === true,
    tipsEnabled: settings.tipsEnabled !== false,
    tipBpsOptions: arr(settings.tipBpsOptions).filter((n): n is number => typeof n === "number"),
    tapAvailable: c.tapAvailable === true,
    menus: arr(c.menus).map((m) => {
      const menu = obj(m);
      return {
        id: str(menu.id),
        name: str(menu.name),
        items: arr(menu.items).map((it) => {
          const item = obj(it);
          return {
            id: str(item.id),
            name: str(item.name),
            description: strOrNull(item.description),
            priceMinor: numOrNull(item.priceMinor),
            orderable: item.orderable === true,
            allowsNotes: item.allowsNotes !== false,
            station: strOrNull(item.station),
            stockLeft: numOrNull(item.stockLeft),
            stockWarnAt: numOrNull(item.stockWarnAt),
            modifierGroups: arr(item.modifierGroups).map((g) => {
              const group = obj(g);
              return {
                id: str(group.id),
                name: str(group.name),
                selectionMode: str(group.selectionMode, "single"),
                minSelect: num(group.minSelect),
                maxSelect: num(group.maxSelect, 1),
                modifiers: arr(group.modifiers).map((md) => {
                  const mod = obj(md);
                  return {
                    id: str(mod.id),
                    name: str(mod.name),
                    priceDeltaMinor: num(mod.priceDeltaMinor),
                    available: mod.available !== false,
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
    spots: arr(c.spots).map((sp) => {
      const spot = obj(sp);
      return { id: str(spot.id), label: str(spot.label), hasCheck: spot.hasCheck === true };
    }),
    tableReservationsOn: c.tableReservationsOn === true,
    tables: arr(c.tables).map((t): TillTable => {
      const table = obj(t);
      return {
        spotId: str(table.spotId),
        tableId: str(table.tableId),
        name: str(table.name),
        capacity: num(table.capacity, 1),
        minSpendMinor: numOrNull(table.minSpendMinor),
        hasCheck: table.hasCheck === true,
        bookings: arr(table.bookings).map((b) => {
          const booking = obj(b);
          return {
            reservationId: str(booking.reservationId),
            name: strOrNull(booking.name),
            partySize: num(booking.partySize, 1),
            reservedFor: strOrNull(booking.reservedFor),
            depositMinor: numOrNull(booking.depositMinor),
            depositUsed: booking.depositUsed === true,
            note: strOrNull(booking.note),
          };
        }),
      };
    }).filter((t) => t.spotId.length > 0),
    hourOffers: arr(c.hourOffers).map((o): TillHourOffer => {
      const offer = obj(o);
      return {
        id: str(offer.id),
        name: str(offer.name),
        allocation: offer.allocation === "any_one" ? "any_one" : "all",
        stepMinutes: num(offer.stepMinutes, 60),
        minMinutes: num(offer.minMinutes, 60),
        maxMinutes: num(offer.maxMinutes, 1440),
        guestMin: num(offer.guestMin, 1),
        guestMax: num(offer.guestMax, 1),
        pricePerHourMinor: numOrNull(offer.pricePerHourMinor),
        units: arr(offer.units).map((u) => {
          const unit = obj(u);
          return { spaceId: str(unit.spaceId), name: str(unit.name), busy: unit.busy === true };
        }),
      };
    }).filter((o) => o.id.length > 0),
  };
}

function mapCheckRow(v: unknown): TillCheckRow {
  const r = obj(v);
  return {
    id: str(r.id),
    checkLabel: strOrNull(r.checkLabel),
    spotLabel: strOrNull(r.spotLabel),
    state: str(r.state),
    currency: str(r.currency, "NGN"),
    totalDueMinor: num(r.totalDueMinor),
    paidMinor: num(r.paidMinor),
    createdAt: strOrNull(r.createdAt),
    paidAt: strOrNull(r.paidAt),
    waitingForPayment: r.waitingForPayment === true,
  };
}

/** #4490 O5: the codes that mean "this device needs someone to switch in". */
export const TILL_SESSION_LOST_CODES: readonly string[] = ["pin_session_required", "pin_session_invalid"];

/**
 * #4490 O5: every Till call carries the device's PIN session when there is one
 * (in the POST body, never a URL). A lost session clears it here, so the Till
 * shows "Who's selling?". A refund or a sent void that needs a fresh PIN asks
 * the open sheet for it and retries; a wrong PIN asks again with the reason.
 */
async function till<T>(body: Record<string, unknown>): Promise<T> {
  const venueId = typeof body.venueId === "string" ? body.venueId : "";
  const session = venueId ? getTillStaffSession(venueId) : null;
  const send = session !== null ? { ...body, staffSession: session.token } : body;
  try {
    return await tillOnce<T>(send);
  } catch (err) {
    if (!(err instanceof TillError) || session === null) throw err;
    if (TILL_SESSION_LOST_CODES.includes(err.code)) {
      clearTillStaffSession(venueId, "server");
      throw err;
    }
    const purpose = body.action === "refund" ? "refund"
      : body.action === "void" ? "void_sent"
      // #4490 O5 part B: reopening a closed day and exporting a day.
      : body.action === "day_reopen" ? "reopen"
      : body.action === "day_export" ? "export"
      : null;
    if (err.code !== "pin_step_up_required" || purpose === null) throw err;
    let message: string | null = null;
    for (;;) {
      const answer = await requestStepUp(venueId, purpose, message);
      if (answer === null) throw new TillError("pin_step_up_cancelled");
      try {
        return await tillOnce<T>({ ...send, stepUp: { pin: answer.pin, ...(answer.memberId ? { memberId: answer.memberId } : {}) } });
      } catch (retryErr) {
        if (!(retryErr instanceof TillError)) throw retryErr;
        if (TILL_SESSION_LOST_CODES.includes(retryErr.code)) {
          clearTillStaffSession(venueId, "server");
          throw retryErr;
        }
        const retry = pinRetryMessage(retryErr);
        if (retry === null) throw retryErr;
        message = retry;
      }
    }
  }
}

/**
 * #4490 O5 part B: the same transport for the daily close and the Till
 * settings (venueDayCloseService): the PIN session rides along, a lost
 * session ends here, and reopen / export ask the open screen for a fresh PIN.
 */
export function tillAction<T>(body: Record<string, unknown>): Promise<T> {
  return till<T>(body);
}

export async function fetchTillCatalog(venueId: string): Promise<TillCatalog> {
  // The platform lets the server answer the tap release for this phone (O2).
  return mapTillCatalog(await till<unknown>({ action: "catalog", venueId, platform: Platform.OS }));
}

export async function fetchTillChecks(venueId: string): Promise<TillChecks> {
  const data = obj(await till<unknown>({ action: "checks", venueId }));
  return { open: arr(data.open).map(mapCheckRow), paid: arr(data.paid).map(mapCheckRow) };
}

export async function fetchTillSale(venueId: string, saleId: string): Promise<TillSale> {
  const data = obj(await till<unknown>({ action: "sale", venueId, saleId }));
  return mapTillSale(data.sale);
}

async function saleAction(body: Record<string, unknown>): Promise<TillSale> {
  const data = obj(await till<unknown>(body));
  return mapTillSale(data.sale);
}

export function openTillCheck(input: {
  venueId: string;
  label: string | null;
  spotId: string | null;
  idempotencyKey: string;
}): Promise<TillSale> {
  return saleAction({ action: "open", ...input });
}

export interface TillMenuLineInput {
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  notes: string | null;
}

export function addTillMenu(input: {
  venueId: string;
  saleId: string;
  lines: TillMenuLineInput[];
  send: boolean;
  idempotencyKey: string;
  expectedVersion: number;
}): Promise<TillSale> {
  return saleAction({ action: "add_menu", ...input });
}

export function addTillOffer(input: {
  venueId: string;
  saleId: string;
  offeringId: string;
  lines: Array<{ priceOptionId: string; guests: number }>;
  guestListEntryId: string | null;
  idempotencyKey: string;
  expectedVersion: number;
}): Promise<TillSale> {
  return saleAction({ action: "add_offer", ...input });
}

export function voidTillLine(input: {
  venueId: string;
  saleId: string;
  lineId: string | null;
  orderItemId: string | null;
  reason: string;
  restock: boolean;
  expectedVersion: number;
}): Promise<TillSale> {
  return saleAction({ action: "void", ...input });
}

export function sendTill(input: { venueId: string; saleId: string }): Promise<TillSale> {
  return saleAction({ action: "send", ...input });
}

export interface TillPaymentResult {
  sale: TillSale;
  paymentId: string;
  /**
   * 08-O3 fix 5: what the server RECORDED for this payment (on a replay, the
   * original payment), never what was sent. Null only from a server that
   * predates the fix; the sheet then reads the check's own payment row.
   */
  amountMinor: number | null;
  tipMinor: number | null;
  changeMinor: number | null;
  replayed: boolean;
}

export async function payTill(input: {
  venueId: string;
  saleId: string;
  method: "cash" | "own_machine";
  amountMinor: number;
  tipMinor: number;
  cashGivenMinor: number | null;
  clientRequestId: string;
  expectedVersion: number;
  /** 08-O4: the share being paid (its exact amount), or null for the whole check. */
  shareId?: string | null;
}): Promise<TillPaymentResult> {
  const { method, cashGivenMinor, shareId, ...rest } = input;
  const data = obj(await till<unknown>({
    action: method === "cash" ? "pay_cash" : "pay_own_machine",
    ...rest,
    ...(method === "cash" ? { cashGivenMinor } : {}),
    ...(shareId ? { shareId } : {}),
  }));
  return {
    sale: mapTillSale(data.sale),
    paymentId: str(data.paymentId),
    amountMinor: numOrNull(data.amountMinor),
    tipMinor: numOrNull(data.tipMinor),
    changeMinor: numOrNull(data.changeMinor),
    replayed: data.replayed === true,
  };
}

export async function refundTill(input: {
  venueId: string;
  paymentId: string;
  amountMinor: number;
  tipMinor: number;
  reason: string;
  restock: boolean;
  clientRequestId: string;
}): Promise<TillSale> {
  const data = obj(await till<unknown>({ action: "refund", ...input }));
  return mapTillSale(data.sale);
}

/**
 * Refund one paid offer line in full (money rights). The server takes the
 * money back from the check's cash / own-machine payments and cancels the
 * booking; no amount is sent.
 */
export async function refundTillLine(input: {
  venueId: string;
  lineId: string;
  reason: string;
  clientRequestId: string;
}): Promise<TillSale> {
  const data = obj(await till<unknown>({ action: "refund", ...input }));
  return mapTillSale(data.sale);
}

/** Move a check to another table and/or rename it (T9). */
export function relabelTill(input: {
  venueId: string;
  saleId: string;
  spotId: string | null;
  label: string | null;
  expectedVersion: number;
}): Promise<TillSale> {
  return saleAction({ action: "relabel", ...input });
}

/** Hand a check over to someone else who may sell here (T9). */
export function setTillServer(input: {
  venueId: string;
  saleId: string;
  serverUserId: string;
  expectedVersion: number;
}): Promise<TillSale> {
  return saleAction({ action: "set_server", ...input });
}

export interface TillServer {
  userId: string;
  /** #4490 after #4579: a Mingla admin is "<name> from Mingla" (or "Mingla Team"), never an email. */
  name: string | null;
  /** #4579: an auto-added Mingla admin (full Brand admin parity; may sell). */
  isMinglaTeam?: boolean;
  openChecks: number;
}

/** The people who may sell at this venue (who can take a check over). */
export async function fetchTillServers(venueId: string): Promise<TillServer[]> {
  return mapTillServers(await till<unknown>({ action: "servers", venueId }));
}

/** The "servers" reply, read field by field (#4490; isMinglaTeam since #4579). */
export function mapTillServers(reply: unknown): TillServer[] {
  const data = obj(reply);
  return arr(data.servers).map((v) => {
    const r = obj(v);
    return {
      userId: str(r.userId),
      name: strOrNull(r.name),
      isMinglaTeam: r.isMinglaTeam === true,
      openChecks: num(r.openChecks),
    };
  }).filter((r) => r.userId.length > 0);
}

/** Send a payment's receipt by text and/or email (at most three sends). */
export async function sendTillReceipt(input: {
  venueId: string;
  paymentId: string;
  phone: string | null;
  phoneCountryIso: string | null;
  email: string | null;
}): Promise<{ sendsLeft: number; queued: { sms: boolean; email: boolean } }> {
  const data = obj(await till<unknown>({
    action: "receipt",
    venueId: input.venueId,
    paymentId: input.paymentId,
    ...(input.phone !== null ? { phone: input.phone, phoneCountryIso: input.phoneCountryIso } : {}),
    ...(input.email !== null ? { email: input.email } : {}),
  }));
  const queued = obj(data.queued);
  return { sendsLeft: num(data.sendsLeft), queued: { sms: queued.sms === true, email: queued.email === true } };
}

// ---------------------------------------------------------------------------
// #4490 spec 08 O2 — tap to pay and scan to pay. The amount is always what is
// left on the check, priced by the server; only the tip is sent.
// ---------------------------------------------------------------------------

export function mapPayCodeState(v: unknown): TillPayCodeState {
  const c = obj(v);
  return {
    code: str(c.code),
    status: str(c.status, "open") as TillPayCodeState["status"],
    expiresAt: strOrNull(c.expiresAt),
    payStarted: c.payStarted === true,
    textLinksLeft: num(c.textLinksLeft, 3),
  };
}

export interface TillCardStart {
  paymentId: string;
  amountMinor: number;
  tipMinor: number;
  chargedMinor: number;
  sale: TillSale | null;
  /** Scan only. */
  code: string | null;
  payUrl: string | null;
  expiresAt: string | null;
}

function mapCardStart(v: unknown): TillCardStart {
  const d = obj(v);
  return {
    paymentId: str(d.paymentId),
    amountMinor: num(d.amountMinor),
    tipMinor: num(d.tipMinor),
    chargedMinor: num(d.chargedMinor),
    sale: d.sale !== null && typeof d.sale === "object" ? mapTillSale(d.sale) : null,
    code: strOrNull(d.code),
    payUrl: strOrNull(d.payUrl),
    expiresAt: strOrNull(d.expiresAt),
  };
}

export async function startTillScan(input: {
  venueId: string;
  saleId: string;
  tipMinor: number;
  clientRequestId: string;
  expectedVersion: number;
  shareId?: string | null;
}): Promise<TillCardStart> {
  const { shareId, ...rest } = input;
  return mapCardStart(await till<unknown>({ action: "pay_code_create", ...rest, ...(shareId ? { shareId } : {}) }));
}

export async function startTillTap(input: {
  venueId: string;
  saleId: string;
  tipMinor: number;
  clientRequestId: string;
  expectedVersion: number;
  platform: string;
  shareId?: string | null;
}): Promise<TillCardStart> {
  const { shareId, ...rest } = input;
  return mapCardStart(await till<unknown>({ action: "pay_tap_start", ...rest, ...(shareId ? { shareId } : {}) }));
}

/** A tap payment whose card reader never started. */
export async function cancelTillCardPayment(input: { venueId: string; paymentId: string }): Promise<void> {
  await till<unknown>({ action: "pay_card_cancel", ...input });
}

export interface TillPayCodeStatus extends TillPayCodeState {
  paymentId: string;
  paymentState: string;
  paidLate: boolean;
  providerChannel: string | null;
  payUrl: string | null;
}

export async function fetchTillPayCode(input: { venueId: string; code: string }): Promise<TillPayCodeStatus> {
  const d = obj(await till<unknown>({ action: "pay_code_status", ...input }));
  return {
    ...mapPayCodeState(d),
    paymentId: str(d.paymentId),
    paymentState: str(d.paymentState),
    paidLate: d.paidLate === true,
    providerChannel: strOrNull(d.providerChannel),
    payUrl: strOrNull(d.payUrl),
  };
}

export async function cancelTillPayCode(input: { venueId: string; code: string }): Promise<TillSale | null> {
  const d = obj(await till<unknown>({ action: "pay_code_cancel", ...input }));
  return d.sale !== null && typeof d.sale === "object" ? mapTillSale(d.sale) : null;
}

export async function textTillPayCode(input: {
  venueId: string;
  code: string;
  phone: string;
  phoneCountryIso: string | null;
}): Promise<{ textLinksLeft: number }> {
  const d = obj(await till<unknown>({ action: "pay_code_text", ...input }));
  return { textLinksLeft: num(d.textLinksLeft) };
}

export async function keepTillLatePayment(input: {
  venueId: string;
  paymentId: string;
  expectedVersion: number;
}): Promise<TillSale> {
  const d = obj(await till<unknown>({ action: "keep_late", ...input }));
  return mapTillSale(d.sale);
}

// ---------------------------------------------------------------------------
// #4490 spec 08 O4 — split bill, tables, by the hour started by staff. The
// client sends what a person chose (who has which item, how many people,
// which table, how long); the server computes every share and price.
// ---------------------------------------------------------------------------

export type TillSplitInput =
  | { mode: "even"; count: number }
  | { mode: "by_item"; shares: Array<{ items: Array<{ orderItemId: string; units: number } | { lineId: string; units: number }> }> }
  | { mode: "none" };

export function setTillSplit(input: {
  venueId: string;
  saleId: string;
  split: TillSplitInput;
  expectedVersion: number;
}): Promise<TillSale> {
  const { split, ...rest } = input;
  return saleAction({ action: "set_split", ...rest, ...split });
}

export function seatTillTable(input: {
  venueId: string;
  spotId: string;
  partySize: number | null;
  reservationId: string | null;
  label: string | null;
  idempotencyKey: string;
}): Promise<TillSale> {
  return saleAction({ action: "seat", ...input });
}

export function startTillSession(input: {
  venueId: string;
  saleId: string;
  offeringId: string;
  spaceId: string | null;
  minutes: number;
  guests: number | null;
  idempotencyKey: string;
  expectedVersion: number;
}): Promise<TillSale> {
  return saleAction({ action: "start_session", ...input });
}

/** #4490 08-O4 fix 1 (O4-T2): close a check the deposit fully pays (no money moves). */
export function closeTillCovered(input: { venueId: string; saleId: string; expectedVersion: number }): Promise<TillSale> {
  return saleAction({ action: "close_covered", ...input });
}

export function extendTillSession(input: {
  venueId: string;
  saleId: string;
  lineId: string;
  minutes: number;
  idempotencyKey: string;
  expectedVersion: number;
}): Promise<TillSale> {
  return saleAction({ action: "extend_session", ...input });
}

// ---------------------------------------------------------------------------
// #4490 spec 08 O5 part A — PINs and "Who's selling?".
// ---------------------------------------------------------------------------

export type { TillPinPerson };

/** Switches a person in; the token goes to memory only (tillStaffSession). */
export async function unlockTillPin(input: { venueId: string; memberId: string; pin: string }): Promise<void> {
  const data = obj(await tillOnce<unknown>({ action: "pin_unlock", ...input }));
  const member = obj(data.member);
  const token = str(data.staffSession);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new TillError("till_failed");
  setTillStaffSession({
    venueId: input.venueId,
    token,
    memberId: str(member.memberId, input.memberId),
    memberUserId: str(member.userId),
    name: str(member.name, "Team member"),
    canApprove: member.canApprove === true,
    autoLockMinutes: num(data.autoLockMinutes, 2),
  });
}

/** Ends the device's PIN session here and on the server ("Switch", auto-lock). */
export async function endTillPin(venueId: string, reason: "ended" | "auto_lock" = "ended"): Promise<void> {
  const session = getTillStaffSession(venueId);
  clearTillStaffSession(venueId, reason === "auto_lock" ? "auto_lock" : null);
  if (session === null) return;
  await tillOnce<unknown>({ action: "pin_end", venueId, staffSession: session.token, reason });
}

/** Ends every PIN session of this device after a manager's PIN or a fresh email code. */
export async function signOutTillDevice(input: { venueId: string; memberId?: string; pin?: string }): Promise<void> {
  await tillOnce<unknown>({ action: "pin_sign_out", ...input });
  clearTillStaffSession(input.venueId);
}

