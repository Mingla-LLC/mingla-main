/**
 * #4271 — web build of TapToPayAwarenessModal. Apple's awareness splash is for
 * iPhone hosts only and Tap to Pay never runs on the web, so the root layout
 * mounts nothing here and the Tap to Pay hooks and copy stay out of the eager
 * web bundle.
 */
import type React from "react";

export const tapAwarenessSeenKey = (userId: string): string =>
  `mingla.tapToPay.awarenessSeen.v1.${userId}`;

export const TapToPayAwarenessModal = (_props: { assets?: unknown }): React.ReactElement | null => null;

/** #4389 HT — no splash on the web: the caller opens setup itself. */
export const openTapToPayAwareness = (_brandId: string): boolean => false;

/** Web never shows the splash (Tap to Pay is native only). Same signature as native. */
export function tapAwarenessAutoShowAllowed(_input: {
  pathname: string | null;
  setupComplete: boolean;
}): boolean {
  return false;
}
