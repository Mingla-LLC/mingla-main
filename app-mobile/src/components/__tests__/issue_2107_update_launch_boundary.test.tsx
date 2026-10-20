// #2107 (U1) — Explorer's root boundary: a caught root error is either handed
// to expo-updates' rollback (hold, then the restart screen) or shown as the
// restart screen — never a blank screen. Invariant I-2107-UPDATE-LAUNCH-ESCALATION
// is declared in src/services/__tests__/issue_2107_update_launch_guard.test.ts.
//
// Explorer's default jest config has no React renderer, so this drives the
// class's own lifecycle methods against a minimal react-native stub.
import React from "react";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

jest.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtime = require("../../services/updateLaunchRuntime") as typeof import("../../services/updateLaunchRuntime");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const boundaryModule = require("../UpdateLaunchBoundary") as typeof import("../UpdateLaunchBoundary");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UPDATE_LAUNCH_ESCALATION_HOLD_MS } = require("../../services/updateLaunchGuard") as typeof import("../../services/updateLaunchGuard");

const { UpdateLaunchBoundary, LaunchErrorRestartScreen } = boundaryModule;

type Handler = (error: unknown, isFatal?: boolean) => void;

function installGuard(facts: { isEmbeddedLaunch: boolean }): { original: jest.Mock; store: { value: string | null } } {
  runtime.resetUpdateLaunchGuardForTests();
  const original = jest.fn();
  let handler: Handler = original;
  const store = { value: null as string | null };
  runtime.installUpdateLaunchGuard({
    isDev: false,
    errorUtils: { getGlobalHandler: () => handler, setGlobalHandler: (next) => { handler = next; } },
    store: { read: () => store.value, write: (value) => { store.value = value; } },
    readFacts: () => ({ enabled: true, updateId: "update-b", isEmergencyLaunch: false, ...facts }),
    now: () => 10,
  });
  return { original, store };
}

function boundaryWith(state: { error: unknown; view: "children" | "hold" | "restart" }): InstanceType<typeof UpdateLaunchBoundary> {
  const instance = new UpdateLaunchBoundary({ children: React.createElement("Child") });
  instance.state = state;
  return instance;
}

afterEach(() => {
  jest.useRealTimers();
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

describe("#2107 U1 Explorer root boundary", () => {
  test("happy path: a launch-window error on an unconfirmed update escalates once and holds on nothing", () => {
    const { original } = installGuard({ isEmbeddedLaunch: false });
    const error = new Error("render boom");
    const state = UpdateLaunchBoundary.getDerivedStateFromError(error);
    expect(state.view).toBe("hold");
    expect(original.mock.calls).toEqual([[error, true]]);
    expect(boundaryWith(state).render()).toBeNull();
  });

  test("adversarial: an embedded launch shows the restart screen and never escalates", () => {
    const { original } = installGuard({ isEmbeddedLaunch: true });
    const state = UpdateLaunchBoundary.getDerivedStateFromError(new Error("render boom"));
    expect(state.view).toBe("restart");
    expect(original).not.toHaveBeenCalled();
    const rendered = boundaryWith(state).render() as React.ReactElement;
    expect(rendered.type).toBe(LaunchErrorRestartScreen);
  });

  test("adversarial: a hold that native recovery does not end becomes the restart screen, never a blank one", () => {
    jest.useFakeTimers();
    installGuard({ isEmbeddedLaunch: false });
    const instance = boundaryWith({ error: new Error("x"), view: "hold" });
    const setState = jest.fn();
    instance.setState = setState as typeof instance.setState;
    instance.componentDidUpdate();
    jest.advanceTimersByTime(UPDATE_LAUNCH_ESCALATION_HOLD_MS - 1);
    expect(setState).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(setState).toHaveBeenCalledWith({ view: "restart" });
  });

  test("adversarial: with no guard installed (any failure) a caught error still shows the restart screen", () => {
    runtime.resetUpdateLaunchGuardForTests();
    const state = UpdateLaunchBoundary.getDerivedStateFromError(new Error("x"));
    expect(state.view).toBe("restart");
    expect((boundaryWith(state).render() as React.ReactElement).type).toBe(LaunchErrorRestartScreen);
  });

  test("adversarial: a healthy first commit confirms the launch good, and nothing escalates afterwards", () => {
    const { original, store } = installGuard({ isEmbeddedLaunch: false });
    const instance = boundaryWith({ error: null, view: "children" });
    expect((instance.render() as React.ReactElement).type).toBe("Child");
    instance.componentDidMount();
    expect(JSON.parse(store.value ?? "{}").confirmed).toEqual(["update-b"]);
    const state = UpdateLaunchBoundary.getDerivedStateFromError(new Error("later"));
    expect(state.view).toBe("restart");
    expect(original).not.toHaveBeenCalled();
  });

  test("development rethrows, so the red box is unchanged", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const error = new Error("dev");
    expect(() => boundaryWith({ error, view: "restart" }).render()).toThrow(error);
  });
});

// #2107 CI fix: the guard's launch-window timer and the telemetry retry timer
// must not outlive this file (they required the analytics wrapper after the
// Jest environment was torn down).
afterAll(() => {
  runtime.resetUpdateLaunchGuardForTests();
});
