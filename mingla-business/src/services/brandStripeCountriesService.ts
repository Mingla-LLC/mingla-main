/**
 * brandStripeCountriesService — surface the canonical 34-country list to UI.
 *
 * Per B2a Path C V3 SPEC §3 + I-PROPOSED-T enforcement.
 *
 * The canonical list lives in `src/constants/stripeSupportedCountries.ts`
 * (frontend mirror of `supabase/functions/_shared/stripeSupportedCountries.ts`).
 * This service exists so the UI fetches the list through a stable interface
 * (matches the pattern used by other Stripe services) and so future expansion
 * — e.g., remote-config-driven country gating — can swap implementation
 * without changing call sites.
 *
 * Today this is a pure synchronous read of the constant. Wrapped in a Promise
 * to keep the React Query consumption pattern uniform with the other services.
 */

import {
  STRIPE_SUPPORTED_COUNTRIES,
  type StripeSupportedCountry,
} from "../constants/stripeSupportedCountries";

export type BrandStripeCountry = StripeSupportedCountry;

export async function fetchBrandStripeCountries(): Promise<
  readonly BrandStripeCountry[]
> {
  // Synchronous today; promise wrapper keeps the hook contract uniform
  // and leaves room for a remote-config swap without ripping the call sites.
  return Promise.resolve(STRIPE_SUPPORTED_COUNTRIES);
}
