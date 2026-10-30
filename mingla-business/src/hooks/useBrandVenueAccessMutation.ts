import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  BrandInvitationServiceError,
  brandTeamMemberKeys,
  type VenueAccessGrant,
  updateBrandTeamMemberVenueGrants,
} from "../services/brandInvitationsService";

/** Team-route-only mutation; kept outside the shared invitation hook bundle. */
export function useUpdateBrandTeamMemberVenueGrants(
  brandId: string | null,
): {
  mutateAsync: (input: {
    memberId: string;
    grants: VenueAccessGrant[];
  }) => Promise<void>;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation<
    void,
    Error,
    { memberId: string; grants: VenueAccessGrant[] }
  >({
    mutationFn: ({ memberId, grants }) => {
      if (brandId === null) {
        return Promise.reject(
          new BrandInvitationServiceError("unauthenticated", 401),
        );
      }
      return updateBrandTeamMemberVenueGrants(brandId, memberId, grants);
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: brandTeamMemberKeys.list(brandId),
        });
      }
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
}
