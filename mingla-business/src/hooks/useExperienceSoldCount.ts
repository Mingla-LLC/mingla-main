/**
 * useExperienceSoldCount — META-ORCH-1059 Sub-E.
 *
 * React Query hook for the total confirmed (paid / non-cancelled) order
 * quantity of an experience, via the biz_experience_sold_count RPC. This is the
 * SAME source the server-side refund-gate uses, so the client guard
 * (publishedExperienceEditGuards) sees the same number the RPC will enforce
 * against — no client/server drift.
 *
 * Only enabled for a live/scheduled experience edit; drafts never need it.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";

export const experienceSoldCountKeys = {
  all: ["experience-sold-count"] as const,
  one: (eventId: string) => [...experienceSoldCountKeys.all, eventId] as const,
};

async function fetchExperienceSoldCount(eventId: string): Promise<number> {
  const { data, error } = await supabase.rpc("biz_experience_sold_count", {
    p_event_id: eventId,
  });
  if (error !== null) throw error;
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function useExperienceSoldCount(eventId: string | null, enabled = true) {
  const { isAuthReady } = useAuth();
  return useQuery<number>({
    queryKey: experienceSoldCountKeys.one(eventId ?? ""),
    queryFn: () => fetchExperienceSoldCount(eventId!),
    enabled: isAuthReady && enabled && eventId !== null && eventId.length > 0,
    staleTime: 15_000,
  });
}
