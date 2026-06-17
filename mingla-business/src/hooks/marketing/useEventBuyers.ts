/**
 * useEventBuyers — React Query hook for the event-level Buyers tab.
 *
 * Wraps `resolveEventBuyers(eventId)` from the audience service into a
 * query-key-factory-disciplined hook (Constitution #4). Same shape as
 * `useBrandCustomers` — the two hooks are intentionally parallel so the
 * shared `BuyerRow` component renders both with no per-surface branching.
 *
 * SPEC reference: SPEC §5.8 (Event Buyers tab data dependency), §11 T-13.
 * Test target: T-02 event-scoped audience query + T-03 marketing-consent filter.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../services/supabase";
import {
  resolveEventBuyers,
  resolveRsvpGuests,
  type ResolveBuyersResult,
} from "../../services/marketing/marketingAudienceService";

const STALE_TIME_MS = 60 * 1000;

/**
 * ORCH-1150 (D-8) — the audience source depends on the event's `event_type`.
 * Ticketed events draw from `orders` (resolveEventBuyers); RSVP events have no
 * orders and draw their going-guests from `event_rsvps` (resolveRsvpGuests).
 */
export type EventBuyersAudienceType = "event" | "rsvp";

export const eventBuyersKeys = {
  all: ["marketing", "event-buyers"] as const,
  byEvent: (
    eventId: string,
    eventType: EventBuyersAudienceType,
  ): readonly [string, string, string, EventBuyersAudienceType] =>
    ["marketing", "event-buyers", eventId, eventType] as const,
};

export interface UseEventBuyersState {
  data: ResolveBuyersResult | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: UseQueryResult<ResolveBuyersResult>["refetch"];
}

export function useEventBuyers(
  eventId: string | null | undefined,
  // ORCH-1150 (D-8) — optional event-type override. The shared Blasts screen
  // (app/event/[id]/blasts) doesn't know the type, so when omitted the hook
  // probes `events.event_type` itself and routes RSVP events to the
  // event_rsvps-backed resolver. Callers that already know the type (e.g. an
  // RSVP-scoped screen) may pass it to skip the probe.
  eventType?: EventBuyersAudienceType,
): UseEventBuyersState {
  // ORCH-1004 — event buyers read auth.uid()-scoped buyer rollups; gate on auth.
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && typeof eventId === "string" && eventId.length > 0;

  // ORCH-1150 (D-8) — resolve the audience type. When the caller didn't pass
  // one, probe events.event_type once (cached under its own key). This keeps
  // the DO-NOT-TOUCH blasts screen working for both ticketed + RSVP events.
  const typeProbe = useQuery<EventBuyersAudienceType>({
    queryKey: enabled
      ? ["marketing", "event-buyers", "type-probe", eventId]
      : ["marketing", "event-buyers", "type-probe"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("event_type")
        .eq("id", eventId as string)
        .maybeSingle();
      if (error) throw error;
      return data?.event_type === "rsvp" ? "rsvp" : "event";
    },
    enabled: enabled && eventType === undefined,
    staleTime: STALE_TIME_MS,
  });

  const resolvedType: EventBuyersAudienceType =
    eventType ?? typeProbe.data ?? "event";
  // When we must probe the type, wait for it to settle before resolving the
  // audience so we don't fire the wrong resolver on the first paint.
  const audienceEnabled =
    enabled && (eventType !== undefined || typeProbe.data !== undefined);

  const query = useQuery<ResolveBuyersResult>({
    queryKey: audienceEnabled
      ? eventBuyersKeys.byEvent(eventId as string, resolvedType)
      : eventBuyersKeys.all,
    queryFn: async () => {
      return resolvedType === "rsvp"
        ? resolveRsvpGuests(eventId as string)
        : resolveEventBuyers(eventId as string);
    },
    enabled: audienceEnabled,
    staleTime: STALE_TIME_MS,
  });

  // While the type probe is in flight (caller didn't pass a type), surface a
  // loading state so the Blasts screen shows its spinner instead of an empty
  // "no buyers" flash before the correct resolver runs.
  const probePending =
    enabled && eventType === undefined && typeProbe.data === undefined;

  return useMemo(
    () => ({
      data: query.data,
      isLoading: query.isLoading || probePending,
      isError: query.isError || typeProbe.isError,
      error: query.error ?? typeProbe.error,
      refetch: query.refetch,
    }),
    [
      query.data,
      query.isLoading,
      query.isError,
      query.error,
      query.refetch,
      probePending,
      typeProbe.isError,
      typeProbe.error,
    ],
  );
}
