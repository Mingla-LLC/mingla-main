/** #3387: execute the real native hook/service/decoder and mounted retry flow.
 * Only network, payment SDK and native/data leaves are mocked; no real bookings.
 */
import React from "react";
import { beforeEach, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type InvokeResponse = { data: unknown; error: unknown };
type Invoke = (name: string, options: { body: Record<string, unknown> }) => Promise<InvokeResponse>;
const mockInvoke = jest.fn<Invoke>();
const mockInit = jest.fn<any>();
const mockPresent = jest.fn<any>();
const mockOpen = jest.fn<any>();
const mockInvalidate = jest.fn<any>();
const mockReserved = jest.fn<any>();
const mockClose = jest.fn<any>();
const mockHost = (name: string) => (props: any) => require("react").createElement(name, props, props.children);
const mockSlot = { slotStartUtc: "2030-01-01T18:00:00Z", label: "18:00", remaining: 10, isFull: false };
jest.mock("../../../../../app-mobile/src/services/supabase", () => ({ supabase: { functions: { invoke: (...args: Parameters<Invoke>) => mockInvoke(...args) } } }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }), { virtual: true });
jest.mock("@mingla/payments-native", () => ({ useStripePaymentSheet: () => ({ initPaymentSheet: mockInit, presentPaymentSheet: mockPresent, isPaymentSheetSupported: true }) }), { virtual: true });
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }), { virtual: true });
jest.mock("expo-web-browser", () => ({ openBrowserAsync: (...args: any[]) => mockOpen(...args) }), { virtual: true });
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Medium: "medium" }, NotificationFeedbackType: { Success: "success" } }), { virtual: true });
jest.mock("../../../../../app-mobile/src/hooks/useMyReservations", () => ({ myReservationsKeys: { byUser: (id: string) => ["myReservations", id] } }));
jest.mock("../../../../../app-mobile/src/services/venueOrganicCaptureService", () => ({ getVenueOrganicJourneyToken: () => null }));
jest.mock("../../../../../app-mobile/src/hooks/useAppLayout", () => ({ BOTTOM_NAV_CONTENT_HEIGHT: 60 }));
jest.mock("../../../../../app-mobile/src/components/ui/BaseBottomSheet", () => ({ BaseBottomSheet: mockHost("BottomSheet") }));
jest.mock("../../../../../app-mobile/src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../../app-mobile/src/components/onboarding/PhoneInput", () => ({ PhoneInput: mockHost("NativePhone") }));
jest.mock("../../../../../app-mobile/src/constants/countries", () => ({ getCountryByCode: () => ({ dialCode: "+1" }), getDefaultCountryCode: () => "US" }));
jest.mock("../../../../../app-mobile/src/store/appStore", () => ({ useAppStore: () => ({ user: { id: "user-3387", display_name: "QA", email: "qa@example.invalid", phone: "+12025550123" }, profile: null }) }));
jest.mock("../../../../../app-mobile/src/hooks/useVenueAvailability", () => ({ useVenueAvailability: () => ({ data: [mockSlot], isLoading: false, isError: false }) }));
jest.mock("../../../../../app-mobile/src/components/expandedCard/VenueSlotPicker", () => ({ VenueSlotPicker: mockHost("SlotPicker") }));

type NativeReserve = (input: {
  venueId: string; brandId: string; reservedForUtc: string; partySize: number;
  buyer: { name: string; email: string; phone: string; phoneCountryIso?: string | null; marketingOptIn?: boolean };
  occasion?: string | null; guestNotes?: string | null;
}, displayTitle?: string) => Promise<
  { outcome: "succeeded"; reservationId: string } |
  { outcome: "canceled" } | { outcome: "failed"; message: string }
