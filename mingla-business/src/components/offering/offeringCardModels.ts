/**
 * offeringCardModels — META-ORCH-1059 Pass 1.
 *
 * Pure per-kind mappers from each kind's domain data → the normalized
 * OfferingListCardModel the shared OfferingListCard renders. This is where each
 * kind is read "through the right lens" (travelers vs spots-sold, destination vs
 * venue subline, status derivation) while the card stays kind-agnostic.
 */

import { formatCurrencyRound } from "../../utils/currency";
import { formatDraftDateLine } from "../../utils/eventDateDisplay";
import type { Trip } from "../../services/tripsService";
import type { VenueExperience } from "../../services/experiencesService";
import type { LiveEvent } from "../../store/liveEventStore";
import { formatOfferingMetric } from "./offeringKind";
import type {
  OfferingCardStatus,
  OfferingListCardModel,
} from "./offeringListCardModel";

/** Deterministic hue (0–359) from a stable id — same algorithm everywhere. */
export function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function formatDateRange(
  startIso: string | null,
  endIso: string | null,
): string {
  if (startIso === null) return "Date TBD";
  try {
    const fmt = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    });
    const start = fmt.format(new Date(startIso));
    if (endIso === null) return start;
    const end = fmt.format(new Date(endIso));
    return `${start}–${end}`;
  } catch {
    return "Date TBD";
  }
}

// ---------------------------------------------------------------------------
// Trip → OfferingListCardModel
// ---------------------------------------------------------------------------

function deriveTripCardStatus(trip: Trip): OfferingCardStatus {
  if (trip.status === "draft") return "draft";
  if (trip.status === "cancelled") return "cancelled";
  if (trip.status === "ended") return "past";
  const now = Date.now();
  const start = trip.businessTrip.startAt
    ? new Date(trip.businessTrip.startAt).getTime()
    : Number.NaN;
  const end = trip.businessTrip.endAt
    ? new Date(trip.businessTrip.endAt).getTime()
    : Number.NaN;
  if (Number.isFinite(end) && now > end) return "past";
  if (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    now >= start &&
    now <= end
  ) {
    return "live";
  }
  return "upcoming";
}

export function tripToOfferingModel(trip: Trip): OfferingListCardModel {
  const dateLine = formatDateRange(
    trip.businessTrip.startAt,
    trip.businessTrip.endAt,
  );
  const destination = trip.businessTrip.destinationLocationText;
  const subline =
    destination !== null && destination.length > 0
      ? `${dateLine} · ${destination}`
      : dateLine;
  const status = deriveTripCardStatus(trip);
  const metricLabel =
    status === "draft" ? null : formatOfferingMetric("trip", trip.ticketsSoldCount);
  const revenueCents = trip.revenueCents ?? 0;
  const revenueCurrency = trip.revenueCurrency ?? null;
  const revenueLabel =
    revenueCents > 0 && revenueCurrency !== null
      ? formatCurrencyRound(revenueCents, revenueCurrency, true)
      : null;

  return {
    id: trip.id,
    title: trip.title,
    status,
    subline,
    coverMediaUrl: trip.coverMediaUrl,
    coverMediaType: normalizeCoverType(trip.coverMediaType),
    coverHue: hueFromId(trip.id),
    metricLabel,
    revenueLabel,
    capacityPct: null,
  };
}

// ---------------------------------------------------------------------------
// Experience → OfferingListCardModel
// ---------------------------------------------------------------------------

function deriveExperienceCardStatus(status: string): OfferingCardStatus {
  switch (status) {
    case "live":
      return "live";
    case "scheduled":
      return "upcoming";
    case "cancelled":
      return "cancelled";
    case "ended":
      return "past";
    case "draft":
    default:
      return "draft";
  }
}

export function experienceToOfferingModel(
  exp: VenueExperience,
): OfferingListCardModel {
  const status = deriveExperienceCardStatus(exp.status);
  const metricLabel =
    status === "draft" ? null : formatOfferingMetric("experience", exp.spotsSold);
  const revenueLabel =
    exp.revenueCents > 0 && exp.revenueCurrency !== null
      ? formatCurrencyRound(exp.revenueCents, exp.revenueCurrency, true)
      : null;
  return {
    id: exp.id,
    title: exp.title,
    status,
    subline: exp.dateSubline,
    coverMediaUrl: exp.coverMediaUrl,
    coverMediaType: exp.coverMediaType,
    coverHue: hueFromId(exp.id),
    metricLabel,
    revenueLabel,
    capacityPct: null,
  };
}

// ---------------------------------------------------------------------------
// LiveEvent → OfferingListCardModel  (ORCH-1121)
// ---------------------------------------------------------------------------

/**
 * ORCH-1121 — pure mapper from a published `LiveEvent` to the normalized
 * OfferingListCardModel rendered by the shared `OfferingListCard`. Used by the
 * business brand profile's Recent-Events glance surface.
 *
 * `status` is passed in (the caller derives it via `deriveCardStatus`, the
 * canonical Hub bucketing — `OfferingCardStatus` is a superset of that
 * `EventCardStatus`, so the value is directly assignable).
 *
 * The subline mirrors `EventListCard`'s derivation: date line (via the shared
 * `formatDraftDateLine` — `LiveEvent` satisfies `EventDateLike`) plus ` · venue`
 * when a venue name is present.
 *
 * metric/capacity/revenue are intentionally `null`: this is a glanceable
 * summary, so the brand profile does NOT mount a per-row `useEventOrders` fetch
 * (would be up to 5 network hooks). `OfferingListCard` renders cleanly with all
 * three null (no progress bar, no metric subtext, no revenue strip). Live
 * sold-counts here would be an additive follow-on ORCH.
 */
export function liveEventToOfferingModel(
  event: LiveEvent,
  status: OfferingCardStatus,
): OfferingListCardModel {
  const dateLine = formatDraftDateLine(event);
  const venue = event.venueName;
  const subline =
    venue !== null && venue.length > 0 ? `${dateLine} · ${venue}` : dateLine;
  return {
    id: event.id,
    title: event.name,
    status,
    subline,
    coverMediaUrl: event.coverMediaUrl,
    coverMediaType: normalizeCoverType(event.coverMediaType),
    coverHue: event.coverHue,
    metricLabel: null,
    revenueLabel: null,
    capacityPct: null,
  };
}

function normalizeCoverType(
  value: string | null,
): "image" | "video" | "gif" | null {
  return value === "image" || value === "video" || value === "gif"
    ? value
    : null;
}
