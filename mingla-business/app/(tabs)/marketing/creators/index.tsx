import React from "react";

import { BlastProgramTab } from "../../../../src/components/marketing/BlastProgramTab";

// #3872 round 2 — Blast › Creators (approved M-blastcreators). The Blast
// layout owns the safe area, title bar and sub-nav.
export default function BlastCreatorsRoute(): React.ReactElement {
  return <BlastProgramTab program="creators" />;
}
