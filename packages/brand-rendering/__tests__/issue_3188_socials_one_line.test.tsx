/**
 * Issue #3188 [brand-page social icons wrap onto a second line] — IMPLEMENTOR
 * RENDER proof. SPEC §7.2, covering T-10 and T-11.
 *
 * The sibling suite
 * (`mingla-business/src/components/brand/__tests__/issue_3188_social_row_sizing.test.ts`)
 * proves the ARITHMETIC. This file attacks the other half: the REAL
 * `PublicBrandPage`, really mounted through react-native-web — the resolver
 * that actually ships on buyer web (the #1484 P1-1 lesson) — with its
 * `onLayout` fired at the real container widths, then read back from the
 * RESOLVED styles and the EMITTED DOM the way a browser reads them. A suite
 * that only checks `solveSocialRow`'s return value would pass in full while the
 * component ignored it.
 *
 * WHAT IS PROVEN HERE, AND WHY EACH LEG EXISTS
 *   R-1  the REPORTED container. Desktop viewport (>=1024) renders the socials
 *        row ONLY inside the sticky panel — the exact place Seth screenshotted.
 *        Fire onLayout at its measured 318pt and every one of the 8 chips
 *        resolves to 31x31 with gap 10. 8*31 + 7*10 = 318 <= 318.
 *   R-2  the row's own resolved style is `flexWrap: "nowrap"` and each chip is
 *        `flexShrink: 1` + `minWidth: 0`, so a SECOND LINE IS NOT EXPRESSIBLE —
 *        that is the structural guarantee behind the arithmetic, and it holds
 *        even if the measurement never arrives.
 *   R-3  the NARROW phone container (278pt = a 320pt device) — this bug was
 *        never desktop-only; today's row wraps there at SIX entries. Gap
 *        reclaim takes it to 31pt at a 4pt gap: 8*31 + 7*4 = 276 <= 278.
 *   R-4  the EMITTED DOM box is the web tap target. `hitSlop` is a proven
 *        no-op on RNW (investigation F-5), so this asserts on the real emitted
 *        element: its inline width/height, ZERO padding, ZERO margin, and NO
 *        hitSlop geometry anywhere in the markup. The measured box must clear
 *        the WCAG 2.2 AA SC 2.5.8 24x24 CSS px minimum by itself.
 *   R-5  the emitted CSS RULE — not the style object — says `flex-wrap:nowrap`
 *        and `flex-shrink:1`. This is what the browser's layout engine is
 *        actually handed. A style object that never reached the stylesheet
 *        would pass R-2 and still wrap in a browser.
 *   R-6  T-11 NO REGRESSION at 3 links: 44pt chips, glyph 21, stroke 2.2, zero
 *        hitSlop — byte-identical to today. Every brand in production has at
 *        most one link, so a regression here is the only way this change can
 *        hurt anyone who is fine today.
 *   R-7  the unmeasured first frame (onLayout never fires) is still ONE LINE
 *        and still >= the 24pt floor — an `onLayout` that never fires must not
 *        be able to clip or hide the row.
 *
 * VACUITY GUARDS — every geometry assertion is preceded by a count assertion
 * (exactly 8 / exactly 3 chips). A tree walk that matched nothing would
 * otherwise report success, which is the #1484 silent-pass class.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE DELETION, not comment-out; hashes in
 * the #3188 implementation report): deleting `flexWrap: "nowrap"` from
 * `styles.socialsRow` reds R-2 and R-5; restoring `width: 44, height: 44` on
 * `styles.socialBtn` reds R-1, R-3, R-4 and R-7; deleting the `size`/
 * `strokeWidth` forwarding on `SocialIcon` reds R-1's glyph leg and R-6.
 *
 * MOCK BOUNDARY (declared, minimal): the mocks below stub MODULE-LOAD-ONLY
 * native deps that explode in a node-env harness (lucide icon set →
 * react-native-svg native codegen, expo-video/-haptics/-blur/-constants native
 * module lookups, lottie). None is under test and none sits between the socials
 * row and the DOM. `PublicBrandPage`, `socialRowSizing`, react-native-web and
 * the palette engine are ALL REAL — in particular the icon mock forwards
 * `size`/`strokeWidth` verbatim so the glyph assertions read the real values.
 *
 * Run: cd mingla-business && npx jest --config jest.issue679.cfg.cjs --runInBand
 */

jest.mock("lucide-react-native", () => {
  const mockReact = require("react");
  const icon = (name: string) => {
    const MockIcon = (props: Record<string, unknown>) =>
      mockReact.createElement("mock-icon", { "data-icon": name, ...props });
    MockIcon.displayName = name;
    return MockIcon;
  };
  return new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        prop === "__esModule" ? true : icon(prop),
    },
  );
});

