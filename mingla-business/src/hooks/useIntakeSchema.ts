/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — React Query hooks for per-tier
 * intake schema CRUD.
 *
 * Per SPEC_ORCH-0880 §7 + §15.5. Query keys via the `intakeSchemaKeys`
 * factory below (per query-key-discipline). Mutations invalidate both the
 * by-event Map query (planner schema-builder) AND the per-tier query (buyer
 * fill page reads single-tier).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  getTripIntakeSchemasByEvent,
  upsertTripIntakeSchema,
  type IntakeSchema,
  type IntakeSchemaServiceError,
} from "../services/intakeSchemaService";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const intakeSchemaKeys = {
  all: ["intake_schemas"] as const,
  byEvent: (eventId: string) =>
    [...intakeSchemaKeys.all, "by_event", eventId] as const,
  byTier: (eventId: string, ticketTypeId: string) =>
    [...intakeSchemaKeys.all, "by_tier", eventId, ticketTypeId] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch all intake schemas for a trip (keyed by ticket_type_id). Used by:
 *   - TripCreatorStep6Intake (wizard schema-builder)
 *   - EditPublishedTripIntakeAccordion (post-publish schema editor)
 *   - Trip dashboard Travelers tab (to know which tiers have schemas)
 */
export function useTripIntakeSchemasByEvent(
  eventId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Map<string, IntakeSchema>, IntakeSchemaServiceError> {
  return useQuery<Map<string, IntakeSchema>, IntakeSchemaServiceError>({
    queryKey: intakeSchemaKeys.byEvent(eventId),
    queryFn: () => getTripIntakeSchemasByEvent(eventId),
    enabled: (options?.enabled ?? true) && eventId.length > 0,
    staleTime: 30_000, // 30s — schema doesn't change often during a session
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface UpsertIntakeSchemaInput {
  eventId: string;
  ticketTypeId: string;
  schema: IntakeSchema | null;
  /** Required when trip is published (10-200 chars); ignored on draft. */
  reason?: string;
  /** Optimisation hint when caller already knows draft state. */
  skipStatusProbe?: boolean;
}

/**
 * Upsert (or clear when schema=null) a tier's intake schema.
 *
 * Behavior:
 *   - DRAFT trips: direct supabase upsert against trip_intake_schemas (no
 *     reason text needed).
 *   - PUBLISHED trips: routes through biz_update_live_trip RPC with reason
 *     text required + re-answer notification dispatch triggered server-side.
 *
 * Cache invalidation:
 *   - intakeSchemaKeys.byEvent(eventId) — planner schema-builder map view
 *   - intakeSchemaKeys.byTier(eventId, ticketTypeId) — single-tier view
 *   - ["trip", eventId] tree — trip detail page reads schema-affected state
 *   - ["businessEvents"] tree — Travelers tab indirect (event row refetch)
 */
export function useUpsertTripIntakeSchema(): UseMutationResult<
  void,
  IntakeSchemaServiceError,
  UpsertIntakeSchemaInput
> {
  const qc = useQueryClient();
  return useMutation<void, IntakeSchemaServiceError, UpsertIntakeSchemaInput>({
    mutationFn: ({ eventId, ticketTypeId, schema, reason, skipStatusProbe }) =>
      upsertTripIntakeSchema({
        eventId,
        ticketTypeId,
        schema,
        reason,
        skipStatusProbe,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: intakeSchemaKeys.byEvent(vars.eventId),
      });
      qc.invalidateQueries({
        queryKey: intakeSchemaKeys.byTier(vars.eventId, vars.ticketTypeId),
      });
      qc.invalidateQueries({ queryKey: ["trip", vars.eventId] });
      qc.invalidateQueries({ queryKey: ["businessEvents"] });
    },
  });
}
