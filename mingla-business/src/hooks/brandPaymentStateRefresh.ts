/**
 * brandPaymentStateRefresh — issue #3645.
 *
 * A creator screen sends the host to bank setup and gets them back
 * (`utils/bankSetupReturn.ts`). On native, and on an in-app web navigation, the
 * creator was never unmounted, so the brand it holds is the one from BEFORE the
 * bank was connected and Publish would stay disabled until a manual refresh.
 *
 * The bank-setup surfaces call this as they are left (finished, or abandoned
 * half-way), so whatever screen the host lands on re-reads the brand's payment
 * state. A full-page web return needs nothing: the page reloads and every
 * query is fresh.
 *
 * It runs from an unmount cleanup, so it must never throw.
 */

import type { QueryClient } from "@tanstack/react-query";

import { brandKeys } from "./brandKeys";
import { brandPaystackKeys } from "./useBrandPaystack";
import { brandStripeStatusKeys } from "./useBrandStripeStatus";

/** Every cache entry a creator's "can this brand take payments" answer reads. */
export const brandPaymentStateQueryKeys = (
  brandId: string,
): readonly (readonly unknown[])[] => [
  // Trip and experience creators read the single brand.
  brandKeys.detail(brandId),
  // Event and RSVP routes resolve their brand from the account's brand LIST.
  brandKeys.lists(),
  brandStripeStatusKeys.detail(brandId),
  brandPaystackKeys.status(brandId),
];

export function refreshBrandPaymentState(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  brandId: string | null | undefined,
): void {
  if (typeof brandId !== "string" || brandId.length === 0) return;
  for (const queryKey of brandPaymentStateQueryKeys(brandId)) {
    try {
      void queryClient.invalidateQueries({ queryKey });
    } catch {
      // Leaving a screen must never fail because a cache refresh did.
    }
  }
}