jest.mock("expo-video", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    VideoView: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-video", props),
    useVideoPlayer: () => ({
      play: () => undefined,
      pause: () => undefined,
      replace: () => undefined,
      release: () => undefined,
      muted: true,
      loop: true,
    }),
  };
});

jest.mock("react-native-svg", () => {
  const mockReact = require("react");
  const el =
    (name: string) =>
    (props: Record<string, unknown>) =>
      mockReact.createElement(`mock-svg-${name.toLowerCase()}`, props);
  return new Proxy(
    { __esModule: true, default: el("Svg") },
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop in target ? target[prop] : el(prop),
    },
  );
});

jest.mock("lottie-react-native", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-lottie", props),
  };
});

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: null, manifest2: null },
}));

jest.mock(
  "../../../mingla-business/node_modules/expo-modules-core/src/polyfill",
  () =>
    jest.requireActual(
      "../../../mingla-business/node_modules/expo-modules-core/src/polyfill/index.web",
    ),
);

jest.mock("expo-haptics", () => ({
  __esModule: true,
  impactAsync: async () => undefined,
  notificationAsync: async () => undefined,
  selectionAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

jest.mock("expo-blur", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    BlurView: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-blur", props),
  };
});

import React from "react";
import { Dimensions, StyleSheet } from "react-native";

import { PublicBrandPage } from "../PublicBrandPage";
import {
  SOCIAL_CHIP_D_MAX,
  SOCIAL_CHIP_D_MIN,
} from "../socialRowSizing";
import type { PublicBrandLinks, PublicBrandPageProps } from "../types";

// Typed-require idiom (react-dom/server + react-test-renderer ship no types in
// this workspace) — same form as the #679 / #1503 / #1563 render suites.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};
type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: unknown) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A full PublicBrandPage mount through react-native-web takes ~10-40s on a
// contended runner; jest's 5s default is not a real signal here, and this
// config (unlike mingla-business/jest.config.cjs, see its #2178 note) sets no
// testTimeout of its own.
jest.setTimeout(120000);

// ---------------------------------------------------------------------------
// fixtures — production has NO brand with more than one social link (and the
// prod DB was test-wiped), so the 8-link case cannot be found, only built.
// ---------------------------------------------------------------------------

/** All EIGHT SocialKind members — the true maximum this renderer can reach. */
const ALL_EIGHT_LINKS: PublicBrandLinks = {
  website: "https://neon.example",
  instagram: "https://instagram.com/neon",
  tiktok: "https://tiktok.com/@neon",
  x: "https://x.com/neon",
  facebook: "https://facebook.com/neon",
  youtube: "https://youtube.com/@neon",
  linkedin: "https://linkedin.com/in/neon",
  threads: "https://threads.net/@neon",
};

const THREE_LINKS: PublicBrandLinks = {
  website: "https://neon.example",
  instagram: "https://instagram.com/neon",
  x: "https://x.com/neon",
};

/** Measured real container widths (investigation F-2). */
const DESKTOP_PANEL_INNER = 318; // FIXED — 360 panel − 2×1px border − 2×20pt pad
const NARROW_PHONE_INNER = 278; // 320pt device − 2×20pt pad − 2×1px border

const DESKTOP_VIEWPORT = 1440; // ≥ the 1024 desktop breakpoint
const NARROW_VIEWPORT = 320;

const THEME_BLUE = {
  color: "#2266cc",
  foregroundColor: "#ffffff" as const,
  font: "inter" as const,
  fontFamilyValue: "TestFont",
  animation: "none" as const,
};

function setViewport(width: number): void {
  const dims = { width, height: 900, scale: 2, fontScale: 1 };
  Dimensions.set({ window: dims, screen: dims });
}

function pageElement(links: PublicBrandLinks): unknown {
  const props: PublicBrandPageProps = {
    brand: {
      id: "brand-3188",
      slug: "neon-lights",
      displayName: "Neon Lights",
      address: "1 Test Way, London",
      coverHue: 210,
      links,
      contact: {},
    },
    events: [],
    trips: [],
    upcoming: [],
    theme: THEME_BLUE,
    callbacks: {
      onClose: () => undefined,
      onShare: () => undefined,
      onOpenEvent: () => undefined,
      onOpenTrip: () => undefined,
    },
  };
  return React.createElement(
    PublicBrandPage as unknown as React.FC<PublicBrandPageProps>,
    props,
  );
}

