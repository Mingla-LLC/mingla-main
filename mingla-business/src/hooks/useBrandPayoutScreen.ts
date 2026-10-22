import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  parseBrandPayoutScreen,
  type BrandPayoutScreenDTO,
} from "../utils/payoutScreen";

export const brandPayoutScreenKey = (brandId: string) =>
  ["brand", brandId, "payout-screen"] as const;

export function useBrandPayoutScreen(
  brandId: string | null,
): UseQueryResult<BrandPayoutScreenDTO | null, Error> {
  const { isAuthReady, user } = useAuth();
  return useQuery({
    queryKey: brandPayoutScreenKey(brandId ?? "none"),
    enabled: isAuthReady && user !== null && brandId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("brand_get_payout_screen", {
        p_brand_id: brandId,
      });
      if (error) throw error;
      return parseBrandPayoutScreen(data);
    },
  });
}
