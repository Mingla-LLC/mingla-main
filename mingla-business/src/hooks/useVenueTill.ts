/**
 * #4490 spec 08 O1 — the Till's server state (edge function `venue-till`).
 * One key factory (`venueTillKeys`, rule 4). Money state is never persisted
 * (rule 14): every read comes from the server, refreshed by realtime on the
 * venue's checks plus a 15 s poll while a check is open.
 */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  addTillMenu,
  addTillOffer,
  fetchTillCatalog,
  fetchTillChecks,
  fetchTillSale,
  openTillCheck,
  payTill,
  refundTill,
  sendTill,
  voidTillLine,
  type TillCatalog,
  type TillChecks,
  type TillSale,
} from "../services/venueTillService";

export const venueTillKeys = {
  all: (venueId: string) => ["venueTill", venueId] as const,
  catalog: (venueId: string) => ["venueTill", venueId, "catalog"] as const,
  checks: (venueId: string) => ["venueTill", venueId, "checks"] as const,
  sale: (venueId: string, saleId: string) => ["venueTill", venueId, "sale", saleId] as const,
};

export const TILL_POLL_MS = 15_000;

export function useTillCatalog(venueId: string | null): UseQueryResult<TillCatalog> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery<TillCatalog>({
    queryKey: enabled ? venueTillKeys.catalog(venueId as string) : ["venueTill", "disabled", "catalog"],
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchTillCatalog(venueId as string),
  });
}

export function useTillChecks(venueId: string | null, active: boolean): UseQueryResult<TillChecks> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && active && venueId !== null && venueId.length > 0;
  return useQuery<TillChecks>({
    queryKey: enabled ? venueTillKeys.checks(venueId as string) : ["venueTill", "disabled", "checks"],
    enabled,
    staleTime: 5_000,
    refetchInterval: enabled ? TILL_POLL_MS : false,
    queryFn: () => fetchTillChecks(venueId as string),
  });
}

export function useTillSale(venueId: string | null, saleId: string | null): UseQueryResult<TillSale> {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const enabled = isAuthReady && venueId !== null && saleId !== null;
  // Realtime: another device changing this check refreshes it here (logout
  // removes the channel with the component, rule 6).
  useEffect(() => {
    if (!enabled) return undefined;
    const channel = supabase
      .channel(`venue-till:${saleId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "venue_till_sales", filter: `id=eq.${saleId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: venueTillKeys.sale(venueId as string, saleId as string) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient, saleId, venueId]);
  return useQuery<TillSale>({
    queryKey: enabled ? venueTillKeys.sale(venueId as string, saleId as string) : ["venueTill", "disabled", "sale"],
    enabled,
    staleTime: 2_000,
    refetchInterval: enabled ? TILL_POLL_MS : false,
    queryFn: () => fetchTillSale(venueId as string, saleId as string),
  });
}

/** Every Till write puts the server's check straight into the cache. */
export function useTillActions(venueId: string | null) {
  const queryClient = useQueryClient();
  const put = (sale: TillSale): TillSale => {
    if (venueId !== null) {
      queryClient.setQueryData(venueTillKeys.sale(venueId, sale.id), sale);
      void queryClient.invalidateQueries({ queryKey: venueTillKeys.checks(venueId) });
    }
    return sale;
  };
  const refreshSale = (saleId: string): void => {
    if (venueId !== null) void queryClient.invalidateQueries({ queryKey: venueTillKeys.sale(venueId, saleId) });
  };
  return {
    refreshSale,
    open: useMutation({ mutationFn: async (i: Omit<Parameters<typeof openTillCheck>[0], "venueId">) => put(await openTillCheck({ venueId: venueId as string, ...i })) }),
    addMenu: useMutation({ mutationFn: async (i: Omit<Parameters<typeof addTillMenu>[0], "venueId">) => put(await addTillMenu({ venueId: venueId as string, ...i })) }),
    addOffer: useMutation({ mutationFn: async (i: Omit<Parameters<typeof addTillOffer>[0], "venueId">) => put(await addTillOffer({ venueId: venueId as string, ...i })) }),
    voidLine: useMutation({ mutationFn: async (i: Omit<Parameters<typeof voidTillLine>[0], "venueId">) => put(await voidTillLine({ venueId: venueId as string, ...i })) }),
    send: useMutation({ mutationFn: async (i: { saleId: string }) => put(await sendTill({ venueId: venueId as string, ...i })) }),
    pay: useMutation({
      mutationFn: async (i: Omit<Parameters<typeof payTill>[0], "venueId">) => {
        const result = await payTill({ venueId: venueId as string, ...i });
        put(result.sale);
        return result;
      },
    }),
    refund: useMutation({ mutationFn: async (i: Omit<Parameters<typeof refundTill>[0], "venueId">) => put(await refundTill({ venueId: venueId as string, ...i })) }),
  };
}
