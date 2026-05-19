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
  type MenuFilePayload,
  type ParseMenuResponse,
} from "../services/experienceGenerationService";
import { experienceKeys } from "./useExperiencesByBrand";

export const pendingExperienceKeys = {
  all: ["pendingExperiences"] as const,
  byBrand: (brandId: string) => [...pendingExperienceKeys.all, brandId] as const,
};

export function usePendingExperiences(brandId: string | null) {
  const qc = useQueryClient();

  const pendingQuery = useQuery<HubPendingExperienceRow[]>({
    queryKey: pendingExperienceKeys.byBrand(brandId ?? ""),
    queryFn: () => fetchPendingExperiencesForBrand(brandId!),
    enabled: brandId !== null && brandId.length > 0,
    staleTime: 10_000,
  });

  const parseMutation = useMutation({
    mutationFn: (files: MenuFilePayload[]) =>
      parseRestaurantMenu({ brand_id: brandId!, files }),
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

  const parseMenu = useCallback(
    async (files: MenuFilePayload[]): Promise<ParseMenuResponse> =>
      parseMutation.mutateAsync(files),
    [parseMutation],
  );

  return {
    pending: pendingQuery.data ?? [],
    isLoadingPending: pendingQuery.isLoading,
    parseMenu,
    isParsing: parseMutation.isPending,
    confirm: confirmMutation.mutateAsync,
    reject: rejectMutation.mutateAsync,
    isConfirming: confirmMutation.isPending || rejectMutation.isPending,
  };
}
