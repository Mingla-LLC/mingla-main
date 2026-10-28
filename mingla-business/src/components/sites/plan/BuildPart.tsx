import React, { useCallback, useState } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { SiteBuildView } from "../SiteBuildView";
import { SitePreviewPane } from "../SitePreviewPane";
import { SafeScreen } from "../../../components/ui/SafeScreen";
import { TopBar } from "../../../components/ui/TopBar";
import { canvas } from "../../../constants/designSystem";
import { useBrandSiteLabel, useBrandSitePreview } from "../../../hooks/useBrandSite";
import { useBrandSitePlan, useComposeBrandSiteFromPlan } from "../../../sites/planApi";
import { BrandSitesError } from "../../../services/brandSitesService";
import { previewUrlForPage } from "../../../sites/contracts";
import { planMenuPreview } from "../../../../../packages/site-contracts/src/sitePlan.ts";

const PAGE_NAMES: Record<string, string> = {
  home: "Home", trips: "Trips", events: "Events", experiences: "Experiences",
  menu: "Menu", visit: "Visit", rooms: "Rooms", about: "About", contact: "Contact",
};

/** #2829 W9a — plan part 6: "Create website draft". */
export function BuildPart({ brandId, embedded = false }: { brandId: string; embedded?: boolean }): React.ReactElement {
  const router = useRouter();
  const plan = useBrandSitePlan(brandId);
  const label = useBrandSiteLabel(brandId, plan.data?.canManage === true && plan.data.entitled);
  const compose = useComposeBrandSiteFromPlan(brandId);
  const preview = useBrandSitePreview(brandId, plan.data?.site?.id ?? null);
  const [builtLine, setBuiltLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/brand/${brandId}/website/plan` as never);
  }, [router, brandId]);

  const onBuild = useCallback(() => {
    setError(null);
    compose.mutate(undefined, {
      onSuccess: (result) => setBuiltLine(result.pages.map((key) => PAGE_NAMES[key] ?? key).join(" · ")),
      onError: (failure) => setError(failure instanceof BrandSitesError ? failure.message : "Your draft wasn't created. Try again."),
    });
  }, [compose]);

  const onShowDraft = useCallback(() => {
    setError(null);
    preview.mutate(Platform.OS === "web" ? "web" : "native", {
      onSuccess: (result) => setPreviewUrl(previewUrlForPage(result.preview_url, "")),
      onError: (failure) => setError(failure instanceof BrandSitesError ? failure.message : "Your draft couldn't be shown. Try again."),
    });
  }, [preview]);

  const offerings = plan.data?.plan?.offeringsSelected ?? plan.data?.prefillOfferings ?? [];
  const loadError = plan.isError
    ? plan.error instanceof BrandSitesError ? plan.error.message : "Your website plan could not be loaded."
    : null;

  // #2829 W9r — inside the Website section the shell draws the top bar.
  const body = (
    <>
    <SiteBuildView
      isLoading={plan.isLoading}
      loadError={loadError}
      canManage={plan.data?.canManage === true}
      approved={Boolean(plan.data?.plan?.approvedAt)}
      pagesLine={planMenuPreview(offerings, plan.data?.plan?.story?.main_action ?? null)}
      address={label.data?.hostname ?? null}
      hasSite={plan.data?.site != null}
      phase={compose.isPending ? "working" : builtLine ? "done" : "idle"}
      builtLine={builtLine}
      error={error}
      previewLoading={preview.isPending}
      previewPane={previewUrl ? <SitePreviewPane url={previewUrl} /> : null}
      onBuild={onBuild}
      onApproveFirst={() => router.push(`/brand/${brandId}/website/plan?part=approve` as never)}
      onShowDraft={onShowDraft}
      onBackToPlan={() => router.replace(`/brand/${brandId}/website/plan` as never)}
      onRetry={() => { void plan.refetch(); }}
    />
    </>
  );
  if (embedded) return body;
  return (
    <SafeScreen style={{ backgroundColor: canvas.discover }}>
      <TopBar leftKind="back" title="Build your pages" onBack={back} rightSlot={null} />
      {body}
    </SafeScreen>
  );
}
