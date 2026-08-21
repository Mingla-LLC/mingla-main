const mockReportNonFatal = jest.fn();
const mockInvoke = jest.fn();
const mockConstants: {
  nativeAppVersion: string | null;
  expoConfig: { version?: string } | null;
} = {
  nativeAppVersion: "1.1.5",
  expoConfig: { version: "1.1.5" },
};
let mockPlatformOS: "ios" | "android" | "web" = "ios";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: mockConstants,
}));

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return mockPlatformOS;
      },
    },
  };
});

jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: mockReportNonFatal,
}));

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

import {
  listPaystackBanks,
  PaystackBankListError,
} from "../brandPaystackService";

function loadIdentity(): typeof import("../appVersionIdentity") {
  let loaded: typeof import("../appVersionIdentity") | null = null;
  jest.isolateModules(() => {
    loaded =
      require("../appVersionIdentity") as typeof import("../appVersionIdentity");
  });
  if (loaded === null) throw new Error("identity module did not load");
  return loaded;
}

describe("#2418 native Host release identity", () => {
  beforeEach(() => {
    mockReportNonFatal.mockClear();
    mockConstants.nativeAppVersion = "1.1.5";
    mockConstants.expoConfig = { version: "9.9.9" };
    mockPlatformOS = "ios";
  });

  it("keeps nativeAppVersion primary and uses strict expoConfig.version in Release", () => {
    let identity = loadIdentity();
    expect(identity.getInstalledNativeVersion()).toBe("1.1.5");
    expect(mockReportNonFatal).not.toHaveBeenCalled();

    mockConstants.nativeAppVersion = null;
    mockConstants.expoConfig = { version: "1.1.5" };
    const hadDev = Object.prototype.hasOwnProperty.call(globalThis, "__DEV__");
    const priorDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    Object.assign(globalThis, { __DEV__: false });
    try {
      identity = loadIdentity();
      expect(identity.getNativeAppVersionHeaders()).toEqual({
        "X-Mingla-App-Id": "business",
        "X-Mingla-App-Platform": "ios",
        "X-Mingla-App-Version": "1.1.5",
      });
    } finally {
      if (hadDev) {
        Object.assign(globalThis, { __DEV__: priorDev });
      } else {
        delete (globalThis as { __DEV__?: boolean }).__DEV__;
      }
    }
    expect(mockReportNonFatal).toHaveBeenCalledTimes(1);
    expect(mockReportNonFatal.mock.calls[0]?.[2]).toEqual({
      appId: "business",
      platform: "ios",
      outcome: "expo_config_fallback",
      severity: "warning",
    });
  });

  it("never normalizes invalid values, reports once, and sends no web headers", () => {
    mockConstants.nativeAppVersion = " 1.1.5 ";
    mockConstants.expoConfig = { version: "1.1" };
    let identity = loadIdentity();
    expect(identity.getInstalledNativeVersion()).toBeNull();
    expect(identity.getInstalledNativeVersion()).toBeNull();
    expect(mockReportNonFatal).toHaveBeenCalledTimes(1);
    expect(mockReportNonFatal.mock.calls[0]?.[2]).toMatchObject({
      appId: "business",
      platform: "ios",
      outcome: "unavailable",
      severity: "error",
    });

    mockReportNonFatal.mockClear();
    mockPlatformOS = "web";
    identity = loadIdentity();
    expect(identity.getNativeAppVersionHeaders()).toEqual({});
    expect(mockReportNonFatal).not.toHaveBeenCalled();
  });
});

describe("#2418 validated Paystack bank catalogue", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("returns valid rows and accepts only an explicit empty array as provider-empty", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { banks: [{ name: "Access Bank", code: "044" }] },
      error: null,
    });
    await expect(listPaystackBanks()).resolves.toEqual([
      { name: "Access Bank", code: "044" },
    ]);

    mockInvoke.mockResolvedValueOnce({ data: { banks: [] }, error: null });
    await expect(listPaystackBanks()).resolves.toEqual([]);
  });

  it.each([
    ["missing body", null],
    ["missing banks", {}],
    ["non-array banks", { banks: "nope" }],
    ["malformed row", { banks: [{ name: "Access Bank", code: "" }] }],
  ])(
    "classifies %s as invalid response rather than bank data",
    async (_label, data) => {
      mockInvoke.mockResolvedValueOnce({ data, error: null });
      await expect(listPaystackBanks()).rejects.toMatchObject({
        name: "PaystackBankListError",
        code: "invalid_response",
        status: null,
      });
    },
  );

  it("preserves only safe status/code from invocation failures", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        context: {
          status: 426,
          json: async () => ({
            error: "app_update_required",
            detail: "token=secret account=0123456789",
          }),
        },
      },
    });

    let caught: unknown;
    try {
      await listPaystackBanks();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PaystackBankListError);
    expect(caught).toMatchObject({ code: "app_update_required", status: 426 });
    expect(String(caught)).not.toContain("secret");
    expect(String(caught)).not.toContain("0123456789");
  });
});
