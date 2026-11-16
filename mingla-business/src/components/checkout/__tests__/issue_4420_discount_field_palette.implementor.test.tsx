/**
 * issue #4420 wave 2 (D-C3) — DiscountCodeField takes an optional host
 * palette, COLOURS ONLY.
 *
 *   D-1 without `palette` the field renders exactly as before (same input
 *       and Apply styles as the #4304 dark field);
 *   D-2 with `palette` the input sits on the page card with the neutral
 *       control border, and Apply is tonal (wash fill, ink label) — never the
 *       Mingla surface colour or a gradient.
 *
 * Fails-on-revert: ignoring the prop fails D-2; applying it when absent
 * fails D-1.
 */
import React from "react";
import { Pressable, Text, TextInput, StyleSheet } from "react-native";
import {
  createThemePalette,
  neutralControl,
} from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

import { DiscountCodeField } from "../DiscountCodeField";
import { color } from "../../../constants/designSystem";

jest.mock("../../../analytics/discountAnalytics", () => ({
  captureDiscountEvent: jest.fn(),
}));

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: {
      findByType: (type: unknown) => { props: Record<string, unknown> };
      findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => Array<{
        type: unknown;
        props: Record<string, unknown>;
      }>;
    };
    unmount: () => void;
  };
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(
    (typeof style === "function" ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style) as never,
  ) ?? {}) as Record<string, unknown>;

const light = createThemePalette({
  ...resolveTheme(null, null),
  color: "#1e3a8a",
  foregroundColor: "#ffffff",
});

const mount = async (palette?: typeof light) => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <DiscountCodeField
        value={null}
        quote={null}
        quoteStatus="idle"
        onApply={() => undefined}
        onRemove={() => undefined}
        palette={palette}
      />,
    );
  });
  const input = flat(tree.root.findByType(TextInput).props.style);
  const apply = tree.root
    .findAll((n) => n.type === Pressable && n.props.accessibilityLabel === "Apply discount code")[0];
  const applyStyle = flat(apply?.props.style);
  const applyLabel = tree.root
    .findAll((n) => n.type === Text && n.props.children === "Apply")[0];
  return { tree, input, applyStyle, applyLabel: flat(applyLabel?.props.style) };
};

describe("issue #4420 — DiscountCodeField palette (colours only)", () => {
  test("D-1 no palette: the #4304 dark field, unchanged", async () => {
    const { tree, input, applyStyle } = await mount();
    expect(input.backgroundColor).toBe(color.card);
    expect(input.borderColor).toBe(color.lineStrong);
    expect(applyStyle.backgroundColor).toBe(color.accent);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("D-2 a palette: page card, neutral border, tonal Apply", async () => {
    const { tree, input, applyStyle, applyLabel } = await mount(light);
    expect(input.backgroundColor).toBe(light.card);
    expect(input.borderColor).toBe(neutralControl(light));
    expect(input.color).toBe(light.primaryText);
    expect(input.backgroundColor).not.toBe(color.card);
    expect(applyStyle.backgroundColor).toBe(light.accentWash);
    expect(applyLabel.color).toBe(light.primaryText);
    // Geometry is untouched: the palette is colours only.
    const base = await mount();
    expect(input.minHeight).toBe(base.input.minHeight);
    expect(input.borderRadius).toBe(base.input.borderRadius);
    await TestRenderer.act(async () => {
      tree.unmount();
      base.tree.unmount();
    });
  });
});
