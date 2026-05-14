/**
 * usePublicEventTickets — React Query hook for fetching a business event's
 * ticket types in the @mingla/event-rendering package's prop shape.
 *
 * Per META-ORCH-0827 Pass 2 Step 10 support.
 */

import { useQuery } from "@tanstack/react-query";
import type { PublicTicketProps } from "@mingla/event-rendering";
import { fetchPublicEventTickets } from "../services/publicEventTicketsService";

export const PUBLIC_EVENT_TICKETS_KEY = (eventId: string | null) =>
  ["publicEventTickets", eventId] as const;

export const usePublicEventTickets = (eventId: string | null) =>
  useQuery<PublicTicketProps[], Error>({
    queryKey: PUBLIC_EVENT_TICKETS_KEY(eventId),
    queryFn: async () => {
      if (eventId === null) return [];
      return fetchPublicEventTickets(eventId);
    },
    enabled: eventId !== null,
    staleTime: 30_000,
  });
