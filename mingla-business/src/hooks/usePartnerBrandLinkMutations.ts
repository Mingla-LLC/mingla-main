/**
 * usePartnerBrandLinkMutations — ORCH-1384 React Query mutation for the
 * SHARED partner brand-link verb (disconnect).
 *
 *   - useDisconnectLink — dual-stamp disconnect (partner- or owner-initiated;
 *     the RPC resolves the side). Used by BOTH the partner PartnerLinkDetailSheet
 *     AND the Team MemberDetailSheet, so it stays in this shared module.
 *
 * The PENDING-invite verbs (cancel + reissue) live in the sheet-only
 * usePartnerLinkInviteMutations (ORCH-1384 web eager-bundle budget split — they
 * are reachable only from the lazy sheet, so keeping them out of this shared
 * module keeps their bulk out of the web boot `__common` chunk).
 *
 * Error contract (Const #3): the mutation carries onError; the caller's
 * mutateAsync receives the typed throw (pessimistic pattern) and the confirm
 * UI renders the copy inline. Success invalidates partnerBrandLinksKeys.all
 * (both include-cancelled variants + owner reads share that root).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  disconnectLink,
  partnerBrandLinksKeys,
} from "../services/partnerBrandLinksService";
import { brandTeamMemberKeys } from "../services/brandInvitationsService";

// ---------------------------------------------------------------------------
// useDisconnectLink
// ---------------------------------------------------------------------------

export interface DisconnectLinkInput {
  linkId: string;
  /**
   * When set (owner-initiated path from the Team screen), the brand's
   * team-member list cache is invalidated too so the removed partner row
   * disappears (removed_at stamped in the same RPC transaction).
   */
  brandId?: string;
}

export interface UseDisconnectLinkResult {
  mutateAsync: (input: DisconnectLinkInput) => Promise<void>;
  isPending: boolean;
}

export const useDisconnectLink = (): UseDisconnectLinkResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<void, Error, DisconnectLinkInput>({
    mutationFn: async ({ linkId }) => disconnectLink(linkId),
    onSuccess: (_result, { brandId }) => {
      queryClient.invalidateQueries({ queryKey: partnerBrandLinksKeys.all });
      if (brandId !== undefined) {
        queryClient.invalidateQueries({
          queryKey: brandTeamMemberKeys.list(brandId),
        });
      }
    },
    onError: () => {
      // Typed throw surfaces to the confirm UI (inline card / ConfirmDialog
      // errorMessage) — never swallowed.
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
