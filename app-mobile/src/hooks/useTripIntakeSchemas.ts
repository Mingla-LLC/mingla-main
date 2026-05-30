/**
 * useTripIntakeSchemas — React Query hook fetching every tier's intake schema
 * for a trip event, keyed by ticket_type_id. Powers the consumer trip-checkout
 * intake renderer (ORCH-1016 REWORK, tester finding D2).
 *
 * Returns an empty Map for events with no intake schemas (the common case),
 * so the no-schema checkout path renders no intake step.
 */

import { useQuery } from "@tanstack/react-query";

import {
  getTripIntakeSchemasByEvent,
  type IntakeSchema,
} from "../services/tripIntakeSchemaService";

export const TRIP_INTAKE_SCHEMAS_KEY = (eventId: string | null) =>
  ["tripIntakeSchemas", eventId] as const;

export const useTripIntakeSchemas = (eventId: string | null) =>
  useQuery<Map<string, IntakeSchema>, Error>({
    queryKey: TRIP_INTAKE_SCHEMAS_KEY(eventId),
    queryFn: async () => {
      if (eventId === null) return new Map<string, IntakeSchema>();
      return getTripIntakeSchemasByEvent(eventId);
    },
    enabled: eventId !== null,
    staleTime: 30_000,
  });
