import { useQueries, type UseQueryResult } from "@tanstack/react-query";
// Types only: the service (contracts and normalizers) is loaded when a query
// first runs, so it stays out of the eager web `__common` chunk (#4037, #943).
import type {
  BrandTrafficRollup,
  EntityTrafficRollup,
  TrafficEntityType,
  TrafficRange,
} from "../services/trafficAnalyticsService";

const loadTrafficService = () => import("../services/trafficAnalyticsService");

const STALE_TIME_MS = 60_000;

const disabledQueryResult = <TData>(): UseQueryResult<TData, Error> =>
  ({
    data: undefined,
    error: null,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError: false,
    isFetched: false,
    isFetchedAfterMount: false,
    isFetching: false,
    isInitialLoading: false,
    isLoading: false,
    isLoadingError: false,
    isPaused: false,
    isPending: true,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: true,
    isSuccess: false,
    status: "pending",
    fetchStatus: "idle",
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    refetch: async () => disabledQueryResult<TData>(),
  }) as UseQueryResult<TData, Error>;

export const trafficAnalyticsKeys = {
  all: ["traffic-analytics"] as const,
  brand: (brandId: string, range: TrafficRange) =>
    ["traffic-analytics", "brand", brandId, range] as const,
  entity: (
    brandId: string,
    entityType: TrafficEntityType,
    entityId: string | null,
    range: TrafficRange,
  ) =>
    [
      "traffic-analytics",
      "entity",
      brandId,
      entityType,
      entityId,
      range,
    ] as const,
  disabledBrand: ["traffic-analytics", "disabled", "brand"] as const,
  disabledEntity: ["traffic-analytics", "disabled", "entity"] as const,
};

export const useBrandTrafficRollup = (
  brandId: string | null,
  range: TrafficRange,
  callerEnabled: boolean,
): UseQueryResult<BrandTrafficRollup, Error> => {
  const enabled = callerEnabled && brandId !== null;
  const queries = useQueries({
    queries: [
      {
        queryKey:
          enabled && brandId !== null
            ? trafficAnalyticsKeys.brand(brandId, range)
            : trafficAnalyticsKeys.disabledBrand,
        enabled,
        staleTime: STALE_TIME_MS,
        queryFn: async (): Promise<BrandTrafficRollup> => {
          if (brandId === null)
            throw new Error("brand traffic brand is unavailable");
          const { fetchBrandTrafficRollup } = await loadTrafficService();
          return fetchBrandTrafficRollup(brandId, range);
        },
      },
    ],
  });
  return queries[0] ?? disabledQueryResult<BrandTrafficRollup>();
};

export const useEntityTrafficRollup = (
  brandId: string | null,
  entityType: TrafficEntityType | null,
  entityId: string | null,
  range: TrafficRange,
  callerEnabled: boolean,
): UseQueryResult<EntityTrafficRollup, Error> => {
  // Decision 4 (#4037): every page request names its brand.
  const hasIdentity =
    brandId !== null &&
    entityType !== null &&
    (entityType === "brand" || entityId !== null);
  const enabled = callerEnabled && hasIdentity;
  const queries = useQueries({
    queries: [
      {
        queryKey:
          enabled && brandId !== null && entityType !== null
            ? trafficAnalyticsKeys.entity(brandId, entityType, entityId, range)
            : trafficAnalyticsKeys.disabledEntity,
        enabled,
        staleTime: STALE_TIME_MS,
        queryFn: async (): Promise<EntityTrafficRollup> => {
          if (brandId === null || entityType === null)
            throw new Error("entity traffic identity is unavailable");
          const { fetchEntityTrafficRollup } = await loadTrafficService();
          return fetchEntityTrafficRollup(brandId, entityType, entityId, range);
        },
      },
    ],
  });
  return queries[0] ?? disabledQueryResult<EntityTrafficRollup>();
};
