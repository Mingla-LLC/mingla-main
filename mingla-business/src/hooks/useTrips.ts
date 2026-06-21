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

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";

// ORCH-0965 — home composite-upcoming cache key.
// Imported from the keyless `upcomingKeys` module to avoid a require-cycle
// (useUpcomingForBrand → useTrips → useUpcomingForBrand).
import { upcomingKeys } from "./upcomingKeys";
// META-ORCH-1187 [Growth Analytics Hub] — offering-published conversion (SC-6).
import { postHogService } from "../services/postHogService";
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
} from "../services/tripsService";

// ---------------------- Query key factory ----------------------

export const tripKeys = {
  all: ["trips"] as const,
  lists: (): readonly ["trips", "list"] =>
    [...tripKeys.all, "list"] as const,
  listByBrand: (brandId: string) =>
    [...tripKeys.lists(), brandId] as const,
  details: (): readonly ["trips", "detail"] =>
    [...tripKeys.all, "detail"] as const,
  detail: (eventId: string) =>
    [...tripKeys.details(), eventId] as const,
  soldCountsByTier: (eventId: string) =>
    [...tripKeys.detail(eventId), "soldCountsByTier"] as const,
  public: (): readonly ["trips", "public"] =>
    [...tripKeys.all, "public"] as const,
  publicBySlug: (brandSlug: string, tripSlug: string) =>
    [...tripKeys.public(), brandSlug, tripSlug] as const,
};

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

export const useTrip = (
  eventId: string | null,
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
      return getTrip(eventId);
    },
    enabled,
    staleTime: TRIP_DETAIL_STALE_MS,
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
    mutationFn: async (input) => createTripDraft(input, "owner"),
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
}

export const useUpdateTripBasics = (): UseMutationResult<
  Trip,
  Error,
  UpdateTripBasicsInput
> => {
  const queryClient = useQueryClient();
  return useMutation<Trip, Error, UpdateTripBasicsInput>({
    mutationFn: async ({ eventId, patch }) =>
      updateTripBasics(eventId, patch),
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
}

export const useUpsertTripDays = (): UseMutationResult<
  TripDay[],
  Error,
  UpsertTripDaysInput
> => {
  const queryClient = useQueryClient();
  return useMutation<TripDay[], Error, UpsertTripDaysInput>({
    mutationFn: async ({ eventId, days }) => upsertTripDays(eventId, days),
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
}

export const useUpsertTripInclusions = (): UseMutationResult<
  TripInclusion[],
  Error,
  UpsertTripInclusionsInput
> => {
  const queryClient = useQueryClient();
  return useMutation<TripInclusion[], Error, UpsertTripInclusionsInput>({
    mutationFn: async ({ eventId, items }) =>
      upsertTripInclusions(eventId, items),
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
}

export const useUpdateTripPricing = (): UseMutationResult<
  TripPricingTier,
  Error,
  UpdateTripPricingInput
> => {
  const queryClient = useQueryClient();
  return useMutation<TripPricingTier, Error, UpdateTripPricingInput>({
    mutationFn: async ({ eventId, patch }) =>
      updateTripPricing(eventId, patch),
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.detail(eventId) });
    },
    onError: (error, { eventId }) => {
      console.error("[useUpdateTripPricing] failed", {
        message: error.message,
        eventId,
      });
    },
  });
};

// ---------------------- META-ORCH-1174 Leg B2: N-package tier mutations ----------------------

export interface CreateTripPricingTierInput {
  eventId: string;
  patch: Omit<TripPricingPatch, "ticketTypeId">;
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
    mutationFn: async ({ eventId, patch }) =>
      createTripPricingTier(eventId, patch),
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
    mutationFn: async ({ eventId, ticketTypeId }) =>
      removeTripPricingTier(eventId, ticketTypeId),
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
}

export const usePublishTrip = (): UseMutationResult<
  Trip,
  Error,
  PublishTripInput
> => {
  const queryClient = useQueryClient();
  return useMutation<Trip, Error, PublishTripInput>({
    mutationFn: async ({ eventId, draftPayload }) =>
      publishTrip(eventId, draftPayload),
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
    mutationFn: async ({ eventId }) => softDeleteTrip(eventId),
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
    mutationFn: async ({ eventId, patch, reason }) =>
      updateLiveTripFields(eventId, patch, reason),
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
