/**
 * #4490 spec 08 O5 part C — pure display state for stock counts (no I/O).
 * The server owns every count; these only decide what a pill or a row says.
 */
import { STOCK_COPY } from "./stockCopy";

export type StockTone = "err" | "warn" | "neutral";

/**
 * The pill for an item: "Sold out" at 0, "{n} left" while counted (warning
 * tone at or below "Warn me at"), nothing when the item is not tracked.
 */
export function stockPill(
  stockLeft: number | null | undefined,
  warnAt: number | null | undefined,
): { label: string; tone: StockTone } | null {
  if (stockLeft === null || stockLeft === undefined) return null;
  if (stockLeft <= 0) return { label: STOCK_COPY.soldOut, tone: "err" };
  const warn = typeof warnAt === "number" && stockLeft <= warnAt;
  return { label: STOCK_COPY.left(stockLeft), tone: warn ? "warn" : "neutral" };
}

/** Bounds of the count and the warning level (the server refuses outside them). */
export const STOCK_MAX = 99999;

export interface StockDraft {
  tracked: boolean;
  count: number;
  warnAt: number;
}

/** What the sheet starts from: the item's own count, or a fresh draft. */
export function stockDraftFrom(stockLeft: number | null, warnAt: number | null): StockDraft {
  return {
    tracked: stockLeft !== null,
    count: stockLeft ?? 0,
    warnAt: warnAt ?? 0,
  };
}

/** The call a save makes: null stops tracking; a warning level of 0 means none. */
export function stockSaveInput(draft: StockDraft): { count: number | null; warnAt: number | null } {
  if (!draft.tracked) return { count: null, warnAt: null };
  return { count: draft.count, warnAt: draft.warnAt > 0 ? draft.warnAt : null };
}

export function stockDraftChanged(draft: StockDraft, stockLeft: number | null, warnAt: number | null): boolean {
  const base = stockDraftFrom(stockLeft, warnAt);
  if (draft.tracked !== base.tracked) return true;
  if (!draft.tracked) return false;
  return draft.count !== base.count || draft.warnAt !== base.warnAt;
}

export type SwapChoice =
  | { kind: "cheaper"; backMinor: number }
  | { kind: "same" }
  | { kind: "dearer" }
  | { kind: "other_station" };

/**
 * A swap option against a sold-out line (same station, same price or less
 * for the same quantity). The server checks the same rule; this only decides
 * whether the row can be picked and what it says.
 */
export function swapChoice(
  line: { quantity: number; lineTotalMinor: number; station: string | null },
  option: { priceMinor: number; station: string | null },
): SwapChoice {
  if (line.station !== option.station) return { kind: "other_station" };
  const swapTotal = option.priceMinor * line.quantity;
  if (swapTotal > line.lineTotalMinor) return { kind: "dearer" };
  if (swapTotal === line.lineTotalMinor) return { kind: "same" };
  return { kind: "cheaper", backMinor: line.lineTotalMinor - swapTotal };
}

/**
 * #4490 08-O5 fix 3: a swap to something cheaper gives money back, so it is a
 * refund: only someone who may refund can pick it (the server refuses it
 * otherwise, and on a Till device asks for a fresh PIN).
 * #4490 08-O5 fix 5: a same-price swap moves no money, so it keeps the kitchen
 * or seller rule (canSwapEven): money rights alone (a finance manager) swap
 * only to something cheaper.
 */
export function swapPickable(choice: SwapChoice, canRefund: boolean, canSwapEven = true): boolean {
  return (choice.kind === "same" && canSwapEven) || (choice.kind === "cheaper" && canRefund);
}

/** The Till's words for item_sold_out: before paying, before sending, or too many. */
export function tillSoldOutSentence(
  context: "pay" | "send",
  itemName: string | null,
  left: number | null,
): string {
  const item = itemName && itemName.trim() ? itemName.trim() : "An item";
  if (context === "send" && typeof left === "number" && left > 0) return STOCK_COPY.onlyLeft(left);
  return context === "pay" ? STOCK_COPY.soldOutBeforePaying(item) : STOCK_COPY.soldOutBeforeSending(item);
}

/**
 * #4490 08-O5 fix 1 (O5-T3): a sold-out line offers "Refund" whenever the
 * person may refund and the line is still waiting. Every waiting line can be
 * refunded, each exactly once (the server keeps one refund per line, never
 * "one per order"), so an earlier refund on the order never hides it.
 */
export function canRefundSoldOutLine(
  data: { canRefund: boolean },
  line: { resolution: string | null },
): boolean {
  return data.canRefund && line.resolution === null;
}
