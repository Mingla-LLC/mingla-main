/**
 * #4111 — the Messages badge and Home To-do rules for Customer enquiries.
 *
 * TopBar and Home run on every business-web visit, so this file is in the boot
 * chunk. It holds only those rules and imports types alone; the rest of the
 * display copy is in brandEnquiryDisplay.ts, loaded with the enquiry screens.
 */

import type {
  BrandEnquiryCounts,
  BrandEnquirySummary,
} from "../services/brandEnquiriesService";

/** Enquiries that wait on the team: new or waiting, never possible spam. */
export function brandEnquiryNeedsReply(item: Pick<BrandEnquirySummary, "status" | "spam_flag">): boolean {
  return (item.status === "new" || item.status === "waiting") && !item.spam_flag;
}

/**
 * The speech-bubble badge (D4): Brand-group unread plus enquiries in
 * new|waiting. Enquiry cards in the Brand group are not unread messages
 * (20271223004111), so one enquiry is never counted twice.
 */
export function messagesBadgeCount(brandGroupUnread: number, counts: Pick<BrandEnquiryCounts, "needs_reply"> | null | undefined): number {
  const groups = Number.isFinite(brandGroupUnread) && brandGroupUnread > 0 ? Math.floor(brandGroupUnread) : 0;
  const enquiries = counts && Number.isFinite(counts.needs_reply) && counts.needs_reply > 0 ? Math.floor(counts.needs_reply) : 0;
  return groups + enquiries;
}

/** "now", "5m", "2h", "1d", "3w" — how long the guest has been waiting. */
export function brandEnquiryAge(fromIso: string, now: Date = new Date()): string {
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - from) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export interface BrandEnquiryTodo {
  id: string;
  label: string;
  sublabel: string;
  route: string;
}

export function brandEnquiryThreadRoute(enquiryId: string): string {
  return `/messages/enquiry/${enquiryId}`;
}

/** Home To-do (D4): one row per enquiry waiting on the team, oldest first. */
export function brandEnquiryTodos(items: readonly BrandEnquirySummary[], now: Date = new Date()): BrandEnquiryTodo[] {
  return items
    .filter(brandEnquiryNeedsReply)
    .slice()
    .sort((left, right) => left.last_guest_at.localeCompare(right.last_guest_at))
    .map((item) => {
      const age = brandEnquiryAge(item.last_guest_at, now);
      return {
        id: `brand_enquiry_${item.id}`,
        label: `Reply to ${item.guest_name}`,
        sublabel: ["Customer enquiry", item.topic_label, age].filter((part) => part.length > 0).join(" · "),
        route: brandEnquiryThreadRoute(item.id),
      };
    });
}
