export interface TripHeroSublineInput {
  startAt: string | null;
  endAt: string | null;
  destinationLocationText: string | null;
}

const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  timeZone: "UTC",
});

function dateParts(value: string): {
  year: number;
  month: number;
  day: number;
  monthLabel: string;
  monthDayLabel: string;
} | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    monthLabel: MONTH_FORMATTER.format(date),
    monthDayLabel: MONTH_DAY_FORMATTER.format(date),
  };
}

export function formatTripHeroSubline({
  startAt,
  endAt,
  destinationLocationText,
}: TripHeroSublineInput): string {
  const start = startAt === null ? null : dateParts(startAt);
  const end = endAt === null ? null : dateParts(endAt);
  const destination = destinationLocationText?.trim() ?? "";

  let datesLabel = "";
  if (start !== null) {
    if (
      end !== null &&
      start.year === end.year &&
      start.month === end.month &&
      start.day !== end.day
    ) {
      datesLabel = `${start.monthLabel} ${start.day}-${end.day}`;
    } else if (end !== null && start.day !== end.day) {
      datesLabel = `${start.monthDayLabel}-${end.monthDayLabel}`;
    } else {
      datesLabel = start.monthDayLabel;
    }
  }

  if (datesLabel.length > 0 && destination.length > 0) {
    return `${datesLabel} · ${destination}`;
  }
  if (datesLabel.length > 0) return datesLabel;
  return destination.length > 0 ? destination : "Date TBD";
}

export function formatTripSpotsLabel(
  ticketsSoldCount: number,
  capacity: number | null,
): string {
  return capacity !== null
    ? `${ticketsSoldCount} / ${capacity}`
    : `${ticketsSoldCount}`;
}

export function resolveTripTierSoldCount(input: {
  ticketTypeId: string;
  soldCountByTier: Map<string, number>;
  tripTicketsSoldCount: number;
  pricingTierCount: number;
}): number {
  const tierSold = input.soldCountByTier.get(input.ticketTypeId);
  if (tierSold !== undefined) return tierSold;
  return input.pricingTierCount === 1 ? input.tripTicketsSoldCount : 0;
}

export function tripDashboardBundleProofTestID(eventId: string): string {
  return `orch-0950-trip-dashboard-branch-bundle-${eventId}`;
}
