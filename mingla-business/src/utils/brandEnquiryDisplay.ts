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

// #4111 — the badge and Home To-do rules live in brandEnquiryWaiting.ts, which
// TopBar and Home import without this file (boot payload). Re-exported here.
export {
  brandEnquiryAge,
  brandEnquiryNeedsReply,
  brandEnquiryThreadRoute,
  brandEnquiryTodos,
  messagesBadgeCount,
  type BrandEnquiryTodo,
} from "./brandEnquiryWaiting";

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
