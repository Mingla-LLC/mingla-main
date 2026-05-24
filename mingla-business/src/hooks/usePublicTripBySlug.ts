/**
 * usePublicTripBySlug — anon-tolerant fetch of a published trip by brand+trip
 * slug. Tr2 (ORCH-0859).
 *
 * Used by /t/[brandSlug]/[tripSlug].tsx public buyer route. Mirrors
 * usePublicEventBySlug pattern (mingla-business/src/hooks/usePublicEvents.ts).
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth call, no
 * sign-in redirect. Anon Supabase client RLS-restricted via the
 * trip-sidecar-table policies (only published trips visible to anon).
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §4.7
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { tripKeys } from "./useTrips";
import type {
  Trip,
  TripDay,
  TripInclusion,
  TripPricingTier,
} from "../services/tripsService";

const PUBLIC_TRIP_STALE_MS = 60 * 1000; // 1 minute

interface PublicTripPayload {
  trip: Trip;
  brand: {
    id: string;
    slug: string;
    name: string;
    bio: string | null;
    coverMediaUrl: string | null;
  };
}

const DISABLED_KEY = ["trips", "__public_disabled__"] as const;

export const usePublicTripBySlug = (
  brandSlug: string | null,
  tripSlug: string | null,
): UseQueryResult<PublicTripPayload | null, Error> => {
  const enabled =
    typeof brandSlug === "string" &&
    brandSlug.length > 0 &&
    typeof tripSlug === "string" &&
    tripSlug.length > 0;

  return useQuery<PublicTripPayload | null, Error>({
    queryKey: enabled ? tripKeys.publicBySlug(brandSlug, tripSlug) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_TRIP_STALE_MS,
    queryFn: async () => {
      if (!enabled) return null;

      // 1. Resolve brand by slug — anon-readable via brands public policy
      // (a brand is anon-readable when it has any published event;
      // a published trip qualifies because event_type='trip' rows count
      // as "events with public visibility" under the existing brands_public
      // policy).
      const brandResp = await supabase
        .from("brands")
        .select("id, slug, name, description, cover_media_url")
        .eq("slug", brandSlug)
        .is("deleted_at", null)
        .maybeSingle();
      if (brandResp.error) throw brandResp.error;
      if (brandResp.data === null) return null;

      const brand = brandResp.data;

      // 2. Resolve trip by (brand_id, slug, event_type='trip', published)
      const eventResp = await supabase
        .from("events")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("slug", tripSlug)
        .eq("event_type", "trip")
        .in("status", ["scheduled", "live"])
        .is("deleted_at", null)
        .maybeSingle();
      if (eventResp.error) throw eventResp.error;
      if (eventResp.data === null) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = eventResp.data as any;
      const eventId = event.id as string;

      // 3. Sidecar tables — anon-readable via published-only RLS policies
      const [daysResp, tiersResp, inclusionsResp, ticketsResp] = await Promise.all([
        supabase
          .from("trip_days")
          .select("*")
          .eq("event_id", eventId)
          .order("ordinal"),
        supabase.from("trip_pricing_tiers").select("*").eq("event_id", eventId),
        supabase
          .from("trip_inclusions")
          .select("*")
          .eq("event_id", eventId)
          .order("kind")
          .order("ordinal"),
        supabase
          .from("ticket_types")
          .select("*")
          .eq("event_id", eventId)
          .is("deleted_at", null),
      ]);
      if (daysResp.error) throw daysResp.error;
      if (tiersResp.error) throw tiersResp.error;
      if (inclusionsResp.error) throw inclusionsResp.error;
      if (ticketsResp.error) throw ticketsResp.error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const days = (daysResp.data ?? []) as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tiers = (tiersResp.data ?? []) as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inclusions = (inclusionsResp.data ?? []) as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tickets = (ticketsResp.data ?? []) as any[];

      const ticketsById = new Map(tickets.map((tt) => [tt.id, tt]));
      const bt = (event.theme?.business_trip as Record<string, unknown> | undefined) ?? {};

      const trip: Trip = {
        id: event.id,
        brandId: event.brand_id,
        brandSlug: brand.slug,
        title: event.title,
        description: event.description,
        slug: event.slug,
        status: event.status,
        visibility: event.visibility,
        publishedAt: event.published_at,
        timezone: event.timezone,
        coverMediaUrl: event.cover_media_url,
        coverMediaType: event.cover_media_type,
        businessTrip: {
          startAt: typeof bt.startAt === "string" ? bt.startAt : null,
          endAt: typeof bt.endAt === "string" ? bt.endAt : null,
          destinationPlaceId:
            typeof bt.destinationPlaceId === "string" ? bt.destinationPlaceId : null,
          destinationLocationText:
            typeof bt.destinationLocationText === "string"
              ? bt.destinationLocationText
              : null,
          destinationLat:
            typeof bt.destinationLat === "number" ? bt.destinationLat : null,
          destinationLng:
            typeof bt.destinationLng === "number" ? bt.destinationLng : null,
          capacity: typeof bt.capacity === "number" ? bt.capacity : null,
        },
        days: days.map(
          (d): TripDay => ({
            id: d.id,
            eventId: d.event_id,
            ordinal: d.ordinal,
            title: d.title,
            narrative: d.narrative,
            date: d.date,
            stops: Array.isArray(d.stops) ? d.stops : [],
          }),
        ),
        pricingTiers: tiers.map(
          (t): TripPricingTier => {
            const tt = ticketsById.get(t.ticket_type_id);
            // ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer +
            // Planner Surfaces] hotfix — extract installmentSchedule from
            // tier_metadata.installments. Mirrors `publicEventsService.ts:724`.
            // Prior to this hotfix, the field was implicitly `undefined`
            // (not `null`), bypassing the mapper's null-guard and crashing
            // the public trip page on plan-active trips.
            const installmentSchedule =
              (t.tier_metadata?.installments as
                | TripPricingTier["installmentSchedule"]
                | undefined) ?? null;
            return {
              id: t.id,
              eventId: t.event_id,
              ticketTypeId: t.ticket_type_id,
              tierName: t.tier_name,
              tierMetadata: t.tier_metadata ?? {},
              priceCents: tt?.price_cents ?? 0,
              currency: tt?.currency ?? "",
              quantityTotal: tt?.quantity_total ?? null,
              // ORCH-0946 — trip preview page (this hook) does not gate
              // sold-out; the buyer-checkout page (`usePublicTripById`)
              // does. Set null here; if the preview later adds a sold-out
              // badge, wire `pg_public_ticket_types_remaining` here too.
              ticketsRemaining: null,
              isUnlimited: tt?.is_unlimited ?? false,
              installmentSchedule,
            };
          },
        ),
        inclusions: inclusions.map(
          (i): TripInclusion => ({
            id: i.id,
            eventId: i.event_id,
            kind: i.kind,
            item: i.item,
            ordinal: i.ordinal,
          }),
        ),
        createdAt: event.created_at,
        updatedAt: event.updated_at,
        // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — pass-through
        // public-facing fields. refund_policy + booking_deadline must be
        // visible to anon buyers so the public trip page can render the
        // RefundPolicyDisplay ladder + countdown/closed banner.
        refundPolicy: event.refund_policy ?? null,
        bookingDeadline: event.booking_deadline ?? null,
        bookingsClosed: event.bookings_closed === true,
        bookingsClosedAt: event.bookings_closed_at ?? null,
      };

      return {
        trip,
        brand: {
          id: brand.id,
          slug: brand.slug,
          name: brand.name,
          bio: brand.description ?? null,
          coverMediaUrl: brand.cover_media_url ?? null,
        },
      };
    },
  });
};
