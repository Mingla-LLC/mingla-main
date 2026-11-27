import type { QueryClient } from "@tanstack/react-query";

import { venueFeatureKeys } from "../../../../hooks/venueFeatureKeys";
import type {
  VenueOffer,
  VenueOffersState,
} from "../../../../types/venueOffers";

/**
 * #4490 truthful publish state: the mutation response is authoritative. Put it
 * in the one offers cache before an editor closes; background invalidation can
 * then reconcile related day/calendar projections without flashing Draft.
 */
export function venueOffersStateWithOffer(
  state: VenueOffersState | undefined,
  offer: VenueOffer,
): VenueOffersState | undefined {
  if (state === undefined) return undefined;
  const index = state.offers.findIndex((candidate) => candidate.id === offer.id);
  if (index < 0) return { ...state, offers: [...state.offers, offer] };
  return {
    ...state,
    offers: state.offers.map((candidate, candidateIndex) =>
      candidateIndex === index ? offer : candidate,
    ),
  };
}

export function writeVenueOfferToCache(
  queryClient: QueryClient,
  brandId: string | null,
  venueId: string | null,
  offer: VenueOffer,
): void {
  if (brandId === null || venueId === null) return;
  queryClient.setQueryData<VenueOffersState>(
    venueFeatureKeys.offers(brandId, venueId),
    (state) => venueOffersStateWithOffer(state, offer),
  );
}
