/**
 * #4389 (N1, N3) — the brand_setup checklist for every brand in a list, on
 * the same cache entries as useBrandSetupChecklist. Used by the brand
 * switcher (draft / free-only rows) and /brand/new (N1 up front).
 *
 * A draft is a brand still in setup that has not chosen "Free events only
 * for now" and has published nothing (S-12, server `is_draft`).
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import type { BrandSetupChecklist } from "../services/brandSetupService";
import { brandSetupKey } from "./useBrandSetupChecklist";

export type BrandSetupRowState =
  | { kind: "draft"; doneCount: number }
  | { kind: "free_only" }
  | { kind: "none" };

export function brandSetupRowState(checklist: BrandSetupChecklist | undefined): BrandSetupRowState {
  if (checklist === undefined || checklist.facts.complete) return { kind: "none" };
  if (checklist.facts.isDraft) return { kind: "draft", doneCount: checklist.doneCount };
  if (checklist.facts.freeOnlyAt !== null) return { kind: "free_only" };
  return { kind: "none" };
}

export function useBrandSetupStates(brandIds: readonly string[]): {
  byId: Record<string, BrandSetupRowState>;
  /** The host's one draft (S-12), when the answers are in. */
  draftId: string | null;
  isLoading: boolean;
} {
  const { isAuthReady, user } = useAuth();
  const enabled = isAuthReady && user !== null;
  const results = useQueries({
    queries: brandIds.map((brandId) => ({
      queryKey: brandSetupKey(brandId),
      enabled,
      staleTime: 30_000,
      queryFn: async (): Promise<BrandSetupChecklist> => {
        const { fetchBrandSetupChecklist } = await import("../services/brandSetupService");
        return fetchBrandSetupChecklist(brandId);
      },
    })),
  });
  const stamp = results.map((r) => `${r.dataUpdatedAt}`).join(",");
  const isLoading = results.some((r) => r.isLoading);
  return useMemo(() => {
    const byId: Record<string, BrandSetupRowState> = {};
    let draftId: string | null = null;
    brandIds.forEach((id, i) => {
      const state = brandSetupRowState(results[i]?.data);
      byId[id] = state;
      if (state.kind === "draft" && draftId === null) draftId = id;
    });
    return { byId, draftId, isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` stands for the rows.
  }, [brandIds.join(","), stamp, isLoading]);
}
