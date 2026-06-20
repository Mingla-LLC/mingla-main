// ORCH-1138 Leg 1C — consumer trip → Direction-A foundation data-adapter.
//
// Pure mapping of `ConsumerTripDetail` + a resolved `ThemePalette`/`boldFamily`
// onto the inputs the shared @mingla/offering-rendering primitives expect, so the
// consumer trip detail converges on the business/web trip page (TripPreview
// FOUNDATION mode) by REUSING the same primitives (NOT by importing TripPreview —
// it is business-app-local, F-6). Render only real fields (Constitution rule 9):
// every derived value returns null/[] when its source is absent so the screen
// omits that section entirely (no empty frames, no fabricated data).
//
// 🔒 COMMS-0009 / I-ANON-BRANDS-VIA-DEFINER-VIEW: this adapter touches NO Supabase
// table — it is a pure projection of data the anon-safe useConsumerTripDetail +
// useEventTheme already resolved. It never queries the brands table, no fetch.
//
// 🔒 I-MOR-0827-PACKAGE-ISOLATION: no import from mingla-business/src.

import { normalizeCityCountry } from "@mingla/offering-rendering";
import type { Chip, CountAwareGalleryItem } from "@mingla/offering-rendering";
import type { ThemePalette } from "@mingla/offering-rendering";

import type {
  ConsumerTripDetail,
  TripDetailDay,
} from "./useConsumerTripDetail";

/** One mapped itinerary day for the foundation DayByDay spine. */
export interface FoundationTripDay {
  id: string;
  ordinal: number;
  title: string;
  narrative: string | null;
  /** Count-aware gallery nodes (empty → CountAwareGallery renders ZERO nodes). */
  gallery: CountAwareGalleryItem[];
}

/** The leaving-from → destination route legs (each rendered only when present). */
export interface FoundationRoute {
  departure: string | null;
  destination: string | null;
}

/** The mapped foundation render inputs for the consumer trip body. */
export interface ConsumerTripFoundationModel {
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  title: string;
  /** "N days · M nights · Destination" hero eyebrow (null → omit). */
  heroEyebrow: string | null;
  /** Derived "N days · M nights" (null when not derivable). */
  duration: string | null;
  /** Formatted date-range chip text ("" → omit). */
  dateLabel: string;
  /** "N seats left · M max" / "Sold out · N of N booked" / "M max" (null → omit). */
  seatsLabel: string | null;
  destination: string | null;
  brandName: string;
  brandVerified: boolean;
  // ORCH-1138 FIX-3 — the "Presented by" brand cover, rendered via the
  // gif/video-aware EventCoverMedia (NOT a plain <Image>) so an animated brand
  // cover shows. Sourced anon-safe from `business_public_brands_view`
  // (useConsumerTripDetail — 🔒 COMMS-0009, never `.from("brands")`). null when
  // the brand set no cover → EventCoverMedia renders the themed hue/initial
  // fallback (rule 9 — graceful, never a fabricated cover, never a bare red disk).
  brandCoverMediaUrl: string | null;
  brandCoverMediaType: "image" | "video" | "gif" | null;
  route: FoundationRoute | null;
  description: string | null;
  days: FoundationTripDay[];
  includedChips: Chip[];
  excludedChips: Chip[];
  /** false → reserve renders the non-tappable "Booking unavailable" strip. */
  bookable: boolean;
}

// Derived "N days · M nights" from the trip date range. Returns null when the
// range can't be derived (rule 9 — never fabricate a duration). Ports the
// business TripPreview `deriveDuration` (lines 150-160) verbatim for parity.
export function deriveTripDuration(
  startAt: string | null,
  endAt: string | null,
): string | null {
  if (startAt === null || endAt === null) return null;
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const nights = Math.max(0, Math.round((e - s) / dayMs));
  const days = nights + 1;
  if (nights === 0) return `${days} day`;
  return `${days} days · ${nights} night${nights === 1 ? "" : "s"}`;
}

function mapDayGallery(day: TripDetailDay): CountAwareGalleryItem[] {
  return day.media.map((m) => ({
    url: m.url,
    type: m.type === "video" ? "video" : "image",
  }));
}

