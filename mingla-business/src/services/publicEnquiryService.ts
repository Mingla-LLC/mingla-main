/**
 * #4111 — the buyer-side transport for brand enquiries and "Stay in the loop".
 *
 *   brand_enquiry_public_profile  (RPC, anon)   Message card on/off + reply time
 *   brand_enquiry_my_plans        (RPC, auth)   "Your plans with {Brand}"
 *   brand_enquiry_send            (RPC, auth)   signed-in web sends (source 'web')
 *   public-brand-enquiry          (edge, anon)  signed-out web sends
 *   public-brand-subscribe        (edge, anon)  "Stay in the loop"
 *   public-enquiry-thread         (edge, anon)  the /m/{token} guest thread
 *
 * Request/response shapes: the header comments of each edge function's
 * handler.ts and supabase/migrations/20271221014111_issue_4111_brand_enquiry_rpcs.sql.
 *
 * Supabase is loaded only when a call runs, so importing this module never
 * puts the client on a page's eager graph.
 */
import {
  enquiryPlansFromRows,
} from "@mingla/brand-rendering/enquiry/enquiryPageData";
import type {
  EnquiryPlan,
  EnquirySendOutcome,
  EnquirySendRequest,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";

const getSupabase = async (): Promise<typeof import("./supabase").supabase> =>
  (await import("./supabase")).supabase;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

const SEND_FAILED = "We couldn't send that. Check your connection and try again.";

/** Status + JSON body of a functions.invoke failure, when the server answered. */
const readFunctionError = async (
  error: unknown,
): Promise<{ status: number | null; body: Record<string, unknown> | null }> => {
  if (!isRecord(error)) return { status: null, body: null };
  const context = error.context;
  if (!isRecord(context)) return { status: null, body: null };
  const status = typeof context.status === "number" ? context.status : null;
  let body: Record<string, unknown> | null = null;
  const json = context.json;
  if (typeof json === "function") {
    try {
      const parsed: unknown = await json.call(context);
      body = isRecord(parsed) ? parsed : null;
    } catch {
      body = null;
    }
  }
  return { status, body };
};

// ── Message card ─────────────────────────────────────────────────────────────

export interface BrandEnquiryProfile {
  available: boolean;
  replyMinutes: number | null;
}

export const parseBrandEnquiryProfile = (value: unknown): BrandEnquiryProfile => {
  if (!isRecord(value)) throw new Error("brand_enquiry_profile_malformed");
  const minutes = value.reply_minutes;
  return {
    available: value.available === true,
    replyMinutes:
      typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null,
  };
};

export async function fetchBrandEnquiryProfile(brandId: string): Promise<BrandEnquiryProfile> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("brand_enquiry_public_profile", { p_brand_id: brandId });
  if (error !== null) throw error;
  return parseBrandEnquiryProfile(data);
}

// ── Brand identity by slug (cancel page) ────────────────────────────────────

export interface PublicBrandIdentity {
  id: string;
  name: string;
  slug: string;
  theme: { color: string | null; font: string | null; animation: string | null };
}

/** The few public fields the cancel page needs to offer "Message {Brand}". */
export async function fetchPublicBrandIdentity(slug: string): Promise<PublicBrandIdentity | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("business_public_brands_view")
    .select("id, name, slug, theme_color, theme_font, theme_animation")
    .eq("slug", slug)
    .maybeSingle();
  if (error !== null) throw error;
  if (!isRecord(data) || typeof data.id !== "string" || typeof data.name !== "string") return null;
  // Typed brand columns (ORCH-0964), read into locals before shaping.
  const color = str(data.theme_color);
  const font = str(data.theme_font);
  const animation = str(data.theme_animation);
  return {
    id: data.id,
    name: data.name,
    slug: typeof data.slug === "string" ? data.slug : slug,
    theme: { color, font, animation },
  };
}

// ── Signed-in plans + send ───────────────────────────────────────────────────

