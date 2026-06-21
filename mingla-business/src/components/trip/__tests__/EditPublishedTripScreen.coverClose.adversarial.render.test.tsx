/**
 * ORCH-1122 [trip-edit cover dead-tap] — TESTER ADVERSARIAL REGRESSION
 * (mingla-tester owned; DIFFERENT ANGLE than the implementor's happy-path).
 *
 * # Why this is a DISTINCT failure mode (not a renamed copy)
 * The implementor's happy-path test
 * (`EditPublishedTripScreen.coverDeadTap.render.test.tsx`) proves the ONE-WAY
 * open transition: pressing "Add cover" flips `coverPickerVisible`
 * false → true and the memoized `renderSectionBody` body re-mints so
 * `<CoverPickerSheet visible>` becomes true.
 *
 * THIS test attacks the OPPOSITE direction — the TWO-WAY binding. The cover
 * body wires `onClose={() => setCoverPickerVisible(false)}`
 * (EditPublishedTripScreen.tsx:1353). The same `renderSectionBody` useCallback
 * that omitted `coverPickerVisible` also memoizes that already-open body. The
 * dead-tap class is not just "won't open" — it is "the memoized body is frozen
 * over a stale `coverPickerVisible`". A regression that left the OPEN path
 * working but broke the re-mint on CLOSE would sail past the happy-path test
 * yet leave a sheet that can never be dismissed (a trapped-modal dead-tap).
 *
 * This test:
 *   1. mounts the REAL EditPublishedTripScreen, expands the Cover accordion,
 *   2. opens the sheet via the real "Add cover" button (visible → true),
 *   3. fires the REAL sheet `onClose` (setCoverPickerVisible(false)),
 *   4. asserts the memoized body RE-MINTS in the close direction and the sheet
 *      UNMOUNTS (visible → false again).
 *
 * Distinct assertion target: the implementor asserts the sheet APPEARS; this
 * asserts the sheet DISAPPEARS after a close — proving the dep makes the body
 * reactive in BOTH directions, not just on open.
 *
 * # Fails-on-revert
 * Delete `coverPickerVisible` from `renderSectionBody`'s dependency array
 * (EditPublishedTripScreen.tsx) → with the dep gone the body is never reactive
 * to the flag at all, so step 2's open assertion ALREADY goes RED (the dead
 * tap), and the close round-trip can never be reached — the suite fails.
 * Verified by true LINE DELETION (not comment-out) by the tester.
 *
 * Run via the worktree-local render config (tester-owned, mirrors the
 * implementor's):
 *   npx jest --config jest.orch1122.adversarial.render.cjs --runInBand
 *
 * New sibling file (append-only safe). Boundary-only mocks identical in spirit
 * to the implementor's — the screen, its state, and renderSectionBody's real
 * useCallback memoization are NOT mocked.
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

// Heavy non-cover accordion bodies + modals → trivial views.
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

// CoverPickerSheet — adversarial stub. Surfaces `visible` via a testID ONLY when
// visible===true, AND exposes the real `onClose` prop behind a pressable so the
// test can drive the close path the production body wired
// (onClose={() => setCoverPickerVisible(false)}). This reads/drives the EXACT
// props the real memoized body passes — no screen state is mocked.
jest.mock("../../ui/CoverPickerSheet", () => {
  const RN = require("react-native");
  return {
    CoverPickerSheet: ({ visible, onClose }: any) =>
      visible ? (
        <RN.View testID="cover-picker-sheet-VISIBLE">
          <RN.Pressable testID="cover-picker-sheet-CLOSE" onPress={onClose}>
            <RN.Text>close</RN.Text>
          </RN.Pressable>
        </RN.View>
      ) : null,
  };
});

// Native-heavy chrome primitives → thin RN stubs.
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

// ---- Fixture: a published trip WITH a cover already set, so the button label
// is "Change cover" (the screenshot/edit case). The accessibilityLabel is the
// same for both label paths, so this also exercises the cover-EXISTS branch. ----

function makeTripWithCover(): Trip {
  return {
    id: "trip-fixture-close-1",
    brandId: "brand-1",
    brandSlug: "brand-1",
    title: "The Sone",
    description: "A getaway.",
    slug: "the-sone",
    status: "scheduled",
    visibility: "public",
    publishedAt: "2026-06-01T00:00:00Z",
    timezone: "America/New_York",
    coverMediaUrl: "https://cdn.example.com/existing-cover.jpg",
    coverMediaType: "image",
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
        eventId: "trip-fixture-close-1",
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

describe("ORCH-1122 ADVERSARIAL — CoverPickerSheet two-way binding (close re-mints)", () => {
  it("after opening, firing the sheet onClose RE-CLOSES it (visible flips back to false → sheet unmounts)", async () => {
    await render(<EditPublishedTripScreen trip={makeTripWithCover()} />);

    // Expand the Cover accordion. Cover EXISTS → button label is "Change cover";
    // the accessibilityLabel selector is shared across both label paths.
    await fireEvent.press(screen.getByLabelText("Cover section (collapsed)"));

    const coverButton = screen.getByLabelText(COVER_BUTTON_LABEL);
    expect(coverButton).toBeTruthy();
    // Confirm we are on the cover-EXISTS branch (distinct from the happy-path
    // empty-cover fixture).
    expect(screen.getByText("Change cover")).toBeTruthy();
    expect(screen.queryByTestId("cover-picker-sheet-VISIBLE")).toBeNull();

    // OPEN (false → true). Establishes the precondition for the close test.
    await fireEvent.press(coverButton);
    expect(screen.getByTestId("cover-picker-sheet-VISIBLE")).toBeTruthy();

    // THE ADVERSARIAL STEP — fire the REAL sheet onClose
    // (setCoverPickerVisible(false)). WITH the dep fix, renderSectionBody
    // re-mints in the CLOSE direction and the sheet UNMOUNTS. WITHOUT a
    // reactive dep the body is frozen and could never reflect EITHER flip.
    await fireEvent.press(screen.getByTestId("cover-picker-sheet-CLOSE"));

    // Distinct assertion: the sheet is GONE after close (two-way binding proven).
    expect(screen.queryByTestId("cover-picker-sheet-VISIBLE")).toBeNull();
  });
});
