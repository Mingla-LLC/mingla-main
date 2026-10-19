/**
 * #3040 design AD-04 — the per-platform fit sentence for one ad video, for a
 * surface that does not already hold the Host Ads setup (Ari's ad proposal
 * card). It reads the SAME server-computed `fit` the Host Ads builder shows
 * (`ad-plan` setup → `_shared/adCreativeFit.ts`), so the two surfaces can never
 * disagree. Missing data stays missing: no fit → null → no sentence.
 */
import { useEffect, useState } from "react";

import { reportNonFatal } from "../diagnostics/reportNonFatal";
import { loadHostAdPlanService } from "../services/lazyHostAdPlanService";
import { adVideoFitSummaryFor } from "../utils/adVideoFit";

export const useAdVideoFitSummary = (
  brandId: string | null,
  creativeId: string | null,
): string | null => {
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!brandId || !creativeId) return undefined;
    let alive = true;
    void loadHostAdPlanService()
      .then(({ loadHostAdSetup }) => loadHostAdSetup(brandId))
      .then((setup) => {
        if (!alive) return;
        setSummary(adVideoFitSummaryFor({ creatives: setup.creatives, heldId: creativeId, linked: null }));
      })
      .catch((error: unknown) => {
        // The sentence is informational; the card stays usable without it.
        reportNonFatal("ari.adVideoFit", error, { brandId });
      });
    return () => {
      alive = false;
    };
  }, [brandId, creativeId]);
  return summary;
};
