/**
 * #4271 — Apple's awareness splash needs Apple's own hero banner and wording from
 * its marketing toolkit. Until those are in, this stays null and the modal cannot
 * render, so flipping the server switch can never show Mingla-made art. Setting
 * it is a go-live step. Do not write Apple's wording from memory or draw anything.
 *
 * To switch it on (one edit, this file only):
 *   1. Put Apple's Tap to Pay on iPhone toolkit hero image, unedited, in
 *      mingla-business/assets/tap-to-pay/ as awareness-hero.png, with its
 *      awareness-hero@2x.png and awareness-hero@3x.png if the toolkit has them
 *      (Metro picks the right density from the one require below).
 *   2. Replace `= null` below with:
 *        = {
 *          hero: require("../../assets/tap-to-pay/awareness-hero.png"),
 *          title: "<the toolkit's headline, word for word>",
 *          body: "<the toolkit's body copy, word for word>",
 *        };
 *   3. Update the B10 check in
 *      src/services/terminal/__tests__/issue_4271_apple_requirements.implementor.test.ts,
 *      which pins this to null until the toolkit lands.
 * The modal then shows once per user and device, on iPhone only (never Android),
 * only to a brand owner or admin (tapToPayMayAcceptTerms) on a live, eligible brand.
 */
export interface TapToPayAwarenessAssets {
  /** The result of require() on the toolkit image. */
  hero: number;
  title: string;
  body: string;
}

export const TAP_TO_PAY_AWARENESS: TapToPayAwarenessAssets | null = null;
