/** #3387 acceptance-gap reproduction: real forms, native hook, both services,
 * and error decoders. Only transport/native rendering/data boundaries mocked.
 * The Explorer deposit assertion intentionally fails before parity repair.
 * This is mounted JS evidence, NOT a physical-device or payment-provider test.
 */
import React from "react";
import { beforeEach, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockInvoke = jest.fn<any>();
const mockInit = jest.fn<any>();
const mockPresent = jest.fn<any>();
const mockInvalidate = jest.fn<any>();
const mockOpen = jest.fn<any>();
const mockReserved = jest.fn<any>();
const mockClose = jest.fn<any>();
const mockFailure = jest.fn<any>();
const mockHost = (name: string) => (props: any) =>
  require("react").createElement(name, props, props.children);
jest.mock("../../../../../app-mobile/src/services/supabase", () => ({
  supabase: { functions: { invoke: (...args: any[]) => mockInvoke(...args) } },
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: any[]) => mockInvoke(...args) } },
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }), { virtual: true });
jest.mock("@mingla/payments-native", () => ({ useStripePaymentSheet: () => ({ initPaymentSheet: mockInit, presentPaymentSheet: mockPresent, isPaymentSheetSupported: true }) }), { virtual: true });
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }), { virtual: true });
jest.mock("expo-web-browser", () => ({ openBrowserAsync: (...args: any[]) => mockOpen(...args) }), { virtual: true });
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Medium: "medium" }, NotificationFeedbackType: { Success: "success" } }), { virtual: true });
jest.mock("../../../../../app-mobile/src/hooks/useMyReservations", () => ({ myReservationsKeys: { byUser: (id: string) => ["myReservations", id] } }));
jest.mock("../../../../../app-mobile/src/hooks/useAppLayout", () => ({ BOTTOM_NAV_CONTENT_HEIGHT: 60 }));
jest.mock("../../../../../app-mobile/src/components/ui/BaseBottomSheet", () => ({ BaseBottomSheet: mockHost("BottomSheet") }));
jest.mock("../../../../../app-mobile/src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../../app-mobile/src/components/onboarding/PhoneInput", () => ({ PhoneInput: mockHost("NativePhone") }));
jest.mock("../../../../../app-mobile/src/store/appStore", () => ({ useAppStore: () => ({ user: { id: "user-3387", display_name: "Test Guest", email: "guest@example.test", phone: "+12025550123" }, profile: null }) }));
const mockSlot = { slotStartUtc: "2030-01-01T18:00:00Z", label: "18:00", slotLocalLabel: "18:00", remaining: 10, isFull: false };
jest.mock("../../../../../app-mobile/src/hooks/useVenueAvailability", () => ({ useVenueAvailability: () => ({ data: [mockSlot], isLoading: false, isError: false }) }));
jest.mock("../../../../../app-mobile/src/components/expandedCard/VenueSlotPicker", () => ({ VenueSlotPicker: mockHost("SlotPicker") }));
jest.mock("../../../../../app-mobile/src/services/venueOrganicCaptureService", () => ({ getVenueOrganicJourneyToken: () => null }));
jest.mock("../../../services/venueOrganicCaptureService", () => ({ getVenueOrganicJourneyToken: () => null, captureVenueOrganicEvent: jest.fn() }));
jest.mock("../../../analytics/webAnalytics", () => ({ captureWeb: jest.fn(), getStoredClickAttribution: () => ({ clickId: null }) }));
jest.mock("../../../hooks/usePublicVenueAvailability", () => ({ usePublicVenueAvailability: () => ({ data: [mockSlot], isLoading: false, isFetching: false, isError: false }) }));
jest.mock("@mingla/phone-input", () => ({ PhoneInput: mockHost("PhoneInput"), getCountryByCode: () => ({ dialCode: "+1" }), getDefaultCountryCode: () => "US" }), { virtual: true });
jest.mock("../../ui/Button", () => ({ Button: mockHost("Button") }));
jest.mock("../../ui/Input", () => ({ Input: mockHost("Input") }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import { VenueReserveSheet } from "../../../../../app-mobile/src/components/expandedCard/VenueReserveSheet";
import { GuestVenueReservation } from "../GuestVenueReservation";
import { DEPOSIT_UNCONFIGURED_COPY } from "../venueGuestReservationErrorCopy";
// Same installed renderer used by the required business Jest suite.
const Renderer = require("react-test-renderer");
const text = (tree: any) => tree.root.findAll((n: any) => n.type === "Text").map((n: any) => n.children.filter((c: any) => typeof c === "string").join("")).join("\n");
const one = (tree: any, label: string) => tree.root.findAll((n: any) => typeof n.type === "string" && n.props.accessibilityLabel === label)[0];
const press = async (node: any) => { await Renderer.act(async () => { await node.props.onPress(); }); };

beforeEach(() => {
  jest.clearAllMocks();
  mockInvoke.mockResolvedValue({ data: null, error: {
    message: "Edge Function returned a non-2xx status code",
    context: { status: 409, text: async () => JSON.stringify({ error: "deposit_amount_unconfigured" }) },
  } });
});

async function nativeReady() {
  let tree: any;
  await Renderer.act(async () => {
    tree = Renderer.create(<VenueReserveSheet visible onClose={mockClose} venueId="venue-3387" brandId="brand-3387" venueName="Test venue" currency="USD" onReserved={mockReserved} onReservationFailed={mockFailure} />);
  });
  await press(one(tree, "See times"));
  await Renderer.act(async () => tree.root.findByType("SlotPicker").props.onSelect(mockSlot));
  return tree;
}

test("Explorer: actual form→hook→service must show useful deposit advice, not the server token", async () => {
  const tree = await nativeReady();
  try {
    await press(one(tree, "Confirm reservation"));
    expect(mockInvoke).toHaveBeenCalledWith("venue-reservation-create", expect.objectContaining({ body: expect.objectContaining({ surface: "native", venueId: "venue-3387", partySize: 2 }) }));
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockPresent).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockReserved).not.toHaveBeenCalled();
    expect(mockFailure).toHaveBeenCalledWith("create_failed");
    expect(text(tree)).toContain(DEPOSIT_UNCONFIGURED_COPY);
    expect(text(tree)).not.toContain("deposit_amount_unconfigured");
  } finally { await Renderer.act(async () => tree.unmount()); }
});

