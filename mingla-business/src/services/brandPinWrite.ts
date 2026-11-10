/**
 * #4334 — the brand profile pin and its Google place id, written in ONE
 * statement by biz_update_brand_pin, which asserts the id so the same place
 * re-picked onto refined coordinates keeps it (a direct table write cannot,
 * and the server clears the id of a pin it sees move). Loaded on demand by
 * updateBrand, only when a save moves the pin, so it stays out of the boot
 * payload.
 */
import { supabase } from "./supabase";
import type { BrandRow } from "./brandMapping";

/**
 * The saved brand row, or null when the function is missing (PGRST202).
 * [TRANSITIONAL] null until 20280526004334 is applied — the caller then writes
 * the pin as a table update, as before. Exit: the migration is live.
 * Any other error is thrown.
 */
export async function writeBrandPin(
  brandId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
  placeId: string | null | undefined,
): Promise<BrandRow | null> {
  const { data, error } = await supabase.rpc("biz_update_brand_pin", {
    p_brand_id: brandId,
    p_lat: lat ?? null,
    p_lng: lng ?? null,
    p_location_place_id: placeId ?? null,
  });
  if (error?.code === "PGRST202") return null;
  if (error) throw error;
  if (data === null) throw new Error("updateBrand: brand pin update returned no row");
  return data as BrandRow;
}
