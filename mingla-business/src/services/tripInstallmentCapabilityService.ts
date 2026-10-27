/** Issue #3645 — server-authoritative trip payment-plan authoring capability. */

import { supabase } from "./supabase";

export async function fetchTripInstallmentCapability(
  brandId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "biz_trip_installments_supported_for_brand",
    { p_brand_id: brandId },
  );
  if (error !== null) {
    throw new Error(`trip installment capability failed: ${error.message}`);
  }
  return data === true;
}
