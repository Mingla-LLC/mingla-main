/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { Platform } from "react-native";
// @ts-expect-error react-test-renderer ships without declarations here.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import { EventCoverMedia } from "../../../../../packages/offering-rendering/EventCoverMedia";
import {
  buildHeroMediaAccessibleLabel,
  HeroMediaChangeAnnouncer,
  normalizeHeroMediaText,
} from "../../../../../packages/offering-rendering/heroMediaAccessibility";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const setPlatform = (os: "ios" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

afterEach(() => setPlatform("web"));

describe("issue #2774 public hero content equivalence", () => {
  it("H-1 builds exact truthful names and bounds descriptions by Unicode code point", () => {
    expect(
      buildHeroMediaAccessibleLabel({
        subject: "  Gogi   Lagos ",
        mediaType: "image",
        position: 2,
        total: 5,
        description: " Guests   sharing noodles ",
      }),
    ).toBe("Photo 2 of 5 for Gogi Lagos: Guests sharing noodles");
    expect(
      buildHeroMediaAccessibleLabel({
        subject: "Night School",
        mediaType: "video",
        position: 1,
        total: 1,
        description: "  ",
      }),
    ).toBe("Video cover 1 of 1 for Night School");
    const capped = normalizeHeroMediaText(`${"😀".repeat(300)}tail`);
    expect(Array.from(capped ?? "")).toHaveLength(300);
    expect(capped).not.toContain("tail");
  });

  it("H-2 exposes one named real-media owner while its image descendant is decorative", async () => {
    setPlatform("web");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { Image: class TestImage {} },
    });
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <EventCoverMedia
          mediaUrl="https://images.example.test/gogi.jpg"
          mediaType="image"
          accessibleLabel="Photo 1 of 1 for Gogi"
          testID="issue-2774-hero"
        />,
      );
    });
    if (tree === null) throw new Error("issue_2774_hero_render_missing");
    const images = tree.root.findAll(
      (node: ReactTestInstance) => node.props.accessibilityRole === "image",
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.props.accessibilityLabel).toBe("Photo 1 of 1 for Gogi");
    expect(
      tree.root.findAll(
        (node: ReactTestInstance) =>
          node.props.source?.uri === "https://images.example.test/gogi.jpg" &&
          node.props.accessible === false,
      ),
    ).toHaveLength(1);
  });

  it("H-3 announces only a real index change and never metadata-only rerenders", async () => {
    setPlatform("web");
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <HeroMediaChangeAnnouncer
          activeIndex={0}
          accessibleLabel="Photo 1 of 2 for Gogi"
          testID="issue-2774-live"
        />,
      );
    });
    if (tree === null) throw new Error("issue_2774_live_render_missing");
    const liveRegion = (): ReactTestInstance =>
      tree!.root.find(
        (node: ReactTestInstance) =>
          node.props.testID === "issue-2774-live" &&
          node.props["aria-live"] === "polite",
      );
    expect(liveRegion().props.children).toBe("");

    await TestRenderer.act(async () => {
      tree?.update(
        <HeroMediaChangeAnnouncer
          activeIndex={1}
          accessibleLabel="Photo 2 of 2 for Gogi: Dining room"
          testID="issue-2774-live"
        />,
      );
    });
    expect(liveRegion().props.children).toBe(
      "Now showing Photo 2 of 2 for Gogi: Dining room",
    );

    await TestRenderer.act(async () => {
      tree?.update(
        <HeroMediaChangeAnnouncer
          activeIndex={1}
          accessibleLabel="Photo 2 of 2 for Gogi: Main dining room"
          testID="issue-2774-live"
        />,
      );
    });
    expect(liveRegion().props.children).toBe(
      "Now showing Photo 2 of 2 for Gogi: Dining room",
    );
  });

  it("H-4 keeps a video image result and mute button as independent siblings", async () => {
    setPlatform("web");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { Image: class TestImage {} },
    });
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <EventCoverMedia
          mediaUrl="https://media.example.test/gogi.mp4"
          mediaType="video"
          accessibleLabel="Video cover 1 of 1 for Gogi: Kitchen team"
          showAudioControl={true}
          testID="issue-2774-video"
        />,
      );
    });
    if (tree === null) throw new Error("issue_2774_video_render_missing");
    expect(
      tree.root.findAll(
        (node: ReactTestInstance) => node.props.accessibilityRole === "image",
      ),
    ).toHaveLength(1);
    const buttons = tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === "string" && node.props.role === "button",
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props["aria-label"]).toBe("Turn on cover video audio");
  });

  it("H-5 leaves a coverless placeholder without a fabricated image role", async () => {
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <EventCoverMedia
          mediaUrl={null}
          mediaType={null}
          accessibleLabel="Photo 1 of 1 for Gogi"
        />,
      );
    });
    if (tree === null) throw new Error("issue_2774_coverless_render_missing");
    expect(
      tree.root.findAll(
        (node: ReactTestInstance) => node.props.accessibilityRole === "image",
      ),
    ).toHaveLength(0);
  });
});
