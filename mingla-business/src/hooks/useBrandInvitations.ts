/**
 * useBrandInvitations / useBrandTeamMembers / mutations (ORCH-1050).
 *
 * React Query layer for the brand-team invite flow. Replaces the
 * [TRANSITIONAL] zustand-only reads in /brand/[id]/team (exit condition: ORCH-1050 — now React Query). Const #5: server
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
  acceptMyPendingInvitation,
  brandInvitationKeys,
  brandTeamMemberKeys,
  declineBrandInvitation,
  inviteBrandMember,
  listBrandInvitations,
  listMyPendingInvites,
  listBrandTeamMembers,
  revokeBrandInvitation,
  type AcceptBrandInvitationResult,
  type BrandInvitationRow,
  type BrandTeamMemberRow,
  type InviteBrandMemberInput,
  type InviteBrandMemberResult,
  type PendingInviteRow,
} from "../services/brandInvitationsService";
import { brandRoleKeys } from "./useCurrentBrandRole";
import { brandKeys } from "./useBrands";
import { businessNotificationKeys } from "./useBusinessNotifications";
import { useAuth } from "../context/AuthContext";

// 30s — fresh enough that revoke/accept flips show up quickly; long enough
// that re-renders don't refetch.
const STALE_TIME_MS = 30 * 1000;

export const useBrandInvitations = (
  brandId: string | null,
): UseQueryResult<BrandInvitationRow[]> => {
  const { isAuthReady } = useAuth();
  return useQuery<BrandInvitationRow[]>({
    queryKey: brandId !== null
      ? brandInvitationKeys.list(brandId)
      : ["brand-invitations-disabled"],
    enabled: isAuthReady && brandId !== null,
    staleTime: STALE_TIME_MS,
    queryFn: () => listBrandInvitations(brandId as string),
  });
};

export const useBrandTeamMembers = (
  brandId: string | null,
): UseQueryResult<BrandTeamMemberRow[]> => {
  const { isAuthReady } = useAuth();
  return useQuery<BrandTeamMemberRow[]>({
    queryKey: brandId !== null
      ? brandTeamMemberKeys.list(brandId)
      : ["brand-team-members-disabled"],
    enabled: isAuthReady && brandId !== null,
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

/**
 * ORCH-1111 — the signed-in user's own pending invites (email-keyed, resolved
 * server-side). `enabled` carries the flash-safe gate computed by the caller
 * (auth + brand-resolution settled). Disabled when userId is null.
 */
export const useMyPendingInvites = (
  userId: string | null,
  enabled: boolean,
): UseQueryResult<PendingInviteRow[]> => {
  const { isAuthReady } = useAuth();
  return useQuery<PendingInviteRow[]>({
    queryKey: userId !== null
      ? brandInvitationKeys.myPending(userId)
      : ["brand-invitations-my-pending-disabled"],
    enabled: isAuthReady && userId !== null && enabled,
    staleTime: STALE_TIME_MS,
    queryFn: () => listMyPendingInvites(),
  });
};

/**
 * ORCH-1111 — accept one of the signed-in user's OWN pending invites in-app.
 * Invalidates the pending list, the brand list (new membership), the brand's
 * role cache, and the notification list (the bell row clears).
 */
export const useAcceptMyInvitation = (
  userId: string | null,
): {
  mutateAsync: (invitationId: string) => Promise<AcceptBrandInvitationResult>;
  isPending: boolean;
} => {
  const qc = useQueryClient();
  const mutation = useMutation<AcceptBrandInvitationResult, Error, string>({
    mutationFn: (invitationId) => acceptMyPendingInvitation(invitationId),
    onSuccess: (result) => {
      if (userId !== null) {
        qc.invalidateQueries({
          queryKey: brandInvitationKeys.myPending(userId),
        });
        qc.invalidateQueries({ queryKey: brandKeys.list(userId) });
        qc.invalidateQueries({
          queryKey: businessNotificationKeys.all(userId),
        });
      }
      qc.invalidateQueries({
        queryKey: brandRoleKeys.allForBrand(result.brandId),
      });
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

/**
 * ORCH-1111 — decline one of the signed-in user's OWN pending invites in-app.
 * Invalidates the pending list + the notification list so the row + bell clear.
 */
export const useDeclineMyInvitation = (
  userId: string | null,
): {
  mutateAsync: (invitationId: string) => Promise<void>;
  isPending: boolean;
} => {
  const qc = useQueryClient();
  const mutation = useMutation<void, Error, string>({
    mutationFn: (invitationId) => declineBrandInvitation(invitationId),
    onSuccess: () => {
      if (userId !== null) {
        qc.invalidateQueries({
          queryKey: brandInvitationKeys.myPending(userId),
        });
        qc.invalidateQueries({
          queryKey: businessNotificationKeys.all(userId),
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
