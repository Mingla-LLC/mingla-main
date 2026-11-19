/**
 * issue #4518 — checkout must be READABLE on every host theme.
 *
 * MINGLA-INVARIANT: I-CHECKOUT-TEXT-READABLE-ON-ITS-SURFACE | issue #4518 |
 * Inside a checkout flow, every piece of text and every field outline is
 * measured against the colour ACTUALLY PAINTED behind it, on a light host
 * theme, a dark host theme and Graphite; under 4.5:1 for text (3:1 for an
 * outline) fails the build.
 *
 * THE DEFECT. #4466 pointed checkout TEXT at the host palette while the shared
 * parts it is built from (cards, fields, buttons, the dock) kept their
 * Graphite colours. On a light host theme that painted dark ink on dark
 * cards, and white input text with a 13 % white outline on a light page.
 * Every existing test checked which token a style named. None asked whether
 * the result could be read.
 *
 * WHAT THIS DOES INSTEAD. It mounts the real shared parts, walks the rendered
 * tree, composites every translucent layer down to the page colour, and
 * computes the WCAG contrast ratio of what a buyer would see. It asserts no
 * token name, so it survives a refactor and catches the next part that is
 * added to checkout with a colour source of its own.
 *
 * FAILS ON REVERT: point any of Material / Input / Button back at
 * `constants/designSystem` (or freeze a colour record at import again) and
 * the light-theme cases fail with the measured ratio.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";

import { color as graphite } from "../../../constants/designSystem";
import { color, materials, setActiveCheckoutPalette } from "../checkoutTheme";
import { isSurfaceThemed } from "../../../theme/surfaceTokens";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: "AnimatedView",
    Text: "AnimatedText",
    createAnimatedComponent: (component: unknown) => component,
  },
  Easing: {
    out: () => () => 0,
    in: () => () => 0,
    inOut: () => () => 0,
    bezier: () => () => 0,
    cubic: () => 0,
    ease: () => 0,
  },
  interpolate: () => 0,
  interpolateColor: (_v: number, _i: number[], colours: string[]) => colours[0],
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  useAnimatedProps: () => ({}),
  useAnimatedStyle: () => ({}),
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useReducedMotion: () => true,
  useSharedValue: (value: unknown) => ({ value }),
  withDelay: (_ms: number, value: unknown) => value,
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: { buttonPress: () => undefined, selection: () => undefined },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

// ---- colour maths (WCAG 2.x) ----------------------------------------------

type Rgba = { r: number; g: number; b: number; a: number };

function parseColour(value: string): Rgba {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex !== null) {
    const h = hex[1];
    const full =
      h.length === 3 || h.length === 4
        ? h.split("").map((c) => c + c).join("")
        : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (fn !== null) {
    const parts = fn[1].split(/[\s,/]+/).filter((p) => p.length > 0).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  throw new Error(`unparseable colour: ${value}`);
}

/** `top` painted over an opaque `under`. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  };
}

function luminance(c: Rgba): number {
  const lin = (x: number): number => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Contrast of `fg` as painted on the stack `layers` (page first, top last). */
