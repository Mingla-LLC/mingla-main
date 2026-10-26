/**
 * #4111 — pure display rules for Customer enquiries in the Host app. No React,
 * no I/O, so every rule is provable in a unit test.
 */

import type {
  BrandEnquiryContext,
  BrandEnquiryCounts,
  BrandEnquiryStatus,
  BrandEnquirySummary,
} from "../services/brandEnquiriesService";

export type BrandEnquiryPillTone = "new" | "waiting" | "replied" | "resolved";

export interface BrandEnquiryPill {
  label: string;
  tone: BrandEnquiryPillTone;
}

export function brandEnquiryStatusPill(status: BrandEnquiryStatus): BrandEnquiryPill {
  switch (status) {
    case "new":
      return { label: "New", tone: "new" };
    case "waiting":
      return { label: "Waiting on you", tone: "waiting" };
    case "replied":
      return { label: "Replied", tone: "replied" };
    case "resolved":
      return { label: "Resolved", tone: "resolved" };
    default: {
      const unreachable: never = status;
      return { label: String(unreachable), tone: "resolved" };
    }
  }
}

/** "Ada Obi" → "AO"; "ada" → "A"; blank → "?". */
export function brandEnquiryInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/** "Web" | "App" | "Website" — the server's channel label, with a safe fallback. */
export function brandEnquiryChannel(source: string, channelLabel?: string | null): string {
  if (channelLabel === "Web" || channelLabel === "App" || channelLabel === "Website") return channelLabel;
  if (source === "site") return "Website";
  if (source === "web") return "Web";
  return "App";
}

/** "{Brand} · {topic} · Web|App|Website" */
export function brandEnquiryRowSubtitle(item: Pick<BrandEnquirySummary, "brand_name" | "topic_label" | "source" | "channel_label">): string {
  return [item.brand_name, item.topic_label, brandEnquiryChannel(item.source, item.channel_label)]
    .filter((part) => part.trim().length > 0)
    .join(" · ");
}

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

export interface BrandEnquiryContextOpen {
  label: string;
  route: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value: unknown): string | null => (typeof value === "string" && UUID_RE.test(value) ? value : null);

/**
 * Where "Open …" on the context card goes: always an existing Host route
 * (D7 — refunds stay on the order screen). Null hides the button.
 */
export function brandEnquiryContextOpen(context: BrandEnquiryContext | null | undefined): BrandEnquiryContextOpen | null {
  if (!context) return null;
  const contextId = id(context.id);
  const eventId = id(context.event_id);
  const venueId = id(context.venue_id);
  switch (context.kind) {
    case "order":
      return eventId && contextId ? { label: "Open order", route: `/event/${eventId}/orders/${contextId}` } : null;
    case "rsvp":
      return eventId ? { label: "Open booking", route: `/event/${eventId}/guests` } : null;
    case "reservation":
      return venueId ? { label: "Open reservations", route: `/venue/${venueId}?module=reservations` } : null;
    case "stay":
      return venueId ? { label: "Open booking", route: `/venue/${venueId}?module=reservations` } : null;
    case "venue_order":
      return venueId ? { label: "Open order", route: `/venue/${venueId}?module=orders` } : null;
    case "offering":
      if (context.offering_kind === "stay") return null;
      return contextId ? { label: "Open offering", route: `/event/${contextId}` } : null;
    case "venue":
      return contextId ? { label: "Open venue", route: `/venue/${contextId}` } : null;
    case "none":
      return null;
    default: {
      const unreachable: never = context.kind;
      void unreachable;
      return null;
    }
  }
}

/** The context card's summary line: "2 tickets · Sat 15 Nov". */
export function brandEnquiryContextSummary(context: BrandEnquiryContext | null | undefined, locale?: string): string {
  if (!context) return "";
  const parts: string[] = [];
  if (typeof context.summary === "string" && context.summary.trim()) parts.push(context.summary.trim());
  if (typeof context.starts_at === "string") {
    const when = new Date(context.starts_at);
    if (Number.isFinite(when.getTime())) {
      parts.push(when.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }));
    }
  }
  return parts.join(" · ");
}

/** "{Brand} · Web · Email confirmed" */
export function brandEnquiryThreadSubtitle(input: {
  brandName: string;
  source: string;
  channelLabel?: string | null;
  emailConfirmed: boolean;
}): string {
  return [
    input.brandName,
    brandEnquiryChannel(input.source, input.channelLabel),
    input.emailConfirmed ? "Email confirmed" : "Email not confirmed yet",
  ].join(" · ");
}

/** The contact line: email, and the phone only when the guest is OK with a call. */
export function brandEnquiryContactLine(guest: { email?: string; phone?: string | null; ok_to_call?: boolean }): string {
  const parts: string[] = [];
  if (guest.email) parts.push(guest.email);
  if (guest.ok_to_call === true && typeof guest.phone === "string" && guest.phone.trim()) {
    parts.push(guest.phone.trim(), "OK to call");
  }
  return parts.join(" · ");
}

/** The section title: "Customer enquiries · 2 waiting". */
export function brandEnquirySectionTitle(counts: Pick<BrandEnquiryCounts, "needs_reply">): string {
  return counts.needs_reply > 0 ? `Customer enquiries · ${counts.needs_reply} waiting` : "Customer enquiries";
}
