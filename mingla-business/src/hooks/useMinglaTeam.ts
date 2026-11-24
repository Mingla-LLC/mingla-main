import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { brandTeamMemberKeys } from "../services/brandInvitationsService";
import {
  getMinglaTeamState,
  minglaTeamKeys,
  removeMinglaTeam,
  restoreMinglaTeam,
  type MinglaTeamState,
} from "../services/minglaTeamService";
import { brandRoleKeys } from "./useCurrentBrandRole";

// Same freshness as the member list it sits under.
const STALE_TIME_MS = 30 * 1000;

/**
 * #4579 — whether the brand's "Mingla Team" entry is on, off or not there.
 * Only the Team & permissions route uses it.
 */
export const useMinglaTeamState = (
  brandId: string | null,
): UseQueryResult<MinglaTeamState> => {
  const { isAuthReady } = useAuth();
  return useQuery<MinglaTeamState>({
    queryKey: brandId !== null
      ? minglaTeamKeys.state(brandId)
      : ["brand-team-members", "mingla-team", "disabled"],
    enabled: isAuthReady && brandId !== null,
    staleTime: STALE_TIME_MS,
    queryFn: () => getMinglaTeamState(brandId as string),
  });
};

/**
 * #4579 — remove (brand admin and up) or add back (owner) Mingla Team. Errors
 * are thrown to the caller, which shows the sheet's error toast.
 */
export const useMinglaTeamMutations = (
  brandId: string | null,
): {
  remove: () => Promise<void>;
  restore: () => Promise<void>;
  removePending: boolean;
  restorePending: boolean;
} => {
  const qc = useQueryClient();
  const refresh = (): void => {
    if (brandId === null) return;
    void qc.invalidateQueries({ queryKey: minglaTeamKeys.state(brandId) });
    void qc.invalidateQueries({ queryKey: brandTeamMemberKeys.list(brandId) });
    void qc.invalidateQueries({ queryKey: brandTeamMemberKeys.directory(brandId) });
    void qc.invalidateQueries({ queryKey: brandRoleKeys.allForBrand(brandId) });
  };
  const missingBrand = (): Promise<never> => Promise.reject(new Error("brandId required"));
  const removeMutation = useMutation<void, Error, void>({
    mutationFn: () => (brandId === null ? missingBrand() : removeMinglaTeam(brandId)),
    onSuccess: refresh,
  });
  const restoreMutation = useMutation<void, Error, void>({
    mutationFn: () => (brandId === null ? missingBrand() : restoreMinglaTeam(brandId)),
    onSuccess: refresh,
  });
  return {
    remove: () => removeMutation.mutateAsync(),
    restore: () => restoreMutation.mutateAsync(),
    removePending: removeMutation.isPending,
    restorePending: restoreMutation.isPending,
  };
};
