import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import {
  CalendarService,
  CalendarEntryRecord,
  ConsumerCalendarEntry,
  BusinessEventCalendarRow,
  ConsumerRsvpRow,
} from "../services/calendarService";
import { circleKeys } from "./queryKeys";

const fetchCalendarEntries = async (
  userId: string | undefined
): Promise<CalendarEntryRecord[]> => {
  if (!userId) {
    return [];
  }

  try {
    const entries = await CalendarService.fetchUserCalendarEntries(userId);
    return entries;
  } catch (error) {
    console.error("Error fetching calendar entries:", error);
    return [];
  }
};

export const useCalendarEntries = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["calendarEntries", userId],
    queryFn: async () => await fetchCalendarEntries(userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,  // 5 minutes — realtime subscription handles freshness
    gcTime: 10 * 60 * 1000,     // 10 minutes
    refetchOnMount: true,
    refetchOnReconnect: true,
  });
};

// ORCH-0829-A: unified consumer calendar feed. Unions legacy
// `calendar_entries` (scheduled saved cards) with business-event
// `orders + tickets + events` so the Calendar tab can render BOTH
// sources in one timeline. Use this hook in the Calendar tab; existing
// `useCalendarEntries` stays for callers that only need scheduled-cards
// data (SwipeableCards, AppStateManager "is this card already scheduled?"
// lookups).
//
// Shorter staleTime (1min vs legacy 5min) because post-purchase freshness
// matters — operator just paid for a ticket and expects it to appear.
// `refetchOnWindowFocus: true` catches order fulfillment when the user
// switches back to the app after Stripe webhook latency settles.
// ORCH-0829-A: business-event orders only (no legacy calendar_entries).
// Used inside CalendarTab as a parallel section to the existing
// calendarEntries prop flow (which is shaped as `CalendarEntry[]` and
// fed from AppStateManager → app/index.tsx → LikesPage → CalendarTab).
// Keeping the legacy prop flow untouched minimizes blast radius; this
// hook is the new source for business-event ticket cards.
//
// Query key `["businessEventOrders", userId]` is the invalidation
// target for `ExpandedBusinessEventSheet.handleBuy` success branch.
export const useBusinessEventOrders = (userId: string | undefined) => {
  return useQuery<BusinessEventCalendarRow[]>({
    queryKey: ["businessEventOrders", userId],
    queryFn: async (): Promise<BusinessEventCalendarRow[]> => {
      if (!userId) return [];
      return await CalendarService.fetchUserBusinessEventOrders(userId);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    retry: false,
  });
};

// ORCH-0851 H-1: Supabase realtime subscription on `orders` filtered by
// `buyer_user_id=eq.<userId>`. Closes the 1–5s post-purchase staleness
// window on the consumer Tickets/Calendar tab by invalidating the
// `["businessEventOrders", userId]` and Circle caches on every
// INSERT/UPDATE/DELETE for the signed-in buyer. The existing
// `refetchOnWindowFocus: true` on
// `useBusinessEventOrders` and the 3-attempt-over-3-seconds invalidate
// loop in `ExpandedBusinessEventSheet.handleBuy` remain as fallbacks if
// realtime fails to connect. Pattern mirrors `useNotifications` realtime
// sub.
export const useOrdersRealtimeSubscription = (userId: string | undefined): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`orders:buyer_user_id=eq.${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `buyer_user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] });
          queryClient.invalidateQueries({ queryKey: circleKeys.all });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
};

// ORCH-0854 H-1: Supabase realtime subscription on `tickets` table. Closes
// the up-to-60s post-scan staleness window on the consumer Tickets/Calendar
// tab by invalidating BOTH `["businessEventOrders", userId]` AND
// `["consumerCalendar", userId]` on every UPDATE event the buyer is entitled
// to see. RLS policy "Buyer or brand team can select tickets" (baseline
// squash) gates delivery to tickets whose order.buyer_user_id = auth.uid(),
// so the buyer cannot receive events for tickets they don't own. Pattern is
// a verbatim mirror of `useOrdersRealtimeSubscription` above. Existing
// fallback layers (`refetchOnWindowFocus: true` on `useBusinessEventOrders`,
// 60s staleTime, and the post-purchase invalidate loop in
// `ExpandedBusinessEventSheet.handleBuy`) remain as belt-and-suspenders if
// realtime fails to connect. Companion migration:
// `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql`.
// Note: postgres_changes has no server-side filter — RLS gates delivery.
export const useTicketsRealtimeSubscription = (userId: string | undefined): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`tickets:buyer=${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] });
          queryClient.invalidateQueries({ queryKey: ["consumerCalendar", userId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
};

// ORCH-1163 [rsvp-shared-body]: the signed-in user's "Going" RSVPs (their own
// primary rows + plus-one rows they were brought as), folded into the consumer
// Calendar tab as a FOURTH unified-row kind alongside calendar / ticket /
// reservation. Source is the `fetch_user_going_rsvps` RPC. Mirrors
// `useBusinessEventOrders`'s caching posture (60s staleTime, refetch on
// focus/mount) since a just-submitted RSVP should appear promptly.
export const useMyGoingRsvps = (userId: string | undefined) => {
  return useQuery<ConsumerRsvpRow[]>({
    queryKey: ["myGoingRsvps", userId],
    queryFn: async (): Promise<ConsumerRsvpRow[]> => {
      if (!userId) return [];
      return await CalendarService.fetchUserGoingRsvps(userId);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    retry: false,
  });
};

// ORCH-1163 [rsvp-shared-body]: Supabase realtime subscription on `event_rsvps`.
// Invalidates `["myGoingRsvps", userId]` on every INSERT/UPDATE/DELETE so a
// host approval flip (pending → approved) or a status change surfaces on the
// consumer Calendar within ~1s. Modeled verbatim on
// `useTicketsRealtimeSubscription`; postgres_changes has no server-side filter,
// so RLS on `event_rsvps` gates delivery to the rows the caller owns.
export const useRsvpsRealtimeSubscription = (
  userId: string | undefined,
): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`event_rsvps:user=${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_rsvps",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["myGoingRsvps", userId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
};

export const useConsumerCalendar = (userId: string | undefined) => {
  return useQuery<ConsumerCalendarEntry[]>({
    queryKey: ["consumerCalendar", userId],
    queryFn: async (): Promise<ConsumerCalendarEntry[]> => {
      if (!userId) return [];
      return await CalendarService.fetchConsumerCalendar(userId);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,        // 1 minute (vs legacy 5min — post-purchase freshness)
    gcTime: 10 * 60 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,  // catch async order fulfillment on app return
    retry: false,                 // explicit polling lives in ExpandedBusinessEventSheet success branch
  });
};
