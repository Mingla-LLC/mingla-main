import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchEventDoorSales,
  recordDoorSale,
  refundDoorSale,
  type RecordDoorSaleInput,
} from "../services/doorSalesService";

export const doorSaleKeys = {
  all: ["door-sales"] as const,
  byEvent: (eventId: string) => [...doorSaleKeys.all, eventId] as const,
};

export function useEventDoorSales(eventId: string | null) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: doorSaleKeys.byEvent(eventId ?? ""),
    queryFn: () => fetchEventDoorSales(eventId!),
    enabled: isAuthReady && eventId !== null && eventId.length > 0,
    staleTime: 10_000,
  });
}

export function useRecordDoorSale(eventId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordDoorSaleInput) => recordDoorSale(input),
    onSuccess: () => {
      if (eventId !== null) {
        void queryClient.invalidateQueries({ queryKey: doorSaleKeys.byEvent(eventId) });
      }
    },
  });
}

export function useRefundDoorSale(eventId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refundDoorSale,
    onSuccess: () => {
      if (eventId !== null) {
        void queryClient.invalidateQueries({ queryKey: doorSaleKeys.byEvent(eventId) });
      }
    },
  });
}
