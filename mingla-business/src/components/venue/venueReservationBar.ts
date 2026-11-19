/**
 * issue #4420 wave 2 (D-V3) — the venue Reservations tab's live bar copy, as
 * plain data (no React, no network). GuestVenueReservation reports it to the
 * page, which draws it in the shared glass bar.
 */

/** "Fri 20 Nov" for a YYYY-MM-DD day (the bar's title). */
export const venueBarDayLabel = (value: string): string => {
  const [y, m, d] = value.split("-").map((part) => Number(part));
  if (y === undefined || m === undefined || d === undefined) return value;
  const day = new Date(y, m - 1, d);
  if (Number.isNaN(day.getTime())) return value;
  return day.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

/**
 * issue #4420 wave 2 (D-V3) — the Reservations tab's live bar, as plain data.
 *
 * | Step    | Title                 | Subtitle               | CTA            |
 * | pick    | "Fri 20 Nov · 7:30 PM"| "4 guests · Date night"| Continue       |
 * | details | "$63.90 today"        | "Deposit · Fri 20 Nov…"| Confirm · $63.90 |
 * | none    | "Thu 19 Nov"          | "No tables this day"   | Continue (off) |
 */
export const venueReservationBarCopy = (input: {
  step: "pick" | "details";
  dayLabel: string;
  timeLabel: string | null;
  partySize: number;
  occasion: string;
  noTables: boolean;
  totalLabel: string | null;
  requiresPayment: boolean | null;
  reviewing: boolean;
}): { title: string; subtitle: string | null; ctaLabel: string } => {
  const guests = `${input.partySize} ${input.partySize === 1 ? "guest" : "guests"}`;
  const when =
    input.timeLabel === null ? input.dayLabel : `${input.dayLabel} · ${input.timeLabel}`;
  if (input.step === "details" && input.timeLabel !== null) {
    // #4490 N53: never "Confirm & pay" with nothing to pay. "Confirm · ₦x"
    // when a hold is due; "Confirm reservation" when nothing is (or the price
    // is still loading).
    const ctaLabel = input.reviewing
      ? "Confirm updated total"
      : input.requiresPayment === true && input.totalLabel !== null
        ? `Confirm · ${input.totalLabel}`
        : "Confirm reservation";
    if (input.requiresPayment === true && input.totalLabel !== null) {
      return {
        title: `${input.totalLabel} today`,
        subtitle: `Deposit · ${when} · ${guests}`,
        ctaLabel,
      };
    }
    return {
      title: when,
      subtitle: input.requiresPayment === false ? `${guests} · No deposit` : guests,
      ctaLabel,
    };
  }
  if (input.noTables) {
    return { title: input.dayLabel, subtitle: "No tables this day", ctaLabel: "Continue" };
  }
  const occasion = input.occasion.trim();
  return {
    title: when,
    subtitle:
      input.timeLabel === null
        ? `${guests} · Pick a time`
        : occasion.length > 0
          ? `${guests} · ${occasion}`
          : guests,
    ctaLabel: "Continue",
  };
};
