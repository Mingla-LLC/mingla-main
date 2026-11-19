/**
 * #4420 (round-3 item 10, TILE_MATRIX P10) — the event home tile page, the
 * same core tiles as the RSVP, trip and experience homes:
 *   core: Edit, Scan tickets, Scanners, Group chat, Blast, Promote, Guests,
 *         Guest questions (#4514), Orders, Insights;
 *   "More for this event": Dates (multi-date only), Door sales (ticketed with
 *         in-person payments), Reconcile (finance rank, gated inside its tile),
 *         Public page, Brand page.
 * "Continue editing" is gone everywhere; Edit is a tile (it used to live only
 * in the Manage menu). Blast is back on the page (Seth asked for it; #3872 had
 * removed it on purpose).
 *
 * Each tile keeps its existing gate; this returns the order for the tiles the
 * caller says are available.
 */
export type EventGridTileKey =
  | "edit"
  | "scan"
  | "scanners"
  | "groupChat"
  | "blast"
  | "promote"
  | "guests"
  | "guestQuestions"
  | "orders"
  | "insights"
  | "dates"
  | "doorSales"
  | "reconciliation"
  | "publicPage"
  | "brandPage";

export const EVENT_GRID_CORE: readonly EventGridTileKey[] = [
  "edit",
  "scan",
  "scanners",
  "groupChat",
  "blast",
  "promote",
  "guests",
  // #4514 — "Guest questions": after Guests, before Orders (10 core tiles, so
  // Insights lands alone on a fourth row, padded to one-third width).
  "guestQuestions",
  "orders",
  "insights",
];

export const EVENT_GRID_MORE: readonly EventGridTileKey[] = [
  "dates",
  "doorSales",
  "reconciliation",
  "publicPage",
  "brandPage",
];

export const EVENT_GRID_ORDER: readonly EventGridTileKey[] = [
  ...EVENT_GRID_CORE,
  ...EVENT_GRID_MORE,
];

export interface EventGridAvailability {
  edit: boolean;
  promote: boolean;
  insights: boolean;
  /** #4514 — marketing manager and up (scanners never see the tile). */
  guestQuestions: boolean;
  dates: boolean;
  doorSales: boolean;
  brandPage: boolean;
}

const isAvailable = (key: EventGridTileKey, available: EventGridAvailability): boolean => {
  switch (key) {
    case "edit":
      return available.edit;
    case "promote":
      return available.promote;
    case "insights":
      return available.insights;
    case "guestQuestions":
      return available.guestQuestions;
    case "dates":
      return available.dates;
    case "doorSales":
      return available.doorSales;
    case "brandPage":
      return available.brandPage;
    default:
      return true;
  }
};

export function eventGridTiles(available: EventGridAvailability): EventGridTileKey[] {
  return EVENT_GRID_ORDER.filter((key) => isAvailable(key, available));
}

/** The two sections of the tile page, each already filtered by its gates. */
export function eventGridSections(available: EventGridAvailability): {
  core: EventGridTileKey[];
  more: EventGridTileKey[];
} {
  return {
    core: EVENT_GRID_CORE.filter((key) => isAvailable(key, available)),
    more: EVENT_GRID_MORE.filter((key) => isAvailable(key, available)),
  };
}
