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
 * 🔒 I-MOR-0827-PACKAGE-ISOLATION: imports only @mingla/offering-rendering types +
 * the anon supabase client. No mingla-business/src import.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  forwardableAcquisitionState,
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type PublicBrandProps,
  type PublicEventProps,
  type PublicTicketProps,
  type OfferingGalleryImage,
  type EventTerminalSource,
} from "@mingla/offering-rendering";

import { supabase } from "../services/supabase";

export interface CanonicalPublicEvent {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  masterStartAt: string | null;
  masterEndAt: string | null;
  timezone: string;
  city: string | null;
  coverGallery: OfferingGalleryImage[];
  occurrences: readonly PublicEventOccurrenceLike[];
  isMultiDate: boolean;
  multiDatePricingMode: "per_day" | "all_days";
  terminalSource: EventTerminalSource;
}

export interface PublicEventOccurrenceLike {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isMaster: boolean;
}

export const publicEventBySlugKeys = {
  all: ["publicEventBySlug"] as const,
  bySlug: (brandSlug: string, eventSlug: string) =>
    [...publicEventBySlugKeys.all, brandSlug, eventSlug] as const,
};

export interface DirectEventColdReadPlan {
  canonical: CanonicalPublicEvent | null;
  allowLegacySeedRead: boolean;
  allowLegacyTicketRead: boolean;
}

/** Screen-level cold-read authority: a canonical standard event owns both the
 * body and tickets. Only SQL NULL may open the RSVP-only legacy seed rail. */
export const directEventColdReadPlan = (
  seedPresent: boolean,
  canonicalQuery: {
    isSuccess: boolean;
    data?: CanonicalPublicEvent | null;
  },
  hasExactSlugIdentity: boolean,
): DirectEventColdReadPlan => {
  const canonical = !seedPresent && canonicalQuery.data ? canonicalQuery.data : null;
  return {
    canonical,
    allowLegacySeedRead:
      !seedPresent &&
      canonicalQuery.isSuccess &&
      canonicalQuery.data === null &&
      hasExactSlugIdentity,
    allowLegacyTicketRead: canonical === null,
  };
};

export const acceptRsvpLegacySeed = <T extends { eventType?: string }>(
  candidate: T | null,
): T | null => (candidate?.eventType === "rsvp" ? candidate : null);

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

const isValidInstant = (value: string): boolean =>
  Number.isFinite(new Date(value).getTime());

const validTimezoneOr = (value: unknown, fallback: string): string => {
  const candidate = asString(value);
  if (candidate !== null) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: candidate }).format(0);
      return candidate;
    } catch {
      // Fall through to the bundle timezone; never carry an invalid zone.
    }
  }
  return fallback;
};

const mapOccurrences = (
  value: unknown,
  fallbackTimezone: string,
): PublicEventOccurrenceLike[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, PublicEventOccurrenceLike>();
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const row = candidate as Record<string, unknown>;
    const id = asString(row.id)?.trim() ?? null;
    const startAt = asString(row.startAt);
    const endAt = asString(row.endAt);
    if (
      id === null ||
      id.length === 0 ||
      startAt === null ||
      endAt === null ||
      !isValidInstant(startAt) ||
      !isValidInstant(endAt) ||
      byId.has(id)
    ) continue;
    byId.set(id, {
      id,
      startAt,
      endAt,
      timezone: validTimezoneOr(row.timezone, fallbackTimezone),
      isMaster: row.isMaster === true,
    });
  }
  return [...byId.values()].sort((a, b) => {
    const aTime = new Date(a.startAt).getTime();
    const bTime = new Date(b.startAt).getTime();
    if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return a.id.localeCompare(b.id);
    if (!Number.isFinite(aTime)) return 1;
    if (!Number.isFinite(bTime)) return -1;
    return aTime - bTime || a.id.localeCompare(b.id);
  });
};

