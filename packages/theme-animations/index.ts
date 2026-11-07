// issue #1023 — @mingla/theme-animations: the generated, brand-tintable Lottie
// files behind the theme "Motion" axis, plus the palette and loaders the
// shared ThemeEntranceAnimation uses on native and web.

import { THEME_LOTTIE_LOADERS } from "./loaders";
import type { ThemeMotionPhase, ThemeMotionSlug } from "./types";

export { buildThemeMotionPalette, tintLottie } from "./tint";
export type { Rgb01, ThemeMotionPalette, ThemeMotionSlot } from "./tint";
export type { ThemeMotionLoaders, ThemeMotionPhase, ThemeMotionSlug } from "./types";
export { THEME_LOTTIE_LOADERS };

/** Timing and text-safe-zone numbers from the approved reference page. */
export const THEME_MOTION_TIMING = {
  /** The reference `INTRO`: the entrance file is 2.6 s. */
  introSeconds: 2.6,
  /** Intro → loop crossfade. */
  crossfadeMs: 450,
  /** Opacity of motion inside the text-safe zone (reference: ~50% removed). */
  introZoneOpacity: 0.5,
  /** …and during the ambient loop (reference: ~86% removed). */
  loopZoneOpacity: 0.14,
  /** Soft edge of the zone, in points. */
  featherPx: 16,
} as const;

const loaded = new Map<string, object>();
const pending = new Map<string, Promise<object>>();
const cacheKey = (slug: ThemeMotionSlug, phase: ThemeMotionPhase): string =>
  `${slug}.${phase}`;

/** The animation if it has already loaded (lets a remount render at once). */
export function peekThemeLottie(
  slug: ThemeMotionSlug,
  phase: ThemeMotionPhase,
): object | null {
  return loaded.get(cacheKey(slug, phase)) ?? null;
}

/** Load (once) and cache one generated animation. Rejects on a load error. */
export function loadThemeLottie(
  slug: ThemeMotionSlug,
  phase: ThemeMotionPhase,
): Promise<object> {
  const key = cacheKey(slug, phase);
  const hit = loaded.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const inFlight = pending.get(key);
  if (inFlight !== undefined) return inFlight;
  const loader = THEME_LOTTIE_LOADERS[slug]?.[phase];
  if (loader === undefined) {
    return Promise.reject(new Error(`No theme motion file for ${key}`));
  }
  const promise = loader()
    .then((json) => {
      loaded.set(key, json);
      pending.delete(key);
      return json;
    })
    .catch((error: unknown) => {
      pending.delete(key);
      throw error;
    });
  pending.set(key, promise);
  return promise;
}
