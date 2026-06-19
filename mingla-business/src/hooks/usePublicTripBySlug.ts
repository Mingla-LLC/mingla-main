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

import {
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type ThemeInput,
} from "@mingla/event-rendering";

import { supabase } from "../services/supabase";
import { tripKeys } from "./useTrips";
import type {
  Trip,
  TripDay,
  TripInclusion,
  TripPricingTier,
} from "../services/tripsService";
import { coerceTripDayMedia } from "../services/tripsService";

// ORCH-1138 B1 — map raw brand/trip theme columns into a guarded ThemeInput.
// Mirrors publicEventsService.asThemeInput EXACTLY (reuses the package guards;
// does NOT duplicate the hex/slug regex). Returns null when no valid field is
// present so resolveTheme falls back to the brand color then MINGLA_DEFAULT.
const asThemeInput = (
  color: unknown,
  font: unknown,
  animation: unknown,
): ThemeInput | null => {
  const out: ThemeInput = {};
  if (isThemeColor(color)) out.color = color;
  if (isThemeFontSlug(font)) out.font = font;
  if (isThemeAnimationSlug(animation)) out.animation = animation;
  return Object.keys(out).length > 0 ? out : null;
};

// ORCH-1164 (#507 regression recovery) — COMMS-0009 anon-safe-theme contract.
// The brand THEME (theme_color/theme_font/theme_animation) is NOT read off the
// `brands` table: the `anon` Postgres role has NO column-level SELECT on those
// three columns (live: HTTP 401 `42501 permission denied for table brands`),
// which #507 introduced on the trip read path and which blanked the entire anon
// /t/{brandSlug}/{tripSlug} page. The theme is sourced from the anon-safe
// security-definer `business_public_events_view` (brand_theme_color/
// brand_theme_font/brand_theme_animation — anon-readable), filtered to THIS
// trip's row by (brand_slug, slug, event_type='trip'), exactly as the
// experience leg does (publicExperienceService.fetchBrandThemeFromView). The
// view has trip rows (verified live: event_type='trip' rows present). Non-fatal:
// any view error / miss → null (the page resolves the default palette, never
// 401s). The trip hook's direct brands select keeps only anon-granted columns.
const fetchBrandThemeFromView = async (
  brandSlug: string,
  tripSlug: string,
): Promise<ThemeInput | null> => {
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("brand_theme_color, brand_theme_font, brand_theme_animation")
    .eq("brand_slug", brandSlug)
    .eq("slug", tripSlug)
    .eq("event_type", "trip")
    .maybeSingle();
  if (error !== null || data === null) return null;
  return asThemeInput(
    data.brand_theme_color,
    data.brand_theme_font,
    data.brand_theme_animation,
  );
};

// ORCH-1138 B2 — anon-callable remaining-capacity RPC, mirroring
// publicEventsService.fetchTicketTypesRemaining / getPublicTripById. Fail OPEN
// on RPC error (empty map ⇒ ticketsRemaining stays null ⇒ no fabricated
// sold-out; the checkout RPC remains the terminal oversell backstop).
const fetchTripTicketsRemaining = async (
  eventId: string,
): Promise<Map<string, number | null>> => {
  const { data, error } = await supabase.rpc(
    "pg_public_ticket_types_remaining",
    { p_event_id: eventId },
  );
  if (error !== null) {
    console.warn(
      "[ORCH-1138] pg_public_ticket_types_remaining failed on /t/ slug preview; sold-out gate degrades to fail-open (checkout-RPC catch is the backstop)",
      error,
    );
    return new Map();
  }
  const rows = (data ?? []) as Array<{
    ticket_type_id: string;
    sold: number;
    remaining: number | null;
  }>;
  return new Map(rows.map((r) => [r.ticket_type_id, r.remaining]));
};

// ORCH-1138 FIX-3 — coerce the raw brands.cover_media_type text to the
// EventCoverMedia union. Unknown / null ⇒ null (the chip falls back to the hue
// avatar; rule 9 — no fabricated type, no broken alt placeholder).
const coerceBrandCoverType = (
  raw: unknown,
): "image" | "video" | "gif" | null => {
  if (raw === "video" || raw === "gif" || raw === "image") return raw;
  return null;
};

const PUBLIC_TRIP_STALE_MS = 60 * 1000; // 1 minute

interface PublicTripPayload {
  trip: Trip;
  brand: {
    id: string;
    slug: string;
    name: string;
    bio: string | null;
    coverMediaUrl: string | null;
    /**
     * ORCH-1138 FIX-3 — the brand cover's media type + hue so the brand chip can
     * render gif/video covers (EventCoverMedia) and a clean themed hue fallback
     * when there is no cover. null when the brand set no cover.
     */
    coverMediaType: "image" | "video" | "gif" | null;
    coverHue: number | null;
    /**
     * ORCH-1138 B1 — the brand's Direction-A theme (color/font/animation),
     * guarded into a ThemeInput. The /t/ route resolves
     * resolveTheme(brand.theme, themeOverrides) → createThemePalette(...) so the
     * trip page is brand-themed (not the legacy hardcoded warm orange). null
     * when the brand set no valid theme columns.
     */
    theme: ThemeInput | null;
  };
  /**
   * ORCH-1138 B1 — per-trip theme overrides (events.theme_*_override on this
   * trip row). When present, they win over the brand theme at resolve time
   * (resolveTheme(brand.theme, themeOverrides)). null when no valid override.
   */
  themeOverrides: ThemeInput | null;
  /**
   * ORCH-1117 / ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — when false,
   * this is a PAID trip whose brand can't charge yet; the public page renders
   * the floating Buy bar as a NON-tappable "Booking unavailable" info strip
   * instead of the Reserve action. Free trips (and resolver errors) are
   * `true` (fail-open; the checkout 409 remains the terminal backstop).
   */
  bookable: boolean;
}

