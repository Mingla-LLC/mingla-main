/**
 * #4490 — web: the guest pay pages' Mingla wordmark as a plain <img> of the
 * public /brand/mingla-wordmark.png (as BusinessWelcomeScreen draws it), so no
 * image asset enters the web bundle. Three public routes share it, so the web
 * build hoists it into the eager chunk: keep it this small (no imports beyond
 * React). Sizes match GuestPayWordmark.tsx (30 high, the logo's 1356 x 480).
 */
import React from "react";

/** Same values as the native twin (the web shim must export what it exports). */
export const GUEST_PAY_WORDMARK = {
  label: "Mingla",
  webSrc: "/brand/mingla-wordmark.png",
  height: 30,
  width: Math.round((30 * 1356) / 480),
} as const;

export function GuestPayWordmark(): React.ReactElement {
  return React.createElement("img", {
    src: GUEST_PAY_WORDMARK.webSrc,
    alt: GUEST_PAY_WORDMARK.label,
    "data-testid": "guest-pay-wordmark",
    style: {
      width: GUEST_PAY_WORDMARK.width,
      height: GUEST_PAY_WORDMARK.height,
      objectFit: "contain",
      display: "block",
    },
  });
}
