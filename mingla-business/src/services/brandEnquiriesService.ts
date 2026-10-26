/**
 * #4111 — Customer enquiries for the brand team (Host app, native + web).
 *
 * Every read and write is an RPC from 20271221014111: the tables refuse direct
 * client writes, and the team's access excludes scanner-only members and (D8)
 * Mingla staff unless the enquiry was reported.
 */

import { supabase } from "./supabase";
import { brandEnquiryErrorMessage } from "./brandEnquiryList";

// #4111 — the list read, its error copy and the conversation lookup live in
// brandEnquiryList.ts so the boot path (TopBar, Home) can use them without
// this file. Re-exported so callers keep one import.
export {
  brandEnquiryErrorMessage,
  findBrandEnquiryIdForConversation,
  listBrandEnquiries,
  normalizeBrandEnquiryList,
} from "./brandEnquiryList";

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

