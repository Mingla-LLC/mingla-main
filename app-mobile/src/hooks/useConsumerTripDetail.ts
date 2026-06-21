/**
 * useConsumerTripDetail — composes a consumer trip-detail view from the ONE
 * canonical anon RPC.
 *
 * META-ORCH-1174 Leg A.2 (Seth single-source decision) — this hook now reads the
 * SAME `pg_public_trip_by_slug(p_brand_slug, p_event_slug)` RPC the business/web
 * trip page reads (SECURITY DEFINER, GRANT anon), replacing the prior per-surface
 * fan-out (a DiscoverTripRow seed/re-fetch to resolve tripId + 5 anon-direct
 * table reads). The RPC returns the FULL payload — crucially the destination
 * lat/lng (so the §11 "Where you'll be" map now renders on consumer, closing the
 * gap this hook previously documented) and per-tier remaining capacity (also
 * previously missing on consumer). The `seed` arg is retained for source-compat
 * but is now unused for the read (the RPC resolves directly by slug, hot OR cold
 * deep-link). NEVER `.from('brands')` / `.from('tickets')` — the definer RPC is
 * the anon-safe path (COMMS-0009 / I-ANON-BRANDS-VIA-DEFINER-VIEW).
 */

import { useQuery } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import type { DiscoverTripRow } from "../services/tripsDiscoveryService";

/**
 * ORCH-1119 — one item in a trip DAY's optional media gallery. Explicit `type`
 * (the renderer NEVER auto-detects — ORCH-1069/0978). Sourced from the
 * anon-readable `trip_days.media` jsonb column.
 */
export interface TripDayMedia {
  url: string;
  type: "image" | "video";
  provider?: string;
  width?: number;
  height?: number;
}

/** ORCH-1119 — defensively coerce raw jsonb to a clean TripDayMedia[]; drops any
 *  item missing a string url or a valid "image"|"video" type. */
export function coerceTripDayMedia(raw: unknown): TripDayMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: TripDayMedia[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url = o.url;
    const type = o.type;
    if (typeof url !== "string" || url.length === 0) continue;
    if (type !== "image" && type !== "video") continue;
    const next: TripDayMedia = { url, type };
    if (typeof o.provider === "string") next.provider = o.provider;
    if (typeof o.width === "number") next.width = o.width;
    if (typeof o.height === "number") next.height = o.height;
    out.push(next);
  }
  return out;
}

export interface TripDetailDay {
  id: string;
  ordinal: number;
  title: string;
  narrative: string | null;
  // ORCH-1119 — optional per-day media gallery (default []).
  media: TripDayMedia[];
}
export interface TripDetailInclusion {
  id: string;
  kind: "included" | "excluded";
  item: string;
  ordinal: number;
}
/**
 * ORCH-1130 — the installment-plan template stored under
 * `trip_pricing_tiers.tier_metadata.installments`. Same shape the
 * mingla-business `TripInstallmentScheduleData` carries; mirrored locally so
 * app-mobile has no cross-app import. Null when the tier has no plan.
 */
export interface TripInstallmentScheduleData {
  deposit_pct: number;
  installments: {
    ordinal: number;
    pct: number;
    days_after_booking?: number;
    fixed_date?: string;
  }[];
}

export interface TripDetailTier {
  ticketTypeId: string;
  tierName: string;
  priceCents: number;
  currency: string;
  isFree: boolean;
  isUnlimited: boolean;
  quantityTotal: number | null;
  /**
   * META-ORCH-1174 Leg A.2 — per-tier remaining capacity from the canonical RPC
   * (GREATEST(quantity_total - sold, 0)); null when unlimited/uncapped (never a
   * fabricated "0 left" — rule 9). Previously MISSING on consumer (the read had
   * only an aggregate spotsLeft) → the shared body now gets real per-tier
   * remaining, parity with web/business.
   */
  ticketsRemaining: number | null;
  /**
   * ORCH-1130 — extracted from `tier_metadata.installments` (anon-readable).
   * Null on missing/malformed metadata (same shape-guard the business
   * `extractInstallmentSchedule` uses). Drives the consumer "HOW YOU PAY"
   * module + the explicit `payment_plan_choice` consent fix (DISC-1130-A).
   */
  installmentSchedule: TripInstallmentScheduleData | null;
}

/**
 * ORCH-1130 — defensively extract the installment template from the
 * anon-readable `trip_pricing_tiers.tier_metadata` jsonb. Mirrors the business
 * `extractInstallmentSchedule`: returns null on null/missing/malformed input so
 * a plan never crashes the screen and a no-plan trip stays byte-identical.
 */
