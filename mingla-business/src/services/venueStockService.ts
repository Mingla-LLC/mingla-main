/**
 * #4490 spec 08 O5 part C — stock counts and sold out after payment (edge
 * function venue-order-staff, actions stock_set / station_stock /
 * station_sold_out / order_sold_out / sold_out_resolve). Services throw a
 * StockError carrying the server's code; screens turn codes into words
 * (stockCopy.ts). The server decides every count, right and refund.
 */
import { supabase } from "./supabase";
import { getTillStaffSession } from "./tillStaffSession";

export class StockError extends Error {
  readonly code: string;
  readonly itemName: string | null;
  readonly left: number | null;
  constructor(code: string, itemName: string | null = null, left: number | null = null) {
    super(code);
    this.name = "StockError";
    this.code = code;
    this.itemName = itemName;
    this.left = left;
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

async function stockErrorFrom(error: { message?: string; context?: unknown }): Promise<StockError> {
  const context = error.context;
  if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
    try {
      const body = obj(await (context as Response).clone().json());
      const code = typeof body.error === "string" ? body.error : typeof body.code === "string" ? body.code : "";
      if (code.length > 0) return new StockError(code, text(body.itemName), num(body.left));
    } catch {
      // An unreadable body falls through to the network mapping below.
    }
  }
  const raw = error.message ?? "";
  return new StockError(/failed to fetch|network|load failed/i.test(raw) ? "network" : "stock_failed");
}

async function staff(body: Json): Promise<Json> {
  const { data, error } = await supabase.functions.invoke("venue-order-staff", { body });
  if (error) throw await stockErrorFrom(error as { message?: string; context?: unknown });
  return obj(data);
}

/** On a Till device login the PIN session rides in the body (memory only). */
function withSession(venueId: string, body: Json): Json {
  const session = getTillStaffSession(venueId);
  return session !== null ? { ...body, staffSession: session.token } : body;
}

export interface MenuItemStock {
  menuItemId: string;
  name: string;
  tracked: boolean;
  stockLeft: number | null;
  warnAt: number | null;
  soldOut: boolean;
  outAt: string | null;
  setAt: string | null;
  setBy: string | null;
  markedAt: string | null;
  markedBy: string | null;
}

export function parseMenuItemStock(raw: unknown): MenuItemStock {
  const r = obj(raw);
  return {
    menuItemId: String(r.menuItemId ?? ""),
    name: String(r.name ?? ""),
    tracked: r.tracked === true,
    stockLeft: num(r.stockLeft),
    warnAt: num(r.warnAt),
    soldOut: r.soldOut === true,
    outAt: text(r.outAt),
    setAt: text(r.setAt),
    setBy: text(r.setBy),
    markedAt: text(r.markedAt),
    markedBy: text(r.markedBy),
  };
}

/** Menu: set or restock (a number) or stop tracking (null). Menu manage rights. */
export async function setMenuItemStock(input: {
  venueId: string;
  menuItemId: string;
  count: number | null;
  warnAt: number | null;
}): Promise<MenuItemStock> {
  const data = await staff(withSession(input.venueId, {
    action: "stock_set",
    venueId: input.venueId,
    menuItemId: input.menuItemId,
    count: input.count,
    warnAt: input.count === null ? null : input.warnAt,
  }));
  return parseMenuItemStock(data.stock);
}

export interface StationStockItem extends MenuItemStock {
  station: "kitchen" | "bar";
  canUndo: boolean;
  openTickets: number;
}

export async function fetchStationStock(venueId: string, station: "kitchen" | "bar" | "all"): Promise<StationStockItem[]> {
  const data = await staff({ action: "station_stock", venueId, station });
  const rows = Array.isArray(data.items) ? data.items : [];
  return rows.map((row) => {
    const r = obj(row);
    return {
      ...parseMenuItemStock(r),
      station: r.station === "bar" ? "bar" : "kitchen",
      canUndo: r.canUndo === true,
      openTickets: num(r.openTickets) ?? 0,
    };
  });
}

/** T15: "Sold out" (on) or "Back on" (off) from the station board. */
export async function setStationSoldOut(venueId: string, menuItemId: string, on: boolean): Promise<MenuItemStock> {
  const data = await staff({ action: "station_sold_out", venueId, menuItemId, on });
  return parseMenuItemStock(data.stock);
}

export interface SoldOutLine {
  orderItemId: string;
  menuItemId: string;
  name: string;
  quantity: number;
  lineTotalMinor: number;
  /** What a refund of this line returns (what was paid for it + its service charge share). */
  refundPreviewMinor: number;
  station: "kitchen" | "bar" | null;
  resolution: "swap" | "refund" | null;
  swappedToName: string | null;
  refundedMinor: number | null;
}

export interface SwapOption {
  menuItemId: string;
  name: string;
  priceMinor: number;
  station: "kitchen" | "bar" | null;
}

export interface OrderSoldOut {
  orderId: string;
  currency: string;
  canRefund: boolean;
  canSwap: boolean;
  refundUsed: boolean;
  lines: SoldOutLine[];
  swapOptions: SwapOption[];
}

const station = (v: unknown): "kitchen" | "bar" | null => (v === "kitchen" || v === "bar" ? v : null);

export function parseOrderSoldOut(raw: unknown): OrderSoldOut {
  const r = obj(raw);
  return {
    orderId: String(r.orderId ?? ""),
    currency: String(r.currency ?? ""),
    canRefund: r.canRefund === true,
    canSwap: r.canSwap === true,
    refundUsed: r.refundUsed === true,
    lines: (Array.isArray(r.lines) ? r.lines : []).map((row) => {
      const l = obj(row);
      return {
        orderItemId: String(l.orderItemId ?? ""),
        menuItemId: String(l.menuItemId ?? ""),
        name: String(l.name ?? ""),
        quantity: num(l.quantity) ?? 1,
        lineTotalMinor: num(l.lineTotalMinor) ?? 0,
        refundPreviewMinor: num(l.refundPreviewMinor) ?? num(l.lineTotalMinor) ?? 0,
        station: station(l.station),
        resolution: l.resolution === "swap" || l.resolution === "refund" ? l.resolution : null,
        swappedToName: text(l.swappedToName),
        refundedMinor: num(l.refundedMinor),
      };
    }),
    swapOptions: (Array.isArray(r.swapOptions) ? r.swapOptions : []).map((row) => {
      const o = obj(row);
      return {
        menuItemId: String(o.menuItemId ?? ""),
        name: String(o.name ?? ""),
        priceMinor: num(o.priceMinor) ?? 0,
        station: station(o.station),
      };
    }),
  };
}

export async function fetchOrderSoldOut(venueId: string, orderId: string): Promise<OrderSoldOut> {
  const data = await staff(withSession(venueId, { action: "order_sold_out", venueId, orderId }));
  return parseOrderSoldOut(data.soldOut);
}

export interface SoldOutResolution {
  resolution: "swap" | "refund";
  refundMinor: number;
  swapName: string | null;
  replayed: boolean;
}

/**
 * T16: swap or refund the waiting lines. `requestId` is made once per
 * decision (a retry of the same decision sends the same id, so the server
 * answers what it did; it never refunds twice).
 */
export async function resolveSoldOut(input: {
  venueId: string;
  orderId: string;
  orderItemIds: string[];
  resolution: "swap" | "refund";
  swapMenuItemId: string | null;
  requestId: string;
}): Promise<SoldOutResolution> {
  const data = await staff(withSession(input.venueId, {
    action: "sold_out_resolve",
    venueId: input.venueId,
    orderId: input.orderId,
    orderItemIds: input.orderItemIds,
    resolution: input.resolution,
    swapMenuItemId: input.swapMenuItemId,
    requestId: input.requestId,
  }));
  const r = obj(data.resolution);
  return {
    resolution: r.resolution === "swap" ? "swap" : "refund",
    refundMinor: num(r.refundMinor) ?? 0,
    swapName: text(r.swapName),
    replayed: r.replayed === true,
  };
}

export interface MenuStockRow {
  stockCount: number | null;
  warnAt: number | null;
  outAt: string | null;
}

/**
 * The builder's count read (Menu list pills and the item's Stock section),
 * kept apart from the menu read so a database without the stock columns
 * (the app deployed before migration 20280809615490: [TRANSITIONAL], exit
 * the migration applied in production) still shows the menu: 42703 reads as
 * "nothing tracked".
 */
export async function fetchMenuStock(brandId: string): Promise<Map<string, MenuStockRow>> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, stock_count, stock_warn_at, stock_out_at")
    .eq("brand_id", brandId)
    .not("stock_count", "is", null);
  const out = new Map<string, MenuStockRow>();
  if (error !== null) {
    if ((error as { code?: string }).code === "42703") return out;
    throw error;
  }
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    out.set(String(row.id), {
      stockCount: num(row.stock_count),
      warnAt: num(row.stock_warn_at),
      outAt: text(row.stock_out_at),
    });
  }
  return out;
}
