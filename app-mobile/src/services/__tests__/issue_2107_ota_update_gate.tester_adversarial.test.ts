// #2107 tester adversarial proof — Consumer.
//
// [TEST-MOD-APPROVED #2107] 2026-10-19: rebased onto the approved critical-index
// redesign (spec comment "DEEP INVESTIGATION + SPEC (2026-10-19)" on #2107).
// Every "stays open" case and every resume-storm case below is the original
// case against the new coordinator. The acknowledgement-tap cases are replaced
// by their critical-update equivalents: there is no tap any more.
//
// Assumes the gate is BROKEN until proven otherwise. Every case here is a way
// this layer could lock a user out of the app with no OTA path back in, which
// is the one failure mode that cannot be fixed after the fact.
//
// The single invariant under attack: BLOCKING IS ONLY EVER A DELIBERATE,
// BOUNDED BRANCH — a critical update that is offered, downloadable and not yet
// tried twice. Everything else is open.

import {
  OtaGateCoordinator,
  parseOtaPolicy,
  type AppOtaPolicy,
  type OtaGateDependencies,
  type OtaUpdateBridge,
  type OtaUpdateCheck,
} from "../otaUpdatePolicy";

const policy = (overrides: Partial<AppOtaPolicy> = {}): AppOtaPolicy => ({
  appId: "explorer",
  platform: "ios",
  runtimeVersion: "1.1.4",
  mode: "acknowledge",
  message: "A required update is ready.",
  updatedAt: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

const check = (overrides: Partial<OtaUpdateCheck> = {}): OtaUpdateCheck => ({
  isAvailable: true,
  isRollBackToEmbedded: false,
  updateId: "update-a",
  criticalIndex: 5,
  reason: null,
  ...overrides,
});

const bridge = (overrides: Partial<OtaUpdateBridge> = {}): OtaUpdateBridge => ({
  isEnabled: true,
  runtimeVersion: "1.1.4",
  runningUpdateId: "running-1",
  runningCriticalIndex: 4,
  isEmergencyLaunch: false,
  checkForUpdate: async () => check(),
  fetchUpdate: async () => ({ isNew: true, updateId: "update-a" }),
  reload: async () => undefined,
  ...overrides,
});

function deps(overrides: Partial<OtaGateDependencies> = {}): OtaGateDependencies {
  return {
    platform: "ios",
    updates: bridge(),
    fetchPolicy: async () => policy(),
    loadAttemptRecord: async () => null,
    saveAttemptRecord: async () => undefined,
    clearAttemptRecord: async () => undefined,
    report: () => undefined,
    policyTimeoutMs: 30,
    checkTimeoutMs: 30,
    downloadTimeoutMs: 30,
    recordTimeoutMs: 30,
    reloadGraceMs: 5,
    ...overrides,
  };
}

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

describe("#2107 adversarial — nothing but a bounded critical update may block", () => {
  it.each([
    [
      "the update check throws",
      deps({
        updates: bridge({
          checkForUpdate: async () => {
            throw new Error("updates unreachable");
          },
        }),
      }),
    ],
    ["the update check hangs past the timeout", deps({ updates: bridge({ checkForUpdate: never }) })],
    [
      "no update is actually available",
      deps({ updates: bridge({ checkForUpdate: async () => check({ isAvailable: false, updateId: null }) }) }),
    ],
    [
      "the available update is a roll-back to embedded",
      deps({
        updates: bridge({
          checkForUpdate: async () =>
            check({ isAvailable: false, isRollBackToEmbedded: true, updateId: null }),
        }),
      }),
    ],
    [
      "updates are disabled in this build",
      deps({ updates: bridge({ isEnabled: false, runtimeVersion: null }) }),
    ],
    ["the runtime version is unreadable", deps({ updates: bridge({ runtimeVersion: "not-a-version" }) })],
    ["the platform is web", deps({ platform: null })],
    [
      "the download throws",
      deps({
        updates: bridge({
          fetchUpdate: async () => {
            throw new Error("network died mid-download");
          },
        }),
      }),
    ],
    ["the download hangs past the timeout", deps({ updates: bridge({ fetchUpdate: never }) })],
    [
      "the attempt record cannot be written",
      deps({
        saveAttemptRecord: async () => {
          throw new Error("storage full");
        },
      }),
    ],
    [
      "the attempt record cannot be read",
      deps({
        loadAttemptRecord: async () => {
          throw new Error("storage unreadable");
        },
      }),
    ],
  ])("ends open when %s", async (_label, dependencies) => {
    const gate = new OtaGateCoordinator(dependencies);
    expect((await gate.check()).phase).toBe("open");
  });

  it("never reads a policy at all when the updates bridge is disabled", async () => {
    let policyReads = 0;
    const gate = new OtaGateCoordinator(
      deps({
        updates: bridge({ isEnabled: false, runtimeVersion: null }),
        fetchPolicy: async () => {
          policyReads += 1;
          return policy();
        },
      }),
    );
    await gate.check();
    expect(policyReads).toBe(0);
  });

  it("never restarts when the attempt record cannot be written", async () => {
    let reloads = 0;
    const gate = new OtaGateCoordinator(
      deps({
        saveAttemptRecord: async () => {
          throw new Error("storage full");
        },
        updates: bridge({
          reload: async () => {
            reloads += 1;
          },
        }),
      }),
    );
    await gate.check();
    expect(reloads).toBe(0);
  });

  it("refuses a mode string it cannot name, even a plausible one", () => {
    for (const mode of ["required", "blocking", "ACKNOWLEDGE", "", null, 1]) {
      expect(parseOtaPolicy({ ...policy(), mode }, "ios", "1.1.4")).toBeNull();
    }
  });
});

describe("#2107 adversarial — resume storms cannot re-block or stack work", () => {
  it("does not start a second install while the first is still downloading", async () => {
    let fetches = 0;
    let releaseFetch!: () => void;
    const gate = new OtaGateCoordinator(
      deps({
        updates: bridge({
          fetchUpdate: () => {
            fetches += 1;
            return new Promise((resolve) => {
              releaseFetch = () => resolve({ isNew: true, updateId: "update-a" });
            });
          },
        }),
        downloadTimeoutMs: 1_000,
      }),
    );
    const first = gate.check();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(gate.getSnapshot().phase).toBe("updating");
    expect((await gate.check()).phase).toBe("updating");
    expect(fetches).toBe(1);
    releaseFetch();
    await first;
  });

  it("deduplicates concurrent checks into one in-flight resolution", async () => {
    let checks = 0;
    const gate = new OtaGateCoordinator(
      deps({
        updates: bridge({
          checkForUpdate: async () => {
            checks += 1;
            return check({ isAvailable: false, updateId: null });
          },
        }),
      }),
    );
    const [a, b] = await Promise.all([gate.check(), gate.check()]);
    expect(checks).toBe(1);
    expect(a).toBe(b);
  });

  it("does not interrupt an in-progress install with a foreground check", async () => {
    let reloads = 0;
    let releaseFetch!: () => void;
    const gate = new OtaGateCoordinator(
      deps({
        updates: bridge({
          fetchUpdate: () =>
            new Promise((resolve) => {
              releaseFetch = () => resolve({ isNew: true, updateId: "update-a" });
            }),
          reload: async () => {
            reloads += 1;
          },
        }),
        downloadTimeoutMs: 1_000,
      }),
    );
    const installing = gate.check();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(gate.getSnapshot().phase).toBe("updating");
    expect((await gate.check()).phase).toBe("updating");
    releaseFetch();
    await installing;
    expect(reloads).toBe(1);
  });
});
