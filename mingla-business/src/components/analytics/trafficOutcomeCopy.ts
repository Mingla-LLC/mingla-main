import type {
  TrafficCtaRow,
  TrafficCtaType,
  TrafficListingType,
} from "../../services/trafficAnalyticsService";

export interface TrafficOutcomeCopy {
  pageTypeLabel: string;
  intro: string;
  actionLabel: string;
  outcomeLabel: string;
  outcomeLower: string;
  outcomeSingular: string;
  pathTitle: string;
  primaryCtas: readonly TrafficCtaType[];
  showsCheckout: boolean;
}

const BOOKING_PRIMARY_CTAS = ["buy", "book"] as const;

export const trafficOutcomeCopy = (
  listingType: TrafficListingType,
): TrafficOutcomeCopy => {
  switch (listingType) {
    case "brand":
      return {
        pageTypeLabel: "Brand",
        intro: "See how people reach your pages and take action.",
        actionLabel: "Booking or RSVP taps",
        outcomeLabel: "Completed bookings and RSVPs",
        outcomeLower: "bookings and RSVPs",
        outcomeSingular: "completed outcome",
        pathTitle: "Activity in this period",
        primaryCtas: ["buy", "book", "rsvp"],
        showsCheckout: true,
      };
    case "rsvp":
      return {
        pageTypeLabel: "RSVP",
        intro: "See how people discover and RSVP to this event.",
        actionLabel: "RSVP taps",
        outcomeLabel: "RSVPs",
        outcomeLower: "RSVPs",
        outcomeSingular: "RSVP",
        pathTitle: "From visit to RSVP",
        primaryCtas: ["rsvp"],
        showsCheckout: false,
      };
    case "venue":
      return {
        pageTypeLabel: "Venue",
        intro: "See how people discover and reserve this venue.",
        actionLabel: "Reservation taps",
        outcomeLabel: "Reservations",
        outcomeLower: "reservations",
        outcomeSingular: "reservation",
        pathTitle: "From visit to reservation",
        primaryCtas: ["book"],
        showsCheckout: false,
      };
    case "experience":
      return {
        pageTypeLabel: "Experience",
        intro: "See how people discover and book this experience.",
        actionLabel: "Booking taps",
        outcomeLabel: "Bookings",
        outcomeLower: "bookings",
        outcomeSingular: "booking",
        pathTitle: "From visit to booking",
        primaryCtas: BOOKING_PRIMARY_CTAS,
        showsCheckout: true,
      };
    case "trip":
      return {
        pageTypeLabel: "Trip",
        intro: "See how people discover and book this trip.",
        actionLabel: "Booking taps",
        outcomeLabel: "Bookings",
        outcomeLower: "bookings",
        outcomeSingular: "booking",
        pathTitle: "From visit to booking",
        primaryCtas: BOOKING_PRIMARY_CTAS,
        showsCheckout: true,
      };
    case "event":
      return {
        pageTypeLabel: "Event",
        intro: "See how people discover and book this event.",
        actionLabel: "Booking taps",
        outcomeLabel: "Bookings",
        outcomeLower: "bookings",
        outcomeSingular: "booking",
        pathTitle: "From visit to booking",
        primaryCtas: BOOKING_PRIMARY_CTAS,
        showsCheckout: true,
      };
  }
};

export const primaryActionCount = (
  ctas: readonly TrafficCtaRow[],
  listingType: TrafficListingType,
): number => {
  const keys = trafficOutcomeCopy(listingType).primaryCtas;
  return keys.reduce(
    (sum, key) => sum + (ctas.find((row) => row.type === key)?.count ?? 0),
    0,
  );
};
