/**
 * #4111 Wave D (D6) — Likes → Calendar plan items → "Message {Brand}".
 *
 * PURE. Each calendar row kind maps to the brand to message and the sheet
 * prefill, so the sheet opens at step 2 with that plan already picked. The
 * context ids are the ones `brand_enquiry_send` validates against the caller
 * (orders.id, the RSVP id, reservations.id, stay_reservation_groups.id). A
 * plus-one's RSVP row is not theirs to attach, so it opens on the event as an
 * offering instead.
 */
import type { EnquiryPlan, EnquiryPrefill } from "@mingla/brand-rendering/enquiry/enquiryTopics";
import type { MyStayReservationGroup } from "@mingla/brand-rendering/stayGuest";

import type { MyReservationRow } from "../../hooks/useMyReservations";
import type { BusinessEventCalendarRow, ConsumerRsvpRow } from "../../services/calendarService";

export interface CalendarPlanMessageTarget {
  brandId: string | null;
  brandSlug: string | null;
  brandName: string;
  /**
   * #4490 W2-N23: the name the button and the sheet use instead of the brand's
   * ("Message {venue}" on a venue pass, plan or waitlist place). Unset for
   * every other plan, which keeps "Message {brand}".
   */
  displayName?: string;
  prefill: EnquiryPrefill;
}

const plan = (input: Omit<EnquiryPlan, "canCancelUrl" | "canRequestRefund"> & { canRequestRefund?: boolean }): EnquiryPlan => ({
  canCancelUrl: null,
  canRequestRefund: false,
  ...input,
});

const upcoming = (iso: string | null, nowMs: number): boolean => {
  if (iso === null) return true;
  const ms = Date.parse(iso);
  return !Number.isFinite(ms) || ms >= nowMs - 6 * 60 * 60 * 1000;
};

export function ticketOrderMessageTarget(row: BusinessEventCalendarRow, nowMs = Date.now()): CalendarPlanMessageTarget {
  const summary = row.ticketCountValid === 1 ? "1 ticket" : `${row.ticketCountValid} tickets`;
  return {
    brandId: null,
    brandSlug: row.brandSlug || null,
    brandName: row.brandName,
    prefill: {
      contextKind: "order",
      contextId: row.orderId,
      plan: plan({
        kind: "order",
        id: row.orderId,
        title: row.eventTitle,
        startsAt: row.masterDateUtc,
        summary,
        isUpcoming: upcoming(row.masterDateEndUtc ?? row.masterDateUtc, nowMs),
        canCancel: false,
      }),
    },
  };
}

export function rsvpMessageTarget(row: ConsumerRsvpRow, nowMs = Date.now()): CalendarPlanMessageTarget {
  const isUpcoming = upcoming(row.masterDateEndUtc ?? row.masterDateUtc, nowMs);
  if (row.role !== "primary") {
    return {
      brandId: row.brandId,
      brandSlug: null,
      brandName: row.brandName,
      prefill: {
        contextKind: "offering",
        contextId: row.eventId,
        offering: {
          id: row.eventId,
          title: row.eventTitle,
          kind: "rsvp",
          startsAt: row.masterDateUtc,
          endsAt: row.masterDateEndUtc,
          when: isUpcoming ? "upcoming" : "past",
        },
      },
    };
  }
  return {
    brandId: row.brandId,
    brandSlug: null,
    brandName: row.brandName,
    prefill: {
      contextKind: "rsvp",
      contextId: row.rsvpId,
      plan: plan({
        kind: "rsvp",
        id: row.rsvpId,
        title: row.eventTitle,
        startsAt: row.masterDateUtc,
        summary: "RSVP",
        isUpcoming,
        canCancel: false,
      }),
    },
  };
}

const CANCELLABLE_RESERVATION = new Set(["requested", "confirmed", "waitlisted"]);

export function reservationMessageTarget(row: MyReservationRow, nowMs = Date.now()): CalendarPlanMessageTarget {
  const startMs = Date.parse(row.reserved_for);
  const inFuture = Number.isFinite(startMs) && startMs > nowMs;
  const brandName = row.brand_name?.trim() || "this venue";
  return {
    brandId: row.brand_id,
    brandSlug: null,
    brandName,
    prefill: {
      contextKind: "reservation",
      contextId: row.id,
      plan: plan({
        kind: "reservation",
        id: row.id,
        title: row.brand_name?.trim() || "Table reservation",
        startsAt: row.reserved_for,
        summary: `Table for ${row.party_size}`,
        isUpcoming: upcoming(row.reserved_for, nowMs),
        canCancel: CANCELLABLE_RESERVATION.has(row.status) && inFuture,
      }),
    },
  };
}

export function stayMessageTarget(group: MyStayReservationGroup, nowMs = Date.now()): CalendarPlanMessageTarget {
  const first = group.lines[0];
  const startsAt = first?.roomCheckIn ?? first?.placeStartsAt ?? null;
  return {
    brandId: group.brandId,
    brandSlug: group.brandSlug || null,
    brandName: group.brandName,
    prefill: {
      contextKind: "stay",
      contextId: group.groupId,
      plan: plan({
        kind: "stay",
        id: group.groupId,
        title: first?.name?.trim() || group.venueName || "Stay",
        startsAt,
        summary: `Stay · ${group.publicReference}`,
        isUpcoming: upcoming(startsAt, nowMs),
        canCancel: false,
      }),
    },
  };
}

/**
 * #4473 — what a Calendar plan row may offer in its "Message {Brand}" control.
 * A booking shared with this account carries a venue id but no brand id, and
 * is not this account's to cancel: it gets no message control at all (so no
 * Cancel inside it). Every other row keeps its target; only the account's own
 * bookings may cancel from the sheet.
 */
export type CalendarPlanMessageRow =
  | { kind: "calendar" }
  | { kind: "reservation"; reservation: MyReservationRow }
  | { kind: "stay"; group: MyStayReservationGroup }
  | { kind: "rsvp"; rsvp: ConsumerRsvpRow }
  | { kind: "ticket"; row: BusinessEventCalendarRow };

export function calendarPlanMessageControl(
  row: CalendarPlanMessageRow | null,
  nowMs = Date.now(),
): { target: CalendarPlanMessageTarget; allowCancel: boolean } | null {
  if (row === null || row.kind === "calendar") return null;
  if (row.kind === "reservation") {
    if (row.reservation.shared) return null;
    return { target: reservationMessageTarget(row.reservation, nowMs), allowCancel: true };
  }
  if (row.kind === "stay") return { target: stayMessageTarget(row.group, nowMs), allowCancel: false };
  if (row.kind === "rsvp") return { target: rsvpMessageTarget(row.rsvp, nowMs), allowCancel: false };
  return { target: ticketOrderMessageTarget(row.row, nowMs), allowCancel: false };
}
