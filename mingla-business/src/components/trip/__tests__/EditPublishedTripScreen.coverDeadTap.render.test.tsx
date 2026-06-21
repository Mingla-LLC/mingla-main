/**
 * ORCH-1122 [trip-edit cover dead-tap] — COVER DEAD-TAP RENDER PROOF
 * (mingla-implementor happy-path regression, fails-on-revert).
 *
 * Proven root cause (INVESTIGATE_ORCH-1122): on EditPublishedTripScreen the
 * Cover section's "Change cover"/"Add cover" Button and the
 * <CoverPickerSheet visible={coverPickerVisible}> are BOTH produced inside the
 * memoized `renderSectionBody` useCallback. That callback's dependency array
 * OMITTED `coverPickerVisible`, so after the button's
 * setCoverPickerVisible(true) flipped the flag, React re-rendered the screen
 * but served the CACHED body still closed over `coverPickerVisible === false`.
 * The sheet stayed visible={false} forever → a dead tap (press feedback, no
 * sheet). Operator device-proven 2026-06-12. Isolated to the published-trip
 * EDIT screen.
 *
 * This test is a GENUINE RUNTIME MOUNT of the production EditPublishedTripScreen
 * via @testing-library/react-native. It:
 *   1. expands the Cover accordion section (real handleToggleSection),
 *   2. asserts the cover sheet is initially hidden,
 *   3. fires the real "Add cover…" Button onPress (setCoverPickerVisible(true)),
 *   4. asserts the CoverPickerSheet now receives visible={true} at runtime.
 *
 * The screen, its state, and `renderSectionBody`'s real useCallback memoization
 * are NOT mocked — only the network/native boundary (supabase invoke,
 * expo-router, safe-area, heavy accordion bodies/modals, native chrome
 * primitives) is stubbed. CoverPickerSheet is stubbed to a thin view that
 * SURFACES its `visible` prop via a testID so the assertion reads the prop the
 * real memoized body passes.
 *
 * # Fails-on-revert
 * Delete `coverPickerVisible` from `renderSectionBody`'s dependency array
 * (EditPublishedTripScreen.tsx) → the memoized body is served from cache with
 * the stale `visible={false}` and step 4 goes RED. Verified by true LINE
 * DELETION (not comment-out) at the commit recorded in the implementation
 * report.
 *
 * Run via the worktree-local render config:
 *   npx jest --config jest.orch1122.render.cjs --runInBand
 *
 * New sibling file (append-only safe).
 */

import React from "react";

// ---- Boundary mocks (network / native only — NOT the screen or its state) ----

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = require("react-native");
  return { ScrollView: RN.ScrollView };
});
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));

jest.mock("../../../hooks/useTrips", () => ({
  useUpdateLiveTripFields: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
}));
jest.mock("../../../hooks/useTripHasWebPurchases", () => ({
  useTripHasWebPurchases: () => false,
}));

jest.mock("../../../services/tripChangeNotifier", () => ({
  notifyTripChanged: jest.fn(),
  deriveTripChannelFlags: () => ({}),
}));

jest.mock("../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
}));

// Heavy non-cover accordion bodies + modals → trivial views (imported at module
// top so their native deps must not load; not rendered while Cover is open).
jest.mock("../TripCreatorStep2Itinerary", () => ({
  TripCreatorStep2Itinerary: () => null,
}));
jest.mock("../TripCreatorStep3Inclusions", () => ({
  TripCreatorStep3Inclusions: () => null,
}));
jest.mock("../TripCreatorStep4Pricing", () => ({
  TripCreatorStep4Pricing: () => null,
}));
jest.mock("../InstallmentScheduleDisplay", () => ({
  InstallmentScheduleDisplay: () => null,
}));
jest.mock("../EditPublishedTripIntakeAccordion", () => ({
  EditPublishedTripIntakeAccordion: () => null,
}));
jest.mock("../EditAfterPublishTripBanner", () => ({
  EditAfterPublishTripBanner: () => null,
}));
jest.mock("../../ui/EventCoverMedia", () => ({ EventCoverMedia: () => null }));

// CoverPickerSheet — the UNIT UNDER PROOF receives `visible` from the memoized
// body. Stub it to a thin view that emits a testID ONLY when visible===true so
// the assertion reads the exact prop the real renderSectionBody passes.
jest.mock("../../ui/CoverPickerSheet", () => {
  const RN = require("react-native");
  return {
    CoverPickerSheet: ({ visible }: { visible: boolean }) =>
      visible ? <RN.View testID="cover-picker-sheet-VISIBLE" /> : null,
  };
});

