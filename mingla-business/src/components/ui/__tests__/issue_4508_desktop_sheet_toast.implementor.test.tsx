/**
 * #4508 T4 — on desktop web (the centred Sheet card), a toast fired while the
 * card is open draws in the card's own toast layer, inside its Modal, above
 * the card; not in the app-root layer that the Modal's portal covers (the
 * Host web guest sheet's check-in toasts were hidden under the sheet).
 *
 * FAILS ON REVERT: remove `<ToastHost layer="overlay" open={visible} />` from
 * Sheet.web's DesktopCenteredCard -> the toast draws in toast-host-root and
 * "draws inside the open card's Modal" fails.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: true }),
}));
jest.mock("../escapeLayerStack", () => ({ useEscapeLayer: () => undefined }));
jest.mock("../SheetMobile", () => ({
  Sheet: () => null,
  SHEET_TOP_INSET: 24,
  SHEET_SIDE_GUTTER: 20,
  WEB_OPAQUE_BACKGROUND: "#16181b",
}));
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
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../WebSafeGestureDetector", () => ({
  WebSafeGestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("expo-blur", () => ({ BlurView: "BlurView" }));

import { Sheet } from "../Sheet.web";
import { Toast } from "../Toast";
import { ToastHost } from "../ToastHost";
import { resetToastStoreForTest } from "../toastStore";

type Node = { type: unknown; props: Record<string, unknown>; findAll: (p: (n: Node) => boolean) => Node[] };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: Node; unmount: () => void };
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hostsShowing = (root: Node): string[] =>
  root
    .findAll((n) => typeof n.props.testID === "string" && (n.props.testID as string).startsWith("toast-host-") && typeof n.type !== "string")
    .filter((h) => h.findAll((n) => n.props.testID === "checkin-toast").length > 0)
    .map((h) => h.props.testID as string)
    .filter((id, i, all) => all.indexOf(id) === i);

const App: React.FC<{ open: boolean }> = ({ open }) => (
  <>
    <Sheet visible={open} onClose={() => undefined} testID="guest-sheet">
      <Toast visible kind="success" message="Checked in." onDismiss={() => undefined} testID="checkin-toast" />
    </Sheet>
    <ToastHost layer="root" />
  </>
);

beforeEach(() => {
  resetToastStoreForTest();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("#4508 T4 — desktop sheet toasts", () => {
  test("a toast fired inside the open card draws inside the open card's Modal", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<App open />);
    });
    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(50);
    });
    expect(hostsShowing(renderer.root)).toEqual(["toast-host-overlay"]);
    const { Modal } = require("react-native") as { Modal: unknown };
    const modal = renderer.root.findAll((n) => n.type === Modal)[0];
    expect(modal).toBeDefined();
    expect(modal.findAll((n) => n.props.testID === "checkin-toast").length).toBeGreaterThan(0);
    renderer.unmount();
  });
});
