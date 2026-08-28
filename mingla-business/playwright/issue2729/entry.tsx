import React from "react";
// This repository intentionally does not install @types/react-dom; the runtime
// package is present and this browser-only regression harness uses its real API.
// @ts-expect-error -- react-dom/client has no declaration in this workspace.
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import type {
  PublicVenueAnalyticsEvent,
  PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
// The Metro-only alias points directly at the production source file. Keeping
// the runtime harness import out of the app graph preserves #1550's two-route
// production-owner invariant.
// @ts-expect-error -- declared by bundle.mjs for this browser harness only.
import { PublicVenueScreen } from "issue2729-real-public-venue";

declare global {
  interface Window {
    __issue2729Analytics: PublicVenueAnalyticsEvent[];
  }
}

const venue: PublicVenueViewModel = {
  id: "issue-2729-venue",
  brandId: "issue-2729-brand",
  brandSlug: "gogilagos",
  brandName: "Gogi Lagos",
  slug: "gogi",
  name: "Gogi",
  address: "Admiralty Way 69, Lagos 10, Lagos, Nigeria",
  city: "Lagos",
  lat: 6.4281,
  lng: 3.4219,
  venueCategory: "restaurant",
  coverMediaUrl: null,
  coverMediaType: null,
  theme: { color: "#ae591c" },
  timezone: "Africa/Lagos",
  pitch: "A warm neighbourhood restaurant serving guests all day.",
  galleryPhotoUrls: [],
  hours: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openTime: "00:00",
    closeTime: "23:59",
    isClosed: false,
  })),
};

window.__issue2729Analytics = [];

function Harness(): React.ReactElement {
  return (
    <PublicVenueScreen
      venue={venue}
      discoveryPrice={null}
      menu={[
        {
          menuId: "issue-2729-menu",
          menuName: "Main menu",
          menuDescription: null,
          items: [
            {
              id: "issue-2729-item",
              name: "Hamburger",
              description: null,
              priceCents: 1200,
              currency: "NGN",
            },
          ],
        },
      ]}
      reservable={{ reservable: true, venueId: venue.id, currency: "NGN" }}
      reservabilityState="ready"
      safeAreaInsets={{ top: 0, bottom: 0 }}
      loadThemeFont={() => undefined}
      bookingBody={() => (
        <View>
          <Text>Booking body</Text>
        </View>
      )}
      reservationSheet={({ visible }: { visible: boolean }) =>
        visible ? (
          <View testID="issue-2729-sheet">
            <Text>Reservation sheet</Text>
          </View>
        ) : null
      }
      onAnalytics={(event: PublicVenueAnalyticsEvent) =>
        window.__issue2729Analytics.push(event)
      }
      onShare={() => undefined}
      onClose={() => undefined}
      onOpenBrand={() => undefined}
      onOpenMaps={() => undefined}
    />
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<Harness />);
