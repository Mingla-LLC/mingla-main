/**
 * #4490 — the guest venue routes' only way to their screens: each resolves
 * `loadVenueGuestScreens` (the one Guest venue owner), with a retry on a
 * failed load. Import-light: the route chunks import this file.
 */
import { createRetryableLazyErrorBoundary } from "../../ui/RetryableLazyBoundary";
import type { VisitGuestListProps } from "../features/guestlist/VisitGuestList";
import type { VisitBookingProps } from "../offers/VisitBooking";
import type { VisitMembershipProps } from "../offers/VisitMembership";
import type { VisitWaitlistProps } from "../offers/VisitWaitlist";
import { loadVenueGuestScreens } from "./venueGuestOwner";
import type { VenueOfferBookRouteScreenProps } from "./VenueOfferBookRouteScreen";

export const LazyVisitBooking = createRetryableLazyErrorBoundary<VisitBookingProps>(
  async () => ({ default: (await loadVenueGuestScreens()).VisitBooking }),
  { loadingLabel: "Loading your booking" },
);

export const LazyVisitMembership = createRetryableLazyErrorBoundary<VisitMembershipProps>(
  async () => ({ default: (await loadVenueGuestScreens()).VisitMembership }),
  { loadingLabel: "Loading your plan" },
);

export const LazyVisitWaitlist = createRetryableLazyErrorBoundary<VisitWaitlistProps>(
  async () => ({ default: (await loadVenueGuestScreens()).VisitWaitlist }),
  { loadingLabel: "Loading your place in line" },
);

export const LazyVisitGuestList = createRetryableLazyErrorBoundary<VisitGuestListProps>(
  async () => ({ default: (await loadVenueGuestScreens()).VisitGuestList }),
  { loadingLabel: "Loading the guest list" },
);

export const LazyVenueOfferBookRoute = createRetryableLazyErrorBoundary<VenueOfferBookRouteScreenProps>(
  async () => ({ default: (await loadVenueGuestScreens()).VenueOfferBookRouteScreen }),
  { loadingLabel: "Loading checkout" },
);
