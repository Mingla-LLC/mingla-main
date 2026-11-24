/**
 * #4490 — the full-screen Host venue routes' only way to their screens. Each
 * resolves `loadVenueHostScreens` (the one Host venue owner), with a retry on
 * a failed load. Import-light: the route chunks import this file.
 */
import { createRetryableLazyErrorBoundary } from "../../ui/RetryableLazyBoundary";
import { loadVenueHostScreens } from "./venueHostOwner";
import type { VenueHostRouteProps } from "./venueHostRouteProps";

export const LazyVenueTillRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueTillRouteScreen }),
  { loadingLabel: "Loading the Till" },
);

export const LazyVenueDayCloseRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueDayCloseRouteScreen }),
  { loadingLabel: "Loading Close the day" },
);

export const LazyVenueTillSettingsRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueTillSettingsRouteScreen }),
  { loadingLabel: "Loading Selling in person" },
);

export const LazyVenueStationRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueStationRouteScreen }),
  { loadingLabel: "Loading Kitchen and bar" },
);

export const LazyVenueOfferEditorRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueOfferEditorRouteScreen }),
  { loadingLabel: "Loading the offer" },
);