type StyleArray = Array<Record<string, unknown>>;

/**
 * The socials row COMPOSITE. Identified by its own resolved style rather than
 * by position, so it cannot silently match some other row.
 */
function socialsRows(tree: Tree): HostNode[] {
  return tree.root.findAll((node) => {
    const style = node.props.style;
    if (!Array.isArray(style)) return false;
    const base = (style as StyleArray)[0];
    return (
      typeof node.props.onLayout === "function" &&
      Boolean(base) &&
      base.flexDirection === "row" &&
      "flexWrap" in base &&
      base.marginTop === 18
    );
  });
}

/**
 * The chip PRESSABLES, one node per chip.
 *
 * `findAll` returns EVERY node carrying the props, and RNW's Pressable passes
 * `accessibilityRole`, `onPress` and `style` straight through to the View it
 * renders — so a props-only predicate returns 16 nodes for 8 chips (measured,
 * twice: the style-shape discriminator I tried first did not separate them
 * either). Dedupe on `accessibilityLabel` instead, which is unique per chip and
 * independent of RNW internals. `findAll` walks depth-first pre-order, so the
 * first node per label is the OUTERMOST one — the Pressable this file renders,
 * carrying the real style array and hitSlop.
 */
function chips(tree: Tree): HostNode[] {
  const seen = new Set<string>();
  const unique: HostNode[] = [];
  for (const node of tree.root.findAll(
    (candidate) =>
      candidate.props.accessibilityRole === "link" &&
      typeof candidate.props.onPress === "function" &&
      Array.isArray(candidate.props.style) &&
      typeof candidate.props.accessibilityLabel === "string",
  )) {
    const label = node.props.accessibilityLabel as string;
    if (seen.has(label)) continue;
    seen.add(label);
    unique.push(node);
  }
  return unique;
}

function chipBox(node: HostNode): Record<string, unknown> {
  return (node.props.style as StyleArray)[1];
}

/** The glyph host node inside a chip (the icon mock forwards props verbatim). */
function glyphs(tree: Tree): HostNode[] {
  return tree.root.findAll(
    (node) => typeof node.type === "string" && node.type === "mock-icon",
  );
}

async function mountAndMeasure(
  links: PublicBrandLinks,
  viewport: number,
  measuredWidth: number | null,
): Promise<Tree> {
  setViewport(viewport);
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(pageElement(links));
  });
  const created = tree as Tree;
  const rows = socialsRows(created);
  // VACUITY GUARD — exactly one socials row must exist at this viewport.
  expect(rows.length).toBe(1);
  if (measuredWidth !== null) {
    const onLayout = rows[0].props.onLayout as (event: unknown) => void;
    await TestRenderer.act(() => {
      onLayout({
        nativeEvent: { layout: { width: measuredWidth, height: 44, x: 0, y: 0 } },
      });
    });
  }
  return created;
}

// ---------------------------------------------------------------------------

describe("#3188 R-1/R-2 — the REPORTED container: 8 chips, 318pt sticky panel", () => {
  test("T-10 all eight chips render on ONE line at 31pt", async () => {
    const tree = await mountAndMeasure(
      ALL_EIGHT_LINKS,
      DESKTOP_VIEWPORT,
      DESKTOP_PANEL_INNER,
    );
    const found = chips(tree);
    // VACUITY GUARD — the geometry assertions below are worthless without this.
    expect(found.length).toBe(8);
    expect(found.map((c) => c.props.accessibilityLabel)).toEqual([
      "Website",
      "Instagram",
      "TikTok",
      "X",
      "Facebook",
      "YouTube",
      "LinkedIn",
      "Threads",
    ]);

    for (const chip of found) {
      expect(chipBox(chip)).toEqual({
        width: 31,
        height: 31,
        backgroundColor: "#2266cc",
      });
      // Native only — hitSlop is inert on web (R-4 measures what web gets).
      expect(chip.props.hitSlop).toEqual({
        top: 7,
        bottom: 7,
        left: 5,
        right: 5,
      });
    }

    const row = socialsRows(tree)[0];
    const rowStyle = row.props.style as StyleArray;
    expect(rowStyle[0].flexWrap).toBe("nowrap");
    expect(rowStyle[1]).toEqual({ gap: 10 });

    // THE fit, stated arithmetically against the measured container. With
    // flex-wrap:nowrap a browser cannot produce a second line, and this sum
    // means it has no need to shrink anything either.
    expect(8 * 31 + 7 * 10).toBeLessThanOrEqual(DESKTOP_PANEL_INNER);

    // Glyphs scale with the circle — 21 inside 44 would clip inside 31.
    const marks = glyphs(tree);
    expect(marks.length).toBe(8);
    for (const mark of marks) {
      expect(mark.props.size).toBe(15);
      expect(mark.props.strokeWidth).toBe(1.8);
      expect(mark.props.color).toBe("#ffffff");
    }

    tree.unmount();
  });

  test("R-2 a second line is structurally inexpressible", async () => {
    const tree = await mountAndMeasure(
      ALL_EIGHT_LINKS,
      DESKTOP_VIEWPORT,
      DESKTOP_PANEL_INNER,
    );
    const rowBase = (socialsRows(tree)[0].props.style as StyleArray)[0];
    expect(rowBase.flexWrap).toBe("nowrap");
    // The row must stay PARENT-sized: a content width would make the measured
    // width depend on the children that depend on the measurement.
    expect(rowBase.width).toBeUndefined();
    expect(rowBase.maxWidth).toBeUndefined();
    expect(rowBase.alignSelf).toBeUndefined();

    // The backstop. Yoga and RNW default flex-shrink to 0, which is why
    // removing flexWrap ALONE would overflow instead of shrinking.
    for (const chip of chips(tree)) {
      const base = (chip.props.style as StyleArray)[0];
      expect(base.flexShrink).toBe(1);
      expect(base.minWidth).toBe(0);
      // …and no stylesheet width survives to fight the computed one.
      expect(base.width).toBeUndefined();
      expect(base.height).toBeUndefined();
    }
    tree.unmount();
  });
});

