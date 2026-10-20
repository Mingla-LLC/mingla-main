// #2107 implementor happy-path proof — Host.
//
// [TEST-MOD-APPROVED #2107] 2026-10-19: the one-tap acknowledgement this file
// originally proved was retired by the approved critical-index redesign (spec
// comment "DEEP INVESTIGATION + SPEC (2026-10-19)" on #2107, defects 4 and 7).
// The parsing assertions are kept unchanged; the acknowledgement-gate
// assertions are replaced by the critical-update equivalents below.
//
// FAILS ON REVERT: every assertion here is against behaviour that does not
// exist without otaUpdatePolicy.ts. Deleting the module or reverting the
// critical branch fails this file at import or on the first blocking assertion.

import {
  ABSENT_POLICY_ROW_UPDATED_AT,
  CRITICAL_UPDATE_MAX_ATTEMPTS,
  OtaGateCoordinator,
  getAttemptRecordKey,
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
  criticalIndex: 2,
  reason: null,
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
  const state = {
    fetched: 0,
    reloaded: 0,
    saved: [] as string[],
    events: [] as string[],
  };
  const deps: OtaGateDependencies = {
    platform: "ios",
    updates: {
      isEnabled: true,
      runtimeVersion: "1.1.4",
      runningUpdateId: "running-1",
      runningCriticalIndex: 1,
      isEmergencyLaunch: false,
      checkForUpdate: async () => check(),
      fetchUpdate: async () => {
        state.fetched += 1;
        return { isNew: true, updateId: "update-a" };
      },
      reload: async () => {
        state.reloaded += 1;
      },
    },
    fetchPolicy: async () => policy(),
    loadAttemptRecord: async () => null,
    saveAttemptRecord: async (value: string) => {
      state.saved.push(value);
    },
    clearAttemptRecord: async () => undefined,
    report: (event) => {
      state.events.push(event);
    },
    policyTimeoutMs: 50,
    checkTimeoutMs: 50,
    downloadTimeoutMs: 50,
    recordTimeoutMs: 50,
    reloadGraceMs: 5,
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

  it("scopes the attempt record to app, platform, runtime and schema", () => {
    expect(getAttemptRecordKey("ios", "1.1.4")).toBe(
      "mingla.criticalUpdateAttempt.business.ios.1.1.4.schema1",
    );
    expect(getAttemptRecordKey("android", "1.1.2")).not.toBe(
      getAttemptRecordKey("android", "1.1.4"),
    );
  });
});

describe("#2107 Host critical-update gate", () => {
  it("installs a critical update, records the attempt, then restarts into it", async () => {
    const h = harness();
    const gate = new OtaGateCoordinator(h.deps);
    const phases: string[] = [];
    gate.subscribe((snapshot) => phases.push(snapshot.phase));

    await gate.check();

    expect(phases[0]).toBe("updating");
    expect(h.fetched).toBe(1);
    expect(h.reloaded).toBe(1);
    expect(h.saved).toEqual([JSON.stringify({ targetUpdateId: "update-a", attempts: 1 })]);
    expect(h.events).toContain("critical_update_offered");
  });

  it("stays out of the way when the server row switches enforcement off", async () => {
    const h = harness({ fetchPolicy: async () => policy({ mode: "silent" }) });
    const gate = new OtaGateCoordinator(h.deps);
    expect((await gate.check()).phase).toBe("open");
    expect(h.fetched).toBe(0);
    expect(h.events).toContain("critical_update_switched_off");
  });

  it("does not hold anyone for a normal (non-critical) update", async () => {
    const h = harness({
      updates: {
        ...harness().deps.updates,
        runningCriticalIndex: 2,
        checkForUpdate: async () => check({ criticalIndex: 2 }),
      },
    });
    const gate = new OtaGateCoordinator(h.deps);
    expect((await gate.check()).phase).toBe("open");
    expect(h.events).toContain("non_critical_update_available");
  });

  it("enforces on a runtime that has no policy row at all", async () => {
    const h = harness({
      fetchPolicy: async () =>
        policy({ mode: "silent", message: "", updatedAt: ABSENT_POLICY_ROW_UPDATED_AT }),
    });
    const gate = new OtaGateCoordinator(h.deps);
    await gate.check();
    expect(h.reloaded).toBe(1);
  });

  it("treats the old emergency force_restart row as plain enforcement", async () => {
    const h = harness({ fetchPolicy: async () => policy({ mode: "force_restart" }) });
    const gate = new OtaGateCoordinator(h.deps);
    await gate.check();
    expect(h.fetched).toBe(1);
    expect(h.reloaded).toBe(1);
    expect(h.events).toContain("critical_update_reloading");
  });

  it("bounds attempts and lets the user in rather than bricking the lane", async () => {
    const h = harness({
      loadAttemptRecord: async () =>
        JSON.stringify({ targetUpdateId: "update-a", attempts: CRITICAL_UPDATE_MAX_ATTEMPTS }),
    });
    const gate = new OtaGateCoordinator(h.deps);
    await gate.check();

    expect(gate.getSnapshot().phase).toBe("open");
    expect(h.fetched).toBe(0);
    expect(h.reloaded).toBe(0);
    expect(h.events).toContain("critical_update_attempts_exhausted");
  });
});
