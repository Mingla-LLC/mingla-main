/**
 * #3872 round 2 — the brand Creators, Referrals and Promote pages moved into
 * the Blast tab. These are the bodies of their old routes, which still work:
 * each sets the current brand and lands in Blast. They live behind the
 * program's lazy owner so the routes stay thin.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { BlastRedirect } from "../../marketing/BlastRedirect";
import { blastHubHref } from "../../marketing/marketingSubNavTabs";
import { blastOverviewHref } from "../../../services/promotionOverview";

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export function BrandCreatorsRedirect(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  return (
    <BlastRedirect brandId={one(params.id)} href={blastHubHref("creators")} />
  );
}

export function BrandReferralsRedirect(): React.ReactElement {
  const params = useLocalSearchParams<{
    id?: string | string[];
    tab?: string | string[];
  }>();
  return (
    <BlastRedirect
      brandId={one(params.id)}
      href={blastHubHref("referrals", one(params.tab))}
    />
  );
}

export function PromoteRedirect(): React.ReactElement {
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
