// issue #1023 — the dev-only motion preview override and the Reduce Motion
// frame, split out of ./themeMotion so the eager web shim and the barrel can
// read them without pulling the text-safe-zone and pause-store code (only the
// lazy players use that) into the boot chunk. ./themeMotion re-exports all of
// it, so every existing import keeps working.

import { THEME_ANIMATION_SLUGS, type ThemeAnimationSlug } from "./designTokens";

/* --------------------------------------------- dev-only preview override -- */

const ANIMATED_SLUGS = new Set<string>(THEME_ANIMATION_SLUGS.filter((s) => s !== "none"));

export const isPreviewableMotionSlug = (value: unknown): value is ThemeAnimationSlug =>
  typeof value === "string" && (value === "none" || ANIMATED_SLUGS.has(value));

/** Reads `?motion=<slug>` from a query string. Only a known slug counts. */
export function parseMotionQueryParam(search: string | null | undefined): ThemeAnimationSlug | null {
  if (typeof search !== "string" || search.length === 0) return null;
  const match = /[?&]motion=([^&#]*)/.exec(search.startsWith("?") ? search : `?${search}`);
  if (match === null) return null;
  const value = decodeURIComponent(match[1] ?? "").trim().toLowerCase();
  return isPreviewableMotionSlug(value) ? value : null;
}

let devOverride: ThemeAnimationSlug | null = null;
/** Bumped on every set, so re-sending the SAME slug still replays the entrance. */
let devOverrideVersion = 0;
const devListeners = new Set<() => void>();

/**
 * Dev builds only: make every mounted entrance layer play `slug` (null
 * clears). The business Theme sheet calls this for preview-only tiles so the
 * real public pages behind it show the pick without saving. A no-op when
 * `isDev` is false, so a production build can never be overridden.
 */
export function setThemeMotionDevOverride(slug: ThemeAnimationSlug | null, isDev: boolean): void {
  if (!isDev) return;
  devOverride = slug;
  devOverrideVersion += 1;
  devListeners.forEach((listener) => listener());
}

export function getThemeMotionDevOverride(): ThemeAnimationSlug | null {
  return devOverride;
}

export function getThemeMotionDevOverrideVersion(): number {
  return devOverrideVersion;
}

export function subscribeThemeMotionDevOverride(listener: () => void): () => void {
  devListeners.add(listener);
  return () => {
    devListeners.delete(listener);
  };
}

/**
 * The slug a mount actually plays. The override (sheet pick, or `?motion=` on
 * web) wins ONLY when `isDev` is true; production always plays the theme.
 */
export function pickThemeMotionSlug(
  themeSlug: ThemeAnimationSlug,
  override: ThemeAnimationSlug | null,
  isDev: boolean,
): ThemeAnimationSlug {
  if (!isDev || override === null) return themeSlug;
  return override;
}

/**
 * The one frame Reduce Motion shows (fraction of the entrance). Owned here so
 * the native player, the web player and the web shim export one value.
 */
export const REDUCED_MOTION_PROGRESS = 0.5;

