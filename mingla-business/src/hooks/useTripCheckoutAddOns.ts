/**
 * Issue #3281 — each trip package's add-ons for the trip checkout.
 *
 * `/checkout-trip` reads the trip's own tables (usePublicTripById), which carry
 * no add-ons. The public trip reader (`pg_public_trip_by_slug`, the one owner
 * of the public add-on item since 20281121053281) does: each package with an
 * add-on on sale has `extras`. When the buyer came from the trip page, that
 * page's cached payload (tripKeys.publicBySlug) seeds this query, so no second
 * read is made; otherwise the reader is called once. Nothing is read while the
 * add-ons switch is off.
 *
 * A failed read is logged and the checkout shows no add-ons: the packages
 * still sell (the server prices only add-ons a line sends).
 *
 * Imported only by the trip checkout route, so it stays in that route's chunk.
 */

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { tripKeys } from "./tripKeys";

export type TripAddOnsByTicketType = Readonly<Record<string, unknown>>;

const STALE_MS = 60 * 1000;

/** The reader's raw list per package id, from a list of tier-like objects. */
export const tripAddOnsByTicketType = (
  tiers: unknown,
  listKey: "extras" | "buyerExtras",
): TripAddOnsByTicketType => {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(tiers)) return out;
  for (const tier of tiers) {
    if (tier === null || typeof tier !== "object") continue;
    const row = tier as Record<string, unknown>;
    const list = row[listKey];
    if (typeof row.ticketTypeId === "string" && Array.isArray(list)) {
      out[row.ticketTypeId] = list;
    }
  }
  return out;
};

export const useTripCheckoutAddOns = (
  brandSlug: string | null,
  tripSlug: string | null,
  enabled: boolean,
): UseQueryResult<TripAddOnsByTicketType, Error> => {
  const queryClient = useQueryClient();
  const on =
    enabled &&
    typeof brandSlug === "string" &&
    brandSlug.length > 0 &&
    typeof tripSlug === "string" &&
    tripSlug.length > 0;
  const b = brandSlug ?? "";
  const s = tripSlug ?? "";
  return useQuery<TripAddOnsByTicketType, Error>({
    queryKey: tripKeys.publicAddOnsBySlug(b, s),
    enabled: on,
    staleTime: STALE_MS,
    initialData: () => {
      // The trip page's payload (usePublicTripBySlug) already carries them.
      const page = queryClient.getQueryData<{ trip?: { pricingTiers?: unknown } } | null>(
        tripKeys.publicBySlug(b, s),
      );
      return page?.trip?.pricingTiers !== undefined
        ? tripAddOnsByTicketType(page.trip.pricingTiers, "buyerExtras")
        : undefined;
    },
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pg_public_trip_by_slug", {
        p_brand_slug: b,
        p_event_slug: s,
      });
      if (error !== null) {
        console.warn("[useTripCheckoutAddOns] trip add-ons not read", error.message);
        throw new Error(error.message);
      }
      return tripAddOnsByTicketType((data as { tiers?: unknown } | null)?.tiers, "extras");
    },
  });
};