export function extractTripInstallmentSchedule(
  metadata: unknown,
): TripInstallmentScheduleData | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const raw = (metadata as { installments?: unknown }).installments;
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const depositPct = obj.deposit_pct;
  const installments = obj.installments;
  if (typeof depositPct !== "number" || !Array.isArray(installments)) {
    return null;
  }
  const clean = installments
    .map((inst, i) => {
      if (typeof inst !== "object" || inst === null) return null;
      const r = inst as Record<string, unknown>;
      const ordinal = typeof r.ordinal === "number" ? r.ordinal : i + 1;
      const pct = typeof r.pct === "number" ? r.pct : 0;
      const days =
        typeof r.days_after_booking === "number"
          ? r.days_after_booking
          : undefined;
      const fixed = typeof r.fixed_date === "string" ? r.fixed_date : undefined;
      if (days === undefined && fixed === undefined) return null;
      return {
        ordinal,
        pct,
        ...(days !== undefined ? { days_after_booking: days } : {}),
        ...(fixed !== undefined ? { fixed_date: fixed } : {}),
      };
    })
    .filter(
      (x): x is TripInstallmentScheduleData["installments"][number] =>
        x !== null,
    );
  if (clean.length === 0) return null;
  return { deposit_pct: depositPct, installments: clean };
}
export interface RefundPolicyTier {
  days_before_start: number;
  refund_pct: number;
}
export interface RefundPolicyShape {
  kind: "flexible" | "standard" | "strict" | "custom";
  tiers: RefundPolicyTier[];
}

export interface ConsumerTripDetail {
  tripId: string;
  tripSlug: string;
  brandSlug: string;
  brandName: string;
  brandVerified: boolean;
  title: string;
  description: string | null;
  destinationText: string | null;
  departureText: string | null;
  /**
   * META-ORCH-1174 Leg A.2 — destination lat/lng from the canonical RPC. These
   * were MISSING on consumer (the prior read carried no coords) → the §11 "Where
   * you'll be" map was silently omitted. The shared body now renders the map on
   * EVERY surface (rule 9 — both must be finite; null when the brand set none).
   */
  destinationLat: number | null;
  destinationLng: number | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  /**
   * ORCH-1138 [trip-page-redesign] FIX-3 (device rework) — the BRAND's cover
   * media for the "Presented by" chip, sourced anon-safe from the
   * security-definer `business_public_brands_view` (🔒 COMMS-0009 /
   * I-ANON-BRANDS-VIA-DEFINER-VIEW — NEVER `.from("brands")`). null when the
   * brand set no cover → the chip renders the clean themed hue/initial fallback
   * (rule 9 — never a fabricated cover, never a bare red disk).
   */
  brandCoverMediaUrl: string | null;
  brandCoverMediaType: "image" | "video" | "gif" | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  bookingsClosed: boolean;
  bookingDeadline: string | null;
  totalCapacity: number | null;
  spotsLeft: number | null;
  minPriceCents: number | null;
  currency: string | null;
  hasFreeTier: boolean;
  /**
   * ORCH-1117 / ORCH-1076 — when false this is a PAID trip whose brand can't
   * charge yet; the floating Reserve bar renders a NON-tappable "Booking
   * unavailable" info strip. Free trips (and resolver errors) are true
   * (fail-open; the checkout 409 / cart-toast remains the backstop).
   */
  bookable: boolean;
  refundPolicy: RefundPolicyShape | null;
  days: TripDetailDay[];
  inclusions: TripDetailInclusion[];
  tiers: TripDetailTier[];
  /** ORCH-1130 — true when any tier has a non-null installment schedule. */
  hasPlan: boolean;
}

// ORCH-1117 (OQ-C) — the native trip-detail hook gains the SAME pg_brand_can_charge
// gate the web trip/event/experience resolvers have. PAID ⇒ gated; FREE ⇒ true;
// RPC error ⇒ true (fail-open). Uses ev.brand_id from the anon-direct events read
// (NOT the discover-cards supply — that stays out of scope per OQ-B).
async function resolveTripBookable(
  brandId: string | null,
  isPaid: boolean,
): Promise<boolean> {
  if (!isPaid || brandId === null) return true;
  const { data, error } = await supabase.rpc("pg_brand_can_charge", {
    p_brand_id: brandId,
  });
  if (error !== null) return true;
  return data === true;
}

export const consumerTripDetailKeys = {
  all: ["consumerTripDetail"] as const,
  detail: (brandSlug: string, tripSlug: string) =>
    [...consumerTripDetailKeys.all, brandSlug, tripSlug] as const,
};

