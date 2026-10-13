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

/**
 * One builder per cache entry a creator's "can this brand take payments" answer
 * reads. They are built one at a time so that a key module that is absent (a
 * render suite that partially mocks a hook module) costs that one entry, not
 * the whole refresh.
 */
const brandPaymentStateKeyBuilders: readonly ((
  brandId: string,
) => readonly unknown[])[] = [
  // Trip and experience creators read the single brand.
  (brandId) => brandKeys.detail(brandId),
  // Event and RSVP routes resolve their brand from the account's brand LIST.
  () => brandKeys.lists(),
  (brandId) => brandStripeStatusKeys.detail(brandId),
  (brandId) => brandPaystackKeys.status(brandId),
];

/** Every cache entry a creator's "can this brand take payments" answer reads. */
export const brandPaymentStateQueryKeys = (
  brandId: string,
): readonly (readonly unknown[])[] =>
  brandPaymentStateKeyBuilders.map((build) => build(brandId));

export function refreshBrandPaymentState(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  brandId: string | null | undefined,
): void {
  if (typeof brandId !== "string" || brandId.length === 0) return;
  for (const build of brandPaymentStateKeyBuilders) {
    try {
      void queryClient.invalidateQueries({ queryKey: build(brandId) });
    } catch {
      // Leaving a screen must never fail because a cache refresh did.
    }
  }
}
