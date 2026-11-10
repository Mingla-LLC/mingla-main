/**
 * #4334 — a brand save that moves the pin. The pin and its Google place id
 * are written in ONE statement by biz_update_brand_pin, which asserts the id
 * so the same place re-picked onto refined coordinates keeps it (a direct
 * table write cannot, and the server clears the id of a pin it sees move).
 * Everything else in the patch stays a table write and goes first, so a
 * refused pin leaves it saved and the error shown (useUpdateBrand then
 * re-reads the brand instead of restoring stale values). Loaded on demand by
 * updateBrand, only when a save moves the pin, so it stays out of the boot
 * payload.
 */
import { supabase } from "./supabase";
import {
  mapBrandRowToUi,
  mapUiToBrandUpdatePatch,
  type BrandRow,
} from "./brandMapping";
import type { Brand } from "../types/brand";

const writeRow = async (
  brandId: string,
  payload: Record<string, unknown>,
): Promise<BrandRow> => {
  const { data, error } = await supabase
    .from("brands")
    .update(payload)
    .eq("id", brandId)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw error;
  if (data === null) {
    throw new Error("updateBrand: update returned null row (possibly soft-deleted concurrently)");
  }
  return data as BrandRow;
};

/**
 * A Google place id, trimmed, or null. The server refuses anything else
 * (location_place_id_invalid); a pin with an id from elsewhere saves without
 * it rather than failing the whole save after the rest of it has saved.
 */
export const googlePlaceIdOrNull = (value: string | null | undefined): string | null => {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{10,1024}$/.test(id) && !id.startsWith("dXJuOm") ? id : null;
};

export async function updateBrandWithPin(
  brandId: string,
  patch: Partial<Brand>,
  existingDescription: string | null,
): Promise<Brand> {
  const { lat, lng, locationProviderPlaceId } = patch;
  // The RPC writes both coordinates, so it runs only when the patch carries
  // both (null clears the pin). A patch with only an id, or one coordinate,
  // stays a plain table write and can never null the other coordinate.
  if (lat === undefined || lng === undefined) {
    const row = await writeRow(brandId, mapUiToBrandUpdatePatch(patch, { existingDescription }));
    return mapBrandRowToUi(row, { role: "owner" });
  }
  const rest = mapUiToBrandUpdatePatch(
    { ...patch, lat: undefined, lng: undefined, locationProviderPlaceId: undefined },
    { existingDescription },
  );
  if (Object.keys(rest).length > 0) await writeRow(brandId, rest);

  const { data, error } = await supabase.rpc("biz_update_brand_pin", {
    p_brand_id: brandId,
    p_lat: lat,
    p_lng: lng,
    p_location_place_id: googlePlaceIdOrNull(locationProviderPlaceId),
  });
  // [TRANSITIONAL] #4334 — until 20280526004334 is applied the function is
  // missing (PGRST202): write the pin as a table update, as before (a refined
  // pin then loses its id, as it always has). Exit: the migration is live.
  if (error?.code === "PGRST202") {
    const row = await writeRow(
      brandId,
      mapUiToBrandUpdatePatch({ lat, lng, locationProviderPlaceId }, { existingDescription }),
    );
    return mapBrandRowToUi(row, { role: "owner" });
  }
  if (error) throw error;
  if (data === null) throw new Error("updateBrand: brand pin update returned no row");
  return mapBrandRowToUi(data as BrandRow, { role: "owner" });
}
