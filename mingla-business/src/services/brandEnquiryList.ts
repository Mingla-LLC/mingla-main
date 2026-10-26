/**
 * #4111 — the small, eager half of Customer enquiries: the list read behind the
 * Messages badge and Home's To-do, and the conversation → enquiry lookup.
 *
 * WHY A SEPARATE FILE. TopBar and Home load on every business-web visit, so
 * whatever they import lands in the boot chunk (`__common`). This file holds
 * only what those need; replies, status changes, blocks, reports and the
 * thread read stay in brandEnquiriesService.ts, which only the lazily loaded
 * enquiry screens import. Keep it that way: do not import display or
 * service code here.
 */

import { supabase } from "./supabase";

export type BrandEnquiryStatus = "new" | "waiting" | "replied" | "resolved";
export type BrandEnquirySource = "web" | "explorer" | "site";
export type BrandEnquiryContextKind =
  | "order"
  | "rsvp"
  | "reservation"
  | "stay"
  | "venue_order"
  | "offering"
  | "venue"
  | "none";

export interface BrandEnquirySummary {
  id: string;
  conversation_id: string;
  brand_id: string;
  brand_name: string;
  brand_slug: string;
  brand_photo_url: string | null;
  status: BrandEnquiryStatus;
  source: BrandEnquirySource;
  channel_label: string;
  guest_name: string;
  topic_label: string;
  reason: string;
  context_kind: BrandEnquiryContextKind;
  context_id: string | null;
  spam_flag: boolean;
  email_confirmed: boolean;
  created_at: string;
  last_guest_at: string;
  last_brand_at: string | null;
  last_message_preview: string | null;
}

export interface BrandEnquiryCounts {
  new: number;
  waiting: number;
  replied: number;
  resolved: number;
  /** new + waiting, excluding possible spam. */
  needs_reply: number;
}

export interface BrandEnquiryList {
  items: BrandEnquirySummary[];
  counts: BrandEnquiryCounts;
}

export type BrandEnquiryListFilter = "open" | "resolved";

const EMPTY_COUNTS: BrandEnquiryCounts = {
  new: 0,
  waiting: 0,
  replied: 0,
  resolved: 0,
  needs_reply: 0,
};

/** Server error codes → what the host reads. Unknown codes keep their text. */
export function brandEnquiryErrorMessage(error: { message?: string } | null | undefined, fallback: string): string {
  const code = error?.message ?? "";
  switch (code) {
    case "enquiry_unavailable":
    case "forbidden":
      return "You don't have access to this enquiry.";
    case "invalid_message":
      return "Write a reply of up to 2,000 characters.";
    case "report_reason_required":
      return "Choose why you are reporting this enquiry.";
    case "authentication_required":
      return "Sign in again to continue.";
    default:
      return code || fallback;
  }
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function normalizeBrandEnquiryList(raw: unknown): BrandEnquiryList {
  const record = (raw ?? {}) as { items?: unknown; counts?: Record<string, unknown> };
  const items = Array.isArray(record.items) ? (record.items as BrandEnquirySummary[]) : [];
  const counts = record.counts ?? {};
  return {
    items,
    counts: {
      new: count(counts.new),
      waiting: count(counts.waiting),
      replied: count(counts.replied),
      resolved: count(counts.resolved),
      needs_reply: count(counts.needs_reply),
    },
  };
}

/** All of the caller's brands (scanner-only brands are left out by the server). */
export async function listBrandEnquiries(filter: BrandEnquiryListFilter): Promise<BrandEnquiryList> {
  const { data, error } = await supabase.rpc("list_brand_enquiries", {
    p_brand_id: null,
    p_status_filter: filter,
  });
  if (error) throw new Error(brandEnquiryErrorMessage(error, "Couldn't load customer enquiries"));
  return data == null ? { items: [], counts: { ...EMPTY_COUNTS } } : normalizeBrandEnquiryList(data);
}

/**
 * The enquiry behind a conversation id, or null when the conversation is not
 * an enquiry the caller can read (a Brand group, or no access). Push and the
 * nudge email link to /messages/{conversationId}.
 */
export async function findBrandEnquiryIdForConversation(conversationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("brand_enquiries")
    .select("id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw new Error(brandEnquiryErrorMessage(error, "Couldn't open this conversation"));
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}