describe("#3188 R-3 — the NARROW phone container (this was never desktop-only)", () => {
  test("8 chips fit one line at 278pt via gap reclaim", async () => {
    const tree = await mountAndMeasure(
      ALL_EIGHT_LINKS,
      NARROW_VIEWPORT,
      NARROW_PHONE_INNER,
    );
    const found = chips(tree);
    expect(found.length).toBe(8);
    for (const chip of found) {
      expect(chipBox(chip)).toEqual({
        width: 31,
        height: 31,
        backgroundColor: "#2266cc",
      });
      expect(chip.props.hitSlop).toEqual({
        top: 7,
        bottom: 7,
        left: 2,
        right: 2,
      });
    }
    const rowStyle = socialsRows(tree)[0].props.style as StyleArray;
    expect(rowStyle[0].flexWrap).toBe("nowrap");
    expect(rowStyle[1]).toEqual({ gap: 4 });
    expect(8 * 31 + 7 * 4).toBeLessThanOrEqual(NARROW_PHONE_INNER);
    tree.unmount();
  });
});

describe("#3188 R-4/R-5 — what the BROWSER actually receives", () => {
  test("the emitted DOM box IS the web tap target, and it clears 24x24", () => {
    setViewport(DESKTOP_VIEWPORT);
    const html = ReactDOMServer.renderToStaticMarkup(
      pageElement(ALL_EIGHT_LINKS),
    );

    const chipTags = [
      ...html.matchAll(/<div[^>]*role="link"[^>]*>/g),
    ].map((match) => match[0]);
    // VACUITY GUARD — eight real elements, or the assertions below say nothing.
    expect(chipTags.length).toBe(8);

    for (const tag of chipTags) {
      const style = /style="([^"]*)"/.exec(tag);
      expect(style).not.toBeNull();
      const declarations = (style as RegExpExecArray)[1];
      const width = /(?:^|;)width:(\d+(?:\.\d+)?)px/.exec(declarations);
      const height = /(?:^|;)height:(\d+(?:\.\d+)?)px/.exec(declarations);
      expect(width).not.toBeNull();
      expect(height).not.toBeNull();
      const w = Number((width as RegExpExecArray)[1]);
      const h = Number((height as RegExpExecArray)[1]);
      // hitSlop adds NO geometry on react-native-web (investigation F-5), so
      // this box is the entire tap target. WCAG 2.2 AA SC 2.5.8 = 24x24 CSS px.
      expect(w).toBeGreaterThanOrEqual(SOCIAL_CHIP_D_MIN);
      expect(h).toBeGreaterThanOrEqual(SOCIAL_CHIP_D_MIN);
      expect(w).toBeLessThanOrEqual(SOCIAL_CHIP_D_MAX);
      expect(w).toBe(h);
      // No padding or margin is emitted, so the visible circle IS the box —
      // there is no invisible extension to fall back on.
      expect(declarations).not.toMatch(/padding/);
      expect(declarations).not.toMatch(/margin/);
    }

    // hitSlop reaches the DOM as NOTHING AT ALL. Asserted so the day RNW ever
    // starts emitting it, someone re-reads the accessibility contract.
    expect(html).not.toMatch(/hitslop/i);
  });

  test("R-5 the emitted CSS RULE says flex-wrap:nowrap and flex-shrink:1", () => {
    setViewport(DESKTOP_VIEWPORT);
    const html = ReactDOMServer.renderToStaticMarkup(
      pageElement(ALL_EIGHT_LINKS),
    );
    const sheet = (
      StyleSheet as unknown as { getSheet: () => { textContent: string } }
    ).getSheet();
    const css = sheet.textContent;
    expect(css.length).toBeGreaterThan(1000);

    // The row element's OWN class list → the rule the layout engine is handed.
    const rowTag = /<div class="([^"]*r-flexWrap-[^"]*)"[^>]*>\s*<div[^>]*role="link"/.exec(
      html,
    );
    expect(rowTag).not.toBeNull();
    const rowClasses = (rowTag as RegExpExecArray)[1].split(/\s+/);
    const wrapClass = rowClasses.find((c) => c.startsWith("r-flexWrap-"));
    expect(wrapClass).toBeDefined();
    const wrapRule = new RegExp(
      `\\.${wrapClass as string}\\{([^}]*)\\}`,
    ).exec(css);
    expect(wrapRule).not.toBeNull();
    expect((wrapRule as RegExpExecArray)[1]).toContain("flex-wrap:nowrap");

    // …and every chip is handed flex-shrink:1. NOTE the tag is matched first
    // and the class pulled out of it: on a chip RNW emits
    // `aria-label … role … tabindex … class … style`, so a regex that assumes
    // `class` comes first silently matches nothing.
    const chipTag = /<div[^>]*role="link"[^>]*>/.exec(html);
    expect(chipTag).not.toBeNull();
    const chipClassAttr = /class="([^"]*)"/.exec((chipTag as RegExpExecArray)[0]);
    expect(chipClassAttr).not.toBeNull();
    const shrinkClass = (chipClassAttr as RegExpExecArray)[1]
      .split(/\s+/)
      .find((c) => c.startsWith("r-flexShrink-"));
    expect(shrinkClass).toBeDefined();
    const shrinkRule = new RegExp(
      `\\.${shrinkClass as string}\\{([^}]*)\\}`,
    ).exec(css);
    expect(shrinkRule).not.toBeNull();
    expect((shrinkRule as RegExpExecArray)[1]).toContain("flex-shrink:1");
  });
});

