import { primaryActionCount, trafficOutcomeCopy } from "../trafficOutcomeCopy";
import { listingInsightsIntro } from "../listingInsightsIntro";

describe("#4037 analytics language by listing type", () => {
  test.each([
    [
      "event",
      "See how people discover and book this event.",
      "Booking taps",
      "Bookings",
      "From visit to booking",
    ],
    [
      "experience",
      "See how people discover and book this experience.",
      "Booking taps",
      "Bookings",
      "From visit to booking",
    ],
    [
      "trip",
      "See how people discover and book this trip.",
      "Booking taps",
      "Bookings",
      "From visit to booking",
    ],
    [
      "rsvp",
      "See how people discover and RSVP to this event.",
      "RSVP taps",
      "RSVPs",
      "From visit to RSVP",
    ],
    [
      "venue",
      "See how people discover and reserve this venue.",
      "Reservation taps",
      "Reservations",
      "From visit to reservation",
    ],
  ] as const)(
    "%s has one unambiguous action and outcome vocabulary",
    (listingType, intro, actionLabel, outcomeLabel, pathTitle) => {
      expect(trafficOutcomeCopy(listingType)).toMatchObject({
        intro,
        actionLabel,
        outcomeLabel,
        pathTitle,
      });
      expect(listingInsightsIntro(listingType)).toBe(intro);
    },
  );

  it("counts only the primary action for each listing kind", () => {
    const ctas = [
      { type: "buy" as const, count: 2 },
      { type: "book" as const, count: 3 },
      { type: "rsvp" as const, count: 5 },
      { type: "share" as const, count: 11 },
    ];
    expect(primaryActionCount(ctas, "event")).toBe(5);
    expect(primaryActionCount(ctas, "experience")).toBe(5);
    expect(primaryActionCount(ctas, "trip")).toBe(5);
    expect(primaryActionCount(ctas, "rsvp")).toBe(5);
    expect(primaryActionCount(ctas, "venue")).toBe(3);
    expect(primaryActionCount(ctas, "brand")).toBe(10);
  });
});
