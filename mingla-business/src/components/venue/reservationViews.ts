/**
 * META-ORCH-1148 sub-ORCH 2.1b — reservation view filtering + lifecycle map.
 *
 * Pure, dependency-free. The single source of truth for (a) which statuses each
 * segmented view shows, (b) which lifecycle actions are legal from a given
 * status (the CLIENT mirror of the server guard pg_reservation_transition_is_legal
 * — the server is authoritative, this just hides illegal buttons), and (c) the
 * status pill presentation. Unit-tested (reservationViews.test.ts) as the
 * fails-on-revert anchor for the client lifecycle map.
 */

import type {
  Reservation,
  ReservationAction,
  ReservationStatus,
  ReservationView,
} from "../../types/venueReservation";

/** The 6 segmented views in display order (Design IA §4.4). */
export const RESERVATION_VIEWS: readonly {
  id: ReservationView;
  label: string;
}[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "waitlist", label: "Waitlist" },
  { id: "completed", label: "Completed" },
  { id: "no_shows", label: "No-shows" },
  { id: "canceled", label: "Canceled" },
];

const LIVE_STATUSES: readonly ReservationStatus[] = [
  "requested",
  "confirmed",
  "seated",
];

const isSameLocalDay = (iso: string, ref: Date): boolean => {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
};

/**
 * Filter the full reservation list for a given view.
 *  - today: LIVE statuses whose reserved_for is today.
 *  - upcoming: LIVE statuses reserved AFTER today (later than now's end-of-day).
 *  - waitlist: status='waitlisted'.
 *  - completed / no_shows / canceled: terminal-status buckets.
 */
export function filterReservationsForView(
  reservations: readonly Reservation[],
  view: ReservationView,
  now: Date = new Date(),
): Reservation[] {
  switch (view) {
    case "today":
      return reservations.filter(
        (r) =>
          LIVE_STATUSES.includes(r.status) && isSameLocalDay(r.reservedFor, now),
      );
    case "upcoming":
      return reservations.filter(
        (r) =>
          LIVE_STATUSES.includes(r.status) &&
          new Date(r.reservedFor).getTime() > now.getTime() &&
          !isSameLocalDay(r.reservedFor, now),
      );
    case "waitlist":
      return reservations.filter((r) => r.status === "waitlisted");
    case "completed":
      return reservations.filter((r) => r.status === "completed");
    case "no_shows":
      return reservations.filter((r) => r.status === "no_show");
    case "canceled":
      return reservations.filter(
        (r) =>
          r.status === "cancelled_by_guest" || r.status === "cancelled_by_venue",
      );
    default:
      return [];
  }
}

/**
 * The CLIENT mirror of the legal-transition matrix (server is authoritative via
 * pg_reservation_transition_is_legal). Maps an action → its target status, and
 * whether it's legal from the current status. Used to hide illegal buttons.
 */
export const ACTION_TARGET: Record<ReservationAction, ReservationStatus> = {
  confirm: "confirmed",
  seat: "seated",
  no_show: "no_show",
  complete: "completed",
  cancel: "cancelled_by_venue",
};

/** Mirrors pg_reservation_transition_is_legal exactly. */
export function isTransitionLegal(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  switch (from) {
    case "requested":
      return ["confirmed", "cancelled_by_venue", "cancelled_by_guest"].includes(
        to,
      );
    case "confirmed":
      return [
        "seated",
        "no_show",
        "completed",
        "cancelled_by_venue",
        "cancelled_by_guest",
      ].includes(to);
    case "seated":
      return ["completed", "no_show", "cancelled_by_venue"].includes(to);
    case "waitlisted":
      return ["confirmed", "cancelled_by_venue", "cancelled_by_guest"].includes(
        to,
      );
    default:
      // completed / no_show / cancelled_* are terminal.
      return false;
  }
}

/** Which actions are legal from a status (for rendering the action buttons). */
export function legalActionsFor(
  status: ReservationStatus,
): ReservationAction[] {
  return (Object.keys(ACTION_TARGET) as ReservationAction[]).filter((a) =>
    isTransitionLegal(status, ACTION_TARGET[a]),
  );
}

/** Status pill presentation (color is NEVER the only signal — pairs label + glyph). */
export interface StatusPresentation {
  label: string;
  /** semantic token key the component maps to a color. */
  tone: "neutral" | "success" | "warm" | "muted" | "error" | "faded";
}

export const STATUS_PRESENTATION: Record<
  ReservationStatus,
  StatusPresentation
> = {
  requested: { label: "Pending", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "success" },
  seated: { label: "Seated", tone: "warm" },
  completed: { label: "Completed", tone: "muted" },
  no_show: { label: "No-show", tone: "error" },
  cancelled_by_guest: { label: "Canceled", tone: "faded" },
  cancelled_by_venue: { label: "Canceled", tone: "faded" },
  waitlisted: { label: "Waitlisted", tone: "neutral" },
};

/** The action button labels (Design IA §4.4). */
export const ACTION_LABEL: Record<ReservationAction, string> = {
  confirm: "Confirm",
  seat: "Mark seated",
  no_show: "Mark no-show",
  complete: "Mark completed",
  cancel: "Cancel",
};

/** Destructive actions require a reach + confirm (Design IA §4.4). */
export const DESTRUCTIVE_ACTIONS: readonly ReservationAction[] = [
  "no_show",
  "cancel",
];
