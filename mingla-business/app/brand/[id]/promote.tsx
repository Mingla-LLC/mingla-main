/**
 * #3872 round 2 — the separate Promote screen is retired. Promotion for a
 * listing lives in Blast › Overview with that listing picked; this route
 * keeps old links (`?kind=event&listingId=…`) working.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — redirect only; it renders a spinner for one frame and replaces itself with the Blast tab, which owns the safe area.
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { BlastRedirect } from "../../../src/components/marketing/BlastRedirect";
import { blastOverviewHref } from "../../../src/services/promotionOverview";

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default function PromoteRedirect(): React.ReactElement {
  const params = useLocalSearchParams<{
    id?: string | string[];
    kind?: string | string[];
    listingKind?: string | string[];
    listingId?: string | string[];
  }>();
  const href = blastOverviewHref({
    kind: one(params.kind) ?? one(params.listingKind),
    id: one(params.listingId),
  });
  return <BlastRedirect brandId={one(params.id)} href={href} />;
}
