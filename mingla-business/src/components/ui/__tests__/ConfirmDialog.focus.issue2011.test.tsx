/** Issue #2011 rework guard: dialog focus belongs to the real action target. */

import React from "react";
import { AccessibilityInfo, findNodeHandle, Platform } from "react-native";
import { ConfirmDialog } from "../ConfirmDialog";

const mockFocusByLabel = new Map<string, jest.Mock>();

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  const findNodeHandleMock = jest.fn();
  const setAccessibilityFocusMock = jest.fn();
  return {
    ...actual,
    findNodeHandle: findNodeHandleMock,
    AccessibilityInfo: {
      ...(actual.AccessibilityInfo as Record<string, unknown>),
      setAccessibilityFocus: setAccessibilityFocusMock,
    },
    __findNodeHandleMock: findNodeHandleMock,
    __setAccessibilityFocusMock: setAccessibilityFocusMock,
  };
});

const reactNativeMocks = jest.requireMock("react-native") as {
  __findNodeHandleMock: jest.Mock;
  __setAccessibilityFocusMock: jest.Mock;
};
const mockFindNodeHandle = reactNativeMocks.__findNodeHandleMock;
const mockSetAccessibilityFocus = reactNativeMocks.__setAccessibilityFocusMock;

jest.mock("../Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react") as typeof React;
  return {
    Button: ReactLocal.forwardRef<{ focus: () => void }, { label: string }>(
      function MockButton({ label }, ref) {
        const focus = mockFocusByLabel.get(label) ?? jest.fn();
        mockFocusByLabel.set(label, focus);
        ReactLocal.useImperativeHandle(ref, () => ({ focus }), [focus]);
        return ReactLocal.createElement("Button", { label });
      },
    ),
  };
});
jest.mock("../Input", () => ({ Input: "Input" }));
jest.mock("../Modal", () => ({
  Modal: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: React.ReactNode;
  }) => (visible ? React.createElement("Modal", null, children) : null),
}));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: "AnimatedView" },
  Easing: { linear: jest.fn() },
  cancelAnimation: jest.fn(),
  runOnJS: (callback: () => void) => callback,
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: number) => ({ value }),
  withTiming: (value: number) => value,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderTree {
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
// react-test-renderer has no bundled declarations in this repository.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void) => void;
};
const { act } = TestRenderer;

const baseProps = {
  visible: true,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  title: "Discard changes?",
  description: "Choose whether to keep editing.",
  cancelLabel: "Keep editing",
  confirmLabel: "Discard",
};

describe("issue #2011 ConfirmDialog focus contract", () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    mockFocusByLabel.clear();
    mockFindNodeHandle.mockReset();
    mockSetAccessibilityFocus.mockReset();
    jest.clearAllMocks();
    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
    global.requestAnimationFrame = ((
      callback: FrameRequestCallback,
    ): number => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = jest.fn();
  });

  afterAll(() => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: originalOS,
    });
  });

  it("places initial focus on the actual Keep editing Button", () => {
    let renderer!: RenderTree;
    act(() => {
      renderer = TestRenderer.create(
        <ConfirmDialog {...baseProps} initialFocus="cancel" />,
      );
    });

    expect(mockFocusByLabel.get("Keep editing")).toHaveBeenCalledTimes(1);
    expect(mockFocusByLabel.get("Discard")).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("moves native accessibility focus to the real Keep editing Button handle", () => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "ios",
    });
    mockFindNodeHandle.mockReturnValue(73);
    let renderer!: RenderTree;
    act(() => {
      renderer = TestRenderer.create(
        <ConfirmDialog {...baseProps} initialFocus="cancel" />,
      );
    });

    expect(findNodeHandle).toHaveBeenCalledWith(
      expect.objectContaining({ focus: expect.any(Function) }),
    );
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(73);
    act(() => renderer.unmount());
  });

  it("restores the supplied initiating control only after dismissal", () => {
    const restoreInitiator = jest.fn();
    let renderer!: RenderTree;
    act(() => {
      renderer = TestRenderer.create(
        <ConfirmDialog
          {...baseProps}
          initialFocus="cancel"
          restoreFocus={restoreInitiator}
        />,
      );
    });
    expect(restoreInitiator).not.toHaveBeenCalled();

    act(() => {
      renderer.update(
        <ConfirmDialog
          {...baseProps}
          visible={false}
          initialFocus="cancel"
          restoreFocus={restoreInitiator}
        />,
      );
    });
    expect(restoreInitiator).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it("restores the actual web control that opened the dialog when no callback is supplied", () => {
    const initiatorFocus = jest.fn();
    const previousDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { activeElement: { focus: initiatorFocus } },
    });
    let renderer!: RenderTree;
    act(() => {
      renderer = TestRenderer.create(
        <ConfirmDialog {...baseProps} initialFocus="cancel" />,
      );
    });
    expect(initiatorFocus).not.toHaveBeenCalled();
    act(() => {
      renderer.update(
        <ConfirmDialog {...baseProps} visible={false} initialFocus="cancel" />,
      );
    });
    expect(initiatorFocus).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    if (previousDocument === undefined)
      delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", previousDocument);
  });

  it("keeps existing omitted-focus callers inert", () => {
    let renderer!: RenderTree;
    act(() => {
      renderer = TestRenderer.create(<ConfirmDialog {...baseProps} />);
    });
    expect(mockFocusByLabel.get("Keep editing")).not.toHaveBeenCalled();
    expect(mockFocusByLabel.get("Discard")).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
