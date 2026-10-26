/**
 * #4111 Wave D — Explorer's transport for brand enquiries ("Message {Brand}").
 *
 *   brand_enquiry_public_profile      (RPC)  Message on/off + "Usually replies within …"
 *   brand_enquiry_my_plans            (RPC)  "Your plans with {Brand}"
 *   brand_enquiry_send                (RPC)  send, p_source 'explorer' (never anonymous)
 *   brand_enquiry_get_thread          (RPC)  the guest's view of one thread
 *   brand_enquiry_guest_reply         (RPC)  write again (reopens a resolved thread)
 *   brand_enquiry_report              (RPC)  the guest reports the thread
 *   claim_brand_enquiries_for_user    (RPC)  after email sign-in: web enquiries → this account
 *   claim_brand_subscriptions_for_user(RPC)  after email sign-in: newsletter → follow
 *
 * Shapes: supabase/migrations/20271221014111_issue_4111_brand_enquiry_rpcs.sql
 * and 20271222004111_issue_4111_enquiry_notifications_and_subscribe.sql.
 *
 * The chat list reads `brand_enquiries` (RLS: a guest reads only their own
 * rows) plus the brand's public identity and the thread's messages. Enquiry
 * conversations never come through messagingService.getConversations: its
 * access list excludes them, so they can never render twice.
 *
 * Services throw on failure (Constitution #3); hooks surface it.
 */