export const isDirectEventBundlePayload = (
  value: unknown,
): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    asString(row.id) !== null &&
    asString(row.brandId) !== null &&
    asString(row.brandSlug) !== null &&
    asString(row.eventSlug) !== null &&
    asString(row.name) !== null &&
    (row.status === "scheduled" ||
      row.status === "live" ||
      row.status === "ended" ||
      row.status === "cancelled") &&
    Array.isArray(row.tickets) &&
    (row.brand === null ||
      (typeof row.brand === "object" && !Array.isArray(row.brand)))
  );
};

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
    // issue #2462 — carry the organiser's purchase rules onto the consumer
    // cart. Before this, `app-mobile` never populated them anywhere, so
    // `QuantityRow`'s clamp resolved to Infinity and the consumer iOS/Android
    // steppers offered quantities the server refuses with
    // `ticket_quantity_above_max`. Same defect as buyer web, different surface.
    // `null` is the real "no cap" answer and must survive the mapping.
    minPurchaseQty:
      typeof t.minPurchaseQty === "number" ? t.minPurchaseQty : 1,
    maxPurchaseQty:
      typeof t.maxPurchaseQty === "number" ? t.maxPurchaseQty : null,
    allowTransfers: t.allowTransfers !== false,
  };
};

/** Map the pg_public_event_by_slug json payload → the shared PublicEventProps. */
export const mapRpcPayloadToPublicEvent = (
  payload: Record<string, unknown>,
): CanonicalPublicEvent => {
  const currency = asString(payload.currency) ?? "USD";
  const timezone = validTimezoneOr(payload.timezone, "UTC");
  const brandRaw = (payload.brand ?? null) as Record<string, unknown> | null;
  const terminalSource: EventTerminalSource = {
    kind: "occurrences",
    value: payload.occurrences,
  };
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
    // Deliberately retained: EventOfferingBody reads dateLine/dateSubline, not
    // datesList. #2230 carries checkout occurrences separately below.
    datesList: [],
    status:
      payload.status === "cancelled"
        ? "cancelled"
        : payload.status === "ended"
          ? "ended"
          : "published",
    // issue #2562 [a past event was still purchasable] — derive the
    // past/cancelled state from the CLOCK, not just the operator's status.
    // The forwarding rule — and why a missing end time must NOT read as past
    // — lives beside the resolver it wraps, in the shared package.
    acquisitionState: forwardableAcquisitionState(
      // `payload.status` is `unknown` on this untyped RPC payload. Narrow it the
      // same way every other field here is narrowed rather than widening the
      // shared rule's parameter to `unknown` — the rule should keep saying that
      // it takes a status, and the coercion belongs at the boundary that has the
      // untyped data. `asString` also maps "" to null, which reads as scheduled.
      asString(payload.status),
      terminalSource,
    ),
    endedAt: null,
    format: asFormat(payload.format),
    venueName: asString(payload.venueName),
    address: asString(payload.address),
    hideAddressUntilTicket: payload.hideAddressUntilTicket === true,
    locationGeo: asLatLng(payload.locationGeo),
    cityGeo: asLatLng(payload.cityGeo),
    coverHue: 0,
    coverMediaUrl: asString(payload.coverMediaUrl),
    coverMediaAlt: asString(payload.coverMediaAlt),
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
          theme: {
            ...(isThemeColor(brandRaw.themeColor)
              ? { color: brandRaw.themeColor }
              : {}),
            ...(isThemeFontSlug(brandRaw.themeFont)
              ? { font: brandRaw.themeFont }
              : {}),
            ...(isThemeAnimationSlug(brandRaw.themeAnimation)
              ? { animation: brandRaw.themeAnimation }
              : {}),
          },
        };
  return {
    event,
    brand,
    masterStartAt: asString(payload.masterStartAt),
    masterEndAt: asString(payload.masterEndAt),
    timezone,
    city: asString(payload.city),
    coverGallery: Array.isArray(payload.coverGallery)
      ? (payload.coverGallery as OfferingGalleryImage[])
      : [],
    // ⚠️ DELETE THIS AND the Explorer app shows a two-day event as one day
    // again. The direct bundle is the sole guest-safe occurrence source.
    occurrences: mapOccurrences(payload.occurrences, timezone),
    isMultiDate: payload.isMultiDate === true,
    multiDatePricingMode:
      payload.multiDatePricingMode === "all_days" ? "all_days" : "per_day",
    terminalSource,
  };
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
      const { data, error } = await supabase.rpc("pg_direct_event_checkout_bundle", {
        p_event_id: null,
        p_brand_slug: brandSlug,
        p_event_slug: eventSlug,
      });
      if (error !== null) throw error;
      // PostgREST RPCs may be mocked or misconfigured to return a JSON array.
      // The bundle contract is exactly one object or SQL NULL; arrays and
      // primitive values fail closed instead of fabricating an empty event.
      if (data === null) return null;
      if (!isDirectEventBundlePayload(data)) {
        throw new Error("invalid_direct_event_checkout_bundle");
      }
      return mapRpcPayloadToPublicEvent(data);
    },
  });
};
