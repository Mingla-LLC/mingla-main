const A = "A".repeat(43);
const B = "B".repeat(43);
const KEY = "mingla_site_attribution_v1";

function browser(url: string, stored: string | null) {
  const values = new Map<string, string>();
  if (stored !== null) values.set(KEY, stored);
  const storage = {
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => values.set(key, value)),
    removeItem: jest.fn((key: string) => values.delete(key)),
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { href: url }, sessionStorage: storage },
  });
  return storage;
}

describe("#2830 browser site attribution", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("keeps valid unexpired first touch A when a later URL carries B", () => {
    const now = 2_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    const storage = browser(
      `https://business.usemingla.com/checkout?site_attribution=${B}`,
      JSON.stringify({ token: A, capturedAt: now - 10_000 }),
    );
    const { getStoredSiteAttribution } = require("../siteAttribution.web");
    expect(getStoredSiteAttribution()).toBe(A);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("expires A and captures valid B as the new first touch", () => {
    const now = 3_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    const storage = browser(
      `https://business.usemingla.com/checkout?site_attribution=${B}`,
      JSON.stringify({ token: A, capturedAt: now - 30 * 60_000 - 1 }),
    );
    const { getStoredSiteAttribution } = require("../siteAttribution.web");
    expect(getStoredSiteAttribution()).toBe(B);
    expect(storage.removeItem).toHaveBeenCalledWith(KEY);
    expect(storage.setItem).toHaveBeenCalledWith(
      KEY,
      JSON.stringify({ token: B, capturedAt: now }),
    );
  });

  it("never lets a malformed URL value overwrite first-touch storage", () => {
    const now = 4_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    const storage = browser(
      "https://business.usemingla.com/checkout?site_attribution=not-a-token",
      JSON.stringify({ token: A, capturedAt: now - 1 }),
    );
    const { getStoredSiteAttribution } = require("../siteAttribution.web");
    expect(getStoredSiteAttribution()).toBe(A);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("fails open when storage access is blocked", () => {
    browser(
      `https://business.usemingla.com/checkout?site_attribution=${B}`,
      null,
    ).getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { getStoredSiteAttribution } = require("../siteAttribution.web");
    expect(getStoredSiteAttribution()).toBe(B);
  });
});
