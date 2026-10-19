// #2107 (device-test rework, 2026-10-19) — Consumer. Findings F1 and F2 from
// the "DEVICE TEST — PR #3985" comment on #2107.
//
// Invariants declared here (machine-readable; enforced by this suite):
//   I-2107-UNREACHABLE-FAIL-OPEN-CAPTURED  a store-floor check that throws and lets the person in reports a captured `version_gate_unreachable`
//   I-2107-RELAUNCH-FAILURE-ONCE           `critical_update_attempt_failed {stage:"relaunch"}` fires only on the launch right after a restart this gate triggered

jest.mock("../supabase", () => ({
  supabaseUrl: "https://example.supabase.co",
}));
jest.mock("../appVersionIdentity", () => ({
  APP_VERSION_APP_ID: "explorer",
  APP_VERSION_SCHEMA: 1,
  getInstalledNativeVersion: () => "1.1.5",
  getNativeAppPlatform: () => "ios",
}));

import {
  VersionGateCoordinator,
  type AppVersionPolicy,
  type VersionPolicyCoordinatorDependencies,
} from "../appVersionPolicy";
import {
  ABSENT_POLICY_ROW_UPDATED_AT,
  CRITICAL_UPDATE_MAX_ATTEMPTS,
  OtaGateCoordinator,
  type OtaGateDependencies,
} from "../otaUpdatePolicy";
import { isCapturedUpdateGateEvent } from "../updateGateTelemetry";

const APP_ID = "explorer" as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const storePolicy = (overrides: Partial<AppVersionPolicy> = {}): AppVersionPolicy => ({
  appId: APP_ID,
  platform: "ios",
  minimumVersion: "1.1.6",
  storeUrl: "https://apps.apple.com/app/id6760440898",
  message: "Update to keep using the app.",
  enforcementMode: "enforce",
  updatedAt: "2026-10-19T19:00:00.000Z",
  ...overrides,
});

type Report = { outcome: string; detail?: Record<string, unknown> };

function versionGate(overrides: Partial<VersionPolicyCoordinatorDependencies> = {}): {
  gate: VersionGateCoordinator;
  reports: Report[];
} {
  const reports: Report[] = [];
  const gate = new VersionGateCoordinator({
    platform: "ios",
    installedVersion: "1.1.5",
    loadCache: async () => null,
    saveCache: async () => undefined,
    fetchPolicy: async () => {
      throw new Error("Network request failed");
    },
    report: (outcome, detail) => reports.push({ outcome, detail }),
    timeoutMs: 200,
    cachedTimeoutMs: 200,
    cacheTimeoutMs: 50,
    ...overrides,
  });
  return { gate, reports };
}

const captured = (reports: Report[]): string[] =>
  reports.map((r) => r.outcome).filter(isCapturedUpdateGateEvent);

