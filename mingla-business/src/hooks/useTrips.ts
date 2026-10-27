/**
 * useTrips — React Query hooks for trip CRUD. Tr2 (ORCH-0859).
 *
 * Mirrors useBrands pattern (ORCH-0855 Tr1 precedent):
 *   - tripKeys factory (single source of truth for query keys)
 *   - useTripsByBrand (list, 5min staleTime, enabled gated on brandId)
 *   - useTrip (detail, 1min staleTime)
 *   - useCreateTripDraft (mutation, optimistic temp row with `_temp_` prefix)
 *   - useUpdateTripBasics / useUpsertTripDays / useUpsertTripInclusions /
 *     useUpdateTripPricing (mutations, pessimistic refetch on settled)
 *   - usePublishTrip (mutation, returns published trip; throws
 *     TripPublishValidationError on RPC raise)
 *   - useSoftDeleteTrip (mutation)
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §4.7
 */

import { useMemo } from "react";
import { publishWithDraftCurrencySync } from "../services/draftCurrencySync";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { DATA_FETCH_TIMEOUT_MS, withTimeout } from "../utils/withTimeout";

// ORCH-0965 — home composite-upcoming cache key.
// Imported from the keyless `upcomingKeys` module to avoid a require-cycle
// (useUpcomingForBrand → useTrips → useUpcomingForBrand).
import { upcomingKeys } from "./upcomingKeys";
// META-ORCH-1187 [Growth Analytics Hub] — offering-published conversion (SC-6).
import { postHogService } from "../services/postHogService";
import { captureHostSearchOutcome } from "../analytics/searchOutcome";
import {
  createTripDraft,
  getTrip,
  getTripsByBrand,
  updateTripBasics,
  upsertTripDays,
  upsertTripInclusions,
  updateTripPricing,
  // META-ORCH-1174 Leg B2 — N-package data layer (B1 service fns).
  createTripPricingTier,
  removeTripPricingTier,
  publishTrip,
  softDeleteTrip,
  type Trip,
  type TripDay,
  type TripInclusion,
  type TripPricingTier,
  type CreateTripDraftInput,
  type TripBasicsPatch,
  type TripDayInput,
  type TripInclusionInput,
  type TripPricingPatch,
  type SoftDeleteResult,
  // ORCH-0876: published-trip atomic patch via biz_update_live_trip RPC
  updateLiveTripFields,
  type LiveTripPatch,
  type UpdateLiveTripResult,
  // issue #1971 — one stable operation id per user action, reused across an
  // automatic retry so the canonical command replays its receipt instead of
  // mutating twice. See operationIdFor's contract in tripsService.
  operationIdFor,
  // Issue #3801 — the editor's held revision and the reload path.
  readTripRevision,
  type TripRevisionCursor,
} from "../services/tripsService";
import { getTripIntakeSchemasByEvent } from "../services/intakeSchemaService";
import { intakeSchemaKeys } from "./useIntakeSchema";
import { tripKeys } from "./tripKeys";

// ---------------------- Query key factory ----------------------

// Issue #3801 — the factory lives in the keyless `tripKeys` module so hooks
// that `useTrips` itself imports (useIntakeSchema) can invalidate the trip
// detail without a require-cycle. Re-exported here for every existing caller.
export { tripKeys };

const DISABLED_KEY = ["trips", "__disabled__"] as const;
const TRIP_LIST_STALE_MS = 5 * 60 * 1000;
const TRIP_DETAIL_STALE_MS = 60 * 1000;

// ---------------------- useTripsByBrand ----------------------

export const useTripsByBrand = (
  brandId: string | null,
): UseQueryResult<Trip[], Error> => {
  // ORCH-1004 — gate on auth readiness: getTripsByBrand reads RLS
  // auth.uid()-scoped `events` (security_invoker management path). Firing
  // pre-auth returns 200 + [] which React Query caches as success for the
  // staleTime window. isAuthReady ⟺ signed_in_ready + access_token present.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<Trip[], Error>({
    queryKey: enabled ? tripKeys.listByBrand(brandId) : DISABLED_KEY,
    queryFn: async () => {
      if (!enabled) return [];
      return getTripsByBrand(brandId);
    },
    enabled,
    staleTime: TRIP_LIST_STALE_MS,
  });
};

