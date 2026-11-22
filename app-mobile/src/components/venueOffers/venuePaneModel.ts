/**
 * #4490 Explorer W3 — the native venue page panes (Entry, Groups, Private hire,
 * By the hour, Plans), as pure data.
 *
 * Every row lists one live offer (or plan) from the page payload: its name,
 * the host's short line, the server's "from" price (display only, never sent
 * back), whether it is sold out (from the `availability` read), and its book
 * button. The words are the venue page's own: prices as "Ways to come" writes
 * them ("from ₦4,000", "from ₦12,000 a guest", "from ₦5,000 an hour"), button
 * verbs from the approved design (Buy, Book, Ask, Join), the bar's button the
 * lead verbs the deck already uses (DECK_CTA_LABEL_KEYS). No price, fee or
 * total is computed here.
 */
import {
  venueLocalDay,
  type VenueFeatureOfferView,
  type VenueFeaturePlanView,
  type VenueOfferKind,
} from "@mingla/brand-rendering/venueFeaturePage";
import { parseEntryDayRows } from "@mingla/brand-rendering/venueOffers/entryModel";
import { parseHireDayRows } from "@mingla/brand-rendering/venueOffers/hireModel";

export type VenuePaneKind = "entry" | "groups" | "hire" | "by_the_hour" | "plans";

export const PANE_OFFER_KIND: Record<Exclude<VenuePaneKind, "plans">, VenueOfferKind> = {
  entry: "entry",
  groups: "group_package",
  hire: "private_hire",
  by_the_hour: "by_the_hour",
};

/** "Sold out today" / "Closed today" while a later day in the window is still open. */
export type PaneTodayTag = "Sold out today" | "Closed today";

/** One offer's availability read. */
export type OfferAvailability =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly offline: boolean }
  | { readonly state: "ready"; readonly soldOut: boolean; readonly todayTag?: PaneTodayTag | null };

/** What one availability read says about the window and about today. */
export interface AvailabilitySummary {
  readonly soldOut: boolean;
  readonly todayTag: PaneTodayTag | null;
}

export interface VenuePaneRow {
  readonly id: string;
  readonly name: string;
  readonly line: string | null;
  readonly price: string;
  readonly actionLabel: string;
  readonly soldOut: boolean;
  /** Today is full or closed while a later day is open (the row stays bookable). */
  readonly todayTag: PaneTodayTag | null;
  /** Still checking what is left: the button waits (spinner), never a dead tap. */
  readonly checking: boolean;
  readonly offerKind: VenueOfferKind | null;
  /** The cheapest "from" price (minor units), for picking the bar's offer. */
  readonly fromMinor: number;
}

export type VenuePaneStatus = "empty" | "loading" | "error" | "offline" | "ready";

export type MoneyText = (minor: number, currencyCode: string, exponent: number) => string;

/** How many venue days the panes look ahead for "Sold out" (today + 13). */
export const PANE_AVAILABILITY_DAYS = 14;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return at.toISOString().slice(0, 10);
}

/**
 * The venue days the panes ask about: today in the venue's zone (the device's
 * own day only when the zone is unknown) for `PANE_AVAILABILITY_DAYS` days.
 */
export function paneAvailabilityWindow(now: Date, timeZone: string | null | undefined): { from: string; to: string } {
  const venueToday = venueLocalDay(now, timeZone)?.date ?? null;
  const from =
    venueToday !== null && DATE_ONLY.test(venueToday)
      ? venueToday
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { from, to: addDays(from, PANE_AVAILABILITY_DAYS - 1) };
}

/**
 * Sold out = no day in the window is bookable and at least one day is full
 * (sold out, taken or on hold). Closed or too-far days alone are not "sold
 * out": the page does not claim what it does not know.
 */
export function soldOutFromAvailability(kind: VenueOfferKind, raw: unknown): boolean {
  return availabilitySummary(kind, raw, null).soldOut;
}

/**
 * The window (sold out, as above) and today (the venue's own first day of the
 * window, `today`): "Sold out today" when today has no open time and at least
 * one full one, "Closed today" when today is closed or not sold, each only
 * while a LATER day is still open (the guest can pick it; the row stays
 * bookable). Only the server's day rows are read.
 */
export function availabilitySummary(kind: VenueOfferKind, raw: unknown, today: string | null): AvailabilitySummary {
  const rows: Array<{ localDate: string; status: string }> =
    kind === "private_hire" ? parseHireDayRows(raw) : parseEntryDayRows(raw);
  const full = (status: string): boolean =>
    kind === "private_hire" ? status === "taken" || status === "held" : status === "sold_out" || status === "taken";
  const soldOut = !rows.some((r) => r.status === "available") && rows.some((r) => full(r.status));
  if (soldOut || today === null) return { soldOut, todayTag: null };
  const todays = rows.filter((r) => r.localDate === today);
  const laterOpen = rows.some((r) => r.localDate > today && r.status === "available");
  if (!laterOpen || todays.some((r) => r.status === "available")) return { soldOut, todayTag: null };
  if (todays.some((r) => full(r.status))) return { soldOut, todayTag: "Sold out today" };
  if (todays.length === 0 || todays.every((r) => r.status === "closed" || r.status === "wrong_weekday")) {
    return { soldOut, todayTag: "Closed today" };
  }
  return { soldOut, todayTag: null };
}

