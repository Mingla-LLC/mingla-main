/**
 * #3872 round 2 — the Creators home lives in Blast › Creators. This route
 * keeps old links working: it sets the brand and lands there.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — redirect only; it renders a spinner for one frame and replaces itself with the Blast tab, which owns the safe area.
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { BlastRedirect } from "../../../../src/components/marketing/BlastRedirect";
import { blastHubHref } from "../../../../src/components/marketing/marketingSubNavTabs";

export default function BrandCreatorsRedirect(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <BlastRedirect brandId={brandId} href={blastHubHref("creators")} />;
}
