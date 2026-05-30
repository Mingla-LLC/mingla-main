import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  fetchEventWaitlist,
  type EventWaitlistTicket,
} from "../services/waitlistService";

const STALE_TIME_MS = 30 * 1000;
const DISABLED_KEY = ["event-waitlist-disabled"] as const;

export const eventWaitlistKeys = {
  all: ["event-waitlist"] as const,
  detail: (eventId: string): readonly ["event-waitlist", string] =>
    [...eventWaitlistKeys.all, eventId] as const,
};

export const useEventWaitlist = (
  eventId: string | null,
): UseQueryResult<EventWaitlistTicket[]> => {
  // ORCH-1004 — waitlist_entries is RLS auth.uid()-scoped (organiser-only);
  // gate on auth readiness so a pre-auth fire can't cache empty as success.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && eventId !== null;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (eventId === null) return;
    const channelName = `event-waitlist-${eventId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      // REALTIME-INERT-OK: ORCH-0958 follow-up to publish waitlist_entries to supabase_realtime.
      // Until then, the planner panel falls back to React Query's 30s staleTime — degraded
      // freshness, not broken. Subscription is silently no-op (gate I-PROPOSED-BV).
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "waitlist_entries",
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: eventWaitlistKeys.detail(eventId),
          });
        },
      )
      .subscribe();

    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [eventId, queryClient]);

  return useQuery<EventWaitlistTicket[]>({
    queryKey:
      enabled && eventId !== null
        ? eventWaitlistKeys.detail(eventId)
        : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<EventWaitlistTicket[]> => {
      if (eventId === null) return [];
      return fetchEventWaitlist(eventId);
    },
  });
};
