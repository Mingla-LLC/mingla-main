/**
 * #4111 — Customer enquiries for the brand team (Host app, native + web).
 *
 * Every read and write is an RPC from 20271221014111: the tables refuse direct
 * client writes, and the team's access excludes scanner-only members and (D8)
 * Mingla staff unless the enquiry was reported.
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

export interface BrandEnquiryContext {
  kind: BrandEnquiryContextKind;
  id?: string;
  title?: string | null;
  summary?: string | null;
  starts_at?: string | null;
  offering_kind?: string | null;
  event_id?: string | null;
  venue_id?: string | null;
}

export interface BrandEnquiryGuest {
  name: string;
  email?: string;
  email_confirmed?: boolean;
  /** Only present when the guest said it is OK to call. */
  phone?: string | null;
  ok_to_call?: boolean;
  has_account?: boolean;
}

export interface BrandEnquiryThreadMessage {
  id: string;
  who: "guest" | "brand" | "system";
  display: string;
  body: string;
  at: string;
  mine: boolean;
}

export interface BrandEnquiryThread {
  enquiry: {
    id: string;
    conversation_id: string;
    brand_id: string;
    brand_name: string;
    brand_slug: string;
    status: BrandEnquiryStatus;
    topic_label: string;
    reason: string;
    source: BrandEnquirySource;
    channel_label: string;
    context_kind: BrandEnquiryContextKind;
    context_id: string | null;
    context: BrandEnquiryContext | null;
    created_at: string;
    resolved_at: string | null;
    spam_flag: boolean;
    reported: boolean;
    guest: BrandEnquiryGuest;
  };
  messages: BrandEnquiryThreadMessage[];
}

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

export async function getBrandEnquiryThread(enquiryId: string): Promise<BrandEnquiryThread> {
  const { data, error } = await supabase.rpc("brand_enquiry_get_thread", {
    p_enquiry_id: enquiryId,
    p_limit: 200,
  });
  if (error) throw new Error(brandEnquiryErrorMessage(error, "Couldn't load this enquiry"));
  if (data == null) throw new Error("You don't have access to this enquiry.");
  const thread = data as BrandEnquiryThread;
  return { ...thread, messages: Array.isArray(thread.messages) ? thread.messages : [] };
}

export async function replyToBrandEnquiry(enquiryId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("brand_enquiry_reply", {
    p_enquiry_id: enquiryId,
    p_body: body,
  });
  if (error) throw new Error(brandEnquiryErrorMessage(error, "Your reply wasn't sent"));
  return String(data);
}

export async function setBrandEnquiryStatus(
  enquiryId: string,
  action: "resolve" | "reopen",
): Promise<BrandEnquiryStatus> {
  const { data, error } = await supabase.rpc("brand_enquiry_set_status", {
    p_enquiry_id: enquiryId,
    p_action: action,
  });
  if (error) throw new Error(brandEnquiryErrorMessage(error, "Couldn't update this enquiry"));
  return data as BrandEnquiryStatus;
}

export async function blockBrandEnquirySender(enquiryId: string): Promise<void> {
  const { error } = await supabase.rpc("brand_enquiry_block_sender", {
    p_enquiry_id: enquiryId,
  });
  if (error) throw new Error(brandEnquiryErrorMessage(error, "Couldn't block this sender"));
}

export async function reportBrandEnquiry(enquiryId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("brand_enquiry_report", {
    p_enquiry_id: enquiryId,
    p_reason: reason,
  });
  if (error) throw new Error(brandEnquiryErrorMessage(error, "Couldn't report this enquiry"));
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
