import React from "react";
import { SiteBuildView } from "../SiteBuildView";
import { useBrandSiteLabel } from "../../../hooks/useBrandSite";
import { useBrandSitePlan } from "../../../sites/planApi";
import { BrandSitesError } from "../../../services/brandSitesService";
import { planMenuPreview, type PlanPartKey } from "../../../../../packages/site-contracts/src/sitePlan.ts";

/** #2829 W9a / #2830 — plan part 6, before it starts: "Create website draft". */
export function BuildPart({ brandId, onBuild, onDone, readOnly = false }: {
  brandId: string;
  readOnly?: boolean;
  onBuild: () => void;
  onDone: (next: PlanPartKey) => void;
}): React.ReactElement {
  const plan = useBrandSitePlan(brandId);
  const label = useBrandSiteLabel(brandId, plan.data?.canManage === true && plan.data.entitled);
  const offerings = plan.data?.plan?.offeringsSelected ?? plan.data?.prefillOfferings ?? [];
  const loadError = plan.isError
    ? plan.error instanceof BrandSitesError ? plan.error.message : "Your website plan could not be loaded."
    : null;
  return (
    <SiteBuildView
      isLoading={plan.isLoading}
      loadError={loadError}
      canManage={!readOnly && plan.data?.canManage === true}
      approved={Boolean(plan.data?.plan?.approvedAt)}
      pagesLine={planMenuPreview(offerings, plan.data?.plan?.story?.main_action ?? null)}
      address={label.data?.hostname ?? null}
      hasSite={plan.data?.site != null}
      onBuild={onBuild}
      onApproveFirst={() => onDone("approve")}
      onRetry={() => { void plan.refetch(); }}
    />
  );
}