describe("#3188 R-6/R-7 — no regression, and no measurement", () => {
  test("T-11 three links render exactly as they do today: 44pt, glyph 21", async () => {
    const tree = await mountAndMeasure(
      THREE_LINKS,
      DESKTOP_VIEWPORT,
      DESKTOP_PANEL_INNER,
    );
    const found = chips(tree);
    expect(found.length).toBe(3);
    for (const chip of found) {
      expect(chipBox(chip)).toEqual({
        width: 44,
        height: 44,
        backgroundColor: "#2266cc",
      });
      // Zero slop, not merely small — today's chip has none.
      expect(chip.props.hitSlop).toEqual({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      });
    }
    const rowStyle = socialsRows(tree)[0].props.style as StyleArray;
    expect(rowStyle[1]).toEqual({ gap: 10 });
    const marks = glyphs(tree);
    expect(marks.length).toBe(3);
    for (const mark of marks) {
      expect(mark.props.size).toBe(21);
      expect(mark.props.strokeWidth).toBe(2.2);
    }
    tree.unmount();
  });

  test("R-7 an onLayout that NEVER fires still yields one line above the floor", async () => {
    const tree = await mountAndMeasure(ALL_EIGHT_LINKS, DESKTOP_VIEWPORT, null);
    const found = chips(tree);
    expect(found.length).toBe(8);
    const rowStyle = socialsRows(tree)[0].props.style as StyleArray;
    expect(rowStyle[0].flexWrap).toBe("nowrap");
    const gap = (rowStyle[1] as { gap: number }).gap;
    for (const chip of found) {
      const box = chipBox(chip) as { width: number; height: number };
      // Seeded at the NARROWEST real container, so it fits everywhere.
      expect(box.width).toBeGreaterThanOrEqual(SOCIAL_CHIP_D_MIN);
      expect(box.width).toBeLessThanOrEqual(SOCIAL_CHIP_D_MAX);
      expect(box.height).toBe(box.width);
    }
    const seeded = chipBox(found[0]) as { width: number };
    expect(8 * seeded.width + 7 * gap).toBeLessThanOrEqual(278);
    tree.unmount();
  });
});
