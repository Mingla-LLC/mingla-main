/**
 * experienceOfferingAdapter — ORCH-1183 [experience-standardize].
 *
 * Maps the business `PublicExperience` (+ `PublicExperienceBrand`) into the shared
 * `@mingla/offering-rendering` `ExperienceOfferingData` / `ExperienceOfferingBrand`
 * prop contract the shared `ExperienceOfferingBody` reads. Mirrors
 * `tripOfferingAdapter.ts` — the single place the business read shape
 * (getPublicExperienceBySlug → pg_public_experience_by_slug) becomes the normalized
 * body contract. The body is read-path-agnostic.
 *
 * Experiences carry ONE combined all-in price (ORCH-1151 sums stops server-side →
 * NO per-stop prices). priceAllInGbp is in MAJOR units (publicExperienceService:
 * allInCents / 100) → ×100 back to cents for the shared `priceAllInCents` so the
 * WYSIWYP all-in displays (orch-1153-no-bare-base).
 */

import {
  normalizeCityCountry,
  type ExperienceOfferingBrand,
  type ExperienceOfferingData,
} from "@mingla/offering-rendering";
// Deep import — avoid the package barrel (pulls expo-video via EventCoverMedia).
import { isOpenDailyExperience } from "@mingla/offering-rendering/experienceOpenDaily";
// issue #3281 R3 — DEEP specifier: pure, so a partial barrel mock cannot blank it.
import { experienceSeatsLabel } from "@mingla/offering-rendering/experienceR3";

import type {
  PublicExperience,
  PublicExperienceBrand,
  PublicExperienceDate,
} from "../../services/publicExperienceService";

// "5 dates · Next: Fri 20 Jun" / "Fri 20 Jun" / null — from real occurrences (rule 9).
function buildDatesLabel(
  dates: ReadonlyArray<PublicExperienceDate>,
  timezone: string,
): string | null {
  const future = dates
    .map((d) => ({ d, ms: new Date(d.startAt).getTime() }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms)
    .map((x) => x.d);
  const list = future.length > 0 ? future : dates;
  if (list.length === 0) return null;
  const next = list[0];
  let nextLabel = "";
  const dd = new Date(next.startAt);
  if (!Number.isNaN(dd.getTime())) {
    try {
      nextLabel = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: timezone || "UTC",
      }).format(dd);
    } catch {
      nextLabel = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(dd);
    }
  }
  if (nextLabel.length === 0) return null;
  return list.length > 1 ? `${list.length} dates · Next: ${nextLabel}` : nextLabel;
}

// "3 spots left · 12 max" / "12 max" / null — from the one ticket (rule 9).
// issue #3281 R3 — per_day / per_start scopes read the NEXT OPEN day's remaining.
function buildSeatsLabel(exp: PublicExperience): string | null {
  const t = exp.ticket;
  if (t === null) return null;
  return experienceSeatsLabel({
    capacityScope: exp.capacityScope ?? "total",
    occurrences: exp.dates.map((d) => ({
      startAt: d.startAt,
      endAt: d.endAt,
      remaining: d.ticketsRemaining,
    })),
    ticketRemaining: t.ticketsRemaining,
    quantityTotal: t.quantityTotal,
    isUnlimited: t.isUnlimited,
  });
}

// "7:00 PM start" / null — from the master/first occurrence start instant (rule 9).
function buildStartTimeLabel(exp: PublicExperience): string | null {
  const first = exp.dates[0];
  if (first == null) return null;
  const d = new Date(first.startAt);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return `${new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: first.timezone || exp.timezone || "UTC",
    }).format(d)} start`;
  } catch {
    return null;
  }
}

