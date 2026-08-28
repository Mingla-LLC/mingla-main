import React from "react";
/* eslint-disable import/no-unresolved -- Metro aliases below are installed by the real-source browser harness. */
// @ts-expect-error -- this browser-only harness uses the installed runtime.
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import type {
  PublicVenueAnalyticsEvent,
  PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
// @ts-expect-error -- aliases are declared by bundle.mjs for this harness only.
import { PublicVenueScreen } from "issue2769-real-public-venue";
// @ts-expect-error -- aliases are declared by bundle.mjs for this harness only.
import { ConsentBanner } from "issue2769-real-consent-banner";
// @ts-expect-error -- aliases are declared by bundle.mjs for this harness only.
import { useWebConsentState } from "issue2769-real-consent-hook";

declare global {
  interface Window {
    __issue2769Analytics: PublicVenueAnalyticsEvent[];
  }
}

const venue: PublicVenueViewModel = {
  id: "issue-2769-venue",
  brandId: "issue-2769-brand",
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

window.__issue2769Analytics = [];

function Harness(): React.ReactElement {
  const webConsentState = useWebConsentState();
  const initialTab = new URLSearchParams(window.location.search).get("tab");
  return (
    <>
      <PublicVenueScreen
        venue={venue}
        webConsentState={webConsentState}
        discoveryPrice={null}
        menu={[{
          menuId: "issue-2769-menu",
          menuName: "Main menu",
          menuDescription: null,
          items: [{
            id: "issue-2769-item",
            name: "Hamburger",
            description: null,
            priceCents: 1200,
            currency: "NGN",
          }],
        }]}
        reservable={{ reservable: true, venueId: venue.id, currency: "NGN" }}
        reservabilityState="ready"
        initialTab={
          initialTab === "menu" || initialTab === "reservations"
            ? initialTab
            : "overview"
        }
        safeAreaInsets={{ top: 0, bottom: 0 }}
        loadThemeFont={() => undefined}
        bookingBody={() => <View><Text>Booking body</Text></View>}
        reservationSheet={({ visible }) =>
          visible ? <View testID="issue-2769-sheet"><Text>Reservation sheet</Text></View> : null
        }
        onAnalytics={(event) => window.__issue2769Analytics.push(event)}
        onShare={() => undefined}
        onClose={() => undefined}
        onOpenBrand={() => undefined}
        onOpenMaps={() => undefined}
      />
      <ConsentBanner />
    </>
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<Harness />);
