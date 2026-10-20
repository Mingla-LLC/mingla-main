// #2107 (2026-10-19 airtight build) — Host. One happy-path and at least one
// adversarial proof per defect fixed by this build. Each describe names the
// defect from the "DEEP INVESTIGATION + SPEC (2026-10-19)" comment on #2107.
//
// Invariants declared here (machine-readable; enforced by this suite and by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs):
//   I-2107-LATE-POLICY-ANSWER-APPLIED   a store-floor answer is persisted and applied whenever it lands
//   I-2107-GATE-NEVER-UNMOUNTS-APP      once mounted, the app tree is never replaced by the veil
//   I-2107-OBSERVE-NEVER-BLOCKS         only enforcementMode `enforce` produces `required`
//   I-2107-CRITICAL-ATTEMPTS-PERSISTED  the restart cap survives restarts; a restart is verified by update id
//   I-2107-KILL-SWITCH-DEFAULT-ON       no policy row (or no answer) enforces; only a real `silent` row switches off

jest.mock("../appVersionIdentity", () => ({
  APP_VERSION_APP_ID: "business",
  APP_VERSION_SCHEMA: 1,
  getInstalledNativeVersion: () => "1.1.5",
  getNativeAppPlatform: () => "ios",
}));

import {
  POLICY_CHECK_TIMEOUT_MS,
  VersionGateCoordinator,
  decidePolicy,
  resolveGateLayout,
  type AppVersionPolicy,
  type VersionPolicyCoordinatorDependencies,
} from "../appVersionPolicy";
import {
  ABSENT_POLICY_ROW_UPDATED_AT,
  CRITICAL_UPDATE_MAX_ATTEMPTS,
  OtaGateCoordinator,
  criticalIndexFromExpoConfig,
  criticalIndexFromManifest,
  resolveCriticalEnforcement,
  type AppOtaPolicy,
  type OtaGateDependencies,
  type OtaUpdateBridge,
  type OtaUpdateCheck,
} from "../otaUpdatePolicy";

const APP_ID = "business" as const;

