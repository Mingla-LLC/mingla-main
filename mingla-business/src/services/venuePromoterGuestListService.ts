/**
 * #4490 07 — the guest list: its row mappers (shared with the Host guest list)
 * and the signed-out promoter page's reads and writes (edge `venue-guest-list`,
 * the link's token is the key). A Guest-side service: it never loads the Host
 * offers service.
 */
import type { PromoterGuestListPage, VenueGuestListEntry, VenueGuestListTerms } from "../types/venueOffers";
import { supabase } from "./supabase";
import { arr, num, numOrNull, obj, str, strOrNull } from "./venueJsonRead";
import { VenueOfferError, edgeError } from "./venueOfferErrors";

export function mapGuestListEntry(v: unknown): VenueGuestListEntry {
  const e = obj(v);
  return {
    id: str(e.id),
    venueId: str(e.venueId),
    localDate: str(e.localDate),
    eventId: strOrNull(e.eventId),
    guestName: str(e.guestName, "Guest"),
    plusOnes: num(e.plusOnes),
    phone: strOrNull(e.phone),
    note: strOrNull(e.note),
    addedByKind: e.addedByKind === "promoter" ? "promoter" : "staff",
    promoterId: strOrNull(e.promoterId),
    promoterName: strOrNull(e.promoterName),
    arrived: num(e.arrived),
    arrivedAt: strOrNull(e.arrivedAt),
    status: e.status === "removed" ? "removed" : "on_list",
    version: num(e.version),
    createdAt: strOrNull(e.createdAt),
  };
}

export function mapGuestListTerms(v: unknown): VenueGuestListTerms {
  const t = obj(v);
  const price = t.reducedPrice === null || t.reducedPrice === undefined ? null : obj(t.reducedPrice);
  return {
    venueId: str(t.venueId),
    freeUntil: strOrNull(t.freeUntil),
    reducedUntil: strOrNull(t.reducedUntil),
    reducedPriceOptionId: strOrNull(t.reducedPriceOptionId),
    reducedPrice:
      price === null
        ? null
        : {
            optionId: str(price.optionId),
            offeringId: str(price.offeringId),
            name: str(price.name),
            priceMinor: num(price.priceMinor),
            currencyCode: strOrNull(price.currencyCode),
          },
    plusOnesMax: num(t.plusOnesMax, 3),
    closesMinutesBefore: num(t.closesMinutesBefore, 60),
    version: num(t.version),
    opensAt: strOrNull(t.opensAt),
    closesAt: strOrNull(t.closesAt),
  };
}

function mapPromoterGuestListPage(v: unknown): PromoterGuestListPage {
  const d = obj(v);
  const promoter = obj(d.promoter);
  const venue = obj(d.venue);
  return {
    promoter: { id: str(promoter.id), name: str(promoter.name), namesPerNight: numOrNull(promoter.namesPerNight) },
    venue: { id: str(venue.id), name: str(venue.name) },
    today: str(d.today),
    lastDate: str(d.lastDate),
    nights: arr(d.nights).map((n) => {
      const night = obj(n);
      return {
        localDate: str(night.localDate),
        terms: mapGuestListTerms(night.terms),
        entries: arr(night.entries).map(mapGuestListEntry),
      };
    }),
  };
}

async function promoterGuestListEdge(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("venue-guest-list", { body });
  if (error) throw await edgeError(error as { message?: string; context?: unknown });
  const envelope = obj(data);
  if (envelope.kind !== "success") throw new VenueOfferError(str(envelope.code, "guest_list_failed"));
  return envelope.data;
}

export async function fetchPromoterGuestList(token: string): Promise<PromoterGuestListPage> {
  return mapPromoterGuestListPage(await promoterGuestListEdge({ action: "get", token }));
}

export async function writePromoterGuestList(input: {
  token: string;
  action: "add" | "remove";
  localDate: string;
  guestName?: string;
  plusOnes?: number;
  phone?: string;
  entryId?: string;
}): Promise<VenueGuestListEntry> {
  const data = obj(await promoterGuestListEdge(input));
  return mapGuestListEntry(data.entry);
}
