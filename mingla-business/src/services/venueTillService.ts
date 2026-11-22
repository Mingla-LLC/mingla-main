/**
 * #4490 spec 08 O1 — the Till (edge function `venue-till`, staff JWT).
 *
 * Every number here comes from the server: a check's subtotal, service charge
 * and total are written by the database from its children. The client sends
 * only what a person chose (items, quantities, cash given, tip, refund
 * amount) and the check version it last saw (T10).
 */

import { supabase } from "./supabase";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export class TillError extends Error {
  readonly code: string;
  readonly item: string | null;
  readonly remainingMinor: number | null;
  constructor(code: string, item: string | null = null, remainingMinor: number | null = null) {
    super(code);
    this.name = "TillError";
    this.code = code;
    this.item = item;
    this.remainingMinor = remainingMinor;
  }
}

export type TillLineKind = "menu_round" | "entry" | "group_package" | "by_the_hour" | "table" | "plan" | "balance";
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
  items: TillItem[];
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
  version: number;
  businessDate: string | null;
  pendingPayment: boolean;
  lines: TillLine[];
  payments: TillPayment[];
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

async function tillError(error: { message?: string; context?: unknown }): Promise<TillError> {
  const context = error.context;
  if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
    try {
      const body = obj(await (context as Response).json());
      if (typeof body.code === "string" && body.code.length > 0) {
        return new TillError(body.code, strOrNull(body.item), numOrNull(body.remainingMinor));
      }
    } catch {
      // An unreadable body falls through to the network mapping below.
    }
  }
  const raw = error.message ?? "";
  return new TillError(/failed to fetch|network|load failed/i.test(raw) ? "network" : "till_failed");
}

async function till<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("venue-till", { body });
  if (error) throw await tillError(error as { message?: string; context?: unknown });
  const envelope = obj(data);
  if (envelope.kind !== "success") throw new TillError(str(envelope.code, "till_failed"));
  return envelope.data as T;
}

export async function fetchTillCatalog(venueId: string): Promise<TillCatalog> {
  return mapTillCatalog(await till<unknown>({ action: "catalog", venueId }));
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
}): Promise<TillPaymentResult> {
  const { method, cashGivenMinor, ...rest } = input;
  const data = obj(await till<unknown>({
    action: method === "cash" ? "pay_cash" : "pay_own_machine",
    ...rest,
    ...(method === "cash" ? { cashGivenMinor } : {}),
  }));
  return {
    sale: mapTillSale(data.sale),
    paymentId: str(data.paymentId),
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
