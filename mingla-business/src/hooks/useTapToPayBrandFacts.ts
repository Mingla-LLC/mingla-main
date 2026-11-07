/**
 * #4271 — the brand's own record, for Tap to Pay availability.
 *
 * An event's server detail carries a slim brand ({id, name}) with no payment
 * facts. Read that way every brand looks unable to take cards, so Tap to Pay
 * never showed at the door (measured on a real iPhone). This reads the full
 * brand on the same cache entry as useBrand (brandKeys.detail), only while the
 * caller holds a slim brand (brandId non-null), and only once auth is ready.
 */
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { getBrand } from "../services/brandsService";
import type { Brand } from "../store/currentBrandStore";
import { brandKeys } from "./brandKeys";

const STALE_TIME_MS = 30 * 1000;

export const useTapToPayBrandFacts = (brandId: string | null): Brand | null => {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return (
    useQuery<Brand | null>({
      queryKey: brandKeys.detail(brandId ?? ""),
      enabled,
      staleTime: STALE_TIME_MS,
      queryFn: async (): Promise<Brand | null> => (brandId === null ? null : getBrand(brandId)),
    }).data ?? null
  );
};
