import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient } from "@tanstack/react-query";

import { venueFeatureKeys } from "../../../hooks/venueFeatureKeys";
import type { VenueOffer, VenueOffersState } from "../../../types/venueOffers";
import {
  venueOffersStateWithOffer,
  writeVenueOfferToCache,
} from "../features/offers/venueOfferCache";

const offer = (id: string, status: VenueOffer["status"]): VenueOffer =>
  ({ id, venueId: "venue-1", name: id, status }) as VenueOffer;

const state = (offers: VenueOffer[]): VenueOffersState =>
  ({
    venueId: "venue-1",
    canCollectOnline: true,
    flags: { reads: true, writes: true },
    settings: null,
    pools: [],
    offers,
  });

describe("#4490 truthful offer publishing", () => {
  it("replaces the published offer immediately without disturbing list order", () => {
    const before = state([offer("first", "draft"), offer("second", "draft")]);
    const after = venueOffersStateWithOffer(before, offer("first", "live"));

    expect(after?.offers.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "first", status: "live" },
      { id: "second", status: "draft" },
    ]);
  });

  it("writes the authoritative mutation response into the canonical query cache", () => {
    const client = new QueryClient();
    const key = venueFeatureKeys.offers("brand-1", "venue-1");
    client.setQueryData(key, state([offer("first", "draft")]));

    writeVenueOfferToCache(client, "brand-1", "venue-1", offer("first", "live"));

    expect(client.getQueryData<VenueOffersState>(key)?.offers[0].status).toBe("live");
  });

  it("also appends a newly returned offer and leaves an unloaded cache unloaded", () => {
    expect(venueOffersStateWithOffer(state([]), offer("new", "live"))?.offers).toHaveLength(1);
    expect(venueOffersStateWithOffer(undefined, offer("new", "live"))).toBeUndefined();
  });

  it("applies the same immediate-cache contract to every shipped offer editor", () => {
    for (const editor of ["EntryEditor", "PackageEditor", "HireEditor", "HourEditor"]) {
      const source = readFileSync(resolve(__dirname, `../features/offers/${editor}.tsx`), "utf8");
      expect(source).toContain("writeVenueOfferToCache(queryClient, brandId, venueId,");
    }
  });
});