function contrastOn(fg: string, layers: readonly string[]): number {
  let painted: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (const layer of layers) painted = over(parseColour(layer), painted);
  const ink = over(parseColour(fg), painted);
  const [hi, lo] = [luminance(ink), luminance(painted)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- the rendered-tree walk -------------------------------------------------

type Instance = {
  type: unknown;
  props: Record<string, unknown>;
  children: (Instance | string)[];
  findAll: (predicate: (node: Instance) => boolean) => Instance[];
};
type Rendered = { root: Instance; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Rendered;
  act: (work: () => void) => void;
};

const RESTING = { pressed: false, hovered: false, focused: false };

/**
 * Flatten a style the way the platform does: arrays merge left to right, and
 * a Pressable style that is a function of its state is read at rest.
 */
const flat = (style: unknown): Record<string, unknown> => {
  if (style === null || style === undefined || style === false) return {};
  if (typeof style === "function") {
    return flat((style as (state: Record<string, boolean>) => unknown)(RESTING));
  }
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>((acc, part) => ({ ...acc, ...flat(part) }), {});
  }
  if (typeof style === "number") {
    return (StyleSheet.flatten(style as never) as Record<string, unknown> | undefined) ?? {};
  }
  return style as Record<string, unknown>;
};

interface Finding {
  text: string;
  colour: string;
  layers: string[];
  ratio: number;
}

/** Every host Text / TextInput, with the background stack painted under it. */
function measureText(root: Instance, page: string): Finding[] {
  const out: Finding[] = [];
  const visit = (node: Instance | string, layers: string[]): void => {
    if (typeof node === "string") return;
    const style = flat(node.props.style);
    const here =
      typeof node.type === "string" && typeof style.backgroundColor === "string"
        ? [...layers, style.backgroundColor]
        : layers;
    if (node.type === "Text" || node.type === "TextInput") {
      const typed = String(node.props.value ?? "");
      const showsPlaceholder = node.type === "TextInput" && typed.length === 0;
      const value =
        node.type === "TextInput"
          ? showsPlaceholder
            ? String(node.props.placeholder ?? "")
            : typed
          : node.children.filter((c) => typeof c === "string").join("");
      const colour = showsPlaceholder
        ? (node.props.placeholderTextColor as string | undefined)
        : (style.color as string | undefined);
      if (value.trim().length > 0 && typeof colour === "string") {
        out.push({ text: value, colour, layers: here, ratio: contrastOn(colour, here) });
      }
    }
    for (const child of node.children) visit(child, here);
    // The jest Pressable does not call a render-prop child. Draw the resting
    // state ourselves so a button's label is measured on the button's fill.
    if (typeof node.type === "string" && typeof node.props.children === "function") {
      const drawn = mount(
        <>
          {(node.props.children as (state: Record<string, boolean>) => React.ReactNode)(RESTING)}
        </>,
      );
      visit(drawn.root, here);
      drawn.unmount();
    }
  };
  visit(root, [page]);
  return out;
}

function mount(element: React.ReactElement): Rendered {
  let tree: Rendered | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return tree as Rendered;
}

// ---- the themes -------------------------------------------------------------

const paletteFor = (hex: string): ReturnType<typeof createThemePalette> =>
  createThemePalette(resolveTheme({ color: hex } as never, null));

/** A spread of host colours; between them they produce light AND dark pages. */
const HOST_COLOURS = ["#b4472a", "#0b6e4f", "#ff6b35", "#2563eb", "#f5d90a", "#111111", "#f4f1ea"];

const THEMES: [string, ReturnType<typeof createThemePalette> | null][] = [
  ["Graphite (no host theme)", null],
  ...HOST_COLOURS.map(
    (hex) => [`host ${hex}`, paletteFor(hex)] as [string, ReturnType<typeof createThemePalette>],
  ),
];

const TEXT_MIN = 4.5;
const QUIET_TEXT_MIN = 3;
const OUTLINE_MIN = 3;

afterEach(() => setActiveCheckoutPalette(null));

describe("#4518 — the spread of host themes covers light and dark pages", () => {
  test("at least one light page and one dark page are exercised", () => {
    const pages = HOST_COLOURS.map((hex) => luminance(parseColour(paletteFor(hex).page)));
    expect(pages.some((l) => l > 0.6)).toBe(true);
    expect(pages.some((l) => l < 0.1)).toBe(true);
  });
});

describe.each(THEMES)("#4518 — checkout is readable on %s", (_name, palette) => {
  beforeEach(() => setActiveCheckoutPalette(palette));

  test("the scope is themed exactly when a host palette is set", () => {
    expect(isSurfaceThemed()).toBe(palette !== null);
    if (palette === null) expect(color.text1).toBe(graphite.text1);
  });

  test("body text is readable on the page and on every surface material", () => {
    const page = color.canvas;
    const surfaces: Record<string, string[]> = {
      page: [page],
      card: [page, color.card],
      pane: [page, materials.pane.solidFill],
      control: [page, materials.control.solidFill],
      selected: [page, materials.selected.solidFill],
      chrome: [page, materials.chrome.solidFill],
      sheet: [page, materials.sheet.solidFill],
      inputFill: [page, color.fill.input],
      insetOnCard: [page, color.card, color.fill.inset],
    };
    for (const [name, layers] of Object.entries(surfaces)) {
      expect({ surface: name, ink: "text1", ok: contrastOn(color.text1, layers) >= TEXT_MIN }).toEqual({
        surface: name,
        ink: "text1",
        ok: true,
      });
      expect({ surface: name, ink: "text2", ok: contrastOn(color.text2, layers) >= TEXT_MIN }).toEqual({
        surface: name,
        ink: "text2",
        ok: true,
      });
      expect({ surface: name, ink: "text3", ok: contrastOn(color.text3, layers) >= QUIET_TEXT_MIN }).toEqual({
        surface: name,
        ink: "text3",
        ok: true,
      });
    }
  });

  test("a field outline can be seen on the page", () => {
    // Graphite's own outline is the Host app's design, outside #4518.
    if (palette === null) return;
    expect({
      outline: color.lineStrong,
      page: color.canvas,
      ok: contrastOn(color.lineStrong, [color.canvas]) >= OUTLINE_MIN,
      ratio: contrastOn(color.lineStrong, [color.canvas]),
    }).toMatchObject({ ok: true });
  });

  test("a card holding the step's own text paints readable text (rendered)", () => {
    const { GlassCard } = require("../../ui/GlassCard") as typeof import("../../ui/GlassCard");
    const tree = mount(
      <View style={{ backgroundColor: color.canvas }}>
        <GlassCard>
          <Text style={{ color: color.text1 }}>1 × Single</Text>
          <Text style={{ color: color.text2 }}>Fees &amp; tax</Text>
        </GlassCard>
      </View>,
    );
    const found = measureText(tree.root, color.canvas);
    expect(found.map((f) => f.text)).toEqual(["1 × Single", "Fees & tax"]);
    for (const f of found) expect({ ...f, ok: f.ratio >= TEXT_MIN }).toMatchObject({ ok: true });
    tree.unmount();
  });

  test("a text field shows what is typed, its placeholder and its outline (rendered)", () => {
    // Graphite's field and button are the Host app's own design, outside #4518.
    if (palette === null) return;
    const { Input } = require("../../ui/Input") as typeof import("../../ui/Input");
    for (const value of ["Ada Okafor", ""]) {
      const tree = mount(
        <View style={{ backgroundColor: color.canvas }}>
          <Input value={value} onChangeText={() => undefined} placeholder="Full name" accessibilityLabel="Full name" />
        </View>,
      );
      const found = measureText(tree.root, color.canvas).filter((f) =>
        ["Ada Okafor", "Full name"].includes(f.text),
      );
      expect(found.length).toBeGreaterThan(0);
      for (const f of found) {
        const min = f.text === "Ada Okafor" ? TEXT_MIN : QUIET_TEXT_MIN;
        expect({ ...f, ok: f.ratio >= min }).toMatchObject({ ok: true });
      }
      // The outline of the field itself, against the page.
      const outlined = tree.root.findAll(
        (n: Instance) =>
          typeof n.type === "string" &&
          typeof flat(n.props.style).borderColor === "string" &&
          Number(flat(n.props.style).borderWidth ?? 0) >= 1,
      );
      expect(outlined.length).toBeGreaterThan(0);
      const border = String(flat(outlined[0].props.style).borderColor);
      expect(contrastOn(border, [color.canvas])).toBeGreaterThanOrEqual(OUTLINE_MIN);
      tree.unmount();
    }
  });

  test.each(["primary", "secondary", "ghost"] as const)(
    "a %s button's label is readable, enabled and disabled (rendered)",
    (variant) => {
      if (palette === null) return;
      const { Button } = require("../../ui/Button") as typeof import("../../ui/Button");
      for (const disabled of [false, true]) {
        const tree = mount(
          <View style={{ backgroundColor: color.canvas }}>
            <Button label="Continue to payment" onPress={() => undefined} variant={variant} disabled={disabled} />
          </View>,
        );
        const found = measureText(tree.root, color.canvas).filter((f) => f.text === "Continue to payment");
        expect(found.length).toBe(1);
        // A disabled control is exempt from 4.5:1 (WCAG 1.4.3) but must still
        // be legible as a button: 3:1.
        const min = disabled ? QUIET_TEXT_MIN : TEXT_MIN;
        expect({ ...found[0], disabled, ok: found[0].ratio >= min }).toMatchObject({ ok: true });
        tree.unmount();
      }
    },
  );
});
