import type { AppVersionPolicy } from "../appVersionPolicy";

const mockConstants: {
  nativeAppVersion: unknown;
  expoConfig: { version?: unknown } | null;
} = {
  nativeAppVersion: "1.1.6",
  expoConfig: { version: "1.1.6" },
};
let mockPlatformOS: "ios" | "android" | "web" = "ios";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: mockConstants,
}));

jest.mock("react-native", () => {
  return {
    Platform: {
      get OS() {
        return mockPlatformOS;
      },
    },
  };
});

jest.mock("../supabase", () => ({
  supabaseUrl: "https://example.supabase.co",
}));

function loadIdentity(): typeof import("../appVersionIdentity") {
  let loaded: typeof import("../appVersionIdentity") | null = null;
  jest.isolateModules(() => {
    loaded =
      jest.requireActual("../appVersionIdentity") as typeof import("../appVersionIdentity");
  });
  if (loaded === null) throw new Error("identity module did not load");
  return loaded;
}

function loadPolicyModule(): typeof import("../appVersionPolicy") {
  return jest.requireActual(
    "../appVersionPolicy",
  ) as typeof import("../appVersionPolicy");
}

function policy(minimumVersion: string): AppVersionPolicy {
  return {
    appId: "explorer",
    platform: mockPlatformOS === "android" ? "android" : "ios",
    minimumVersion,
    storeUrl: "https://example.com/store",
    message: "Update Mingla to keep using the app.",
    enforcementMode: "enforce",
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("#2443 Explorer installed native identity", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockConstants.nativeAppVersion = "1.1.6";
    mockConstants.expoConfig = { version: "9.9.9" };
    mockPlatformOS = "ios";
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each(["ios", "android"] as const)(
    "keeps a strict primary authoritative on %s without a fallback report",
    (platform) => {
      mockPlatformOS = platform;
      const identity = loadIdentity();

      expect(identity.getInstalledNativeVersion()).toBe("1.1.6");
      expect(identity.getNativeAppVersionHeaders()).toEqual({
        "X-Mingla-App-Id": "explorer",
        "X-Mingla-App-Platform": platform,
        "X-Mingla-App-Version": "1.1.6",
      });
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["ios", "android"] as const)(
    "resolves strict Expo config in Release on %s and reports the fallback once",
    (platform) => {
      mockPlatformOS = platform;
      mockConstants.nativeAppVersion = null;
      mockConstants.expoConfig = { version: "1.1.6" };
      const hadDev = Object.prototype.hasOwnProperty.call(globalThis, "__DEV__");
      const priorDev = (globalThis as { __DEV__?: boolean }).__DEV__;
      Object.assign(globalThis, { __DEV__: false });
      try {
        const identity = loadIdentity();
        expect(identity.getInstalledNativeVersion()).toBe("1.1.6");
        expect(identity.getNativeAppVersionHeaders()).toEqual({
          "X-Mingla-App-Id": "explorer",
          "X-Mingla-App-Platform": platform,
          "X-Mingla-App-Version": "1.1.6",
        });
        expect(identity.getInstalledNativeVersion()).toBe("1.1.6");
      } finally {
        if (hadDev) Object.assign(globalThis, { __DEV__: priorDev });
        else delete (globalThis as { __DEV__?: boolean }).__DEV__;
      }

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith("[app-version-identity]", {
        appId: "explorer",
        platform,
        outcome: "expo_config_fallback",
        severity: "warning",
      });
    },
  );

  it.each([
    null,
    "1.1",
    "v1.1.6",
    " 1.1.6 ",
    "1.1.6-beta.1",
    "1.1.6+build.1",
  ])("rejects malformed identity %p without normalization", (value) => {
    mockConstants.nativeAppVersion = value;
    mockConstants.expoConfig = { version: value };
    const identity = loadIdentity();

    expect(identity.getInstalledNativeVersion()).toBeNull();
    expect(identity.getInstalledNativeVersion()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[app-version-identity]", {
      appId: "explorer",
      platform: "ios",
      outcome: "unavailable",
      severity: "error",
    });
  });

  it.each(["1.1.6", "not-a-version"])(
    "keeps web non-native when config contains %s",
    (value) => {
      mockPlatformOS = "web";
      mockConstants.nativeAppVersion = "1.1.6";
      mockConstants.expoConfig = { version: value };
      const identity = loadIdentity();

      expect(identity.getInstalledNativeVersion()).toBeNull();
      expect(identity.getNativeAppVersionHeaders()).toEqual({});
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it("feeds the real coordinator a version-owned cache key and preserves allowed/required", async () => {
    mockConstants.nativeAppVersion = null;
    mockConstants.expoConfig = { version: "1.1.6" };
    const installedVersion = loadIdentity().getInstalledNativeVersion();
    expect(installedVersion).toBe("1.1.6");
    if (installedVersion === null) {
      throw new Error("strict Expo config version did not resolve");
    }
    const { VersionGateCoordinator, getPolicyCacheKey } = loadPolicyModule();
    expect(getPolicyCacheKey("ios", installedVersion)).toBe(
      "mingla.appVersionPolicy.explorer.ios.1.1.6.schema1",
    );

    const allowedReports: string[] = [];
    const allowed = new VersionGateCoordinator({
      platform: "ios",
      installedVersion,
      loadCache: async () => null,
      saveCache: async () => undefined,
      fetchPolicy: async () => policy("1.1.5"),
      report: (outcome) => allowedReports.push(outcome),
    });
    await expect(allowed.check(true)).resolves.toMatchObject({
      phase: "allowed",
      decision: { state: "allowed" },
    });
    expect(allowedReports).toContain("allowed");
    expect(allowedReports).not.toContain("installed_version_unavailable");

    const required = new VersionGateCoordinator({
      platform: "ios",
      installedVersion,
      loadCache: async () => null,
      saveCache: async () => undefined,
      fetchPolicy: async () => policy("1.1.7"),
      report: () => undefined,
    });
    await expect(required.check(true)).resolves.toMatchObject({
      phase: "required",
      decision: { state: "required", minimumVersion: "1.1.7" },
    });
  });
});
