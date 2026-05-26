import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  getPublicBrandBySlug,
  getPublicEventById,
  getPublicEventBySlug,
  type PublicBrandDetail,
  type PublicEventDetail,
} from "../services/publicEventsService";

const PUBLIC_STALE_TIME_MS = 45 * 1000;

export const publicEventKeys = {
  all: ["public-events"] as const,
  detailBySlug: (
    brandSlug: string,
    eventSlug: string,
  ): readonly ["public-events", "detail-by-slug", string, string] =>
    [...publicEventKeys.all, "detail-by-slug", brandSlug, eventSlug] as const,
  detailById: (
    eventId: string,
  ): readonly ["public-events", "detail-by-id", string] =>
    [...publicEventKeys.all, "detail-by-id", eventId] as const,
  brandBySlug: (
    brandSlug: string,
  ): readonly ["public-events", "brand-by-slug", string] =>
    [...publicEventKeys.all, "brand-by-slug", brandSlug] as const,
  brandUpcoming: (
    brandSlug: string,
  ): readonly ["public-events", "brand", string, "upcoming"] =>
    [...publicEventKeys.all, "brand", brandSlug, "upcoming"] as const,
};

const DISABLED_KEY = ["public-events-disabled"] as const;

export const usePublicEventBySlug = (
  brandSlug: string | null,
  eventSlug: string | null,
): UseQueryResult<PublicEventDetail | null> => {
  const enabled = brandSlug !== null && eventSlug !== null;
  return useQuery<PublicEventDetail | null>({
    queryKey: enabled
      ? publicEventKeys.detailBySlug(brandSlug, eventSlug)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicEventDetail | null> => {
      if (!enabled || brandSlug === null || eventSlug === null) return null;
      return getPublicEventBySlug(brandSlug, eventSlug);
    },
  });
};

export const usePublicEventById = (
  eventId: string | null,
): UseQueryResult<PublicEventDetail | null> => {
  const enabled = eventId !== null;
  return useQuery<PublicEventDetail | null>({
    queryKey: enabled ? publicEventKeys.detailById(eventId) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicEventDetail | null> => {
      if (!enabled || eventId === null) return null;
      return getPublicEventById(eventId);
    },
  });
};

export const usePublicBrandBySlug = (
  brandSlug: string | null,
): UseQueryResult<PublicBrandDetail | null> => {
  const enabled = brandSlug !== null;
  return useQuery<PublicBrandDetail | null>({
    queryKey: enabled ? publicEventKeys.brandBySlug(brandSlug) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicBrandDetail | null> => {
      if (!enabled || brandSlug === null) return null;
      return getPublicBrandBySlug(brandSlug);
    },
  });
};
