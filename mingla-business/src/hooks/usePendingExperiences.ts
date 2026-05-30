/**
 * ORCH-0881 — pending menu-snap experience proposals for a brand.
 */

import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  confirmExperienceProposal,
  fetchPendingExperiencesForBrand,
  parseRestaurantMenu,
  rejectExperienceProposal,
  type HubPendingExperienceRow,
  parsePlayActivities,
  type ExperienceFilePayload,
  type ParseExperienceResponse,
} from "../services/experienceGenerationService";
import { useAuth } from "../context/AuthContext";
import { experienceKeys } from "./useExperiencesByBrand";

export const pendingExperienceKeys = {
  all: ["pendingExperiences"] as const,
  byBrand: (brandId: string) => [...pendingExperienceKeys.all, brandId] as const,
};

export type ExperienceParseMode = "menu" | "activities";

export function usePendingExperiences(
  brandId: string | null,
  parseMode: ExperienceParseMode = "menu",
) {
  const qc = useQueryClient();
  // ORCH-1004 — pending proposals are RLS auth.uid()-scoped; gate on auth
  // readiness so a pre-auth fire can't cache an empty list as success.
  const { isAuthReady } = useAuth();

  const pendingQuery = useQuery<HubPendingExperienceRow[]>({
    queryKey: pendingExperienceKeys.byBrand(brandId ?? ""),
    queryFn: () => fetchPendingExperiencesForBrand(brandId!),
    enabled: isAuthReady && brandId !== null && brandId.length > 0,
    staleTime: 10_000,
  });

  const parseMutation = useMutation({
    mutationFn: (files: ExperienceFilePayload[]) =>
      parseMode === "activities"
        ? parsePlayActivities({ brand_id: brandId!, files })
        : parseRestaurantMenu({ brand_id: brandId!, files }),
    onSuccess: (response) => {
      if (response.kind === "ok" && brandId) {
        qc.invalidateQueries({ queryKey: pendingExperienceKeys.byBrand(brandId) });
      }
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (args: { id: string; edited_args?: Record<string, unknown> }) =>
      confirmExperienceProposal(args.id, args.edited_args),
    onSuccess: () => {
      if (brandId) {
        qc.invalidateQueries({ queryKey: pendingExperienceKeys.byBrand(brandId) });
        qc.invalidateQueries({ queryKey: experienceKeys.listByBrand(brandId) });
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectExperienceProposal(id),
    onSuccess: () => {
      if (brandId) {
        qc.invalidateQueries({ queryKey: pendingExperienceKeys.byBrand(brandId) });
      }
    },
  });

  const parseFiles = useCallback(
    async (files: ExperienceFilePayload[]): Promise<ParseExperienceResponse> =>
      parseMutation.mutateAsync(files),
    [parseMutation],
  );

  return {
    pending: pendingQuery.data ?? [],
    isLoadingPending: pendingQuery.isLoading,
    parseFiles,
    /** @deprecated Use parseFiles */
    parseMenu: parseFiles,
    isParsing: parseMutation.isPending,
    confirm: confirmMutation.mutateAsync,
    reject: rejectMutation.mutateAsync,
    isConfirming: confirmMutation.isPending || rejectMutation.isPending,
  };
}