export async function fetchMyBrandPlans(brandId: string): Promise<EnquiryPlan[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("brand_enquiry_my_plans", { p_brand_id: brandId });
  if (error !== null) throw error;
  return enquiryPlansFromRows(data);
}

const SIGNED_IN_ERROR_COPY: Record<string, string> = {
  enquiry_rate_limited: "You've sent a few messages already. Try again later.",
  enquiries_unavailable: "This brand isn't taking messages right now.",
  verified_email_required: "Confirm your email address in your account, then try again.",
  invalid_context: "That booking can't be attached. Pick another topic.",
  invalid_reason: "Pick what you need, then send again.",
};

const errorCode = (error: unknown): string | null => {
  if (!isRecord(error)) return null;
  const message = typeof error.message === "string" ? error.message : "";
  return Object.keys(SIGNED_IN_ERROR_COPY).find((code) => message.includes(code)) ?? null;
};

export async function sendSignedInEnquiry(
  brandId: string,
  request: EnquirySendRequest,
): Promise<EnquirySendOutcome> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("brand_enquiry_send", {
    p_brand_id: brandId,
    p_entry: request.entry,
    p_context_kind: request.contextKind,
    p_context_id: request.contextId,
    p_reason: request.reason,
    p_body: request.body,
    p_source: "web",
  });
  if (error !== null) {
    const code = errorCode(error);
    return { ok: false, message: code === null ? SEND_FAILED : SIGNED_IN_ERROR_COPY[code] ?? SEND_FAILED };
  }
  const conversationId = isRecord(data) && typeof data.conversation_id === "string" ? data.conversation_id : null;
  return { ok: true, email: null, threadUrl: null, conversationId };
}

// ── Signed-out send ──────────────────────────────────────────────────────────

const PUBLIC_FIELD_COPY: Record<string, string> = {
  body: "Write a message between 10 and 2,000 characters.",
  name: "Enter your name.",
  email: "Enter a full email address, like name@example.com.",
  phone: "Check the phone number, or leave it empty.",
  context: "That topic can't be sent from here. Pick another.",
  reason: "Pick what you need, then send again.",
};

export async function sendPublicEnquiry(
  brandId: string,
  request: EnquirySendRequest,
): Promise<EnquirySendOutcome> {
  if (request.guest === null) return { ok: false, message: SEND_FAILED };
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("public-brand-enquiry", {
    body: {
      brand_id: brandId,
      entry: request.entry,
      context_kind: request.contextKind,
      context_id: request.contextId ?? undefined,
      reason: request.reason,
      body: request.body,
      name: request.guest.name,
      email: request.guest.email,
      phone: request.guest.phoneE164 ?? undefined,
      ok_to_call: request.guest.okToCall,
      hp: request.hp,
      t0: request.t0,
      source: "web",
    },
  });
  if (error !== null && error !== undefined) {
    const { status, body } = await readFunctionError(error);
    if (status === 400) {
      const field = typeof body?.field === "string" ? body.field : "";
      return { ok: false, message: PUBLIC_FIELD_COPY[field] ?? SEND_FAILED };
    }
    if (status === 404) return { ok: false, message: "This brand isn't taking messages right now." };
    return { ok: false, message: SEND_FAILED };
  }
  const threadUrl = isRecord(data) && typeof data.thread_url === "string" ? data.thread_url : null;
  return { ok: true, email: request.guest.email, threadUrl, conversationId: null };
}

// ── Stay in the loop ─────────────────────────────────────────────────────────

export interface SubscribeRequest {
  brandId: string;
  email: string;
  phoneE164: string | null;
  wantsSms: boolean;
  hp: string;
  t0: number;
}

export type SubscribeOutcome = { ok: true } | { ok: false; message: string };

