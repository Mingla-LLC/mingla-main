/**
 * Issue #3827 — tester web render: Hub > Trips cards show the trip cover on
 * the WEB surface, through react-native-web and the REAL shared
 * `EventCoverMedia` (no stand-in for the cover component).
 *
 * The implementor's test stubs React Native and asserts the props the card
 * hands to `EventCoverMedia`. This suite renders what a browser would get:
 * the real card, the real cover component and react-native-web's DOM host
 * elements, then reads the URLs that actually reach the markup.
 *
 *   1. An image cover reaches the DOM.
 *   2. A video cover shows its poster still (a grid card never downloads the
 *      video), not the hue placeholder.
 *   3. A cover changed from video to image, where the server kept the old
 *      video poster (the step-1 autosave omits the poster), shows the IMAGE
 *      and never the stale video poster.
 *   4. A trip with no cover puts no media URL in the markup.
 *
 * Fails on revert: restore `mediaUrl={null}` / `mediaType={null}` in
 * TripListCard (cases 1-3 red).
 *
 * Run (from mingla-business/):
 *   npx jest --config jest.issue3827.web.render.cjs --ci --maxWorkers=2
 */

import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

import type { Trip } from "../../../services/tripsService";

// react-native-web's ImageLoader builds `new window.Image()`; node has none.
class FakeImage {
  onload: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 400;
  naturalHeight = 400;
  set src(_value: string) {
    setTimeout(() => this.onload?.({}), 0);
  }
  decode(): Promise<void> {
    return Promise.resolve();
  }
}
Reflect.set(globalThis, "window", { Image: FakeImage });
Reflect.set(globalThis, "document", { activeElement: null });

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
};
type Renderer = { root: Node; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockLeaf(name: string) {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return (props: { children?: React.ReactNode }) =>
    ReactLocal.createElement(name, null, props.children);
}
jest.mock("../../ui/Icon", () => ({ Icon: mockLeaf("mock-icon") }));
// expo-video's native SharedObject does not exist in node. The video PLAYER is
// not under test (a grid card shows the poster still); the repo's shared stub
// keeps the real EventCoverMedia importable.
jest.mock("expo-video", () =>
  jest.requireActual("../../../../jest.issue1561.expo-video-stub.cjs"),
);

// eslint-disable-next-line import/first
import { TripListCard } from "../TripListCard";

const IMAGE_URL = "https://cdn.example.test/event_covers/b/t/photo.jpg";
const VIDEO_URL = "https://cdn.example.test/event_covers/b/t/clip.mp4";
const VIDEO_POSTER = "https://cdn.example.test/event_covers/b/t/clip-poster.jpg";

const trip = (cover: {
  url: string | null;
  type: string | null;
  poster: string | null;
}): Trip =>
  ({
    id: "38270000-0000-4000-8000-00000000c0de",
    brandId: "brand-3827",
    title: "Lisbon long weekend",
    status: "draft",
    coverMediaUrl: cover.url,
    coverMediaType: cover.type,
    coverMediaPosterUrl: cover.poster,
    businessTrip: {
      startAt: "2030-06-01T09:00:00Z",
      endAt: "2030-06-04T18:00:00Z",
      destinationLocationText: "Lisbon",
    },
    pricingTiers: [],
    ticketsSoldCount: 0,
    travelersCount: 0,
    revenueCents: 0,
  }) as unknown as Trip;

const mounted: Renderer[] = [];
const render = async (t: Trip): Promise<Renderer> => {
  let tree!: Renderer;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<TripListCard trip={t} onPress={() => undefined} />);
  });
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  mounted.push(tree);
  return tree;
};

/** Every string a DOM host element carries, at any depth of its props. */
const markupStrings = (tree: Renderer): string => {
  const hosts = tree.root.findAll((node) => typeof node.type === "string");
  const seen: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === "string") {
      seen.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    if (typeof value === "object" && !React.isValidElement(value)) {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (key === "children") continue;
        walk(inner, depth + 1);
      }
    }
  };
  for (const host of hosts) walk(host.props, 0);
  return seen.join("\n");
};

afterEach(async () => {
  await TestRenderer.act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

describe("issue #3827 tester web render — Hub > Trips card cover on web", () => {
  test("an image cover reaches the DOM", async () => {
    const tree = await render(trip({ url: IMAGE_URL, type: "image", poster: null }));
    expect(markupStrings(tree)).toContain(IMAGE_URL);
  });

  test("a video cover shows its poster still, never the placeholder", async () => {
    const tree = await render(trip({ url: VIDEO_URL, type: "video", poster: VIDEO_POSTER }));
    // On web the shared cover mounts its <video> imperatively (ORCH-1167-R8)
    // and sets `poster` on that DOM node, so read the real web video
    // component the cover rendered: the clip, with this trip's poster.
    const webVideos = tree.root.findAll(
      (node) => typeof node.type !== "string" && node.props.uri === VIDEO_URL,
    );
    expect(webVideos.length).toBeGreaterThan(0);
    expect(webVideos.every((node) => node.props.posterUrl === VIDEO_POSTER)).toBe(true);
  });

  test("video changed to image with a stale video poster kept shows the image only", async () => {
    const tree = await render(trip({ url: IMAGE_URL, type: "image", poster: VIDEO_POSTER }));
    const markup = markupStrings(tree);
    expect(markup).toContain(IMAGE_URL);
    expect(markup).not.toContain(VIDEO_POSTER);
  });

  test("no cover: no media URL in the markup", async () => {
    const tree = await render(trip({ url: null, type: null, poster: null }));
    const markup = markupStrings(tree);
    expect(markup).not.toContain("cdn.example.test");
  });
});
