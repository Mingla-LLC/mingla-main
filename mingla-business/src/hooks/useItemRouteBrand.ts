/**
 * #4453 — the brand of the item a screen shows.
 *
 * `/trip/<id>`, `/event/<id>`, `/rsvp/<id>`, `/experience/<id>` and
 * `/venue/<id>` do not name their brand in the address. Opened from a link
 * while another brand was current, the chrome named the wrong brand. The shell
 * asks once per item which brand it belongs to (the row is readable only to
 * that brand's team) and treats the answer as the route's brand.
 */
import { useQuery } from "@tanstack/react-query";

import type { ItemRouteRef } from "../config/workspaceBrandRoute";
import { supabase } from "../services/supabase";

export interface ItemRouteBrand {
  /** The item's brand, once known (null: not an item screen, or not readable). */
  brandId: string | null;
  /** An item screen whose brand is still being read. */
  pending: boolean;
}

export const itemRouteBrandKey = (ref: ItemRouteRef | null) =>
  ["item-route-brand", ref?.table ?? "none", ref?.id ?? "none"] as const;

export function useItemRouteBrand(ref: ItemRouteRef | null, enabled: boolean): ItemRouteBrand {
  const active = enabled && ref !== null;
  const query = useQuery({
    queryKey: itemRouteBrandKey(ref),
    enabled: active,
    // An item never moves to another brand.
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      if (ref === null) return null;
      const { data, error } = await supabase.from(ref.table).select("brand_id").eq("id", ref.id).maybeSingle();
      if (error) throw error;
      const brandId = (data as { brand_id?: unknown } | null)?.brand_id;
      return typeof brandId === "string" && brandId.length > 0 ? brandId : null;
    },
  });
  if (!active) return { brandId: null, pending: false };
  return { brandId: query.data ?? null, pending: query.isPending };
}
