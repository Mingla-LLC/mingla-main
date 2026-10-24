import { supabase } from "./supabase";
import type {
  DiscoverAnchorV2,
  DiscoverFacetsResponse,
  DiscoverFiltersV2,
  DiscoverPageResponse,
} from "../types/discoverFeed";

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
async function invokeDiscoverV2<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("discover-merged-events", {
    body: { contract: 2, deviceTz: deviceTimeZone(), ...body },
  });
  if (error) throw new Error(`Discover unavailable: ${error.message}`);
  if (!data) throw new Error("Discover unavailable: empty response");
  return data;
}

export function fetchDiscoverFacets(
  anchor: DiscoverAnchorV2,
  filters: DiscoverFiltersV2,
): Promise<DiscoverFacetsResponse> {
  return invokeDiscoverV2({ op: "facets", anchor, filters });
}

export function fetchDiscoverPage(
  anchor: DiscoverAnchorV2,
  filters: DiscoverFiltersV2,
  cursor: string | null,
  size = 20,
): Promise<DiscoverPageResponse> {
  return invokeDiscoverV2({ op: "page", anchor, filters, cursor, size });
}
