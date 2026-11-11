/**
 * #4271 — Apple's awareness splash: Apple's "Hero – Card to iPhone 9x16 US-EN"
 * in-app banner from the Tap to Pay on iPhone Marketing Toolkit (September 2026).
 *
 * The headline, body and "Terms apply." are baked into the artwork, which was
 * exported from Apple's file with only the "[Your CTA]" placeholder hidden. Do
 * not edit, crop, recolour or overlay the art (Marketing Guide pp. 13-14). The
 * app adds only native controls in the free areas Apple's template leaves: the
 * "Get started" button in the CTA slot, "Not now" under it, and a transparent
 * tap target over "Terms apply." that opens the full disclaimers below.
 *
 * Native only: the root layout's web build (TapToPayAwarenessModal.web.tsx)
 * imports nothing from here, so neither the images nor this text reach the web
 * bundle. Files: mingla-business/assets/tap-to-pay/awareness-hero.jpg (+ @2x,
 * @3x), 360x640 / 720x1280 / 1080x1920.
 *
 * Shown once per user and device, on iPhone only, only to a brand owner or admin
 * (tapToPayMayAcceptTerms) on a live, eligible brand. To switch it off again,
 * set TAP_TO_PAY_AWARENESS to null.
 */

/** A rectangle in the artwork's own pixel frame (ART_FRAME). */
export interface TapToPayArtRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TapToPayAwarenessAssets {
  /** The result of require() on the artwork. */
  hero: number;
  /** The artwork's pixel frame; slots are measured in it, and its ratio is the image's. */
  frame: { width: number; height: number };
  /** What VoiceOver reads for the artwork (its baked-in words). */
  accessibilityLabel: string;
  /** Apple's "[Your CTA]" slot: "Get started" goes here. */
  cta: TapToPayArtRect;
  /** Free band under the CTA: "Not now" goes here (left edge and top only). */
  notNow: { x: number; y: number };
  /** Where the artwork prints "Terms apply.": the tap target that opens the disclaimers. */
  terms: TapToPayArtRect;
}

export const TAP_TO_PAY_AWARENESS: TapToPayAwarenessAssets | null = {
  hero: require("../../assets/tap-to-pay/awareness-hero.jpg") as number,
  frame: { width: 2160, height: 3840 },
  accessibilityLabel:
    "Tap to Pay on iPhone. Accept physical debit and credit cards as well as Apple Pay and other digital wallets. Right on your iPhone.",
  cta: { x: 214, y: 3026, width: 580, height: 224 },
  notNow: { x: 214, y: 3330 },
  terms: { x: 208, y: 3678, width: 399, height: 67 },
};

/** Apple-approved CTA (Marketing Guide p. 33). */
export const TAP_TO_PAY_AWARENESS_CTA = "Get started";

/**
 * The disclaimers behind "Terms apply.", word for word from Apple's Marketing
 * Guide p. 33 ("CTA and disclaimers") and its US copy document: the full
 * disclaimer; the Apple Pay disclaimer (the art mentions Apple Pay); and the
 * EMVCo line for the mark the art's card shows (the Contactless Indicator,
 * four graduating arcs). The "Apple doesn't store card numbers" disclaimer is
 * left out because that copy block isn't used.
 */
export const TAP_TO_PAY_DISCLAIMERS: readonly string[] = [
  "Tap to Pay on iPhone requires a supported payment app and the latest version of iOS. Update to the latest version by going to Settings > General > Software Update. Some contactless cards may not be accepted by your payment app. Transaction limits may apply. Tap to Pay on iPhone is not available in all markets. For Tap to Pay on iPhone countries and regions, see https://developer.apple.com/tap-to-pay/regions/.",
  "Apple Pay is a service provided by Apple Payments Services LLC, a subsidiary of Apple Inc. Neither Apple Inc. nor Apple Payments Services LLC is a bank. Any card used in Apple Pay is offered by the card issuer.",
  "The Contactless Indicator mark, consisting of four graduating arcs, is a trademark owned by and used with permission of EMVCo, LLC.",
];
