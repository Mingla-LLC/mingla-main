// issue #1023 — the slug a mount plays: the theme's, unless a DEV-ONLY
// preview override is set (Theme sheet preview tile on native, `?motion=` on
// web). `__DEV__` is false in every production build, so production always
// plays the saved theme.
import { useSyncExternalStore } from "react";

import type { ThemeAnimationSlug } from "./designTokens";
import {
  getThemeMotionDevOverride,
  parseMotionQueryParam,
  resolveThemeMotionSlug,
  setThemeMotionDevOverride,
  subscribeThemeMotionDevOverride,
} from "./themeMotion";

const isDev = (): boolean => typeof __DEV__ !== "undefined" && __DEV__ === true;

let queryRead = false;
function readQueryOnce(): void {
  if (queryRead) return;
  queryRead = true;
  if (!isDev() || typeof window === "undefined" || window.location === undefined) return;
  const fromQuery = parseMotionQueryParam(window.location.search);
  if (fromQuery !== null) setThemeMotionDevOverride(fromQuery, true);
}

export function useThemeMotionSlug(themeSlug: ThemeAnimationSlug): ThemeAnimationSlug {
  readQueryOnce();
  const override = useSyncExternalStore(
    subscribeThemeMotionDevOverride,
    getThemeMotionDevOverride,
    getThemeMotionDevOverride,
  );
  return resolveThemeMotionSlug(themeSlug, override, isDev());
}
