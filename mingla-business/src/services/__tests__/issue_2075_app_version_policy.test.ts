import {
  VersionGateCoordinator,
  compareSemver,
  parsePolicy,
  type AppVersionPolicy,
} from "../appVersionPolicy";

jest.mock("../appVersionIdentity", () => ({
  APP_VERSION_APP_ID: "business",
  APP_VERSION_SCHEMA: 1,
  getInstalledNativeVersion: () => "1.1.4",
  getNativeAppPlatform: () => "android",
}));

const policy = (
  overrides: Partial<AppVersionPolicy> = {},
): AppVersionPolicy => ({
  appId: "business",
  platform: "android",
  minimumVersion: "1.1.5",
  storeUrl:
    "https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness",
  message: "Update Mingla to keep using the app.",
  enforcementMode: "observe",
  updatedAt: "2026-08-14T12:00:00.000Z",
  ...overrides,
});

describe("#2075 Host app-version happy path", () => {
  it("compares numeric SemVer and validates the exact app/platform/store schema", () => {
    expect(compareSemver("2.0.0", "1.99.99")).toBe(1);
    expect(compareSemver("1.1.3", "1.1.4")).toBe(-1);
    expect(compareSemver("1.1.4-beta", "1.1.4")).toBeNull();
    expect(parsePolicy(policy(), "android")?.storeUrl).toBe(
      "https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness",
    );
    expect(
      parsePolicy({ ...policy(), appId: "explorer" }, "android"),
    ).toBeNull();
  });

  it("keeps cached required sticky offline and accepts a fresh lowered floor", async () => {
    let online = false;
    const coordinator = new VersionGateCoordinator({
      platform: "android",
      installedVersion: "1.1.4",
      loadCache: async () => JSON.stringify(policy()),
      saveCache: async () => undefined,
      fetchPolicy: async () => {
        if (!online) throw new Error("offline");
        return policy({ minimumVersion: "1.1.4" });
      },
      report: () => undefined,
      timeoutMs: 50,
    });
    await expect(coordinator.check(true)).resolves.toMatchObject({
      phase: "required",
    });
    online = true;
    await expect(coordinator.check(true)).resolves.toMatchObject({
      phase: "allowed",
    });
  });

  it("ignores malformed cache and still performs one fresh request", async () => {
    let fetchCount = 0;
    const coordinator = new VersionGateCoordinator({
      platform: "android",
      installedVersion: "1.1.4",
      loadCache: async () => "{broken",
      saveCache: async () => undefined,
      fetchPolicy: async () => {
        fetchCount += 1;
        return policy({ minimumVersion: "1.1.4" });
      },
      report: () => undefined,
    });
    await expect(coordinator.check(true)).resolves.toMatchObject({
      phase: "allowed",
    });
    expect(fetchCount).toBe(1);
  });

  it("lets a fresh lowered floor win when cache persistence fails", async () => {
    const reports: string[] = [];
    const coordinator = new VersionGateCoordinator({
      platform: "android",
      installedVersion: "1.1.4",
      loadCache: async () => JSON.stringify(policy()),
      saveCache: async () => {
        throw new Error("storage unavailable");
      },
      fetchPolicy: async () => policy({ minimumVersion: "1.1.4" }),
      report: (outcome) => reports.push(outcome),
    });

    await expect(coordinator.check(true)).resolves.toMatchObject({
      phase: "allowed",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "allowed" });
    expect(reports).toContain("policy_cache_write_failed");
  });

  it("hydrates a slow required cache before the network deadline can allow", async () => {
    let resolveCache!: (value: string) => void;
    const coordinator = new VersionGateCoordinator({
      platform: "android",
      installedVersion: "1.1.4",
      loadCache: () =>
        new Promise((resolve) => {
          resolveCache = resolve;
        }),
      saveCache: async () => undefined,
      fetchPolicy: async () => {
        throw new Error("offline");
      },
      report: () => undefined,
      timeoutMs: 5,
    });

    const result = coordinator.check(true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "checking" });
    resolveCache(JSON.stringify(policy()));
    await expect(result).resolves.toMatchObject({ phase: "required" });
  });

  it("compares SemVer segments beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expect(
      compareSemver("1.9007199254740993.0", "1.9007199254740992.0"),
    ).toBe(1);
    expect(
      compareSemver("1.9007199254740992.0", "1.9007199254740993.0"),
    ).toBe(-1);
  });
});