describe("#2107 F1 — an unreachable store-floor check that lets the person in is captured", () => {
  it("happy: offline first launch with no cache opens the app AND captures version_gate_unreachable", async () => {
    const { gate, reports } = versionGate();
    await expect(gate.check(true)).resolves.toMatchObject({
      phase: "allowed",
      decision: { state: "unknown" },
    });
    expect(captured(reports)).toEqual(["version_gate_unreachable"]);
    const unreachable = reports.find((r) => r.outcome === "version_gate_unreachable");
    expect(unreachable?.detail).toEqual({
      error: "Network request failed",
      had_cached_policy: false,
    });
    // The console diagnostic stays (and is still console-only).
    expect(reports.map((r) => r.outcome)).toContain("Network request failed");
    expect(isCapturedUpdateGateEvent("Network request failed")).toBe(false);
    // Reported BEFORE the allowed outcome is published.
    expect(reports[reports.length - 1].outcome).toBe("version_gate_unreachable");
  });

  it("happy: a non-Error throw still captures the outcome with the fallback message", async () => {
    const { gate, reports } = versionGate({
      fetchPolicy: async () => {
        throw "boom";
      },
    });
    await gate.check(true);
    expect(reports.find((r) => r.outcome === "version_gate_unreachable")?.detail).toMatchObject({
      error: "policy_check_failed",
    });
  });

  it("adversarial: a cached required policy still shows the store screen and is NOT reported as unreachable", async () => {
    const { gate, reports } = versionGate({
      loadCache: async () => JSON.stringify(storePolicy()),
    });
    await expect(gate.check(true)).resolves.toMatchObject({ phase: "required" });
    expect(captured(reports)).toEqual(["version_gate_offline_cached_required"]);
  });

  it("adversarial: a cached allowed policy that cannot be refreshed is captured as unreachable with had_cached_policy", async () => {
    const { gate, reports } = versionGate({
      loadCache: async () => JSON.stringify(storePolicy({ minimumVersion: "1.0.0" })),
    });
    await expect(gate.check(true)).resolves.toMatchObject({ phase: "allowed" });
    expect(reports.find((r) => r.outcome === "version_gate_unreachable")?.detail).toMatchObject({
      had_cached_policy: true,
    });
  });

  it("adversarial: a timeout already reported the fail-open, so a later throw is not double-counted", async () => {
    const { gate, reports } = versionGate({
      timeoutMs: 20,
      fetchPolicy: async () => {
        await sleep(60);
        throw new Error("Network request failed");
      },
    });
    await expect(gate.check(true)).resolves.toMatchObject({ phase: "allowed" });
    await sleep(90);
    expect(captured(reports)).toEqual(["version_gate_timeout"]);
  });
});

// ---------------------------------------------------------------------------
// F2 — the relaunch failure is reported once, on the launch after the restart.
// ---------------------------------------------------------------------------
const RECORD_KEY = "record";
const MARKER_KEY = "record.relaunchPending";

type Phone = {
  storage: Map<string, string>;
  running: { id: string; index: number };
  server: { id: string; index: number } | null;
  restartLands: boolean;
  reloadThrows: boolean;
  reloadKeepsAlive: boolean;
  markerLoadThrows: boolean;
  log: string[];
  events: Array<{ event: string; detail?: Record<string, unknown> }>;
};

const newPhone = (): Phone => ({
  storage: new Map(),
  running: { id: "old-update", index: 3 },
  server: null,
  restartLands: false,
  reloadThrows: false,
  reloadKeepsAlive: false,
  markerLoadThrows: false,
  log: [],
  events: [],
});

// A real reloadAsync ends this JS process. The harness models that: once a
// reload goes through, everything this "process" does afterwards (the grace
// timer's reload_did_not_restart path) is dropped, exactly as on a device.
function coldStart(phone: Phone, withMarker = true): OtaGateCoordinator {
  let downloaded: { id: string; index: number } | null = null;
  let alive = true;
  const deps: OtaGateDependencies = {
    platform: "ios",
    updates: {
      isEnabled: true,
      runtimeVersion: "1.1.6",
      runningUpdateId: phone.running.id,
      runningCriticalIndex: phone.running.index,
      isEmergencyLaunch: false,
      checkForUpdate: async () => {
        const offered = phone.server;
        if (offered === null) {
          return {
            isAvailable: false,
            isRollBackToEmbedded: false,
            updateId: null,
            criticalIndex: null,
            reason: "noUpdateAvailableOnServer",
          };
        }
        return {
          isAvailable: true,
          isRollBackToEmbedded: false,
          updateId: offered.id,
          criticalIndex: offered.index,
          reason: null,
        };
      },
      fetchUpdate: async () => {
        phone.log.push("fetch");
        downloaded = phone.server;
        return { isNew: true, updateId: downloaded?.id ?? null };
      },
      reload: async () => {
        phone.log.push("reload");
        if (phone.reloadThrows) throw new Error("reload failed");
        if (phone.restartLands && downloaded !== null) phone.running = { ...downloaded };
        if (!phone.reloadKeepsAlive) alive = false;
      },
    },
    fetchPolicy: async () => ({
      appId: APP_ID,
      platform: "ios",
      runtimeVersion: "1.1.6",
      mode: "silent",
      message: "",
      updatedAt: ABSENT_POLICY_ROW_UPDATED_AT,
    }),
    loadAttemptRecord: async () => phone.storage.get(RECORD_KEY) ?? null,
    saveAttemptRecord: async (value) => {
      if (alive) phone.storage.set(RECORD_KEY, value);
    },
    clearAttemptRecord: async () => {
      if (alive) phone.storage.delete(RECORD_KEY);
    },
    report: (event, detail) => {
      if (alive) phone.events.push({ event, detail });
    },
    policyTimeoutMs: 50,
    checkTimeoutMs: 50,
    downloadTimeoutMs: 200,
    recordTimeoutMs: 50,
    reloadGraceMs: 5,
  };
  if (withMarker) {
    deps.relaunchMarker = {
      load: async () => {
        if (phone.markerLoadThrows) throw new Error("storage broke");
        return phone.storage.get(MARKER_KEY) ?? null;
      },
      save: async (targetUpdateId) => {
        if (alive) phone.storage.set(MARKER_KEY, targetUpdateId);
      },
      clear: async () => {
        if (alive) phone.storage.delete(MARKER_KEY);
      },
    };
  }
  return new OtaGateCoordinator(deps);
}

