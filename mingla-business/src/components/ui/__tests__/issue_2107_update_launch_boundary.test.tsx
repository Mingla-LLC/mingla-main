// @ts-nocheck -- the test intentionally supplies a minimal host-component RN runtime.
// #2107 (U1) — Host's launch boundary, mounted for real: a child that throws on
// render is either handed to expo-updates' rollback (nothing rendered, then the
// restart screen) or shown the restart screen — never a blank screen — and the
// restart button goes through safeReload. Invariant
// I-2107-UPDATE-LAUNCH-ESCALATION is declared in
// app-mobile/src/services/__tests__/issue_2107_update_launch_guard.test.ts.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__DEV__ = false;

const mockRunSafeReload = jest.fn(async (reload: () => Promise<void>) => reload());
const mockReloadAsync = jest.fn(async () => undefined);
const mockHideSplash = jest.fn(async () => undefined);

jest.mock("react-native", () => {
  const ReactLocal = require("react");
  const host = (name: string) =>
    ReactLocal.forwardRef((props: any, ref: any) =>
      ReactLocal.createElement(name, { ...props, ref }, props.children),
    );
  return {
    View: host("View"),
    Text: host("Text"),
    ScrollView: host("ScrollView"),
    Pressable: ReactLocal.forwardRef((props: any, ref: any) =>
      ReactLocal.createElement(
        "Pressable",
        { ...props, ref, style: typeof props.style === "function" ? props.style({ pressed: false }) : props.style },
        props.children,
      ),
    ),
    StyleSheet: { create: (styles: unknown) => styles },
    Platform: { OS: "ios" },
  };
});
jest.mock("expo-splash-screen", () => ({ hideAsync: () => mockHideSplash() }));
jest.mock("../../../services/safeReloadRuntime", () => ({
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

const runtime = require("../../../services/updateLaunchRuntime");
const { UpdateLaunchBoundary } = require("../UpdateLaunchBoundary");
const { UPDATE_LAUNCH_ESCALATION_HOLD_MS } = require("../../../services/updateLaunchGuard");

function Broken(): React.ReactElement {
  throw new TypeError("broken update");
}

function installGuard(isEmbeddedLaunch: boolean) {
  runtime.resetUpdateLaunchGuardForTests();
  const original = jest.fn();
  let handler = original;
  const store = { value: null as string | null };
  runtime.installUpdateLaunchGuard({
    isDev: false,
    errorUtils: { getGlobalHandler: () => handler, setGlobalHandler: (next) => { handler = next; } },
    store: { read: () => store.value, write: (value) => { store.value = value; } },
    readFacts: () => ({ enabled: true, updateId: "update-b", isEmbeddedLaunch, isEmergencyLaunch: false }),
    now: () => 10,
  });
  return { original, store };
}

function texts(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root.findAllByType("Text").map((node) => [].concat(node.props.children).join(""));
}

let consoleError: jest.SpyInstance;
beforeEach(() => {
  mockRunSafeReload.mockClear();
  mockReloadAsync.mockClear();
  mockHideSplash.mockClear();
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
  jest.useRealTimers();
});

describe("#2107 U1 Host launch boundary (mounted)", () => {
  test("happy path: an eligible launch escalates once, renders nothing, then falls back to the restart screen", () => {
    jest.useFakeTimers();
    const { original } = installGuard(false);
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpdateLaunchBoundary><Broken /></UpdateLaunchBoundary>);
    });
    expect(original).toHaveBeenCalledTimes(1);
    expect(original.mock.calls[0][1]).toBe(true);
    expect(renderer.toJSON()).toBeNull();
    act(() => {
      jest.advanceTimersByTime(UPDATE_LAUNCH_ESCALATION_HOLD_MS);
    });
    expect(texts(renderer)).toContain("Something went wrong");
    expect(original).toHaveBeenCalledTimes(1);
  });

  test("adversarial: an embedded launch shows the restart screen at once, never blank, and never escalates", () => {
    const { original } = installGuard(true);
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpdateLaunchBoundary><Broken /></UpdateLaunchBoundary>);
    });
    expect(original).not.toHaveBeenCalled();
    expect(renderer.toJSON()).not.toBeNull();
    expect(texts(renderer)).toEqual(["Something went wrong", "Restarting the app usually fixes this.", "Tap to restart"]);
    expect(mockHideSplash).toHaveBeenCalledTimes(1);
  });

  test("adversarial: the restart button goes through safeReload", async () => {
    installGuard(true);
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpdateLaunchBoundary><Broken /></UpdateLaunchBoundary>);
    });
    const button = renderer.root.findByType("Pressable");
    expect(button.props.accessibilityRole).toBe("button");
    await act(async () => {
      button.props.onPress();
    });
    expect(mockRunSafeReload).toHaveBeenCalledTimes(1);
    expect(mockReloadAsync).toHaveBeenCalledTimes(1);
  });

  test("adversarial: a healthy launch renders its children, confirms good, and nothing escalates", () => {
    const { original, store } = installGuard(false);
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <UpdateLaunchBoundary><React.Fragment>{"healthy"}</React.Fragment></UpdateLaunchBoundary>,
      );
    });
    expect(renderer.toJSON()).toBe("healthy");
    expect(JSON.parse(store.value ?? "{}").confirmed).toEqual(["update-b"]);
    expect(original).not.toHaveBeenCalled();
  });
});

// #2107 CI fix: the guard's launch-window timer and the telemetry retry timer
// must not outlive this file (they required the analytics wrapper after the
// Jest environment was torn down).
afterAll(() => {
  runtime.resetUpdateLaunchGuardForTests();
});
