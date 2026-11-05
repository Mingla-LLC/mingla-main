import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  cancelDoorPayCode,
  createDoorPayCode,
  fetchCanTakeDoorPayment,
  fetchDoorPayCode,
  fetchDoorPayGuestName,
  fetchDoorPayLatePayment,
  mapDoorPayCodeRow,
  quoteDoorPayCode,
  settleDoorPayCode,
  textDoorPayLink,
  type CreateDoorPayCodeInput,
  type DoorPayCodeCreated,
  type DoorPayCodeRow,
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
// `useDoorPayCode` reads the `door_pay_codes` row and keeps it live: a realtime
// UPDATE subscription on that one row (same channel pattern as
// useOrderRealtimeSubscription) writes each new row straight into the query
// cache, so the host's screen turns green the moment the guest pays.

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

/** A late payment on a closed code, and whether its refund has landed. */
export function useDoorPayLatePayment(codeId: string | null, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: doorPayCodeKeys.latePayment(codeId ?? ""),
    queryFn: () => fetchDoorPayLatePayment(codeId as string),
    enabled: enabled && isAuthReady && codeId !== null && codeId.length > 0,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
  });
}

/** The paid code's guest name; `data === null` is a real walk-up. */
export function useDoorPayGuestName(codeId: string | null, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: doorPayCodeKeys.guestName(codeId ?? ""),
    queryFn: () => fetchDoorPayGuestName(codeId as string),
    enabled: enabled && isAuthReady && codeId !== null && codeId.length > 0,
    staleTime: 60_000,
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

export function useDoorPayCode(codeId: string | null) {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: doorPayCodeKeys.detail(codeId ?? ""),
    queryFn: () => fetchDoorPayCode(codeId as string),
    enabled: isAuthReady && codeId !== null && codeId.length > 0,
    staleTime: 5_000,
    // Backstop for a dropped realtime socket while the guest is paying.
    refetchInterval: 15_000,
  });

  // The realtime filter is the code's UNIQUE `code` column, never the primary
  // key: Supabase realtime silently drops `id=eq.*` bindings on RLS-gated
  // tables (I-PROPOSED-ORCH-0931). The code is known once the first read lands.
  const code = query.data?.code ?? null;
  useEffect(() => {
    if (codeId === null || codeId.length === 0 || code === null || code.length === 0) return;
    const channelName = `door-pay-code-${codeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let cancelled = false;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "door_pay_codes",
          filter: `code=eq.${code}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as Parameters<typeof mapDoorPayCodeRow>[0] | null;
          if (row === null || row.id !== codeId) return;
          queryClient.setQueryData<DoorPayCodeRow>(
            doorPayCodeKeys.detail(codeId),
            mapDoorPayCodeRow(row),
          );
        },
      )
      .subscribe();
    return (): void => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [codeId, code, queryClient]);

  return query;
}

/**
 * Names and per-ticket prices from the create answer, kept in the cache by
 * useCreateDoorPayCode for the screen that made the code. Null on a cold load
 * (the screen then names tickets from the event's own tiers).
 */
export function useCreatedDoorPayCode(codeId: string | null): DoorPayCodeCreated | null {
  const queryClient = useQueryClient();
  if (codeId === null) return null;
  return queryClient.getQueryData<DoorPayCodeCreated>(doorPayCodeKeys.created(codeId)) ?? null;
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

export function useCancelDoorPayCode(codeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cancelDoorPayCode(codeId as string),
    onSuccess: () => {
      if (codeId !== null) {
        void queryClient.invalidateQueries({ queryKey: doorPayCodeKeys.detail(codeId) });
      }
    },
  });
}

/** The server's answer once the host's clock passes the code's time. */
export function useSettleDoorPayCode(codeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => settleDoorPayCode(codeId as string),
    onSuccess: () => {
      if (codeId !== null) {
        void queryClient.invalidateQueries({ queryKey: doorPayCodeKeys.detail(codeId) });
      }
    },
  });
}

export function useTextDoorPayLink(codeId: string | null) {
  return useMutation({
    mutationFn: (input: { phone: string; phoneCountryIso: string | null }) =>
      textDoorPayLink({ codeId: codeId as string, ...input }),
  });
}
