import React from "react";
import { Pressable } from "react-native";

import { Button } from "../Button";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: "AnimatedView" },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => true,
  useSharedValue: (value: number) => ({ value }),
  withTiming: (value: number) => value,
}));
jest.mock("../Icon", () => ({ Icon: "Icon" }));
jest.mock("../Spinner", () => ({ Spinner: "Spinner" }));
jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: { buttonPress: jest.fn() },
}));

// react-test-renderer intentionally has no declarations in this workspace.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findByType: (type: typeof Pressable) => { props: Record<string, unknown> } };
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("issue #3569 Button checkable-role semantics", () => {
  it.each(["checkbox", "radio", "togglebutton"] as const)(
    "maps checked state to aria-checked for %s controls",
    (role) => {
      let renderer!: ReturnType<typeof TestRenderer.create>;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <Button
            label="Choice"
            onPress={jest.fn()}
            accessibilityRole={role}
            accessibilityState={{ checked: true }}
          />,
        );
      });

      const pressable = renderer.root.findByType(Pressable);
      expect(pressable.props.accessibilityRole).toBe(role);
      expect(pressable.props.accessibilityState).toEqual(
        expect.objectContaining({ checked: true, disabled: false, busy: false }),
      );
      expect(pressable.props["aria-checked"]).toBe(true);

      TestRenderer.act(() => renderer.unmount());
    },
  );

  it("does not leak aria-checked onto an ordinary button", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <Button
          label="Save"
          onPress={jest.fn()}
          accessibilityState={{ checked: true }}
        />,
      );
    });

    expect(renderer.root.findByType(Pressable).props["aria-checked"]).toBeUndefined();
    TestRenderer.act(() => renderer.unmount());
  });
});
