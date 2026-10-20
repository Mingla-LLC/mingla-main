// @ts-nocheck -- the test intentionally supplies a minimal host-component RN runtime.
// #2107 (U1, device rework) — Host's root composition, mounted: ORCH-0964's
// outer ErrorBoundary sits ABOVE UpdateLaunchBoundary. On Android its fallback
// committing native views fired CONTENT_APPEARED and stopped expo-updates'
// rollback. An escalated launch error must pass through it uncaught (nothing
// committed); any other error still gets the restart screen. app/_layout.tsx's
// RootErrorFallback is this exact composition; the strict-grep gate
// issue-2107-mandatory-js-update.mjs pins the wiring. Invariant
// I-2107-UPDATE-LAUNCH-NO-COMMIT is declared in
// app-mobile/src/services/__tests__/issue_2107_update_launch_fallback.test.ts.
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
const { UpdateLaunchBoundary, rethrowEscalatedLaunchError } = require("../UpdateLaunchBoundary");
const { ErrorBoundary: ReactErrorBoundary } = require("react-error-boundary");

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

function RootErrorFallback(props: { error: unknown }): React.ReactElement {
  rethrowEscalatedLaunchError(props.error);
  return React.createElement("Text", null, "Something broke.");
}

function HostRoot({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ReactErrorBoundary FallbackComponent={RootErrorFallback}>
      <UpdateLaunchBoundary>{children}</UpdateLaunchBoundary>
    </ReactErrorBoundary>
  );
}

let consoleError: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});
afterAll(() => {
  runtime.resetUpdateLaunchGuardForTests();
});

describe("#2107 U1 Host root: escalation bypasses ORCH-0964's fallback", () => {
  test("happy path: an escalated first-render error leaves the root uncaught and commits nothing", () => {
    const { original } = installGuard(false);
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    expect(() => {
      act(() => {
        renderer = TestRenderer.create(<HostRoot><Broken /></HostRoot>);
      });
    }).toThrow("broken update");
    expect(original).toHaveBeenCalledTimes(1);
    expect(original.mock.calls[0][1]).toBe(true);
    expect(renderer === undefined || renderer.toJSON() === null).toBe(true);
  });

  test("adversarial: without escalation the restart screen shows and ORCH-0964's fallback is never needed", () => {
    const { original } = installGuard(true);
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<HostRoot><Broken /></HostRoot>);
    });
    expect(original).not.toHaveBeenCalled();
    const texts = renderer.root.findAllByType("Text").map((node) => [].concat(node.props.children).join(""));
    expect(texts).toContain("Something went wrong");
    expect(texts).not.toContain("Something broke.");
  });

  test("adversarial: an error outside the launch boundary still gets ORCH-0964's fallback when nothing escalated", () => {
    installGuard(true);
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ReactErrorBoundary FallbackComponent={RootErrorFallback}><Broken /></ReactErrorBoundary>,
      );
    });
    const texts = renderer.root.findAllByType("Text").map((node) => [].concat(node.props.children).join(""));
    expect(texts).toEqual(["Something broke."]);
  });
});
