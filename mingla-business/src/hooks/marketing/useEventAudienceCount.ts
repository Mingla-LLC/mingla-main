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
import { getCombinedAudienceReach } from "../../services/marketing/marketingCombinedAudienceService";
import {
  listEventAudiences,
  type EventAudienceSummary,
} from "../../services/marketing/marketingAudienceService";
import {
  eventAudienceShape,
  type EventAudienceShape,
} from "../../features/marketing/blastSendModel";

const STALE_TIME_MS = 60 * 1000;

export const eventAudienceKeys = {
  all: ["marketing", "event-audience"] as const,
  byEvent: (eventId: string): readonly [string, string, string] =>
    ["marketing", "event-audience", eventId] as const,
};

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
}

export interface UseEventAudienceCountState {
  data: EventAudienceCount | undefined;
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

  const [events, reachableEmail] = await Promise.all([
    listEventAudiences({ actor_id: actorId, brand_id: brandId }),
    getCombinedAudienceReach({
      actor_id: actorId,
      brand_id: brandId,
      sources: [`event:${eventId}`],
      channel: "email",
    }),
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
    reachableEmail,
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
  return useMemo(
    () => ({
      data: query.data,
      // A disabled query (auth still bootstrapping) is loading, not empty.
      isLoading: query.isLoading || !enabled,
      isError: query.isError,
      error: query.error,
    }),
    [query.data, query.isLoading, query.isError, query.error, enabled],
  );
}
