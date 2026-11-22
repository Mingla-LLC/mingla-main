import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { VenueFeatureOfferView } from "@mingla/brand-rendering/venueFeaturePage";

import { getVenueOfferAvailability, VenuePurchaseError } from "../../services/venuePurchaseService";
import {
  availabilitySummary,
  type AvailabilitySummary,
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
      // The window's first day is the venue's today (paneAvailabilityWindow).
      queryFn: async (): Promise<AvailabilitySummary> =>
        availabilitySummary(
          offer.kind,
          await getVenueOfferAvailability({ offeringId: offer.id, from: window.from, to: window.to }),
          window.from,
        ),
      staleTime: 60 * 1000,
      // W3 fix 3 (W3-N25): a read that timed out or got no answer while the
      // phone is online is not retried behind a spinner: the pane says so at
      // once and "Try again" asks again.
      retry: (failureCount: number, error: unknown) =>
        failureCount < 1 &&
        !(error instanceof VenuePurchaseError && (error.code === "venue_unreachable" || error.code === "offline")),
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
          ? { state: "ready", soldOut: result.data?.soldOut === true, todayTag: result.data?.todayTag ?? null }
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
