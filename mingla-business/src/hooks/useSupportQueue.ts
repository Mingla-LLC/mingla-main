/**
 * useSupportQueue — META-ORCH-1104 Phase 3 (business-app staff console).
 *
 * React Query hook for the shared support queue the staff inbox renders (server
 * state in RQ, never Zustand — Const #5). Mirrors the mingla-admin desk: ONE
 * queue, sorted newest-activity-first, refreshed live by a `support_tickets`
 * realtime channel so new tickets surface at the top WITHOUT a push (the
 * documented web degradation — SPEC §7.2). RLS scopes the read to staff/admin;
 * a non-staff caller reads zero rows (SPEC §3.3).
 *
 * Per SPEC §7.1.
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  listSupportQueue,
  type SupportQueueTicket,
} from "../services/supportStaffService";

// Queue rows change as tickets arrive / get claimed / replied — keep fresh.
const STALE_TIME_MS = 15 * 1000;

const DISABLED_KEY = ["support", "queue", "disabled"] as const;

export const supportQueueKeys = {
  all: ["support", "queue"] as const,
};

export interface UseSupportQueueResult {
  data: SupportQueueTicket[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * @param active when false the query is disabled (e.g. a non-staff viewer or a
 * collapsed inbox) so we never fire the queue read for someone who can't see it.
 */
export const useSupportQueue = (active: boolean): UseSupportQueueResult => {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const enabled = isAuthReady && active;

  const { data, isLoading, isError, refetch } = useQuery<SupportQueueTicket[]>({
    queryKey: enabled ? supportQueueKeys.all : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<SupportQueueTicket[]> => {
      if (!enabled) return [];
      return listSupportQueue();
    },
  });

  // Realtime: new tickets + activity bumps refresh the queue live (web-safe pure
  // JS SDK channel — SPEC §2.10). This is how a WEB staffer learns of a new
  // ticket without a push (§7.2 degradation).
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("support:queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        () => {
          void queryClient.invalidateQueries({ queryKey: supportQueueKeys.all });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);

  return { data: data ?? [], isLoading, isError, refetch };
};
