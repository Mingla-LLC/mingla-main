/**
 * useBrandTaxRegistration — ORCH-1006 Surface 4.
 *
 * Probes whether a brand has an ACTIVE Stripe tax registration (via the
 * `brand-tax-registrations-list` edge fn) so the authoring VAT row knows
 * whether to offer "VAT included in price" or show the "Set up VAT" nudge.
 *
 * Read-only, cached for the session. Fail-closed: any error → treated as NOT
 * registered (the engine likewise degrades to brand-absorbed VAT at checkout,
 * so UI and money path agree).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { useAuth } from "../context/AuthContext";

const DISABLED_KEY = ["brand-tax-registration-disabled"] as const;

interface RawResponse {
  hasActiveRegistration?: boolean;
  reason?: string;
}

export interface BrandTaxRegistrationState {
  hasActiveRegistration: boolean;
}

const fetchBrandTaxRegistration = async (
  brandId: string,
): Promise<BrandTaxRegistrationState> => {
  const { data, error } = await supabase.functions.invoke<RawResponse>(
    "brand-tax-registrations-list",
    { body: { brand_id: brandId } },
  );
  if (error) throw error;
  return { hasActiveRegistration: data?.hasActiveRegistration === true };
};

export const useBrandTaxRegistration = (
  brandId: string | null,
): UseQueryResult<BrandTaxRegistrationState> => {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null;
  return useQuery<BrandTaxRegistrationState>({
    queryKey: enabled ? ["brand", brandId, "taxRegistration"] : DISABLED_KEY,
    enabled,
    queryFn: () => fetchBrandTaxRegistration(brandId as string),
    staleTime: 5 * 60 * 1000, // 5 min — registration state changes rarely.
    retry: 1,
  });
};
