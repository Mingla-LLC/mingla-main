import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { SiteOfferingsView, type OfferingsConfirm } from "../SiteOfferingsView";
import { SafeScreen } from "../../../components/ui/SafeScreen";
import { TopBar } from "../../../components/ui/TopBar";
import { canvas } from "../../../constants/designSystem";
import { useBrandSitePlan, useSaveBrandSitePlan } from "../../../sites/planApi";
import { useFeatureFlag } from "../../../hooks/useFeatureFlag";
import { BrandSitesError } from "../../../services/brandSitesService";
import { untickedWithLiveItems } from "../../../sites/planScreens";
import type { PlanOfferingKey } from "../../../../../packages/site-contracts/src/sitePlan.ts";

/** #2829 W9a — plan part 1, "What you'll offer" (native "Do it myself"). */
export function OfferingsPart({ brandId, embedded = false }: { brandId: string; embedded?: boolean }): React.ReactElement {
  const router = useRouter();
  const plan = useBrandSitePlan(brandId);
  const save = useSaveBrandSitePlan(brandId);
  const stay = useFeatureFlag("STAY_VENUE_AUTHORING");
  const [selected, setSelected] = useState<Set<PlanOfferingKey> | null>(null);
  const [descriptor, setDescriptor] = useState<string | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<OfferingsConfirm>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; message: string } | null>(null);

  // Start from what is saved, else what Mingla already knows the brand offers.
  useEffect(() => {
    if (plan.data && selected === null) {
      const initial = plan.data.plan?.offeringsSelected ?? plan.data.prefillOfferings ?? [];
      setSelected(new Set(initial as PlanOfferingKey[]));
      setDescriptor(plan.data.plan?.venueDescriptor ?? null);
    }
  }, [plan.data, selected]);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/brand/${brandId}/website/plan` as never);
  }, [router, brandId]);

  const persist = useCallback(() => {
    if (!plan.data || !selected) return;
    setNotice(null);
    const offerings = [...selected];
    const venue = offerings.some((key) => key.startsWith("venue_"));
    save.mutate(
      {
        revision: plan.data.plan?.revision ?? 0,
        patch: { offerings_selected: offerings, venue_descriptor: venue ? descriptor ?? null : null },
      },
      {
        onSuccess: () => { setConfirm(null); back(); },
        onError: (error) => {
          setConfirm(null);
          setNotice({ kind: "error", message: error instanceof BrandSitesError ? error.message : "Your answer didn't save. Try again." });
        },
      },
    );
  }, [plan.data, selected, descriptor, save, back]);

  const onContinue = useCallback(() => {
    if (!plan.data || !selected) return;
    const saved = plan.data.plan?.offeringsSelected ?? [];
    const live = untickedWithLiveItems(saved, [...selected], plan.data.liveCounts);
    if (live) { setConfirm({ kind: "untick_live", message: live }); return; }
    if (selected.size === 0) { setConfirm({ kind: "nothing_ticked" }); return; }
    persist();
  }, [plan.data, selected, persist]);

  const loadError = plan.isError
    ? plan.error instanceof BrandSitesError ? plan.error.message : "Your website plan could not be loaded."
    : null;

  // #2829 W9r — inside the Website section the shell draws the top bar.
  const body = (
    <>
    <SiteOfferingsView
      isLoading={plan.isLoading || (plan.isSuccess && selected === null)}
      loadError={loadError}
      readOnly={plan.data?.canManage !== true}
      includeStay={stay.data === true}
      selected={selected ?? new Set()}
      descriptor={descriptor ?? null}
      confirm={confirm}
      isSaving={save.isPending}
      notice={notice}
      onToggle={(key) => {
        setConfirm(null);
        setSelected((current) => {
          const next = new Set(current ?? []);
          if (next.has(key)) next.delete(key); else next.add(key);
          return next;
        });
      }}
      onDescriptor={setDescriptor}
      onContinue={onContinue}
      onConfirm={persist}
      onCancelConfirm={() => setConfirm(null)}
      onRetry={() => { void plan.refetch(); }}
    />
    </>
  );
  if (embedded) return body;
  return (
    <SafeScreen style={{ backgroundColor: canvas.discover }}>
      <TopBar leftKind="back" title="What you'll offer" onBack={back} rightSlot={null} />
      {body}
    </SafeScreen>
  );
}
