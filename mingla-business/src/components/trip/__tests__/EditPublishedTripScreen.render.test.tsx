/**
 * ORCH-1118 [trip from/destination must be Mapbox-validated addresses] —
 * RENDER-PROOF (mingla-tester, RETEST gap-closer).
 *
 * The prior CONDITIONAL PASS left ONE residual: the published-edit screen's
 * runtime behaviour (dropdown mounts on its own path; save gate fires) was only
 * "probable" because the on-sim drive was auth-gated. This test closes that gap
 * with a GENUINE RUNTIME EXECUTION: it mounts the REAL EditPublishedTripScreen
 * via @testing-library/react-native and asserts, at runtime:
 *
 *   a. Both "Departing from" and "Destination" render as MapboxAddressInput
 *      (real shared picker — combobox role), proving they MOUNT on the screen's
 *      OWN code path (the basics accordion content), not a dead/blank field and
 *      not the legacy plain TextInput. This kills the dead-tap /
 *      conditional-unmount class (ref: Ari Add-cover dead tap that passed jest
 *      but was unmounted on its own path).
 *
 *   b. Free-text-without-pick into a field nulls its coords AND tapping
 *      "Save changes" does NOT proceed to ChangeSummaryModal (the gate FIRES) —
 *      the inline error + toast show instead. The EMPTY-departure case also
 *      blocks save.
 *
 *   c. The both-validly-picked path DOES proceed (modal opens).
 *
 * The MapboxAddressInput chain and the save handler are NOT mocked — only the
 * network/native boundary (supabase invoke, expo-router, safe-area, the
 * non-basics accordion bodies, react-query mutation/hook) is stubbed. The save
 * gate (`handleSavePress` → `destinationLocationValidated` /
 * `departureLocationValidated` → `setModal`) runs for real.
 *
 * Run via the worktree-local render config:
 *   npx jest --config jest.orch1118.render.cjs --runInBand
 *
 * Fails-on-revert: removing the gate in EditPublishedTripScreen.handleSavePress
 * (or reverting the MapboxAddressInput swap to a plain TextInput) makes (a) or
 * (b) fail. Verified in the RETEST report.
 */

import React from "react";

// ---- Boundary mocks (network / native only — NOT the picker or the gate) ----

// expo native modules used deep in the chain (Button haptics, picker haptics).
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

// expo-router: the screen calls useRouter().back()/push()/replace().
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// safe-area: deterministic insets.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// SmartScrollView + keyboard wrappers → plain pass-throughs (avoid native).
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = require("react-native");
  return { ScrollView: RN.ScrollView };
});
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));

// react-query mutation + web-purchases hook used at the top of the screen.
jest.mock("../../../hooks/useTrips", () => ({
  useUpdateLiveTripFields: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
}));
jest.mock("../../../hooks/useTripHasWebPurchases", () => ({
  useTripHasWebPurchases: () => false,
}));

// Trip-change notifier (fire-and-forget network) — no-op.
jest.mock("../../../services/tripChangeNotifier", () => ({
  notifyTripChanged: jest.fn(),
  deriveTripChannelFlags: () => ({}),
}));

// supabase service — the MapboxAddressInput wrapper imports it for `invoke`.
// We stub invoke so no real geocode network fires; the pick is simulated via
// the picker's onPick prop directly (see helper below), which is the same code
// path a real Mapbox suggestion tap takes.
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn(async () => ({ data: null, error: null })) } },
}));

// Heavy non-basics accordion bodies + modals: stub to trivial views. They are
// NOT rendered while openSection === "basics" (the default), but they are
// imported at module top so their native deps must not load. ChangeSummaryModal
// is stubbed to surface its `visible` prop via a testID so we can assert the
// gate's downstream effect (modal open / not open) at runtime.
jest.mock("../TripCreatorStep2Itinerary", () => ({ TripCreatorStep2Itinerary: () => null }));
jest.mock("../TripCreatorStep3Inclusions", () => ({ TripCreatorStep3Inclusions: () => null }));
jest.mock("../TripCreatorStep4Pricing", () => ({ TripCreatorStep4Pricing: () => null }));
jest.mock("../InstallmentScheduleDisplay", () => ({ InstallmentScheduleDisplay: () => null }));
jest.mock("../EditPublishedTripIntakeAccordion", () => ({ EditPublishedTripIntakeAccordion: () => null }));
jest.mock("../EditAfterPublishTripBanner", () => ({ EditAfterPublishTripBanner: () => null }));
jest.mock("../../ui/CoverPickerSheet", () => ({ CoverPickerSheet: () => null }));
jest.mock("../../ui/EventCoverMedia", () => ({ EventCoverMedia: () => null }));

