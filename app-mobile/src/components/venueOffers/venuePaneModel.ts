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

/** One offer's availability read. */
export type OfferAvailability =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly offline: boolean }
  | { readonly state: "ready"; readonly soldOut: boolean };

export interface VenuePaneRow {
  readonly id: string;
  readonly name: string;
  readonly line: string | null;
  readonly price: string;
  readonly actionLabel: string;
  readonly soldOut: boolean;
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
  if (kind === "private_hire") {
    const rows = parseHireDayRows(raw);
    return !rows.some((r) => r.status === "available") && rows.some((r) => r.status === "taken" || r.status === "held");
  }
  const rows = parseEntryDayRows(raw);
  return !rows.some((r) => r.status === "available") && rows.some((r) => r.status === "sold_out" || r.status === "taken");
}

function offerPrice(kind: Exclude<VenuePaneKind, "plans">, offer: VenueFeatureOfferView, money: (minor: number) => string): string {
  switch (kind) {
    case "groups":
      return offer.unit === "booking" ? `from ${money(offer.fromMinor)}` : `from ${money(offer.fromMinor)} a guest`;
    case "by_the_hour":
      return `from ${money(offer.fromMinor)} an hour`;
    case "entry":
    case "hire":
      return `from ${money(offer.fromMinor)}`;
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

/** The bar's button for a pane: the lead verbs the deck and the page already use. */
export function paneBarLabel(
  kind: VenuePaneKind,
  rows: readonly VenuePaneRow[],
  offers: readonly VenueFeatureOfferView[],
  entryVerb: string,
): string {
  switch (kind) {
    case "entry":
      return entryVerb;
    case "groups":
      return "Book for a group";
    case "hire":
      return offers.some((o) => o.kind === "private_hire" && o.confirmationMode === "request" && rows.some((r) => r.id === o.id))
        ? "Ask about a date"
        : "Book a date";
    case "by_the_hour":
      return "Book a room";
    case "plans":
      return "Join";
    default: {
      const never: never = kind;
      return never;
    }
  }
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
  entryVerb: string,
): { title: string; subtitle: string; ctaLabel: string; enabled: boolean; rowId: string } | null {
  const open = rows.filter((r) => !r.soldOut);
  if (open.length === 0) return null;
  const pick = [...open].sort((a, b) => a.fromMinor - b.fromMinor)[0];
  if (pick === undefined) return null;
  return {
    title: pick.name,
    subtitle: pick.price,
    ctaLabel: paneBarLabel(kind, rows, offers, entryVerb),
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
} as const;
