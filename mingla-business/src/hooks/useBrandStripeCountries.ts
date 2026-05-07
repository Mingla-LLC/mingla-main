/**
 * useBrandStripeCountries — supplies the canonical 34-country list to UI.
 *
 * Per B2a Path C V3 SPEC §3 + I-PROPOSED-T.
 *
 * Today this is a synchronous read wrapped in React Query for cache-uniformity
 * with the other Stripe hooks. `staleTime: Infinity` because the list only
 * changes when a SPEC amendment expands it (handled in a separate ORCH cycle
 * with a coordinated DB CHECK constraint update).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchBrandStripeCountries,
  type BrandStripeCountry,
} from "../services/brandStripeCountriesService";

export const brandStripeCountriesKeys = {
  all: ["brand-stripe-countries"] as const,
};

export function useBrandStripeCountries(): UseQueryResult<
  readonly BrandStripeCountry[]
> {
  return useQuery<readonly BrandStripeCountry[]>({
    queryKey: brandStripeCountriesKeys.all,
    staleTime: Infinity,
    queryFn: fetchBrandStripeCountries,
  });
}
