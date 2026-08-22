import type { AppVersionPolicy } from "../appVersionPolicy";

const mockConstants: {
  nativeAppVersion: unknown;
  expoConfig: { version?: unknown } | null;
} = {
  nativeAppVersion: null,
  expoConfig: { version: "1.1.6" },
};
let mockPlatformOS: string = "ios";
const mockStorageGet = jest.fn<Promise<string | null>, [string]>();
const mockStorageSet = jest.fn<Promise<void>, [string, string]>();
const mockCreateClient = jest.fn(
  (_url: string, _key: string, options: unknown) => ({ options }),
);

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: mockConstants,
}));

jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: mockStorageGet,
    setItem: mockStorageSet,
  },
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

function loadIdentity(): typeof import("../appVersionIdentity") {
  return jest.requireActual(
    "../appVersionIdentity",
  ) as typeof import("../appVersionIdentity");
}

function loadPolicy(): typeof import("../appVersionPolicy") {
  return jest.requireActual(
    "../appVersionPolicy",
  ) as typeof import("../appVersionPolicy");
}

function policy(platform: "ios" | "android" = "ios"): AppVersionPolicy {
  return {
    appId: "explorer",
    platform,
    minimumVersion: "1.1.5",
    storeUrl: "https://example.com/store",
    message: "Update Mingla to keep using the app.",
    enforcementMode: "enforce",
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("#2443 tester adversarial Explorer native identity", () => {
  let warnSpy: jest.SpyInstance;
  let originalFetch: typeof global.fetch;
  let hadDev: boolean;
  let priorDev: boolean | undefined;

  beforeEach(() => {
    jest.resetModules();
    Object.defineProperties(mockConstants, {
      nativeAppVersion: {
        configurable: true,
        enumerable: true,
        value: null,
        writable: true,
      },
      expoConfig: {
        configurable: true,
        enumerable: true,
        value: { version: "1.1.6" },
        writable: true,
      },
    });
    mockPlatformOS = "ios";
    mockStorageGet.mockReset().mockResolvedValue(null);
    mockStorageSet.mockReset().mockResolvedValue(undefined);
    mockCreateClient.mockClear();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    originalFetch = global.fetch;
    hadDev = Object.prototype.hasOwnProperty.call(globalThis, "__DEV__");
    priorDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    global.fetch = originalFetch;
    if (hadDev) Object.assign(globalThis, { __DEV__: priorDev });
    else delete (globalThis as { __DEV__?: boolean }).__DEV__;
  });

  it.each([false, true])(
    "uses a valid fallback after a hostile invalid primary when __DEV__=%s",
    (dev) => {
      Object.assign(globalThis, { __DEV__: dev });
      mockConstants.nativeAppVersion = "v1.1.6";
      mockConstants.expoConfig = { version: "1.1.6" };

      const identity = loadIdentity();
      expect(identity.getInstalledNativeVersion()).toBe("1.1.6");
      expect(identity.getNativeAppVersionHeaders()).toEqual({
        "X-Mingla-App-Id": "explorer",
        "X-Mingla-App-Platform": "ios",
        "X-Mingla-App-Version": "1.1.6",
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith("[app-version-identity]", {
        appId: "explorer",
        platform: "ios",
        outcome: "expo_config_fallback",
        severity: "warning",
      });
      const diagnostic = warnSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(Object.keys(diagnostic).sort()).toEqual([
        "appId",
        "outcome",
        "platform",
        "severity",
      ]);
      expect(JSON.stringify(diagnostic)).not.toContain("1.1.6");
    },
  );

  it.each([
    116,
    true,
    {},
    [],
    "01.1.6",
    "1.01.6",
    "1.1.06",
    "1.1.6\n",
  ])("fails closed for hostile identity %p", (value) => {
    mockConstants.nativeAppVersion = value;
    mockConstants.expoConfig = { version: value };

    const identity = loadIdentity();
    expect(identity.getInstalledNativeVersion()).toBeNull();
    expect(identity.getNativeAppVersionHeaders()).toMatchObject({
      "X-Mingla-App-Version": "",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toEqual({
      appId: "explorer",
      platform: "ios",
      outcome: "unavailable",
      severity: "error",
    });
  });

  it("returns the strict fallback even when diagnostic transport throws", () => {
    warnSpy.mockImplementation(() => {
      throw new Error("diagnostic transport unavailable");
    });
    const identity = loadIdentity();

    expect(identity.getInstalledNativeVersion()).toBe("1.1.6");
    expect(identity.getNativeAppVersionHeaders()["X-Mingla-App-Version"]).toBe(
      "1.1.6",
    );
  });

  it.each(["web", "windows", "macos"])(
    "exits on non-native %s before reading either identity source",
    (platform) => {
      mockPlatformOS = platform;
      Object.defineProperties(mockConstants, {
        nativeAppVersion: {
          configurable: true,
          get: () => {
            throw new Error("web read nativeAppVersion");
          },
        },
        expoConfig: {
          configurable: true,
          get: () => {
            throw new Error("web read expoConfig");
          },
        },
      });

      const identity = loadIdentity();
      expect(identity.getInstalledNativeVersion()).toBeNull();
      expect(identity.getNativeAppVersionHeaders()).toEqual({});
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it("threads the resolved Android identity through the real Supabase header owner and coordinator cache", async () => {
    mockPlatformOS = "android";
    mockConstants.nativeAppVersion = undefined;
    mockConstants.expoConfig = { version: "1.1.6" };
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => policy("android"),
    })) as jest.Mock;

    jest.requireActual("../supabase");
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient.mock.calls[0][2]).toMatchObject({
      global: {
        headers: {
          "X-Mingla-App-Id": "explorer",
          "X-Mingla-App-Platform": "android",
          "X-Mingla-App-Version": "1.1.6",
        },
      },
    });

    const coordinator = loadPolicy().createAppVersionCoordinator();
    await expect(coordinator.check(true)).resolves.toMatchObject({
      phase: "allowed",
      decision: { state: "allowed" },
    });
    expect(mockStorageGet).toHaveBeenCalledWith(
      "mingla.appVersionPolicy.explorer.android.1.1.6.schema1",
    );
    expect(mockStorageGet).not.toHaveBeenCalledWith(
      "mingla.appVersionPolicy.unavailable",
    );
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes("installed_version_unavailable"),
      ),
    ).toBe(false);
  });
});