import {
  enquiryPlansFromRows,
} from "@mingla/brand-rendering/enquiry/enquiryPageData";
import type {
  EnquiryPlan,
  EnquirySendOutcome,
  EnquirySendRequest,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";

import { supabase } from "./supabase";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const SEND_FAILED = "We couldn't send that. Check your connection and try again.";

/** Server error codes → copy the guest reads. */
const ERROR_COPY: Record<string, string> = {
  enquiry_rate_limited: "You've sent a few messages already. Try again later.",
  enquiries_unavailable: "This brand isn't taking messages right now.",
  verified_email_required: "Add and confirm an email address in your account, then try again.",
  invalid_context: "That booking can't be attached. Pick another topic.",
  invalid_reason: "Pick what you need, then send again.",
  invalid_message: "Write a message of up to 2,000 characters.",
  enquiry_unavailable: "This conversation isn't available any more.",
  report_reason_required: "Choose why you're reporting this conversation.",
  authentication_required: "Sign in again to continue.",
};

/** The guest-facing copy for a failed enquiry call. Unknown codes get `fallback`. */
export function brandEnquiryErrorCopy(error: unknown, fallback: string): string {
  const message = isRecord(error) && typeof error.message === "string"
    ? error.message
    : error instanceof Error
      ? error.message
      : "";
  const code = Object.keys(ERROR_COPY).find((key) => message.includes(key));
  return code === undefined ? fallback : ERROR_COPY[code];
}

// ── Message card ─────────────────────────────────────────────────────────────

export interface BrandEnquiryProfile {
  available: boolean;
  replyMinutes: number | null;
}

export function parseBrandEnquiryProfile(value: unknown): BrandEnquiryProfile {
  if (!isRecord(value)) throw new Error("brand_enquiry_profile_malformed");
  const minutes = value.reply_minutes;
  return {
    available: value.available === true,
    replyMinutes:
      typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
        ? Math.round(minutes)
        : null,
  };
}

export async function fetchBrandEnquiryProfile(brandId: string): Promise<BrandEnquiryProfile> {
  const { data, error } = await supabase.rpc("brand_enquiry_public_profile", {
    p_brand_id: brandId,
  });
  if (error) throw error;
  return parseBrandEnquiryProfile(data);
}

// ── Plans + send ─────────────────────────────────────────────────────────────

export async function fetchMyBrandPlans(brandId: string): Promise<EnquiryPlan[]> {
  const { data, error } = await supabase.rpc("brand_enquiry_my_plans", {
    p_brand_id: brandId,
  });
  if (error) throw error;
  return enquiryPlansFromRows(data);
}

/** The exact `brand_enquiry_send` arguments for a sheet request. Explorer never sends a guest block. */
export function brandEnquirySendArgs(
  brandId: string,
  request: EnquirySendRequest,
): Record<string, string | null> {
  return {
    p_brand_id: brandId,
    p_entry: request.entry,
    p_context_kind: request.contextKind,
    p_context_id: request.contextKind === "none" ? null : request.contextId,
    p_reason: request.reason,
    p_body: request.body,
    p_source: "explorer",
  };
}

export interface ExplorerEnquirySendResult {
  outcome: EnquirySendOutcome;
  /** brand_enquiries.id — the thread route's param. Null when the send failed. */
  enquiryId: string | null;
}

export async function sendExplorerEnquiry(
  brandId: string,
  request: EnquirySendRequest,
): Promise<ExplorerEnquirySendResult> {
  const { data, error } = await supabase.rpc(
    "brand_enquiry_send",
    brandEnquirySendArgs(brandId, request),
  );
  if (error) {
    return { outcome: { ok: false, message: brandEnquiryErrorCopy(error, SEND_FAILED) }, enquiryId: null };
  }
  const conversationId = isRecord(data) ? str(data.conversation_id) : null;
  const enquiryId = isRecord(data) ? str(data.enquiry_id) : null;
  if (enquiryId === null) {
    return { outcome: { ok: false, message: SEND_FAILED }, enquiryId: null };
  }
  return {
    outcome: { ok: true, email: null, threadUrl: null, conversationId },
    enquiryId,
  };
}

// ── Thread ───────────────────────────────────────────────────────────────────

export type EnquiryStatus = "new" | "waiting" | "replied" | "resolved";

export interface EnquiryThreadMessage {
  id: string;
  who: "guest" | "brand" | "system";
  /** Brand replies carry "{first} at {Brand}". */
  display: string;
  body: string;
  at: string | null;
  mine: boolean;
}

export interface EnquiryThreadContext {
  kind: string;
  title: string | null;
  summary: string | null;
  startsAt: string | null;
}

export interface EnquiryThread {
  id: string;
  conversationId: string;
  brandId: string;
  brandName: string;
  brandSlug: string | null;
  brandLogoUrl: string | null;
  brandAccent: string | null;
  status: EnquiryStatus;
  topicLabel: string | null;
  context: EnquiryThreadContext | null;
  reported: boolean;
  messages: EnquiryThreadMessage[];
}

const STATUSES: ReadonlySet<string> = new Set(["new", "waiting", "replied", "resolved"]);

export function parseEnquiryThread(value: unknown): EnquiryThread {
  if (!isRecord(value) || !isRecord(value.enquiry)) throw new Error("enquiry_thread_malformed");
  const e = value.enquiry;
  const id = str(e.id);
  const conversationId = str(e.conversation_id);
  const brandId = str(e.brand_id);
  if (id === null || conversationId === null || brandId === null) {
    throw new Error("enquiry_thread_malformed");
  }
  const rawContext = isRecord(e.context) ? e.context : null;
  const messages = Array.isArray(value.messages) ? value.messages : [];
  return {
    id,
    conversationId,
    brandId,
    brandName: str(e.brand_name) ?? "the brand",
    brandSlug: str(e.brand_slug),
    brandLogoUrl: str(e.brand_logo_url),
    brandAccent: str(e.brand_accent),
    status: typeof e.status === "string" && STATUSES.has(e.status) ? (e.status as EnquiryStatus) : "new",
    topicLabel: str(e.topic_label),
    context:
      rawContext === null
        ? null
        : {
            kind: str(rawContext.kind) ?? "none",
            title: str(rawContext.title),
            summary: str(rawContext.summary),
            startsAt: str(rawContext.starts_at),
          },
    reported: e.reported === true,
    messages: messages.filter(isRecord).map((m, index) => ({
      id: str(m.id) ?? `message-${index}`,
      who: m.who === "guest" || m.who === "system" ? m.who : "brand",
      display: typeof m.display === "string" ? m.display : "",
      body: typeof m.body === "string" ? m.body : "",
      at: str(m.at),
      mine: m.mine === true,
    })),
  };
}

export async function fetchEnquiryThread(enquiryId: string): Promise<EnquiryThread> {
  const { data, error } = await supabase.rpc("brand_enquiry_get_thread", {
    p_enquiry_id: enquiryId,
    p_limit: 200,
  });
  if (error) throw new Error(brandEnquiryErrorCopy(error, "We couldn't load this conversation."));
  return parseEnquiryThread(data);
}

export async function sendEnquiryGuestReply(enquiryId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("brand_enquiry_guest_reply", {
    p_enquiry_id: enquiryId,
    p_body: body,
  });
  if (error) throw new Error(brandEnquiryErrorCopy(error, "Your message wasn't sent. Try again."));
  return String(data);
}

export async function reportEnquiry(enquiryId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("brand_enquiry_report", {
    p_enquiry_id: enquiryId,
    p_reason: reason,
  });
  if (error) throw new Error(brandEnquiryErrorCopy(error, "We couldn't send your report. Try again."));
}

/** Brand messages the guest has not read yet (message_reads, own rows only). */
export async function markEnquiryMessagesRead(userId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const { error } = await supabase
    .from("message_reads")
    .upsert(
      messageIds.map((messageId) => ({ message_id: messageId, user_id: userId })),
      { onConflict: "message_id,user_id" },
    );
  if (error) throw error;
}

// ── After email sign-in ──────────────────────────────────────────────────────

export interface BrandContactClaim {
  enquiries: number;
  subscriptions: number;
}

const claimedCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * Attach web enquiries and newsletter sign-ups made with this account's
 * verified email. Both RPCs are idempotent; both run, and a failure of either
 * is thrown so the caller can retry later.
 */
export async function claimBrandContactForUser(): Promise<BrandContactClaim> {
  const [enquiries, subscriptions] = await Promise.all([
    supabase.rpc("claim_brand_enquiries_for_user"),
    supabase.rpc("claim_brand_subscriptions_for_user"),
  ]);
  if (enquiries.error) throw enquiries.error;
  if (subscriptions.error) throw subscriptions.error;
  return {
    enquiries: claimedCount(enquiries.data),
    subscriptions: claimedCount(subscriptions.data),
  };
}

// ── Brand identity (Likes → Calendar opens the sheet from a plan row) ────────

export interface BrandIdentity {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  theme: { color: string | null; font: string | null; animation: string | null };
}

export async function fetchBrandIdentity(
  ref: { brandId?: string | null; brandSlug?: string | null },
): Promise<BrandIdentity | null> {
  const byId = str(ref.brandId ?? null);
  const bySlug = str(ref.brandSlug ?? null);
  if (byId === null && bySlug === null) return null;
  const query = supabase
    .from("business_public_brands_view")
    .select("id, name, slug, profile_photo_url, theme_color, theme_font, theme_animation");
  const { data, error } = await (byId !== null ? query.eq("id", byId) : query.eq("slug", bySlug as string))
    .maybeSingle();
  if (error) throw error;
  if (!isRecord(data) || typeof data.id !== "string" || typeof data.name !== "string") return null;
  const color = str(data.theme_color);
  const font = str(data.theme_font);
  const animation = str(data.theme_animation);
  return {
    id: data.id,
    name: data.name,
    slug: str(data.slug),
    logoUrl: str(data.profile_photo_url),
    theme: { color, font, animation },
  };
}

// ── Chat list ────────────────────────────────────────────────────────────────

export interface MyEnquiryRow {
  enquiryId: string;
  conversationId: string;
  brandId: string;
  brandName: string;
  brandSlug: string | null;
  brandLogoUrl: string | null;
  status: EnquiryStatus;
  topicLabel: string | null;
  createdAt: string;
  lastActivityAt: string;
  lastMessage: {
    id: string;
    body: string;
    at: string;
    fromBrand: boolean;
  } | null;
  unreadCount: number;
}

interface RawEnquiry {
  id: string;
  brand_id: string;
  conversation_id: string;
  status: string;
  topic_label: string | null;
  created_at: string;
  last_guest_at: string | null;
  last_brand_at: string | null;
}

interface RawBrand {
  id: string;
  name: string;
  slug: string | null;
  profile_photo_url: string | null;
}

interface RawMessage {
  id: string;
  conversation_id: string;
  content: string | null;
  sender_kind: string | null;
  created_at: string;
  message_reads?: { user_id: string }[] | null;
}

const latest = (...values: (string | null | undefined)[]): string => {
  let best = "";
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (typeof value !== "string") continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
};

/**
 * PURE — one chat-list row per enquiry. Never merged with any other chat
 * (enquiries are ALWAYS separate rows). Unread = brand messages without the
 * guest's own read receipt.
 */
export function buildMyEnquiryRows(
  userId: string,
  enquiries: readonly RawEnquiry[],
  brands: readonly RawBrand[],
  messages: readonly RawMessage[],
): MyEnquiryRow[] {
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const byConversation = new Map<string, RawMessage[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversation_id) ?? [];
    list.push(message);
    byConversation.set(message.conversation_id, list);
  }
  return enquiries
    .map((enquiry): MyEnquiryRow => {
      const brand = brandById.get(enquiry.brand_id);
      const thread = (byConversation.get(enquiry.conversation_id) ?? [])
        .filter((m) => m.sender_kind !== "system")
        .slice()
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
      const last = thread[0] ?? null;
      const unreadCount = thread.filter(
        (m) => m.sender_kind === "brand" && !(m.message_reads ?? []).some((r) => r.user_id === userId),
      ).length;
      return {
        enquiryId: enquiry.id,
        conversationId: enquiry.conversation_id,
        brandId: enquiry.brand_id,
        brandName: brand?.name?.trim() || "Brand",
        brandSlug: brand?.slug ?? null,
        brandLogoUrl: brand?.profile_photo_url ?? null,
        status: STATUSES.has(enquiry.status) ? (enquiry.status as EnquiryStatus) : "new",
        topicLabel: enquiry.topic_label,
        createdAt: enquiry.created_at,
        lastActivityAt: latest(last?.created_at, enquiry.last_brand_at, enquiry.last_guest_at, enquiry.created_at),
        lastMessage:
          last === null
            ? null
            : { id: last.id, body: last.content ?? "", at: last.created_at, fromBrand: last.sender_kind === "brand" },
        unreadCount,
      };
    })
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || a.enquiryId.localeCompare(b.enquiryId));
}

