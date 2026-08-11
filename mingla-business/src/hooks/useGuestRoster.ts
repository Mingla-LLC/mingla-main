import { useEffect } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchGuestRoster,
  fetchGuestRosterAccess,
  type GuestRosterAccess,
} from "../services/guestRosterService";
import { supabase } from "../services/supabase";
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
}): UseQueryResult<GuestRosterPage> {
  const { isAuthReady, user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = input.enabled && isAuthReady && user !== null && input.eventId !== null;
  const queryKey = enabled && input.eventId !== null
    ? guestRosterKeys.list(input.eventId, input.filter, input.search, input.sort)
    : (["guest-roster", "disabled"] as const);

  const query = useQuery<GuestRosterPage>({
    queryKey,
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 15_000 : false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    queryFn: () => {
      if (input.eventId === null) throw new Error("guest_roster_event_required");
      return fetchGuestRoster({
        eventId: input.eventId,
        filter: input.filter,
        search: input.search,
        sort: input.sort,
      });
    },
  });

  useEffect(() => {
    if (!enabled || input.eventId === null) return;
    const channel = supabase
      .channel(`guest-roster:${input.eventId}`)
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
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, input.eventId, queryClient]);

  return query;
}
