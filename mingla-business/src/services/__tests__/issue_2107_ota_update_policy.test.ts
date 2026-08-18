// #2107 implementor happy-path proof — Host.
//
// FAILS ON REVERT: every assertion here is against behaviour that does not
// exist without otaUpdatePolicy.ts. Deleting the module or reverting the
// blocking branch fails this file at import or on the first blocking assertion.

import {
  FORCE_RESTART_MAX_ATTEMPTS,
  OtaGateCoordinator,
  getAcknowledgementCacheKey,
  isOtaUpdateMode,
  parseOtaPolicy,
  type AppOtaPolicy,
  type OtaGateDependencies,
  type OtaUpdateCheck,
} from "../otaUpdatePolicy";

const policy = (overrides: Partial<AppOtaPolicy> = {}): AppOtaPolicy => ({
  appId: "business",
  platform: "ios",
  runtimeVersion: "1.1.4",
  mode: "acknowledge",
  message: "A required update is ready. Tap to download it.",
  updatedAt: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

const check = (overrides: Partial<OtaUpdateCheck> = {}): OtaUpdateCheck => ({
  isAvailable: true,
  isRollBackToEmbedded: false,
  updateId: "update-a",
  ...overrides,
});

type Harness = {
  deps: OtaGateDependencies;
  fetched: number;
  reloaded: number;
  saved: string[];
  events: string[];
};

function harness(overrides: Partial<OtaGateDependencies> = {}): Harness {
  const state = { fetched: 0, reloaded: 0, saved: [] as string[], events: [] as string[] };
  const deps: OtaGateDependencies = {
    platform: "ios",
    updates: {
      isEnabled: true,
      runtimeVersion: "1.1.4",
      checkForUpdate: async () => check(),
      fetchUpdate: async () => {
        state.fetched += 1;
      },
      reload: async () => {
        state.reloaded += 1;
      },
    },
    fetchPolicy: async () => policy(),
    loadAcknowledgement: async () => null,
    saveAcknowledgement: async (id) => {
      state.saved.push(id);
    },
    report: (event) => {
      state.events.push(event);
    },
    timeoutMs: 50,
    ...overrides,
  };
  return {
    deps,
    get fetched() {
      return state.fetched;
    },
    get reloaded() {
      return state.reloaded;
    },
    saved: state.saved,
    events: state.events,
  } as Harness;
}

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("#2107 Host OTA policy parsing", () => {
  it("accepts the exact server key set and nothing else", () => {
    expect(parseOtaPolicy(policy(), "ios", "1.1.4")?.mode).toBe("acknowledge");
    expect(parseOtaPolicy({ ...policy(), extra: true }, "ios", "1.1.4")).toBeNull();
    expect(parseOtaPolicy({ ...policy(), platform: "android" }, "ios", "1.1.4")).toBeNull();
    expect(parseOtaPolicy(policy({ runtimeVersion: "1.1.2" }), "ios", "1.1.4")).toBeNull();
    expect(parseOtaPolicy(policy({ appId: "explorer" as never }), "ios", "1.1.4")).toBeNull();
  });

  it("names exactly the three modes the server can express", () => {
    expect(isOtaUpdateMode("silent")).toBe(true);
    expect(isOtaUpdateMode("acknowledge")).toBe(true);
    expect(isOtaUpdateMode("force_restart")).toBe(true);
    expect(isOtaUpdateMode("required")).toBe(false);
    expect(isOtaUpdateMode(undefined)).toBe(false);
  });

  it("scopes the acknowledgement cache to app, platform, runtime and schema", () => {
    expect(getAcknowledgementCacheKey("ios", "1.1.4")).toBe(
      "mingla.otaAcknowledgement.business.ios.1.1.4.schema1",
    );
    expect(getAcknowledgementCacheKey("android", "1.1.2")).not.toBe(
      getAcknowledgementCacheKey("android", "1.1.4"),
    );
  });
});

describe("#2107 Host acknowledgement gate", () => {
  it("blocks on an acknowledge policy, then releases the app on the single tap", async () => {
    const h = harness();
    const gate = new OtaGateCoordinator(h.deps);
    const phases: string[] = [];
    gate.subscribe((snapshot) => phases.push(snapshot.phase));

    const blocked = await gate.check();
    expect(blocked.phase).toBe("acknowledge");
    expect(blocked.mode).toBe("acknowledge");
    expect(blocked.updateId).toBe("update-a");
    expect(blocked.message).toContain("update");

    await gate.acknowledge();
    await settle();

    expect(gate.getSnapshot().phase).toBe("open");
    expect(h.saved).toEqual(["update-a"]);
    expect(h.fetched).toBe(1);
    expect(h.reloaded).toBe(0);
    expect(phases).toEqual(["acknowledge", "open"]);
  });

  it("stays out of the way when the server says silent", async () => {
    const h = harness({ fetchPolicy: async () => policy({ mode: "silent" }) });
    const gate = new OtaGateCoordinator(h.deps);
    expect((await gate.check()).phase).toBe("open");
    expect(h.fetched).toBe(0);
    expect(h.events).toContain("silent");
  });

  it("does not re-block an update the user already acknowledged", async () => {
    const h = harness({ loadAcknowledgement: async () => "update-a" });
    const gate = new OtaGateCoordinator(h.deps);
    expect((await gate.check()).phase).toBe("open");
    expect(h.events).toContain("already_acknowledged");
  });

  it("re-arms when a newer update supersedes the acknowledged one", async () => {
    const h = harness({
      loadAcknowledgement: async () => "update-a",
      updates: {
        isEnabled: true,
        runtimeVersion: "1.1.4",
        checkForUpdate: async () => check({ updateId: "update-b" }),
        fetchUpdate: async () => undefined,
        reload: async () => undefined,
      },
    });
    const gate = new OtaGateCoordinator(h.deps);
    const snapshot = await gate.check();
    expect(snapshot.phase).toBe("acknowledge");
    expect(snapshot.updateId).toBe("update-b");
  });

  it("installs and reloads under the emergency force_restart mode", async () => {
    const h = harness({ fetchPolicy: async () => policy({ mode: "force_restart" }) });
    const gate = new OtaGateCoordinator(h.deps);
    const blocked = await gate.check();
    expect(blocked.mode).toBe("force_restart");

    await gate.acknowledge();
    expect(h.fetched).toBe(1);
    expect(h.reloaded).toBe(1);
    expect(h.events).toContain("force_restart_reloading");
  });

  it("bounds force_restart and lets the user in rather than bricking the lane", async () => {
    const h = harness({
      fetchPolicy: async () => policy({ mode: "force_restart" }),
      updates: {
        isEnabled: true,
        runtimeVersion: "1.1.4",
        checkForUpdate: async () => check(),
        fetchUpdate: async () => {
          throw new Error("no update published for this runtime");
        },
        reload: async () => undefined,
      },
    });
    const gate = new OtaGateCoordinator(h.deps);
    await gate.check();
    await gate.acknowledge();

    expect(gate.getSnapshot().phase).toBe("open");
    expect(h.reloaded).toBe(0);
    expect(
      h.events.filter((event) => event === "force_restart_attempt_failed").length,
    ).toBe(FORCE_RESTART_MAX_ATTEMPTS);
    expect(h.events).toContain("force_restart_exhausted_failing_open");
  });
});
