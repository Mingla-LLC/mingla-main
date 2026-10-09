// #3682 — Follow token contrast contract (C1–C3 happy pins).
import {
  contrastRatio,
  createThemePalette,
} from "@mingla/offering-rendering/themePalette";
import type { ResolvedTheme } from "@mingla/offering-rendering";

import {
  followTokens,
  resolveFollowVisualState,
} from "../followTokens";

const theme = (color: string, mode: "dark" | "light"): ResolvedTheme =>
  ({
    color,
    mode,
    font: "inter",
    motion: "standard",
  }) as ResolvedTheme;

describe("issue_3682_follow_tokens", () => {
  test("C3 Following never uses accent as fill or label", () => {
    const palette = createThemePalette(theme("#6b1420", "light"));
    const tokens = followTokens(palette, "#f3f2f4");
    expect(tokens.followingFill.toLowerCase()).not.toBe(
      palette.accent.toLowerCase(),
    );
    expect(tokens.followingLabel.toLowerCase()).not.toBe(
      palette.accent.toLowerCase(),
    );
  });

  test("C1 Following label contrast ≥ 4.5:1 on light and dark surfaces", () => {
    const light = createThemePalette(theme("#6b1420", "light"));
    const dark = createThemePalette(theme("#2563eb", "dark"));
    const lightTokens = followTokens(light, "#f3f2f4");
    const darkTokens = followTokens(dark, "#232838");
    expect(
      contrastRatio(lightTokens.followingLabel, lightTokens.followingFill),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(darkTokens.followingLabel, darkTokens.followingFill),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("C2 edge appears when accent-on-surface contrast < 3", () => {
    const palette = createThemePalette(theme("#2563eb", "dark"));
    const surface = "#232838";
    const tokens = followTokens(palette, surface);
    const accentContrast = contrastRatio(palette.accent, surface);
    if (accentContrast < 3) {
      expect(tokens.followEdge).not.toBeNull();
    }
  });

  test("resolveFollowVisualState maps legacy props", () => {
    expect(resolveFollowVisualState({})).toBe("not_following");
    expect(resolveFollowVisualState({ isFollowing: true })).toBe("following");
    expect(
      resolveFollowVisualState({ isFollowing: false, followPending: true }),
    ).toBe("busy_follow");
    expect(
      resolveFollowVisualState({ isFollowing: true, followPending: true }),
    ).toBe("busy_unfollow");
    expect(
      resolveFollowVisualState({ followState: "pending" }),
    ).toBe("pending");
  });
});
