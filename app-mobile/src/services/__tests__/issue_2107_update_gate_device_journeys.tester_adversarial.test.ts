// #2107 — TESTER adversarial suite (device-test leg, 2026-10-19). Consumer.
//
// The implementor's suite proves each defect branch in isolation. This suite
// replays the multi-launch JOURNEYS the device run drove, where the bugs that
// matter live between launches and between overlapping checks:
//
//   1. A bad critical update exhausts its 2 restarts and then STAYS quiet for
//      every later launch — and a fixed critical update published afterwards
//      is still offered fresh (the cap is per target, never global).
//   2. A cold-start check and foreground checks that overlap a slow download
//      start exactly ONE install: one download, one record write, one restart.
//   3. A foreground recheck over a mounted app, end to end: the app stays up
//      while the answer is in flight, a confirmed `required` overlays it, and a
//      later `allowed` uncovers the same mounted app.
//   4. A flood of console-only diagnostics before PostHog is ready can never
//      evict a real update-gate outcome from the telemetry buffer.

jest.mock("../supabase", () => ({
  supabaseUrl: "https://example.supabase.co",
}));
jest.mock("../appVersionIdentity", () => ({
  APP_VERSION_APP_ID: "explorer",
  APP_VERSION_SCHEMA: 1,
  getInstalledNativeVersion: () => "1.1.6",
  getNativeAppPlatform: () => "ios",
}));

const mockAnalytics = {
  ready: false,
  captured: [] as string[],
  isReady(): boolean {
    return this.ready;
  },
  capture(event: string): void {
    this.captured.push(event);
  },
};
jest.mock("../postHogService", () => ({ postHogService: mockAnalytics }));

import {
  VersionGateCoordinator,
  resolveGateLayout,
  type AppVersionPolicy,
} from "../appVersionPolicy";
import {
  ABSENT_POLICY_ROW_UPDATED_AT,
  CRITICAL_UPDATE_MAX_ATTEMPTS,
  OtaGateCoordinator,
  type OtaUpdateCheck,
} from "../otaUpdatePolicy";

// ---------------------------------------------------------------------------
// A simulated phone: storage that survives restarts, and a "server" whose
// newest update can change between launches.
// ---------------------------------------------------------------------------
type Phone = {
  storage: Map<string, string>;
  running: { id: string; index: number };
  server: { id: string; index: number } | null;
  /** Whether a restart actually lands on the downloaded update. */
  restartLands: boolean;
  log: string[];
  events: string[];
  downloadMs: number;
};

const RECORD_KEY = "record";

function newPhone(): Phone {
  return {
    storage: new Map(),
    running: { id: "embedded", index: 3 },
    server: null,
    restartLands: true,
    log: [],
    events: [],
    downloadMs: 0,
  };
}

