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
