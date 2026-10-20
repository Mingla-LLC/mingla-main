// #2107 (U1, device rework) — a broken downloaded update must roll back, and
// the in-app restart marker must never outlive the restart it describes.
//
// Android device test on 0c16489c0: the boundary caught the first-render error,
// escalated it, then committed a (null) fallback inside providers that still
// add native views; CONTENT_APPEARED fired, expo-updates' ErrorRecovery counted
// the launch successful and crashed without falling back. Now the escalated
// error is rethrown, nothing commits, and React reports it as fatal from an
// empty root. The tester also found the marker written by safeReload survived a
// failed restart (P3) and was never consumed on an embedded launch.
//
// MINGLA-INVARIANT: I-2107-UPDATE-LAUNCH-NO-COMMIT | issue #2107 | An escalated launch error is rethrown by UpdateLaunchBoundary (and by any root boundary above it) so nothing commits before expo-updates handles the fatal; the in-app reload marker is consumed at guard install on every launch and cleared whenever safeReload restores.
//
// Mechanism and native citations: src/services/updateLaunchGuard.ts header.

import {
  UpdateLaunchGuard,
  parseUpdateLaunchRecord,
  type UpdateLaunchFacts,
  type UpdateLaunchGuardDependencies,
} from "../updateLaunchGuard";
import { createSafeReload, type SafeReloadDependencies } from "../safeReload";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const mockRealtime = { removeAllChannels: jest.fn(async (): Promise<unknown[]> => []) };
const mockPostHog = { flush: jest.fn(async (): Promise<void> => undefined) };

jest.mock("../../config/queryClient", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { QueryClient } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock("../supabase", () => ({ supabase: mockRealtime }));
jest.mock("../postHogService", () => ({
  postHogService: { getClient: () => mockPostHog, isReady: () => true, capture: () => undefined },
}));
jest.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  Platform: { OS: "android" },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtime = require("../updateLaunchRuntime") as typeof import("../updateLaunchRuntime");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runSafeReload } = require("../safeReloadRuntime") as typeof import("../safeReloadRuntime");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const boundaryModule = require("../../components/UpdateLaunchBoundary") as typeof import("../../components/UpdateLaunchBoundary");

const UPDATE: UpdateLaunchFacts = {
  enabled: true,
  updateId: "update-b",
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
};

type Handler = (error: unknown, isFatal?: boolean) => void;

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

function install(store: ReturnType<typeof memoryStore>, facts: UpdateLaunchFacts, now: number): { original: jest.Mock } {
  runtime.resetUpdateLaunchGuardForTests();
  const original = jest.fn();
  let handler: Handler = original;
  runtime.installUpdateLaunchGuard({
    isDev: false,
    errorUtils: { getGlobalHandler: () => handler, setGlobalHandler: (next) => { handler = next; } },
    store,
    readFacts: () => facts,
    now: () => now,
  });
  return { original };
}

function coreGuard(stored: string | null, facts: UpdateLaunchFacts): { guard: UpdateLaunchGuard; store: { value: string | null } } {
  const store = { value: stored };
  const dependencies: UpdateLaunchGuardDependencies = {
    now: () => 1_000_000,
    readFacts: () => facts,
    store: { read: () => store.value, write: (value) => { store.value = value; } },
    escalate: () => undefined,
    report: () => undefined,
    setTimer: () => undefined,
  };
  const guard = new UpdateLaunchGuard(dependencies);
  guard.start();
  return { guard, store };
}

afterAll(() => {
  runtime.resetUpdateLaunchGuardForTests();
});

