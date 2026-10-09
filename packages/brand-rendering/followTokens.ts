// #3682 Follow Design Contract — token derivation for the shared Follow button.
import {
  contrastRatio,
  hexToRgba,
  type ThemePalette,
} from "@mingla/offering-rendering/themePalette";

export type FollowVisualState =
  | "not_following"
  | "following"
  | "busy_follow"
  | "busy_unfollow"
  | "pending"
  | "muted"
  | "disabled";

export type FollowButtonSize = "sm" | "md" | "lg";

/** Wash direction follows the opaque surface under the button, not page text. */
const isDarkSurface = (surface: string): boolean =>
  contrastRatio("#ffffff", surface) >= contrastRatio("#000000", surface);

/** Composite a translucent rgba(...) fill over an opaque hex surface → #rrggbb. */
export const compositeRgbaOverHex = (
  rgba: string,
  surfaceHex: string,
): string => {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(
    rgba,
  );
  if (m === null) return surfaceHex;
  const fr = Number(m[1]);
  const fg = Number(m[2]);
  const fb = Number(m[3]);
  const fa = Number(m[4]);
  const hm = /^#([0-9a-fA-F]{6})$/.exec(surfaceHex);
  if (hm === null) return surfaceHex;
  const br = parseInt(hm[1].slice(0, 2), 16);
  const bg = parseInt(hm[1].slice(2, 4), 16);
  const bb = parseInt(hm[1].slice(4, 6), 16);
  const r = Math.round(fr * fa + br * (1 - fa));
  const g = Math.round(fg * fa + bg * (1 - fa));
  const b = Math.round(fb * fa + bb * (1 - fa));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};

const mixTowardBlack = (hex: string, amount: number): string => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const mix = (c: number) =>
    Math.round(c * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
};

export type FollowTokens = {
  followFill: string;
  followLabel: string;
  followFillPressed: string;
  followEdge: string | null;
  followingFill: string;
  followingFillPressed: string;
  followingEdge: string;
  followingLabel: string;
  followingIcon: string;
  disabledFill: string;
  disabledLabel: string;
};

export function followTokens(
  palette: ThemePalette,
  surface: string,
): FollowTokens {
  const dark = isDarkSurface(surface);
  const followFill = palette.accent;
  const followLabel = palette.accentText;
  const accentOnSurface = contrastRatio(followFill, surface);
  const followEdge =
    accentOnSurface < 3
      ? dark
        ? hexToRgba("#ffffff", 0.4)
        : hexToRgba("#10141f", 0.5)
      : null;

  const followingWash = dark
    ? hexToRgba("#ffffff", 0.14)
    : hexToRgba("#10141f", 0.07);
  const followingFill = compositeRgbaOverHex(followingWash, surface);
  const followingFillPressed = compositeRgbaOverHex(
    dark ? hexToRgba("#ffffff", 0.22) : hexToRgba("#10141f", 0.12),
    surface,
  );
  const followingEdge = dark
    ? hexToRgba("#ffffff", 0.4)
    : hexToRgba("#10141f", 0.5);
  // Label must read on the Following fill (surface-derived), not page text alone.
  const followingLabel = dark ? "#ffffff" : "#10141f";
  const followingIcon =
    contrastRatio(palette.accent, followingFill) >= 3
      ? palette.accent
      : followingLabel;

  const disabledWash = dark
    ? hexToRgba("#ffffff", 0.08)
    : hexToRgba("#10141f", 0.04);
  const disabledFill = compositeRgbaOverHex(disabledWash, surface);
  const disabledLabel = dark ? "#bfc0c1" : mixTowardBlack("#10141f", 0.15);

  return {
    followFill,
    followLabel,
    followFillPressed: mixTowardBlack(followFill, 0.16),
    followEdge,
    followingFill,
    followingFillPressed,
    followingEdge,
    followingLabel,
    followingIcon,
    disabledFill,
    disabledLabel,
  };
}

export function resolveFollowVisualState(input: {
  isFollowing?: boolean;
  followPending?: boolean;
  followState?: FollowVisualState;
}): FollowVisualState {
  if (input.followState !== undefined) return input.followState;
  if (input.followPending === true) {
    return input.isFollowing === true ? "busy_unfollow" : "busy_follow";
  }
  return input.isFollowing === true ? "following" : "not_following";
}

export function followSizeStyle(size: FollowButtonSize): {
  minHeight: number;
  minWidth: number | undefined;
  borderRadius: number;
  paddingHorizontal: number;
  fullWidth: boolean;
} {
  switch (size) {
    case "sm":
      return {
        minHeight: 36,
        minWidth: 104,
        borderRadius: 999,
        paddingHorizontal: 14,
        fullWidth: false,
      };
    case "md":
      return {
        minHeight: 44,
        minWidth: 120,
        borderRadius: 14,
        paddingHorizontal: 20,
        fullWidth: false,
      };
    case "lg":
    default:
      return {
        minHeight: 44,
        minWidth: undefined,
        borderRadius: 14,
        paddingHorizontal: 20,
        fullWidth: true,
      };
  }
}
