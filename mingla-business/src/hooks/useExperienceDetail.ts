/**
 * useExperienceDetail — META-ORCH-1059 Sub-B.
 *
 * React Query hook for a single experience (events-row + stops + ticket +
 * dates), powering the operator dashboard + edit screens. Auth-gated like the
 * other brand-scoped reads (venue_experiences / events are auth.uid()-scoped).
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  getExperienceDetail,
  type ExperienceDetail,
} from "../services/experienceDetailService";

export const experienceDetailKeys = {
  all: ["experience-detail"] as const,
  detail: (eventId: string) => [...experienceDetailKeys.all, eventId] as const,
};

export function useExperienceDetail(eventId: string | null) {
  const { isAuthReady } = useAuth();
  return useQuery<ExperienceDetail | null>({
    queryKey: experienceDetailKeys.detail(eventId ?? ""),
    queryFn: () => getExperienceDetail(eventId!),
    enabled: isAuthReady && eventId !== null && eventId.length > 0,
    staleTime: 30_000,
  });
}
