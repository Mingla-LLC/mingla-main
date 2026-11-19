/**
 * #4490 P3 — one venue booking with its money (Host): the read
 * (`issue_4490_get_booking`), the money and change actions, the door's
 * take-the-balance step, and the day-closure preview. React Query only
 * (constitution #5/#14). Every write refreshes the booking, the venue's days
 * and the door list, because money owed and party sizes show in all three.
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
  balancePayLink,
  changeVenueBooking,
  fetchDayClosurePreview,
  fetchVenueBooking,
  recordOfflinePayment,
  sendBookingReminder,
  staffCancelBooking,
  staffCancelPreview,
  takeBalanceAtDoor,
} from "../services/venueOffersService";
import type {
  BookingChangeAction,
  BookingChangeSummary,
  DayClosurePreview,
  OfflineMethod,
  StaffCancelPreview,
  VenueBookingDetail,
} from "../types/venueOffers";
import { venueFeatureKeys } from "./venueFeatureKeys";

function ready(brandId: string | null, venueId: string | null): boolean {
  return brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
}

export function useVenueBooking(
  brandId: string | null,
  venueId: string | null,
  groupId: string | null,
): UseQueryResult<VenueBookingDetail> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && ready(brandId, venueId) && groupId !== null && groupId.length > 0;
  return useQuery<VenueBookingDetail>({
    queryKey: enabled
      ? venueFeatureKeys.booking(brandId as string, venueId as string, groupId as string)
      : (["venueBooking", "disabled"] as const),
    enabled,
    staleTime: 10_000,
    queryFn: () => fetchVenueBooking(groupId as string),
  });
}

export function useDayClosurePreview(
  brandId: string | null,
  venueId: string | null,
  localDate: string | null,
): UseQueryResult<DayClosurePreview> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && ready(brandId, venueId) && localDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(localDate);
  return useQuery<DayClosurePreview>({
    queryKey: enabled
      ? venueFeatureKeys.dayClosure(brandId as string, venueId as string, localDate as string)
      : (["venueDayClosure", "disabled"] as const),
    enabled,
    staleTime: 10_000,
    queryFn: () => fetchDayClosurePreview(venueId as string, localDate as string),
  });
}

function useInvalidateBooking(brandId: string | null, venueId: string | null): (groupId: string | null) => void {
  const queryClient = useQueryClient();
  return (groupId) => {
    if (brandId === null || venueId === null) return;
    if (groupId !== null) {
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.booking(brandId, venueId, groupId) });
    }
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.checkInsAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayClosureAll(brandId, venueId) });
    // #4490 P4 — a hire's money and state show in Requests and the Calendar too.
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.requestsAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.calendarAll(brandId, venueId) });
  };
}

export type BookingMoneyAction =
  | { kind: "record_payment"; amountMinor: number; method: OfflineMethod; paidOn: string | null; note: string | null }
  | { kind: "reminder" }
  | { kind: "take_at_door"; amountMinor: number; method: OfflineMethod };

export interface BookingMoneyResult {
  balanceMinor: number;
}

/** Mark as paid, take the balance at the door, or send a reminder. */
export function useBookingMoneyAction(
  brandId: string | null,
  venueId: string | null,
  groupId: string | null,
): UseMutationResult<BookingMoneyResult, Error, BookingMoneyAction> {
  const invalidate = useInvalidateBooking(brandId, venueId);
  return useMutation<BookingMoneyResult, Error, BookingMoneyAction>({
    mutationFn: async (action) => {
      if (groupId === null || venueId === null) throw new Error("booking_required");
      if (action.kind === "reminder") {
        const sent = await sendBookingReminder(groupId);
        return { balanceMinor: sent.balanceMinor };
      }
      if (action.kind === "take_at_door") {
        return takeBalanceAtDoor({ venueId, groupId, amountMinor: action.amountMinor, method: action.method });
      }
      return recordOfflinePayment({
        groupId,
        amountMinor: action.amountMinor,
        method: action.method,
        paidOn: action.paidOn,
        note: action.note,
      });
    },
    onSettled: () => invalidate(groupId),
  });
}

/** Preview, then apply, a change of guests, day or extras. */
export function useBookingChange(
  brandId: string | null,
  venueId: string | null,
  groupId: string | null,
): UseMutationResult<
  BookingChangeSummary,
  Error,
  { action: BookingChangeAction; payload: Record<string, unknown>; preview: boolean; expectedVersion?: number | null }
> {
  const invalidate = useInvalidateBooking(brandId, venueId);
  return useMutation({
    mutationFn: (input) => {
      if (groupId === null) throw new Error("booking_required");
      return changeVenueBooking({ groupId, ...input });
    },
    onSettled: (_data, _error, input) => {
      if (!input.preview) invalidate(groupId);
    },
  });
}

export function useStaffCancel(
  brandId: string | null,
  venueId: string | null,
  groupId: string | null,
): {
  preview: UseMutationResult<StaffCancelPreview, Error, void>;
  cancel: UseMutationResult<{ refundMinor: number }, Error, { preview: StaffCancelPreview; reason: string }>;
} {
  const invalidate = useInvalidateBooking(brandId, venueId);
  const preview = useMutation<StaffCancelPreview, Error, void>({
    mutationFn: () => {
      if (groupId === null) throw new Error("booking_required");
      return staffCancelPreview(groupId);
    },
  });
  const cancel = useMutation<{ refundMinor: number }, Error, { preview: StaffCancelPreview; reason: string }>({
    mutationFn: (input) => staffCancelBooking(input),
    onSettled: () => invalidate(groupId),
  });
  return { preview, cancel };
}

/** The guest's own pay link for the balance, to show as a QR at the door. */
export function useBalancePayLink(
  venueId: string | null,
): UseMutationResult<{ payUrl: string; balanceMinor: number; currencyCode: string | null }, Error, { groupId: string }> {
  return useMutation({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return balancePayLink({ venueId, groupId: input.groupId });
    },
  });
}
