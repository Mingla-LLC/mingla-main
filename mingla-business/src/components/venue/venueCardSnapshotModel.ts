/**
 * #4490 — the Hub venue card's operational snapshot, kept pure so the labels
 * and counts cannot drift between the render and its regression tests.
 *
 * A venue's feature mix selects the most useful snapshot it can truthfully
 * answer. Entry-like venues keep the original door numbers. Other venues get
 * the live queue they actually operate instead of an empty gap or fake zeroes.
 */
import type { StayStaffReservationList } from "../../types/stayReservation";
import type { VenueDay, VenueRequestsList } from "../../types/venueOffers";
import type {
  Reservation,
  WaitlistEntry,
} from "../../types/venueReservation";
import { dayNumbers } from "./features/today/todayModel";

export interface VenueCardSnapshotMetric {
  key: string;
  label: string;
  value: string;
}

const unknown = (key: string, label: string): VenueCardSnapshotMetric => ({
  key,
  label,
  value: "--",
});

export function doorSnapshot(
  day: VenueDay | undefined,
): readonly VenueCardSnapshotMetric[] {
  if (day === undefined) {
    return [
      unknown("in", "In now"),
      unknown("arrive", "To arrive"),
      unknown("paying", "Paying now"),
    ];
  }
  const numbers = dayNumbers(day);
  return [
    { key: "in", label: "In now", value: String(numbers.inNow) },
    { key: "arrive", label: "To arrive", value: String(numbers.toArrive) },
    { key: "paying", label: "Paying now", value: String(numbers.waiting) },
  ];
}

export function requestSnapshot(
  list: VenueRequestsList | undefined,
): readonly VenueCardSnapshotMetric[] {
  if (list === undefined) {
    return [
      unknown("answer", "To answer"),
      unknown("deposit", "Deposit due"),
      unknown("confirmed", "Confirmed"),
    ];
  }
  return [
    { key: "answer", label: "To answer", value: String(list.counts.toAnswer) },
    {
      key: "deposit",
      label: "Deposit due",
      value: String(list.counts.waitingForDeposit),
    },
    {
      key: "confirmed",
      label: "Confirmed",
      value: String(list.counts.confirmed),
    },
  ];
}

export function staySnapshot(
  list: StayStaffReservationList | undefined,
): readonly VenueCardSnapshotMetric[] {
  if (list === undefined || !list.permissions.canView) {
    return [
      unknown("answer", "To answer"),
      unknown("payment", "Payment due"),
      unknown("confirmed", "Confirmed"),
    ];
  }
  const toAnswer = list.groups.filter(
    (group) => group.state === "request_pending",
  ).length;
  const paymentDue = list.groups.filter((group) =>
    [
      "instant_payment_pending",
      "approved_payment_required",
      "finalizing",
    ].includes(group.state),
  ).length;
  const confirmed = list.groups.filter(
    (group) =>
      group.state === "confirmed" || group.state === "partially_cancelled",
  ).length;
  return [
    { key: "answer", label: "To answer", value: String(toAnswer) },
    { key: "payment", label: "Payment due", value: String(paymentDue) },
    { key: "confirmed", label: "Confirmed", value: String(confirmed) },
  ];
}

function reservationIsToday(
  reservation: Pick<Reservation, "reservedFor" | "status">,
  timeZone: string,
  today: string,
): boolean {
  try {
    return dayKey(reservation.reservedFor, timeZone) === today;
  } catch {
    return false;
  }
}

const dayKey = (instantIso: string, timeZone: string): string => {
  const instant = new Date(instantIso);
  if (!Number.isFinite(instant.getTime())) throw new Error("invalid_instant");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export function tableSnapshot(input: {
  reservations:
    | readonly Pick<Reservation, "reservedFor" | "status">[]
    | undefined;
  waitlist: readonly Pick<WaitlistEntry, "status">[] | undefined;
  timeZone: string | undefined;
  now?: Date;
}): readonly VenueCardSnapshotMetric[] {
  const timeZone = input.timeZone;
  const today =
    timeZone === undefined
      ? null
      : dayKey((input.now ?? new Date()).toISOString(), timeZone);
  const todayReservations =
    input.reservations === undefined || today === null || timeZone === undefined
      ? undefined
      : input.reservations.filter(
          (reservation) =>
            ["requested", "confirmed", "seated"].includes(reservation.status) &&
            reservationIsToday(reservation, timeZone, today),
        );
  const activeWaitlist =
    input.waitlist === undefined
      ? undefined
      : input.waitlist.filter(
          (entry) => entry.status === "waiting" || entry.status === "notified",
        ).length;

  return [
    todayReservations === undefined
      ? unknown("seated", "Seated now")
      : {
          key: "seated",
          label: "Seated now",
          value: String(
            todayReservations.filter((reservation) => reservation.status === "seated")
              .length,
          ),
        },
    todayReservations === undefined
      ? unknown("today", "Today")
      : { key: "today", label: "Today", value: String(todayReservations.length) },
    activeWaitlist === undefined
      ? unknown("waitlist", "Waitlist")
      : { key: "waitlist", label: "Waitlist", value: String(activeWaitlist) },
  ];
}

export function setupSnapshot(input: {
  enabledFeatures: number | null;
  menuItems: number | null;
  openFixes: number | null;
}): readonly VenueCardSnapshotMetric[] {
  const value = (count: number | null): string =>
    count === null ? "--" : String(count);
  return [
    { key: "features", label: "Features", value: value(input.enabledFeatures) },
    { key: "menu", label: "Menu items", value: value(input.menuItems) },
    { key: "fixes", label: "To fix", value: value(input.openFixes) },
  ];
}
