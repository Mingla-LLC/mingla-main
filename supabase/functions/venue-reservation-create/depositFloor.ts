/**
 * Issue #3645 (18 Nov payments audit, item 7 follow-through) — a reservation
 * fee or table hold that is above zero but below the smallest amount the
 * payment provider can charge in its currency (for example a ₦50 deposit, or
 * a ₦150 deposit a discount brings to ₦60) is refused before any discount use
 * is reserved, any session row is written or any provider is called. Without
 * this the amount reached Paystack / Stripe and failed there, and the guest
 * saw "Couldn't reserve. Try again."
 *
 * Same floor table and rule as the chip-in, guest venue order and staff
 * bill-to-phone refusals (`_shared/money/providerMinimums.ts`,
 * `chargeBelowProviderMinimum`). Guest copy lives in the shared
 * `packages/brand-rendering/venueGuestReservationErrorCopy.ts`.
 */
import { chargeBelowProviderMinimum } from "../_shared/money/providerMinimums.ts";

export const RESERVATION_BELOW_PROVIDER_MINIMUM =
  "reservation_below_provider_minimum" as const;

export interface ReservationProviderFloorRefusal {
  status: 422;
  body: {
    error: typeof RESERVATION_BELOW_PROVIDER_MINIMUM;
    minCents: number;
    currency: string;
  };
}

/**
 * The refusal leaves no row, so this structured warning is the only trace a
 * venue whose fee or table hold sits under the floor leaves: every paid
 * booking there fails until the venue raises it. Ops finds them by
 * `reservation_below_provider_minimum` in the function logs.
 */
export function logReservationFloorRefusal(input: {
  venueId: string;
  brandId: string;
  provider: "paystack" | "stripe";
  chargedTotalCents: number;
  depositListCents: number;
  discountCents: number;
  refusal: ReservationProviderFloorRefusal;
}): void {
  console.warn("[venue-reservation-create] reservation_below_provider_minimum", {
    venueId: input.venueId,
    brandId: input.brandId,
    provider: input.provider,
    currency: input.refusal.body.currency,
    chargedTotalCents: input.chargedTotalCents,
    minCents: input.refusal.body.minCents,
    depositListCents: input.depositListCents,
    discountCents: input.discountCents,
  });
}

/**
 * `chargedTotalCents` is the exact amount the arm sends to the provider and
 * `chargeCurrency` the currency it sends it in (NGN on Paystack). null lets
 * the charge through: free, at or above the floor, or a currency with no
 * known floor.
 */
export function reservationProviderFloorRefusal(
  chargedTotalCents: number,
  chargeCurrency: string,
): ReservationProviderFloorRefusal | null {
  const minCents = chargeBelowProviderMinimum(chargedTotalCents, chargeCurrency);
  if (minCents === null) return null;
  return {
    status: 422,
    body: {
      error: RESERVATION_BELOW_PROVIDER_MINIMUM,
      minCents,
      currency: chargeCurrency.trim().toUpperCase(),
    },
  };
}
