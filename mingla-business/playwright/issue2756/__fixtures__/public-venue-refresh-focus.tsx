import React from "react";
// This repository intentionally does not install @types/react-dom; the runtime
// package is present and this browser-only regression harness uses its real API.
// @ts-expect-error -- react-dom/client has no declaration in this workspace.
import { createRoot } from "react-dom/client";
import { Text } from "react-native";

import {
  PublicVenueScreen,
  type PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";

const VENUE: PublicVenueViewModel = {
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "gogilagos",
  brandName: "Gogi Lagos",
  slug: "gogi",
  name: "Gogi",
  address: null,
  city: "Lagos",
  lat: 6.4281,
  lng: 3.4219,
  venueCategory: "restaurant",
  coverMediaUrl: null,
  coverMediaType: null,
  theme: { color: "#ba5d18", font: "inter", animation: null },
  hours: [],
  timezone: "Africa/Lagos",
  galleryPhotoUrls: [],
  pitch: null,
};

declare global {
  interface Window {
    issue2756?: {
      succeed: () => void;
      fail: () => void;
      calls: () => number;
    };
  }
}

function Harness(): React.ReactElement {
  const [refreshState, setRefreshState] = React.useState<"ready" | "error">(
    "error",
  );
  const [errorVersion, setErrorVersion] = React.useState(1);
  const settleRef = React.useRef<(() => void) | null>(null);
  const callCountRef = React.useRef(0);

  React.useEffect(() => {
    window.issue2756 = {
      succeed: () => {
        setRefreshState("ready");
        settleRef.current?.();
        settleRef.current = null;
      },
      fail: () => {
        setErrorVersion((value) => value + 1);
        setRefreshState("error");
        settleRef.current?.();
        settleRef.current = null;
      },
      calls: () => callCountRef.current,
    };
    return () => {
      delete window.issue2756;
    };
  }, []);

  const retry = (): Promise<void> => {
    callCountRef.current += 1;
    return new Promise<void>((resolve) => {
      settleRef.current = resolve;
    });
  };

  return (
    <>
      <button id="issue-2756-elsewhere">Elsewhere</button>
      <PublicVenueScreen
        venue={VENUE}
        discoveryPrice={null}
        menu={[]}
        menuLifecycle={{
          state: "ready",
          isFetching: false,
          onRetry: () => undefined,
        }}
        reservable={{ reservable: true, venueId: VENUE.id, currency: "NGN" }}
        reservabilityState="ready"
        initialTab="reservations"
        refreshState={refreshState}
        refreshErrorVersion={errorVersion}
        onRetryRefresh={retry}
        safeAreaInsets={{ top: 0, bottom: 0 }}
        loadThemeFont={() => undefined}
        bookingBody={() => <Text>Reservation fixture</Text>}
        reservationSheet={() => null}
        onAnalytics={() => undefined}
        onShare={() => undefined}
        onClose={() => undefined}
        onOpenBrand={() => undefined}
        onOpenMaps={() => undefined}
      />
    </>
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<Harness />);
