import {
  VersionGateCoordinator,
  compareSemver,
  parsePolicy,
  type AppVersionPolicy,
} from "../appVersionPolicy";

jest.mock("../supabase", () => ({
  supabaseUrl: "https://example.supabase.co",
}));
jest.mock("../appVersionIdentity", () => ({
  APP_VERSION_APP_ID: "explorer",
  APP_VERSION_SCHEMA: 1,
  getInstalledNativeVersion: () => "1.1.4",
  getNativeAppPlatform: () => "ios",
}));

const policy = (
  overrides: Partial<AppVersionPolicy> = {},
): AppVersionPolicy => ({
  appId: "explorer",
  platform: "ios",
  minimumVersion: "1.1.5",
  storeUrl: "https://apps.apple.com/app/id6760440898",
  message: "Update Mingla to keep using the app.",
  enforcementMode: "observe",
  updatedAt: "2026-08-14T12:00:00.000Z",
  ...overrides,
});

describe("#2075 Consumer app-version happy path", () => {
  it("compares numeric SemVer and validates the exact app/platform/store schema", () => {
    expect(compareSemver("1.1.10", "1.1.9")).toBe(1);
    expect(compareSemver("1.1.4", "1.1.5")).toBe(-1);
    expect(compareSemver("v1.1.5", "1.1.5")).toBeNull();
    expect(parsePolicy(policy(), "ios")?.storeUrl).toBe(
      "https://apps.apple.com/app/id6760440898",
    );
    expect(parsePolicy({ ...policy(), platform: "android" }, "ios")).toBeNull();
    expect(parsePolicy({ ...policy(), extra: true }, "ios")).toBeNull();
  });

  it("keeps a cached required decision blocking when the refresh is offline", async () => {
    const states: string[] = [];
    const coordinator = new VersionGateCoordinator({
      platform: "ios",
      installedVersion: "1.1.4",
      loadCache: async () => JSON.stringify(policy()),
      saveCache: async () => undefined,
      fetchPolicy: async () => {
        throw new Error("offline");
      },
      report: () => undefined,
      timeoutMs: 50,
    });
    coordinator.subscribe((snapshot) => states.push(snapshot.phase));
    const result = await coordinator.check(true);
    expect(result.phase).toBe("required");
    expect(result.decision).toMatchObject({
      state: "required",
      minimumVersion: "1.1.5",
      storeUrl: "https://apps.apple.com/app/id6760440898",
    });
    expect(states).toContain("required");
  });

  it("deduplicates requests and permits a valid lowered floor to release the gate", async () => {
    let resolveFetch!: (value: AppVersionPolicy) => void;
    let fetchCount = 0;
    const coordinator = new VersionGateCoordinator({
      platform: "ios",
      installedVersion: "1.1.4",
      loadCache: async () => JSON.stringify(policy()),
      saveCache: async () => undefined,
      fetchPolicy: () => {
        fetchCount += 1;
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      },
      report: () => undefined,
      timeoutMs: 500,
    });
    const first = coordinator.check(true);
    const second = coordinator.check(true);
    await Promise.resolve();
    resolveFetch(policy({ minimumVersion: "1.1.4" }));
    await expect(first).resolves.toMatchObject({ phase: "allowed" });
    await expect(second).resolves.toMatchObject({ phase: "allowed" });
    expect(fetchCount).toBe(1);
  });

  it("lets a fresh lowered floor win when cache persistence fails", async () => {
    const reports: string[] = [];
    const coordinator = new VersionGateCoordinator({
      platform: "ios",
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

  it("ignores a required response that arrives after the 1.5-second decision budget", async () => {
    let resolveFetch!: (value: AppVersionPolicy) => void;
    const coordinator = new VersionGateCoordinator({
      platform: "ios",
      installedVersion: "1.1.4",
      loadCache: async () => null,
      saveCache: async () => undefined,
      fetchPolicy: () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      report: () => undefined,
      timeoutMs: 5,
    });
    await expect(coordinator.check(true)).resolves.toMatchObject({
      phase: "allowed",
      decision: { state: "unknown" },
    });
    resolveFetch(policy());
    await Promise.resolve();
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "allowed" });
  });
});
