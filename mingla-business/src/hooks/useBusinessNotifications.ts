/**
 * useBusinessNotifications — Mingla Business notification inbox.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-W (notifications app-type-prefix
 * filtering).
 *
 * Reads `public.notifications` for the calling user, INCLUDING ONLY rows
 * where `type` matches `stripe.%` OR `business.%`. Consumer notifications
 * (the unprefixed types like `session_match`, `friend_request_received`)
 * are excluded — they belong to the consumer Mingla app's inbox.
 *
 * Strict-grep gate I-PROPOSED-W enforces this filter shape; do NOT remove
 * the `.or('type.like.stripe.%,type.like.business.%')` clause.
 *
 * Realtime subscription invalidates the cache when new business
 * notifications land (push from notify-dispatch).
 */

import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { supabase } from "../services/supabase";

export interface BusinessNotification {
  id: string;
  user_id: string;
  brand_id: string | null;
  type: string;
  title: string;
  body: string;
  deep_link: string | null;
  read_at: string | null;
  created_at: string;
}

const STALE_TIME_MS = 30 * 1000;
const FETCH_LIMIT = 50;

export const businessNotificationKeys = {
  all: (userId: string): readonly ["business-notifications", string] =>
    ["business-notifications", userId] as const,
};

const DISABLED_KEY = ["business-notifications-disabled"] as const;

export function useBusinessNotifications(
  userId: string | null,
): UseQueryResult<readonly BusinessNotification[]> {
  const queryClient = useQueryClient();
  const enabled = userId !== null;

  // Realtime: invalidate on INSERT to this user's notifications row.
  // The filter on the channel keeps the subscription scoped to the
  // current user; the type-prefix INCLUDE filter is applied at the
  // SELECT layer (below) so the cache only contains business types.
  useEffect(() => {
    if (!enabled || userId === null) return;
    // Unique channel name per mount — prevents Supabase Realtime "after subscribe"
    // rejection on StrictMode double-mount. Same pattern as useBrandStripeStatus
    // per ORCH-V3-runtime-1.
    const channelName = `business-notifications-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Only invalidate if the new row matches the business-app prefix.
          // Avoids re-fetching every time a consumer notification arrives.
          const newRow = payload.new as { type?: string } | null;
          const t = newRow?.type ?? "";
          if (t.startsWith("stripe.") || t.startsWith("business.")) {
            queryClient.invalidateQueries({
              queryKey: businessNotificationKeys.all(userId),
            });
          }
        },
      )
      .subscribe();

    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId, queryClient]);

  return useQuery<readonly BusinessNotification[]>({
    queryKey: enabled ? businessNotificationKeys.all(userId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<readonly BusinessNotification[]> => {
      if (userId === null) {
        throw new Error("useBusinessNotifications: enabled but userId null");
      }

      // I-PROPOSED-W: business-app reads MUST include the stripe.% or
      // business.% prefix filter. The `.or()` clause uses Postgrest
      // syntax to express the disjunction. Strict-grep gate W will fail
      // if this clause is removed or altered.
      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, user_id, brand_id, type, title, body, deep_link, read_at, created_at",
        )
        .eq("user_id", userId)
        .or("type.like.stripe.%,type.like.business.%")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT)
        .returns<BusinessNotification[]>();

      if (error) throw error;
      return data ?? [];
    },
  });
}
