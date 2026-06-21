/**
 * useConsumerExperienceDetail — ORCH-1183 [experience-standardize].
 *
 * The consumer by-slug experience read. Reads the SAME canonical anon RPC the
 * business/web experience page reads — `pg_public_experience_by_slug(p_brand_slug,
 * p_experience_slug)` (SECURITY DEFINER, GRANT anon) — so a cold deep-link
 * /exp/{brandSlug}/{experienceSlug} resolves the FULL detail directly by slug (no
 * deck seed required). Mirrors useConsumerTripDetail's RPC read.
 *
 * The consumer EXPERIENCE flow has TWO entry points (both kept working):
 *   • the DECK seed path (BusinessEventCard via mergedDiscover/venueExperienceMapping)
 *     — the existing discover→experience open; the screen maps the seed.
 *   • this BY-SLUG path — the new cold deep-link route.
 * Both feed the SAME shared <ExperienceOfferingBody> via the per-surface adapter.
 *
 * NEVER `.from('brands')` / `.from('tickets')` — the definer RPC is the anon-safe
 * path (COMMS-0009 / I-ANON-BRANDS-VIA-DEFINER-VIEW).
 */

import { useQuery } from "@tanstack/react-query";

import { supabase } from "../services/supabase";

export type ConsumerExperienceWhenMode = "single" | "recurring" | "multi_date";

export interface ConsumerExperienceStop {
  id: string;
  stopOrder: number;
  placeName: string | null;
  /** Address-privacy-aware (RPC NULLs it when the brand hides the street). */
  address: string | null;
  description: string | null;
  startTime: string | null;
  lat: number | null;
  lng: number | null;
  imageUrls: string[];
}

export interface ConsumerExperienceTicket {
  ticketTypeId: string;
  name: string;
  priceCents: number;
  /** Server fee-grossed all-in (CENTS); null = free / RPC miss → base fallback. */
  priceAllInCents: number | null;
  currency: string;
  quantityTotal: number | null;
  isUnlimited: boolean;
  isFree: boolean;
  ticketsRemaining: number | null;
}

export interface ConsumerExperienceOccurrence {
  eventDateId: string;
  startAt: string;
  endAt: string;
  timezone: string;
  remaining: number | null;
}

export interface ConsumerExperienceDetail {
  experienceId: string;
  experienceSlug: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  brandVerified: boolean;
  brandCoverMediaUrl: string | null;
  brandCoverMediaType: "image" | "video" | "gif" | null;
  brandCoverHue: number | null;
  title: string;
  description: string | null;
  timezone: string;
  currency: string;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  venueText: string | null;
  whenMode: ConsumerExperienceWhenMode;
  /** {preset, termination.kind} — the shared isOpenDailyExperience detector reads it. */
  isRecurring: boolean;
  recurrenceRule: {
    preset?: string;
    termination?: { kind?: string; count?: number; until?: string };
  } | null;
  intents: string[];
  stops: ConsumerExperienceStop[];
  ticket: ConsumerExperienceTicket | null;
  occurrences: ConsumerExperienceOccurrence[];
  /** false → PAID experience whose brand can't charge → CTA disabled. */
  bookable: boolean;
  // anon-safe brand theme (for the synchronous palette).
  brandTheme: {
    color: string | null;
    font: string | null;
    animation: string | null;
    colorOverride: string | null;
    fontOverride: string | null;
    animationOverride: string | null;
  } | null;
}

interface RpcStop {
  id: string;
  stopOrder: number;
  placeName: string | null;
  address: string | null;
  description: string | null;
  startTime: string | null;
  lat: number | null;
  lng: number | null;
  imageUrls: unknown;
}
interface RpcTicket {
  ticketTypeId: string;
  name: string;
  priceCents: number;
  allInCents: number | null;
  currency: string;
  quantityTotal: number | null;
  isUnlimited: boolean;
  isFree: boolean;
  ticketsRemaining: number | null;
}
interface RpcDate {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  ticketsRemaining: number | null;
}
interface RpcBrand {
  id: string;
  slug: string;
  name: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  coverHue: number | null;
  verified: boolean;
  themeColor: string | null;
  themeFont: string | null;
  themeAnimation: string | null;
}
interface RpcPayload {
  id: string;
  brandId: string;
  brandSlug: string;
  experienceSlug: string;
  title: string;
  description: string | null;
  timezone: string;
  currency: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  venueText: string | null;
  isRecurring: boolean;
  isMultiDate: boolean;
  recurrenceRules: unknown;
  intents: unknown;
  themeColorOverride: string | null;
  themeFontOverride: string | null;
  themeAnimationOverride: string | null;
  brand: RpcBrand;
  stops: RpcStop[];
  ticket: RpcTicket | null;
  dates: RpcDate[];
  bookable: boolean;
}

