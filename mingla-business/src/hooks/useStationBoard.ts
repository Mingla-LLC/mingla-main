/**
 * #4490 spec 08 O3 — a kitchen or bar screen's live board. The same triple as
 * the Orders queue (useVenueOrders): (a) realtime on `venue_orders` for the
 * venue (every station change bumps `station_rev`, so item-level changes fire
 * there too, spec 08 §11 T6), (b) the 30-second poll floor
 * (VENUE_ORDERS_POLL_MS), (c) the order push for a backgrounded device. The
 * board itself is read through venue-order-staff (`station_board`), which
 * hides held Till rounds, carriers, tab settlements and unpaid checkouts and
 * names who sent and who accepted each ticket.
 *
 * The channel's status drives the connection dot: SUBSCRIBED -> "live";
 * CHANNEL_ERROR / TIMED_OUT / CLOSED -> "reconnecting" plus an immediate refetch.
 * Logout removes the channel with the component (rule 6). Nothing persisted.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  fetchStationBoard,
  markStationItemReady,
  runStationAction,
  type StationActionResult,
  type StationTicketAction,
} from "../services/venueStationService";
import type { StationBoard, StationChoice, StationName } from "../components/venue/station/stationModel";
import { VENUE_ORDERS_POLL_MS, venueOrdersKeys } from "./useVenueOrders";

export type StationConnection = "connecting" | "live" | "reconnecting";

export function stationConnectionFor(status: string): StationConnection | null {
  if (status === "SUBSCRIBED") return "live";
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") return "reconnecting";
  return null;
}

export function stationBoardQueryOptions(venueId: string, station: StationChoice): {
  queryKey: readonly unknown[];
  staleTime: number;
  refetchInterval: number;
  queryFn: () => Promise<StationBoard>;
} {
  return {
    queryKey: venueOrdersKeys.station(venueId, station),
    staleTime: 2_000,
    // The poll floor: a silently dropped channel never freezes the kitchen.
    refetchInterval: VENUE_ORDERS_POLL_MS,
    queryFn: () => fetchStationBoard(venueId, station),
  };
}

export function useStationBoard(
  venueId: string | null,
  station: StationChoice,
): { query: UseQueryResult<StationBoard>; connection: StationConnection } {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  const [connection, setConnection] = useState<StationConnection>("connecting");

  const query = useQuery<StationBoard>({
    ...(enabled
      ? stationBoardQueryOptions(venueId as string, station)
      : {
        queryKey: ["venueOrders", "station", "disabled"] as const,
        staleTime: 2_000,
        refetchInterval: VENUE_ORDERS_POLL_MS,
        queryFn: () => Promise.reject(new Error("disabled")),
      }),
    enabled,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const key = venueOrdersKeys.station(venueId as string, station);
    const channel = supabase
      .channel(`venue-station:${venueId}:${station}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "venue_orders", filter: `venue_id=eq.${venueId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: key });
        },
      )
      .subscribe((status: string) => {
        const next = stationConnectionFor(status);
        if (next === null) return;
        setConnection(next);
        if (next === "reconnecting") void queryClient.invalidateQueries({ queryKey: key });
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient, station, venueId]);

  return { query, connection };
}

export function useStationActions(venueId: string | null, station: StationChoice) {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    if (venueId !== null) void queryClient.invalidateQueries({ queryKey: venueOrdersKeys.station(venueId, station) });
  };
  return {
    ticket: useMutation<StationActionResult, Error, { action: StationTicketAction; orderId: string; station: StationName }>({
      mutationFn: (v) => runStationAction(v.action, v.orderId, v.station),
      onSettled: refresh,
    }),
    item: useMutation<StationActionResult, Error, { orderItemId: string }>({
      mutationFn: (v) => markStationItemReady(v.orderItemId),
      onSettled: refresh,
    }),
  };
}
