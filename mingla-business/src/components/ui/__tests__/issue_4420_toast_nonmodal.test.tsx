/**
 * #4420 B4 — toasts are NON-MODAL and draw in the top-most open layer.
 *
 * The bug: every <Toast> rendered its own native <Modal>. On iOS a Modal window
 * captures every touch until it closes, so each toast froze the screen.
 *
 * FAILS ON REVERT:
 *   - Toast renders a <Modal> again           → "renders no Modal" fails.
 *   - ToastHost loses pointerEvents box-none  → "host is box-none" fails.
 *   - the layering rule is dropped (root-only, or every host draws)
 *                                              → "draws in the sheet's layer" fails.
 *   - the timer stops pausing on press        → "pauses while pressed" fails.
 *
 * Source compatibility: the call site below uses the pre-#4420 props only.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("react-native-gesture-handler", () => {
  const { View: V } = jest.requireActual("react-native") as { View: unknown };
  const chain: Record<string, unknown> = {};
  for (const key of ["onUpdate", "onEnd", "activeOffsetY", "failOffsetX"]) chain[key] = () => chain;
  return { __esModule: true, Gesture: { Pan: () => chain }, GestureHandlerRootView: V, GestureDetector: V };
});
jest.mock("react-native-reanimated", () => {
  const { View: V } = jest.requireActual("react-native") as { View: unknown };
  return {
    __esModule: true,
    default: { View: V },
    Easing: { out: () => 0, in: () => 0, cubic: 0 },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("../WebSafeGestureDetector", () => ({
  WebSafeGestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("expo-blur", () => ({ BlurView: "BlurView" }));

import { Toast } from "../Toast";
import { ToastHost } from "../ToastHost";
import { resetToastStoreForTest, topHostOrder, useToastStore, visibleToasts } from "../toastStore";

type Node = { type: unknown; props: Record<string, unknown> };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    update: (element: React.ReactElement) => void;
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hostWithToast = (renderer: ReturnType<typeof TestRenderer.create>): string[] => {
  const hosts = renderer.root.findAll(
    (n) => typeof n.props.testID === "string" && (n.props.testID as string).startsWith("toast-host-") && typeof n.type !== "string",
  );
  return hosts
    .filter((h) => (h as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll((n) => n.props.testID === "the-toast").length > 0)
    .map((h) => h.props.testID as string)
    .filter((id, index, all) => all.indexOf(id) === index);
};

/** A stand-in for SheetMobile / Modal: its own window with an overlay host. */
const FakeSheet: React.FC<{ open: boolean; children?: React.ReactNode }> = ({ open, children }) =>
  open ? (
    <>
      {children}
      <ToastHost layer="overlay" open={open} testID="toast-host-sheet" />
    </>
  ) : null;

const App: React.FC<{ sheetOpen: boolean; toastVisible: boolean; onDismiss?: () => void }> = ({
  sheetOpen,
  toastVisible,
  onDismiss = () => undefined,
}) => (
  <>
    <FakeSheet open={sheetOpen} />
    <Toast visible={toastVisible} kind="success" message="Saved" onDismiss={onDismiss} testID="the-toast" />
    <ToastHost layer="root" testID="toast-host-root" />
  </>
);

beforeEach(() => {
  resetToastStoreForTest();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("#4420 B4 — non-modal Toast", () => {
  test("Toast renders no Modal anywhere", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<App sheetOpen={false} toastVisible />);
    });
    const { Modal } = require("react-native") as { Modal: unknown };
    expect(renderer.root.findAll((n) => n.type === Modal || n.type === "Modal" || n.type === "RCTModalHostView")).toHaveLength(0);
    expect(hostWithToast(renderer)).toEqual(["toast-host-root"]);
    renderer.unmount();
  });

  test("the host layer passes touches through (box-none, no scrim)", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<App sheetOpen={false} toastVisible />);
    });
    const layers = renderer.root.findAll((n) => n.props.testID === "toast-host-root" && n.props.pointerEvents !== undefined);
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) expect(layer.props.pointerEvents).toBe("box-none");
    renderer.unmount();
  });

  test("a toast fired while a sheet is open draws in the sheet's layer, and only there", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<App sheetOpen toastVisible />);
    });
    expect(hostWithToast(renderer)).toEqual(["toast-host-sheet"]);

    // The sheet closes while the toast is still up: it moves to the root layer.
    await TestRenderer.act(async () => {
      renderer.update(<App sheetOpen={false} toastVisible />);
    });
    expect(hostWithToast(renderer)).toEqual(["toast-host-root"]);
    renderer.unmount();
  });

  test("the top-most layer wins: later-opened layers sit above earlier ones", () => {
    expect(topHostOrder([0, 3, 7])).toBe(7);
    expect(topHostOrder([])).toBeNull();
    const entries = [1, 2, 3, 4].map((id) => ({ id, kind: "info" as const, message: String(id), onDismiss: () => undefined }));
    expect(visibleToasts(entries, false).map((e) => e.id)).toEqual([4]);
    expect(visibleToasts(entries, true).map((e) => e.id)).toEqual([2, 3, 4]);
  });

  test("the timer pauses while the toast is pressed and resumes on release", async () => {
    const onDismiss = jest.fn();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<App sheetOpen={false} toastVisible onDismiss={onDismiss} />);
    });
    const [card] = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === "Dismiss notification" && typeof n.props.onPressIn === "function",
    );
    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(3000);
      (card.props.onPressIn as () => void)();
      jest.advanceTimersByTime(10000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await TestRenderer.act(async () => {
      (card.props.onPressOut as () => void)();
      jest.advanceTimersByTime(900);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  test("hiding the toast removes it from the store (no stale layer entry)", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<App sheetOpen={false} toastVisible />);
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    await TestRenderer.act(async () => {
      renderer.update(<App sheetOpen={false} toastVisible={false} />);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
    await TestRenderer.act(async () => {
      renderer.unmount();
    });
    expect(useToastStore.getState().hosts).toHaveLength(0);
  });
});
