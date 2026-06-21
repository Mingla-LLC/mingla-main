/**
 * useConsumerExperienceOfferingData — ORCH-1183 [experience-standardize].
 *
 * The single per-surface adapter that maps the consumer experience read shape into
 * the shared `@mingla/offering-rendering` `ExperienceOfferingData` /
 * `ExperienceOfferingBrand` prop contract the shared `ExperienceOfferingBody` reads
 * — so the consumer screen renders the SAME body as web/business. Mirrors
 * useConsumerTripOfferingData.
 *
 * The consumer EXPERIENCE flow has TWO entry points, both fed here:
 *   • the DECK seed (BusinessEventCard via mergedDiscover/venueExperienceMapping) —
 *     the existing discover→experience open (KEPT working).
 *   • the BY-SLUG RPC payload (ConsumerExperienceDetail) — the new cold deep-link.
 *
 * I-MOR-0827: pure mapper, no app-src import into the package — the package only
 * sees the normalized shape. NEVER renders a per-stop price (ORCH-1151 — one
 * combined all-in only).
 */

import {
  isOpenDailyExperience,
  normalizeCityCountry,
  type ExperienceOfferingBrand,
  type ExperienceOfferingData,
} from "@mingla/offering-rendering";

import type { BusinessEventCard } from "../types/mergedDiscover";
import type {
  ConsumerExperienceDetail,
  ConsumerExperienceOccurrence,
} from "./useConsumerExperienceDetail";
import { isVideoUrl } from "../utils/videoUrl";

// "5 dates · Next: Fri 20 Jun" / "Fri 20 Jun" / null (rule 9).
function buildDatesLabel(
  occ: ReadonlyArray<{ startAt: string }>,
  timezone: string,
): string | null {
  if (occ.length === 0) return null;
  const next = occ[0];
  let nextLabel = "";
  const d = new Date(next.startAt);
  if (!Number.isNaN(d.getTime())) {
    try {
      nextLabel = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: timezone || "UTC",
      }).format(d);
    } catch {
      nextLabel = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(d);
    }
  }
  if (nextLabel.length === 0) return null;
  return occ.length > 1 ? `${occ.length} dates · Next: ${nextLabel}` : nextLabel;
}

// "3 spots left · 12 max" / "12 max" / null — from the soonest occurrence (rule 9).
function buildSeatsLabel(
  occ: ReadonlyArray<{ remaining: number | null; capacity?: number | null }>,
): string | null {
  const first = occ[0];
  if (first === undefined) return null;
  const remaining = first.remaining;
  const capacity = first.capacity ?? null;
  if (remaining === null && capacity === null) return null;
  if (remaining !== null && capacity !== null) {
    return `${Math.max(remaining, 0)} spots left · ${capacity} max`;
  }
  if (remaining !== null) return `${Math.max(remaining, 0)} spots left`;
  if (capacity !== null) return `${capacity} max`;
  return null;
}

function buildStartTimeLabel(
  occ: ReadonlyArray<{ startAt: string }>,
  timezone: string,
): string | null {
  const first = occ[0];
  if (first === undefined) return null;
  const d = new Date(first.startAt);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return `${new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || "UTC",
    }).format(d)} start`;
  } catch {
    return null;
  }
}

// ===========================================================================
// BY-SLUG (cold deep-link) path — from the ConsumerExperienceDetail RPC payload.
// ===========================================================================

export function buildExperienceOfferingDataFromDetail(
  detail: ConsumerExperienceDetail,
): ExperienceOfferingData {
  const occ = detail.occurrences;
  const t = detail.ticket;
  return {
    id: detail.experienceId,
    title: detail.title,
    description: detail.description,
    currency: detail.currency,
    timezone: detail.timezone,
    coverMediaUrl: detail.coverMediaUrl,
    coverMediaType: detail.coverMediaType,
    cityCountry: normalizeCityCountry(detail.venueText),
    datesLabel: buildDatesLabel(occ, detail.timezone),
    seatsLabel: buildSeatsLabel(occ),
    startTimeLabel: buildStartTimeLabel(occ, detail.timezone),
    intents: detail.intents,
    stops: detail.stops.map((s) => ({
      id: s.id,
      stopOrder: s.stopOrder,
      placeName: s.placeName,
      address: s.address,
      description: s.description,
      startTime: s.startTime,
      lat: s.lat,
      lng: s.lng,
      media: s.imageUrls.map((url) => ({
        url,
        type: isVideoUrl(url) ? ("video" as const) : ("image" as const),
      })),
    })),
    ticket:
      t !== null
        ? {
            ticketTypeId: t.ticketTypeId,
            name: t.name,
            priceCents: t.priceCents,
            priceAllInCents: t.priceAllInCents,
            currency: t.currency,
            isFree: t.isFree,
            isUnlimited: t.isUnlimited,
            ticketsRemaining: t.ticketsRemaining,
            quantityTotal: t.quantityTotal,
          }
        : null,
    occurrences: occ.map((o) => ({
      eventDateId: o.eventDateId,
      startAt: o.startAt,
      endAt: o.endAt,
      remaining: o.remaining,
      capacity: null,
    })),
    openDaily: isOpenDailyExperience({
      isRecurring: detail.isRecurring,
      recurrenceRule: detail.recurrenceRule,
    }),
    bookable: detail.bookable !== false,
  };
}

