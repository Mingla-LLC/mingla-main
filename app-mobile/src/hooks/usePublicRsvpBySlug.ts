/**
 * usePublicRsvpBySlug — ORCH-1163 [rsvp-shared-body] · LEG 2 of META-ORCH-1166.
 *
 * The CONSUMER anon read for the canonical public RSVP page, fed by the ONE read
 * RPC `pg_public_rsvp_by_slug` (the SAME RPC the buyer-web + business surfaces read —
 * one-read-path). Returns the RsvpOfferingBody payload mapped → the SHARED
 * `PublicEventProps` + the `RsvpOfferingConfig` host-control block (going count /
 * capacity / plus-ones / waitlist / approval mode).
 *
 * The deck-card seed remains the warm-open fast path (ConsumerEventDetailScreen);
 * this hook is the COLD-open + authoritative refresh (closes the consumer seedless
 * cap). PRIVACY is enforced SERVER-SIDE in the RPC (locationGeo null + cityGeo set
 * when the street is hidden) — the client never re-derives it.
 *
 * 🔒 I-MOR-0827-PACKAGE-ISOLATION: imports only @mingla/offering-rendering types +
 * the anon supabase client. No mingla-business/src import.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  PublicBrandProps,
  PublicEventProps,
  RsvpOfferingConfig,
} from "@mingla/offering-rendering";

import { supabase } from "../services/supabase";

export interface CanonicalPublicRsvp {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  config: RsvpOfferingConfig;
}

export const publicRsvpBySlugKeys = {
  all: ["publicRsvpBySlug"] as const,
  bySlug: (brandSlug: string, eventSlug: string) =>
    [...publicRsvpBySlugKeys.all, brandSlug, eventSlug] as const,
};

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const asLatLng = (v: unknown): { lat: number; lng: number } | null => {
  if (v === null || typeof v !== "object") return null;
  const o = v as { lat?: unknown; lng?: unknown };
  return typeof o.lat === "number" &&
    Number.isFinite(o.lat) &&
    typeof o.lng === "number" &&
    Number.isFinite(o.lng)
    ? { lat: o.lat, lng: o.lng }
    : null;
};

const asFormat = (v: unknown): "in-person" | "online" | "hybrid" => {
  if (v === "online" || v === "hybrid") return v;
  if (v === "in_person") return "in-person";
  return "in-person";
};

const asCoverType = (v: unknown): "image" | "video" | "gif" | null =>
  v === "image" || v === "video" || v === "gif" ? v : null;

/** Map the pg_public_rsvp_by_slug json payload → shared props + RSVP config. */
export const mapRsvpRpcPayload = (
  payload: Record<string, unknown>,
): CanonicalPublicRsvp => {
  const currency = asString(payload.currency) ?? "USD";
  const brandRaw = (payload.brand ?? null) as Record<string, unknown> | null;
  const event: PublicEventProps = {
    id: String(payload.id ?? ""),
    name: String(payload.name ?? ""),
    brandId: String(payload.brandId ?? ""),
    brandSlug: String(payload.brandSlug ?? ""),
    eventSlug: String(payload.eventSlug ?? ""),
    description: typeof payload.description === "string" ? payload.description : "",
    dateLine: "",
    dateSubline: null,
    datesList: [],
    status:
      payload.status === "cancelled"
        ? "cancelled"
        : payload.status === "ended"
          ? "ended"
          : "published",
    endedAt: null,
    format: asFormat(payload.format),
    venueName: asString(payload.venueName),
    address: asString(payload.address),
    hideAddressUntilTicket: payload.hideAddressUntilTicket === true,
    locationGeo: asLatLng(payload.locationGeo),
    cityGeo: asLatLng(payload.cityGeo),
    coverHue: 0,
    coverMediaUrl: asString(payload.coverMediaUrl),
    coverMediaType: asCoverType(payload.coverMediaType),
    coverCredit: asString(payload.coverMediaCredit),
    // RSVP is ticketless.
    tickets: [],
    currency,
    partyTypes: asStringArray(payload.partyTypes),
    vibeTags: asStringArray(payload.vibeTags),
    musicGenres: asStringArray(payload.musicGenres),
    themeOverrides: null,
  };
  const brand: PublicBrandProps | null =
    brandRaw === null
      ? null
      : {
          id: String(brandRaw.id ?? ""),
          slug: String(brandRaw.slug ?? ""),
          displayName: String(brandRaw.name ?? "Brand"),
          photo: asString(brandRaw.profilePhotoUrl) ?? undefined,
          theme: null,
        };
  const config: RsvpOfferingConfig = {
    capacity:
      typeof payload.rsvpCapacity === "number" ? payload.rsvpCapacity : null,
    goingCount:
      typeof payload.rsvpGoingCount === "number" ? payload.rsvpGoingCount : 0,
    allowPlusOnes: payload.rsvpAllowPlusOnes === true,
    plusOnesMax:
      typeof payload.rsvpPlusOnesMax === "number" ? payload.rsvpPlusOnesMax : 0,
    waitlistEnabled: payload.rsvpWaitlistEnabled === true,
    manualApproval: payload.rsvpApprovalMode === "manual",
  };
  return { event, brand, config };
};

export const usePublicRsvpBySlug = (
  brandSlug: string | null,
  eventSlug: string | null,
): UseQueryResult<CanonicalPublicRsvp | null> => {
  const enabled = brandSlug !== null && eventSlug !== null;
  return useQuery<CanonicalPublicRsvp | null>({
    queryKey: enabled
      ? publicRsvpBySlugKeys.bySlug(brandSlug, eventSlug)
      : publicRsvpBySlugKeys.all,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CanonicalPublicRsvp | null> => {
      if (!enabled || brandSlug === null || eventSlug === null) return null;
      const { data, error } = await supabase.rpc("pg_public_rsvp_by_slug", {
        p_brand_slug: brandSlug,
        p_event_slug: eventSlug,
      });
      if (error !== null) throw error;
      if (data === null || typeof data !== "object") return null;
      return mapRsvpRpcPayload(data as Record<string, unknown>);
    },
  });
};
