/**
 * #4490 P6 — a venue's membership plans (Host): the read
 * (`issue_4490_membership_plans`) and the plan writer
 * (`issue_4490_manage_membership_plan`: create, update, publish, pause,
 * archive). React Query only. A plan change refreshes the plans, the members
 * list (plan names and caps) and the venue's offers (a plan owns a hidden
 * offering the public page reads).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchMembershipPlans, manageMembershipPlan } from "../services/venueMembersService";
import type { ManagePlanAction, MembershipPlan, MembershipPlansState } from "../types/venueMembers";
import { venueFeatureKeys } from "./venueFeatureKeys";

function ready(brandId: string | null, venueId: string | null): boolean {
  return brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
}

export function useVenueMembershipPlans(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<MembershipPlansState> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && ready(brandId, venueId);
  return useQuery<MembershipPlansState>({
    queryKey: enabled
      ? venueFeatureKeys.membershipPlans(brandId as string, venueId as string)
      : (["venueMembershipPlans", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () => fetchMembershipPlans(venueId as string),
  });
}

export interface ManagePlanInput {
  action: ManagePlanAction;
  payload: Record<string, unknown>;
  expectedVersion?: number | null;
}

export function useManageMembershipPlan(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<MembershipPlan, Error, ManagePlanInput> {
  const queryClient = useQueryClient();
  return useMutation<MembershipPlan, Error, ManagePlanInput>({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return manageMembershipPlan({ venueId, ...input });
    },
    onSettled: () => {
      if (brandId === null || venueId === null) return;
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.membershipPlans(brandId, venueId) });
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.membersAll(brandId, venueId) });
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.offers(brandId, venueId) });
    },
  });
}
