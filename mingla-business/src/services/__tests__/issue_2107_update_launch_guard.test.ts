// #2107 (U1) — a broken OTA that throws while rendering must not leave a blank
// screen. Inside the launch window of a non-embedded, never-confirmed update,
// in a fresh process, before the first healthy commit, the error is escalated
// ONCE to a fatal so expo-updates marks the launch failed and relaunches the
// previous update. Everything else gets the restart screen.
//
// Invariant I-2107-UPDATE-LAUNCH-ESCALATION is declared once, in the Explorer
// copy of this suite (app-mobile/src/services/__tests__/).
//
// Mechanism and source citations: src/services/updateLaunchGuard.ts header.
// Structural half (both apps mount the boundary, copies identical, web stubs
// import-free): .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs.

import {
  IN_APP_RELOAD_MARKER_MAX_AGE_MS,
  UPDATE_LAUNCH_WINDOW_MS,
  UpdateLaunchGuard,
  parseUpdateLaunchRecord,
  type UpdateLaunchFacts,
  type UpdateLaunchGuardDependencies,
} from "../updateLaunchGuard";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const mockRunSafeReload = jest.fn(async (reload: () => Promise<void>) => reload());
const mockReloadAsync = jest.fn(async (): Promise<void> => undefined);

jest.mock("../safeReloadRuntime", () => ({
  runSafeReload: (reload: () => Promise<void>) => mockRunSafeReload(reload),
}));
jest.mock("expo-updates", () => ({
  isEnabled: true,
  updateId: "update-b",
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  runtimeVersion: "1.1.6",
  manifest: {},
  reloadAsync: () => mockReloadAsync(),
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("../supabase", () => ({ supabaseUrl: "https://example.invalid" }));

const UPDATE: UpdateLaunchFacts = {
  enabled: true,
  updateId: "update-b",
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
};

type Harness = {
  guard: UpdateLaunchGuard;
  stored: { value: string | null };
  writes: string[];
  escalated: unknown[];
  events: Array<{ event: string; properties: Record<string, unknown> }>;
  order: string[];
  clock: { now: number };
  timers: Array<{ callback: () => void; ms: number }>;
};

function harness(
  options: { facts?: UpdateLaunchFacts | null; stored?: string | null; storeThrows?: boolean; writeThrows?: boolean } = {},
): Harness {
  const stored = { value: options.stored ?? null };
  const writes: string[] = [];
  const escalated: unknown[] = [];
  const events: Harness["events"] = [];
  const order: string[] = [];
  const clock = { now: 1_000_000 };
  const timers: Harness["timers"] = [];
  const dependencies: UpdateLaunchGuardDependencies = {
    now: () => clock.now,
    readFacts: () => (options.facts === undefined ? UPDATE : options.facts),
    store: {
      read: () => {
        if (options.storeThrows === true) throw new Error("no file system");
        return stored.value;
      },
      write: (value) => {
        if (options.storeThrows === true || options.writeThrows === true) throw new Error("no file system");
        order.push("write");
        writes.push(value);
        stored.value = value;
      },
    },
    escalate: (error) => {
      order.push("escalate");
      escalated.push(error);
    },
    report: (event, properties) => events.push({ event, properties }),
    setTimer: (callback, ms) => timers.push({ callback, ms }),
  };
  const guard = new UpdateLaunchGuard(dependencies);
  guard.start();
  return { guard, stored, writes, escalated, events, order, clock, timers };
}

describe("#2107 U1 launch guard — core", () => {
  test("happy path: an error inside the window of an unconfirmed update escalates once, persisted first", () => {
    const h = harness();
    const error = new TypeError("boom at launch");
    expect(h.guard.handleError(error, "root_boundary")).toEqual({ kind: "escalated" });
    expect(h.escalated).toEqual([error]);
    // The id is on disk BEFORE the fatal is raised.
    expect(h.order).toEqual(["write", "escalate"]);
    expect(parseUpdateLaunchRecord(h.stored.value)?.escalated).toEqual(["update-b"]);
    expect(h.events).toEqual([
      {
        event: "critical_update_launch_failed_escalated",
        properties: { update_id: "update-b", error_class: "TypeError", source: "root_boundary" },
      },
    ]);
    // The same error handed over again (React retries) and a second error in
    // the same runtime never raise a second fatal.
    expect(h.guard.handleError(error, "root_boundary")).toEqual({ kind: "escalated" });
    expect(h.guard.handleError(new Error("second"), "global_handler")).toEqual({ kind: "escalated" });
    expect(h.escalated).toHaveLength(1);
  });

  test("adversarial: an embedded launch never escalates", () => {
    const h = harness({ facts: { ...UPDATE, isEmbeddedLaunch: true } });
    expect(h.guard.handleError(new Error("x"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "embedded_launch",
    });
    expect(h.escalated).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.events[0]).toEqual({
      event: "update_launch_error",
      properties: { update_id: "update-b", error_class: "Error", source: "root_boundary", reason: "embedded_launch" },
    });
  });

  test("adversarial: dev, disabled updates, a missing id and an emergency launch never escalate", () => {
    for (const facts of [
      null,
      { ...UPDATE, enabled: false },
      { ...UPDATE, updateId: null },
      { ...UPDATE, isEmergencyLaunch: true },
    ]) {
      const h = harness({ facts });
      expect(h.guard.handleError(new Error("x"), "root_boundary").kind).toBe("restart_screen");
      expect(h.escalated).toEqual([]);
    }
  });

  test("adversarial: a second error for the same update id on a later launch never escalates again", () => {
    const first = harness();
    first.guard.handleError(new Error("launch 1"), "root_boundary");
    expect(first.escalated).toHaveLength(1);

    // The next process reads what the first one persisted.
    const second = harness({ stored: first.stored.value });
    expect(second.guard.handleError(new Error("launch 2"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "already_escalated",
    });
    expect(second.escalated).toEqual([]);
  });

  test("adversarial: after the window the restart screen is the outcome, never an escalation", () => {
    const h = harness();
    h.clock.now += UPDATE_LAUNCH_WINDOW_MS + 1;
    expect(h.guard.handleError(new Error("late"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "window_elapsed",
    });
    expect(h.escalated).toEqual([]);
    expect(h.events.map((entry) => entry.event)).toEqual(["update_launch_error"]);
  });

  test("adversarial: a healthy launch confirms good, persists it, and nothing escalates afterwards", () => {
    const h = harness();
    h.guard.noteHealthyCommit();
    expect(parseUpdateLaunchRecord(h.stored.value)?.confirmed).toEqual(["update-b"]);
    expect(h.events).toEqual([
      { event: "update_launch_confirmed_good", properties: { update_id: "update-b", reason: "first_commit" } },
    ]);
    expect(h.guard.handleError(new Error("after content"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "confirmed_good",
    });
    expect(h.escalated).toEqual([]);

    // A later launch of the same, already-confirmed update never escalates.
    const later = harness({ stored: h.stored.value });
    expect(later.guard.handleError(new Error("x"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "confirmed_good",
    });
  });

  test("adversarial: a confirmation that could not be stored still stops escalation in this runtime", () => {
    const h = harness({ writeThrows: true });
    h.guard.noteHealthyCommit();
    expect(h.guard.handleError(new Error("after content"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "confirmed_good",
    });
    expect(h.escalated).toEqual([]);
  });

  test("a launch that stays healthy for the whole window is confirmed by the timer", () => {
    const h = harness();
    expect(h.timers.map((timer) => timer.ms)).toEqual([UPDATE_LAUNCH_WINDOW_MS]);
    h.timers[0].callback();
    expect(h.events[0]).toEqual({
      event: "update_launch_confirmed_good",
      properties: { update_id: "update-b", reason: "window_elapsed" },
    });
  });

  test("a launch that already had an error is never confirmed good", () => {
    const h = harness({ facts: { ...UPDATE, isEmbeddedLaunch: true } });
    h.guard.handleError(new Error("x"), "root_boundary");
    h.timers[0].callback();
    h.guard.noteHealthyCommit();
    expect(h.events.map((entry) => entry.event)).toEqual(["update_launch_error"]);
  });

  test("adversarial: the first launch after an in-app reload never escalates, and the marker is consumed", () => {
    const stored = JSON.stringify({ escalated: [], confirmed: [], inAppReloadAt: 1_000_000 - 2_000 });
    const h = harness({ stored });
    expect(h.guard.handleError(new Error("x"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "in_app_reload",
    });
    expect(h.escalated).toEqual([]);
    expect(parseUpdateLaunchRecord(h.stored.value)?.inAppReloadAt).toBeNull();
  });

  test("a stale in-app reload marker does not describe this process", () => {
    const stored = JSON.stringify({
      escalated: [],
      confirmed: [],
      inAppReloadAt: 1_000_000 - IN_APP_RELOAD_MARKER_MAX_AGE_MS - 1,
    });
    const h = harness({ stored });
    expect(h.guard.handleError(new Error("x"), "root_boundary")).toEqual({ kind: "escalated" });
  });

  test("adversarial: without a working store the guard fails open and never escalates", () => {
    for (const options of [{ storeThrows: true }, { stored: "{not json" }]) {
      const h = harness(options);
      expect(h.guard.handleError(new Error("x"), "root_boundary")).toEqual({
        kind: "restart_screen",
        reason: "store_unavailable",
      });
      expect(h.escalated).toEqual([]);
    }
  });
});

describe("#2107 U1 launch guard — runtime wiring", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const runtime = require("../updateLaunchRuntime") as typeof import("../updateLaunchRuntime");

  function memoryStore(initial: string | null = null): { value: string | null; read: () => string | null; write: (v: string) => void } {
    const store = {
      value: initial,
      read: () => store.value,
      write: (value: string) => {
        store.value = value;
      },
    };
    return store;
  }

  function errorUtils(): {
    original: jest.Mock;
    current: () => (error: unknown, isFatal?: boolean) => void;
    api: { getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void; setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => void };
  } {
    const original = jest.fn();
    let handler: (error: unknown, isFatal?: boolean) => void = original;
    return {
      original,
      current: () => handler,
      api: {
        getGlobalHandler: () => handler,
        setGlobalHandler: (next) => {
          handler = next;
        },
      },
    };
  }

  beforeEach(() => {
    runtime.resetUpdateLaunchGuardForTests();
    mockRunSafeReload.mockClear();
    mockReloadAsync.mockClear();
  });

  test("development installs nothing, so the red box is unchanged", () => {
    const utils = errorUtils();
    runtime.installUpdateLaunchGuard({
      isDev: true,
      errorUtils: utils.api,
      store: memoryStore(),
      readFacts: () => UPDATE,
      now: () => 0,
    });
    expect(utils.current()).toBe(utils.original);
    expect(runtime.getUpdateLaunchGuard()).toBeNull();
  });

  test("a non-fatal global error in the window is raised once as a fatal through the ORIGINAL handler", () => {
    const utils = errorUtils();
    const store = memoryStore();
    runtime.installUpdateLaunchGuard({
      isDev: false,
      errorUtils: utils.api,
      store,
      readFacts: () => UPDATE,
      now: () => 5_000,
    });
    const error = new RangeError("soft");
    utils.current()(error, false);
    expect(utils.original.mock.calls).toEqual([[error, true]]);
    expect(parseUpdateLaunchRecord(store.value)?.escalated).toEqual(["update-b"]);

    // A real fatal passes straight through, unchanged.
    const fatal = new Error("fatal");
    utils.current()(fatal, true);
    expect(utils.original.mock.calls[1]).toEqual([fatal, true]);
  });

  test("a global error on an embedded launch passes through as non-fatal", () => {
    const utils = errorUtils();
    runtime.installUpdateLaunchGuard({
      isDev: false,
      errorUtils: utils.api,
      store: memoryStore(),
      readFacts: () => ({ ...UPDATE, isEmbeddedLaunch: true }),
      now: () => 5_000,
    });
    const error = new Error("soft");
    utils.current()(error, false);
    expect(utils.original.mock.calls).toEqual([[error, false]]);
  });

  test("the in-app reload marker is written for the next runtime", () => {
    const utils = errorUtils();
    const store = memoryStore();
    runtime.installUpdateLaunchGuard({
      isDev: false,
      errorUtils: utils.api,
      store,
      readFacts: () => UPDATE,
      now: () => 5_000,
    });
    runtime.markInAppReloadForLaunchGuard(42);
    expect(parseUpdateLaunchRecord(store.value)?.inAppReloadAt).toBe(42);
  });

  test("adversarial: the restart button goes through safeReload, never a bare native reload", async () => {
    await runtime.requestLaunchErrorRestart();
    expect(mockRunSafeReload).toHaveBeenCalledTimes(1);
    expect(mockReloadAsync).toHaveBeenCalledTimes(1);
    // The native reload ran INSIDE runSafeReload's callback.
    expect(mockRunSafeReload.mock.invocationCallOrder[0]).toBeLessThan(
      mockReloadAsync.mock.invocationCallOrder[0],
    );
  });
});
