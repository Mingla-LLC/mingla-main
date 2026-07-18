/**
 * usePartnerLinkInviteMutations — ORCH-1384 sheet-only React Query mutations
 * for the PENDING-invite verbs (cancel + reissue).
 *
 * WHY SPLIT FROM usePartnerBrandLinkMutations (ORCH-1384 web eager-bundle
 * budget fix): these two hooks — and useCancelPendingLink's large cache-surgery
 * body — are used ONLY by the lazy PartnerLinkDetailSheet. Keeping them in the
 * shared mutations module (which the eager Team MemberDetailSheet also imports
 * for useDisconnectLink) dragged their bulk into the web boot `__common` chunk,
 * blowing the ORCH-1083 initial-bundle budget. Living here — imported ONLY by
 * the lazy sheet — they land in the sheet's async chunk instead.
 * useDisconnectLink stays in usePartnerBrandLinkMutations (genuinely shared
 * with the Team screen). Their service verbs mirror this split
 * (services/partnerLinkVerbs vs partnerBrandLinksService).
 *
 * Error contract (Const #3): every mutation carries onError; the caller's
 * mutateAsync receives the typed throw (pessimistic pattern) and the SHEET
 * renders the §5.6 copy INLINE in the current step. Success invalidates
 * partnerBrandLinksKeys.all.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { partnerBrandLinksKeys } from "../services/partnerBrandLinksService";
import {
  cancelPendingLink,
  reissueInvitation,
  type CancelPendingResult,
} from "../services/partnerLinkVerbs";
import { brandKeys } from "./brandKeys";
import { brandRoleKeys } from "./useCurrentBrandRole";
import { creatorAccountKeys, type CreatorAccountRow } from "./useCreatorAccount";
import type { Brand } from "../store/currentBrandStore";

// ---------------------------------------------------------------------------
// useCancelPendingLink
// ---------------------------------------------------------------------------

export interface CancelPendingLinkInput {
  linkId: string;
  /** The pre-accept brand the cancel will soft-delete (cache surgery target). */
  brandId: string;
  /** Caller's account id — scopes the brand list/creator-account caches. */
  accountId: string;
}

export interface UseCancelPendingLinkResult {
  mutateAsync: (input: CancelPendingLinkInput) => Promise<CancelPendingResult>;
  isPending: boolean;
}

export const useCancelPendingLink = (): UseCancelPendingLinkResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<
    CancelPendingResult,
    Error,
    CancelPendingLinkInput
  >({
    mutationFn: async ({ linkId }) => cancelPendingLink(linkId),
    onSuccess: (result, { brandId, accountId }) => {
      if (!result.rejected) {
        // Mirror useSoftDeleteBrand's ORCH-1062 semantics EXACTLY: the server
        // just soft-deleted the pre-accept brand inside the RPC transaction —
        // synchronously drop it from the list cache so useCurrentBrandRecovery
        // can never re-resolve it during the background refetch (the
        // "Maximum update depth exceeded" render-loop class).
        queryClient.setQueryData<Brand[]>(brandKeys.list(accountId), (prev) =>
          prev !== undefined ? prev.filter((b) => b.id !== brandId) : prev,
        );
        // Clear default_brand_id in the creator-account cache if it pointed at
        // the deleted brand (the RPC already cleared it server-side).
        queryClient.setQueryData<CreatorAccountRow | null>(
          creatorAccountKeys.byId(accountId),
          (prev) =>
            prev != null && prev.default_brand_id === brandId
              ? { ...prev, default_brand_id: null }
              : prev,
        );
        // Invalidate list — server-truth backstop.
        queryClient.invalidateQueries({ queryKey: brandKeys.list(accountId) });
        // Clear detail / role / cascade-preview caches for the dead brand.
        queryClient.removeQueries({ queryKey: brandKeys.detail(brandId) });
        queryClient.removeQueries({
          queryKey: brandRoleKeys.allForBrand(brandId),
        });
        queryClient.removeQueries({
          queryKey: brandKeys.cascadePreview(brandId),
        });
        // Refresh every partner-links read (list variants + owner reads).
        queryClient.invalidateQueries({
          queryKey: partnerBrandLinksKeys.all,
        });
      }
      // On rejection (has_upcoming_events): the sheet renders the Decision-11
      // reject step; ZERO writes happened server-side → no cache changes.
    },
    onError: () => {
      // Caller's mutateAsync still receives the typed throw — pessimistic
      // pattern; PartnerLinkDetailSheet renders the §5.6 copy inline.
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

// ---------------------------------------------------------------------------
// useReissueInvitation
// ---------------------------------------------------------------------------

export interface ReissueInvitationInput {
  linkId: string;
  /** Omit for same-email resend; set for the correct-email path. */
  newEmail?: string;
}

export interface UseReissueInvitationResult {
  mutateAsync: (
    input: ReissueInvitationInput,
  ) => Promise<{ invitationId: string }>;
  isPending: boolean;
}

export const useReissueInvitation = (): UseReissueInvitationResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<
    { invitationId: string },
    Error,
    ReissueInvitationInput
  >({
    mutationFn: async ({ linkId, newEmail }) =>
      reissueInvitation(linkId, newEmail),
    onSuccess: () => {
      // invited_at (and possibly the email value) changed on the link.
      queryClient.invalidateQueries({ queryKey: partnerBrandLinksKeys.all });
    },
    onError: () => {
      // Typed throw (email_send_failed / link_not_pending / …) renders
      // inline in the sheet per §5.6.
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
