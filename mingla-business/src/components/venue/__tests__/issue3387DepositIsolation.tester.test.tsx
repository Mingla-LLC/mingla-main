/** Independent #3387 guard: interleaved/retried requests and payment phase isolation.
 * Real hook, native/web services and web form; transport/SDK/rendering leaves only.
 * No provider, network, browser or device is contacted by this suite.
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
const mockAnalytics = jest.fn<any>();
const mockHost = (name: string) => (props: any) => require("react").createElement(name, props, props.children);
const mockSlot = { slotStartUtc: "2030-01-01T18:00:00Z", label: "18:00", slotLocalLabel: "18:00", remaining: 10, isFull: false };
jest.mock("../../../../../app-mobile/src/services/supabase", () => ({ supabase: { functions: { invoke: (...args: Parameters<Invoke>) => mockInvoke(...args) } } }));
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: (...args: Parameters<Invoke>) => mockInvoke(...args) } } }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }), { virtual: true });
jest.mock("@mingla/payments-native", () => ({ useStripePaymentSheet: () => ({ initPaymentSheet: mockInit, presentPaymentSheet: mockPresent, isPaymentSheetSupported: true }) }), { virtual: true });
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }), { virtual: true });
jest.mock("expo-web-browser", () => ({ openBrowserAsync: (...args: any[]) => mockOpen(...args) }), { virtual: true });
jest.mock("../../../../../app-mobile/src/hooks/useMyReservations", () => ({ myReservationsKeys: { byUser: (id: string) => ["myReservations", id] } }));
jest.mock("../../../../../app-mobile/src/services/venueOrganicCaptureService", () => ({ getVenueOrganicJourneyToken: () => null }));
jest.mock("../../../services/venueOrganicCaptureService", () => ({ getVenueOrganicJourneyToken: () => null, captureVenueOrganicEvent: jest.fn() }));
jest.mock("../../../analytics/webAnalytics", () => ({ captureWeb: (...args: any[]) => mockAnalytics(...args), getStoredClickAttribution: () => ({ clickId: null }) }));
jest.mock("../../../hooks/usePublicVenueAvailability", () => ({ usePublicVenueAvailability: () => ({ data: [mockSlot], isLoading: false, isFetching: false, isError: false }) }));
jest.mock("@mingla/phone-input", () => ({ PhoneInput: mockHost("PhoneInput"), getCountryByCode: () => ({ dialCode: "+1" }), getDefaultCountryCode: () => "US" }));
jest.mock("../../ui/Button", () => ({ Button: mockHost("Button") }));
jest.mock("../../ui/Input", () => ({ Input: mockHost("Input") }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

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
import { GuestVenueReservation } from "../GuestVenueReservation";
const Renderer = require("react-test-renderer");
const code = "deposit_amount_unconfigured";
// Independent literal oracle, not imported from the implementation under test.
const advice = "This venue asks for a deposit for a party this size but hasn't finished setting it up. Choose a smaller party or contact the venue.";
const input = { venueId: "venue-tester-3387", brandId: "brand-tester-3387", reservedForUtc: mockSlot.slotStartUtc, partySize: 8, buyer: { name: "QA Guest", email: "qa@example.invalid", phone: "+12025550123" } };
const refusal = (body: unknown) => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 409, text: async () => JSON.stringify(body) } } });
const result = (data: unknown) => ({ data, error: null });
const fee = result({ kind: "requires_payment", reservationDraftId: "draft-3387", buyerStatusToken: "status-token", totalCents: 2550, currency: "USD", clientSecret: "qa-secret", publishableKey: null });
async function withHook(assert: (run: ReturnType<typeof useReserveTable>) => Promise<void>) {
  let tree: any;
  let run!: ReturnType<typeof useReserveTable>;
  function Harness() { run = useReserveTable("tester-3387"); return null; }
  await Renderer.act(async () => { tree = Renderer.create(<Harness />); });
  try { await assert(run); } finally { await Renderer.act(async () => { tree.unmount(); }); }
}
beforeEach(() => {
  jest.resetAllMocks();
  mockInit.mockResolvedValue({});
  mockPresent.mockResolvedValue({});
  mockOpen.mockResolvedValue({ type: "dismiss" });
});

test("out-of-order independent create results never leak failure into a free reservation", async () => {
  let release!: (value: InvokeResponse) => void;
  mockInvoke.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValueOnce(result({ kind: "free_completed", reservationId: "free-independent" }));
  await withHook(async run => {
    const pending = run(input);
    expect(await run({ ...input, venueId: "other-venue" })).toEqual({ outcome: "succeeded", reservationId: "free-independent" });
    release(refusal({ error: code }));
    expect(await pending).toEqual({ outcome: "failed", message: advice });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["myReservations", "tester-3387"] });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

test("manual retry after refusal still obeys the server fee and completes only after confirmation", async () => {
  mockInvoke.mockResolvedValueOnce(refusal({ message: code })).mockResolvedValueOnce(fee)
    .mockResolvedValueOnce(result({ status: "completed", reservationId: "paid-retry" }));
  await withHook(async run => {
    expect(await run(input)).toEqual({ outcome: "failed", message: advice });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(await run({ ...input, partySize: 2 })).toEqual({ outcome: "succeeded", reservationId: "paid-retry" });
    expect(mockInvoke.mock.calls.map(call => call[0])).toEqual(["venue-reservation-create", "venue-reservation-create", "venue-reservation-confirm"]);
    expect(mockInvoke.mock.calls[1][1].body).toEqual(expect.objectContaining({ partySize: 2, surface: "native", venueId: input.venueId, buyer: expect.objectContaining(input.buyer) }));
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentClientSecret: "qa-secret" }));
    expect(mockPresent).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});

test("decoder precedence preserves unknown error even when a competing message contains the deposit code", async () => {
  mockInvoke.mockResolvedValue(refusal({ error: "slot_unavailable", message: code }));
  await withHook(async run => {
    expect(await run(input)).toEqual({ outcome: "failed", message: "slot_unavailable" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});

test("a non-canceled payment presentation failure is never translated into pre-payment deposit advice", async () => {
  mockInvoke.mockResolvedValue(fee);
  mockPresent.mockResolvedValue({ error: { code: "Failed", localizedMessage: code } });
  await withHook(async run => {
    expect(await run(input)).toEqual({ outcome: "failed", message: code });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});

test("a hosted browser failure still confirms payment instead of showing create advice or retrying create", async () => {
  mockOpen.mockRejectedValue(new Error(code));
  mockInvoke.mockResolvedValueOnce(result({ kind: "requires_paystack_redirect", reservationDraftId: "hosted-draft", buyerStatusToken: "hosted-token", authorizationUrl: "https://example.invalid/no-network" }))
    .mockResolvedValueOnce(result({ status: "completed", reservationId: "hosted-paid" }));
  await withHook(async run => {
    expect(await run(input)).toEqual({ outcome: "succeeded", reservationId: "hosted-paid" });
    expect(mockInvoke.mock.calls.map(call => call[0])).toEqual(["venue-reservation-create", "venue-reservation-confirm"]);
    expect(mockInvoke.mock.calls[1][1].body).toEqual({ reservationDraftId: "hosted-draft", buyerStatusToken: "hosted-token" });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});

test("buyer web retains contact and selection after refusal, then completes a manually retried free request", async () => {
  let tree: any;
  const one = (label: string) => tree.root.findAll((n: any) => typeof n.type === "string" && n.props.accessibilityLabel === label)[0];
  const submit = () => tree.root.findAll((n: any) => n.type === "Button" && n.props.label === "Confirm reservation")[0];
  const texts = () => tree.root.findAll((n: any) => n.type === "Text").map((n: any) => n.props.children).flat().join(" ");
  mockInvoke.mockResolvedValueOnce(refusal({ message: code })).mockResolvedValueOnce(result({ kind: "free_completed", reservationId: "web-free" }));
  await Renderer.act(async () => { tree = Renderer.create(<GuestVenueReservation venueId={input.venueId} brandId={input.brandId} currency="USD" analyticsSurface="buyer_web" palette={{ page: "#000", primaryText: "#fff", secondaryText: "#aaa", tertiaryText: "#999", accent: "#f00", panelBorder: "#333" } as any} />); });
  try {
    await Renderer.act(async () => { one("Select 18:00").props.onPress(); });
    await Renderer.act(async () => {
      one("Name, required").props.onChangeText(input.buyer.name);
      one("Email, required").props.onChangeText(input.buyer.email);
      tree.root.findByType("PhoneInput").props.onChangePhone("2025550123");
    });
    await Renderer.act(async () => { await submit().props.onPress(); });
    expect(texts()).toContain(advice);
    expect(texts()).not.toContain("Your table is reserved");
    expect(one("Name, required").props.value).toBe(input.buyer.name);
    expect(one("Email, required").props.value).toBe(input.buyer.email);
    expect(mockAnalytics.mock.calls.filter(call => call[0] === "venue_reservation_completed")).toHaveLength(0);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await Renderer.act(async () => { await submit().props.onPress(); });
    expect(texts()).toContain("Your table is reserved");
    expect(texts()).not.toContain(advice);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[1][1].body).toEqual(mockInvoke.mock.calls[0][1].body);
    expect(mockAnalytics.mock.calls.filter(call => call[0] === "venue_reservation_completed")).toHaveLength(1);
    expect(mockOpen).not.toHaveBeenCalled();
  } finally { await Renderer.act(async () => { tree.unmount(); }); }
});