export async function requestBrandSubscribe(request: SubscribeRequest): Promise<SubscribeOutcome> {
  const supabase = await getSupabase();
  const { error } = await supabase.functions.invoke("public-brand-subscribe", {
    body: {
      brand_id: request.brandId,
      email: request.email,
      phone: request.phoneE164 ?? undefined,
      wants_sms: request.wantsSms,
      hp: request.hp,
      t0: request.t0,
      source: "web",
    },
  });
  if (error !== null && error !== undefined) {
    const { status, body } = await readFunctionError(error);
    if (status === 400 && body?.field === "phone") {
      return { ok: false, message: "Check the mobile number, or leave it empty." };
    }
    if (status === 400) return { ok: false, message: "Enter a full email address, like name@example.com." };
    return { ok: false, message: "We couldn't sign you up. Check your connection and try again." };
  }
  return { ok: true };
}

// ── /m/{token} guest thread ──────────────────────────────────────────────────

export interface GuestThreadMessage {
  who: "guest" | "brand" | "system";
  display: string;
  body: string;
  at: string | null;
}

export interface GuestThread {
  brand: { name: string; slug: string | null; logoUrl: string | null; accent: string | null };
  topicLabel: string | null;
  status: "new" | "waiting" | "replied" | "resolved";
  channelLabel: string | null;
  messages: GuestThreadMessage[];
}

export type GuestThreadResult =
  | { kind: "ok"; thread: GuestThread }
  | { kind: "expired" }
  | { kind: "invalid" };

const STATUSES = new Set(["new", "waiting", "replied", "resolved"]);

export const parseGuestThread = (value: unknown): GuestThread => {
  if (!isRecord(value) || value.status !== "ok") throw new Error("guest_thread_malformed");
  const brand = isRecord(value.brand) ? value.brand : {};
  const status = typeof value.enquiry_status === "string" && STATUSES.has(value.enquiry_status)
    ? (value.enquiry_status as GuestThread["status"])
    : "new";
  const messages = Array.isArray(value.messages) ? value.messages : [];
  return {
    brand: {
      name: str(brand.name) ?? "the brand",
      slug: str(brand.slug),
      logoUrl: str(brand.logo_url),
      accent: str(brand.accent),
    },
    topicLabel: str(value.topic_label),
    status,
    channelLabel: str(value.channel_label),
    messages: messages
      .filter(isRecord)
      .map((m) => ({
        who: m.who === "guest" || m.who === "system" ? m.who : "brand",
        display: typeof m.display === "string" ? m.display : "",
        body: typeof m.body === "string" ? m.body : "",
        at: str(m.at),
      })),
  };
};

export async function fetchGuestThread(token: string): Promise<GuestThreadResult> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke(
    `public-enquiry-thread?token=${encodeURIComponent(token)}`,
    { method: "GET" },
  );
  if (error !== null && error !== undefined) {
    const { status } = await readFunctionError(error);
    if (status === 410) return { kind: "expired" };
    if (status === 404) return { kind: "invalid" };
    throw error instanceof Error ? error : new Error("guest_thread_failed");
  }
  return { kind: "ok", thread: parseGuestThread(data) };
}

export type GuestReplyOutcome =
  | { ok: true }
  | { ok: false; reason: "expired" | "invalid" | "rate_limited" | "body" | "network" };

export async function postGuestReply(token: string, body: string, hp: string): Promise<GuestReplyOutcome> {
  const supabase = await getSupabase();
  const { error } = await supabase.functions.invoke("public-enquiry-thread", {
    body: { token, body, hp },
  });
  if (error === null || error === undefined) return { ok: true };
  const { status } = await readFunctionError(error);
  if (status === 410) return { ok: false, reason: "expired" };
  if (status === 404) return { ok: false, reason: "invalid" };
  if (status === 429) return { ok: false, reason: "rate_limited" };
  if (status === 400) return { ok: false, reason: "body" };
  return { ok: false, reason: "network" };
}

/** "Email me a new link" — always answered with 202 by the server. */
export async function requestNewThreadLink(email: string): Promise<boolean> {
  const supabase = await getSupabase();
  const { error } = await supabase.functions.invoke("public-enquiry-thread", {
    body: { action: "new_link", email },
  });
  return error === null || error === undefined;
}
