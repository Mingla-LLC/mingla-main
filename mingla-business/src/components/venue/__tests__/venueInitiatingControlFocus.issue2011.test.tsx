/** Issue #2011: the real native module/Back control owns its focus restorer. */

import React from "react";
import { AccessibilityInfo, findNodeHandle, Platform } from "react-native";
import { VenueModulePillRow } from "../VenueModulePillRow";

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    ...actual,
    findNodeHandle: jest.fn(() => 91),
    AccessibilityInfo: {
      ...(actual.AccessibilityInfo as Record<string, unknown>),
      setAccessibilityFocus: jest.fn(),
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (
    element: React.ReactElement,
    options: { createNodeMock: () => { focus: jest.Mock } },
  ) => {
    root: { findByProps: (props: Record<string, unknown>) => { props: Record<string, unknown> } };
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};
const { act } = TestRenderer;

describe("issue #2011 native initiating-control restoration", () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  });

  afterAll(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
  });

  it("passes one-shot restorers for the actual module pill and Back chip", () => {
    const onSelect = jest.fn();
    const onBack = jest.fn();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <VenueModulePillRow
          modules={["overview", "availability", "settings"]}
          activeModule="availability"
          onSelect={onSelect}
          onBackToHub={onBack}
        />,
        { createNodeMock: () => ({ focus: jest.fn() }) },
      );
    });

    act(() => {
      (renderer.root.findByProps({ testID: "venue-module-pill-settings" })
        .props.onPress as () => void)();
    });
    expect(onSelect).toHaveBeenCalledWith("settings", expect.any(Function));
    (onSelect.mock.calls[0][1] as () => void)();

    act(() => {
      (renderer.root.findByProps({ testID: "venue-module-back-to-hub" })
        .props.onPress as () => void)();
    });
    expect(onBack).toHaveBeenCalledWith(expect.any(Function));
    (onBack.mock.calls[0][0] as () => void)();

    expect(findNodeHandle).toHaveBeenCalledTimes(2);
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenNthCalledWith(1, 91);
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenNthCalledWith(2, 91);
    act(() => renderer.unmount());
  });
});
