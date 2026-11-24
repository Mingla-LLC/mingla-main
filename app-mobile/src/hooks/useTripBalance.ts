import { useQuery } from "@tanstack/react-query";

import { tripBalanceKeys } from "./queryKeys";
import { viewTripBalance } from "../services/tripBalancePayService";

export function useTripBalance(orderId: string | null, enabled = true) {
  return useQuery({
    queryKey: tripBalanceKeys.detail(orderId ?? "none"),
    queryFn: () => viewTripBalance(orderId as string),
    enabled: enabled && orderId !== null,
    staleTime: 15_000,
    retry: 1,
  });
}
