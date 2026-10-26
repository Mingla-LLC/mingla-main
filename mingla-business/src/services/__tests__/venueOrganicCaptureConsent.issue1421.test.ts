// [TEST-MOD-APPROVED #2331] analytics is on unless the visitor turned it off:
// the journey starts on arrival, and a turned-off visitor starts it only when
// they turn analytics back on (a privacy-store notification, not a click).
const mockIsAnalyticsOn = jest.fn<boolean, []>();
const mockReadReferrerHost = jest.fn<string | null, []>(() => null);
const mockInvoke = jest.fn();
const mockPrivacySubscribers = new Set<() => void>();

jest.mock("../../analytics/webAnalytics", () => ({
  isAnalyticsOn: mockIsAnalyticsOn,
  readReferrerHost: mockReadReferrerHost,
  subscribePrivacy: (subscriber: () => void) => {
    mockPrivacySubscribers.add(subscriber);
    return () => mockPrivacySubscribers.delete(subscriber);
  },
}));
jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

import {
  settleVenueOrganicJourneyOnConsent,
} from "../venueOrganicCaptureService.web";
import {
  runBuyerVenueOrganicCapture,
  settleBuyerVenueOrganicCapture,
} from "../venueOrganicCapturePolicy";

const scope = {
  brandId: "11111111-1111-4111-8111-111111111111",
  venueId: "22222222-2222-4222-8222-222222222222",
};

describe("#1421 buyer-only consent settlement", () => {
  let listeners: Map<string, () => void>;

  beforeEach(() => {
    mockIsAnalyticsOn.mockReset().mockReturnValue(false);
    mockPrivacySubscribers.clear();
    mockReadReferrerHost.mockReset().mockReturnValue(null);
    mockInvoke.mockReset().mockResolvedValue({
      data: { accepted: true, journeyToken: "opaque-token" },
      error: null,
    });
    const values = new Map<string, string>();
    listeners = new Map();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { search: "" },
        sessionStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
        addEventListener: (event: string, listener: () => void) =>
          listeners.set(event, listener),
        removeEventListener: (event: string) => listeners.delete(event),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("emits zero first-party capture calls for business preview", () => {
    const capture = jest.fn();
    expect(
      runBuyerVenueOrganicCapture("business_preview", capture),
    ).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    const settle = jest.fn(() => () => undefined);
    settleBuyerVenueOrganicCapture("business_preview", settle);
    expect(settle).not.toHaveBeenCalled();
    expect(runBuyerVenueOrganicCapture("buyer_web", capture)).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    settleBuyerVenueOrganicCapture("buyer_web", settle);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("starts the journey on arrival while analytics is on", async () => {
    mockIsAnalyticsOn.mockReturnValue(true);
    const stop = settleVenueOrganicJourneyOnConsent(scope);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockPrivacySubscribers.size).toBe(0);
    stop();
  });

  it("creates exactly one current-venue page journey once analytics is turned back on, never while off", async () => {
    const stop = settleVenueOrganicJourneyOnConsent(scope);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);

    mockIsAnalyticsOn.mockReturnValue(true);
    for (const subscriber of [...mockPrivacySubscribers]) subscriber();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("venue-organic-capture", {
      body: expect.objectContaining({
        brandId: scope.brandId,
        venueId: scope.venueId,
        eventType: "page_view",
        surface: "buyer_web",
        journeyToken: null,
      }),
    });

    for (const subscriber of [...mockPrivacySubscribers]) subscriber();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockPrivacySubscribers.size).toBe(0);
    stop();
  });
});
