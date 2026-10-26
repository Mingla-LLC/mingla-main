/**
 * #4111 — map the data a brand page / offering page already holds into the
 * topic builder's input, and the `brand_enquiry_my_plans` rows into plans.
 * PURE (no React). Shared so buyer web and Explorer map identically.
 */
import type { PublicBrandUpcoming, PublicBrandVenueSummary } from "../types";
import type { EnquiryOffering, EnquiryOfferingKind, EnquiryPlan, EnquiryVenue } from "./enquiryTopics";

const offeringKind = (type: PublicBrandUpcoming["offeringType"]): EnquiryOfferingKind => {
  switch (type) {
    case "event":
      return "event";
    case "rsvp":
      return "rsvp";
    case "trip":
      return "trip";
    case "experience":
      return "experience";
    default: {
      const never: never = type;
      return never;
    }
  }
};

const fromSectionRow = (
  row: PublicBrandUpcoming,
  when: EnquiryOffering["when"],
): EnquiryOffering => ({
  id: row.offeringId,
  title: row.name,
  kind: offeringKind(row.offeringType),
  startsAt: row.startsAt,
  endsAt: row.endsAt ?? null,
  when,
});

/** The brand page's Happening now / Upcoming / Past rows as sheet offerings. */
export const enquiryOfferingsFromSections = (sections: {
  happeningNow?: ReadonlyArray<PublicBrandUpcoming>;
  upcoming?: ReadonlyArray<PublicBrandUpcoming>;
  past?: ReadonlyArray<PublicBrandUpcoming>;
}): EnquiryOffering[] => [
  ...(sections.happeningNow ?? []).map((row) => fromSectionRow(row, "happening_now")),
  ...(sections.upcoming ?? []).map((row) => fromSectionRow(row, "upcoming")),
  ...(sections.past ?? []).map((row) => fromSectionRow(row, "past")),
];

/**
 * The brand's claimed venue for "At the venue". Only a venue the page knows
 * about counts; ordering is shown only when the caller knows it is on.
 */
export const enquiryVenueFromSummary = (
  venue: PublicBrandVenueSummary | null | undefined,
  options: { orderingEnabled?: boolean } = {},
): EnquiryVenue | null =>
  venue === null || venue === undefined
    ? null
    : {
        id: venue.id,
        name: venue.name,
        orderingEnabled: options.orderingEnabled === true,
        reservationsOnline: venue.reservationState === "available",
      };

const PLAN_KINDS: ReadonlyArray<EnquiryPlan["kind"]> = ["order", "rsvp", "reservation", "stay", "venue_order"];

const isPlanKind = (value: unknown): value is EnquiryPlan["kind"] =>
  typeof value === "string" && (PLAN_KINDS as ReadonlyArray<string>).includes(value);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/**
 * One `brand_enquiry_my_plans` row → a plan. Rows with an unknown kind or no id
 * are dropped (never guessed).
 */
export const enquiryPlanFromRow = (row: Record<string, unknown>): EnquiryPlan | null => {
  const id = str(row.id);
  if (id === null || !isPlanKind(row.kind)) return null;
  return {
    kind: row.kind,
    id,
    title: str(row.title) ?? "Booking",
    startsAt: str(row.starts_at),
    summary: str(row.summary),
    isUpcoming: row.is_upcoming === true,
    canCancel: row.can_cancel === true,
    canCancelUrl: str(row.can_cancel_url),
    canRequestRefund: row.can_request_refund === true,
  };
};

export const enquiryPlansFromRows = (rows: unknown): EnquiryPlan[] =>
  Array.isArray(rows)
    ? rows
        .map((row) =>
          row !== null && typeof row === "object" ? enquiryPlanFromRow(row as Record<string, unknown>) : null,
        )
        .filter((plan): plan is EnquiryPlan => plan !== null)
    : [];
