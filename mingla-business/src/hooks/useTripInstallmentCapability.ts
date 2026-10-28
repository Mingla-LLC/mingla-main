/**
 * Issue #3645 — capability-driven plan authoring. Unknown and errors fail
 * closed, without a toast, so a rolling deploy cannot expose an unsupported
 * payment plan.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchTripInstallmentCapability } from "../services/tripInstallmentCapabilityService";
import { tripKeys } from "./tripKeys";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DISABLED_KEY = ["trips", "installmentCapability", "__disabled__"] as const;

export function useTripInstallmentCapability(
  brandId: string | null | undefined,
): UseQueryResult<boolean, Error> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && typeof brandId === "string" && brandId.length > 0;
  return useQuery<boolean, Error>({
    queryKey: enabled ? tripKeys.installmentCapability(brandId) : DISABLED_KEY,
    queryFn: async () => {
      if (!enabled || brandId == null) return false;
      try {
        return await fetchTripInstallmentCapability(brandId);
      } catch {
        return false;
      }
    },
    enabled,
    staleTime: FIVE_MINUTES_MS,
  });
}
