/**
 * #4490 — web: the guest pay pages' Mingla wordmark as a plain <img> of the
 * public /brand/mingla-wordmark.png (as BusinessWelcomeScreen draws it), so no
 * image asset enters the web bundle. Three public routes share it, so the web
 * build hoists it into the eager chunk: keep it this small (no imports beyond
 * React). Sizes match GuestPayWordmark.tsx (30 high, the logo's 1356 x 480).
 */
import React from "react";

export function GuestPayWordmark(): React.ReactElement {
  return React.createElement("img", {
    src: "/brand/mingla-wordmark.png",
    alt: "Mingla",
    "data-testid": "guest-pay-wordmark",
    style: { width: 85, height: 30, objectFit: "contain", display: "block" },
  });
}