const storePolicy = (overrides: Partial<AppVersionPolicy> = {}): AppVersionPolicy => ({
  appId: APP_ID,
  platform: "ios",
  minimumVersion: "1.1.6",
  storeUrl: "https://apps.apple.com/app/id6768737367",
  message: "Update Mingla to keep using the app.",
  enforcementMode: "enforce",
  updatedAt: "2026-08-23T15:14:04.347Z",
  ...overrides,
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function versionGate(
  overrides: Partial<VersionPolicyCoordinatorDependencies> = {},
): {
  gate: VersionGateCoordinator;
  reports: string[];
  saved: string[];
  phases: string[];
} {
  const reports: string[] = [];
  const saved: string[] = [];
  const phases: string[] = [];
  const gate = new VersionGateCoordinator({
    platform: "ios",
    installedVersion: "1.1.5",
    loadCache: async () => null,
    saveCache: async (value) => {
      saved.push(value);
    },
    fetchPolicy: async () => storePolicy(),
    report: (outcome) => reports.push(outcome),
    timeoutMs: 40,
    cachedTimeoutMs: 40,
    cacheTimeoutMs: 40,
    ...overrides,
  });
  gate.subscribe((snapshot) => phases.push(snapshot.phase));
  return { gate, reports, saved, phases };
}

// ---------------------------------------------------------------------------
// Defect 1 / A1 — a slow network was never blocked and never cached "required".
// ---------------------------------------------------------------------------
describe("#2107 A1 — late store-floor answers are kept", () => {
  it("happy: first launch with no cache waits up to ~4 s, and a slow-but-in-budget answer blocks", async () => {
    expect(POLICY_CHECK_TIMEOUT_MS).toBe(4_000);
    const answer = deferred<AppVersionPolicy>();
    const { gate, saved } = versionGate({
      fetchPolicy: () => answer.promise,
      timeoutMs: 200,
      cachedTimeoutMs: 5,
    });
    const result = gate.check(true);
    await sleep(30); // past the CACHED budget, inside the no-cache budget
    expect(gate.getSnapshot().phase).toBe("checking");
    answer.resolve(storePolicy());
    await expect(result).resolves.toMatchObject({ phase: "required" });
    await sleep(0);
    expect(saved).toHaveLength(1);
  });

  it("adversarial: an answer that lands AFTER the timeout is saved and flips the gate to the store screen", async () => {
    const answer = deferred<AppVersionPolicy>();
    const { gate, saved, reports } = versionGate({
      fetchPolicy: () => answer.promise,
      timeoutMs: 5,
    });
    await expect(gate.check(true)).resolves.toMatchObject({ phase: "allowed" });
    expect(reports).toContain("version_gate_timeout");
    answer.resolve(storePolicy());
    await sleep(0);
    await sleep(0);
    expect(gate.getSnapshot()).toMatchObject({
      phase: "required",
      decision: { state: "required", minimumVersion: "1.1.6" },
    });
    expect(reports).toContain("version_gate_late_required");
    expect(saved.map((value) => JSON.parse(value) as AppVersionPolicy)).toEqual([
      storePolicy(),
    ]);
  });

  it("adversarial: the saved late answer blocks the NEXT launch even when that launch is offline", async () => {
    let cache: string | null = null;
    const answer = deferred<AppVersionPolicy>();
    const first = versionGate({
      fetchPolicy: () => answer.promise,
      saveCache: async (value) => {
        cache = value;
      },
      timeoutMs: 5,
    });
    await first.gate.check(true);
    answer.resolve(storePolicy());
    await sleep(5);

    const second = versionGate({
      loadCache: async () => cache,
      fetchPolicy: async () => {
        throw new Error("offline");
      },
    });
    await expect(second.gate.check(true)).resolves.toMatchObject({ phase: "required" });
    expect(second.reports).toContain("version_gate_offline_cached_required");
  });

  it("adversarial: a stale late answer cannot override a fresher one that already landed", async () => {
    const slow = deferred<AppVersionPolicy>();
    let call = 0;
    const { gate } = versionGate({
      fetchPolicy: () => {
        call += 1;
        return call === 1
          ? slow.promise
          : Promise.resolve(storePolicy({ minimumVersion: "1.1.5" }));
      },
      timeoutMs: 5,
    });
    await gate.check(true); // times out, still waiting on `slow`
    await expect(gate.check(false)).resolves.toMatchObject({ phase: "allowed" });
    slow.resolve(storePolicy()); // the OLD floor arrives last
    await sleep(0);
    await sleep(0);
    expect(gate.getSnapshot().phase).toBe("allowed");
  });

  it("adversarial: a storage read that never settles cannot hold the veil forever", async () => {
    const { gate } = versionGate({
      loadCache: () => new Promise<string | null>(() => undefined),
      fetchPolicy: () => new Promise<AppVersionPolicy>(() => undefined),
      cacheTimeoutMs: 5,
      timeoutMs: 5,
    });
    await expect(gate.check(true)).resolves.toMatchObject({ phase: "allowed" });
  });
});

// ---------------------------------------------------------------------------
// Defect 5 / A2 — returning after 15+ minutes rebuilt the whole app.
// ---------------------------------------------------------------------------
describe("#2107 A2 — foreground rechecks never unmount the app", () => {
  it("happy: the cold launch may veil; after that every non-required phase keeps the app", () => {
    expect(resolveGateLayout("checking", false)).toBe("veil");
    expect(resolveGateLayout("allowed", false)).toBe("app");
    expect(resolveGateLayout("checking", true)).toBe("app");
    expect(resolveGateLayout("allowed", true)).toBe("app");
  });

  it("adversarial: a confirmed required covers a mounted app as an overlay, never by replacing it", () => {
    expect(resolveGateLayout("required", true)).toBe("app_with_store_overlay");
    // ...but a cold launch that is already below the floor never boots the app.
    expect(resolveGateLayout("required", false)).toBe("store_screen");
  });

  it("adversarial: a foreground (non-blocking) recheck never publishes `checking`", async () => {
    const answer = deferred<AppVersionPolicy>();
    let call = 0;
    const { gate, phases } = versionGate({
      fetchPolicy: () => {
        call += 1;
        return call === 1
          ? Promise.resolve(storePolicy({ minimumVersion: "1.1.5" }))
          : answer.promise;
      },
      timeoutMs: 200,
      cachedTimeoutMs: 200,
    });
    await gate.check(true);
    phases.length = 0;
    const foreground = gate.check(false);
    await sleep(5);
    expect(phases).not.toContain("checking");
    answer.resolve(storePolicy());
    await expect(foreground).resolves.toMatchObject({ phase: "required" });
    expect(phases).toEqual(["required"]);
  });
});

// ---------------------------------------------------------------------------
// Defect 6 / A3 — `observe` mode blocked real users.
// ---------------------------------------------------------------------------
describe("#2107 A3 — observe reports, only enforce blocks", () => {
  it("happy: enforce below the floor is required, at or above is allowed", () => {
    expect(decidePolicy(storePolicy(), "1.1.5")).toMatchObject({
      state: "required",
      message: "Update Mingla to keep using the app.",
    });
    expect(decidePolicy(storePolicy(), "1.1.6")).toEqual({ state: "allowed" });
  });

  it("adversarial: observe below the floor reports would-block and lets the person in", async () => {
    expect(decidePolicy(storePolicy({ enforcementMode: "observe" }), "1.1.5")).toEqual({
      state: "observe_would_block",
      minimumVersion: "1.1.6",
    });
    const { gate, reports } = versionGate({
      fetchPolicy: async () => storePolicy({ enforcementMode: "observe" }),
    });
    await expect(gate.check(true)).resolves.toMatchObject({ phase: "allowed" });
    expect(reports).toContain("version_gate_observe_would_block");
    expect(reports).not.toContain("version_gate_required");
  });

  it("adversarial: a cached observe policy cannot block an offline launch", async () => {
    const { gate } = versionGate({
      loadCache: async () => JSON.stringify(storePolicy({ enforcementMode: "observe" })),
      fetchPolicy: async () => {
        throw new Error("offline");
      },
    });
    await expect(gate.check(true)).resolves.toMatchObject({ phase: "allowed" });
  });
});

// ---------------------------------------------------------------------------
// Defects 4 + 7 / B2 — critical updates: verified restart, persisted cap.
// ---------------------------------------------------------------------------
type Device = {
  record: string | null;
  events: Array<{ event: string; detail?: Record<string, unknown> }>;
  order: string[];
};

const offer = (overrides: Partial<OtaUpdateCheck> = {}): OtaUpdateCheck => ({
  isAvailable: true,
  isRollBackToEmbedded: false,
  updateId: "update-critical",
  criticalIndex: 7,
  reason: null,
  ...overrides,
});

const otaPolicy = (overrides: Partial<AppOtaPolicy> = {}): AppOtaPolicy => ({
  appId: APP_ID,
  platform: "ios",
  runtimeVersion: "1.1.6",
  mode: "silent",
  message: "",
  updatedAt: ABSENT_POLICY_ROW_UPDATED_AT,
  ...overrides,
});

function launch(
  device: Device,
  bridgeOverrides: Partial<OtaUpdateBridge> = {},
  depOverrides: Partial<OtaGateDependencies> = {},
): OtaGateCoordinator {
  const updates: OtaUpdateBridge = {
    isEnabled: true,
    runtimeVersion: "1.1.6",
    runningUpdateId: "update-old",
    runningCriticalIndex: 6,
    isEmergencyLaunch: false,
    checkForUpdate: async () => {
      device.order.push("check");
      return offer();
    },
    fetchUpdate: async () => {
      device.order.push("fetch");
      return { isNew: true, updateId: "update-critical" };
    },
    reload: async () => {
      device.order.push("reload");
    },
    ...bridgeOverrides,
  };
  return new OtaGateCoordinator({
    platform: "ios",
    updates,
    fetchPolicy: async () => otaPolicy(),
    loadAttemptRecord: async () => device.record,
    saveAttemptRecord: async (value) => {
      device.order.push("save");
      device.record = value;
    },
    clearAttemptRecord: async () => {
      device.order.push("clear");
      device.record = null;
    },
    report: (event, detail) => device.events.push({ event, detail }),
    policyTimeoutMs: 30,
    checkTimeoutMs: 30,
    downloadTimeoutMs: 30,
    recordTimeoutMs: 30,
    reloadGraceMs: 5,
    ...depOverrides,
  });
}

const newDevice = (): Device => ({ record: null, events: [], order: [] });
const eventNames = (device: Device): string[] => device.events.map((e) => e.event);

describe("#2107 B2 — critical updates install, verify and never loop", () => {
  it("happy: higher offered index → updating → download → record persisted BEFORE reload", async () => {
    const device = newDevice();
    const gate = launch(device);
    const phases: string[] = [];
    gate.subscribe((snapshot) => phases.push(snapshot.phase));
    await gate.check();
    expect(phases[0]).toBe("updating");
    expect(device.order).toEqual(["check", "fetch", "save", "reload"]);
    expect(JSON.parse(device.record ?? "null")).toEqual({
      targetUpdateId: "update-critical",
      attempts: 1,
    });
    expect(eventNames(device)).toContain("critical_update_offered");
  });

  it("happy: after the restart lands the target update, the record is cleared and the apply is verified", async () => {
    const device = newDevice();
    await launch(device).check();
    const relaunched = launch(device, {
      runningUpdateId: "update-critical",
      runningCriticalIndex: 7,
      checkForUpdate: async () => offer({ isAvailable: false, updateId: null, criticalIndex: null }),
    });
    await relaunched.check();
    expect(eventNames(device)).toContain("critical_update_applied_verified");
    expect(device.record).toBeNull();
  });

  it("adversarial: the restart cap survives restarts — two failed restarts, then the person is let in", async () => {
    const device = newDevice();
    // Launch 1: restart #1 is attempted.
    await launch(device).check();
    // Launch 2: the restart did NOT land (still running update-old). Restart #2.
    await launch(device).check();
    // Launch 3: still not landed. The persisted count says stop.
    const third = launch(device);
    await third.check();

    expect(device.order.filter((step) => step === "reload")).toHaveLength(
      CRITICAL_UPDATE_MAX_ATTEMPTS,
    );
    expect(third.getSnapshot().phase).toBe("open");
    expect(eventNames(device)).toContain("critical_update_attempts_exhausted");
    expect(
      device.events.filter(
        (e) => e.event === "critical_update_attempt_failed" && e.detail?.stage === "relaunch",
      ),
    ).toHaveLength(2);
  });

  it("adversarial: a relaunch on a DIFFERENT update id is not reported as applied", async () => {
    const device = newDevice();
    await launch(device).check();
    await launch(device, {
      runningUpdateId: "update-something-else",
      checkForUpdate: async () => offer({ isAvailable: false, updateId: null }),
    }).check();
    expect(eventNames(device)).not.toContain("critical_update_applied_verified");
    expect(JSON.parse(device.record ?? "null")).toMatchObject({ attempts: 1 });
  });

  it("adversarial: a failed download consumes no attempt and is offered again next time", async () => {
    const device = newDevice();
    const gate = launch(device, {
      fetchUpdate: async () => {
        device.order.push("fetch");
        throw new Error("network died");
      },
    });
    await expect(gate.check()).resolves.toMatchObject({ phase: "open" });
    expect(device.record).toBeNull();
    expect(device.order).not.toContain("reload");

    const foreground = launch(device);
    await foreground.check();
    expect(device.order.filter((step) => step === "reload")).toHaveLength(1);
    expect(JSON.parse(device.record ?? "null")).toMatchObject({ attempts: 1 });
  });

  it("adversarial: emergency launch, previously-failed update, offline and timeouts all let the person in", async () => {
    const cases: Array<[string, Partial<OtaUpdateBridge>, string]> = [
      ["emergency launch", { isEmergencyLaunch: true }, "critical_update_emergency_launch"],
      [
        "update previously failed",
        {
          checkForUpdate: async () =>
            offer({ isAvailable: false, updateId: null, reason: "updatePreviouslyFailed" }),
        },
        "critical_update_previously_failed",
      ],
      [
        "offline",
        {
          checkForUpdate: async () => {
            throw new Error("offline");
          },
        },
        "critical_update_skipped_offline",
      ],
      [
        "check timeout",
        { checkForUpdate: () => new Promise<OtaUpdateCheck>(() => undefined) },
        "critical_update_skipped_offline",
      ],
    ];
    for (const [label, overrides, expected] of cases) {
      const device = newDevice();
      const gate = launch(device, overrides);
      await expect(gate.check()).resolves.toMatchObject({ phase: "open" });
      expect({ label, events: eventNames(device) }).toEqual({
        label,
        events: expect.arrayContaining([expected]),
      });
      expect(device.order).not.toContain("reload");
    }
  });

  it("adversarial: a reload that returns without restarting lets the person in", async () => {
    const device = newDevice();
    const gate = launch(device);
    await expect(gate.check()).resolves.toMatchObject({ phase: "open" });
    expect(
      device.events.some(
        (e) => e.event === "critical_update_attempt_failed" && e.detail?.stage === "reload_did_not_restart",
      ),
    ).toBe(true);
  });

  it("reads the running and offered index from the manifest shapes expo-updates serves", () => {
    expect(criticalIndexFromManifest({ extra: { expoClient: { extra: { criticalIndex: 3 } } } })).toBe(3);
    expect(criticalIndexFromManifest({ extra: { expoClient: { extra: {} } } })).toBeNull();
    expect(criticalIndexFromManifest({ extra: { expoClient: { extra: { criticalIndex: "3" } } } })).toBeNull();
    expect(criticalIndexFromManifest({ extra: { expoClient: { extra: { criticalIndex: -1 } } } })).toBeNull();
    expect(criticalIndexFromManifest({ extra: { expoClient: { extra: { criticalIndex: 1.5 } } } })).toBeNull();
    expect(criticalIndexFromManifest(undefined)).toBeNull();
    expect(criticalIndexFromExpoConfig({ extra: { criticalIndex: 0 } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Defect 3 / B4 — enforcement lapsed on every native release (1.1.6 had no row).
// ---------------------------------------------------------------------------
describe("#2107 B4 — the policy is an off switch that is ON by default", () => {
  it("happy: a brand-new runtime with NO policy row enforces critical updates", async () => {
    expect(resolveCriticalEnforcement(otaPolicy())).toEqual({ enforce: true, source: "no_row" });
    const device = newDevice();
    await launch(device).check();
    expect(device.order).toContain("reload");
  });

  it("happy: acknowledge and force_restart rows both enforce", () => {
    for (const mode of ["acknowledge", "force_restart"] as const) {
      expect(
        resolveCriticalEnforcement(otaPolicy({ mode, updatedAt: "2026-10-19T12:00:00.000Z" })).enforce,
      ).toBe(true);
    }
  });

  it("adversarial: an unreachable or malformed policy endpoint still enforces (the counter decides)", async () => {
    expect(resolveCriticalEnforcement(null)).toEqual({ enforce: true, source: "policy_unreachable" });
    for (const fetchPolicy of [
      async (): Promise<AppOtaPolicy> => {
        throw new Error("invalid_ota_policy_response");
      },
      (): Promise<AppOtaPolicy> => new Promise<AppOtaPolicy>(() => undefined),
    ]) {
      const device = newDevice();
      await launch(device, {}, { fetchPolicy }).check();
      expect(device.order).toContain("reload");
    }
  });

  it("adversarial: ONLY a real silent row switches enforcement off", async () => {
    const device = newDevice();
    const gate = launch(device, {}, {
      fetchPolicy: async () => otaPolicy({ updatedAt: "2026-10-19T12:00:00.000Z" }),
    });
    await expect(gate.check()).resolves.toMatchObject({ phase: "open" });
    expect(device.order).not.toContain("fetch");
    expect(eventNames(device)).toContain("critical_update_switched_off");
  });
});
