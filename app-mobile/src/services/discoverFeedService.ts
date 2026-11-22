import { supabase } from "./supabase";
import { raceVenueRead, VenuePurchaseError, VENUE_READ_TIMEOUT_MS } from "./venuePurchaseService";
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
/**
 * #4490 W6 fix 2 (W6-D3): a Venues read gives up after the venue reads' 10 s
 * budget (W3 fix 4, `raceVenueRead`) instead of the client's 20 s hard cap,
 * and is not retried after that (`discoverVenueRetry`), so a server that does
 * not answer shows the error in about 10 s, not 24.
 */
async function invokeDiscoverV2<T>(body: Record<string, unknown>): Promise<T> {
  const request = supabase.functions.invoke<T>("discover-merged-events", {
    body: { contract: 2, deviceTz: deviceTimeZone(), ...body },
  });
  const venues = (body.filters as { kind?: unknown } | undefined)?.kind === "venues";
  const { data, error } = await (venues ? raceVenueRead(request, VENUE_READ_TIMEOUT_MS) : request);
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

/**
 * #4490 W6 fix 2 (W6-D3): the Venues kind's retry rule. The app's default
 * retries once (never on an auth error); a Venues read that already waited its
 * 10 s budget is not retried.
 */
export function discoverVenueRetry(failureCount: number, error: Error): boolean {
  if (error instanceof VenuePurchaseError) return false;
  const msg = error?.message ?? "";
  if (/401|JWT expired|Invalid JWT|invalid claim: missing sub claim/.test(msg)) return false;
  return failureCount < 1;
}
