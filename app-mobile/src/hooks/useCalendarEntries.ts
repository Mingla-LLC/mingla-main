import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import {
  CalendarService,
  CalendarEntryRecord,
  ConsumerCalendarEntry,
  BusinessEventCalendarRow,
} from "../services/calendarService";

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
// `["businessEventOrders", userId]` cache on every INSERT/UPDATE/DELETE
// for the signed-in buyer. The existing `refetchOnWindowFocus: true` on
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