// Native-heavy chrome primitives → thin RN stubs preserving the props the
// assertions/interactions rely on (Button: onPress + accessibilityLabel).
jest.mock("../../ui/Button", () => {
  const RN = require("react-native");
  return {
    Button: ({ label, onPress, testID, disabled, accessibilityLabel }: any) => (
      <RN.Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
      >
        <RN.Text>{label}</RN.Text>
      </RN.Pressable>
    ),
  };
});
jest.mock("../../ui/Toast", () => {
  const RN = require("react-native");
  return {
    Toast: ({ visible, message }: any) =>
      visible ? <RN.Text>{message}</RN.Text> : null,
  };
});
jest.mock("../../ui/Icon", () => {
  const RN = require("react-native");
  return { Icon: () => <RN.View /> };
});
jest.mock("../../ui/IconChrome", () => {
  const RN = require("react-native");
  return { IconChrome: () => <RN.View /> };
});
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/CoverPicker", () => ({ CoverPicker: () => null }));
jest.mock("../../event/ChangeSummaryModal", () => ({
  ChangeSummaryModal: () => null,
}));

// ---- Imports AFTER mocks ----

import { render, screen, fireEvent } from "@testing-library/react-native";
import { EditPublishedTripScreen } from "../EditPublishedTripScreen";
import type { Trip } from "../../../services/tripsService";

// ---- Fixture: a published trip WITHOUT a cover (button reads "Add cover") ----

function makeTrip(): Trip {
  return {
    id: "trip-fixture-1",
    brandId: "brand-1",
    brandSlug: "brand-1",
    title: "The Sone",
    description: "A getaway.",
    slug: "the-sone",
    status: "scheduled",
    visibility: "public",
    publishedAt: "2026-06-01T00:00:00Z",
    timezone: "America/New_York",
    coverMediaUrl: null,
    coverMediaType: null,
    businessTrip: {
      startAt: "2026-08-01T00:00:00Z",
      endAt: "2026-08-05T00:00:00Z",
      destinationPlaceId: "place-dest",
      destinationLocationText: "Tulum, Quintana Roo, Mexico",
      destinationLat: 20.21,
      destinationLng: -87.46,
      departurePlaceId: "place-dep",
      departureLocationText: "Washington, DC, USA",
      departureLat: 38.9,
      departureLng: -77.03,
      capacity: 10,
    },
    days: [],
    pricingTiers: [
      {
        id: "tier-1",
        eventId: "trip-fixture-1",
        ticketTypeId: "tt-1",
        tierName: "Standard",
        tierMetadata: {},
        priceCents: 50000,
        currency: "USD",
        quantityTotal: 10,
        ticketsRemaining: 10,
        isUnlimited: false,
        installmentSchedule: null,
        description: null, // [TEST-MOD-APPROVED META-ORCH-1174]
      },
    ],
    inclusions: [],
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    refundPolicy: null,
    bookingDeadline: null,
    bookingsClosed: false,
    bookingsClosedAt: null,
    ticketsSoldCount: 0,
  } as Trip;
}

const COVER_BUTTON_LABEL = "Add cover photo, GIF, or video";

describe("ORCH-1122 — EditPublishedTripScreen cover dead-tap (runtime mount)", () => {
  it("opening Cover then tapping the cover button OPENS the CoverPickerSheet (visible flips to true)", async () => {
    await render(<EditPublishedTripScreen trip={makeTrip()} />);

    // Default open section is "basics" → Cover body (and its button) not yet
    // mounted; the sheet is not visible.
    expect(screen.queryByLabelText(COVER_BUTTON_LABEL)).toBeNull();
    expect(screen.queryByTestId("cover-picker-sheet-VISIBLE")).toBeNull();

    // Expand the Cover accordion (real handleToggleSection → openSection="cover").
    await fireEvent.press(
      screen.getByLabelText("Cover section (collapsed)"),
    );

    // Cover body mounted: the button is present, sheet still hidden.
    const coverButton = screen.getByLabelText(COVER_BUTTON_LABEL);
    expect(coverButton).toBeTruthy();
    expect(screen.queryByTestId("cover-picker-sheet-VISIBLE")).toBeNull();

    // Tap "Add cover…" → real setCoverPickerVisible(true) → screen re-renders.
    // WITH the dep fix, renderSectionBody re-mints and CoverPickerSheet gets
    // visible={true}. WITHOUT it, the stale memoized body keeps visible={false}
    // and this assertion goes RED (the dead tap).
    await fireEvent.press(coverButton);

    expect(screen.getByTestId("cover-picker-sheet-VISIBLE")).toBeTruthy();
  });
});
