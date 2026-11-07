// issue #1023 — theme entrance motion, WEB entry point.
//
// A thin lazy shell: the player, palette, tinting and loaders live in
// ThemeEntranceAnimationWebImpl and arrive in their own chunk the first time a
// page with motion mounts, so none of it is in the eager boot payload every
// visitor downloads (ORCH-1083 bundle budget). "none" never loads anything.

import React, { Suspense } from "react";

import { getThemeMotionDevOverride } from "./themeMotion";
import type { ThemeEntranceAnimationProps } from "./ThemeEntranceAnimationWebImpl";

export type { ThemeEntranceAnimationProps } from "./ThemeEntranceAnimationWebImpl";

const Impl = React.lazy(() =>
  import("./ThemeEntranceAnimationWebImpl").then((m) => ({ default: m.ThemeEntranceAnimation })),
);

export const ThemeEntranceAnimation: React.FC<ThemeEntranceAnimationProps> = (props) => {
  if (props.theme.animation === "none" && !hasDevMotionOverride()) return null;
  return (
    <Suspense fallback={null}>
      <Impl {...props} />
    </Suspense>
  );
};

/** Dev only: `?motion=` or a sheet preview can turn motion on for a theme that has none. */
function hasDevMotionOverride(): boolean {
  if (typeof __DEV__ === "undefined" || __DEV__ !== true) return false;
  if (getThemeMotionDevOverride() !== null) return true;
  return typeof window !== "undefined" && /[?&]motion=/.test(window.location?.search ?? "");
}
