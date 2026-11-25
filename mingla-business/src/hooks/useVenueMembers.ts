/**
 * #4490 P6 — a venue's members (Host): the list with its tiles
 * (`issue_4490_venue_members`), one member with their months and timeline
 * (`issue_4490_venue_member`), staff actions (`issue_4490_manage_member`:
 * pause, resume, end, keep, send the payment link, mark a month paid) and the
 * door's member check-in (`venue-check-in` `admit_member`). React Query only.
 * Every write refreshes the member, the list, the door list and the day
 * (a member check-in counts on Today).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  admitMember,
  fetchVenueMember,
  fetchVenueMembers,
  manageVenueMember,
} from "../services/venueMembersService";
import type { ScanOutcome } from "../types/venueOffers";
import type {
  ManageMemberAction,
  MembersServerFilter,
  VenueMemberDetail,
  VenueMembersList,
} from "../types/venueMembers";
import { venueFeatureKeys } from "./venueFeatureKeys";

function ready(brandId: string | null, venueId: string | null): boolean {
  return brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
}

export function useVenueMembers(
  brandId: string | null,
  venueId: string | null,
  filter: MembersServerFilter = "all",
): UseQueryResult<VenueMembersList> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && ready(brandId, venueId);
  return useQuery<VenueMembersList>({
    queryKey: enabled
      ? venueFeatureKeys.members(brandId as string, venueId as string, filter)
      : (["venueMembers", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () => fetchVenueMembers(venueId as string, filter),
  });
}

export function useVenueMember(
  brandId: string | null,
  venueId: string | null,
  subscriptionId: string | null,
): UseQueryResult<VenueMemberDetail> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && ready(brandId, venueId) && subscriptionId !== null && subscriptionId.length > 0;
  return useQuery<VenueMemberDetail>({
    queryKey: enabled
      ? venueFeatureKeys.member(brandId as string, venueId as string, subscriptionId as string)
      : (["venueMember", "disabled"] as const),
    enabled,
    staleTime: 10_000,
    queryFn: () => fetchVenueMember(subscriptionId as string),
  });
}

function useInvalidateMembers(brandId: string | null, venueId: string | null): () => void {
  const queryClient = useQueryClient();
  return () => {
    if (brandId === null || venueId === null) return;
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.memberAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.membersAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.membershipPlans(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.checkInsAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayAll(brandId, venueId) });
  };
}

export function useManageVenueMember(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<VenueMemberDetail, Error, { subscriptionId: string; expectedVersion: number; change: ManageMemberAction }> {
  const invalidate = useInvalidateMembers(brandId, venueId);
  return useMutation({
    mutationFn: (input) => manageVenueMember(input),
    onSettled: invalidate,
  });
}

export function useAdmitMember(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<ScanOutcome, Error, { subscriptionId: string; guests: number }> {
  const invalidate = useInvalidateMembers(brandId, venueId);
  return useMutation({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return admitMember({ venueId, ...input });
    },
    onSettled: invalidate,
  });
}
