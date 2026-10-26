/**
 * #3872 round 2 — the event page tool grid (approved M-eventgrid with Seth's
 * one change): Scan tickets as a full-width highlighted tile, then compact
 * tiles two per row: Scanners, Orders, Guests, Promote, Insights, Group chat,
 * Door sales, Reconciliation, Public page, Brand page. The Blasts/Messages
 * tile is gone — Promote leads to Blast, which holds campaigns.
 *
 * Each tile keeps its existing gate; this returns the order for the tiles the
 * caller says are available. Reconciliation gates itself on the role, so it
 * is always listed and renders nothing below finance rank.
 */
export type EventGridTileKey =
  | "scan"
  | "scanners"
  | "orders"
  | "guests"
  | "promote"
  | "insights"
  | "groupChat"
  | "dates"
  | "doorSales"
  | "reconciliation"
  | "publicPage"
  | "brandPage";

export const EVENT_GRID_ORDER: readonly EventGridTileKey[] = [
  "scan",
  "scanners",
  "orders",
  "guests",
  "promote",
  "insights",
  "groupChat",
  "dates",
  "doorSales",
  "reconciliation",
  "publicPage",
  "brandPage",
];

export function eventGridTiles(available: {
  promote: boolean;
  insights: boolean;
  dates: boolean;
  doorSales: boolean;
  brandPage: boolean;
}): EventGridTileKey[] {
  return EVENT_GRID_ORDER.filter((key) => {
    switch (key) {
      case "promote":
        return available.promote;
      case "insights":
        return available.insights;
      case "dates":
        return available.dates;
      case "doorSales":
        return available.doorSales;
      case "brandPage":
        return available.brandPage;
      default:
        return true;
    }
  });
}
