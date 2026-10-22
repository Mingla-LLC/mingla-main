// Issue #3682 — Host-only follower summary. Unlike the public count hook,
// this RPC reads auth.uid() and therefore must wait for the restored session.
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { brandFollowerCountService } from "../services/brandFollowerCountService";
import { brandFollowKeys } from "./useBrandFollow";

function isForbidden(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const shape = error as { code?: unknown; message?: unknown };
  return (
    shape.code === "42501" ||
    (typeof shape.message === "string" &&
      shape.message.includes("follower_summary_forbidden"))
  );
}

export function useBrandFollowerSummary(brandId: string | null) {
  const { isAuthReady, user } = useAuth();
  const enabled = isAuthReady && !!user?.id && !!brandId;
  return useQuery({
    queryKey: brandFollowKeys.followerSummary(
      brandId ?? "",
      user?.id ?? "",
    ),
    queryFn: () => brandFollowerCountService.getHostSummary(brandId as string),
    enabled,
    staleTime: 60_000,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 1,
  });
}
