/**
 * Issue #3645 — a draft with nothing sold follows its brand's currency.
 *
 * The database does the same thing when the brand's currency changes
 * (migration 20270829003645). This is the client half: a draft kept on this
 * device, or a server copy read before that change, must not write the old
 * currency back, and a number typed in one currency is never shown or saved in
 * another.
 *
 *   - The draft has NO currency yet: it takes the brand's currency and keeps
 *     every typed price (they were typed while the screen said "Currency not
 *     set", for this currency).
 *   - The draft has a DIFFERENT currency: it takes the brand's currency and
 *     its paid ticket prices and chip-in amounts are cleared so the host
 *     enters new ones. Free tickets stay free.
 *
 * Pure: no React, no store, no network.
 */
import type { DraftEvent, TicketStub } from "../store/draftEventStore";
import { currencyCodeOrNull } from "./currency";

export interface BrandCurrencyAdoption {
  /** The draft to use from here on (the same object when nothing changed). */
  draft: DraftEvent;
  /** True when the draft's currency was replaced by the brand's. */
  changed: boolean;
  /** True when at least one price or chip-in amount was cleared. */
  pricesCleared: boolean;
}

const clearPaidTicket = (ticket: TicketStub, currency: string): TicketStub => {
  const next: TicketStub = { ...ticket };
  if (ticket.currency !== undefined) next.currency = currency;
  if (!ticket.isFree && ticket.priceGbp !== null) {
    next.priceGbp = null;
    if (ticket.priceAllInGbp !== undefined) next.priceAllInGbp = null;
  }
  return next;
};

/**
 * `brandCurrency` null/undefined/blank means "the brand has no currency, or
 * the caller does not know it": the draft is returned untouched.
 */
export const adoptBrandCurrencyForDraft = (
  draft: DraftEvent,
  brandCurrency: string | null | undefined,
): BrandCurrencyAdoption => {
  const brand = currencyCodeOrNull(brandCurrency);
  if (brand === null) return { draft, changed: false, pricesCleared: false };
  const local = currencyCodeOrNull(draft.currency);
  if (local === brand) return { draft, changed: false, pricesCleared: false };

  // First currency: stamp only, keep what the host typed.
  if (local === null) {
    return {
      draft: { ...draft, currency: brand },
      changed: true,
      pricesCleared: false,
    };
  }

  const hadPaidPrice = draft.tickets.some(
    (ticket) => !ticket.isFree && ticket.priceGbp !== null,
  );
  const hadChipInAmount =
    draft.rsvpContributionSuggestedCents !== null ||
    draft.rsvpContributionMinCents !== null;

  return {
    draft: {
      ...draft,
      currency: brand,
      tickets: draft.tickets.map((ticket) => clearPaidTicket(ticket, brand)),
      rsvpContributionSuggestedCents: null,
      rsvpContributionMinCents: null,
    },
    changed: true,
    pricesCleared: hadPaidPrice || hadChipInAmount,
  };
};

// The currencies an offering can be sold in (supported_brand_currencies).
const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  BGN: "Bulgarian lev",
  CAD: "Canadian dollars",
  CHF: "Swiss francs",
  CZK: "Czech koruna",
  DKK: "Danish kroner",
  EUR: "euros",
  GBP: "British pounds",
  HUF: "Hungarian forint",
  ISK: "Icelandic krónur",
  NGN: "Nigerian naira",
  NOK: "Norwegian kroner",
  PLN: "Polish złoty",
  RON: "Romanian lei",
  SEK: "Swedish kronor",
  USD: "US dollars",
};

/** "Nigerian naira" for NGN; the code itself for a currency with no name here. */
export const currencyPlainName = (currency: string): string => {
  const code = currency.trim().toUpperCase();
  return CURRENCY_NAMES[code] ?? code;
};

/** The one-time notice shown when a draft's prices were cleared. */
export const pricesClearedNotice = (currency: string): string =>
  `Your brand now sells in ${currencyPlainName(currency)}. Enter your prices again.`;
