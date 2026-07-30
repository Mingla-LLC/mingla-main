const nativeCapture = jest.fn();
const webCapture = jest.fn();

jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: (...args: unknown[]) => nativeCapture(...args) },
}));
jest.mock("../webAnalytics", () => ({
  captureWeb: (...args: unknown[]) => webCapture(...args),
}));

import {
  captureBusinessAnalyticsOpened,
  captureBusinessAnalyticsRefreshed,
  sanitizeBusinessAnalyticsEntryPoint,
} from "../businessAnalyticsEvents";

describe("issue #874 privacy-allowlisted analytics events", () => {
  beforeEach(() => {
    nativeCapture.mockClear();
    webCapture.mockClear();
  });

  it("sanitizes every route value except the exact home tile value", () => {
    expect(sanitizeBusinessAnalyticsEntryPoint("home_tile")).toBe("home_tile");
    expect(sanitizeBusinessAnalyticsEntryPoint("brand-secret")).toBe("direct");
    expect(sanitizeBusinessAnalyticsEntryPoint(["home_tile"])).toBe("direct");
    expect(sanitizeBusinessAnalyticsEntryPoint(undefined)).toBe("direct");
  });

  it("dual-dispatches the exact opened property allowlist", () => {
    captureBusinessAnalyticsOpened("direct", true);
    const [name, properties] = nativeCapture.mock.calls[0];
    expect(name).toBe("business_analytics_opened");
    expect(Object.keys(properties).sort()).toEqual([
      "entry_point",
      "has_30d_customers",
      "platform",
    ]);
    expect(webCapture).toHaveBeenCalledWith(name, properties);
  });

  it("dual-dispatches refresh without result data or identifiers", () => {
    captureBusinessAnalyticsRefreshed("partial");
    const [name, properties] = nativeCapture.mock.calls[0];
    expect(name).toBe("business_analytics_refreshed");
    expect(Object.keys(properties).sort()).toEqual(["platform", "result"]);
    expect(JSON.stringify(properties)).not.toMatch(/brand|contact|currency|winner/);
  });
});
