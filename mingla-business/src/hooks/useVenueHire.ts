/**
 * #4490 P4 — private hire on the Host: the requests inbox
 * (`issue_4490_requests_list`), the calendar (`issue_4490_venue_calendar`),
 * next free dates, and the staff actions through `venue-offer-staff`
 * (approve with an edited quote, decline, put next in line, more time,
 * release, block / unblock a space). React Query only. Every read folds
 * isAuthReady into `enabled` (an anon answer would read as "nothing to
 * answer"); every write refreshes requests, the calendar, the day, the door
 * list and the booking, because a hold changes all five.
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
  blockVenueSpace,
  fetchNextFreeDates,
  fetchVenueCalendar,
  fetchVenueRequests,
  holdDamageDeposit,
  releaseDamageDeposit,
  staffRequestAction,
  unblockVenueSpace,
} from "../services/venueOffersService";
import type {
  DamageDepositState,
  NextFreeDate,
  RequestFilter,
  StaffActionResult,
  StaffRequestAction,
  VenueCalendar,
  VenueRequestsList,
} from "../types/venueOffers";
import { randomId } from "../utils/randomId";
import { venueFeatureKeys } from "./venueFeatureKeys";

function ready(brandId: string | null, venueId: string | null): boolean {
  return brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
}

export function useVenueRequests(
  brandId: string | null,
  venueId: string | null,
  filter: RequestFilter,
  options: { enabled?: boolean } = {},
): UseQueryResult<VenueRequestsList> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && ready(brandId, venueId) && options.enabled !== false;
  return useQuery<VenueRequestsList>({
    queryKey: enabled
      ? venueFeatureKeys.requests(brandId as string, venueId as string, filter)
      : (["venueRequests", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: () => fetchVenueRequests(venueId as string, filter),
  });
}

export function useVenueCalendar(
  brandId: string | null,
  venueId: string | null,
  from: string | null,
  to: string | null,
): UseQueryResult<VenueCalendar> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && ready(brandId, venueId) && from !== null && to !== null;
  return useQuery<VenueCalendar>({
    queryKey: enabled
      ? venueFeatureKeys.calendar(brandId as string, venueId as string, from as string, to as string)
      : (["venueCalendar", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    queryFn: () => fetchVenueCalendar(venueId as string, from as string, to as string),
  });
}

export function useNextFreeDates(
  brandId: string | null,
  venueId: string | null,
  input: { offeringId: string | null; priceOptionId: string | null; from: string | null },
): UseQueryResult<NextFreeDate[]> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && ready(brandId, venueId) && input.offeringId !== null && input.priceOptionId !== null && input.from !== null;
  return useQuery<NextFreeDate[]>({
    queryKey: enabled
      ? venueFeatureKeys.nextFreeDates(brandId as string, venueId as string, input.priceOptionId as string, input.from as string)
      : (["venueNextFreeDates", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      fetchNextFreeDates({
        offeringId: input.offeringId as string,
        priceOptionId: input.priceOptionId as string,
        from: input.from,
        limit: 3,
      }),
  });
}

function useInvalidateHire(brandId: string | null, venueId: string | null): (groupId?: string | null) => void {
  const queryClient = useQueryClient();
  return (groupId) => {
    if (brandId === null || venueId === null) return;
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.requestsAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.calendarAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.checkInsAll(brandId, venueId) });
    if (groupId !== undefined && groupId !== null) {
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.booking(brandId, venueId, groupId) });
    }
  };
}

export interface StaffRequestInput {
  action: StaffRequestAction;
  groupId: string;
  expectedVersion: number;
  /** One key per attempt: a retry of the same tap reuses it. */
  idempotencyKey?: string;
  quoteEdit?: { baseMinor: number; note?: string } | null;
  note?: string | null;
  reason?: string | null;
  alternatives?: string[];
  hours?: 12 | 24 | 48;
}

/** Approve, decline, put next in line, give more time, or release a hold. */
export function useStaffRequestAction(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<StaffActionResult, Error, StaffRequestInput> {
  const invalidate = useInvalidateHire(brandId, venueId);
  return useMutation<StaffActionResult, Error, StaffRequestInput>({
    mutationFn: (input) =>
      staffRequestAction({
        ...input,
        idempotencyKey: input.idempotencyKey ?? `staff-${input.action}-${randomId()}`,
      }),
    onSettled: (_data, _error, input) => invalidate(input.groupId),
  });
}

export type BlockInput =
  | { kind: "block"; from: string; to: string; reason: string | null; spaceIds?: string[]; combinationId?: string }
  | { kind: "unblock"; claimId: string };

/** Block a space (or a combination) for a while, or lift a block. */
export function useSpaceBlock(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, BlockInput> {
  const invalidate = useInvalidateHire(brandId, venueId);
  return useMutation<void, Error, BlockInput>({
    mutationFn: async (input) => {
      if (venueId === null) throw new Error("venue_required");
      if (input.kind === "unblock") {
        await unblockVenueSpace({ venueId, claimId: input.claimId, idempotencyKey: `unblock-${randomId()}` });
        return;
      }
      await blockVenueSpace({
        venueId,
        from: input.from,
        to: input.to,
        reason: input.reason,
        spaceIds: input.spaceIds,
        combinationId: input.combinationId,
        idempotencyKey: `block-${randomId()}`,
      });
    },
    onSettled: () => invalidate(null),
  });
}

export type DamageDepositInput =
  | { kind: "release"; keepMinor: number; reason: string | null; idempotencyKey: string }
  | { kind: "hold"; reason: string; idempotencyKey: string };

/** #4490 P4 follow-up — return the damage deposit (all, or keep part with a reason), or keep holding it. */
export function useDamageDeposit(
  brandId: string | null,
  venueId: string | null,
  groupId: string,
): UseMutationResult<DamageDepositState | null, Error, DamageDepositInput> {
  const invalidate = useInvalidateHire(brandId, venueId);
  return useMutation<DamageDepositState | null, Error, DamageDepositInput>({
    mutationFn: (input) =>
      input.kind === "release"
        ? releaseDamageDeposit({ groupId, keepMinor: input.keepMinor, reason: input.reason, idempotencyKey: input.idempotencyKey })
        : holdDamageDeposit({ groupId, reason: input.reason, idempotencyKey: input.idempotencyKey }),
    onSettled: () => invalidate(groupId),
  });
}
