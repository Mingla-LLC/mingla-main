/**
 * useBrandInvitations / useBrandTeamMembers / mutations (ORCH-1050).
 *
 * React Query layer for the brand-team invite flow. Replaces the
 * [TRANSITIONAL] zustand-only reads in /brand/[id]/team. Const #5: server
 * state lives in React Query, never Zustand.
 *
 * Cache invalidation rules:
 *   - inviteBrandMember success → invalidate brandInvitationKeys.list(brandId)
 *   - revokeBrandInvitation success → invalidate brandInvitationKeys.list(brandId)
 *   - acceptBrandInvitation success → invalidate BOTH lists (membership
 *     changed) + brand-role cache for that brand
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  acceptBrandInvitation,
  brandInvitationKeys,
  brandTeamMemberKeys,
  inviteBrandMember,
  listBrandInvitations,
  listBrandTeamMembers,
  revokeBrandInvitation,
  type AcceptBrandInvitationResult,
  type BrandInvitationRow,
  type BrandTeamMemberRow,
  type InviteBrandMemberInput,
  type InviteBrandMemberResult,
} from "../services/brandInvitationsService";
import { brandRoleKeys } from "./useCurrentBrandRole";

// 30s — fresh enough that revoke/accept flips show up quickly; long enough
// that re-renders don't refetch.
const STALE_TIME_MS = 30 * 1000;

export const useBrandInvitations = (
  brandId: string | null,
): UseQueryResult<BrandInvitationRow[]> => {
  return useQuery<BrandInvitationRow[]>({
    queryKey: brandId !== null
      ? brandInvitationKeys.list(brandId)
      : ["brand-invitations-disabled"],
    enabled: brandId !== null,
    staleTime: STALE_TIME_MS,
    queryFn: () => listBrandInvitations(brandId as string),
  });
};

export const useBrandTeamMembers = (
  brandId: string | null,
): UseQueryResult<BrandTeamMemberRow[]> => {
  return useQuery<BrandTeamMemberRow[]>({
    queryKey: brandId !== null
      ? brandTeamMemberKeys.list(brandId)
      : ["brand-team-members-disabled"],
    enabled: brandId !== null,
    staleTime: STALE_TIME_MS,
    queryFn: () => listBrandTeamMembers(brandId as string),
  });
};

export const useInviteBrandMember = (): {
  mutateAsync: (
    input: InviteBrandMemberInput,
  ) => Promise<InviteBrandMemberResult>;
  isPending: boolean;
} => {
  const qc = useQueryClient();
  const mutation = useMutation<
    InviteBrandMemberResult,
    Error,
    InviteBrandMemberInput
  >({
    mutationFn: (input) => inviteBrandMember(input),
    onSuccess: (_result, input) => {
      qc.invalidateQueries({
        queryKey: brandInvitationKeys.list(input.brandId),
      });
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useRevokeBrandInvitation = (
  brandId: string | null,
): {
  mutateAsync: (invitationId: string) => Promise<void>;
  isPending: boolean;
} => {
  const qc = useQueryClient();
  const mutation = useMutation<void, Error, string>({
    mutationFn: (invitationId) => revokeBrandInvitation(invitationId),
    onSuccess: () => {
      if (brandId !== null) {
        qc.invalidateQueries({
          queryKey: brandInvitationKeys.list(brandId),
        });
      }
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useAcceptBrandInvitation = (): {
  mutateAsync: (token: string) => Promise<AcceptBrandInvitationResult>;
  isPending: boolean;
} => {
  const qc = useQueryClient();
  const mutation = useMutation<AcceptBrandInvitationResult, Error, string>({
    mutationFn: (token) => acceptBrandInvitation(token),
    onSuccess: (result) => {
      // Invalidate both invitation + team-member lists for the impacted brand
      // and the brand-role cache (the acceptor's rank just changed).
      qc.invalidateQueries({
        queryKey: brandInvitationKeys.list(result.brandId),
      });
      qc.invalidateQueries({
        queryKey: brandTeamMemberKeys.list(result.brandId),
      });
      qc.invalidateQueries({
        queryKey: brandRoleKeys.allForBrand(result.brandId),
      });
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
