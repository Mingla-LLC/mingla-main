import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  createDoorPayCode,
  fetchCanTakeDoorPayment,
  quoteDoorPayCode,
  type CreateDoorPayCodeInput,
} from "../services/doorPayCodeService";
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

// ---- issue #4271 — door pay codes ----------------------------------------
//
// The keys, the quote, the permission read and create live here (the door sale
// sheet and the host's pay code screen both use them). The host screen's own
// hooks (the live row, cancel, settle, text, late payment, guest name) are in
// useDoorPayCodes.ts, so the guest page and the sheet never load them.

export const doorPayCodeKeys = {
  all: ["door-pay-code"] as const,
  detail: (codeId: string) => [...doorPayCodeKeys.all, "detail", codeId] as const,
  created: (codeId: string) => [...doorPayCodeKeys.all, "created", codeId] as const,
  canTakePayment: (eventId: string) =>
    [...doorPayCodeKeys.all, "can-take-payment", eventId] as const,
  quote: (eventId: string, eventDateId: string | null, basket: string) =>
    [...doorPayCodeKeys.all, "quote", eventId, eventDateId ?? "", basket] as const,
  latePayment: (codeId: string) => [...doorPayCodeKeys.all, "late-payment", codeId] as const,
  guestName: (codeId: string) => [...doorPayCodeKeys.all, "guest-name", codeId] as const,
};

/** Stable key part for a basket: same tickets, same quote. */
export const doorBasketKey = (lines: { ticketTypeId: string; quantity: number }[]): string =>
  lines
    .filter((line) => line.quantity > 0)
    .map((line) => `${line.ticketTypeId}:${line.quantity}`)
    .sort()
    .join(",");

/**
 * The server's "Total incl. fees" for a pay-code basket before the code is
 * made (door-pay-code `quote`; nothing is written).
 */
export function useDoorPayCodeQuote(input: {
  eventId: string | null;
  eventDateId: string | null;
  lines: { ticketTypeId: string; quantity: number }[];
  enabled: boolean;
}) {
  const { isAuthReady } = useAuth();
  const lines = input.lines.filter((line) => line.quantity > 0);
  const basket = doorBasketKey(lines);
  return useQuery({
    queryKey: doorPayCodeKeys.quote(input.eventId ?? "", input.eventDateId, basket),
    queryFn: () =>
      quoteDoorPayCode({
        eventId: input.eventId as string,
        eventDateId: input.eventDateId,
        lines,
      }),
    enabled:
      input.enabled && isAuthReady && input.eventId !== null && input.eventId.length > 0 &&
      basket.length > 0,
    staleTime: 30_000,
    retry: 1,
  });
}



export function useCanTakeDoorPayment(eventId: string | null) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: doorPayCodeKeys.canTakePayment(eventId ?? ""),
    queryFn: () => fetchCanTakeDoorPayment(eventId as string),
    enabled: isAuthReady && eventId !== null && eventId.length > 0,
    staleTime: 60_000,
  });
}



export function useCreateDoorPayCode(eventId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDoorPayCodeInput) => createDoorPayCode(input),
    onSuccess: (created, input) => {
      queryClient.setQueryData(doorPayCodeKeys.created(created.codeId), created);
      if (typeof input.replacesCodeId === "string" && input.replacesCodeId.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: doorPayCodeKeys.detail(input.replacesCodeId),
        });
      }
      if (eventId !== null) {
        void queryClient.invalidateQueries({ queryKey: doorSaleKeys.byEvent(eventId) });
      }
    },
  });
}