test("Explorer positive control: the same real chain handles a free success", async () => {
  mockInvoke.mockResolvedValue({ data: { kind: "free_completed", reservationId: "reservation-3387" }, error: null });
  const tree = await nativeReady();
  try {
    await press(one(tree, "Confirm reservation"));
    expect(mockReserved).toHaveBeenCalledWith("reservation-3387");
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["myReservations", "user-3387"] });
    expect(mockInit).not.toHaveBeenCalled();
  } finally { await Renderer.act(async () => tree.unmount()); }
});

test("Buyer web: same refusal through actual form and service already shows useful advice", async () => {
  let tree: any;
  await Renderer.act(async () => {
    tree = Renderer.create(<GuestVenueReservation venueId="venue-3387" brandId="brand-3387" currency="USD" analyticsSurface="buyer_web" palette={{ page: "#000", primaryText: "#fff", secondaryText: "#aaa", tertiaryText: "#999", accent: "#f00", panelBorder: "#333" } as any} />);
  });
  try {
    await press(one(tree, "Select 18:00"));
    await Renderer.act(async () => {
      one(tree, "Name, required").props.onChangeText("Test Guest");
      one(tree, "Email, required").props.onChangeText("guest@example.test");
      tree.root.findByType("PhoneInput").props.onChangePhone("2025550123");
    });
    const submit = tree.root.findAll((n: any) => n.type === "Button" && n.props.label === "Confirm reservation")[0];
    expect(submit).toBeDefined();
    await press(submit);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("venue-reservation-create", expect.objectContaining({ body: expect.objectContaining({ surface: "web", venueId: "venue-3387", partySize: 2 }) }));
    expect(text(tree)).toContain(DEPOSIT_UNCONFIGURED_COPY);
    expect(text(tree)).not.toContain("deposit_amount_unconfigured");
  } finally { await Renderer.act(async () => tree.unmount()); }
});