function coerceCoverType(raw: string | null): "image" | "video" | "gif" | null {
  return raw === "image" || raw === "video" || raw === "gif" ? raw : null;
}

/**
 * ORCH-1138 FIX-3 — coerce the raw brand cover media type (from
 * business_public_brands_view) to the EventCoverMedia union. Unknown/null → null
 * (the chip falls back to the themed hue/initial; rule 9 — no fabricated type).
 * Mirrors the business usePublicTripBySlug `coerceBrandCoverType`.
 */
function coerceBrandCoverType(raw: unknown): "image" | "video" | "gif" | null {
  return raw === "image" || raw === "video" || raw === "gif" ? raw : null;
}

function coerceRefundPolicy(raw: unknown): RefundPolicyShape | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as { kind?: unknown; tiers?: unknown };
  if (!Array.isArray(obj.tiers)) return null;
  const tiers: RefundPolicyTier[] = obj.tiers
    .filter(
      (t): t is { days_before_start: number; refund_pct: number } =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as { days_before_start?: unknown }).days_before_start === "number" &&
        typeof (t as { refund_pct?: unknown }).refund_pct === "number",
    )
    .map((t) => ({ days_before_start: t.days_before_start, refund_pct: t.refund_pct }));
  const kind =
    obj.kind === "flexible" || obj.kind === "standard" || obj.kind === "strict" || obj.kind === "custom"
      ? obj.kind
      : "custom";
  return { kind, tiers };
}

// META-ORCH-1174 Leg A.2 — the raw JSON shape returned by pg_public_trip_by_slug
// (mirrors the migration's json_build_object keys). Read defensively; the mapper
// narrows into the typed ConsumerTripDetail.
interface RpcTripBrand {
  id: string;
  slug: string;
  name: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  verified: boolean;
}
interface RpcTripDay {
  id: string;
  ordinal: number;
  title: string;
  narrative: string | null;
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
  timezone: string | null;
  startAt: string | null;
  endAt: string | null;
  departureText: string | null;
  destinationText: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  currency: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  refundPolicy: unknown;
  bookingDeadline: string | null;
  bookingsClosed: boolean;
  brand: RpcTripBrand;
  days: RpcTripDay[];
  inclusions: RpcTripInclusion[];
  tiers: RpcTripTier[];
}

const numOrNull = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : null;

