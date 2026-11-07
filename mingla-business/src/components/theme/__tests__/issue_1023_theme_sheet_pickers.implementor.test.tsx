/**
 * issue #1023 wave 2 — P-5. The REAL ThemeSheet mounted with
 * react-test-renderer (react-native -> manual mock; only native leaves are
 * mocked). Pins the new Colour and Font tabs:
 *
 *   - Berry saves both stops in ONE patch; Coral afterwards saves no color2.
 *   - The old plane, numeric mode and recents are gone; the 12 design
 *     solids and 6 gradients replace the old presets (D-3), and a colour
 *     saved from an old preset reads as Custom.
 *   - Custom: switching to Gradient seeds a second colour; Solid clears it.
 *   - Venues get solids only (D-4).
 *   - Font tab: Popular first (30 + pinned), search ranks prefix matches
 *     first, the Mono chip lists only mono families, Inter saves `inter` and
 *     Roboto Slab saves `Roboto Slab`.
 *   - The preview CTA carries the gradient layer.
 *
 * Fails on revert: a colour commit that drops color2 or sends it in a second
 * patch, the old preset strip, gradients showing at a venue, a font row that
 * saves the family for a bundled font, or a non-Popular initial chip.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/Sheet", () => {
  const ReactActual = require("react");
  return {
    Sheet: ({ visible, children }: { visible: boolean; children?: unknown }) =>
      visible ? ReactActual.createElement("MockSheet", null, children) : null,
  };
});
jest.mock("../../ui/Button", () => {
  const ReactActual = require("react");
  return { Button: (props: Record<string, unknown>) => ReactActual.createElement("MockButton", props) };
});
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/WebSafeGestureDetector", () => ({
  WebSafeGestureDetector: ({ children }: { children?: unknown }) => children ?? null,
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactActual = require("react");
  return {
    ScrollView: ({ children }: { children?: unknown }) =>
      ReactActual.createElement("MockScroll", null, children),
  };
});
jest.mock("react-native-gesture-handler", () => {
  const make = (): Record<string, unknown> => {
    const g: Record<string, unknown> = new Proxy({}, { get: () => () => g });
    return g;
  };
  return { Gesture: { Pan: make } };
});
jest.mock("expo-linear-gradient", () => {
  const ReactActual = require("react");
  return {
    LinearGradient: (props: Record<string, unknown>) =>
      ReactActual.createElement("LinearGradient", props),
  };
});
jest.mock("../../../theme/useThemeFont", () => ({
  useThemeFont: () => ({ loaded: true }),
}));

// eslint-disable-next-line import/first
import type { ThemeInput } from "@mingla/offering-rendering";
// eslint-disable-next-line import/first
import { ThemeSheet, type ThemeSheetProps } from "../ThemeSheet";
// eslint-disable-next-line import/first
import { GRADIENT_SWATCHES, SOLID_SWATCHES, THEME_PRESETS } from "../themePresets";
// eslint-disable-next-line import/first
import { seedSecondColour } from "../themeColorModel";
// eslint-disable-next-line import/first
import type { FontRow } from "../fontCatalogModel";

type HostNode = { type: unknown; props: Record<string, unknown>; children: Array<HostNode | string> };
type Tree = { root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] }; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};
const act = TestRenderer.act;

const mount = async (props: Partial<ThemeSheetProps>): Promise<Tree> => {
  let tree: Tree | undefined;
  await act(() => {
    tree = TestRenderer.create(
      <ThemeSheet visible onClose={() => undefined} value={null} onChange={() => undefined} scope="offering" {...props} />,
    );
  });
  return tree as Tree;
};

const byLabel = (tree: Tree, label: string): HostNode[] =>
  tree.root.findAll((n) => n.type === "Pressable" && n.props.accessibilityLabel === label);

const press = async (node: HostNode): Promise<void> => {
  await act(() => (node.props.onPress as () => void)());
};

const BRAND: ThemeInput = { color: "#2da8ff", font: "inter", animation: null };

describe("Colour tab — swatches and gradients, one patch each", () => {
  test("Berry saves both stops in one patch; Coral afterwards saves a solid", async () => {
    const onChange = jest.fn<(next: ThemeInput | null) => void>();
    const tree = await mount({ brandTheme: BRAND, onChange });
    await press(byLabel(tree, "Berry gradient")[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ color: "#e8508f", color2: "#7c5cff", font: null, animation: null });

    await act(() => tree.unmount());
    const after = await mount({
      brandTheme: BRAND,
      value: { color: "#e8508f", color2: "#7c5cff", font: "Roboto Slab", animation: null },
      onChange,
    });
    expect(byLabel(after, "Berry gradient")[0].props.accessibilityState).toEqual({ selected: true, checked: true });
    expect(byLabel(after, "Rose")[0].props.accessibilityState).toEqual({ selected: false, checked: false });
    await press(byLabel(after, "Coral")[0]);
    expect(onChange).toHaveBeenLastCalledWith({ color: "#ff5a5f", font: "Roboto Slab", animation: null });
    await act(() => after.unmount());
  });

  test("the plane, numeric mode and recents are gone; the design's 12 + 6 are shown", async () => {
    const tree = await mount({ brandTheme: BRAND });
    expect(byLabel(tree, "Switch to numeric colour entry")).toHaveLength(0);
    expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && (n.props.accessibilityLabel as string).startsWith("Recent"))).toHaveLength(0);
    for (const s of SOLID_SWATCHES) expect(byLabel(tree, s.name)).toHaveLength(1);
    for (const g of GRADIENT_SWATCHES) expect(byLabel(tree, `${g.name} gradient`)).toHaveLength(1);
    expect(byLabel(tree, "Brand colours")).toHaveLength(1);
    await act(() => tree.unmount());
  });

  test("a colour saved from an old preset reads as Custom, with nothing ticked", async () => {
    const tree = await mount({ brandTheme: BRAND, value: { color: "#2563eb", font: null, animation: null } });
    const selected = tree.root.findAll(
      (n) =>
        n.type === "Pressable" &&
        (n.props.accessibilityState as { selected?: boolean } | undefined)?.selected === true &&
        typeof n.props.testID === "string" &&
        /^theme-(swatch|gradient)-/.test(n.props.testID as string),
    );
    expect(selected).toHaveLength(0);
    expect(tree.root.findAll((n) => n.props.testID === "theme-colour-custom").length).toBeGreaterThan(0);
    await act(() => tree.unmount());
  });

  test("Custom: Gradient seeds a second colour 320° on; Solid clears it", async () => {
    const onChange = jest.fn<(next: ThemeInput | null) => void>();
    const tree = await mount({ brandTheme: BRAND, value: { color: "#4f6bff", font: null, animation: null }, onChange });
    await press(byLabel(tree, "Custom colour")[0]);
    await press(byLabel(tree, "Gradient")[0]);
    expect(onChange).toHaveBeenLastCalledWith({ color: "#4f6bff", color2: seedSecondColour("#4f6bff"), font: null, animation: null });
    await act(() => tree.unmount());

    // A custom gradient opens with Custom already expanded.
    const grad = await mount({ brandTheme: BRAND, value: { color: "#4f6bff", color2: "#ff2e63", font: null, animation: null }, onChange });
    expect(grad.root.findAll((n) => n.props.testID === "theme-colour-custom").length).toBeGreaterThan(0);
    await press(byLabel(grad, "Solid")[0]);
    expect(onChange).toHaveBeenLastCalledWith({ color: "#4f6bff", font: null, animation: null });
    await act(() => grad.unmount());
  });

  test("a venue gets solids only (D-4)", async () => {
    const tree = await mount({ brandTheme: BRAND, scope: "venue" });
    for (const g of GRADIENT_SWATCHES) expect(byLabel(tree, `${g.name} gradient`)).toHaveLength(0);
    await press(byLabel(tree, "Custom colour")[0]);
    expect(byLabel(tree, "Gradient")).toHaveLength(0);
    await act(() => tree.unmount());
  });

  test("the sheet preview CTA paints the gradient", async () => {
    const tree = await mount({ brandTheme: BRAND, value: { color: "#e8508f", color2: "#7c5cff", font: null, animation: null }, testID: "sheet" });
    expect(tree.root.findAll((n) => n.type === "LinearGradient" && n.props.testID === "sheet-preview-gradient")).toHaveLength(1);
    await act(() => tree.unmount());
    const solid = await mount({ brandTheme: BRAND, value: { color: "#ff5a5f", font: null, animation: null }, testID: "sheet" });
    expect(solid.root.findAll((n) => n.type === "LinearGradient" && n.props.testID === "sheet-preview-gradient")).toHaveLength(0);
    await act(() => solid.unmount());
  });

  test("D-3: the strip is the design's 12 solids (THEME_PRESETS is that strip)", () => {
    expect(THEME_PRESETS.map((s) => s.hex)).toEqual([
      "#eb7825", "#ff5a5f", "#e8508f", "#c25cf0", "#7c5cff", "#4f6bff",
      "#2da8ff", "#14b8a6", "#22c55e", "#a3e635", "#f5b700", "#d9a066",
    ]);
    expect(GRADIENT_SWATCHES.map((g) => `${g.name}:${g.hex},${g.hex2}`)).toEqual([
      "Sunset:#ff8a3b,#ff2e63", "Berry:#e8508f,#7c5cff", "Ocean:#2da8ff,#14e0b0",
      "Citrus:#f5b700,#ff5a1f", "Neon:#c25cf0,#2dd4ff", "Lagoon:#22c55e,#2da8ff",
    ]);
  });
});

const openFontTab = async (tree: Tree): Promise<void> => {
  await press(byLabel(tree, "Font")[0]);
  // Let the lazy catalogue import resolve.
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const fontList = (tree: Tree): HostNode => {
  const lists = tree.root.findAll((n) => n.props.testID === "theme-font-list" && Array.isArray(n.props.data));
  expect(lists.length).toBeGreaterThan(0);
  return lists[0];
};
const rowsOf = (list: HostNode): FontRow[] => list.props.data as FontRow[];
const pressRow = (list: HostNode, family: string): void => {
  const row = rowsOf(list).find((r) => r.family === family);
  expect(row).toBeDefined();
  const el = (list.props.renderItem as (a: { item: FontRow }) => React.ReactElement)({ item: row as FontRow });
  (el.props as { onPress: () => void }).onPress();
};

describe("Font tab — every Google family", () => {
  test("opens on Popular: the top 30, then the 14 bundled families pinned", async () => {
    const tree = await mount({ brandTheme: BRAND });
    await openFontTab(tree);
    const popular = tree.root.findAll((n) => n.props.testID === "theme-font-chip-popular")[0];
    expect(popular.props.accessibilityState).toEqual({ selected: true });
    const rows = rowsOf(fontList(tree));
    expect(rows.slice(0, 30).every((r) => r.rank < 30)).toBe(true);
    for (const family of ["Bebas Neue", "Dancing Script", "Unbounded"]) {
      expect(rows.map((r) => r.family)).toContain(family);
    }
    const search = tree.root.findAll((n) => n.props.testID === "theme-font-search" && typeof n.props.placeholder === "string")[0];
    expect(search.props.placeholder).toBe("Search 1,626 fonts");
    await act(() => tree.unmount());
  });

  test("search ranks prefix matches first; the Mono chip lists only mono families", async () => {
    const tree = await mount({ brandTheme: BRAND });
    await openFontTab(tree);
    const search = tree.root.findAll((n) => n.props.testID === "theme-font-search" && typeof n.props.onChangeText === "function")[0];
    await act(() => (search.props.onChangeText as (q: string) => void)("slab"));
    const hits = rowsOf(fontList(tree)).map((r) => r.family);
    expect(hits.slice(0, 10)).toContain("Roboto Slab");
    expect(hits.every((f) => f.toLowerCase().includes("slab"))).toBe(true);
    await act(() => (search.props.onChangeText as (q: string) => void)(""));
    await press(tree.root.findAll((n) => n.props.testID === "theme-font-chip-m" && typeof n.props.onPress === "function")[0]);
    const mono = rowsOf(fontList(tree));
    expect(mono.length).toBeGreaterThan(20);
    expect(mono.every((r) => r.category === "m")).toBe(true);
    await act(() => tree.unmount());
  });

  test("Inter saves `inter`; Roboto Slab saves `Roboto Slab`", async () => {
    const onChange = jest.fn<(next: ThemeInput | null) => void>();
    const tree = await mount({ brandTheme: BRAND, onChange });
    await openFontTab(tree);
    await act(() => pressRow(fontList(tree), "Inter"));
    expect(onChange).toHaveBeenLastCalledWith({ color: null, font: "inter", animation: null });
    await act(() => pressRow(fontList(tree), "Roboto"));
    expect(onChange).toHaveBeenLastCalledWith({ color: null, font: "Roboto", animation: null });
    const search = tree.root.findAll((n) => n.props.testID === "theme-font-search" && typeof n.props.onChangeText === "function")[0];
    await act(() => (search.props.onChangeText as (q: string) => void)("Roboto Slab"));
    await act(() => pressRow(fontList(tree), "Roboto Slab"));
    expect(onChange).toHaveBeenLastCalledWith({ color: null, font: "Roboto Slab", animation: null });
    await act(() => tree.unmount());
  });

  test("a saved Google family is ticked and pinned on Popular", async () => {
    const tree = await mount({ brandTheme: BRAND, value: { color: null, font: "Zilla Slab", animation: null } });
    await openFontTab(tree);
    const list = fontList(tree);
    const row = rowsOf(list).find((r) => r.family === "Zilla Slab") as FontRow;
    expect(row).toBeDefined();
    const el = (list.props.renderItem as (a: { item: FontRow }) => React.ReactElement)({ item: row });
    expect((el.props as { accessibilityState: unknown }).accessibilityState).toEqual({ selected: true, checked: true });
    await act(() => tree.unmount());
  });
});
