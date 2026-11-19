// #4490 P2-7 — Admin venue offers (entry and later kinds): the list's words.
// Pure: no React, no network, so it runs under `node --test`.
//
// `admin_list_venue_offers` lists every venue offer across venues (admin
// only). Pause / resume go through `issue_4490_admin_set_offer_status`, which
// requires a reason (3–500 characters) and writes admin_audit_log.

export const VENUE_OFFER_STATUS = {
  live: { label: "On sale", variant: "success" },
  paused: { label: "Paused", variant: "warning" },
  draft: { label: "Draft", variant: "default" },
  archived: { label: "Archived", variant: "default" },
};

export const VENUE_OFFER_KIND_LABELS = {
  entry: "Entry",
  group_package: "Group package",
  private_hire: "Private hire",
  by_the_hour: "By the hour",
  // #4490 P6 — each monthly plan owns a hidden offering; it is run from the
  // venue's Members (plans), not paused here.
  membership: "Membership plan",
};

const ENTRY_STYLE_LABELS = { walk_in: "Walk-in", day_pass: "Day pass", timed_session: "Timed session" };

export function venueOfferStatus(status) {
  return VENUE_OFFER_STATUS[status] ?? { label: "Unknown", variant: "default" };
}

export function venueOfferKindLabel(kind, entryStyle) {
  const kindLabel = VENUE_OFFER_KIND_LABELS[kind] ?? "Venue offer";
  const style = ENTRY_STYLE_LABELS[entryStyle];
  return kind === "entry" && style ? `${kindLabel} · ${style}` : kindLabel;
}

/** "₦4,000" from minor units; "No price yet" when there is none. */
export function venueOfferFromPrice(fromMinor, currency) {
  if (typeof fromMinor !== "number" || !Number.isFinite(fromMinor)) return "No price yet";
  const code = typeof currency === "string" && currency.length === 3 ? currency : "NGN";
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
      .maximumFractionDigits;
    const whole = fromMinor % 10 ** digits === 0;
    return `from ${new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: whole ? 0 : digits,
    }).format(fromMinor / 10 ** digits)}`;
  } catch {
    return `from ${(fromMinor / 100).toFixed(2)} ${code}`;
  }
}

/** The one moderation action a row offers: pause a live offer, resume a paused one. */
export function venueOfferAction(row) {
  // A membership plan's offering is managed with its plan (Members › Plans).
  if (row?.kind === "membership") return null;
  if (row?.status === "live") return { kind: "pause", label: "Pause", next: "paused" };
  if (row?.status === "paused") return { kind: "resume", label: "Resume", next: "live" };
  return null;
}

const READINESS_WORDS = {
  feature_off: "the venue has switched this feature off",
  no_price_option: "it has no price",
  no_policy: "it has no refund rules",
  no_schedule: "it has no days on sale",
  no_day_limit: "it has no day limit",
  guest_max_over_capacity: "a price allows more guests than the day limit",
  no_spaces: "it has no spaces",
};

/** Plain words for an RPC failure (never the raw code). */
export function venueOfferAdminError(message) {
  const text = typeof message === "string" ? message : "";
  if (text.includes("not_authorized")) return "Active Admin access is required.";
  if (text.includes("invalid_payload")) return "Add a reason of at least 3 characters.";
  if (text.includes("offer_not_found")) return "This offer no longer exists. Reload the list.";
  const ready = /offer_not_ready:([a-z_]+)/.exec(text);
  if (ready) {
    return `It can't go back on sale yet: ${READINESS_WORDS[ready[1]] ?? "the host has something to finish first"}.`;
  }
  return "That didn't save. Try again.";
}

// ---------------------------------------------------------------------------
// #4490 P4-3 — request disputes: one venue booking (private hire included).
// ---------------------------------------------------------------------------

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The booking id from a pasted guest link (`…/visit/<id>#t=…`) or a bare id; null otherwise. */
export function bookingIdFromInput(text) {
  if (typeof text !== "string") return null;
  const match = UUID.exec(text.trim());
  return match ? match[0].toLowerCase() : null;
}