/** One JS process. A "restart" is simply the next call to coldStart. */
function coldStart(phone: Phone): OtaGateCoordinator {
  let downloaded: { id: string; index: number } | null = null;
  const runningAtLaunch = { ...phone.running };
  return new OtaGateCoordinator({
    platform: "ios",
    updates: {
      isEnabled: true,
      runtimeVersion: "1.1.6",
      runningUpdateId: runningAtLaunch.id,
      runningCriticalIndex: runningAtLaunch.index,
      isEmergencyLaunch: false,
      checkForUpdate: async (): Promise<OtaUpdateCheck> => {
        phone.log.push("check");
        const offered = phone.server;
        if (offered === null || offered.id === runningAtLaunch.id) {
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
        await new Promise((resolve) => setTimeout(resolve, phone.downloadMs));
        downloaded = phone.server;
        return { isNew: true, updateId: downloaded?.id ?? null };
      },
      reload: async () => {
        phone.log.push("reload");
        if (phone.restartLands && downloaded !== null) {
          phone.running = { ...downloaded };
        }
      },
    },
    fetchPolicy: async () => ({
      appId: "explorer",
      platform: "ios",
      runtimeVersion: "1.1.6",
      mode: "silent",
      message: "",
      updatedAt: ABSENT_POLICY_ROW_UPDATED_AT,
    }),
    loadAttemptRecord: async () => phone.storage.get(RECORD_KEY) ?? null,
    saveAttemptRecord: async (value) => {
      phone.log.push("save");
      phone.storage.set(RECORD_KEY, value);
    },
    clearAttemptRecord: async () => {
      phone.storage.delete(RECORD_KEY);
    },
    report: (event) => phone.events.push(event),
    policyTimeoutMs: 50,
    checkTimeoutMs: 50,
    downloadTimeoutMs: 500,
    recordTimeoutMs: 50,
    reloadGraceMs: 5,
  });
}

const count = (list: string[], item: string): number =>
  list.filter((entry) => entry === item).length;

describe("#2107 tester — critical-update journeys across many launches", () => {
  it("a bad update stays capped for every later launch, and a later fix is still offered fresh", async () => {
    const phone = newPhone();
    phone.server = { id: "bad-update", index: 4 };
    phone.restartLands = false; // every restart comes back on the old code

    // Six cold starts. Only the first two may restart; the rest must be quiet.
    for (let launch = 0; launch < 6; launch += 1) {
      const gate = coldStart(phone);
      const settled = await gate.check();
      expect(settled.phase).toBe("open");
    }
    expect(count(phone.log, "reload")).toBe(CRITICAL_UPDATE_MAX_ATTEMPTS);
    expect(count(phone.log, "fetch")).toBe(CRITICAL_UPDATE_MAX_ATTEMPTS);
    expect(count(phone.events, "critical_update_attempts_exhausted")).toBe(4);
    expect(JSON.parse(phone.storage.get(RECORD_KEY) ?? "null")).toEqual({
      targetUpdateId: "bad-update",
      attempts: CRITICAL_UPDATE_MAX_ATTEMPTS,
    });

    // The team publishes a fixed critical update. The exhausted cap for the
    // bad one must NOT suppress it: it is attempt 1 of a new target.
    phone.server = { id: "fixed-update", index: 5 };
    phone.restartLands = true;
    const offeredFix = coldStart(phone);
    const phases: string[] = [];
    offeredFix.subscribe((snapshot) => phases.push(snapshot.phase));
    await offeredFix.check();
    expect(phases[0]).toBe("updating");
    expect(count(phone.log, "reload")).toBe(CRITICAL_UPDATE_MAX_ATTEMPTS + 1);
    expect(JSON.parse(phone.storage.get(RECORD_KEY) ?? "null")).toEqual({
      targetUpdateId: "fixed-update",
      attempts: 1,
    });

    // The restart landed: verified once, record gone, nothing more to do.
    const landed = coldStart(phone);
    await landed.check();
    expect(phone.running.id).toBe("fixed-update");
    expect(count(phone.events, "critical_update_applied_verified")).toBe(1);
    expect(phone.storage.has(RECORD_KEY)).toBe(false);
    expect(count(phone.log, "reload")).toBe(CRITICAL_UPDATE_MAX_ATTEMPTS + 1);
  });

  it("overlapping cold-start and foreground checks during a slow download start exactly one install", async () => {
    const phone = newPhone();
    phone.server = { id: "critical", index: 4 };
    phone.downloadMs = 60;
    const gate = coldStart(phone);

    const cold = gate.check();
    // The person backgrounds and foregrounds twice while it is downloading.
    const foregroundA = gate.check();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const foregroundB = gate.check();
    await Promise.all([cold, foregroundA, foregroundB]);

    expect(count(phone.log, "check")).toBe(1);
    expect(count(phone.log, "fetch")).toBe(1);
    expect(count(phone.log, "save")).toBe(1);
    expect(count(phone.log, "reload")).toBe(1);
    expect(JSON.parse(phone.storage.get(RECORD_KEY) ?? "null")).toEqual({
      targetUpdateId: "critical",
      attempts: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// A2 — a foreground recheck over a mounted app, end to end.
// ---------------------------------------------------------------------------
const policy = (minimumVersion: string): AppVersionPolicy => ({
  appId: "explorer",
  platform: "ios",
  minimumVersion,
  storeUrl: "https://apps.apple.com/app/id6760440898",
  message: "Update Mingla to keep using the app.",
  enforcementMode: "enforce",
  updatedAt: "2026-10-19T19:00:00.000Z",
});

describe("#2107 tester — the mounted app survives a required-then-allowed recheck", () => {
  it("never shows the veil after mount; required overlays; allowed uncovers the same tree", async () => {
    let answer: AppVersionPolicy = policy("1.0.0");
    let answerDelayMs = 0;
    const gate = new VersionGateCoordinator({
      platform: "ios",
      installedVersion: "1.1.6",
      loadCache: async () => null,
      saveCache: async () => undefined,
      fetchPolicy: async () => {
        await new Promise((resolve) => setTimeout(resolve, answerDelayMs));
        return answer;
      },
      report: () => undefined,
      timeoutMs: 200,
      cachedTimeoutMs: 200,
      cacheTimeoutMs: 50,
    });

    // Mirror MandatoryUpdateGate: the app counts as mounted from the first
    // `allowed`, and every published phase is mapped to what is on screen.
    let appMounted = false;
    const screens: string[] = [];
    gate.subscribe((snapshot) => {
      if (snapshot.phase === "allowed") appMounted = true;
      screens.push(resolveGateLayout(snapshot.phase, appMounted));
    });

    await gate.check(true);
    expect(screens[screens.length - 1]).toBe("app");
    const afterCold = screens.length;

    // Foreground after 15+ minutes: the floor has been raised; the answer is slow.
    answer = policy("9.9.9");
    answerDelayMs = 40;
    const recheck = gate.check(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screens.length).toBe(afterCold); // nothing published while in flight
    await recheck;
    expect(screens[screens.length - 1]).toBe("app_with_store_overlay");

    // The floor is lowered again (bad config rolled back): the next recheck
    // uncovers the app that was mounted underneath the whole time.
    answer = policy("1.0.0");
    await gate.check(false);
    expect(screens[screens.length - 1]).toBe("app");

    const afterMount = screens.slice(screens.indexOf("app"));
    expect(afterMount).not.toContain("veil");
    expect(afterMount).not.toContain("store_screen");
  });
});

// ---------------------------------------------------------------------------
// D — diagnostics cannot evict real outcomes.
// ---------------------------------------------------------------------------
describe("#2107 tester — telemetry buffer under a diagnostics flood", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAnalytics.ready = false;
    mockAnalytics.captured = [];
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("keeps the real outcome when 500 console-only diagnostics arrive before PostHog is ready", () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { reportUpdateGateEvent } = require("../updateGateTelemetry") as typeof import("../updateGateTelemetry");
      reportUpdateGateEvent("app-version-policy", "version_gate_late_required", {
        minimum_version: "9.9.9",
      });
      for (let index = 0; index < 500; index += 1) {
        reportUpdateGateEvent("app-version-policy", "invalid_policy_response");
        reportUpdateGateEvent("ota-update-gate", "nothing_to_adopt");
      }
      reportUpdateGateEvent("ota-update-gate", "critical_update_applied_verified");

      mockAnalytics.ready = true;
      jest.advanceTimersByTime(3_000);
    });
    expect(mockAnalytics.captured).toEqual([
      "version_gate_late_required",
      "critical_update_applied_verified",
    ]);
  });
});
