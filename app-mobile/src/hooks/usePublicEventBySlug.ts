/**
 * usePublicEventBySlug — ORCH-1167 [event-page-canonical].
 *
 * The CONSUMER anon read for the canonical standard ticketed-event public page,
 * fed by the ONE read RPC `pg_public_event_by_slug` (the SAME RPC the buyer-web +
 * business surfaces read — SC-7 one-read-path). Returns the full EventOfferingBody
 * payload mapped → the SHARED `PublicEventProps` contract incl. the pills
 * (partyTypes/vibeTags/musicGenres), city + cityGeo, and per-tier server all-in.
 *
 * The deck-card seed remains the warm-open fast path (ConsumerEventDetailScreen);
 * this hook is the COLD-open + authoritative source (closes the OQ-6 seedless cap
 * for standard events). PRIVACY is enforced SERVER-SIDE in the RPC (locationGeo
 * null + cityGeo set when the street is hidden) — the client never re-derives it.
 *
 * 🔒 I-MOR-0827-PACKAGE-ISOLATION: imports only @mingla/event-rendering types +
 * the anon supabase client. No mingla-business/src import.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  PublicBrandProps,
  PublicEventProps,
  PublicTicketProps,
} from "@mingla/event-rendering";

import { supabase } from "../services/supabase";

export interface CanonicalPublicEvent {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
}

export const publicEventBySlugKeys = {
  all: ["publicEventBySlug"] as const,
  bySlug: (brandSlug: string, eventSlug: string) =>
    [...publicEventBySlugKeys.all, brandSlug, eventSlug] as const,
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

const mapRpcTicket = (raw: unknown, fallbackCurrency: string): PublicTicketProps => {
  const t = (raw ?? {}) as Record<string, unknown>;
  const priceCents = typeof t.priceCents === "number" ? t.priceCents : null;
  const allInCents = typeof t.allInCents === "number" ? t.allInCents : null;
  const isFree = t.isFree === true;
  const remaining =
    typeof t.remaining === "number" ? t.remaining : null;
  const capacity =
    typeof t.capacity === "number" ? t.capacity : null;
  return {
    id: String(t.id ?? ""),
    name: String(t.name ?? ""),
    description: asString(t.description),
    priceGbp: isFree || priceCents === null ? null : priceCents / 100,
    // WYSIWYP — server all-in (compute_all_in_cents); 0/free → null.
    priceAllInGbp:
      isFree || allInCents === null || allInCents === 0 ? null : allInCents / 100,
    currency: asString(t.currency) ?? fallbackCurrency,
    isFree,
    isUnlimited: t.isUnlimited === true,
    // capacity field carries REMAINING (parity with the sold-out gate) when known.
    capacity: remaining ?? capacity,
    visibility:
      t.isHidden === true ? "hidden" : t.isDisabled === true ? "disabled" : "visible",
    passwordProtected: t.passwordProtected === true,
    password: null,
    saleStartAt: asString(t.saleStartAt),
    saleEndAt: asString(t.saleEndAt),
    approvalRequired: t.requiresApproval === true,
    waitlistEnabled: t.waitlistEnabled === true,
    availableAt:
      t.availableOnline === true && t.availableInPerson === true
        ? "both"
        : t.availableOnline === true
          ? "online"
          : "door",
    displayOrder: typeof t.displayOrder === "number" ? t.displayOrder : 0,
  };
};

/** Map the pg_public_event_by_slug json payload → the shared PublicEventProps. */
export const mapRpcPayloadToPublicEvent = (
  payload: Record<string, unknown>,
): CanonicalPublicEvent => {
  const currency = asString(payload.currency) ?? "USD";
  const brandRaw = (payload.brand ?? null) as Record<string, unknown> | null;
  const event: PublicEventProps = {
    id: String(payload.id ?? ""),
    name: String(payload.name ?? ""),
    brandId: String(payload.brandId ?? ""),
    brandSlug: String(payload.brandSlug ?? ""),
    eventSlug: String(payload.eventSlug ?? ""),
    description: typeof payload.description === "string" ? payload.description : "",
    // The cold-path body shows the meta chips; date label formatting is
    // host-driven elsewhere, so derive a minimal ISO-based eyebrow is omitted
    // here (the deck warm path supplies the formatted line). Empty → omitted.
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
    tickets: Array.isArray(payload.tickets)
      ? payload.tickets.map((t) => mapRpcTicket(t, currency))
      : [],
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
  return { event, brand };
};

export const usePublicEventBySlug = (
  brandSlug: string | null,
  eventSlug: string | null,
): UseQueryResult<CanonicalPublicEvent | null> => {
  const enabled = brandSlug !== null && eventSlug !== null;
  return useQuery<CanonicalPublicEvent | null>({
    queryKey: enabled
      ? publicEventBySlugKeys.bySlug(brandSlug, eventSlug)
      : publicEventBySlugKeys.all,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CanonicalPublicEvent | null> => {
      if (!enabled || brandSlug === null || eventSlug === null) return null;
      const { data, error } = await supabase.rpc("pg_public_event_by_slug", {
        p_brand_slug: brandSlug,
        p_event_slug: eventSlug,
      });
      if (error !== null) throw error;
      if (data === null || typeof data !== "object") return null;
      return mapRpcPayloadToPublicEvent(data as Record<string, unknown>);
    },
  });
};
