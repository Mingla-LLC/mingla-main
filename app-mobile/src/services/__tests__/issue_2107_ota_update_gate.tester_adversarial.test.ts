// #2107 tester adversarial proof — Consumer.
//
// Assumes the gate is BROKEN until proven otherwise. Every case here is a way
// this layer could lock a user out of the app with no OTA path back in, which
// is the one failure mode that cannot be fixed after the fact.
//
// The single invariant under attack: BLOCKING IS ONLY EVER THE RESULT OF A
// SUCCESSFULLY PARSED, EXPLICITLY BLOCKING POLICY. Everything else is open.

import {
  OtaGateCoordinator,
  parseOtaPolicy,
  type AppOtaPolicy,
  type OtaGateDependencies,
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
  ...overrides,
});

function deps(overrides: Partial<OtaGateDependencies> = {}): OtaGateDependencies {
  return {
    platform: "ios",
    updates: {
      isEnabled: true,
      runtimeVersion: "1.1.4",
      checkForUpdate: async () => check(),
      fetchUpdate: async () => undefined,
      reload: async () => undefined,
    },
    fetchPolicy: async () => policy(),
    loadAcknowledgement: async () => null,
    saveAcknowledgement: async () => undefined,
    report: () => undefined,
    timeoutMs: 30,
    ...overrides,
  };
}

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("#2107 adversarial — nothing but an explicit policy may block", () => {
  it.each([
    [
      "the policy endpoint throws",
      deps({
        fetchPolicy: async () => {
          throw new Error("offline");
        },
      }),
    ],
    ["the policy endpoint hangs past the timeout", deps({ fetchPolicy: never })],
    [
      "the update check throws",
      deps({
        updates: {
          isEnabled: true,
          runtimeVersion: "1.1.4",
          checkForUpdate: async () => {
            throw new Error("updates unreachable");
          },
          fetchUpdate: async () => undefined,
          reload: async () => undefined,
        },
      }),
    ],
    [
      "the update check hangs past the timeout",
      deps({
        updates: {
          isEnabled: true,
          runtimeVersion: "1.1.4",
          checkForUpdate: never,
          fetchUpdate: async () => undefined,
          reload: async () => undefined,
        },
      }),
    ],
    [
      "no update is actually available",
      deps({
        updates: {
          isEnabled: true,
          runtimeVersion: "1.1.4",
          checkForUpdate: async () => check({ isAvailable: false, updateId: null }),
          fetchUpdate: async () => undefined,
          reload: async () => undefined,
        },
      }),
    ],
    [
      "the available update is a roll-back to embedded",
      deps({
        updates: {
          isEnabled: true,
          runtimeVersion: "1.1.4",
          checkForUpdate: async () =>
            check({ isAvailable: false, isRollBackToEmbedded: true, updateId: null }),
          fetchUpdate: async () => undefined,
          reload: async () => undefined,
        },
      }),
    ],
    [
      "updates are disabled in this build",
      deps({
        updates: {
          isEnabled: false,
          runtimeVersion: null,
          checkForUpdate: async () => check(),
          fetchUpdate: async () => undefined,
          reload: async () => undefined,
        },
      }),
    ],
    [
      "the runtime version is unreadable",
      deps({
        updates: {
          isEnabled: true,
          runtimeVersion: "not-a-version",
          checkForUpdate: async () => check(),
          fetchUpdate: async () => undefined,
          reload: async () => undefined,
        },
      }),
    ],
    ["the platform is web", deps({ platform: null })],
  ])("stays open when %s", async (_label, dependencies) => {
    const gate = new OtaGateCoordinator(dependencies);
    expect((await gate.check()).phase).toBe("open");
  });

  it("never reads a policy at all when the updates bridge is disabled", async () => {
    let policyReads = 0;
    const gate = new OtaGateCoordinator(
      deps({
        updates: {
          isEnabled: false,
          runtimeVersion: null,
          checkForUpdate: async () => check(),
          fetchUpdate: async () => undefined,
          reload: async () => undefined,
        },
        fetchPolicy: async () => {
          policyReads += 1;
          return policy();
        },
      }),
    );
    await gate.check();
    expect(policyReads).toBe(0);
  });

  it("re-prompts rather than silently un-enforcing when the acknowledgement store is unreadable", async () => {
    // DELIBERATE ASYMMETRY. The acknowledgement record is a de-duplication
    // convenience, not the blocking authority — the POLICY is. Failing open here
    // would let a slow AsyncStorage disable enforcement entirely and look
    // healthy doing it. Re-prompting costs one extra tap and cannot lock anyone
    // out, so it is the safe direction for this specific failure.
    const gate = new OtaGateCoordinator(deps({ loadAcknowledgement: never }));
    expect((await gate.check()).phase).toBe("acknowledge");
    await gate.acknowledge();
    await settle();
    expect(gate.getSnapshot().phase).toBe("open");
  });

  it("refuses a mode string it cannot name, even a plausible one", () => {
    for (const mode of ["required", "blocking", "ACKNOWLEDGE", "", null, 1]) {
      expect(parseOtaPolicy({ ...policy(), mode }, "ios", "1.1.4")).toBeNull();
    }
  });

  it("does not replay a stale blocking decision after a failed refresh", async () => {
    // A cached native block still has a working store exit; a cached JS block
    // does not. So unlike #2075's coordinator, this one must DOWNGRADE.
    let call = 0;
    const gate = new OtaGateCoordinator(
      deps({
        fetchPolicy: async () => {
          call += 1;
          if (call === 1) return policy();
          throw new Error("offline");
        },
      }),
    );
    expect((await gate.check()).phase).toBe("acknowledge");
    await gate.acknowledge();
    await settle();
    expect((await gate.check()).phase).toBe("open");
  });
});

