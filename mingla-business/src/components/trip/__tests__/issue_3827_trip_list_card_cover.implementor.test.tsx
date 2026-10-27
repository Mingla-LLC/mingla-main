/**
 * Issue #3827 — Hub > Trips cards must show the trip's uploaded cover.
 *
 * `TripListCard` used to pass a literal `mediaUrl={null}` / `mediaType={null}`
 * to `EventCoverMedia`, so every trip card showed the hue placeholder even when
 * the host had uploaded a cover. This mounts the REAL card (with
 * react-test-renderer, RN host components stubbed) and asserts the props
 * `EventCoverMedia` receives.
 *
 * Fails-on-revert: restoring `mediaUrl={null}` / `mediaType={null}` makes the
 * image and video cases receive null and fail.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { Trip } from "../../../services/tripsService";

// CI installs the renderer but not a separate @types package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: {
      findAll: (
        predicate: (node: { type: unknown; props: Record<string, unknown> }) => boolean,
      ) => { props: Record<string, unknown> }[];
    };
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactMock = require("react") as typeof React;
  const host =
    (name: string) =>
    (props: Record<string, unknown>): React.ReactElement =>
      ReactMock.createElement(name, props, props.children as React.ReactNode);
  return {
    Animated: {
      View: host("AnimatedView"),
      Value: class {
        constructor(public value: number) {}
      },
    },
    Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
    Pressable: (props: Record<string, unknown>): React.ReactElement => {
      const children =
        typeof props.children === "function"
          ? (props.children as (s: { pressed: boolean }) => React.ReactNode)({ pressed: false })
          : (props.children as React.ReactNode);
      return ReactMock.createElement("Pressable", { ...props, children });
    },
    StyleSheet: { create: <T,>(s: T): T => s, hairlineWidth: 1 },
    Text: host("Text"),
    View: host("View"),
  };
});

jest.mock("../../ui/EventCoverMedia", () => ({
  EventCoverMedia: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("EventCoverMedia", props),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Pill", () => ({
  Pill: (props: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("Pill", null, props.children),
}));
jest.mock("../../offering/DraftSelectCheckbox", () => ({
  DraftSelectCheckbox: () => null,
}));
jest.mock("../../offering/DraftSelectOverlay", () => ({
  DraftSelectOverlay: () => null,
  useDraftHoldRing: () => ({
    shakeX: 0,
    ringOpacity: 0,
    ringScale: 1,
    playNullShake: () => undefined,
    pressHandlers: { onPressIn: () => undefined, onPressOut: () => undefined },
  }),
}));

// Import AFTER mocks are registered.
// eslint-disable-next-line import/first
import { TripListCard } from "../TripListCard";

const makeTrip = (cover: {
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  coverMediaPosterUrl?: string | null;
}): Trip =>
  ({
    id: "trip-3827",
    brandId: "brand-1",
    title: "Lagos weekend",
    status: "draft",
    ...cover,
    businessTrip: {
      startAt: null,
      endAt: null,
      destinationLocationText: null,
      capacity: null,
    },
  }) as unknown as Trip;

const coverProps = (trip: Trip): Record<string, unknown> => {
  let renderer: ReturnType<typeof TestRenderer.create> | undefined;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      <TripListCard trip={trip} onOpen={() => undefined} />,
    );
  });
  if (renderer === undefined) throw new Error("card did not render");
  const covers = renderer.root.findAll((node) => node.type === "EventCoverMedia");
  expect(covers).toHaveLength(1);
  const props = covers[0].props;
  const mounted = renderer;
  TestRenderer.act(() => {
    mounted.unmount();
  });
  return props;
};

describe("issue #3827 — TripListCard passes the trip's real cover", () => {
  test("image cover: URL and type reach EventCoverMedia", () => {
    const url = "https://example.test/event_covers/b/t/cover.jpg";
    const props = coverProps(
      makeTrip({ coverMediaUrl: url, coverMediaType: "image", coverMediaPosterUrl: url }),
    );
    expect(props.mediaUrl).toBe(url);
    expect(props.mediaType).toBe("image");
    expect(typeof props.hue).toBe("number");
  });

  test("video cover: URL, type and poster reach EventCoverMedia", () => {
    const url = "https://example.test/event_covers/b/t/cover.mp4";
    const poster = "https://example.test/event_covers/b/t/poster.jpg";
    const props = coverProps(
      makeTrip({ coverMediaUrl: url, coverMediaType: "video", coverMediaPosterUrl: poster }),
    );
    expect(props.mediaUrl).toBe(url);
    expect(props.mediaType).toBe("video");
    expect(props.posterUrl).toBe(poster);
  });

  test("no cover: placeholder hue only (null media)", () => {
    const props = coverProps(makeTrip({ coverMediaUrl: null, coverMediaType: null }));
    expect(props.mediaUrl).toBeNull();
    expect(props.mediaType).toBeNull();
    expect(typeof props.hue).toBe("number");
  });

  test("unknown cover type is narrowed to null, never passed through", () => {
    const props = coverProps(
      makeTrip({ coverMediaUrl: "https://example.test/x", coverMediaType: "audio" }),
    );
    expect(props.mediaType).toBeNull();
  });
});
