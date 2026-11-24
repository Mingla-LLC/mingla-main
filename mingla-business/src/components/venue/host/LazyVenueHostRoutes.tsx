/**
 * #4490 — the full-screen Host venue routes' only way to their screens. Each
 * resolves `loadVenueHostScreens` (the one Host venue owner), with a retry on
 * a failed load. Import-light: the route chunks import this file.
 *
 * Every route sits on the dark canvas while its screen loads (and if the load
 * fails), so web never flashes the light page behind "Loading the Till".
 */
import { StyleSheet } from "react-native";

import { color } from "../../../constants/designSystem";
import { createRetryableLazyErrorBoundary } from "../../ui/RetryableLazyBoundary";
import { loadVenueHostScreens } from "./venueHostOwner";
import type { VenueHostRouteProps } from "./venueHostRouteProps";

const styles = StyleSheet.create({
  routeSurface: { flex: 1, backgroundColor: color.canvas },
});

export const LazyVenueTillRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueTillRouteScreen }),
  { loadingLabel: "Loading the Till", style: styles.routeSurface },
);

export const LazyVenueDayCloseRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueDayCloseRouteScreen }),
  { loadingLabel: "Loading Close the day", style: styles.routeSurface },
);

export const LazyVenueTillSettingsRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueTillSettingsRouteScreen }),
  { loadingLabel: "Loading Selling in person", style: styles.routeSurface },
);

export const LazyVenueStationRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueStationRouteScreen }),
  { loadingLabel: "Loading Kitchen and bar", style: styles.routeSurface },
);

export const LazyVenueOfferEditorRoute = createRetryableLazyErrorBoundary<VenueHostRouteProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueOfferEditorRouteScreen }),
  { loadingLabel: "Loading the offer", style: styles.routeSurface },
);
