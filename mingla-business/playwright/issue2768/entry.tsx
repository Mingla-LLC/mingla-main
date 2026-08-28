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
// Metro-only aliases point directly at the production owners. Keeping these
// imports out of the app graph preserves the two-route production owner.
// @ts-expect-error -- declared by bundle.mjs for this browser harness only.
// eslint-disable-next-line import/no-unresolved
import { PublicVenueScreen } from "issue2768-real-public-venue";
// @ts-expect-error -- declared by bundle.mjs for this browser harness only.
// eslint-disable-next-line import/no-unresolved
import { ConsentBanner } from "issue2768-real-consent-banner";

type Issue2768Topology = "business-preview" | "buyer-host";

declare global {
  interface Window {
    __issue2768ConsentOwnerName: string;
    __issue2768Topology: Issue2768Topology;
    __issue2768VenueAnalytics: PublicVenueAnalyticsEvent[];
  }
}

const topology: Issue2768Topology = window.location.pathname.startsWith(
  "/buyer-host",
)
  ? "buyer-host"
  : "business-preview";

const venue: PublicVenueViewModel = {
  id: "issue-2768-venue",
  brandId: "issue-2768-brand",
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

window.__issue2768Topology = topology;
window.__issue2768ConsentOwnerName = ConsentBanner.name;
window.__issue2768VenueAnalytics = [];

function Harness(): React.ReactElement {
  return (
    <View style={{ flex: 1 }} testID={`issue-2768-topology-${topology}`}>
      <PublicVenueScreen
        venue={venue}
        discoveryPrice={null}
        menu={[
          {
            menuId: "issue-2768-menu",
            menuName: "Main menu",
            menuDescription: null,
            items: [
              {
                id: "issue-2768-item",
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
            <View testID="issue-2768-sheet">
              <Text>Reservation sheet</Text>
            </View>
          ) : null
        }
        onAnalytics={(event: PublicVenueAnalyticsEvent) =>
          window.__issue2768VenueAnalytics.push(event)
        }
        onShare={() => undefined}
        onClose={() => undefined}
        onOpenBrand={() => undefined}
        onOpenMaps={() => undefined}
      />
      <ConsentBanner />
    </View>
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<Harness />);