function offerPrice(kind: Exclude<VenuePaneKind, "plans">, offer: VenueFeatureOfferView, money: (minor: number) => string): string {
  switch (kind) {
    case "groups":
      return offer.unit === "booking" ? `from ${money(offer.fromMinor)}` : `from ${money(offer.fromMinor)} a guest`;
    case "by_the_hour":
      return `from ${money(offer.fromMinor)} an hour`;
    case "entry":
      // §6: free entry reads "Free entry", never "from ₦0".
      return offer.fromMinor === 0 ? "Free entry" : `from ${money(offer.fromMinor)}`;
    case "hire":
      // W3 fix 2 (W3-N17): the price's own unit ("an hour" for an hourly row).
      return `from ${money(offer.fromMinor)}${offer.unit === "hour" ? " an hour" : ""}`;
    default: {
      const never: never = kind;
      return never;
    }
  }
}

function offerAction(kind: Exclude<VenuePaneKind, "plans">, offer: VenueFeatureOfferView): string {
  switch (kind) {
    case "entry":
      return offer.entryStyle === "timed_session" ? "Book" : "Buy";
    case "hire":
      return offer.confirmationMode === "request" ? "Ask" : "Book";
    case "groups":
    case "by_the_hour":
      return "Book";
    default: {
      const never: never = kind;
      return never;
    }
  }
}

export function offerPaneRows(
  kind: Exclude<VenuePaneKind, "plans">,
  offers: readonly VenueFeatureOfferView[],
  availability: ReadonlyMap<string, OfferAvailability>,
  currency: { code: string; exponent: number },
  moneyText: MoneyText,
): VenuePaneRow[] {
  const money = (minor: number): string => moneyText(minor, currency.code, currency.exponent);
  return offers
    .filter((o) => o.kind === PANE_OFFER_KIND[kind])
    .map((offer) => {
      const read = availability.get(offer.id);
      return {
        id: offer.id,
        name: offer.name,
        line: offer.summary,
        price: offerPrice(kind, offer, money),
        actionLabel: offerAction(kind, offer),
        soldOut: read?.state === "ready" && read.soldOut,
        todayTag: read?.state === "ready" ? read.todayTag ?? null : null,
        checking: read === undefined || read.state === "loading",
        offerKind: offer.kind,
        fromMinor: offer.fromMinor,
      };
    });
}

export function planPaneRows(
  plans: readonly VenueFeaturePlanView[],
  currency: { code: string; exponent: number },
  moneyText: MoneyText,
): VenuePaneRow[] {
  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    line: plan.summary,
    price: `${moneyText(plan.priceMinor, currency.code, currency.exponent)} ${plan.period === "year" ? "a year" : "a month"}`,
    actionLabel: "Join",
    // A full plan is shown, not joinable (the page payload's own `full`).
    soldOut: plan.full,
    todayTag: null,
    checking: false,
    offerKind: null,
    fromMinor: plan.priceMinor,
  }));
}

/** The pane's state: what the screen shows above (or instead of) the rows. */
export function paneStatus(
  rows: readonly VenuePaneRow[],
  reads: readonly OfferAvailability[],
): VenuePaneStatus {
  if (rows.length === 0) return "empty";
  if (reads.some((r) => r.state === "error" && r.offline)) return "offline";
  if (reads.some((r) => r.state === "error")) return "error";
  if (reads.some((r) => r.state === "loading")) return "loading";
  return "ready";
}

/**
 * The bar's button for a pane: the ACTIVE tab's own verb, handed in by the
 * shared page (`deriveVenuePage` → `tabVerbs`, one owner for buyer web and
 * the app). W3 fix 3 (W3-N22/N27): this pane no longer keeps its own list
 * (it said "Book a room" for a pool table).
 */
export function paneBarLabel(
  _kind: VenuePaneKind,
  _rows: readonly VenuePaneRow[],
  _offers: readonly VenueFeatureOfferView[],
  tabVerb: string,
): string {
  return tabVerb;
}

/**
 * The docked bar on this tab: the cheapest row that can still be booked (its
 * name over its price) and the tab's verb. Null when nothing can be booked
 * (every row sold out, or no rows): the rows say why.
 */
export function paneBar(
  kind: VenuePaneKind,
  rows: readonly VenuePaneRow[],
  offers: readonly VenueFeatureOfferView[],
  tabVerb: string,
): { title: string; subtitle: string; ctaLabel: string; enabled: boolean; rowId: string } | null {
  const open = rows.filter((r) => !r.soldOut);
  if (open.length === 0) return null;
  const pick = [...open].sort((a, b) => a.fromMinor - b.fromMinor)[0];
  if (pick === undefined) return null;
  return {
    title: pick.name,
    subtitle: pick.price,
    ctaLabel: paneBarLabel(kind, rows, offers, tabVerb),
    enabled: !pick.checking,
    rowId: pick.id,
  };
}

/** §5/§6 words for each state (exact). */
export const PANE_COPY = {
  empty: "Nothing to book here right now.",
  error: "Something went wrong. Try again.",
  offline: "You're offline. Check your connection and try again.",
  retry: "Try again",
  soldOut: "Sold out",
  // W3 fix 1: the approved design's row tag, and the venue page's own words.
  soldOutToday: "Sold out today",
  closedToday: "Closed today",
} as const;