/** The guest's own enquiries (RLS: guest_user_id = auth.uid()). Two round trips. */
export async function listMyEnquiries(userId: string): Promise<MyEnquiryRow[]> {
  const { data: enquiryData, error: enquiryError } = await supabase
    .from("brand_enquiries")
    .select("id, brand_id, conversation_id, status, topic_label, created_at, last_guest_at, last_brand_at")
    .eq("guest_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (enquiryError) throw enquiryError;
  const enquiries = (enquiryData ?? []) as RawEnquiry[];
  if (enquiries.length === 0) return [];

  const brandIds = Array.from(new Set(enquiries.map((e) => e.brand_id)));
  const conversationIds = enquiries.map((e) => e.conversation_id);
  const [brandResult, messageResult] = await Promise.all([
    supabase
      .from("business_public_brands_view")
      .select("id, name, slug, profile_photo_url")
      .in("id", brandIds),
    supabase
      .from("messages")
      .select("id, conversation_id, content, sender_kind, created_at, message_reads(user_id)")
      .in("conversation_id", conversationIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (brandResult.error) throw brandResult.error;
  if (messageResult.error) throw messageResult.error;
  return buildMyEnquiryRows(
    userId,
    enquiries,
    (brandResult.data ?? []) as RawBrand[],
    (messageResult.data ?? []) as RawMessage[],
  );
}
