/**
 * #3872 — Creator roster.
 * Thin route: the screen lives behind the Creator and Referral program's one
 * lazy owner (src/components/programs/creatorProgramOwner.ts), so program
 * code stays out of the eager web chunk until a Host opens it.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — thin lazy route; the loaded program screen pads its own safe area (ProgramScreen / BlastRedirect).
import React, { Suspense } from "react";

const Screen = React.lazy(async () => {
  const mod = await import("../../../../src/components/programs/creatorProgramOwner");
  return { default: mod.CreatorRosterScreen };
});

export default function CreatorRoster(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  );
}
