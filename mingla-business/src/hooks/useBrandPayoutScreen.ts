import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
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
      // Keep the native Supabase/AsyncStorage graph behind the authenticated
      // query boundary. Screens may import this hook during headless render or
      // web boot before a request is enabled.
      const { supabase } = await import("../services/supabase");
      const { data, error } = await supabase.rpc("brand_get_payout_screen", {
        p_brand_id: brandId,
      });
      if (error) throw error;
      return parseBrandPayoutScreen(data);
    },
  });
}