// ---------------------- useTrip ----------------------

export interface UseTripOptions {
  /**
   * Issue #3801 — `"always"` reads the trip from the server on every mount,
   * even when a cached copy is still fresh. The trip editor uses it (with
   * `isFetchedAfterMount`) so an editing session is never seeded from a
   * cached revision the server has moved past.
   */
  refetchOnMount?: "always";
}

/**
 * Issue #3801 — the trip-detail read, with a deadline. The trip editor reads
 * the trip again on every open and gates on that read, so a read that never
 * answers (a stalled connection) must end in the route's error state, with
 * Retry, instead of "Loading trip…" with no end.
 */
export const TRIP_DETAIL_FETCH_TIMEOUT_MS = DATA_FETCH_TIMEOUT_MS;
export const fetchTripDetail = (eventId: string): Promise<Trip | null> =>
  withTimeout(getTrip(eventId), TRIP_DETAIL_FETCH_TIMEOUT_MS, "trip detail");

export const useTrip = (
  eventId: string | null,
  options?: UseTripOptions,
): UseQueryResult<Trip | null, Error> => {
  // ORCH-1004 — authed trip detail (dashboard/edit). getTrip reads RLS
  // auth.uid()-scoped `events` + sidecars. The public buyer path uses
  // usePublicTripBySlug / usePublicTripById (anon-tolerant, NOT gated).
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && eventId !== null && eventId.length > 0;
  return useQuery<Trip | null, Error>({
    queryKey: enabled ? tripKeys.detail(eventId) : DISABLED_KEY,
    queryFn: async () => {
      if (!enabled) return null;
      return fetchTripDetail(eventId);
    },
    enabled,
    staleTime: TRIP_DETAIL_STALE_MS,
    ...(options?.refetchOnMount !== undefined
      ? { refetchOnMount: options.refetchOnMount }
      : {}),
  });
};

// ---------------------- useCreateTripDraft ----------------------

export interface UseCreateTripDraftResult {
  mutateAsync: (input: CreateTripDraftInput) => Promise<Trip>;
  isPending: boolean;
}

export const useCreateTripDraft = (): UseCreateTripDraftResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<Trip, Error, CreateTripDraftInput>({
    mutationFn: async (input) =>
      createTripDraft(input, "owner", { operationId: operationIdFor(input) }),
    onSuccess: (trip) => {
      queryClient.setQueryData<Trip>(tripKeys.detail(trip.id), trip);
      queryClient.invalidateQueries({
        queryKey: tripKeys.listByBrand(trip.brandId),
      });
      // ORCH-0965 — home composite-upcoming cache.
      queryClient.invalidateQueries({ queryKey: upcomingKeys.all });
    },
    onError: (error, input) => {
      // Const #3: surface to UI via mutation.error subscription.
      console.error("[useCreateTripDraft] failed", {
        message: error.message,
        brandId: input.brandId,
      });
    },
  });
  return {
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};

// ---------------------- useUpdateTripBasics ----------------------

export interface UpdateTripBasicsInput {
  eventId: string;
  patch: TripBasicsPatch;
  brandId: string;
  /** Issue #3801 — the revision the editor holds; sent and adopted by the command. */
  revision?: TripRevisionCursor;
}

export const useUpdateTripBasics = (): UseMutationResult<
  Trip,
  Error,
  UpdateTripBasicsInput
