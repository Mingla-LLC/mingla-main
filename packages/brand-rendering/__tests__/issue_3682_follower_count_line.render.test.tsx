import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FollowerCountLine } from "../../offering-rendering/FollowerCountLine";

const palette = { primaryText: "#ffffff", secondaryText: "#aaaaaa" };
const render = (
  count: number | null,
  loading = false,
  variant: "caption" | "presentedBy" = "caption",
): string =>
  renderToStaticMarkup(
    <FollowerCountLine
      count={count}
      loading={loading}
      palette={palette}
      variant={variant}
      testID="followers"
    />,
  );

describe("#3682 shared follower-count line", () => {
  test.each(["caption", "presentedBy"] as const)(
    "%s renders compact and zero copy",
    (variant) => {
      expect(render(1204, false, variant)).toContain("1.2k");
      expect(render(1204, false, variant)).toContain("followers");
      expect(render(0, false, variant)).toContain("Be the first to follow");
    },
  );

  test("loading emits only the skeleton and null emits nothing", () => {
    const loading = render(0, true);
    expect(loading).toContain("followers-skeleton");
    expect(loading).not.toContain("Be the first");
    expect(loading).not.toContain(">0<");
    expect(render(null)).toBe("");
  });
});