export const BOOKING_STATE_LABELS = {
  request_pending: { label: "Request to answer", variant: "info" },
  approved_payment_required: { label: "Approved · waiting for deposit", variant: "warning" },
  instant_payment_pending: { label: "Paying now", variant: "warning" },
  finalizing: { label: "Confirming payment", variant: "warning" },
  confirmed: { label: "Confirmed", variant: "success" },
  partially_cancelled: { label: "Part cancelled", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "default" },
  declined: { label: "Declined", variant: "default" },
  request_expired: { label: "Closed", variant: "default" },
  reconciliation_required: { label: "Needs checking", variant: "error" },
};

export function bookingStateLabel(state) {
  return BOOKING_STATE_LABELS[state] ?? { label: "Unknown", variant: "default" };
}

const TIMELINE_WORDS = {
  stay_offer_request_created: "Guest asked",
  stay_offer_request_approved: "Venue approved and sent a quote",
  stay_offer_request_declined: "Venue declined",
  stay_offer_request_queued: "Put next in line",
  stay_offer_request_released: "Next in line: the space freed up",
  stay_offer_hold_extended: "Venue gave more time to pay",
  stay_offer_hold_released: "Venue released the hold",
  stay_offer_request_withdrawn: "Guest withdrew",
  stay_offer_hold_force_expired: "Admin ended the hold",
  stay_offer_hold_created: "Booked, waiting for payment",
  stay_payment_prepared: "Payment page opened",
  stay_reservation_confirmed: "Confirmed",
  stay_offer_balance_paid: "Balance paid",
  stay_offer_balance_due: "Payment reminder sent",
  stay_reservation_cancelled: "Cancelled",
  stay_refund_submitted: "Refund sent",
  stay_refund_succeeded: "Refund completed",
  stay_hold_expired: "Hold ran out",
  stay_request_expired: "Request timed out",
};

/** "Venue declined (by staff)" etc.; unknown events read as plain words, never the raw key. */
export function timelineLabel(type, actorType) {
  const words =
    TIMELINE_WORDS[type] ??
    String(type || "event")
      .replace(/^stay_(offer_)?/, "")
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
  const by = actorType === "admin" ? "admin" : actorType === "staff" ? "venue" : actorType === "guest" ? "guest" : null;
  return by ? `${words} · ${by}` : words;
}

/** Plain words for a refund ladder saved on the booking. */
export function ladderWords(ladder) {
  if (!Array.isArray(ladder) || ladder.length === 0) return "No refunds";
  return [...ladder]
    .map((r) => ({
      mins: Number(r?.minMinutesBefore ?? r?.min_minutes_before ?? 0),
      bps: Number(r?.refundBps ?? r?.refund_bps ?? 0),
    }))
    .sort((a, b) => b.mins - a.mins)
    .map(({ mins, bps }) => {
      const back = bps >= 10000 ? "Full refund" : bps <= 0 ? "No refund" : `${bps / 100}% back`;
      if (mins <= 0) return `${back} until it starts`;
      const days = mins / 1440;
      return `${back} up to ${Number.isInteger(days) ? `${days} ${days === 1 ? "day" : "days"}` : `${Math.round(mins / 60)} hours`} before`;
    })
    .join(", then ");
}

/** Force-expiring a hold is possible only before any payment. */
export function canForceExpire(booking) {
  return Boolean(booking) && (booking.state === "request_pending" || booking.state === "approved_payment_required");
}

/** Plain words for the dispute view's RPC failures. */
export function bookingAdminError(message) {
  const text = typeof message === "string" ? message : "";
  if (text.includes("not_authorized")) return "Active Admin access is required.";
  if (text.includes("offer_booking_not_found")) return "No venue booking has that id. Paste the guest's booking link or the booking id.";
  if (text.includes("invalid_payload")) return "Add a reason of at least 3 characters.";
  if (text.includes("offer_invalid_transition")) return "This booking isn't waiting on a request or a deposit any more. Reload it.";
  if (text.includes("offer_payment_already_pending")) return "A payment was started on this booking, so the hold can't be ended here. Check the payments below.";
  return "That didn't load. Try again.";
}