export function buildExperienceOfferingBrandFromDetail(
  detail: ConsumerExperienceDetail,
): ExperienceOfferingBrand {
  return {
    id: detail.brandId,
    slug: detail.brandSlug,
    name: detail.brandName,
    bio: null,
    coverMediaUrl: detail.brandCoverMediaUrl,
    coverMediaType: detail.brandCoverMediaType,
    coverHue: detail.brandCoverHue,
    verified: detail.brandVerified,
  };
}

// ===========================================================================
// DECK SEED path — from the BusinessEventCard the discover/venue mappers produce.
// (The existing discover→experience open — kept working.)
// ===========================================================================

export interface SeedExperienceExtras {
  /** Tickets resolved by usePublicEventTickets (server all-in via priceAllInCents). */
  ticket: ExperienceOfferingData["ticket"];
  /** The bookable upcoming occurrences (BusinessEventCard.upcomingOccurrences). */
  occurrences: ExperienceOfferingData["occurrences"];
  /** Resolved bookable (resolveOfferingCta upstream owns the actual CTA gate). */
  bookable: boolean;
}

export function buildExperienceOfferingDataFromSeed(
  seed: BusinessEventCard,
  extras: SeedExperienceExtras,
): ExperienceOfferingData {
  const stops = Array.isArray(seed.experienceStops) ? seed.experienceStops : [];
  const occ: Array<ConsumerExperienceOccurrence & { capacity: number | null }> =
    (extras.occurrences ?? []).map((o) => ({
      eventDateId: o.eventDateId,
      startAt: o.startAt,
      endAt: o.endAt,
      timezone: seed.timezone,
      remaining: o.remaining,
      capacity: o.capacity,
    }));
  const cityCountry =
    normalizeCityCountry(seed.city) ??
    normalizeCityCountry(seed.venueName) ??
    normalizeCityCountry(seed.address);

  return {
    id: seed.eventId,
    title: seed.title,
    description:
      seed.description !== null && seed.description.trim().length > 0
        ? seed.description
        : null,
    currency: seed.currency,
    timezone: seed.timezone,
    coverMediaUrl: seed.coverMediaUrl,
    coverMediaType:
      seed.coverMediaType === "image" ||
      seed.coverMediaType === "video" ||
      seed.coverMediaType === "gif"
        ? seed.coverMediaType
        : null,
    cityCountry,
    datesLabel: buildDatesLabel(occ, seed.timezone),
    seatsLabel: buildSeatsLabel(occ),
    startTimeLabel: buildStartTimeLabel(occ, seed.timezone),
    intents: Array.isArray(seed.experienceIntents) ? seed.experienceIntents : [],
    stops: stops.map((s, idx) => ({
      id: `${s.placeName ?? "stop"}-${idx}`,
      stopOrder: s.stopNumber > 0 ? s.stopNumber - 1 : idx,
      placeName: s.placeName,
      address: s.address,
      description: s.aiDescription,
      startTime: s.startTime,
      lat: s.lat,
      lng: s.lng,
      media: (Array.isArray(s.imageUrls) && s.imageUrls.length > 0
        ? s.imageUrls
        : s.imageUrl !== null
          ? [s.imageUrl]
          : []
      )
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .map((url) => ({
          url,
          type: isVideoUrl(url) ? ("video" as const) : ("image" as const),
        })),
    })),
    ticket: extras.ticket,
    occurrences: occ.map((o) => ({
      eventDateId: o.eventDateId,
      startAt: o.startAt,
      endAt: o.endAt,
      remaining: o.remaining,
      capacity: o.capacity,
    })),
    openDaily: isOpenDailyExperience({
      isRecurring: seed.isRecurring === true,
      recurrenceRule: seed.recurrenceRule ?? null,
    }),
    bookable: extras.bookable,
  };
}

export function buildExperienceOfferingBrandFromSeed(
  seed: BusinessEventCard,
): ExperienceOfferingBrand {
  return {
    id: seed.brandId,
    slug: seed.brandSlug,
    name: seed.brandName,
    bio: null,
    coverMediaUrl: seed.brandProfilePhotoUrl,
    coverMediaType: seed.brandProfilePhotoUrl !== null ? "image" : null,
    coverHue: null,
    verified: false,
  };
}
