/**
 * #4271 — Apple's awareness splash needs Apple's own hero banner and wording from
 * its marketing toolkit. Until those are in, this stays null and the modal cannot
 * render, so flipping the server switch can never show Mingla-made art. Setting
 * it is a go-live step. Do not write Apple's wording from memory or draw anything.
 */
export interface TapToPayAwarenessAssets {
  hero: number;
  title: string;
  body: string;
}

export const TAP_TO_PAY_AWARENESS: TapToPayAwarenessAssets | null = null;
