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

import {
  createTripDraft,
  getTrip,
  getTripsByBrand,
  updateTripBasics,
  upsertTripDays,
  upsertTripInclusions,
  updateTripPricing,
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
  const enabled = brandId !== null && brandId.length > 0;
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
  const enabled = eventId !== null && eventId.length > 0;
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
