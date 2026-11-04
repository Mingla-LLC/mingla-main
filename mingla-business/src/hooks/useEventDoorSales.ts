import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  cancelDoorPayCode,
  createDoorPayCode,
  fetchCanTakeDoorPayment,
  fetchDoorPayCode,
  mapDoorPayCodeRow,
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
};

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
    onSuccess: (created) => {
      queryClient.setQueryData(doorPayCodeKeys.created(created.codeId), created);
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

export function useTextDoorPayLink(codeId: string | null) {
  return useMutation({
    mutationFn: (input: { phone: string; phoneCountryIso: string | null }) =>
      textDoorPayLink({ codeId: codeId as string, ...input }),
  });
}