// ORCH-1117 — mirror resolveEventBookable (publicEventsService.ts) /
// resolveBookable (publicExperienceService.ts): a PAID trip is bookable iff its
// brand can charge (anon-granted pg_brand_can_charge RPC). FREE ⇒ true. On RPC
// error fail OPEN (page stays bookable; the checkout 409 is the backstop) so a
// transient error never wrongly hides a bookable listing.
const resolveTripBookable = async (
  brandId: string,
  isPaid: boolean,
): Promise<boolean> => {
  if (!isPaid) return true;
  const { data, error } = await supabase.rpc("pg_brand_can_charge", {
    p_brand_id: brandId,
  });
  if (error !== null) return true;
  return data === true;
};

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
      if (
        typeof brandSlug !== "string" ||
        brandSlug.length === 0 ||
        typeof tripSlug !== "string" ||
        tripSlug.length === 0
      ) {
        // mirrors `enabled` — narrows brandSlug/tripSlug to non-empty string for
        // the view-theme lookup (ORCH-1164) without an unsafe non-null assert.
        return null;
      }

      // 1. Resolve brand by slug — anon-readable via brands public policy
      // (a brand is anon-readable when it has any published event;
      // a published trip qualifies because event_type='trip' rows count
      // as "events with public visibility" under the existing brands_public
      // policy).
      const brandResp = await supabase
        .from("brands")
        // ORCH-1164 (#507 regression recovery) — theme_color/theme_font/
        // theme_animation are NOT selected here. The `anon` role has no
        // column-level SELECT on those three columns, so including them aborted
        // the whole anon query with `42501 permission denied for table brands`
        // and blanked the public trip page (the #507 regression). The brand
        // theme is sourced from the anon-safe `business_public_events_view`
        // (COMMS-0009) via fetchBrandThemeFromView below.
        // ORCH-1138 FIX-3 — cover_media_type + cover_hue stay here: both ARE
        // anon-granted (verified live) and the view exposes no brand_cover_hue.
        // They let the "Presented by" brand chip render an animated (gif/video)
        // brand cover via the media-aware EventCoverMedia.
        .select(
          "id, slug, name, description, cover_media_url, cover_media_type, cover_hue",
        )
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

      // 3. Sidecar tables — anon-readable via published-only RLS policies.
      // ORCH-1138 B2 — the remaining-capacity RPC is folded into this same
      // batch so the sold-out wiring costs ZERO extra round trips. It fails
      // open internally (catch → empty map), so it is NOT part of the throwing
      // error fan-out below.
      const [
        daysResp,
        tiersResp,
        inclusionsResp,
        ticketsResp,
        masterDateResp,
        remainingById,
      ] = await Promise.all([
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
          // ORCH-1130 Fix #1 — canonical trip dates live on the event_dates
          // master row (ORCH-0950 moved them off theme.business_trip). Mirror
          // the event public page, which sources dates from event_dates.
          supabase
            .from("event_dates")
            .select("event_id,start_at,end_at,is_master")
            .eq("event_id", eventId)
            .eq("is_master", true)
            .maybeSingle(),
          // ORCH-1138 B2 — real per-ticket remaining for the sold-out gate.
          fetchTripTicketsRemaining(eventId),
        ]);
      if (daysResp.error) throw daysResp.error;
      if (tiersResp.error) throw tiersResp.error;
      if (inclusionsResp.error) throw inclusionsResp.error;
      if (ticketsResp.error) throw ticketsResp.error;
      if (masterDateResp.error) throw masterDateResp.error;

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
      // ORCH-1130 Fix #1 — canonical start/end from the event_dates master row;
      // theme mirror is fallback only (older trips never written canonically).
      const masterDate =
        (masterDateResp.data as {
          start_at: string | null;
          end_at: string | null;
        } | null) ?? null;
      const tripStartAt =
        masterDate?.start_at ?? (typeof bt.startAt === "string" ? bt.startAt : null);
      const tripEndAt =
        masterDate?.end_at ?? (typeof bt.endAt === "string" ? bt.endAt : null);

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
          startAt: tripStartAt,
          endAt: tripEndAt,
          destinationPlaceId:
            typeof bt.destinationPlaceId === "string" ? bt.destinationPlaceId : null,
          // ORCH-1138 Leg-1 (native-parity fix #1) — destination from the
          // CANONICAL `events.destination_text` column first, theme mirror only
          // as fallback. Mirrors the authenticated `readBusinessTrip`
          // (tripsService.ts) — the public hook previously read ONLY the
          // theme.business_trip JSON mirror, which is NULL for trips authored via
          // the canonical column (e.g. "The DC Adventure"). That silently hid the
          // destination meta-chip AND the destination half of the route block on
          // BOTH web + native (rule-9 null-guard), while departure (already
          // canonical-first below) rendered — the exact reported divergence.
          destinationLocationText:
            typeof event.destination_text === "string" &&
            (event.destination_text as string).trim().length > 0
              ? (event.destination_text as string)
              : typeof bt.destinationLocationText === "string"
                ? bt.destinationLocationText
                : null,
          destinationLat:
            typeof bt.destinationLat === "number" ? bt.destinationLat : null,
          destinationLng:
            typeof bt.destinationLng === "number" ? bt.destinationLng : null,
          // ORCH-1016 — departure (origin). Prefer the canonical
          // events.departure_text column; fall back to theme.business_trip.
          departurePlaceId:
            typeof bt.departurePlaceId === "string" ? bt.departurePlaceId : null,
          departureLocationText:
            typeof event.departure_text === "string" &&
            (event.departure_text as string).trim().length > 0
              ? (event.departure_text as string)
              : typeof bt.departureLocationText === "string"
                ? bt.departureLocationText
                : null,
          departureLat:
            typeof bt.departureLat === "number" ? bt.departureLat : null,
          departureLng:
            typeof bt.departureLng === "number" ? bt.departureLng : null,
          // ORCH-1138 Leg-1 (native-parity fix #1) — capacity from the CANONICAL
          // ticket-type quantity (mirrors `readBusinessTrip`: tripsService.ts uses
          // `ticketTypes[0]?.quantity_total`), theme mirror only as fallback. The
          // public hook previously read ONLY `bt.capacity`, which is NULL for
          // canonical-authored trips → the "N seats left · M max" chip silently
          // hid (rule-9) even though the ticket carried a real cap (e.g. 102).
          capacity:
            typeof tickets[0]?.quantity_total === "number"
              ? (tickets[0].quantity_total as number)
              : typeof bt.capacity === "number"
                ? bt.capacity
                : null,
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
            // ORCH-1119 — per-day gallery (anon-readable via the existing
            // trip_days published-only RLS; .select("*") already returns media).
            media: coerceTripDayMedia(d.media),
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
            const isUnlimited = tt?.is_unlimited ?? false;
            return {
              id: t.id,
              eventId: t.event_id,
              ticketTypeId: t.ticket_type_id,
              tierName: t.tier_name,
              tierMetadata: t.tier_metadata ?? {},
              priceCents: tt?.price_cents ?? 0,
              currency: tt?.currency ?? "",
              quantityTotal: tt?.quantity_total ?? null,
              // ORCH-1138 B2 — real remaining for the public-page sold-out gate,
              // mirroring getPublicTripById (publicEventsService). null when
              // unlimited (never "0 left") or when the RPC failed open
              // (no fabricated sold-out — Constitution #9).
              ticketsRemaining: isUnlimited
                ? null
                : (remainingById.get(t.ticket_type_id) ?? null),
              isUnlimited,
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
        ticketsSoldCount: 0,
      };

      // ORCH-1117 — a trip is PAID when its first pricing tier costs > 0
      // (mirrors the trip price source above). Resolve the brand's
      // charge-readiness so the floating bar can render its unavailable state.
      const isPaid = (trip.pricingTiers[0]?.priceCents ?? 0) > 0;
      const bookable = await resolveTripBookable(brand.id, isPaid);

      // ORCH-1138 B1 — guard the brand theme + the per-trip overrides into
      // ThemeInputs (the page resolves + builds the palette). Trips are events
      // rows, so `event` (select("*")) already carries theme_*_override.
      // ORCH-1164 (#507 regression recovery) — the BRAND theme is now sourced
      // from the anon-safe `business_public_events_view` (COMMS-0009), NOT from
      // brands.theme_* (which anon cannot read). The per-trip overrides still
      // come off the `events` row (anon-readable; not on the brands table).
      const brandTheme = await fetchBrandThemeFromView(brandSlug, tripSlug);
      const themeOverrides = asThemeInput(
        event.theme_color_override,
        event.theme_font_override,
        event.theme_animation_override,
      );

      return {
        trip,
        brand: {
          id: brand.id,
          slug: brand.slug,
          name: brand.name,
          bio: brand.description ?? null,
          coverMediaUrl: brand.cover_media_url ?? null,
          // ORCH-1138 FIX-3 — coerce the raw brand cover media type to the
          // EventCoverMedia union; unknown/null → null → image render / hue
          // fallback (rule 9, never a fabricated type).
          coverMediaType: coerceBrandCoverType(brand.cover_media_type),
          coverHue:
            typeof brand.cover_hue === "number" ? brand.cover_hue : null,
          theme: brandTheme,
        },
        themeOverrides,
        bookable,
      };
    },
  });
};
