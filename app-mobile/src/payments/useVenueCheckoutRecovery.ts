/**
 * #4490 Explorer W4 (spec 06 W4 rule 4) — the venue checkout recovery check:
 * on app start (the root layout) and on Purchases focus, a live venue pointer
 * for the signed-in account is answered once by the server (`confirm_return`
 * for a booking, `membership_get` for a plan) and cleared; a foreign or
 * expired pointer is cleared without a call. Purchases is refreshed through
 * its key factory after an answer. Never throws into the screen.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryClient as appQueryClient } from "../config/queryClient";
import { purchaseKeys } from "../hooks/queryKeys";
import { venueOfferCheckoutService } from "../services/venueOfferCheckoutService";
import { clearVenueCheckoutRecovery, readVenueCheckoutRecovery } from "./nativeCheckoutRecovery";
import { recoverVenueCheckout } from "./venueOfferCheckoutRunner";

/** One check at a time per app instance (start and focus can race). */
let inFlight: Promise<unknown> | null = null;

export function runVenueCheckoutRecovery(
  accountId: string | null,
  onAnswered: () => void = () => {
    void appQueryClient.invalidateQueries({ queryKey: purchaseKeys.all });
  },
): Promise<unknown> {
  if (inFlight !== null) return inFlight;
  inFlight = recoverVenueCheckout(
    {
      readPointer: () => readVenueCheckoutRecovery(),
      clearPointer: () => clearVenueCheckoutRecovery(),
      confirmOffer: (groupId) => venueOfferCheckoutService.confirmReturn(groupId),
      readMember: (subscriptionId) => venueOfferCheckoutService.membershipGet(subscriptionId),
      onAnswered,
    },
    accountId,
  )
    .catch(() => "no_answer")
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Run the check whenever `when` turns true for a signed-in account (start, focus). */
export function useVenueCheckoutRecovery(accountId: string | null, when: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!when || accountId === null) return;
    void runVenueCheckoutRecovery(accountId, () => {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
    });
  }, [accountId, queryClient, when]);
}
