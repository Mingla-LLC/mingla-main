/**
 * issue #1023 wave 2 — P-4. ThemeAccentFill and ThemeAccentGradientLayer
 * mounted for real (react-test-renderer; react-native -> manual mock,
 * expo-linear-gradient -> a recording host).
 *
 * Pins: a solid theme renders a plain View in palette.accent and NO gradient
 * layer (solid pages unchanged); a gradient theme renders a 135° gradient
 * whose two stops are both white-label safe (the second stop gets the same two
 * passes as the first).
 *
 * Fails on revert: ThemeAccentFill always rendering solid, or the second stop
 * skipping the white-text pass.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("expo-linear-gradient", () => {
  const R = jest.requireActual<typeof import("react")>("react");
  return {
    LinearGradient: (props: Record<string, unknown>) =>
      R.createElement("LinearGradient", props, props.children as React.ReactNode),
  };
});

// eslint-disable-next-line import/first
import {
  ThemeAccentFill,
  ThemeAccentGradientLayer,
} from "../../../../../packages/offering-rendering/ThemeAccentFill";
// eslint-disable-next-line import/first
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
// eslint-disable-next-line import/first
import {
  contrastRatio,
  createThemePalette,
} from "../../../../../packages/offering-rendering/themePalette";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
  act: (cb: () => void) => void;
};

const render = (el: React.ReactElement) => {
  let tree: ReturnType<typeof TestRenderer.create> | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(el);
  });
  return tree!;
};

describe("ThemeAccentFill", () => {
  test("a solid theme is a View filled with palette.accent", () => {
    const theme = resolveTheme({ color: "#ff5a5f" }, null);
    const palette = createThemePalette(theme);
    const tree = render(<ThemeAccentFill theme={theme} palette={palette} testID="fill" />);
    expect(tree.root.findAll((n) => n.type === "LinearGradient")).toHaveLength(0);
    const views = tree.root.findAll((n) => n.type === "View" && n.props.testID === "fill");
    expect(views).toHaveLength(1);
    expect(JSON.stringify(views[0].props.style)).toContain(palette.accent);
  });

  test("a gradient theme is a 135° gradient with both stops white-label safe", () => {
    const theme = resolveTheme({ color: "#e8508f", color2: "#7c5cff" }, null);
    const palette = createThemePalette(theme);
    const tree = render(<ThemeAccentFill theme={theme} palette={palette} testID="fill" />);
    const [gradient] = tree.root.findAll((n) => n.type === "LinearGradient");
    expect(gradient.props.start).toEqual({ x: 0, y: 0 });
    expect(gradient.props.end).toEqual({ x: 1, y: 1 });
    const colors = gradient.props.colors as [string, string];
    expect(colors[0]).toBe(palette.accent);
    for (const stop of colors) expect(contrastRatio(stop, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  test("extreme stops still give white labels the solid path's guarantee", () => {
    const theme = resolveTheme({ color: "#ffff00", color2: "#00ffff" }, null);
    const palette = createThemePalette(theme);
    const tree = render(<ThemeAccentFill theme={theme} palette={palette} />);
    const [gradient] = tree.root.findAll((n) => n.type === "LinearGradient");
    const [a, b] = gradient.props.colors as [string, string];
    expect(contrastRatio(b, "#ffffff")).toBeGreaterThanOrEqual(contrastRatio(a, "#ffffff") - 0.5);
  });
});

describe("ThemeAccentGradientLayer", () => {
  test("renders nothing for a solid theme, so a solid button is unchanged", () => {
    const theme = resolveTheme({ color: "#ff5a5f" }, null);
    const tree = render(
      <ThemeAccentGradientLayer theme={theme} palette={createThemePalette(theme)} borderRadius={12} />,
    );
    expect(tree.root.findAll((n) => n.type === "LinearGradient")).toHaveLength(0);
  });

  test("renders an untouchable gradient layer that follows the host's corners", () => {
    const theme = resolveTheme({ color: "#2da8ff", color2: "#14e0b0" }, null);
    const tree = render(
      <ThemeAccentGradientLayer theme={theme} palette={createThemePalette(theme)} borderRadius={12} />,
    );
    const [layer] = tree.root.findAll((n) => n.type === "LinearGradient");
    expect(layer.props.pointerEvents).toBe("none");
    expect(JSON.stringify(layer.props.style)).toContain('"borderRadius":12');
  });
});
