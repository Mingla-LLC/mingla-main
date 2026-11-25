/**
 * Profile → Purchases card: the "when" line for the next purchase. Pure (no
 * React Native) so the unit suite runs it directly.
 */
import type { PurchaseTimelineItem } from "../../utils/purchaseTimeline";

// #4490 W2-N21 — venue passes, plans and waitlist places read like the rest
// of the venue screens: the venue's 24-hour time, "Today" before 17:00, their
// own date line for a plan, and guests rather than tickets.
export const isVenueKind = (item: PurchaseTimelineItem): boolean =>
  item.kind === "venue_booking" || item.kind === "venue_membership" || item.kind === "venue_waitlist";

export function itemWhen(
  item: PurchaseTimelineItem,
  groupKey: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const date = new Date(item.startsAt);
  if (Number.isNaN(date.getTime())) return t("card.dateTbd");
  if (item.whenText) return item.whenText;
  const venue = isVenueKind(item);
  try {
    const time = new Intl.DateTimeFormat(venue ? "en-GB" : undefined, {
      hour: venue ? "2-digit" : "numeric",
      minute: "2-digit",
      ...(venue ? { hourCycle: "h23" as const } : {}),
      timeZone: item.timezone,
    }).format(date);
    if (groupKey === "tonight") return t("card.tonightAt", { time });
    if (venue && groupKey === "today") return t("card.todayAt", { time });
    // W2-N34: venue days are day-first ("Thu 26 Nov") like every venue
    // surface; other kinds keep the device's own order.
    const day = new Intl.DateTimeFormat(venue ? "en-GB" : undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: item.timezone,
    }).format(date);
    return `${day} · ${time}`;
  } catch {
    return date.toLocaleString();
  }
}