// Native-heavy chrome primitives (Sheet→expo-blur→expo-modules-core, etc.).
// Stubbed to thin RN views that PRESERVE the props the assertions rely on:
//   - Button: onPress + testID + label (the Save button fires the real gate)
//   - Toast: visible + message (assert the error toast text)
// These are unrelated to the picker/gate under proof.
jest.mock("../../ui/Button", () => {
  const RN = require("react-native");
  return {
    Button: ({ label, onPress, testID, disabled }: any) => (
      <RN.Pressable testID={testID} onPress={onPress} disabled={disabled}>
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

jest.mock("../../event/ChangeSummaryModal", () => {
  const RN = require("react-native");
  return {
    ChangeSummaryModal: ({ visible }: { visible: boolean }) =>
      visible ? <RN.View testID="change-summary-modal-OPEN" /> : null,
  };
});

// ---- Imports AFTER mocks ----

import { render, screen, fireEvent } from "@testing-library/react-native";
import { EditPublishedTripScreen } from "../EditPublishedTripScreen";
import {
  TRIP_DEPARTURE_PICK_ERROR,
  TRIP_DESTINATION_PICK_ERROR,
} from "../tripLocationValidated";
import type { Trip } from "../../../services/tripsService";

// ---- Fixture: a scheduled trip mirroring the live dirty row "The Sone" -------
// destination = dirty free text (no coords), departure = EMPTY → both invalid.

function makeTrip(overrides: Partial<Trip["businessTrip"]> = {}): Trip {
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
      // dirty destination — typed, never picked (null coords/placeId)
      destinationPlaceId: null,
      destinationLocationText: "Tulum, Quintana Roo, Mexico",
      destinationLat: null,
      destinationLng: null,
      // empty departure (hard-required → invalid)
      departurePlaceId: null,
      departureLocationText: null,
      departureLat: null,
      departureLng: null,
      capacity: 10,
      ...overrides,
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

// The two pickers are tagged via the shared field TextInput's accessibilityLabel
// ("Departing from" / "Destination", role=combobox). We query those.
const DEP_LABEL = "Departing from";
const DEST_LABEL = "Destination";

// A fully-picked trip (both fields confirmed) — for the valid-path case.
function makePickedTrip(): Trip {
  return makeTrip({
    destinationPlaceId: "place-dest",
    destinationLocationText: "Tulum, Quintana Roo, Mexico",
    destinationLat: 20.21,
    destinationLng: -87.46,
    departurePlaceId: "place-dep",
    departureLocationText: "Washington, DC, USA",
    departureLat: 38.9,
    departureLng: -77.03,
  });
}

describe("ORCH-1118 — EditPublishedTripScreen RENDER PROOF (runtime mount)", () => {
  it("(a) MOUNTS both location fields as MapboxAddressInput on the basics path (combobox), NOT plain TextInput", async () => {
    await render(<EditPublishedTripScreen trip={makeTrip()} />);

    // The shared MapboxAddressInput renders its TextInput with
    // accessibilityRole="combobox". A plain TextInput (the legacy field) has NO
    // combobox role. Exactly two comboboxes present ⇒ both swapped pickers
    // MOUNTED on the basics path (not a dead/blank field, not legacy TextInput).
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes.length).toBe(2);

    // And each is the labelled location field (title/desc/capacity plain
    // TextInputs have no combobox role).
    const dep = screen.getByLabelText(DEP_LABEL);
    const dest = screen.getByLabelText(DEST_LABEL);
    expect(dep.props.accessibilityRole).toBe("combobox");
    expect(dest.props.accessibilityRole).toBe("combobox");

    // The accessibility hint is the shared picker's ("…then pick one.") —
    // proves it is the picker, not a text box.
    expect(dep.props.accessibilityHint).toMatch(/pick one/i);
    expect(dest.props.accessibilityHint).toMatch(/pick one/i);
  });

  it("(b1-gate) free-text destination (no pick) + empty departure → Save GATE BLOCKS (no modal) + toast fires", async () => {
    await render(<EditPublishedTripScreen trip={makeTrip()} />);

    // Sanity: modal not open yet.
    expect(screen.queryByTestId("change-summary-modal-OPEN")).toBeNull();

    // Create a non-empty patch so the GATE (not the "no changes" short-circuit)
    // is what blocks: re-type the destination text (still no pick → null coords).
    await fireEvent.changeText(
      screen.getByLabelText(DEST_LABEL),
      "Tulum, Quintana Roo, Mexico (edited)",
    );

    // Tap the real Save button → runs the real handleSavePress.
    await fireEvent.press(screen.getByTestId("edit-trip-save"));

    // GATE FIRED: change-summary modal did NOT open (no live-update path).
    expect(screen.queryByTestId("change-summary-modal-OPEN")).toBeNull();

    // Toast fired (rendered in the main return, reads `toast` state directly).
    expect(
      screen.getByText(
        "Pick the trip's departure and destination from the suggestions.",
      ),
    ).toBeTruthy();
  });

  // SPEC SC-6/SC-7 require the INLINE field errors to appear on the edit screen
  // after a blocked save. This case proves they DO (the contract). It currently
  // FAILS at runtime because `renderSectionBody`'s useCallback dep array omits
  // `showEditAddressErrors` (EditPublishedTripScreen.tsx ~L1441-1453) → the
  // picker's `error` prop is computed from a STALE closure and never updates
  // after a blocked save. Dead-render path (toast + gate work; inline error
  // does not). See QA finding P1-EDIT-STALE-ERROR. This assertion is the
  // spec-correct expectation and must go green once the dep is added.
  it("(b1-inline-error) blocked save reveals INLINE field errors on BOTH location fields [SPEC SC-6/7]", async () => {
    await render(<EditPublishedTripScreen trip={makeTrip()} />);
    await fireEvent.changeText(
      screen.getByLabelText(DEST_LABEL),
      "Tulum, Quintana Roo, Mexico (edited)",
    );
    await fireEvent.press(screen.getByTestId("edit-trip-save"));

    expect(screen.getByText(TRIP_DESTINATION_PICK_ERROR)).toBeTruthy();
    expect(screen.getByText(TRIP_DEPARTURE_PICK_ERROR)).toBeTruthy();
  });

  it("(b2-gate) destination validly PICKED but departure EMPTY → Save GATE STILL BLOCKS (departure hard-required)", async () => {
    // Destination is a confirmed pick (placeId + coords). Departure is EMPTY.
    const trip = makeTrip({
      destinationPlaceId: "place-dest",
      destinationLocationText: "Tulum, Quintana Roo, Mexico",
      destinationLat: 20.21,
      destinationLng: -87.46,
      // departure left empty/null → hard-required INVALID
    });
    await render(<EditPublishedTripScreen trip={trip} />);

    // Non-empty patch via a benign title edit (does not touch the location gate).
    await fireEvent.changeText(
      screen.getByTestId("edit-trip-title"),
      "The Sone — Summer",
    );

    await fireEvent.press(screen.getByTestId("edit-trip-save"));

    // Even with a validly-picked destination, EMPTY departure blocks. Modal shut.
    expect(screen.queryByTestId("change-summary-modal-OPEN")).toBeNull();
  });

  it("(c) BOTH validly picked → Save PROCEEDS (ChangeSummaryModal opens)", async () => {
    await render(<EditPublishedTripScreen trip={makePickedTrip()} />);

    // Non-empty patch via a benign title edit; both gates pass ⇒ modal opens.
    await fireEvent.changeText(
      screen.getByTestId("edit-trip-title"),
      "The Sone — Summer",
    );

    await fireEvent.press(screen.getByTestId("edit-trip-save"));

    // GATE PASSED: change-summary modal opened.
    expect(screen.getByTestId("change-summary-modal-OPEN")).toBeTruthy();
    // No blocking errors when both are valid.
    expect(screen.queryByText(TRIP_DEPARTURE_PICK_ERROR)).toBeNull();
    expect(screen.queryByText(TRIP_DESTINATION_PICK_ERROR)).toBeNull();
  });
});