const relaunchFailures = (phone: Phone): number =>
  phone.events.filter(
    (e) => e.event === "critical_update_attempt_failed" && e.detail?.stage === "relaunch",
  ).length;
const count = (phone: Phone, event: string): number =>
  phone.events.filter((e) => e.event === event).length;

describe("#2107 F2 — a failed restart is reported once, not on every later cold start", () => {
  it("happy: six cold starts on a bad update report exactly one relaunch failure per restart; the fix is still offered fresh", async () => {
    const phone = newPhone();
    phone.server = { id: "bad-update", index: 4 };
    for (let launch = 0; launch < 6; launch += 1) {
      await expect(coldStart(phone).check()).resolves.toMatchObject({ phase: "open" });
    }
    expect(phone.log.filter((s) => s === "reload")).toHaveLength(CRITICAL_UPDATE_MAX_ATTEMPTS);
    // One per restart the gate triggered (launches 2 and 3), never on 4, 5, 6.
    expect(relaunchFailures(phone)).toBe(CRITICAL_UPDATE_MAX_ATTEMPTS);
    expect(count(phone, "critical_update_attempts_exhausted")).toBe(4);
    // The cap record is untouched by the marker.
    expect(JSON.parse(phone.storage.get(RECORD_KEY) ?? "null")).toEqual({
      targetUpdateId: "bad-update",
      attempts: CRITICAL_UPDATE_MAX_ATTEMPTS,
    });
    expect(phone.storage.has(MARKER_KEY)).toBe(false);

    // Two more plain cold starts after exhaustion with nothing offered: silent.
    phone.server = null;
    await coldStart(phone).check();
    await coldStart(phone).check();
    expect(relaunchFailures(phone)).toBe(CRITICAL_UPDATE_MAX_ATTEMPTS);

    // A fixed update is attempt 1 of a new target and lands.
    phone.server = { id: "fixed-update", index: 5 };
    phone.restartLands = true;
    const phases: string[] = [];
    const offered = coldStart(phone);
    offered.subscribe((s) => phases.push(s.phase));
    await offered.check();
    expect(phases[0]).toBe("updating");
    expect(phone.storage.get(MARKER_KEY)).toBe("fixed-update");
    await coldStart(phone).check();
    expect(count(phone, "critical_update_applied_verified")).toBe(1);
    expect(phone.storage.has(RECORD_KEY)).toBe(false);
    expect(phone.storage.has(MARKER_KEY)).toBe(false);
    expect(relaunchFailures(phone)).toBe(CRITICAL_UPDATE_MAX_ATTEMPTS);
  });

  it("adversarial: an old record written before the marker existed does not crash and is not reported (fail open)", async () => {
    const phone = newPhone();
    phone.storage.set(RECORD_KEY, JSON.stringify({ targetUpdateId: "bad-update", attempts: 2 }));
    phone.server = { id: "bad-update", index: 4 };
    for (let launch = 0; launch < 3; launch += 1) {
      await expect(coldStart(phone).check()).resolves.toMatchObject({ phase: "open" });
    }
    expect(relaunchFailures(phone)).toBe(0);
    expect(phone.log).not.toContain("reload");
    expect(count(phone, "critical_update_attempts_exhausted")).toBe(3);
  });

  it("adversarial: an old under-cap record still gets its remaining attempt, reported once after that restart only", async () => {
    const phone = newPhone();
    phone.storage.set(RECORD_KEY, JSON.stringify({ targetUpdateId: "bad-update", attempts: 1 }));
    phone.server = { id: "bad-update", index: 4 };
    await coldStart(phone).check();
    expect(relaunchFailures(phone)).toBe(0);
    await coldStart(phone).check();
    await coldStart(phone).check();
    expect(phone.log.filter((s) => s === "reload")).toHaveLength(1);
    expect(relaunchFailures(phone)).toBe(1);
  });

  it("adversarial: a marker for a different target, or an unreadable marker, is never reported and never blocks", async () => {
    const stale = newPhone();
    stale.storage.set(RECORD_KEY, JSON.stringify({ targetUpdateId: "bad-update", attempts: 2 }));
    stale.storage.set(MARKER_KEY, "some-other-update");
    await expect(coldStart(stale).check()).resolves.toMatchObject({ phase: "open" });
    expect(relaunchFailures(stale)).toBe(0);
    expect(stale.storage.has(MARKER_KEY)).toBe(false);

    const broken = newPhone();
    broken.storage.set(RECORD_KEY, JSON.stringify({ targetUpdateId: "bad-update", attempts: 1 }));
    broken.storage.set(MARKER_KEY, "bad-update");
    broken.markerLoadThrows = true;
    await expect(coldStart(broken).check()).resolves.toMatchObject({ phase: "open" });
    expect(relaunchFailures(broken)).toBe(0);
    expect(broken.events.map((e) => e.event)).toContain("relaunch_marker_io_failed");
    expect(isCapturedUpdateGateEvent("relaunch_marker_io_failed")).toBe(false);
  });

  it("adversarial: a reload that throws is reported in-process and does not also count as a relaunch failure next launch", async () => {
    const phone = newPhone();
    phone.server = { id: "bad-update", index: 4 };
    phone.reloadThrows = true;
    await coldStart(phone).check();
    expect(
      phone.events.filter((e) => e.event === "critical_update_attempt_failed" && e.detail?.stage === "reload"),
    ).toHaveLength(1);
    expect(phone.storage.has(MARKER_KEY)).toBe(false);
    phone.server = null;
    await coldStart(phone).check();
    expect(relaunchFailures(phone)).toBe(0);
  });

  it("adversarial: a reload that never restarts is reported in-process and not again next launch", async () => {
    const phone = newPhone();
    phone.server = { id: "bad-update", index: 4 };
    phone.reloadKeepsAlive = true;
    await coldStart(phone).check();
    expect(
      phone.events.filter(
        (e) => e.event === "critical_update_attempt_failed" && e.detail?.stage === "reload_did_not_restart",
      ),
    ).toHaveLength(1);
    expect(phone.storage.has(MARKER_KEY)).toBe(false);
    phone.server = null;
    await coldStart(phone).check();
    expect(relaunchFailures(phone)).toBe(0);
  });

  it("adversarial: without marker storage wired (legacy harness) behaviour is unchanged", async () => {
    const phone = newPhone();
    phone.server = { id: "bad-update", index: 4 };
    for (let launch = 0; launch < 3; launch += 1) await coldStart(phone, false).check();
    expect(relaunchFailures(phone)).toBe(2);
  });
});
