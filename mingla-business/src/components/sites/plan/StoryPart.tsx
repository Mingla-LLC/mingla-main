import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SiteStoryView } from "../SiteStoryView";
import { useBrandSitePlan, useSaveBrandSitePlan } from "../../../sites/planApi";
import { BrandSitesError } from "../../../services/brandSitesService";
import { approvedPlanFrom } from "../../../sites/planScreens";
import type { SitePlanStory } from "../../../sites/sitePlanState";
import { mainActionChips, storyQuestions, type PlanPartKey } from "../../../../../packages/site-contracts/src/sitePlan.ts";
import { storyAnswerProblem } from "../../../../../packages/site-contracts/src/claims.ts";

/** #2829 W9a — plan parts 4 (Your story) and 5 (Approve the plan). */
export function StoryPart({ brandId, step, onDone, readOnly = false }: {
  brandId: string;
  step: "questions" | "approve";
  readOnly?: boolean;
  /** Where to go next, on this same screen. */
  onDone: (next: PlanPartKey) => void;
}): React.ReactElement {
  const plan = useBrandSitePlan(brandId);
  const save = useSaveBrandSitePlan(brandId);
  const [story, setStory] = useState<SitePlanStory | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (plan.data && story === null) setStory(plan.data.plan?.story ?? {});
  }, [plan.data, story]);

  const offerings = plan.data?.plan?.offeringsSelected ?? plan.data?.prefillOfferings ?? [];
  const current = story ?? {};
  const summary = useMemo(() => (plan.data ? approvedPlanFrom(plan.data, current) : {}), [plan.data, current]);
  const brandDone = plan.data?.parts.find((part) => part.key === "brand")?.done === true;
  const offerDone = plan.data?.parts.find((part) => part.key === "offer")?.done === true;
  const approveBlocked = !offerDone
    ? "Tell us what you'll offer first (part 1), so your plan knows which pages to build."
    : !brandDone
      ? "Your plan needs your brand's name and one line about it. That's all that's required; everything else can wait."
      : null;

  const fail = (error: unknown, fallback: string) =>
    setNotice({ kind: "error", message: error instanceof BrandSitesError ? error.message : fallback });

  const onSaveAnswers = useCallback(() => {
    if (!plan.data) return;
    setNotice(null);
    const cleaned: SitePlanStory = {};
    for (const key of ["who", "why", "main_action"] as const) {
      const value = current[key]?.trim();
      if (value) cleaned[key] = value;
    }
    // #2830 — the answers become page copy: the publish truth check's rules
    // run now (the same ones Ari uses), so nothing publish would refuse saves.
    const problem = storyAnswerProblem(Object.values(cleaned).join(" "), plan.data.completeness?.fields ?? []);
    if (problem) {
      setNotice({ kind: "error", message: problem });
      return;
    }
    save.mutate(
      { revision: plan.data.plan?.revision ?? 0, patch: { story: Object.keys(cleaned).length ? cleaned : null } },
      {
        onSuccess: () => onDone("approve"),
        onError: (error) => fail(error, "Your answers didn't save. Try again."),
      },
    );
  }, [plan.data, current, save, onDone]);

  const onApprove = useCallback(() => {
    if (!plan.data) return;
    setNotice(null);
    save.mutate(
      { revision: plan.data.plan?.revision ?? 0, patch: { approve: true, approved_plan: summary } },
      {
        onSuccess: () => onDone("build"),
        onError: (error) => fail(error, "The plan wasn't approved. Try again."),
      },
    );
  }, [plan.data, summary, save, onDone]);

  const loadError = plan.isError
    ? plan.error instanceof BrandSitesError ? plan.error.message : "Your website plan could not be loaded."
    : null;

  return (
    <SiteStoryView
      step={step}
      isLoading={plan.isLoading || (plan.isSuccess && story === null)}
      loadError={loadError}
      readOnly={readOnly || plan.data?.canManage !== true}
      questions={storyQuestions(offerings)}
      chips={mainActionChips(offerings)}
      story={current}
      summary={summary}
      approved={Boolean(plan.data?.plan?.approvedAt)}
      approveBlocked={approveBlocked}
      isSaving={save.isPending}
      notice={notice}
      onChange={(key, value) => setStory((prev) => ({ ...(prev ?? {}), [key]: value }))}
      onSaveAnswers={onSaveAnswers}
      onApprove={onApprove}
      onEditBrand={() => onDone("brand")}
      onChangeSomething={onDone}
      onRetry={() => { void plan.refetch(); }}
    />
  );
}
