// #4452 A1.8 — a booking's line in the lead drawer. Kept from the #4339
// Inbound leads row: the call time (struck through when cancelled or
// declined), the Google Calendar status with when it changed, "Was: <the
// booked time>" for a moved call, the city, social and website.
import { formatDateTime } from "../../lib/formatters";
import { CALL_STATUS_LABELS, callStatus, safeLink } from "../../lib/inboundLeads";

export function BookingLine({ booking }) {
  const status = callStatus(booking.status);
  const off = status === "cancelled" || status === "declined";
  const social = safeLink(booking.social_url, false);
  const website = safeLink(booking.website, true);
  const linkClass = "font-medium text-[var(--color-brand-700)] hover:underline";
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-secondary)]" data-booking-details="">
      {booking.call_at && <span className={off ? "line-through" : undefined}>Call: {formatDateTime(booking.call_at)}</span>}
      <span data-booking-status={status}>
        {CALL_STATUS_LABELS[status]}
        {status !== "booked" && booking.status_changed_at ? ` ${formatDateTime(booking.status_changed_at)}` : ""}
      </span>
      {booking.original_call_at && <span data-booking-original="">Was: {formatDateTime(booking.original_call_at)}</span>}
      {booking.city && <span>City: {booking.city}</span>}
      {social && <a href={social} target="_blank" rel="noopener noreferrer" className={linkClass} data-booking-social="">Social profile</a>}
      {website && <a href={website} target="_blank" rel="noopener noreferrer" className={linkClass} data-booking-website="">Website</a>}
    </div>
  );
}

