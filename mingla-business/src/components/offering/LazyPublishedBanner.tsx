/**
 * issue #3237 — lazy host for the "just published" banner.
 *
 * Four manage routes mount the banner (event, RSVP, trip, experience). A static
 * import from each would make Metro hoist the banner and its UI-kit graph into
 * the eager `__common` chunk every buyer downloads, for something only a host
 * sees for a moment after publishing. Same treatment, and same reason, as
 * LazyExperienceCreatorWizard and the lazy EventTicketCheckoutAccessCard.
 *
 * The fallback is null: the banner is a confirmation, not content the screen
 * waits on.
 */

import React from "react";

import type { PublishedBannerProps } from "./PublishedBanner";

const PublishedBannerImpl = React.lazy(async () => {
  const module = await import("./PublishedBanner");
  return { default: module.PublishedBanner };
});

export const LazyPublishedBanner: React.FC<PublishedBannerProps> = (props) => (
  <React.Suspense fallback={null}>
    <PublishedBannerImpl {...props} />
  </React.Suspense>
);