function coverType(raw: string | null): "image" | "video" | "gif" | null {
  return raw === "image" || raw === "video" || raw === "gif" ? raw : null;
}
function strOrNull(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}
function readIntents(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : [];
}
function firstRecurrenceRule(raw: unknown): ConsumerExperienceDetail["recurrenceRule"] {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object") {
    return raw[0] as ConsumerExperienceDetail["recurrenceRule"];
  }
  if (raw !== null && typeof raw === "object" && "preset" in (raw as object)) {
    return raw as ConsumerExperienceDetail["recurrenceRule"];
  }
  return null;
}

function mapPayload(p: RpcPayload): ConsumerExperienceDetail {
  const t = p.ticket;
  return {
    experienceId: p.id,
    experienceSlug: p.experienceSlug,
    brandId: p.brandId,
    brandSlug: p.brand.slug,
    brandName: p.brand.name,
    brandVerified: p.brand.verified === true,
    brandCoverMediaUrl: p.brand.coverMediaUrl ?? null,
    brandCoverMediaType: coverType(p.brand.coverMediaType),
    brandCoverHue: typeof p.brand.coverHue === "number" ? p.brand.coverHue : null,
    title: p.title,
    description: p.description ?? null,
    timezone: p.timezone ?? "UTC",
    currency: p.currency ?? "USD",
    coverMediaUrl: p.coverMediaUrl ?? null,
    coverMediaType: coverType(p.coverMediaType),
    venueText: p.venueText ?? null,
    whenMode: p.isRecurring ? "recurring" : p.isMultiDate ? "multi_date" : "single",
    isRecurring: p.isRecurring === true,
    recurrenceRule: firstRecurrenceRule(p.recurrenceRules),
    intents: readIntents(p.intents),
    stops: (p.stops ?? []).map((s) => ({
      id: s.id,
      stopOrder: s.stopOrder,
      placeName: s.placeName ?? null,
      address: s.address ?? null,
      description: strOrNull(s.description),
      startTime: s.startTime ?? null,
      lat: typeof s.lat === "number" ? s.lat : null,
      lng: typeof s.lng === "number" ? s.lng : null,
      imageUrls: Array.isArray(s.imageUrls)
        ? s.imageUrls.filter((u): u is string => typeof u === "string")
        : [],
    })),
    ticket:
      t !== null
        ? {
            ticketTypeId: t.ticketTypeId,
            name: t.name,
            priceCents: t.priceCents ?? 0,
            priceAllInCents:
              t.isFree === true || (t.priceCents ?? 0) === 0
                ? null
                : typeof t.allInCents === "number" && t.allInCents > 0
                  ? t.allInCents
                  : null,
            currency: t.currency ?? p.currency ?? "USD",
            quantityTotal: t.quantityTotal ?? null,
            isUnlimited: t.isUnlimited === true,
            isFree: t.isFree === true || (t.priceCents ?? 0) === 0,
            ticketsRemaining: t.ticketsRemaining ?? null,
          }
        : null,
    occurrences: (p.dates ?? []).map((d) => ({
      eventDateId: d.id,
      startAt: d.startAt,
      endAt: d.endAt,
      timezone: d.timezone ?? p.timezone ?? "UTC",
      remaining: d.ticketsRemaining ?? null,
    })),
    bookable: p.bookable !== false,
    brandTheme: {
      color: p.brand.themeColor ?? null,
      font: p.brand.themeFont ?? null,
      animation: p.brand.themeAnimation ?? null,
      colorOverride: p.themeColorOverride ?? null,
      fontOverride: p.themeFontOverride ?? null,
      animationOverride: p.themeAnimationOverride ?? null,
    },
  };
}

export const consumerExperienceDetailKeys = {
  all: ["consumerExperienceDetail"] as const,
  detail: (brandSlug: string, experienceSlug: string) =>
    [...consumerExperienceDetailKeys.all, brandSlug, experienceSlug] as const,
};

async function fetchExperienceDetail(
  brandSlug: string,
  experienceSlug: string,
): Promise<ConsumerExperienceDetail> {
  const { data, error } = await supabase.rpc("pg_public_experience_by_slug", {
    p_brand_slug: brandSlug,
    p_experience_slug: experienceSlug,
  });
  if (error !== null) throw error;
  if (data === null || data === undefined) {
    throw new Error("Experience not found or no longer available.");
  }
  return mapPayload(data as RpcPayload);
}

export interface UseConsumerExperienceDetailResult {
  detail: ConsumerExperienceDetail | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useConsumerExperienceDetail(
  brandSlug: string | null,
  experienceSlug: string | null,
): UseConsumerExperienceDetailResult {
  const enabled = brandSlug !== null && experienceSlug !== null;
  const query = useQuery<ConsumerExperienceDetail, Error>({
    queryKey: enabled
      ? consumerExperienceDetailKeys.detail(
          brandSlug as string,
          experienceSlug as string,
        )
      : consumerExperienceDetailKeys.all,
    queryFn: () =>
      fetchExperienceDetail(brandSlug as string, experienceSlug as string),
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
