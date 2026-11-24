/**
 * issue #4522 W-5 — is the plan-v2 schema in this database? Asked through the
 * one shared probe (`@mingla/offering-rendering/planV2Schema`, the edge
 * functions' own) via `planV2SchemaReady`, never a second signal. In the
 * deploy window (web live, migrations not yet applied) the answer is false and
 * the trip builder offers no v2 plan, so no save carries one. The service is
 * loaded on use so the builder's chunk does not grow.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

export const tripPlanV2SchemaKey = ["trip-plan-v2-schema"] as const;

export const useTripPlanV2Schema = (
  enabled: boolean,
): UseQueryResult<boolean, Error> =>
  useQuery<boolean, Error>({
    queryKey: tripPlanV2SchemaKey,
    enabled,
    // The probe remembers a yes for the process and a no for 30 s; match it.
    staleTime: 30 * 1000,
    retry: 1,
    queryFn: async () =>
      (await import("../services/orderInstallmentsService")).planV2SchemaReady(),
  });
