/**
 * usePublicExperienceBySlug + usePublicExperienceById — META-ORCH-1059 Sub-C/D.
 *
 * Anon-tolerant React Query hooks for a single published experience.
 *   - bySlug → the public buyer page /exp/[brandSlug]/[experienceSlug]
 *   - byId   → the checkout chain /checkout-experience/[experienceEventId]
 *
 * Mirror usePublicTripBySlug / usePublicTripById. No useAuth, no sign-in
 * redirect (feedback_anon_buyer_routes.md). Anon RLS restricts to published
 * experiences only — drafts never resolve.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  getPublicExperienceById,
  getPublicExperienceBySlug,
  type PublicExperiencePayload,
} from "../services/publicExperienceService";

const PUBLIC_EXPERIENCE_STALE_MS = 60 * 1000; // 1 minute

export const publicExperienceKeys = {
  all: ["public-experiences"] as const,
  bySlug: (
    brandSlug: string,
    experienceSlug: string,
  ): readonly ["public-experiences", "by-slug", string, string] =>
    ["public-experiences", "by-slug", brandSlug, experienceSlug] as const,
  byId: (
    eventId: string,
  ): readonly ["public-experiences", "by-id", string] =>
    ["public-experiences", "by-id", eventId] as const,
};

const DISABLED_KEY = ["public-experiences", "__disabled__"] as const;

export const usePublicExperienceBySlug = (
  brandSlug: string | null,
  experienceSlug: string | null,
): UseQueryResult<PublicExperiencePayload | null, Error> => {
  const enabled =
    typeof brandSlug === "string" &&
    brandSlug.length > 0 &&
    typeof experienceSlug === "string" &&
    experienceSlug.length > 0;

  return useQuery<PublicExperiencePayload | null, Error>({
    queryKey: enabled
      ? publicExperienceKeys.bySlug(brandSlug, experienceSlug)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_EXPERIENCE_STALE_MS,
    queryFn: async () => {
      if (!enabled) return null;
      return getPublicExperienceBySlug(brandSlug, experienceSlug);
    },
  });
};

export const usePublicExperienceById = (
  eventId: string | null,
): UseQueryResult<PublicExperiencePayload | null, Error> => {
  const enabled = typeof eventId === "string" && eventId.length > 0;

  return useQuery<PublicExperiencePayload | null, Error>({
    queryKey: enabled
      ? publicExperienceKeys.byId(eventId)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_EXPERIENCE_STALE_MS,
    queryFn: async () => {
      if (!enabled || eventId === null) return null;
      return getPublicExperienceById(eventId);
    },
  });
};