async function fetchTripDetail(
  brandSlug: string,
  tripSlug: string,
): Promise<ConsumerTripDetail> {
  // META-ORCH-1174 Leg A.2 — the ONE canonical anon read. The SECURITY DEFINER
  // RPC resolves by (brand_slug, trip_slug) directly (hot OR cold deep-link, no
  // feed re-fetch) and returns the full payload incl. destination lat/lng + per-
  // tier remaining (both previously missing on consumer). NEVER `.from('brands')`.
  const { data, error } = await supabase.rpc("pg_public_trip_by_slug", {
    p_brand_slug: brandSlug,
    p_event_slug: tripSlug,
  });
  if (error !== null) throw error;
  if (data === null || data === undefined) {
    throw new Error("Trip not found or no longer available.");
  }
  const p = data as RpcTripPayload;

  const days: TripDetailDay[] = (p.days ?? []).map((d) => ({
    id: String(d.id),
    ordinal: d.ordinal,
    title: d.title,
    narrative: d.narrative ?? null,
    media: coerceTripDayMedia(d.media),
  }));

  const inclusions: TripDetailInclusion[] = (p.inclusions ?? []).map((i) => ({
    id: String(i.id),
    kind: i.kind,
    item: i.item,
    ordinal: i.ordinal,
  }));

  const tiers: TripDetailTier[] = (p.tiers ?? []).map((t) => ({
    ticketTypeId: t.ticketTypeId,
    tierName: t.tierName,
    priceCents: t.priceCents ?? 0,
    currency: t.currency ?? "",
    isFree: t.isFree === true,
    isUnlimited: t.isUnlimited === true,
    quantityTotal: t.quantityTotal ?? null,
    // META-ORCH-1174 — real per-tier remaining (null when unlimited; no
    // fabricated sold-out — rule 9). Previously always null on consumer.
    ticketsRemaining: t.isUnlimited ? null : (t.ticketsRemaining ?? null),
    // ORCH-1179 — extractTripInstallmentSchedule expects the FULL tier_metadata
    // (its first line unwraps `.installments`). The RPC ALSO emits `t.installments`
    // ALREADY unwrapped (tier_metadata -> 'installments'), so passing that here
    // double-unwrapped → null for every plan tier → the §10 pay-over-time toggle,
    // reserve split CTAs, and cart deposit-lead all silently vanished on consumer.
    // Read `t.tierMetadata` (the full metadata the extractor was written for) to
    // restore parity with the business twin (which reads t.installments via a
    // DIRECT reader). I-1179: consumer installment parity.
    installmentSchedule: extractTripInstallmentSchedule(t.tierMetadata),
  }));

  // Aggregate availability derived from the per-tier rows (the prior consumer
  // read sourced these off the feed seed; now single-source off the RPC tiers).
  const minPriceCents =
    tiers.length > 0
      ? Math.min(...tiers.map((t) => t.priceCents))
      : null;
  const hasFreeTier = tiers.some((t) => t.isFree);
  // total capacity = sum of capped tiers (null when every tier is unlimited).
  const cappedQtys = tiers
    .map((t) => (t.isUnlimited ? null : t.quantityTotal))
    .filter((q): q is number => typeof q === "number");
  const totalCapacity = cappedQtys.length > 0 ? cappedQtys.reduce((a, b) => a + b, 0) : null;
  // spotsLeft = sum of per-tier remaining (null when no capped/known remaining).
  const knownRemaining = tiers
    .map((t) => (t.isUnlimited ? null : t.ticketsRemaining))
    .filter((r): r is number => typeof r === "number");
  const spotsLeft =
    knownRemaining.length > 0 ? knownRemaining.reduce((a, b) => a + b, 0) : null;

  // ORCH-1130 — derived cheap gating flag for the consumer payment module.
  const hasPlan = tiers.some((t) => t.installmentSchedule !== null);

  // ORCH-1117 — a trip is PAID when its cheapest tier costs > 0. Resolve the
  // brand's charge-readiness for the floating Reserve bar's unavailable state.
  const isPaid = (minPriceCents ?? 0) > 0;
  const bookable = await resolveTripBookable(p.brandId, isPaid);

  return {
    tripId: p.id,
    tripSlug: p.tripSlug,
    brandSlug: p.brand.slug,
    brandName: p.brand.name,
    brandVerified: p.brand.verified === true,
    title: p.title,
    description: p.description,
    destinationText: p.destinationText,
    departureText: p.departureText,
    // META-ORCH-1174 — destination coords (the consumer §11 map gap this leg closes).
    destinationLat: numOrNull(p.destinationLat),
    destinationLng: numOrNull(p.destinationLng),
    coverMediaUrl: p.coverMediaUrl,
    coverMediaType: coerceCoverType(p.coverMediaType),
    // META-ORCH-1174 — the "Presented by" brand cover now rides the same RPC
    // payload (anon-safe via the definer owner — NEVER `.from('brands')`).
    brandCoverMediaUrl: p.brand.coverMediaUrl,
    brandCoverMediaType: coerceBrandCoverType(p.brand.coverMediaType),
    startAt: p.startAt,
    endAt: p.endAt,
    timezone: p.timezone,
    bookingsClosed: p.bookingsClosed === true,
    bookingDeadline: p.bookingDeadline,
    totalCapacity,
    spotsLeft,
    minPriceCents,
    currency: p.currency,
    hasFreeTier,
    bookable,
    refundPolicy: coerceRefundPolicy(p.refundPolicy),
    days,
    inclusions,
    tiers,
    hasPlan,
  };
}


export interface UseConsumerTripDetailResult {
  detail: ConsumerTripDetail | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useConsumerTripDetail(
  brandSlug: string | null,
  tripSlug: string | null,
  // META-ORCH-1174 Leg A.2 — `seed` is retained for caller source-compat (the
  // screen still passes a DiscoverTripRow for the card→detail hop) but is no
  // longer read: the canonical RPC resolves the full detail directly by slug, so
  // the seed-based instant-paint/re-fetch path is retired.
  seed: DiscoverTripRow | null,
): UseConsumerTripDetailResult {
  void seed;
  const enabled = brandSlug !== null && tripSlug !== null;
  const query = useQuery<ConsumerTripDetail, Error>({
    queryKey: enabled
      ? consumerTripDetailKeys.detail(brandSlug as string, tripSlug as string)
      : consumerTripDetailKeys.all,
    queryFn: () => fetchTripDetail(brandSlug as string, tripSlug as string),
    enabled,
    staleTime: 30_000,
  });
  return {
    detail: query.data ?? null,
    isLoading: query.isLoading && enabled,
    isError: query.isError,
    error: query.error ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
