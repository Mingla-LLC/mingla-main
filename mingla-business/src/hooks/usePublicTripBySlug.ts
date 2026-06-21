/**
 * usePublicTripBySlug — anon-tolerant fetch of a published trip by brand+trip
 * slug. Tr2 (ORCH-0859).
 *
 * Used by /t/[brandSlug]/[tripSlug].tsx public buyer route.
 *
 * META-ORCH-1174 Leg A.2 (Seth single-source decision) — this hook now reads
 * the ONE canonical anon RPC `pg_public_trip_by_slug(p_brand_slug, p_event_slug)`
 * (SECURITY DEFINER, GRANT anon) instead of the prior per-surface fan-out of
 * direct table reads (brands + events + 5 sidecar queries + 2 helper RPCs). The
 * RPC returns the FULL trip payload (master dates, route legs + lat/lng, per-tier
 * rows WITH remaining + installments, trip_days itinerary, trip_inclusions,
 * refund_policy, booking_deadline, brand card incl. theme + verified) — the
 * definer owner reads brands.theme_* directly, so the COMMS-0009 anon
 * column-level grant gap that previously forced a `business_public_events_view`
 * theme detour (ORCH-1164/#507) no longer applies here. This hook maps the RPC
 * JSON into the SAME `PublicTripPayload` output type as before (zero downstream
 * churn — TripPreview + tripOfferingAdapter are unchanged).
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth call, no
 * sign-in redirect.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §4.7
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type ThemeInput,
} from "@mingla/offering-rendering";

import { supabase } from "../services/supabase";
import { tripKeys } from "./useTrips";
import type {
  Trip,
  TripDay,
  TripInclusion,
  TripInstallmentScheduleData,
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

// META-ORCH-1174 Leg A.2 — coerce the raw cover_media_type text (brand OR trip)
// to the EventCoverMedia union. Unknown / null ⇒ null (the chip falls back to the
// hue avatar; rule 9 — no fabricated type, no broken alt placeholder).
const coerceBrandCoverType = (
  raw: unknown,
): "image" | "video" | "gif" | null => {
  if (raw === "video" || raw === "gif" || raw === "image") return raw;
  return null;
};

const numOrNull = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : null;

const strOrNull = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

const PUBLIC_TRIP_STALE_MS = 60 * 1000; // 1 minute

// META-ORCH-1174 Leg A.2 — the raw JSON shape returned by
// `pg_public_trip_by_slug` (mirrors the migration's json_build_object keys).
// All fields are read defensively; the mapper below narrows them into the
// existing typed `PublicTripPayload`.
interface RpcTripBrand {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  coverHue: number | null;
  verified: boolean;
  themeColor: unknown;
  themeFont: unknown;
  themeAnimation: unknown;
}
interface RpcTripDay {
  id: string;
  ordinal: number;
  title: string;
  narrative: string | null;
  date: string | null;
  stops: unknown;
  media: unknown;
}
interface RpcTripInclusion {
  id: string;
  kind: "included" | "excluded";
  item: string;
  ordinal: number;
}
interface RpcTripTier {
  id: string;
  ticketTypeId: string;
  tierName: string;
  tierMetadata: Record<string, unknown> | null;
  priceCents: number;
  currency: string;
  quantityTotal: number | null;
  ticketsRemaining: number | null;
  isUnlimited: boolean;
  isFree: boolean;
  installments: unknown;
}
interface RpcTripPayload {
  id: string;
  brandId: string;
  brandSlug: string;
  tripSlug: string;
  title: string;
  description: string | null;
  status: string;
  timezone: string | null;
  startAt: string | null;
  endAt: string | null;
  departureText: string | null;
  destinationText: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  departureLat: number | null;
  departureLng: number | null;
  currency: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  refundPolicy: unknown;
  bookingDeadline: string | null;
  bookingsClosed: boolean;
  themeColorOverride: unknown;
  themeFontOverride: unknown;
  themeAnimationOverride: unknown;
  brand: RpcTripBrand;
  days: RpcTripDay[];
  inclusions: RpcTripInclusion[];
  tiers: RpcTripTier[];
}

// META-ORCH-1174 Leg A.2 — narrow tier_metadata.installments into the typed
// TripInstallmentScheduleData (or null). Same shape as the prior inline cast in
// the tiers mapper; null when absent/malformed (no plan).
const asInstallmentSchedule = (
  raw: unknown,
): TripInstallmentScheduleData | null => {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as { deposit_pct?: unknown; installments?: unknown };
  if (typeof obj.deposit_pct !== "number" || !Array.isArray(obj.installments)) {
    return null;
  }
  return raw as TripInstallmentScheduleData;
};

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
        // mirrors `enabled` — narrows to non-empty strings for the RPC params.
        return null;
      }

      // META-ORCH-1174 Leg A.2 — the ONE canonical anon read path. The SECURITY
      // DEFINER RPC returns the full trip payload (identity, master dates, route
      // legs + destination/departure lat/lng, per-tier rows WITH remaining +
      // installments, trip_days, trip_inclusions, refund_policy, booking_deadline,
      // and the brand card incl. theme + verified). Restricted server-side to
      // event_type='trip' + published. Returns null when no such trip exists.
      const { data, error } = await supabase.rpc("pg_public_trip_by_slug", {
        p_brand_slug: brandSlug,
        p_event_slug: tripSlug,
      });
      if (error !== null) throw error;
      if (data === null || data === undefined) return null;
      const p = data as RpcTripPayload;

      const tripStartAt = p.startAt;
      const tripEndAt = p.endAt;
      // Capacity = the first tier's total (mirrors the prior canonical
      // ticket-type quantity source; theme mirror is folded into the RPC).
      const firstTierQty = p.tiers[0]?.quantityTotal ?? null;

      const trip: Trip = {
        id: p.id,
        brandId: p.brandId,
        brandSlug: p.brand.slug,
        title: p.title,
        description: p.description,
        slug: p.tripSlug,
        // The RPC restricts to scheduled|live; the Trip union accepts both.
        status: p.status as Trip["status"],
        // The public buyer page never reads `visibility`/`publishedAt`; the RPC
        // only surfaces published trips. Keep the prior public-path semantics
        // (mirror the published status; published_at not needed by the body).
        visibility: "public",
        publishedAt: null,
        timezone: p.timezone ?? "",
        coverMediaUrl: p.coverMediaUrl,
        coverMediaType: p.coverMediaType,
        businessTrip: {
          startAt: tripStartAt,
          endAt: tripEndAt,
          // placeIds are not surfaced by the public RPC (not consumed by the
          // body); null preserves the prior public-path behavior.
          destinationPlaceId: null,
          destinationLocationText: strOrNull(p.destinationText),
          // META-ORCH-1174 — destination lat/lng now arrive via the RPC (float8)
          // so the §11 map renders (the consumer gap this leg closes; web/business
          // already had them via the theme mirror — same value, now single-source).
          destinationLat: numOrNull(p.destinationLat),
          destinationLng: numOrNull(p.destinationLng),
          departurePlaceId: null,
          departureLocationText: strOrNull(p.departureText),
          departureLat: numOrNull(p.departureLat),
          departureLng: numOrNull(p.departureLng),
          capacity: firstTierQty,
        },
        days: (p.days ?? []).map(
          (d): TripDay => ({
            id: d.id,
            eventId: p.id,
            ordinal: d.ordinal,
            title: d.title,
            narrative: d.narrative,
            date: d.date,
            stops: Array.isArray(d.stops) ? d.stops : [],
            media: coerceTripDayMedia(d.media),
          }),
        ),
        pricingTiers: (p.tiers ?? []).map(
          (t): TripPricingTier => ({
            id: t.id,
            eventId: p.id,
            ticketTypeId: t.ticketTypeId,
            tierName: t.tierName,
            tierMetadata: t.tierMetadata ?? {},
            priceCents: t.priceCents ?? 0,
            currency: t.currency ?? "",
            quantityTotal: t.quantityTotal ?? null,
            // ORCH-1138 B2 / META-ORCH-1174 — real remaining for the sold-out
            // gate. null when unlimited (never "0 left") — the RPC already emits
            // null for unlimited/uncapped tiers (no fabricated sold-out, rule 9).
            ticketsRemaining: t.isUnlimited ? null : (t.ticketsRemaining ?? null),
            isUnlimited: t.isUnlimited === true,
            installmentSchedule: asInstallmentSchedule(t.installments),
            // META-ORCH-1174 Leg B2 — per-package description from tier_metadata.
            description:
              typeof (t.tierMetadata as Record<string, unknown> | null)?.description ===
              "string"
                ? ((t.tierMetadata as Record<string, unknown>).description as string)
                : null,
          }),
        ),
        inclusions: (p.inclusions ?? []).map(
          (i): TripInclusion => ({
            id: i.id,
            eventId: p.id,
            kind: i.kind,
            item: i.item,
            ordinal: i.ordinal,
          }),
        ),
        // createdAt/updatedAt are not surfaced by the public RPC and are not read
        // by the public body; empty strings preserve the prior public-path shape.
        createdAt: "",
        updatedAt: "",
        // ORCH-0875 — pass-through public-facing fields for the RefundPolicyDisplay
        // ladder + countdown/closed banner.
        refundPolicy:
          (p.refundPolicy as Trip["refundPolicy"]) ?? null,
        bookingDeadline: p.bookingDeadline ?? null,
        bookingsClosed: p.bookingsClosed === true,
        bookingsClosedAt: null,
        ticketsSoldCount: 0,
      };

      // ORCH-1117 — a trip is PAID when its first pricing tier costs > 0. Resolve
      // the brand's charge-readiness so the floating bar can render its
      // unavailable state (the trip RPC does not encode charge-readiness).
      const isPaid = (trip.pricingTiers[0]?.priceCents ?? 0) > 0;
      const bookable = await resolveTripBookable(p.brandId, isPaid);

      // META-ORCH-1174 Leg A.2 — the BRAND theme now comes off the RPC payload
      // (the definer owner reads brands.theme_* directly, so the COMMS-0009 anon
      // column-grant gap that forced the prior view detour no longer applies).
      // Per-trip overrides ride the same RPC payload (events.theme_*_override).
      const brandTheme = asThemeInput(
        p.brand.themeColor,
        p.brand.themeFont,
        p.brand.themeAnimation,
      );
      const themeOverrides = asThemeInput(
        p.themeColorOverride,
        p.themeFontOverride,
        p.themeAnimationOverride,
      );

      return {
        trip,
        brand: {
          id: p.brand.id,
          slug: p.brand.slug,
          name: p.brand.name,
          bio: p.brand.bio ?? null,
          coverMediaUrl: p.brand.coverMediaUrl ?? null,
          // ORCH-1138 FIX-3 — coerce the raw brand cover media type to the
          // EventCoverMedia union; unknown/null → null → image render / hue
          // fallback (rule 9, never a fabricated type).
          coverMediaType: coerceBrandCoverType(p.brand.coverMediaType),
          coverHue: numOrNull(p.brand.coverHue),
          theme: brandTheme,
        },
        themeOverrides,
        bookable,
      };
    },
  });
};
