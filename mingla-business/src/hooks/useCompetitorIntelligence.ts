import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { GrowthToolsAppError } from "../services/growthToolsReads";
import { addCompetitor, getCompetitorBrief, listCompetitors, refreshCompetitor, removeCompetitor, updateCompetitor } from "../services/competitorIntelligenceService";
import type { CompetitorSourceInput, CompetitorWatchRow } from "../types/growthTools";
import { growthToolsKeys } from "./growthToolsKeys";
const DISABLED_KEY = ["growth-tools-disabled"] as const;

// ── Competitor watch (G-9..G-13 / P-46) ──────────────────────────────────────

export function useCompetitorWatch(
  brandId: string | null,
  venueListingId: string | null,
): UseQueryResult<CompetitorWatchRow[]> {
  const { loading, session } = useAuth();
  const enabled = !loading &&
    session !== null &&
    brandId !== null &&
    brandId.length > 0 &&
    venueListingId !== null &&
    venueListingId.length > 0;
  return useQuery<CompetitorWatchRow[]>({
    queryKey: enabled && brandId !== null && venueListingId !== null
      ? growthToolsKeys.watch(brandId, venueListingId)
      : DISABLED_KEY,
    enabled,
    staleTime: 60_000,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.some((row) => row.activeJob != null) ? 15_000 : 5 * 60_000;
    },
    queryFn: async () => {
      if (brandId === null || venueListingId === null) {
        throw new Error("watch read disabled");
      }
      return listCompetitors(brandId, venueListingId);
    },
  });
}

export function useAddCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<
  CompetitorWatchRow,
  GrowthToolsAppError,
  { name: string; city: string; sources: CompetitorSourceInput[]; placePoolId?: string | null; competitorId?: string; expectedUpdatedAt?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (competitor) => {
      if (brandId === null || venueListingId === null) {
        throw new GrowthToolsAppError("validation");
      }
      if (competitor.competitorId !== undefined) {
        if (competitor.expectedUpdatedAt === undefined) throw new GrowthToolsAppError("validation");
        return updateCompetitor(brandId, competitor.competitorId, competitor.expectedUpdatedAt, competitor);
      }
      return addCompetitor(brandId, venueListingId, competitor);
    },
    onSuccess: (row) => {
      if (brandId !== null && venueListingId !== null) {
        void queryClient.invalidateQueries({
          queryKey: growthToolsKeys.watch(brandId, venueListingId),
        });
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.brief(brandId, row.id) });
      }
    },
  });
}

export function useUpdateCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<CompetitorWatchRow, GrowthToolsAppError, { competitorId: string; expectedUpdatedAt: string; name: string; city: string; sources: CompetitorSourceInput[] }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ competitorId, expectedUpdatedAt, name, city, sources }) => {
      if (brandId === null) throw new GrowthToolsAppError("validation");
      return updateCompetitor(brandId, competitorId, expectedUpdatedAt, { name, city, sources });
    },
    onSuccess: (row) => {
      if (brandId !== null && venueListingId !== null) {
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.watch(brandId, venueListingId) });
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.brief(brandId, row.id) });
      }
    },
  });
}

export function useRefreshCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<"cached" | "joined" | "queued", GrowthToolsAppError, { competitorId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ competitorId }) => {
      if (brandId === null) throw new GrowthToolsAppError("validation");
      return refreshCompetitor(brandId, competitorId);
    },
    onSuccess: (_result, { competitorId }) => {
      if (brandId !== null && venueListingId !== null) {
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.watch(brandId, venueListingId) });
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.brief(brandId, competitorId) });
      }
    },
  });
}

export function useCompetitorBrief(brandId: string | null, watchId: string | null, enabled = true) {
  const { loading, session } = useAuth();
  const active = enabled && !loading && session !== null && brandId !== null && watchId !== null;
  return useQuery({
    queryKey: active && brandId !== null && watchId !== null ? growthToolsKeys.brief(brandId, watchId) : DISABLED_KEY,
    enabled: active,
    staleTime: 60_000,
    refetchInterval: (query) => {
      const data = query.state.data as Awaited<ReturnType<typeof getCompetitorBrief>> | undefined;
      return data?.freshness === "refreshing" ? 15_000 : false;
    },
    queryFn: async () => {
      if (brandId === null || watchId === null) throw new Error("brief read disabled");
      return getCompetitorBrief(brandId, watchId);
    },
  });
}

export function useRemoveCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<void, GrowthToolsAppError, { competitorId: string; expectedUpdatedAt: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ competitorId, expectedUpdatedAt }) => {
      if (brandId === null) throw new GrowthToolsAppError("validation");
      return removeCompetitor(brandId, competitorId, expectedUpdatedAt);
    },
    onSuccess: () => {
      if (brandId !== null && venueListingId !== null) {
        void queryClient.invalidateQueries({
          queryKey: growthToolsKeys.watch(brandId, venueListingId),
        });
      }
    },
  });
}

