/* eslint-disable @typescript-eslint/no-require-imports */
import fs from "node:fs";
import path from "node:path";
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

describe("issue #2774 tester adversarial native and RPC boundaries", () => {
  it("A-4 announces one Android change but remains silent on mount, metadata, and remount", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    Object.defineProperty(AccessibilityInfo, "announceForAccessibilityWithOptions", {
      configurable: true,
      value: jest.fn(),
    });
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions")
      .mockImplementation(() => undefined);
    const first = buildHeroMediaAccessibleLabel({
      subject: "Gogi",
      mediaType: "image",
      position: 1,
      total: 2,
      description: null,
    });
    const second = buildHeroMediaAccessibleLabel({
      subject: "Gogi",
      mediaType: "image",
      position: 2,
      total: 2,
      description: "Dining room",
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
    expect(announce).toHaveBeenLastCalledWith(
      "Now showing Photo 2 of 2 for Gogi: Dining room",
      { queue: true },
    );

    await TestRenderer.act(async () => {
      tree?.update(
        <HeroMediaChangeAnnouncer
          activeIndex={1}
          accessibleLabel="Photo 2 of 2 for Gogi: Main dining room"
        />,
      );
    });
    expect(announce).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => tree?.unmount());
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <HeroMediaChangeAnnouncer activeIndex={1} accessibleLabel={second} />,
      );
    });
    expect(announce).toHaveBeenCalledTimes(1);
    announce.mockRestore();
  });

  it("SQL-3 exposes only the additive alt key and preserves the four public RPC security shells", () => {
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../supabase/migrations/20270607002774_issue_2774_public_hero_alt.sql",
      ),
      "utf8",
    );
    expect(migration.match(/'coverMediaAlt'\s*,\s*[^,\n)]+/gu) ?? []).toHaveLength(4);
    expect(migration.match(/CREATE OR REPLACE FUNCTION public\.pg_public_/gu) ?? []).toHaveLength(4);
    expect(migration.match(/SECURITY DEFINER/gu) ?? []).toHaveLength(4);
    expect(migration.match(/SET search_path TO 'public'/gu) ?? []).toHaveLength(4);
    expect(migration).not.toMatch(/'coverMedia(?:SourceUrl|Storage|Path)'\s*,/u);
    expect(migration).not.toMatch(/photo_aesthetic_data/u);
  });
});