> => {
  const queryClient = useQueryClient();
  return useMutation<Trip, Error, UpdateTripBasicsInput>({
    mutationFn: async (variables) =>
      updateTripBasics(variables.eventId, variables.patch, {
        operationId: operationIdFor(variables),
        revision: variables.revision,
      }),
    onSuccess: (trip, { brandId }) => {
      queryClient.setQueryData<Trip>(tripKeys.detail(trip.id), trip);
      queryClient.invalidateQueries({
        queryKey: tripKeys.listByBrand(brandId),
      });
      // ORCH-0965 — home composite-upcoming cache.
      queryClient.invalidateQueries({ queryKey: upcomingKeys.all });
    },
    onError: (error, { eventId }) => {
      console.error("[useUpdateTripBasics] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

// ---------------------- useUpsertTripDays ----------------------

export interface UpsertTripDaysInput {
  eventId: string;
  days: TripDayInput[];
  /** Issue #3801 — the revision the editor holds; sent and adopted by the command. */
  revision?: TripRevisionCursor;
}

export const useUpsertTripDays = (): UseMutationResult<
  TripDay[],
  Error,
  UpsertTripDaysInput
> => {
  const queryClient = useQueryClient();
  return useMutation<TripDay[], Error, UpsertTripDaysInput>({
    mutationFn: async (variables) =>
      upsertTripDays(variables.eventId, variables.days, {
        operationId: operationIdFor(variables),
        revision: variables.revision,
      }),
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
    },
    onError: (error, { eventId }) => {
      console.error("[useUpsertTripDays] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

// ---------------------- useUpsertTripInclusions ----------------------

export interface UpsertTripInclusionsInput {
  eventId: string;
  items: TripInclusionInput[];
  /** Issue #3801 — the revision the editor holds; sent and adopted by the command. */
  revision?: TripRevisionCursor;
}

export const useUpsertTripInclusions = (): UseMutationResult<
  TripInclusion[],
  Error,
  UpsertTripInclusionsInput
> => {
  const queryClient = useQueryClient();
  return useMutation<TripInclusion[], Error, UpsertTripInclusionsInput>({
    mutationFn: async (variables) =>
      upsertTripInclusions(variables.eventId, variables.items, {
        operationId: operationIdFor(variables),
        revision: variables.revision,
      }),
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
    },
    onError: (error, { eventId }) => {
      console.error("[useUpsertTripInclusions] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

// ---------------------- useUpdateTripPricing ----------------------

export interface UpdateTripPricingInput {
  eventId: string;
  patch: TripPricingPatch;
  /** Issue #3801 — the revision the editor holds; sent and adopted by the command. */
  revision?: TripRevisionCursor;
}

export const useUpdateTripPricing = (): UseMutationResult<
  TripPricingTier,
  Error,
  UpdateTripPricingInput
> => {
  const queryClient = useQueryClient();
  return useMutation<TripPricingTier, Error, UpdateTripPricingInput>({
    mutationFn: async (variables) =>
      updateTripPricing(variables.eventId, variables.patch, {
        operationId: operationIdFor(variables),
        revision: variables.revision,
      }),
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
    },
    onError: (error, { eventId }) => {
      console.error("[useUpdateTripPricing] failed", {
        message: error.message,
        eventId,
      });
      // Issue #3645 — the save was refused because the server cleared this
      // package's price (the brand's currency changed). Read the trip again so
      // the open pricing form re-seeds that package as "no price yet".
      if (error.message === "price_reentry_required") {
        queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
      }
    },
  });
};

// ---------------------- META-ORCH-1174 Leg B2: N-package tier mutations ----------------------

export interface CreateTripPricingTierInput {
  eventId: string;
  patch: Omit<TripPricingPatch, "ticketTypeId">;
  /** Issue #3801 — the revision the editor holds; sent and adopted by the command. */
  revision?: TripRevisionCursor;
}

/**
 * META-ORCH-1174 Leg B2 — create an ADDITIONAL pricing package on a trip.
 * Returns the new tier (incl. its `ticketTypeId`) so the wizard can adopt the
 * id for subsequent in-place updates. Invalidates the trip detail cache.
 */
export const useCreateTripPricingTier = (): UseMutationResult<
  TripPricingTier,
  Error,
  CreateTripPricingTierInput
> => {
  const queryClient = useQueryClient();
  return useMutation<TripPricingTier, Error, CreateTripPricingTierInput>({
    mutationFn: async (variables) =>
      createTripPricingTier(variables.eventId, variables.patch, {
        operationId: operationIdFor(variables),
        revision: variables.revision,
      }),
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
    },
    onError: (error, { eventId }) => {
      console.error("[useCreateTripPricingTier] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

export interface RemoveTripPricingTierInput {
  eventId: string;
  ticketTypeId: string;
  /** Issue #3801 — the revision the editor holds; sent and adopted by the command. */
  revision?: TripRevisionCursor;
}

/**
 * META-ORCH-1174 Leg B2 — soft-remove a pricing package (refuses if it has
 * sales — the B1 service throws `tier_delete_with_sales`). Invalidates the
 * trip detail cache.
 */
export const useRemoveTripPricingTier = (): UseMutationResult<
  void,
  Error,
  RemoveTripPricingTierInput
> => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, RemoveTripPricingTierInput>({
    mutationFn: async (variables) =>
      removeTripPricingTier(variables.eventId, variables.ticketTypeId, {
        operationId: operationIdFor(variables),
        revision: variables.revision,
      }),
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
    },
    onError: (error, { eventId }) => {
      console.error("[useRemoveTripPricingTier] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

// ---------------------- usePublishTrip ----------------------

export interface PublishTripInput {
  eventId: string;
  draftPayload: Record<string, unknown>;
  brandId: string;
  invites?: {
    selectionRevision: number;
    selectionConfirmed: true;
  };
  /** Issue #3801 — the revision the editor holds; sent and adopted by the command. */
  revision?: TripRevisionCursor;
}

export const usePublishTrip = (): UseMutationResult<
  Trip,
  Error,
  PublishTripInput
> => {
  const queryClient = useQueryClient();
  return useMutation<Trip, Error, PublishTripInput>({
    // Issue #3645 — refused because the trip is priced in a currency its brand
    // no longer sells in: ask the server to bring it in step, then read the
    // trip again so the pricing form re-opens the cleared packages empty.
    mutationFn: async (variables) =>
      publishWithDraftCurrencySync(
        variables.eventId,
        () =>
          publishTrip(variables.eventId, variables.draftPayload, {
            operationId: operationIdFor(variables),
            // publish runs two commands; the pre-save needs its own stable id.
            saveOperationId: operationIdFor(variables.draftPayload),
            invites: variables.invites,
            revision: variables.revision,
          }),
        async () => {
          // Issue #3801 — the server just moved this draft to the brand's
          // currency. The wizard re-seeds the cleared prices from the re-read
          // trip, so it holds the revision that change made from here on.
          if (variables.revision !== undefined) {
            variables.revision.current = await readTripRevision(variables.eventId);
          }
          await queryClient.invalidateQueries({
            queryKey: tripKeys.detail(variables.eventId),
          });
        },
      ),
    onSuccess: (trip, { brandId }) => {
      queryClient.setQueryData<Trip>(tripKeys.detail(trip.id), trip);
      queryClient.invalidateQueries({
        queryKey: tripKeys.listByBrand(brandId),
      });
      // ORCH-0965 — home composite-upcoming cache.
      queryClient.invalidateQueries({ queryKey: upcomingKeys.all });
      // META-ORCH-1187 — offering-published conversion (SC-6).
      postHogService.capture("offering_published", {
        offering_type: "trip",
        brand_id: brandId,
        surface: "business_app",
      });
      captureHostSearchOutcome("listing_published", {
        audience: "host",
        page_family: "host_pillar",
        icp: "trip_operator",
        action_state: "succeeded",
        content_kind: "trip",
      });
    },
    onError: (error, { eventId }) => {
      console.error("[usePublishTrip] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

// ---------------------- useSoftDeleteTrip ----------------------

export interface SoftDeleteTripInput {
  eventId: string;
  brandId: string;
}

export const useSoftDeleteTrip = (): UseMutationResult<
  SoftDeleteResult,
  Error,
  SoftDeleteTripInput
> => {
  const queryClient = useQueryClient();
  return useMutation<SoftDeleteResult, Error, SoftDeleteTripInput>({
    mutationFn: async (variables) =>
      softDeleteTrip(variables.eventId, {
        operationId: operationIdFor(variables),
      }),
    onSuccess: (result, { eventId, brandId }) => {
      if (!result.rejected) {
        queryClient.removeQueries({ queryKey: tripKeys.detail(eventId) });
        queryClient.invalidateQueries({
          queryKey: tripKeys.listByBrand(brandId),
        });
      }
    },
    onError: (error, { eventId }) => {
      console.error("[useSoftDeleteTrip] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

// ---------------------- useUpdateLiveTripFields (ORCH-0876) ----------------------

/**
 * Server-side atomic patch for published trips. Mirrors event-side
 * `useLiveEventStore.updateLiveEventFields` SHAPE but goes server-side
 * via `biz_update_live_trip` RPC (F-17 leapfrog — trips skip events'
 * Zustand-only-write tech debt).
 *
 * Returns the discriminated `UpdateLiveTripResult` from the RPC:
 *   - ok: true  → invalidate trip caches + return editLogEntryId + severity
 *   - ok: false → caller surfaces refund-gate dialog with reason
 *
 * Caller responsibility: fire `notifyTripChanged(...)` on `ok: true` with
 * appropriate channel flags from `tripChangeNotifier.deriveTripChannelFlags`.
 */
export interface UpdateLiveTripFieldsInput {
  eventId: string;
  patch: LiveTripPatch;
  reason: string;
}

export const useUpdateLiveTripFields = (): UseMutationResult<
  UpdateLiveTripResult,
  Error,
  UpdateLiveTripFieldsInput
> => {
  const queryClient = useQueryClient();
  return useMutation<UpdateLiveTripResult, Error, UpdateLiveTripFieldsInput>({
    mutationFn: async (variables) =>
      updateLiveTripFields(
        variables.eventId,
        variables.patch,
        variables.reason,
        { operationId: operationIdFor(variables) },
      ),
    onSuccess: (result, { eventId }) => {
      // Only invalidate on actual successful patch — refund-gate rejections
      // do NOT mutate the trip, so cache stays valid.
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
        queryClient.invalidateQueries({
          queryKey: tripKeys.soldCountsByTier(eventId),
        });
        // Public-by-id + public-by-slug caches stale immediately so the
        // public trip page reflects within staleTime.
        queryClient.invalidateQueries({
          queryKey: ["public-trips", "detail-by-id", eventId],
        });
        queryClient.invalidateQueries({
          queryKey: [...tripKeys.public()],
        });
      }
    },
    onError: (error, { eventId }) => {
      // SQL exceptions (auth/type/permission) come through here; refund-gate
      // rejections come back as result.ok=false (NOT an error). Both surface
      // via the caller's onSuccess/onError handlers; do NOT silently swallow.
      console.error("[useUpdateLiveTripFields] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

// ---------------------- Issue #3801: wizard server sync ----------------------

export interface TripWizardServerSync {
  /**
   * Read the trip and its traveler questions from the server again, ignoring
   * any cached copy, so the wizard can start over from what is stored now.
   * Throws when the trip cannot be read (or no longer exists).
   */
  reloadTrip: (eventId: string) => Promise<Trip>;
  /**
   * The wizard wrote the trip outside a canonical command (theme, pricing
   * switches, refund policy, booking deadline, guest privacy): mark the cached
   * detail stale so an editor opened later seeds from the stored revision.
   */
  markTripChanged: (eventId: string) => void;
}

export const useTripWizardServerSync = (): TripWizardServerSync => {
  const queryClient = useQueryClient();
  return useMemo<TripWizardServerSync>(() => ({
    reloadTrip: async (eventId) => {
      const [fresh] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: tripKeys.detail(eventId),
          queryFn: () => fetchTripDetail(eventId),
          staleTime: 0,
        }),
        queryClient.fetchQuery({
          queryKey: intakeSchemaKeys.byEvent(eventId),
          queryFn: () => getTripIntakeSchemasByEvent(eventId),
          staleTime: 0,
        }),
      ]);
      if (fresh === null) {
        throw new Error("reloadTrip: trip not found for id=" + eventId);
      }
      return fresh;
    },
    markTripChanged: (eventId) => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
    },
  }), [queryClient]);
};
