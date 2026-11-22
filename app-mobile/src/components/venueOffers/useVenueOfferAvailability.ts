import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { VenueFeatureOfferView } from "@mingla/brand-rendering/venueFeaturePage";

import { getVenueOfferAvailability, VenuePurchaseError } from "../../services/venuePurchaseService";
import {
  soldOutFromAvailability,
  type OfferAvailability,
} from "./venuePaneModel";

/**
 * #4490 Explorer W3 — "Sold out" for a pane's offers: one `availability` read
 * per offer over the venue's next days (no identity needed), keyed through
 * the factory below, never persisted (queryPersistence), cleared with the
 * React Query cache on logout. A failed read is visible (error / offline line
 * with Retry) and never blocks a book button.
 */
export const venueOfferAvailabilityKeys = {
  all: ["venueOfferAvailability"] as const,
  offer: (offeringId: string, from: string, to: string) =>
    [...venueOfferAvailabilityKeys.all, offeringId, from, to] as const,
};

export interface VenueOfferAvailabilityResult {
  readonly byOffer: ReadonlyMap<string, OfferAvailability>;
  readonly reads: readonly OfferAvailability[];
  readonly retry: () => void;
}

export function useVenueOfferAvailability(
  offers: readonly VenueFeatureOfferView[],
  window: { from: string; to: string },
): VenueOfferAvailabilityResult {
  const results = useQueries({
    queries: offers.map((offer) => ({
      queryKey: venueOfferAvailabilityKeys.offer(offer.id, window.from, window.to),
      queryFn: async (): Promise<boolean> =>
        soldOutFromAvailability(
          offer.kind,
          await getVenueOfferAvailability({ offeringId: offer.id, from: window.from, to: window.to }),
        ),
      staleTime: 60 * 1000,
      retry: 1,
    })),
  });
  const stamp = results.map((r) => `${r.status}:${r.dataUpdatedAt}:${r.errorUpdatedAt}`).join("|");
  return useMemo(() => {
    const byOffer = new Map<string, OfferAvailability>();
    const reads: OfferAvailability[] = [];
    results.forEach((result, index) => {
      const offer = offers[index];
      if (offer === undefined) return;
      const read: OfferAvailability =
        result.status === "success"
          ? { state: "ready", soldOut: result.data === true }
          : result.status === "error"
            ? {
                state: "error",
                offline: result.error instanceof VenuePurchaseError && result.error.code === "offline",
              }
            : { state: "loading" };
      byOffer.set(offer.id, read);
      reads.push(read);
    });
    return {
      byOffer,
      reads,
      retry: () => {
        for (const result of results) {
          if (result.status === "error") void result.refetch();
        }
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, offers]);
}
