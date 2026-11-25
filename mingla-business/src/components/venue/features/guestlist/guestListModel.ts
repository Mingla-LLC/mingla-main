/** Pure copy/model helpers for #4490 07-I promoter guest lists. */
import { toVenueOfferError } from "../../../../services/venueOfferErrors";
import type { PromoterGuestListPage } from "../../../../types/venueOffers";
import { money } from "../offers/offerMoney";

export function promoterGuestListErrorCopy(error: unknown): string {
  const code = toVenueOfferError(error).code;
  if (code === "guest_list_closed") return "The list for tonight has closed.";
  if (code === "already_on_list") return "That name is already on the list for this night.";
  if (code === "guest_list_night_limit") return "You've reached your name limit for this night.";
  if (code === "guest_list_rate_limited") return "Too many names were added at once. Wait a while and try again.";
  if (code === "guest_list_entry_arrived") return "That guest has already arrived, so the name can't be removed.";
  if (code === "guest_list_link_not_found") return "This promoter link is no longer active.";
  if (code === "guest_list_hours_missing") return "This venue hasn't set its opening time for that night yet.";
  return "That didn't work. Check your connection and try again.";
}

export function promoterGuestListTermsLine(page: PromoterGuestListPage, date: string): string | null {
  const terms = page.nights.find((night) => night.localDate === date)?.terms;
  if (terms === undefined) return null;
  const free = terms.freeUntil === null ? null : `Free before ${terms.freeUntil}`;
  const reduced =
    terms.reducedUntil === null || terms.reducedPrice === null
      ? null
      : `${money(terms.reducedPrice.priceMinor, terms.reducedPrice.currencyCode)} before ${terms.reducedUntil}`;
  return [free, reduced].filter((part): part is string => part !== null).join(", ") || null;
}