// Seats chip text from the consumer's spotsLeft/totalCapacity (consumer has
// `spotsLeft`, NOT per-tier `ticketsRemaining` — INVESTIGATION Q2). Sold-out is
// derived from spotsLeft.
function deriveSeatsLabel(
  totalCapacity: number | null,
  spotsLeft: number | null,
): string | null {
  if (totalCapacity === null) return null;
  if (spotsLeft !== null && spotsLeft <= 0) {
    return `Sold out · ${totalCapacity} of ${totalCapacity} booked`;
  }
  if (spotsLeft !== null) {
    return `${spotsLeft} seats left · ${totalCapacity} max`;
  }
  return `${totalCapacity} max`;
}

/**
 * Map a ConsumerTripDetail (+ resolved palette — currently only used to ensure
 * the caller has a palette in hand; chip variants are palette-agnostic) onto the
 * foundation render inputs. Pure + deterministic (memoize at the call site).
 */
export function mapConsumerTripToFoundation(
  detail: ConsumerTripDetail,
  _palette: ThemePalette,
): ConsumerTripFoundationModel {
  void _palette; // palette is applied at render time via offeringSurfaceStyles.

  const duration = deriveTripDuration(detail.startAt, detail.endAt);
  // ORCH-1138 [trip-page-redesign] FIX-2 — normalize the destination to
  // "City, Country" EVERYWHERE it surfaces (the hero eyebrow trailing location,
  // the 📍 location chip, AND the route block) via the SAME shared normalizer the
  // business/web TripPreview uses, so it reads e.g. "Washington, USA" instead of
  // the raw "Washington, District of Columbia, United States". null → the chip /
  // eyebrow-suffix is omitted (rule 9 — no fabrication, falls back to raw only if
  // the normalizer can't resolve anything, which it does internally).
  const destination = normalizeCityCountry(detail.destinationText);

  const heroEyebrow =
    duration !== null
      ? destination !== null
        ? `${duration} · ${destination}`
        : duration
      : null;

  const dateLabel =
    detail.startAt !== null && detail.endAt !== null
      ? // formatTripDateRange is applied at the call site (it lives in
        // @mingla/offering-rendering); the adapter just signals presence.
        "has-range"
      : "";

  // ORCH-1138 [trip-page-redesign] FIX-2 — standardize the route legs to
  // "City, Country" (shared normalizer, parity with the business/web TripPreview)
  // so leaving-from + destination stay short + balanced on ONE aligned row. The
  // consumer trip payload carries only free text (F-4: no structured city/country
  // / lat-lng), so we parse the free text. null → that leg is hidden (rule 9, no
  // fabrication). The destination is normalized from the SAME raw source as the
  // eyebrow/chip (`detail.destinationText`) so all three read identically.
  const departureCityCountry = normalizeCityCountry(detail.departureText);
  const destinationCityCountry = normalizeCityCountry(detail.destinationText);
  const route: FoundationRoute | null =
    departureCityCountry !== null || destinationCityCountry !== null
      ? { departure: departureCityCountry, destination: destinationCityCountry }
      : null;

  const days: FoundationTripDay[] = detail.days.map((d) => ({
    id: d.id,
    ordinal: d.ordinal,
    title: d.title,
    narrative:
      d.narrative !== null && d.narrative.trim().length > 0 ? d.narrative : null,
    gallery: mapDayGallery(d),
  }));

  const includedChips: Chip[] = detail.inclusions
    .filter((i) => i.kind === "included")
    .map((i) => ({ label: i.item, variant: "yes" }));
  const excludedChips: Chip[] = detail.inclusions
    .filter((i) => i.kind === "excluded")
    .map((i) => ({ label: i.item, variant: "no" }));

  const description =
    detail.description !== null && detail.description.trim().length > 0
      ? detail.description
      : null;

  return {
    coverMediaUrl: detail.coverMediaUrl,
    coverMediaType: detail.coverMediaType,
    title: detail.title,
    heroEyebrow,
    duration,
    dateLabel,
    seatsLabel: deriveSeatsLabel(detail.totalCapacity, detail.spotsLeft),
    destination,
    brandName: detail.brandName,
    brandVerified: detail.brandVerified,
    // ORCH-1138 FIX-3 (device rework) — the BRAND cover now flows from the
    // anon-safe, security-definer `business_public_brands_view` (🔒 COMMS-0009 —
    // useConsumerTripDetail reads the view, NEVER `.from("brands")`). When the
    // brand set a cover, EventCoverMedia animates it (image/gif/video); when
    // null, it renders the clean themed hue/initial fallback (rule 9).
    brandCoverMediaUrl: detail.brandCoverMediaUrl,
    brandCoverMediaType: detail.brandCoverMediaType,
    route,
    description,
    days,
    includedChips,
    excludedChips,
    bookable: detail.bookable,
  };
}