>;
// Runtime boundary follows #2735: execute the real native owner without importing
// the native dependency graph into Business's separate TypeScript program.
const { useReserveTable } = require("../../../../../app-mobile/src/hooks/useReserveTable") as {
  useReserveTable: (userId: string | null | undefined) => NativeReserve;
};
const { VenueReserveSheet } = require("../../../../../app-mobile/src/components/expandedCard/VenueReserveSheet") as {
  VenueReserveSheet: React.ComponentType<{
    visible: boolean; onClose: () => void; venueId: string; brandId: string;
    venueName: string; currency: string | null; onReserved: (reservationId: string) => void;
    onAvailabilityResultViewed?: () => void; onSlotSelected?: () => void;
    onReservationFailed?: (resultClass: "phone_invalid" | "create_failed") => void;
  }>;
};
import { DEPOSIT_UNCONFIGURED_COPY, guestReservationFailureCopy } from "@mingla/brand-rendering/venueGuestReservationErrorCopy";
import { guestReservationFailureCopy as businessCopy } from "../venueGuestReservationErrorCopy";
const Renderer = require("react-test-renderer");
const input = { venueId: "venue-3387", brandId: "brand-3387", reservedForUtc: mockSlot.slotStartUtc, partySize: 2, buyer: { name: "QA", email: "qa@example.invalid", phone: "+12025550123" } };
const depositCode = "deposit_amount_unconfigured";
const fail = (body: string, status = 409) => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status, text: async () => body } } });
const fee = { data: { kind: "requires_payment", reservationDraftId: "draft-3387", buyerStatusToken: "qa-token", totalCents: 2000, currency: "USD", clientSecret: "qa-secret", publishableKey: null }, error: null };
async function reserve() {
  let run!: ReturnType<typeof useReserveTable>;
  let tree: any;
  function Harness() {
    run = useReserveTable("user-3387");
    return null;
  }
  await Renderer.act(async () => { tree = Renderer.create(<Harness />); });
  try {
    return await run(input, "QA venue");
  } finally {
    await Renderer.act(async () => { tree.unmount(); });
  }
}

beforeEach(() => {
  jest.resetAllMocks();
  mockInit.mockResolvedValue({});
  mockPresent.mockResolvedValue({});
  mockOpen.mockResolvedValue({ type: "dismiss" });
});

test("Business shim retains identity with one pure exact-code owner", () => {
  expect(businessCopy).toBe(guestReservationFailureCopy);
  expect(guestReservationFailureCopy(depositCode)).toBe("This venue asks for a deposit for a party this size but hasn't finished setting it up. Choose a smaller party or contact the venue.");
  for (const unknown of ["", "slot_unavailable", "DEPOSIT_AMOUNT_UNCONFIGURED", " deposit_amount_unconfigured", "deposit_amount_unconfigured suffix"]) {
    expect(guestReservationFailureCopy(unknown)).toBeNull();
  }
});

test.each(["error", "message"])("actual %s envelope maps at create failure without payment or success", async (key) => {
  mockInvoke.mockResolvedValue(fail(JSON.stringify({ [key]: depositCode })));
  expect(await reserve()).toEqual({ outcome: "failed", message: DEPOSIT_UNCONFIGURED_COPY });
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke.mock.calls[0][0]).toBe("venue-reservation-create");
  expect(mockInit).not.toHaveBeenCalled();
  expect(mockPresent).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();
  expect(mockInvalidate).not.toHaveBeenCalled();
});

test.each([
  [JSON.stringify({ error: "slot_unavailable" }), 409, "slot_unavailable"],
  ["<!doctype html>gateway failure", 503, "Couldn't start your reservation. Tap to try again. (server error)"],
  ["{}", 401, "Session expired — please sign in again"],
])("unmapped/malformed create body %s preserves its existing message", async (body, status, message) => {
  mockInvoke.mockResolvedValue(fail(String(body), Number(status)));
  expect(await reserve()).toEqual({ outcome: "failed", message });
  expect(mockInit).not.toHaveBeenCalled();
});

test("unreadable response retains decoder fallback", async () => {
  mockInvoke.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 409, text: async () => { throw new Error("body consumed"); } } } });
  expect(await reserve()).toEqual({ outcome: "failed", message: "Couldn't start your reservation. Tap to try again." });
});

test("non-Error transport rejection retains Reservation failed fallback", async () => {
  mockInvoke.mockRejectedValue({ reason: depositCode });
  expect(await reserve()).toEqual({ outcome: "failed", message: "Reservation failed." });
});

test("empty create response remains a failure rather than deposit advice", async () => {
  mockInvoke.mockResolvedValue({ data: null, error: null });
  expect(await reserve()).toEqual({ outcome: "failed", message: "Empty reservation response from server." });
});

test("successful free reservation retains exact invalidation", async () => {
  mockInvoke.mockResolvedValue({ data: { kind: "free_completed", reservationId: "free-3387" }, error: null });
  expect(await reserve()).toEqual({ outcome: "succeeded", reservationId: "free-3387" });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["myReservations", "user-3387"] });
  expect(mockInit).not.toHaveBeenCalled();
});