describe("#2107 adversarial — the tap always releases the app", () => {
  it("releases even when the background fetch fails outright", async () => {
    const gate = new OtaGateCoordinator(
      deps({
        updates: {
          isEnabled: true,
          runtimeVersion: "1.1.4",
          checkForUpdate: async () => check(),
          fetchUpdate: async () => {
            throw new Error("network died mid-download");
          },
          reload: async () => undefined,
        },
      }),
    );
    await gate.check();
    await gate.acknowledge();
    await settle();
    expect(gate.getSnapshot().phase).toBe("open");
  });

  it("releases even when the device cannot persist the acknowledgement", async () => {
    const gate = new OtaGateCoordinator(
      deps({
        saveAcknowledgement: async () => {
          throw new Error("storage full");
        },
      }),
    );
    await gate.check();
    await gate.acknowledge();
    await settle();
    expect(gate.getSnapshot().phase).toBe("open");
  });

  it("collapses a double tap into a single download", async () => {
    let fetches = 0;
    const gate = new OtaGateCoordinator(
      deps({
        updates: {
          isEnabled: true,
          runtimeVersion: "1.1.4",
          checkForUpdate: async () => check(),
          fetchUpdate: async () => {
            fetches += 1;
          },
          reload: async () => undefined,
        },
      }),
    );
    await gate.check();
    await Promise.all([gate.acknowledge(), gate.acknowledge()]);
    await settle();
    expect(fetches).toBe(1);
    expect(gate.getSnapshot().phase).toBe("open");
  });

  it("ignores a tap that arrives when nothing is blocking", async () => {
    let fetches = 0;
    const gate = new OtaGateCoordinator(
      deps({
        fetchPolicy: async () => policy({ mode: "silent" }),
        updates: {
          isEnabled: true,
          runtimeVersion: "1.1.4",
          checkForUpdate: async () => check(),
          fetchUpdate: async () => {
            fetches += 1;
          },
          reload: async () => undefined,
        },
      }),
    );
    await gate.check();
    await gate.acknowledge();
    expect(fetches).toBe(0);
    expect(gate.getSnapshot().phase).toBe("open");
  });
});

describe("#2107 adversarial — resume storms cannot re-block or stack work", () => {
  it("does not re-read policy while the user is already looking at the layer", async () => {
    let policyReads = 0;
    const gate = new OtaGateCoordinator(
      deps({
        fetchPolicy: async () => {
          policyReads += 1;
          return policy();
        },
      }),
    );
    await gate.check();
    await gate.check();
    await gate.check();
    expect(policyReads).toBe(1);
    expect(gate.getSnapshot().phase).toBe("acknowledge");
  });

  it("deduplicates concurrent checks into one in-flight resolution", async () => {
    let policyReads = 0;
    const gate = new OtaGateCoordinator(
      deps({
        fetchPolicy: async () => {
          policyReads += 1;
          return policy();
        },
      }),
    );
    const [a, b] = await Promise.all([gate.check(), gate.check()]);
    expect(policyReads).toBe(1);
    expect(a).toBe(b);
  });

  it("does not interrupt an in-progress force_restart install", async () => {
    let reloads = 0;
    let releaseFetch!: () => void;
    const gate = new OtaGateCoordinator(
      deps({
        fetchPolicy: async () => policy({ mode: "force_restart" }),
        updates: {
          isEnabled: true,
          runtimeVersion: "1.1.4",
          checkForUpdate: async () => check(),
          fetchUpdate: () =>
            new Promise<void>((resolve) => {
              releaseFetch = resolve;
            }),
          reload: async () => {
            reloads += 1;
          },
        },
      }),
    );
    await gate.check();
    const installing = gate.acknowledge();
    await settle();
    expect(gate.getSnapshot().phase).toBe("installing");
    expect((await gate.check()).phase).toBe("installing");
    releaseFetch();
    await installing;
    expect(reloads).toBe(1);
  });
});
