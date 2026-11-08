// issue #1023 — the DEV-ONLY `motion=<slug>` link switch for the business app.
import { beforeEach, describe, expect, test } from "@jest/globals";

import { applyMotionLink, parseMotionLink } from "../motionDeepLink";
import {
  getThemeMotionDevOverride,
  getThemeMotionDevOverrideVersion,
  setThemeMotionDevOverride,
} from "../../../../packages/offering-rendering/themeMotion";

const EVENT = "mingla-business://e/77events/y2k-party-scorpio-edition";

beforeEach(() => {
  setThemeMotionDevOverride(null, true);
});

describe("#1023 motion deep link", () => {
  test("parses the slug from the query", () => {
    expect(parseMotionLink(`${EVENT}?motion=love_burst`)).toEqual({ kind: "set", slug: "love_burst" });
    expect(parseMotionLink(`${EVENT}?ref=x&motion=Aurora#top`)).toEqual({ kind: "set", slug: "aurora" });
  });

  test("motion=none and an empty motion= clear the override", () => {
    expect(parseMotionLink(`${EVENT}?motion=none`)).toEqual({ kind: "clear" });
    expect(parseMotionLink(`${EVENT}?motion=`)).toEqual({ kind: "clear" });
  });

  test("ignores unknown slugs, malformed values and links without motion=", () => {
    expect(parseMotionLink(`${EVENT}?motion=drop_table`)).toBeNull();
    expect(parseMotionLink(`${EVENT}?motion=%E0%A4%A`)).toBeNull();
    expect(parseMotionLink(EVENT)).toBeNull();
    expect(parseMotionLink(null)).toBeNull();
    expect(applyMotionLink(`${EVENT}?motion=drop_table`, true)).toBe(false);
    expect(getThemeMotionDevOverride()).toBeNull();
  });

  test("in dev it sets, replays on a repeat, and clears", () => {
    const before = getThemeMotionDevOverrideVersion();
    expect(applyMotionLink(`${EVENT}?motion=love_burst`, true)).toBe(true);
    expect(getThemeMotionDevOverride()).toBe("love_burst");
    applyMotionLink(`${EVENT}?motion=love_burst`, true);
    // same slug again still bumps the version the entrance layer is keyed on
    expect(getThemeMotionDevOverrideVersion()).toBe(before + 2);
    applyMotionLink(`${EVENT}?motion=none`, true);
    expect(getThemeMotionDevOverride()).toBeNull();
  });

  test("is inert when the build is not __DEV__", () => {
    const before = getThemeMotionDevOverrideVersion();
    expect(applyMotionLink(`${EVENT}?motion=love_burst`, false)).toBe(false);
    expect(getThemeMotionDevOverride()).toBeNull();
    expect(getThemeMotionDevOverrideVersion()).toBe(before);
  });
});
