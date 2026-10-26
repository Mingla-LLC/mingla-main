import React from "react";

import { BlastProgramTab } from "../../../../src/components/marketing/BlastProgramTab";

// #3872 round 2 — Blast › Referrals (approved M-blastreferrals): Offers,
// Promoters, Links and Results. `?tab=` picks the section. The Blast layout
// owns the safe area, title bar and sub-nav.
export default function BlastReferralsRoute(): React.ReactElement {
  return <BlastProgramTab program="referrals" />;
}
