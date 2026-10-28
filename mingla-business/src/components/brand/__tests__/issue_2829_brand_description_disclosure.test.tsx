/**
 * #2829 — brand descriptions disclose only when four rendered lines clip.
 *
 * Character-count guesses produced a visible “Read more” beside descriptions
 * that already fit. This exercises the real shared disclosure and pins both
 * brand surfaces to it.
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";

import { MeasuredTextDisclosure } from "@mingla/brand-rendering/MeasuredTextDisclosure";

type Node = {
  props: Record<string, unknown>;
};
type Renderer = {
  root: {
    findAll: (fn: (node: Node) => boolean) => Node[];
  };
  unmount: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const layoutEvent = (height: number) => ({
  nativeEvent: {
    layout: { height, width: 320, x: 0, y: 0 },
  },
});

const nodeByTestID = (tree: Renderer, testID: string): Node | undefined =>
  tree.root.findAll((node) => node.props.testID === testID)[0];

const measure = async (
  tree: Renderer,
  fullHeight: number,
  collapsedHeight: number,
): Promise<void> => {
  await act(async () => {
    (
      nodeByTestID(tree, "bio-measure-full")?.props.onLayout as
        ((event: ReturnType<typeof layoutEvent>) => void) | undefined
    )?.(layoutEvent(fullHeight));
    (
      nodeByTestID(tree, "bio-measure-collapsed")?.props.onLayout as
        ((event: ReturnType<typeof layoutEvent>) => void) | undefined
    )?.(layoutEvent(collapsedHeight));
  });
};

const renderDisclosure = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <MeasuredTextDisclosure
        text="A brand description whose rendered height is supplied by the test."
        collapsedLines={4}
        testID="bio"
      />,
    );
  });
  return tree;
};

test("a description that fits exactly has no misleading disclosure", async () => {
  const tree = await renderDisclosure();
  await measure(tree, 96, 96);

  expect(nodeByTestID(tree, "bio-toggle")).toBeUndefined();
  expect(nodeByTestID(tree, "bio-text")?.props.numberOfLines).toBe(4);

  await act(async () => tree.unmount());
});

test("real overflow reveals an accessible Read more / Show less control", async () => {
  const beforeToggle = jest.fn();
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <MeasuredTextDisclosure
        text="A genuinely overflowing brand description."
        collapsedLines={4}
        onBeforeToggle={beforeToggle}
        testID="bio"
      />,
    );
  });
  await measure(tree, 120, 96);

  const readMore = nodeByTestID(tree, "bio-toggle");
  expect(readMore?.props.accessibilityLabel).toBe("Read more");
  expect(readMore?.props.accessibilityState).toEqual({ expanded: false });
  expect(readMore?.props["aria-expanded"]).toBe(false);

  await act(async () => {
    (readMore?.props.onPress as (() => void) | undefined)?.();
  });

  const showLess = nodeByTestID(tree, "bio-toggle");
  expect(showLess?.props.accessibilityLabel).toBe("Show less");
  expect(showLess?.props.accessibilityState).toEqual({ expanded: true });
  expect(showLess?.props["aria-expanded"]).toBe(true);
  expect(nodeByTestID(tree, "bio-text")?.props.numberOfLines).toBeUndefined();
  expect(beforeToggle).toHaveBeenCalledTimes(1);

  await act(async () => {
    (showLess?.props.onPress as (() => void) | undefined)?.();
  });
  expect(nodeByTestID(tree, "bio-text")?.props.numberOfLines).toBe(4);
  expect(beforeToggle).toHaveBeenCalledTimes(2);

  await act(async () => tree.unmount());
});

test("public and operator brand surfaces share measured overflow ownership", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const publicPage = fs.readFileSync(
    path.join(repoRoot, "packages/brand-rendering/PublicBrandPage.tsx"),
    "utf8",
  );
  const profile = fs.readFileSync(
    path.join(
      repoRoot,
      "mingla-business/src/components/brand/BrandProfileView.tsx",
    ),
    "utf8",
  );

  expect(publicPage).toContain("<MeasuredTextDisclosure");
  expect(publicPage).toContain('testID="public-brand-bio-disclosure"');
  expect(publicPage).not.toMatch(/text\.length\s*>\s*220/);

  expect(profile).toContain("<MeasuredTextDisclosure");
  expect(profile).toContain('testID="brand-profile-bio-disclosure"');
  expect(profile).not.toMatch(/bioText\.length\s*>\s*160/);
});