describe("#2107 U1 escalation commits nothing", () => {
  test("happy path: an escalated render error is rethrown by the boundary, never drawn", () => {
    const { original } = install(memoryStore(), UPDATE, 10);
    const error = new TypeError("first render");
    const state = boundaryModule.UpdateLaunchBoundary.getDerivedStateFromError(error);
    expect(original.mock.calls).toEqual([[error, true]]);
    const instance = new boundaryModule.UpdateLaunchBoundary({ children: null });
    instance.state = state;
    expect(() => instance.render()).toThrow(error);
  });

  test("adversarial: a root boundary above passes the escalated error on instead of drawing a fallback", () => {
    install(memoryStore(), UPDATE, 10);
    const error = new TypeError("first render");
    boundaryModule.UpdateLaunchBoundary.getDerivedStateFromError(error);
    expect(() => boundaryModule.rethrowEscalatedLaunchError(error)).toThrow(error);
  });

  test("adversarial: without an escalation (embedded launch) the restart screen still shows and nothing is rethrown", () => {
    const { original } = install(memoryStore(), { ...UPDATE, isEmbeddedLaunch: true }, 10);
    const error = new Error("embedded");
    const state = boundaryModule.UpdateLaunchBoundary.getDerivedStateFromError(error);
    expect(original).not.toHaveBeenCalled();
    expect(() => boundaryModule.rethrowEscalatedLaunchError(error)).not.toThrow();
    const instance = new boundaryModule.UpdateLaunchBoundary({ children: null });
    instance.state = state;
    expect((instance.render() as { type: unknown }).type).toBe(boundaryModule.LaunchErrorRestartScreen);
  });
});

describe("#2107 U1 in-app reload marker never leaks (P3)", () => {
  test("happy path: a rejected native reload writes the marker, then the restore clears it", async () => {
    const store = memoryStore();
    install(store, UPDATE, 10);
    const failure = new Error("reload refused");
    let markerDuringReload: number | null | undefined;
    await expect(
      runSafeReload(async () => {
        markerDuringReload = parseUpdateLaunchRecord(store.value)?.inAppReloadAt;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(typeof markerDuringReload).toBe("number");
    expect(parseUpdateLaunchRecord(store.value)?.inAppReloadAt).toBeNull();
  });

  test("adversarial: a reload that resolves but leaves the process alive runs onRestore after the grace", async () => {
    const onRestore = jest.fn();
    const dependencies: SafeReloadDependencies = {
      pause: [],
      flush: [],
      lockdown: [],
      settle: async () => undefined,
      reload: async () => undefined,
      onRestore,
      restoreAfterMs: 10,
    };
    await createSafeReload(dependencies)();
    expect(onRestore).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  test("adversarial: the cold start after a failed restart escalates (the marker did not survive)", async () => {
    const store = memoryStore();
    install(store, UPDATE, 10);
    await expect(runSafeReload(async () => { throw new Error("refused"); })).rejects.toThrow("refused");
    const next = coreGuard(store.value, UPDATE);
    expect(next.guard.handleError(new Error("broken"), "root_boundary")).toEqual({ kind: "escalated" });
  });

  test("adversarial: an embedded launch consumes the marker at install, with no error and no confirmation", () => {
    const store = memoryStore(JSON.stringify({ escalated: [], confirmed: [], inAppReloadAt: 5 }));
    install(store, { ...UPDATE, isEmbeddedLaunch: true }, 10);
    expect(parseUpdateLaunchRecord(store.value)?.inAppReloadAt).toBeNull();
  });

  test("adversarial: the marker is consumed at guard start, before any error, and still marks this launch", () => {
    const stored = JSON.stringify({ escalated: [], confirmed: [], inAppReloadAt: 1_000_000 - 500 });
    const { guard, store } = coreGuard(stored, UPDATE);
    expect(parseUpdateLaunchRecord(store.value)?.inAppReloadAt).toBeNull();
    expect(guard.handleError(new Error("x"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "in_app_reload",
    });
  });

  test("clearing with no marker set writes nothing", () => {
    const store = memoryStore(JSON.stringify({ escalated: ["a"], confirmed: [], inAppReloadAt: null }));
    install(store, UPDATE, 10);
    const before = store.value;
    const write = jest.spyOn(store, "write");
    runtime.clearInAppReloadForLaunchGuard();
    expect(write).not.toHaveBeenCalled();
    expect(store.value).toBe(before);
  });
});
