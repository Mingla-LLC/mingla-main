import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { brandTeamMemberKeys } from "../services/brandInvitationsService";
import { listBrandTeamMemberDirectory } from "../services/brandTeamDirectoryService";
import type { BrandTeamDirectoryEntry } from "../utils/brandTeamMemberIdentity";

// Same freshness as the member list it decorates (useBrandInvitations).
const STALE_TIME_MS = 30 * 1000;

/**
 * issue #4271 — accepted members' names and emails, so the team screen never
 * shows a raw user id. Same key factory as the member list. Only the team
 * route uses it, so it is kept out of useBrandInvitations (loaded by several
 * routes) and the eager web __common chunk.
 */
export const useBrandTeamMemberDirectory = (
  brandId: string | null,
): UseQueryResult<BrandTeamDirectoryEntry[]> => {
  const { isAuthReady } = useAuth();
  return useQuery<BrandTeamDirectoryEntry[]>({
    queryKey: brandId !== null
      ? brandTeamMemberKeys.directory(brandId)
      : ["brand-team-members-directory-disabled"],
    enabled: isAuthReady && brandId !== null,
    staleTime: STALE_TIME_MS,
    queryFn: () => listBrandTeamMemberDirectory(brandId as string),
  });
};
