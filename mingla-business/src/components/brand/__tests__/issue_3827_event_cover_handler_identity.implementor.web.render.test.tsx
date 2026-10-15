/**
 * #3827 — the compact EventCoverMedia repair must keep image callbacks stable.
 *
 * The full rapid-typing suites prove the user-visible outcome. This focused
 * guard proves the load-bearing boundary directly: an unrelated parent render
 * cannot hand react-native-web's Image new load/error callbacks, and a changed
 * error recipient still receives the next real failure.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

class FakeImage {
  onload: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1600;
  naturalHeight = 900;
  set src(_value: string) {
    setTimeout(() => this.onload?.({}), 0);
  }
  decode(): Promise<void> {
    return Promise.resolve();
  }
}

Reflect.set(globalThis, "window", { Image: FakeImage });
Reflect.set(globalThis, "document", { activeElement: null });
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

jest.mock("expo-video", () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({
    addListener: () => ({ remove: () => undefined }),
  }),
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("react-native-svg", () => {
  const Leaf = (): null => null;
  return {
    __esModule: true,
    default: Leaf,
    Svg: Leaf,
    Path: Leaf,
    Line: Leaf,
  };
});

type Node = {
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
};
type Renderer = {
  root: Node;
  unmount: () => void;
  update: (element: React.ReactElement) => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

// eslint-disable-next-line import/first
import { EventCoverMedia } from "../../../../../packages/offering-rendering/EventCoverMedia";

const COVER_URL = "https://example.test/brand_covers/handler-proof.jpg";

const renderedImage = (renderer: Renderer): Node => {
  const matches = renderer.root.findAll(
    (node) =>
      (node.props.source as { uri?: string } | undefined)?.uri === COVER_URL &&
      typeof node.props.onError === "function",
  );
  expect(matches).toHaveLength(1);
  return matches[0];
};

describe("#3827 EventCoverMedia image handler identity", () => {
  test("unrelated rerenders preserve callbacks and changed recipients receive errors", async () => {
    const firstError = jest.fn();
    const latestError = jest.fn();
    const onAspectRatio = jest.fn();
    const cover = (label: string, onMediaError: typeof firstError) => (
      <EventCoverMedia
        mediaUrl={COVER_URL}
        mediaType="image"
        label={label}
        onAspectRatio={onAspectRatio}
        onMediaError={onMediaError}
      />
    );

    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(cover("First label", firstError));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const mounted = renderer as unknown as Renderer;
    const before = renderedImage(mounted).props;

    await TestRenderer.act(async () => {
      mounted.update(cover("Unrelated label change", firstError));
    });

    const after = renderedImage(mounted).props;
    expect(after.onError).toBe(before.onError);
    expect(after.onLoad).toBe(before.onLoad);

    await TestRenderer.act(async () => {
      (after.onLoad as (event: unknown) => void)({
        nativeEvent: { source: { width: 1600, height: 900 } },
      });
    });
    expect(onAspectRatio).toHaveBeenCalledWith(16 / 9);

    await TestRenderer.act(async () => {
      mounted.update(cover("New recipient", latestError));
    });
    const withLatestRecipient = renderedImage(mounted).props;

    await TestRenderer.act(async () => {
      (withLatestRecipient.onError as (event: unknown) => void)({
        nativeEvent: { code: "E_IMAGE" },
      });
    });
    expect(firstError).not.toHaveBeenCalled();
    expect(latestError).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: COVER_URL, surface: "image" }),
    );

    await TestRenderer.act(async () => {
      mounted.unmount();
    });
  });
});
