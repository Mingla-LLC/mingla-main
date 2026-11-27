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
import type { Brand } from "../types/brand";
import { brandSetupKey } from "./useBrandSetupChecklist";

/**
 * #4389 N3 (Seth 2026-11-11) — every brand whose setup checklist is not
 * complete reads as unfinished in the switcher, free-only included. Only a
 * true draft (server `is_draft`) can be discarded; the one-draft rule reads
 * `draft` alone.
 * #4389 P7 (Seth 2026-11-18) — and only `draft` is labelled "Draft" in the
 * switcher; `free_only` and `incomplete` rows show their tag or count alone.
 * `free_only` never appears for a brand that can take money: the server
 * derives `free_only_at` as NULL once it can collect (P8).
 */
export type BrandSetupRowState =
  | { kind: "draft"; doneCount: number }
  | { kind: "free_only"; doneCount: number }
  | { kind: "incomplete"; doneCount: number }
  | { kind: "none" };

export function brandSetupRowState(checklist: BrandSetupChecklist | undefined): BrandSetupRowState {
  if (checklist === undefined || checklist.facts.complete) return { kind: "none" };
  if (checklist.facts.isDraft) return { kind: "draft", doneCount: checklist.doneCount };
  if (checklist.facts.freeOnlyAt !== null) return { kind: "free_only", doneCount: checklist.doneCount };
  return { kind: "incomplete", doneCount: checklist.doneCount };
}

type BrandSetupSubject = Pick<Brand, "id" | "accountId">;

export function useBrandSetupStates(brands: readonly BrandSetupSubject[]): {
  byId: Record<string, BrandSetupRowState>;
  /** The host's one draft (S-12), when the answers are in. */
  draftId: string | null;
  isLoading: boolean;
} {
  const { isAuthReady, user } = useAuth();
  const enabled = isAuthReady && user !== null;
  const brandIds = brands.map((brand) => brand.id);
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
    brands.forEach((brand, i) => {
      const state = brandSetupRowState(results[i]?.data);
      byId[brand.id] = state;
      // #4627 — show every team brand's progress, but only the account-owned
      // draft mirrors issue_4389_user_draft_brand and blocks another create.
      if (state.kind === "draft" && draftId === null && user !== null && brand.accountId === user.id) {
        draftId = brand.id;
      }
    });
    return { byId, draftId, isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` stands for the rows.
  }, [brands.map((brand) => `${brand.id}:${brand.accountId ?? ""}`).join(","), stamp, isLoading, user?.id]);
}
