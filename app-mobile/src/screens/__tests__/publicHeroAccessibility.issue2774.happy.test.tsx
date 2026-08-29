/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { AccessibilityInfo, Platform } from "react-native";
// @ts-expect-error react-test-renderer ships without declarations here.
import type { ReactTestRenderer } from "react-test-renderer";

import {
  buildHeroMediaAccessibleLabel,
  HeroMediaChangeAnnouncer,
} from "../../../../packages/offering-rendering/heroMediaAccessibility";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

describe("issue #2774 native hero announcement", () => {
  it("H-4 queues exactly one native message for a real current-item change", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    Object.defineProperty(AccessibilityInfo, "announceForAccessibilityWithOptions", {
      configurable: true,
      value: jest.fn(),
    });
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions")
      .mockImplementation(() => undefined);
    const first = buildHeroMediaAccessibleLabel({
      subject: "Sunset Trip",
      mediaType: "video",
      position: 1,
      total: 2,
      description: "Coast at dusk",
    });
    const second = buildHeroMediaAccessibleLabel({
      subject: "Sunset Trip",
      mediaType: "image",
      position: 2,
      total: 2,
      description: null,
    });
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <HeroMediaChangeAnnouncer activeIndex={0} accessibleLabel={first} />,
      );
    });
    expect(announce).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      tree?.update(
        <HeroMediaChangeAnnouncer activeIndex={1} accessibleLabel={second} />,
      );
    });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "Now showing Photo 2 of 2 for Sunset Trip",
      { queue: true },
    );

    await TestRenderer.act(async () => {
      tree?.update(
        <HeroMediaChangeAnnouncer
          activeIndex={1}
          accessibleLabel="Photo 2 of 2 for Sunset Trip: Updated metadata"
        />,
      );
    });
    expect(announce).toHaveBeenCalledTimes(1);
    announce.mockRestore();
  });
});
