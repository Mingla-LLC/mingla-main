import { useQuery } from "@tanstack/react-query";

import { purchaseKeys } from "./queryKeys";
import { fetchMyClaimIdentifiers } from "../services/claimContactService";

export function useClaimIdentifiers(userId: string | null | undefined) {
  return useQuery({
    queryKey: purchaseKeys.identifiers(userId ?? "none"),
    queryFn: fetchMyClaimIdentifiers,
    enabled: !!userId,
    staleTime: 60_000,
  });
}