test("payment init message is not translated even if it equals the create code", async () => {
  mockInvoke.mockResolvedValue(fee);
  mockInit.mockResolvedValue({ error: { message: depositCode } });
  expect(await reserve()).toEqual({ outcome: "failed", message: depositCode });
  expect(mockPresent).not.toHaveBeenCalled();
  expect(mockInvoke).toHaveBeenCalledTimes(1);
});

test("payment cancellation remains silent canceled outcome", async () => {
  mockInvoke.mockResolvedValue(fee);
  mockPresent.mockResolvedValue({ error: { code: "Canceled", message: depositCode } });
  expect(await reserve()).toEqual({ outcome: "canceled" });
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvalidate).not.toHaveBeenCalled();
});

test("post-charge confirmation error cannot be rewritten as deposit setup advice", async () => {
  mockInvoke.mockResolvedValueOnce(fee).mockResolvedValueOnce(fail(JSON.stringify({ error: depositCode })));
  expect(await reserve()).toEqual({ outcome: "failed", message: depositCode });
  expect(mockPresent).toHaveBeenCalledTimes(1);
  expect(mockInvoke.mock.calls.map(call => call[0])).toEqual(["venue-reservation-create", "venue-reservation-confirm"]);
  expect(mockInvalidate).not.toHaveBeenCalled();
});

test("hosted checkout still opens then confirms even when browser dismisses", async () => {
  mockInvoke.mockResolvedValueOnce({ data: { kind: "requires_paystack_redirect", reservationDraftId: "draft-3387", buyerStatusToken: "qa-token", authorizationUrl: "https://example.invalid/qa" }, error: null })
    .mockResolvedValueOnce({ data: { status: "completed", reservationId: "hosted-3387" }, error: null });
  expect(await reserve()).toEqual({ outcome: "succeeded", reservationId: "hosted-3387" });
  expect(mockOpen).toHaveBeenCalledWith("https://example.invalid/qa");
  expect(mockInvoke.mock.calls.map(call => call[0])).toEqual(["venue-reservation-create", "venue-reservation-confirm"]);
  expect(mockInit).not.toHaveBeenCalled();
});

test("mounted refusal allows party/time correction; next submit clears error and guards duplicates", async () => {
  let tree: any;
  const one = (label: string) => tree.root.findAll((n: any) => typeof n.type === "string" && n.props.accessibilityLabel === label)[0];
  const press = async (label: string) => { await Renderer.act(async () => { await one(label).props.onPress(); }); };
  const errors = () => tree.root.findAll((n: any) => n.type === "Text" && n.props.accessibilityLiveRegion === "polite");
  mockInvoke.mockResolvedValueOnce(fail(JSON.stringify({ message: depositCode })));
  await Renderer.act(async () => {
    tree = Renderer.create(<VenueReserveSheet visible onClose={mockClose} venueId="venue-3387" brandId="brand-3387" venueName="QA venue" currency="USD" onReserved={mockReserved} />);
  });
  try {
    await press("See times");
    await Renderer.act(async () => { tree.root.findByType("SlotPicker").props.onSelect(mockSlot); });
    await press("Confirm reservation");
    expect(errors()[0].props.children).toBe(DEPOSIT_UNCONFIGURED_COPY);
    expect(mockReserved).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    await press("Back to times");
    await press("Back to party and date");
    await press("Decrease party size");
    await press("See times");
    await Renderer.act(async () => { tree.root.findByType("SlotPicker").props.onSelect({ ...mockSlot, slotStartUtc: "2030-01-01T19:00:00Z", label: "19:00" }); });
    let complete!: (value: InvokeResponse) => void;
    mockInvoke.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await press("Confirm reservation");
    expect(errors()).toHaveLength(0);
    expect(one("Confirm reservation").props.disabled).toBe(true);
    await press("Confirm reservation");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[1][1].body).toEqual(expect.objectContaining({ partySize: 1, reservedForUtc: "2030-01-01T19:00:00Z" }));
    await Renderer.act(async () => { complete(fail(JSON.stringify({ error: "slot_unavailable" }))); });
    expect(errors()[0].props.children).toBe("slot_unavailable");
    expect(one("Confirm reservation").props.disabled).toBe(false);
    expect(mockReserved).not.toHaveBeenCalled();
    expect(mockInit).not.toHaveBeenCalled();
  } finally { await Renderer.act(async () => { tree.unmount(); }); }
});