export function buildExperienceOfferingData(
  exp: PublicExperience,
): ExperienceOfferingData {
  const t = exp.ticket;
  // priceAllInGbp is MAJOR units → ×100 → cents (the shared body divides by 100).
  const allInCents =
    t !== null && typeof t.priceAllInGbp === "number" && t.priceAllInGbp > 0
      ? Math.round(t.priceAllInGbp * 100)
      : null;

  const occurrences = exp.dates.map((d) => ({
    eventDateId: d.id,
    startAt: d.startAt,
    endAt: d.endAt,
    remaining: d.ticketsRemaining,
    capacity: null as number | null,
  }));

  return {
    id: exp.id,
    title: exp.title,
    description: exp.description,
    currency: t?.currency ?? "USD",
    timezone: exp.timezone,
    coverMediaUrl: exp.coverMediaUrl,
    coverMediaType: exp.coverMediaType,
    cityCountry: normalizeCityCountry(exp.venueText),
    datesLabel: buildDatesLabel(exp.dates, exp.timezone),
    seatsLabel: buildSeatsLabel(exp),
    startTimeLabel: buildStartTimeLabel(exp),
    intents: exp.intents,
    stops: exp.stops.map((s) => ({
      id: s.id,
      stopOrder: s.stopOrder,
      placeName: s.placeName,
      address: s.address,
      description: s.description,
      startTime: s.startTime,
      ...(typeof s.startOffsetMinutes === "number"
        ? { startOffsetMinutes: s.startOffsetMinutes }
        : {}),
      lat: s.lat,
      lng: s.lng,
      // experience_stops.image_urls are images (videos ride the cover). The shared
      // gallery honors an explicit type — image here; the consumer seed path may
      // carry videos and they pass through untouched.
      media: s.imageUrls.map((url) => ({ url, type: "image" as const })),
    })),
    ticket:
      t !== null
        ? {
            ticketTypeId: t.ticketTypeId,
            name: t.name,
            priceCents: t.priceCents,
            priceAllInCents: allInCents,
            salePriceCents:
              typeof t.salePriceGbp === "number"
                ? Math.round(t.salePriceGbp * 100)
                : null,
            saleAllInCents:
              typeof t.saleAllInGbp === "number"
                ? Math.round(t.saleAllInGbp * 100)
                : null,
            saleEndsAt: t.saleEndsAt ?? null,
            saleName: t.saleName ?? null,
            saleRemaining: t.saleRemaining ?? null,
            currency: t.currency,
            isFree: t.isFree,
            isUnlimited: t.isUnlimited,
            ticketsRemaining: t.ticketsRemaining,
            quantityTotal: t.quantityTotal,
            ...(t.priceBasis !== undefined ? { priceBasis: t.priceBasis } : {}),
            ...(t.blockMinutes !== undefined
              ? { blockMinutes: t.blockMinutes }
              : {}),
            ...(t.minBlocks !== undefined ? { minBlocks: t.minBlocks } : {}),
            ...(t.maxBlocks !== undefined ? { maxBlocks: t.maxBlocks } : {}),
            ...(t.groupMax !== undefined ? { groupMax: t.groupMax } : {}),
          }
        : null,
    // issue #3281 R2 — map public options when present; else omit (body falls
    // back to [ticket]).
    ...(Array.isArray(exp.options) && exp.options.length > 0
      ? {
          options: exp.options.map((opt) => {
            const optAllIn =
              typeof opt.priceAllInGbp === "number" && opt.priceAllInGbp > 0
                ? Math.round(opt.priceAllInGbp * 100)
                : null;
            return {
              ticketTypeId: opt.ticketTypeId,
              name: opt.name,
              priceCents: opt.priceCents,
              priceAllInCents: optAllIn,
              salePriceCents:
                typeof opt.salePriceGbp === "number"
                  ? Math.round(opt.salePriceGbp * 100)
                  : null,
              saleAllInCents:
                typeof opt.saleAllInGbp === "number"
                  ? Math.round(opt.saleAllInGbp * 100)
                  : null,
              saleEndsAt: opt.saleEndsAt ?? null,
              saleName: opt.saleName ?? null,
              saleRemaining: opt.saleRemaining ?? null,
              currency: opt.currency,
              isFree: opt.isFree,
              isUnlimited: opt.isUnlimited,
              ticketsRemaining: opt.ticketsRemaining,
              quantityTotal: opt.quantityTotal,
              ...(opt.priceBasis !== undefined
                ? { priceBasis: opt.priceBasis }
                : {}),
              ...(opt.blockMinutes !== undefined
                ? { blockMinutes: opt.blockMinutes }
                : {}),
              ...(opt.minBlocks !== undefined
                ? { minBlocks: opt.minBlocks }
                : {}),
              ...(opt.maxBlocks !== undefined
                ? { maxBlocks: opt.maxBlocks }
                : {}),
              ...(opt.groupMax !== undefined ? { groupMax: opt.groupMax } : {}),
            };
          }),
        }
      : {}),
    occurrences,
    openDaily: isOpenDailyExperience({
      isRecurring: exp.whenMode === "recurring",
      recurrenceRule: exp.recurrenceRule,
    }),
    bookable: exp.bookable !== false,
    ...(exp.capacityScope !== undefined
      ? { capacityScope: exp.capacityScope }
      : {}),
    ...(typeof exp.spacingMinutes === "number"
      ? { spacingMinutes: exp.spacingMinutes }
      : {}),
    ...(typeof exp.minNoticeMinutes === "number"
      ? { minNoticeMinutes: exp.minNoticeMinutes }
      : {}),
    // issue #3284 — section 10 refund terms, straight from the read. The body
    // hides them when unknown, on a free experience, and when closed.
    refundPolicyState: exp.refundPolicyState,
    offeringClosed: exp.status === "ended" || exp.status === "cancelled",
  };
}

export function buildExperienceOfferingBrand(
  brand: PublicExperienceBrand,
): ExperienceOfferingBrand {
  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    bio: brand.bio ?? null,
    coverMediaUrl: brand.coverMediaUrl ?? null,
    coverMediaType: brand.coverMediaType ?? null,
    coverHue: brand.coverHue ?? null,
    verified: false,
  };
}
