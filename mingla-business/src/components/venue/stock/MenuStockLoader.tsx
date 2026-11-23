/**
 * #4490 spec 08 O5 part C — the Menu builder's stock reads, mounted only while
 * the Till is released (VENUE_TILL). Renders nothing: it reports whether the
 * Till is on at this venue and the counts of tracked items to the Menu module,
 * so a venue (and a build) without the Till runs no extra hook or request.
 */
import { useEffect } from "react";

import { useMenuStock } from "../../../hooks/useMenuStock";
import { useVenueFeatures } from "../../../hooks/useVenueFeatures";
import type { MenuStockRow } from "../../../services/venueStockService";

export interface MenuStockState {
  tillOnHere: boolean;
  stockById: Map<string, MenuStockRow> | undefined;
}

export function MenuStockLoader({
  brandId,
  venueId,
  onChange,
}: {
  brandId: string | null;
  venueId: string;
  onChange: (state: MenuStockState) => void;
}): null {
  const features = useVenueFeatures(brandId, venueId);
  const stock = useMenuStock(brandId, venueId, true);
  const tillOnHere = features.data?.features.till.enabled === true;
  const stockById = stock.data;
  useEffect(() => {
    onChange({ tillOnHere, stockById });
  }, [onChange, tillOnHere, stockById]);
  return null;
}
