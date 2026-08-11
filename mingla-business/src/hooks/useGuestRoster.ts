import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFocusEffect } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchGuestRoster,
  fetchGuestRosterAccess,
  type GuestRosterAccess,
} from "../services/guestRosterService";
import { supabase } from "../services/supabase";
import { useNetInfoSafe } from "../lib/netinfoSafe";
import type {
  GuestRosterFilter,
  GuestRosterPage,
  GuestRosterSort,
} from "../types/guestRoster";

export const guestRosterKeys = {
  all: ["guest-roster"] as const,
  access: (eventId: string) => ["guest-roster", eventId, "access"] as const,
  list: (
    eventId: string,
    filter: GuestRosterFilter,
    search: string,
    sort: GuestRosterSort,
  ) => ["guest-roster", eventId, filter, search.trim().toLowerCase(), sort] as const,
};

export function useGuestRosterAccess(eventId: string | null): UseQueryResult<GuestRosterAccess> {
  const { isAuthReady, user } = useAuth();
  return useQuery<GuestRosterAccess>({
    queryKey: eventId === null ? (["guest-roster", "access-disabled"] as const) : guestRosterKeys.access(eventId),
    enabled: isAuthReady && user !== null && eventId !== null,
    staleTime: 30_000,
    queryFn: () => {
      if (eventId === null) throw new Error("guest_roster_event_required");
      return fetchGuestRosterAccess(eventId);
    },
  });
}

export function useGuestRoster(input: {
  eventId: string | null;
  enabled: boolean;
  filter: GuestRosterFilter;
  search: string;
  sort: GuestRosterSort;
}) {
  const { isAuthReady, user } = useAuth();
  const queryClient = useQueryClient();
  const network = useNetInfoSafe();
  const isOffline = network?.isConnected === false || network?.isInternetReachable === false;
  const wasOffline = useRef(isOffline);
  const mountNonce = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const [now, setNow] = useState(Date.now());
  const enabled = input.enabled && isAuthReady && user !== null && input.eventId !== null;
  const queryKey = enabled && input.eventId !== null
    ? guestRosterKeys.list(input.eventId, input.filter, input.search, input.sort)
    : (["guest-roster", "disabled"] as const);

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: null as Record<string, unknown> | null,
    staleTime: 15_000,
    refetchInterval: enabled ? 15_000 : false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    queryFn: ({ pageParam }) => {
      if (input.eventId === null) throw new Error("guest_roster_event_required");
      return fetchGuestRoster({
        eventId: input.eventId,
        filter: input.filter,
        search: input.search,
        sort: input.sort,
        cursor: pageParam,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const invalidateEvent = useCallback(() => {
    if (!enabled || input.eventId === null) return;
    void queryClient.invalidateQueries({
      predicate: (candidate) => candidate.queryKey[0] === "guest-roster" && candidate.queryKey[1] === input.eventId,
    });
  }, [enabled, input.eventId, queryClient]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useFocusEffect(useCallback(() => { invalidateEvent(); }, [invalidateEvent]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") invalidateEvent();
    });
    return () => subscription.remove();
  }, [invalidateEvent]);

  useEffect(() => {
    if (wasOffline.current && !isOffline && enabled) {
      invalidateEvent();
    }
    wasOffline.current = isOffline;
  }, [enabled, invalidateEvent, isOffline]);

  useEffect(() => {
    if (!enabled || input.eventId === null) return;
    const channel = supabase
      .channel(`guest-roster-changes-${input.eventId}-${mountNonce.current}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "guest_roster_change_events",
          filter: `event_id=eq.${input.eventId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            predicate: (candidate) =>
              candidate.queryKey[0] === "guest-roster" &&
              candidate.queryKey[1] === input.eventId,
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") invalidateEvent();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, input.eventId, invalidateEvent, queryClient]);

  const pages = query.data?.pages;
  const data = pages === undefined || pages.length === 0 ? undefined : {
    ...pages[0],
    rows: pages.flatMap((page) => page.rows),
    nextCursor: pages.at(-1)?.nextCursor ?? null,
  };
  const lastSuccessfulSyncAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;
  return {
    ...query,
    data,
    lastSuccessfulSyncAt,
    isStaleTruth: lastSuccessfulSyncAt === null || now - lastSuccessfulSyncAt > 30_000,
    isOffline,
  };
}
