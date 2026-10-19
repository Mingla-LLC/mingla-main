/**
 * #3040 Appendix A D3 / §4 — the cover sheet's primary buttons use dark ink
 * (`canvas.depth`) on flat `accent.warm` for the label AND the icon. Button's
 * own resolution made the icon `#000000`, so the icon colour is explicit.
 * FAILS ON REVERT: drop `iconColor` from Button, or from the cover primaries.
 */
import React from "react";
import { Pressable } from "react-native";
import { readFileSync } from "fs";
import { join } from "path";

import { Button } from "../Button";
import { accent, canvas } from "../../../constants/designSystem";

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: { type: unknown; props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] };
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The manual RN mock's Pressable does not call a function child, so the
// button's content is rendered from Pressable's own render prop.
const iconColors = (element: React.ReactElement): unknown[] => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  const [pressable] = renderer.root.findAll((node) => node.type === Pressable);
  const renderContent = pressable.props.children as (state: Record<string, boolean>) => React.ReactElement;
  renderer.unmount();
  let content!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    content = TestRenderer.create(renderContent({ pressed: false, hovered: false, focused: false }));
  });
  const colors = content.root.findAll((node) => node.type === "Icon").map((node) => node.props.color);
  content.unmount();
  return colors;
};

describe("#3040 Button iconColor", () => {
  it("paints leading and trailing icons in the given colour", () => {
    expect(
      iconColors(
        <Button
          label="Replace video"
          onPress={jest.fn()}
          accentColor={accent.warm}
          iconColor={canvas.depth}
          leadingIcon="play"
          trailingIcon="chevR"
        />,
      ),
    ).toEqual([canvas.depth, canvas.depth]);
  });

  it("keeps the label-following default when no iconColor is given", () => {
    const colors = iconColors(
      <Button label="Save" onPress={jest.fn()} accentColor={accent.warm} leadingIcon="play" />,
    );
    expect(colors).toHaveLength(1);
    expect(colors[0]).not.toBe(canvas.depth);
  });

  it("stays one muted colour while disabled", () => {
    const colors = iconColors(
      <Button label="Save" onPress={jest.fn()} disabled iconColor={canvas.depth} leadingIcon="play" />,
    );
    expect(colors).toHaveLength(1);
    expect(colors[0]).not.toBe(canvas.depth);
  });

  it("every cover-sheet primary passes canvas.depth for its icon", () => {
    const source = readFileSync(join(__dirname, "..", "CoverPicker.tsx"), "utf8");
    const primaries = source.match(/accentColor: accent\.warm, labelStyle: styles\.darkInkLabel[^}]*\}/g) ?? [];
    expect(primaries.length).toBeGreaterThanOrEqual(3);
    for (const primary of primaries) expect(primary).toContain("iconColor: canvas.depth");
  });
});
