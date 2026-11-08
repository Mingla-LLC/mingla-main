import type { ThemeAnimationSlug } from "../offering-rendering/designTokens";

/** Every animation slug that has generated Lottie files ("none" has none). */
export type ThemeMotionSlug = Exclude<ThemeAnimationSlug, "none">;

/** `intro` plays once on every mount; `loop` then repeats while mounted. */
export type ThemeMotionPhase = "intro" | "loop";

export type ThemeMotionLoaders = Record<
  ThemeMotionSlug,
  Record<ThemeMotionPhase, () => Promise<object>>
>;
