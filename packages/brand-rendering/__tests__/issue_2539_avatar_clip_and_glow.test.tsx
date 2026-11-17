// #2539 [brand avatar renders square instead of clipped to a circle] —
// rewritten for issue #4420 wave 2.
//
// The brand page's avatar moved out of PublicBrandPage into the shared cover
// identity (`OfferingCoverIdentity` `avatar`), where the premium frame prints
// it above the brand name. The #2539 defect was a shadow* set reaching a
// react-native-web <Image>: RNW turns it into `filter: drop-shadow()` on the
// inner picture layer and WebKit clips that layer to a RECTANGLE. This suite
// renders the real identity and proves, on the rendered tree:
//   T-1 the avatar <Image> carries NO shadow* / boxShadow / filter;
//   T-2 the photo sits in a ROUND clip (borderRadius = half the size,
//       overflow hidden) inside the accent ring;
//   T-3 without a photo the initial renders, upper-cased;
//   T-4 an offering page (no `avatar`) renders no avatar node at all.
//
// fails-on-revert: adding a shadow to the avatar Image fails T-1; dropping
// the inner clip's overflow or radius fails T-2; rendering the avatar
// unconditionally fails T-4.

import React from "react";
import TestRenderer from "react-test-renderer";
import { Image } from "react-native";

// react-native-web's <Image> reads `window` on mount; this node suite has no
// DOM, so give it the global object (the image never loads here).
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
}
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.assign(globalThis, { window: { Image: StubImage } });
}

import { OfferingCoverIdentity } from "../../offering-rendering/OfferingCoverIdentity";
import { createThemePalette } from "../../offering-rendering/themePalette";
import { resolveTheme } from "../../offering-rendering/themeResolver";

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

type Node = TestRenderer.ReactTestInstance;

const flatten = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatten(s) }),
      {},
    );
  }
  return style !== null && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
};

const render = (avatar: { photo?: string | null; initial: string } | null) => {
  let tree!: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <OfferingCoverIdentity
        eyebrow={["Verified venue", "Lagos"]}
        title="Capture Co"
        avatar={avatar}
        palette={palette}
        theme={theme}
        variant="cover"
        testID="id"
      />,
    );
  });
  return tree;
};

const byTestId = (tree: TestRenderer.ReactTestRenderer, id: string): Node[] =>
  tree.root.findAll((n) => n.props.testID === id && typeof n.type !== "string");

describe("#2539 / #4420 — the brand avatar in the cover identity", () => {
  test("T-1 the avatar Image carries no shadow, boxShadow or filter", () => {
    const tree = render({ photo: "https://example.com/a.jpg", initial: "Capture" });
    const images = tree.root.findAllByType(Image);
    expect(images.length).toBe(1);
    const style = flatten(images[0]?.props.style);
    for (const key of [
      "shadowColor",
      "shadowOpacity",
      "shadowRadius",
      "shadowOffset",
      "boxShadow",
      "filter",
    ]) {
      expect(style[key]).toBeUndefined();
    }
  });

  test("T-2 the photo sits in a round clip inside the ring", () => {
    const tree = render({ photo: "https://example.com/a.jpg", initial: "Capture" });
    const ring = byTestId(tree, "id-avatar")[0];
    expect(ring).toBeDefined();
    const ringStyle = flatten(ring?.props.style);
    expect(ringStyle.width).toBe(60);
    expect(ringStyle.borderRadius).toBe(30);
    expect(ringStyle.overflow).toBe("hidden");
    const clip = byTestId(tree, "id-avatar-clip")[0];
    expect(clip?.findAllByType(Image).length).toBe(1);
    const clipStyle = flatten(clip?.props.style);
    expect(clipStyle.overflow).toBe("hidden");
    expect(clipStyle.borderRadius).toBe(27);
    expect(clipStyle.borderWidth).toBe(3);
  });

  test("T-3 no photo renders the upper-cased initial", () => {
    const tree = render({ photo: null, initial: "capture" });
    expect(tree.root.findAllByType(Image).length).toBe(0);
    const texts = tree.root
      .findAll((n) => typeof n.props.children === "string")
      .map((n) => n.props.children as string);
    expect(texts).toContain("C");
  });

  test("T-4 an offering page (no avatar) renders no avatar node", () => {
    const tree = render(null);
    expect(byTestId(tree, "id-avatar").length).toBe(0);
    expect(tree.root.findAllByType(Image).length).toBe(0);
  });
});
