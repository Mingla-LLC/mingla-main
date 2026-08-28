/**
 * Issue #2739 tester-owned adversarial guard.
 *
 * This attacks the contracts that can look correct in a five-item happy render
 * while still failing real users: long-row order, state leakage onto role=button,
 * a current item whose underlying press input is still live, nested images that
 * steal the control name, and web props leaking back onto either native branch.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { Image, Platform, Pressable, ScrollView } from "react-native";
// @ts-expect-error react-test-renderer ships without declarations here.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import { CoverGalleryRow } from "../../../../../packages/offering-rendering/CoverGalleryRow";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";

// @ts-expect-error react-test-renderer ships without declarations here.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
class ImageStub {
  decode = undefined;
  naturalHeight = 0;
  naturalWidth = 0;
  onerror: ((event?: unknown) => void) | null = null;
  onload: ((event?: unknown) => void) | null = null;
  src = "";
}
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { Image: ImageStub },
});

const palette = createThemePalette(resolveTheme(null, null));
const longGallery = Array.from({ length: 9 }, (_, index) => ({
  url: `https://example.test/gallery-${index + 1}.jpg`,
  type: index === 4 ? ("gif" as const) : ("image" as const),
}));

const setPlatform = (os: "android" | "ios" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

const mount = async ({
  activeIndex = 0,
  gallery = longGallery,
  onSelect = jest.fn(),
  coverUrl = "https://example.test/cover.jpg",
}: {
  activeIndex?: number;
  gallery?: typeof longGallery;
  onSelect?: (index: number) => void;
  coverUrl?: string | null;
} = {}): Promise<ReactTestRenderer> => {
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <CoverGalleryRow
        cover={{ url: coverUrl, type: "image" }}
        gallery={gallery}
        activeIndex={activeIndex}
        onSelect={onSelect}
        palette={palette}
        testID="issue-2739-adversarial-gallery"
      />,
    );
  });
  if (tree === null) throw new Error("issue_2739_adversarial_render_missing");
  return tree;
};

const hostButtons = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === "string" && node.props.role === "button",
  );

const pressableCards = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAllByType(Pressable);

afterEach(() => {
  setPlatform("web");
});

describe("issue #2739 tester adversarial gallery contract", () => {
  it("A-1 keeps a ten-control long row ordered, independently focusable, and free of selected/toggle leakage", async () => {
    setPlatform("web");
    const tree = await mount({ activeIndex: 5 });
    const groups = tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === "string" &&
        node.props.role === "group" &&
        node.props["aria-label"] === "Choose cover photo",
    );
    const buttons = hostButtons(tree.root);

    expect(groups).toHaveLength(1);
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Cover",
      "Photo 1 of 9",
      "Photo 2 of 9",
      "Photo 3 of 9",
      "Photo 4 of 9",
      "Photo 5 of 9",
      "Photo 6 of 9",
      "Photo 7 of 9",
      "Photo 8 of 9",
      "Photo 9 of 9",
    ]);
    expect(buttons.map((button) => button.props["aria-disabled"])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(buttons.every((button) => button.props.tabIndex === 0)).toBe(true);
    expect(
      buttons.every(
        (button) =>
          button.props["aria-selected"] === undefined &&
          button.props["aria-pressed"] === undefined,
      ),
    ).toBe(true);
    expect(
      tree.root.findAll(
        (node: ReactTestInstance) =>
          typeof node.type === "string" &&
          node.props.tabIndex === 0 &&
          node.props.role !== "button",
      ),
    ).toHaveLength(0);

    const row = tree.root.findByType(ScrollView);
    expect(row.props.horizontal).toBe(true);
    expect(row.props.showsHorizontalScrollIndicator).toBe(false);
  });

  it("A-2 makes the current Pressable inert before host mapping while every inactive card keeps one press path", async () => {
    setPlatform("web");
    const onSelect = jest.fn();
    const tree = await mount({ activeIndex: 3, onSelect });
    const inputs = pressableCards(tree.root);

    expect(inputs).toHaveLength(10);
    expect(inputs[3]?.props.accessibilityDisabled).toBe(true);
    expect(inputs[3]?.props.onPress).toBeUndefined();
    expect(inputs[3]?.props.accessibilityState).toBeUndefined();
    expect(
      inputs
        .filter((_card, index) => index !== 3)
        .every(
          (card) =>
            card.props.accessibilityDisabled === false &&
            typeof card.props.onPress === "function",
        ),
    ).toBe(true);

    await TestRenderer.act(async () => {
      inputs[7]?.props.onPress();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it("A-3 keeps every nested image decorative so the parent button solely owns its name and focus", async () => {
    setPlatform("web");
    const tree = await mount();
    const images = tree.root.findAllByType(Image);
    const hostImages = tree.root.findAll(
      (node: ReactTestInstance) => typeof node.type === "string" && node.type === "img",
    );

    expect(images).toHaveLength(10);
    expect(hostImages).toHaveLength(10);
    expect(hostImages.every((image) => image.props.alt === "")).toBe(true);
    expect(hostImages.every((image) => image.props.tabIndex === undefined)).toBe(true);
    expect(
      hostImages.every(
        (image) =>
          image.props["aria-label"] === undefined &&
          image.props.role === undefined,
      ),
    ).toBe(true);
  });

  it.each(["ios", "android"] as const)(
    "A-4 preserves %s imagebutton/selected/touch semantics with no web role or disabled state",
    async (os) => {
      setPlatform(os);
      const onSelect = jest.fn();
      const tree = await mount({ activeIndex: 4, onSelect });
      const cards = pressableCards(tree.root);

      expect(cards).toHaveLength(10);
      expect(cards.every((card) => card.props.accessibilityRole === "imagebutton")).toBe(true);
      expect(cards.map((card) => card.props.accessibilityState)).toEqual(
        Array.from({ length: 10 }, (_value, index) => ({ selected: index === 4 })),
      );
      expect(cards[4]?.props.accessibilityLabel).toBe("Photo 4 of 9, selected");
      expect(
        cards.every(
          (card) =>
            card.props.role === undefined &&
            card.props.accessibilityDisabled === undefined &&
            typeof card.props.onPress === "function",
        ),
      ).toBe(true);

      await TestRenderer.act(async () => {
        cards[8]?.props.onPress();
      });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(8);
    },
  );

  it("E-1/E-2 removes a stale row when the gallery empties and keeps a broken-image item named and operable", async () => {
    setPlatform("web");
    const onSelect = jest.fn();
    const brokenGallery = [
      { url: "", type: "image" as const },
      { url: "https://example.test/valid.gif", type: "gif" as const },
    ];
    const tree = await mount({ gallery: brokenGallery, activeIndex: 1, onSelect });
    const buttons = hostButtons(tree.root);

    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Cover",
      "Photo 1 of 2",
      "Photo 2 of 2",
    ]);
    expect(buttons[1]?.props["aria-disabled"]).toBe(true);
    expect(pressableCards(tree.root)[1]?.props.onPress).toBeUndefined();

    await TestRenderer.act(async () => {
      tree.update(
        <CoverGalleryRow
          cover={{ url: null, type: "image" }}
          gallery={[]}
          activeIndex={0}
          onSelect={onSelect}
          palette={palette}
          testID="issue-2739-adversarial-gallery"
        />,
      );
    });
    expect(tree.toJSON()).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
