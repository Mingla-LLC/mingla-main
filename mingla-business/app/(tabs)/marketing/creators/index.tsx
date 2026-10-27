import React, { Suspense } from "react";

// #3872 round 2 — Blast › Creators (approved M-blastcreators). The Blast layout owns the safe area, title bar
// and sub-nav. The tab loads through the program's one lazy owner so
// program code stays out of the eager web chunk.
const BlastProgramTab = React.lazy(async () => {
  const mod = await import("../../../../src/components/programs/creatorProgramOwner");
  return { default: mod.BlastProgramTab };
});

export default function BlastCreatorsRoute(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <BlastProgramTab program="creators" />
    </Suspense>
  );
}
