/**
 * #4490 spec 08 O1 — the Till's server state (edge function `venue-till`).
 * One key factory (`venueTillKeys`, rule 4). Money state is never persisted
 * (rule 14): every read comes from the server, refreshed by realtime on the
 * venue's checks plus a 15 s poll while a check is open. Realtime is a speed-up
 * only: where it is absent (or drops) the poll keeps the check current.
 */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  addTillMenu,
  addTillOffer,
  closeTillCovered,
  extendTillSession,
  fetchTillCatalog,
  fetchTillChecks,
  fetchTillSale,
  fetchTillServers,
  openTillCheck,
  payTill,
  refundTill,
  refundTillLine,
  relabelTill,
  seatTillTable,
  sendTill,
  sendTillReceipt,
  setTillServer,
  setTillSplit,
  startTillSession,
  voidTillLine,
  type TillCatalog,
  type TillChecks,
  type TillSale,
  type TillServer,
} from "../services/venueTillService";
import { tillSaleChangeMatches } from "../components/venue/till/tillModel";
import { isSoldOutRefusal, refreshStockReads } from "./stockRefresh";
import { venueTillKeys } from "./venueTillKeys";

export { venueTillKeys };

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
      .channel(`venue-till:${venueId}:${saleId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "venue_till_sales", filter: `venue_id=eq.${venueId}` },
        (payload: unknown) => {
          if (!tillSaleChangeMatches(payload, saleId as string)) return;
          void queryClient.invalidateQueries({ queryKey: venueTillKeys.sale(venueId as string, saleId as string) });
        },
      )
      // #4490 spec 08 §11 T6: every station change bumps venue_orders.station_rev,
      // so the check hears "accepted", "ready" and "picked up" at once (the 15 s
      // poll stays the floor).
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "venue_orders", filter: `venue_id=eq.${venueId}` },
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

/** Who may take a check over (loaded when the hand-over sheet opens). */
export function useTillServers(venueId: string | null, active: boolean): UseQueryResult<TillServer[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && active && venueId !== null && venueId.length > 0;
  return useQuery<TillServer[]>({
    queryKey: enabled ? venueTillKeys.servers(venueId as string) : ["venueTill", "disabled", "servers"],
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchTillServers(venueId as string),
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
  // #4490 08-O5 fix 2 (O5-B2): every write that can change a count marks the
  // Till's tiles and the Menu's counts stale, so they come back from the
  // server. A refused send or pay (item_sold_out) means the count on screen
  // was stale: refresh it too, then let the caller word the refusal.
  const refreshStock = (): void => refreshStockReads(queryClient, venueId);
  const stockWrite = async <T,>(call: () => Promise<T>, changesStock: boolean): Promise<T> => {
    try {
      const result = await call();
      if (changesStock) refreshStock();
      return result;
    } catch (err) {
      if (isSoldOutRefusal(err)) refreshStock();
      throw err;
    }
  };
  return {
    refreshSale,
    refreshStock,
    open: useMutation({ mutationFn: async (i: Omit<Parameters<typeof openTillCheck>[0], "venueId">) => put(await openTillCheck({ venueId: venueId as string, ...i })) }),
    // A round that is sent takes stock on the server; a held one does not.
    addMenu: useMutation({
      mutationFn: async (i: Omit<Parameters<typeof addTillMenu>[0], "venueId">) =>
        put(await stockWrite(() => addTillMenu({ venueId: venueId as string, ...i }), i.send)),
    }),
    addOffer: useMutation({ mutationFn: async (i: Omit<Parameters<typeof addTillOffer>[0], "venueId">) => put(await addTillOffer({ venueId: venueId as string, ...i })) }),
    // A void may put units back (restock on or off: the server decides what comes back).
    voidLine: useMutation({
      mutationFn: async (i: Omit<Parameters<typeof voidTillLine>[0], "venueId">) =>
        put(await stockWrite(() => voidTillLine({ venueId: venueId as string, ...i }), true)),
    }),
    send: useMutation({
      mutationFn: async (i: { saleId: string }) => put(await stockWrite(() => sendTill({ venueId: venueId as string, ...i }), true)),
    }),
    pay: useMutation({
      mutationFn: async (i: Omit<Parameters<typeof payTill>[0], "venueId">) => {
        // T8: a payment sends what is still held, so it takes stock too.
        const result = await stockWrite(() => payTill({ venueId: venueId as string, ...i }), true);
        put(result.sale);
        return result;
      },
    }),
    // A receipt send changes the payment's send count: refresh the check.
    receipt: useMutation({
      mutationFn: async (i: Omit<Parameters<typeof sendTillReceipt>[0], "venueId"> & { saleId: string | null }) => {
        const { saleId, ...rest } = i;
        const result = await sendTillReceipt({ venueId: venueId as string, ...rest });
        if (saleId !== null) refreshSale(saleId);
        return result;
      },
    }),
    refund: useMutation({
      mutationFn: async (i: Omit<Parameters<typeof refundTill>[0], "venueId">) =>
        put(await stockWrite(() => refundTill({ venueId: venueId as string, ...i }), i.restock)),
    }),
    refundLine: useMutation({ mutationFn: async (i: Omit<Parameters<typeof refundTillLine>[0], "venueId">) => put(await refundTillLine({ venueId: venueId as string, ...i })) }),
    relabel: useMutation({ mutationFn: async (i: Omit<Parameters<typeof relabelTill>[0], "venueId">) => put(await relabelTill({ venueId: venueId as string, ...i })) }),
    // 08-O4: split, seat a table, start / extend a by-the-hour session.
    setSplit: useMutation({ mutationFn: async (i: Omit<Parameters<typeof setTillSplit>[0], "venueId">) => put(await setTillSplit({ venueId: venueId as string, ...i })) }),
    seat: useMutation({ mutationFn: async (i: Omit<Parameters<typeof seatTillTable>[0], "venueId">) => put(await seatTillTable({ venueId: venueId as string, ...i })) }),
    startSession: useMutation({ mutationFn: async (i: Omit<Parameters<typeof startTillSession>[0], "venueId">) => put(await startTillSession({ venueId: venueId as string, ...i })) }),
    closeCovered: useMutation({ mutationFn: async (i: Omit<Parameters<typeof closeTillCovered>[0], "venueId">) => put(await closeTillCovered({ venueId: venueId as string, ...i })) }),
    extendSession: useMutation({ mutationFn: async (i: Omit<Parameters<typeof extendTillSession>[0], "venueId">) => put(await extendTillSession({ venueId: venueId as string, ...i })) }),
    setServer: useMutation({
      mutationFn: async (i: Omit<Parameters<typeof setTillServer>[0], "venueId">) => {
        const sale = put(await setTillServer({ venueId: venueId as string, ...i }));
        if (venueId !== null) void queryClient.invalidateQueries({ queryKey: venueTillKeys.servers(venueId) });
        return sale;
      },
    }),
  };
}
