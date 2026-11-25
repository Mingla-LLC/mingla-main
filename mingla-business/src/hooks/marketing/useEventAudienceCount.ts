/**
 * useEventAudienceCount — the server's count behind an event's Blasts screen
 * (#4596).
 *
 * One owner answers every event count: the `event:<id>` source on the database
 * (paid buyers plus going RSVP guests, de-duplicated, with the Book's consent
 * rules). This hook reads that owner's discovery row for the event (people,
 * buyers, guests, pending duplicate checks) and its email reach, the same reach
 * basis the composer's quote and the send use. The roster list on the screen
 * (useEventBuyers) only lists names; it never decides a count or a send.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../services/supabase";
import {
  listEventAudiences,
  resolveEventAudienceReach,
  type EventAudienceSummary,
} from "../../services/marketing/marketingAudienceService";
import { getEventRoster } from "../../services/marketing/eventRosterService";
import type { BuyerRowData } from "../../types/marketing";
import {
  eventAudienceShape,
  type EventAudienceShape,
} from "../../features/marketing/eventAudienceCopy";

const STALE_TIME_MS = 60 * 1000;

export const eventAudienceKeys = {
  all: ["marketing", "event-audience"] as const,
  byEvent: (eventId: string): readonly [string, string, string] =>
    ["marketing", "event-audience", eventId] as const,
  type: (eventId: string): readonly [string, string, string, string] =>
    ["marketing", "event-audience", eventId, "type"] as const,
};

/** The event's type alone, so error and empty copy can say guests even if the count fails. */
export async function loadEventType(eventId: string): Promise<string | null> {
  // orch-strict-grep-allow events-type-filter — #4596: single-row read of a known event's type; the type is read, not filtered.
  const { data, error } = await supabase
    .from("events")
    .select("event_type")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  const value = (data as { event_type?: unknown } | null)?.event_type;
  return typeof value === "string" ? value : null;
}

export interface EventAudienceCount {
  eventId: string;
  brandId: string;
  eventType: string | null;
  shape: EventAudienceShape;
  /** De-duplicated people in the event audience (buyers plus going guests). */
  peopleCount: number;
  buyerCount: number;
  guestCount: number;
  /** Going guests waiting on a duplicate check in the Book. */
  pendingReviewCount: number;
  /** How many the email method can reach now (the composer's basis). */
  reachableEmail: number;
  /**
   * Fix pass 3 — the names behind the count, from the same owner: every
   * person counted plus going guests waiting on a duplicate check.
   */
  roster: BuyerRowData[];
}

export interface UseEventAudienceCountState {
  data: EventAudienceCount | undefined;
  /** "rsvp" once known, from its own read, even when the count failed. */
  eventType: string | null | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export async function loadEventAudienceCount(
  actorId: string,
  eventId: string,
): Promise<EventAudienceCount> {
  // orch-strict-grep-allow events-type-filter — #4596: single-row lookup by a known event id to find its brand and type; the type is read, not filtered.
  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select("id, brand_id, event_type")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) throw eventError;
  const brandId = (eventRow as { brand_id?: unknown } | null)?.brand_id;
  if (typeof brandId !== "string") throw new Error("EVENT_NOT_FOUND");
  const eventType = (eventRow as { event_type?: unknown }).event_type;

  // The event reach reader the Audiences tab uses (same RPC as the composer),
  // so this screen adds no second reach module to the boot path.
  const [events, reach, roster] = await Promise.all([
    listEventAudiences({ actor_id: actorId, brand_id: brandId }),
    resolveEventAudienceReach({
      actor_id: actorId,
      brand_id: brandId,
      event_id: eventId,
      people_count: 0,
    }),
    getEventRoster({ actor_id: actorId, brand_id: brandId, event_id: eventId }),
  ]);
  const row: EventAudienceSummary | undefined = events.find((event) => event.eventId === eventId);
  const facts = {
    eventType: row?.eventType ?? (typeof eventType === "string" ? eventType : null),
    buyerCount: row?.buyerCount ?? 0,
    guestCount: row?.guestCount ?? 0,
  };
  return {
    eventId,
    brandId,
    eventType: facts.eventType,
    shape: eventAudienceShape(facts),
    peopleCount: row?.peopleCount ?? 0,
    buyerCount: facts.buyerCount,
    guestCount: facts.guestCount,
    pendingReviewCount: row?.pendingReviewCount ?? 0,
    reachableEmail: reach.reachable_email,
    roster,
  };
}

export function useEventAudienceCount(
  eventId: string | null | undefined,
): UseEventAudienceCountState {
  const { isAuthReady, user } = useAuth();
  const actorId = user?.id ?? null;
  const enabled =
    isAuthReady &&
    actorId !== null &&
    typeof eventId === "string" &&
    eventId.length > 0;
  const query = useQuery<EventAudienceCount>({
    queryKey: enabled
      ? eventAudienceKeys.byEvent(eventId as string)
      : eventAudienceKeys.all,
    queryFn: () => loadEventAudienceCount(actorId as string, eventId as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });
  const typeQuery = useQuery<string | null>({
    queryKey: enabled ? eventAudienceKeys.type(eventId as string) : eventAudienceKeys.all,
    queryFn: () => loadEventType(eventId as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });
  return useMemo(
    () => ({
      data: query.data,
      eventType: query.data?.eventType ?? typeQuery.data,
      // A disabled query (auth still bootstrapping) is loading, not empty.
      isLoading: query.isLoading || !enabled,
      isError: query.isError,
      error: query.error,
    }),
    [query.data, typeQuery.data, query.isLoading, query.isError, query.error, enabled],
  );
}
