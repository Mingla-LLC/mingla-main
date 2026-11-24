/**
 * Issue #3493 — keep host-only pricing controls out of the buyer boot payload.
 *
 * Four lazy authoring flows share WhoCoversCostsSection. A static import from
 * each makes Metro hoist the whole pricing/VAT surface into eager `__common`,
 * even though buyers never render it. This host follows the existing lazy
 * component pattern and preserves the section's public props exactly.
 *
 * The fallback is null because the surrounding pricing form is already
 * visible and usable while this small, host-only section is fetched.
 */

import React from "react";

import type { WhoCoversCostsSectionProps } from "./WhoCoversCostsSection";

const WhoCoversCostsSectionImpl = React.lazy(async () => {
  // #4522 — through the shared chunk module so the trip builder's earnings card
  // rides the same chunk (see WhoCoversCostsChunk).
  const module = await import("./WhoCoversCostsChunk");
  return { default: module.WhoCoversCostsSection };
});

export const WhoCoversCostsSection: React.FC<
  WhoCoversCostsSectionProps
> = (props) => (
  <React.Suspense fallback={null}>
    <WhoCoversCostsSectionImpl {...props} />
  </React.Suspense>
);
