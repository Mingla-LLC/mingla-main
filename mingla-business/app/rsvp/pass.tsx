import React from "react";

// orch-strict-grep-allow safearea-on-fullscreen-routes — delegated StaticBuyerClaimPage owns SafeScreen edges
import { StaticBuyerClaimPage } from "../../src/components/checkout/StaticBuyerClaimPage";

/** #4063 — forwarded legacy RSVP links reveal no pass or event details. */
export default function RsvpPassRecoveryRoute(): React.ReactElement {
  return (
    <StaticBuyerClaimPage
      kind="pass"
      analyticsSurface="rsvp_pass_legacy"
      scrubFragment
    />
  );
}
