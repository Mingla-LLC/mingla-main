/**
 * adConversionFire.ts — ISSUE-865 WP-B · the ONE post-finalize conversion hook.
 *
 * This is the single, shared, idempotent, FAIL-OPEN helper that every
 * order-finalize / reservation-confirm choke point calls AFTER the purchase is
 * already committed. It mirrors the proven `fireOrderFinalizeNotifications`
 * (businessNotifyTriggers.ts) and the AppsFlyer `af_purchase` S2S block that
 * already sit at these exact sites — a post-paid, never-throws, best-effort send.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHARED event_id / DEDUP CONTRACT (decided — A2-5 / SC-5 / SC-15):
 *   event_id = the Mingla order id (orders.id) — or the reservation id for a
 *   venue reservation — used VERBATIM on BOTH sides:
 *     • the browser Pixel fires with { eventID: orderId } (webAnalytics.web.ts),
 *     • this server CAPI send uses event_id = orderId,
 *   so Meta/TikTok/Snap/Reddit dedup the exact pair (eventID == event_id AND the
 *   per-channel event name matches). It is DETERMINISTIC (the order id already
 *   exists on both sides — the browser confirm page holds result.orderId, the
 *   server holds order.id) so NOTHING extra has to be minted or persisted.
 *
 * HARD GUARANTEES:
 *   • OFF THE CRITICAL PATH. Called only AFTER finalize marks the order paid —
 *     the sale is already committed. A CAPI failure can never block, delay past a
 *     bounded timeout, or reverse it (RT-1 / §8).
 *   • FAIL-OPEN. NEVER throws. Every path is wrapped; senders never throw; a
 *     platform 500/timeout is absorbed and recorded as `failed`.
 *   • IDEMPOTENT (RT-2 / SC-3). One ad_conversions row per event_id (UNIQUE).
 *     Per-channel *_status gating means a re-delivered webhook re-sends NOTHING
 *     once a channel is non-`pending`.
 *   • PER-LANE token resolution (A3-2). pixel_id + CAPI token env-var NAME come
 *     from the lane's ad_connections.extra; the sender does Deno.env.get(name).
 *     NO hardcoded secret, no token VALUE in code.
 *   • PII SHA-256 HASHED (SC-9). Only hashes leave for advanced matching.
 */

// @ts-ignore — Deno ESM import (pin matches businessNotifyTriggers.ts / the
// finalize callers, which pass `supabase as never`).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendMetaConversion } from "./metaCapi.ts";
import { sendTikTokConversion } from "./tiktokEvents.ts";
import { sendSnapConversion } from "./snapCapi.ts";
import { sendRedditConversion } from "./redditCapi.ts";
import { sendGoogleConversion } from "./googleConversionUpload.ts";
import {
  brandPageUrl,
  checkoutStartUrl,
  eventPageUrl,
} from "./adEventSourceUrl.ts";
// #4238 W4-1: env-free AppsFlyer helpers only. The poster (which reads the
// AppsFlyer secrets) is injected by the callers whose functions declare them
// (stripe-webhook, ad-conversion-retry), never imported here.
import {
  type AppsFlyerApp,
  type AppsFlyerDeviceRow,
  fetchAppsFlyerDevice,
  formatEventTime,
} from "./appsFlyerDevice.ts";
import { majorFromMinor } from "./money/formatMinor.ts";
// #4238 W3-3 / W5-1: the host-funnel event names and per-platform hashing.
import {
  HOST_FUNNEL_EVENT_NAMES,
  HOST_FUNNEL_EVENT_TYPE,
  HOST_FUNNEL_GOOGLE_KIND,
  type ServerHostFunnelKind,
} from "./adEventCatalog.ts";
import { identityHashes } from "./adIdentity.ts";

// ── Shared contract types (imported by the 4 senders, type-only — no cycle) ───

export type SendStatus = "sent" | "failed" | "skipped";
export type Lane = "consumer" | "business";
export type Surface = "web" | "ios" | "android";
export type EventType =
  | "purchase"
  | "reservation"
  | "lead"
  | "view"
  // #4238 W3-3: host-funnel kinds (ad_conversions.event_type, M-2).
  | "host_signup"
  | "host_first_publish"
  | "host_first_sale";
export type Channel = "meta" | "tiktok" | "snap" | "reddit" | "google";

/** The normalized conversion the senders POST. PII is already hashed (SC-9). */
export interface ConversionSendInput {
  eventId: string; // dedup key == orders.id == browser Pixel eventID
  eventName: string; // per-channel event name (Meta 'Purchase', TikTok 'CompletePayment', …)
  valueCents: number | null;
  currency: string | null;
  contentId?: string | null;
  brandId?: string | null;
  eventSourceUrl: string | null;
  hashedEmail: string | null; // SHA-256 hex
  hashedPhone: string | null; // SHA-256 hex
  /** #4238 W5-1: SHA-256 of the E.164 phone WITH `+` (Google, Step 0 Z6). */
  hashedPhoneE164?: string | null;
  /** #4238 W5-1: SHA-256 of Google's normalised email (gmail rule, Z7). */
  hashedEmailGoogle?: string | null;
  fbc: string | null; // UNHASHED (Meta only)
  fbp: string | null; // UNHASHED (Meta only)
  externalId?: string | null; // SHA-256 buyer user id (all three ad platforms)
  ttp?: string | null; // UNHASHED TikTok _ttp cookie
  scCookie1?: string | null; // UNHASHED Snap _scid cookie
  externalClickId: string | null; // raw fbclid / ttclid / sccid / rdt_cid
  /**
   * #4238 W2-6 (I-4238-CLICK-ID-TYPED): which URL parameter the click id came
   * from (gclid | gbraid | wbraid for Google). Null for legacy touches.
   */
  externalClickIdType?: string | null;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  eventTimeMs: number;
  testEventCode?: string | null;
}

export interface SenderConnection {
  pixelId: string | null;
  tokenEnvVar: string | null; // env-var NAME — never a value
  lane?: Lane | null;
  /**
   * ISSUE-1267 (google lane only): the conversion-action resource name from
   * ad_connections.extra.conversion_action_resource. Config, NOT a secret. The 4
   * CAPI senders ignore it.
   */
  conversionActionResource?: string | null;
  /**
   * ISSUE-1267 (google lane only): consent-mode signals (config-driven). Present
   * only when configured on the connection; absent → Google treats it as
   * UNSPECIFIED. The 4 CAPI senders ignore it.
   */
  consent?: { adUserData?: string; adPersonalization?: string } | null;
  /**
   * #4238 W5-1 (I-4238-GOOGLE-ACTION-PER-KIND, google lane only): which
   * conversion action conversionActionResource belongs to.
   */
  googleConversionKind?: GoogleConversionKind | null;
}

/** #4238 W5-1: one Google conversion action per kind (Step 0 Z8). */
export type GoogleConversionKind =
  | "purchase"
  | "free_signup"
  | "host_lead"
  | "host_signup";

/**
 * #4238 W3-3: a host-funnel conversion (a host lead, sign-up, first publish or
 * first sale). Its event_id is deterministic (adEventCatalog prefixes) and is
 * shared with the browser where the browser fires a twin.
 */
export interface HostEventInput {
  kind: ServerHostFunnelKind;
  eventId: string;
  subjectType: "host_user" | "lead";
  subjectId: string;
  valueCents?: number | null;
  currency?: string | null;
  brandId?: string | null;
}

export interface SenderDeps {
  getToken?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface SenderResult {
  channel: Channel;
  status: SendStatus;
  reason?: string;
  httpStatus?: number | null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface FireAdConversionInput {
  /** Ticket/checkout conversion — the finalized order id (the dedup event_id). */
  orderId?: string | null;
  /** Venue reservation conversion — the reservation id (the dedup event_id). */
  reservationId?: string | null;
  /** Stay reservation group conversion — the exact multi-room/place group. */
  stayGroupId?: string | null;
  /**
   * #4238 W2-5 (I-4238-RSVP-CONVERSION-PAIRED): a public RSVP (event_rsvps.id)
   * is a free sign-up. Its id is the dedup event_id, shared with the browser.
   */
  rsvpId?: string | null;
  surface?: Surface; // default 'web'
  lane?: Lane; // buyer conversions are consumer-lane by default
  eventType?: EventType; // default 'purchase' (order); reservations auto-tier (below)
  eventSourceUrl?: string | null;
  /**
   * #4238 W1-5 (I-4238-EVENT-TIME-IS-ACTION-TIME): when the buyer acted (the
   * provider's paid time, or the finalize time). Absent → the first fire's
   * ad_conversions.created_at (so a retry reuses it) → now().
   */
  eventTimeMs?: number | null;
  testEventCode?: string | null;
  /** Browser match and opt-out state when a durable checkout row is absent. */
  adContext?: CheckoutAdContextInput | null;
  /**
   * ISSUE-865 PR1 WP-2 — the first-party ad click_id, passed inline by a caller
   * that already holds it (the FREE-RSVP reservation-create path has no checkout
   * session to read from). Takes precedence over the session-join lookup. NULL /
   * absent for non-ad traffic.
   */
  clickId?: string | null;
  /** #4238 W3-3 (I-4238-HOST-FUNNEL-ONCE): a host-funnel conversion. */
  hostEvent?: HostEventInput | null;
}

export interface FireAdConversionResult {
  ok: boolean;
  eventId?: string;
  deduped?: boolean;
  results?: SenderResult[];
  reason?: string;
}

type SenderFn = (
  input: ConversionSendInput,
  conn: SenderConnection,
  deps?: SenderDeps,
) => Promise<SenderResult>;

/**
 * #4238 W4-1: the AppsFlyer S2S poster's shape (postAppsFlyerS2SEvent in
 * appsFlyerS2S.ts). Injected; without it a native purchase leaves
 * appsflyer_status pending for the hourly retry, which injects it.
 */
export type AppsFlyerPostFn = (input: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  userId: string;
  eventName: string;
  eventValues?: {
    af_revenue?: number;
    af_currency?: string;
    [k: string]: string | number | boolean | undefined;
  };
  eventTime?: string;
  app?: AppsFlyerApp;
  device?: AppsFlyerDeviceRow | null;
}) => Promise<boolean>;

export interface FireAdConversionDeps {
  senders?: Partial<Record<Channel, SenderFn>>;
  /** #4238 W4-1: native purchases post af_purchase through this. */
  postAppsFlyer?: AppsFlyerPostFn;
  getToken?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const DEFAULT_SENDERS: Record<Channel, SenderFn> = {
  meta: sendMetaConversion,
  tiktok: sendTikTokConversion,
  snap: sendSnapConversion,
  reddit: sendRedditConversion,
  // ISSUE-1267 — the 5th lane: a click-conversion UPLOAD, not an event POST, but
  // it rides this same fan-out with the same fail-open sender contract.
  google: sendGoogleConversion,
};

const STATUS_COL: Record<Channel, string> = {
  meta: "meta_capi_status",
  tiktok: "tiktok_events_status",
  snap: "snap_capi_status",
  reddit: "reddit_capi_status",
  google: "google_ads_status", // ISSUE-1267
};

/**
 * Per-channel canonical event name — MUST match the browser pixel's event.
 * toward #3697 F-4: free tickets/RSVPs are sign-ups (never $0 Purchase);
 * follows use a separate Lead path when fired.
 */
const CHANNEL_EVENT_NAME: Record<
  Channel,
  { purchase: string; reservation: string; follow: string }
> = {
  meta: {
    purchase: "Purchase",
    reservation: "CompleteRegistration",
    follow: "Lead",
  },
  tiktok: {
    purchase: "CompletePayment",
    reservation: "CompleteRegistration",
    follow: "Lead",
  },
  snap: { purchase: "PURCHASE", reservation: "SIGN_UP", follow: "SIGN_UP" },
  reddit: { purchase: "Purchase", reservation: "SignUp", follow: "Lead" },
  // ISSUE-1267 — Google keys on the conversion-action RESOURCE, not an event-name
  // string, so this name is cosmetic for the google sender (it ignores eventName);
  // kept for map-shape parity so the fan-out's CHANNEL_EVENT_NAME[channel] lookup
  // never dereferences undefined.
  google: {
    purchase: "Purchase",
    reservation: "SignUp",
    follow: "Lead",
  },
};

// ── Hashing (SC-9) — byte-identical to the WP-A attribution-capture idiom ─────

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// #4238 W5-1: email / phone normalisation moved to adIdentity.ts.

/**
 * ISSUE-865 WP-C threading (P2-1 rework) — best-effort, FAIL-OPEN persistence of
 * the ad click_id onto a checkout session, DECOUPLED from the fatal
 * checkout-creation UPDATE. Attribution capture must NEVER sit on the tap→pay
 * critical path: a missing `attribution_click_id` column (edge fns deployed
 * before migration 20270106000865 applies) OR any write failure is SWALLOWED —
 * the checkout completes normally, attribution is simply skipped. Returns void;
 * the caller does NOT branch on it (there is no failure to branch on). Mirrors
 * the fail-open philosophy of fireAdConversion. NEVER throws.
 */
export async function persistAttributionClickId(
  supabase: SupabaseClient,
  checkoutSessionId: string,
  clickId: string | null,
): Promise<void> {
  if (clickId === null || clickId.length === 0) return; // non-ad traffic → no-op
  try {
    const { error } = await supabase
      .from("ticket_checkout_sessions")
      .update({ attribution_click_id: clickId })
      .eq("id", checkoutSessionId);
    if (error) {
      console.warn(
        "[adConversionFire] attribution_click_id persist skipped (non-fatal):",
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[adConversionFire] attribution_click_id persist threw (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export interface CheckoutAdContextInput {
  clickId: string | null;
  fbp: string | null;
  fbc: string | null;
  scid: string | null;
  ttp: string | null;
  trackingOptOut: boolean;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
}

/** Fail-open persistence of every browser/server match key at session create. */
export async function persistCheckoutAdContext(
  supabase: SupabaseClient,
  checkoutSessionId: string,
  input: CheckoutAdContextInput,
): Promise<void> {
  const bounded = (value: string | null, max: number): string | null =>
    typeof value === "string" && value.trim()
      ? value.trim().slice(0, max)
      : null;
  try {
    const { error } = await supabase
      .from("ticket_checkout_sessions")
      .update({
        attribution_click_id: bounded(input.clickId, 512),
        fbp: bounded(input.fbp, 512),
        fbc: bounded(input.fbc, 512),
        scid: bounded(input.scid, 512),
        ttp: bounded(input.ttp, 512),
        ad_tracking_opt_out: input.trackingOptOut === true,
        client_ip: bounded(input.clientIpAddress, 128),
        client_user_agent: bounded(input.clientUserAgent, 1024),
      })
      .eq("id", checkoutSessionId);
    if (error) {
      console.warn(
        "[adConversionFire] checkout ad context persist skipped (non-fatal):",
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[adConversionFire] checkout ad context persist threw (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** #4238 W4-1: the three checkout surfaces ticket-checkout-create accepts. */
export type CheckoutSurface = "web" | "mobile-web" | "native";

/**
 * #4238 W4-1 (D20): store which surface created the checkout session, so the
 * finalize-time conversion knows a native app purchase from a website one. Its
 * own write (never merged into persistCheckoutAdContext): if the column is not
 * there yet, only this is skipped and the click id and opt-out still persist.
 * Fail-open, never throws.
 */
export async function persistCheckoutSurface(
  supabase: SupabaseClient,
  checkoutSessionId: string,
  surface: CheckoutSurface,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("ticket_checkout_sessions")
      .update({ checkout_surface: surface })
      .eq("id", checkoutSessionId);
    if (error) {
      console.warn(
        "[adConversionFire] checkout_surface persist skipped (non-fatal):",
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[adConversionFire] checkout_surface persist threw (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * ISSUE-865 PR1 WP-2 — the reservation twin of persistAttributionClickId. Writes
 * the ad click_id onto a reservation_checkout_sessions row, DECOUPLED from the
 * fatal session INSERT (venue-reservation-create must never 409 a reservation on
 * a missing `attribution_click_id` column — the ticket P2-1 lesson). A missing
 * column / any write failure is SWALLOWED; the reservation completes normally,
 * attribution is simply skipped. NEVER throws. Returns void.
 */
export async function persistReservationAttributionClickId(
  supabase: SupabaseClient,
  reservationSessionId: string,
  clickId: string | null,
): Promise<void> {
  if (clickId === null || clickId.length === 0) return; // non-ad traffic → no-op
  try {
    const { error } = await supabase
      .from("reservation_checkout_sessions")
      .update({ attribution_click_id: clickId })
      .eq("id", reservationSessionId);
    if (error) {
      console.warn(
        "[adConversionFire] reservation attribution_click_id persist skipped (non-fatal):",
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[adConversionFire] reservation attribution_click_id persist threw (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Reservation twin of persistCheckoutAdContext; always fail-open. */
export async function persistReservationAdContext(
  supabase: SupabaseClient,
  reservationSessionId: string,
  input: CheckoutAdContextInput,
): Promise<void> {
  const bounded = (value: string | null, max: number): string | null =>
    typeof value === "string" && value.trim()
      ? value.trim().slice(0, max)
      : null;
  try {
    const { error } = await supabase
      .from("reservation_checkout_sessions")
      .update({
        attribution_click_id: bounded(input.clickId, 512),
        fbp: bounded(input.fbp, 512),
        fbc: bounded(input.fbc, 512),
        scid: bounded(input.scid, 512),
        ttp: bounded(input.ttp, 512),
        ad_tracking_opt_out: input.trackingOptOut === true,
        client_ip: bounded(input.clientIpAddress, 128),
        client_user_agent: bounded(input.clientUserAgent, 1024),
      })
      .eq("id", reservationSessionId);
    if (error) {
      console.warn(
        "[adConversionFire] reservation ad context persist skipped (non-fatal):",
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[adConversionFire] reservation ad context persist threw (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Internal resolution shapes ────────────────────────────────────────────────

interface ConversionContext {
  eventId: string;
  eventType: EventType;
  valueCents: number | null;
  currency: string | null;
  hashedEmail: string | null;
  hashedPhone: string | null;
  /** #4238 W5-1 (Google): E.164-with-plus phone hash, gmail-normalised email. */
  hashedPhoneE164?: string | null;
  hashedEmailGoogle?: string | null;
  brandId: string | null;
  minglaEventId: string | null;
  orderId: string | null;
  stayGroupId: string | null;
  clickId: string | null;
  eventSourceUrl: string | null;
  externalId: string | null;
  fbp: string | null;
  fbc: string | null;
  scid: string | null;
  ttp: string | null;
  trackingOptOut: boolean;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  /** #4238 W4-1: the order was bought in the Explorer app (session surface). */
  nativeCheckout?: boolean;
  /** #4238 W4-1: the signed-in buyer, for the Explorer AppsFlyer device. */
  buyerUserId?: string | null;
  /** #4238 W3-3: the host-funnel kind (catalogue event names). */
  hostKind?: ServerHostFunnelKind | null;
  /**
   * #4238 W3-3: no web match context exists for this host subject (a native-
   * only host, or a lead with no browser data): every channel is terminally
   * skipped/no_web_context. Native hosts are measured by AppsFlyer (D10).
   */
  noWebContext?: boolean;
}

interface TouchContext {
  touchId: string | null;
  connectionId: string | null;
  campaignId: string | null;
  network: string | null; // 'meta' | 'tiktok' | …
  externalClickId: string | null;
  /** #4238 W2-6: the click id's URL parameter, or null (legacy row). */
  externalClickIdType: string | null;
  fbc: string | null; // reconstructed from fbclid + touch time (A2-5)
  /** toward #3697 / #3703: outbound CAPI only when touch consent is granted. */
  consentAllowsShare: boolean;
  /** pending | granted | rejected | none (no touch / legacy). */
  consentState: "pending" | "granted" | "rejected" | "none";
}

/** #4238 W3-3: the host kind an ad_conversions.event_type stands for. */
function hostKindForEventType(
  eventType: EventType,
): ServerHostFunnelKind | null {
  if (eventType === "host_signup") return "host_signup";
  if (eventType === "host_first_publish") return "host_first_publish";
  if (eventType === "host_first_sale") return "host_first_sale";
  return null;
}

/**
 * The per-channel event name, or null when that platform gets nothing for this
 * kind (#4238 W3-3, adEventCatalog: e.g. Snap for a host first publish, Google
 * for any host kind without its own conversion action).
 */
function channelEventName(
  channel: Channel,
  eventType: EventType,
  hostKind: ServerHostFunnelKind | null = null,
): string | null {
  const kind = hostKind ?? hostKindForEventType(eventType);
  if (kind) {
    if (channel === "google") {
      return HOST_FUNNEL_GOOGLE_KIND[kind]
        ? HOST_FUNNEL_EVENT_NAMES[kind].meta
        : null;
    }
    return HOST_FUNNEL_EVENT_NAMES[kind][channel];
  }
  const names = CHANNEL_EVENT_NAME[channel];
  if (eventType === "reservation") return names.reservation;
  if (eventType === "lead") return names.follow;
  return names.purchase;
}

/** The row's event_name (NOT NULL): the Meta name, which every kind has. */
function rowEventName(
  eventType: EventType,
  hostKind: ServerHostFunnelKind | null = null,
): string {
  return channelEventName("meta", eventType, hostKind) ?? eventType;
}

/**
 * #4238 W5-1 (I-4238-GOOGLE-ACTION-PER-KIND): the Google conversion action a
 * conversion uploads to. A free sign-up never lands on the purchase action.
 */
function googleKindFor(
  eventType: EventType,
  hostKind: ServerHostFunnelKind | null,
): GoogleConversionKind | null {
  if (hostKind) return HOST_FUNNEL_GOOGLE_KIND[hostKind] ?? null;
  if (eventType === "purchase") return "purchase";
  if (eventType === "reservation") return "free_signup";
  return null;
}

/** Build fbc from a raw fbclid + observation time (A2-5: fb.1.{tsMs}.{fbclid}). */
function reconstructFbc(fbclid: string | null, tsMs: number): string | null {
  if (!fbclid) return null;
  return `fb.1.${tsMs}.${fbclid}`;
}

/** #4238 W1-5: a brand's public slug for event_source_url (null if unknown). */
async function brandSlugFor(
  supabase: SupabaseClient,
  brandId: string | null,
): Promise<string | null> {
  if (!brandId) return null;
  try {
    const { data } = await supabase
      .from("brands")
      .select("slug")
      .eq("id", brandId)
      .maybeSingle();
    const slug = (data as { slug?: unknown } | null)?.slug;
    return typeof slug === "string" ? slug : null;
  } catch {
    return null;
  }
}

async function resolveOrderContext(
  supabase: SupabaseClient,
  orderId: string,
  input: FireAdConversionInput,
): Promise<ConversionContext | null> {
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, event_id, total_cents, currency, buyer_email, buyer_phone, payment_status, source",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return null;

  const row = order as Record<string, unknown>;
  // I-4063-DOOR-MONEY-ISOLATION: CAPI represents an online conversion. A host-
  // collected door sale is durable purchase history, but it did not pass
  // through Mingla checkout and must never be reported to an ad network.
  if ((row.source ?? "online_checkout") !== "online_checkout") return null;
  // Resolve brand via events.brand_id (orders has no brand_id).
  let brandId: string | null = null;
  let eventPage: string | null = null;
  const minglaEventId = (row.event_id as string | null) ?? null;
  if (minglaEventId) {
    const { data: ev } = await supabase
      .from("events")
      .select("brand_id, slug, event_type")
      .eq("id", minglaEventId)
      .maybeSingle();
    const evRow = (ev ?? {}) as {
      brand_id?: string;
      slug?: unknown;
      event_type?: unknown;
    };
    brandId = evRow.brand_id ?? null;
    // #4238 W1-5: the buyer's public event page is the event_source_url.
    eventPage = eventPageUrl({
      brandSlug: await brandSlugFor(supabase, brandId),
      eventSlug: evRow.slug,
      eventType: evRow.event_type,
    });
  }

  // Resolve the threaded click_id via the checkout session (WP-C threading).
  let clickId: string | null = null;
  const { data: sess } = await supabase
    .from("ticket_checkout_sessions")
    .select(
      "attribution_click_id,buyer_user_id,fbp,fbc,scid,ttp,ad_tracking_opt_out,client_ip,client_user_agent",
    )
    .eq("order_id", orderId)
    .maybeSingle();
  const sessRow = (sess ?? {}) as Record<string, unknown>;
  clickId = typeof sessRow.attribution_click_id === "string"
    ? sessRow.attribution_click_id
    : null;
  const buyerUserId = typeof sessRow.buyer_user_id === "string"
    ? sessRow.buyer_user_id
    : null;
  const nativeCheckout = await orderCheckoutSurface(supabase, orderId) ===
    "native";

  const email = (row.buyer_email as string | null) ?? null;
  const phone = (row.buyer_phone as string | null) ?? null;

  const valueCents = typeof row.total_cents === "number"
    ? (row.total_cents as number)
    : null;
  // toward #3697 F-4: free tickets are sign-ups — never a $0 Purchase.
  let eventType: EventType = input.eventType ?? "purchase";
  if (input.eventType == null && (valueCents ?? 0) <= 0) {
    eventType = "reservation";
  }

  return {
    eventId: orderId,
    eventType,
    valueCents: eventType === "purchase" ? valueCents : 0,
    currency: eventType === "purchase"
      ? ((row.currency as string | null) ?? null)
      : null,
    // #4238 W5-1: one place hashes each identity per platform (adIdentity).
    ...(await identityHashes(email, phone)),
    brandId,
    minglaEventId,
    orderId,
    stayGroupId: null,
    clickId,
    eventSourceUrl: input.eventSourceUrl ?? eventPage,
    externalId: buyerUserId ? await sha256Hex(buyerUserId) : null,
    fbp: typeof sessRow.fbp === "string" ? sessRow.fbp : null,
    fbc: typeof sessRow.fbc === "string" ? sessRow.fbc : null,
    scid: typeof sessRow.scid === "string" ? sessRow.scid : null,
    ttp: typeof sessRow.ttp === "string" ? sessRow.ttp : null,
    trackingOptOut: sessRow.ad_tracking_opt_out === true,
    clientIpAddress: typeof sessRow.client_ip === "string"
      ? sessRow.client_ip
      : null,
    clientUserAgent: typeof sessRow.client_user_agent === "string"
      ? sessRow.client_user_agent
      : null,
    nativeCheckout,
    buyerUserId,
  };
}

/**
 * #4238 W4-1: the stored checkout surface for an order's session. Its own read,
 * so a database without the column yet loses only this answer (treated as web,
 * the pre-#4238 behaviour), never the session's click id or opt-out.
 */
async function orderCheckoutSurface(
  supabase: SupabaseClient,
  orderId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("ticket_checkout_sessions")
      .select("checkout_surface")
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) return null;
    const value = (data as { checkout_surface?: unknown } | null)
      ?.checkout_surface;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function resolveReservationContext(
  supabase: SupabaseClient,
  reservationId: string,
  input: FireAdConversionInput,
): Promise<ConversionContext | null> {
  const { data: resv, error } = await supabase
    .from("reservations")
    .select(
      "id, brand_id, fee_cents, fee_currency, guest_email, guest_phone_e164, payment_status",
    )
    .eq("id", reservationId)
    .maybeSingle();
  if (error || !resv) return null;
  const row = resv as Record<string, unknown>;
  const email = (row.guest_email as string | null) ?? null;
  const phone = (row.guest_phone_e164 as string | null) ?? null;

  // ISSUE-865 PR1 WP-2 TWO-TIER (founder-locked): a PAID venue reservation is a
  // value'd Purchase (carries fee amount+currency); a free RSVP is a lead-type
  // event (Meta 'Schedule' / TikTok 'CompleteRegistration' / …) at £0. An
  // EXPLICIT input.eventType always wins (back-compat: an adversarial caller can
  // force the reservation/lead branch even on a paid row); otherwise the tier is
  // derived from payment_status + fee.
  const feeCents = typeof row.fee_cents === "number"
    ? (row.fee_cents as number)
    : null;
  const paymentStatus = (row.payment_status as string | null) ?? null;
  const isPaidReservation = paymentStatus === "paid" && (feeCents ?? 0) > 0;
  const eventType: EventType = input.eventType ??
    (isPaidReservation ? "purchase" : "reservation");
  // A lead-type conversion carries £0 (SUM in the rollup counts only paid value);
  // only the value'd Purchase carries the fee amount.
  const valueCents = eventType === "purchase" ? feeCents : 0;

  // #3697: read the session even without a click so an organic browser opt-out
  // still suppresses server sharing. Inline context covers the free path before
  // its session is visible to this fire-and-forget call.
  let session: Record<string, unknown> = {};
  try {
    const { data: sess } = await supabase
      .from("reservation_checkout_sessions")
      .select(
        "attribution_click_id,consumer_user_id,fbp,fbc,scid,ttp,ad_tracking_opt_out,client_ip,client_user_agent",
      )
      .eq("reservation_id", reservationId)
      .maybeSingle();
    session = (sess ?? {}) as Record<string, unknown>;
  } catch {
    session = {};
  }
  const supplied = input.adContext ?? null;
  const clickId = typeof input.clickId === "string" && input.clickId
    ? input.clickId
    : supplied?.clickId ??
      (typeof session.attribution_click_id === "string"
        ? session.attribution_click_id
        : null);
  const consumerUserId = typeof session.consumer_user_id === "string"
    ? session.consumer_user_id
    : null;

  return {
    eventId: reservationId,
    eventType,
    valueCents,
    currency: (row.fee_currency as string | null) ?? null,
    // #4238 W5-1: one place hashes each identity per platform (adIdentity).
    ...(await identityHashes(email, phone)),
    brandId: (row.brand_id as string | null) ?? null,
    minglaEventId: null,
    orderId: null,
    stayGroupId: null,
    clickId,
    eventSourceUrl: input.eventSourceUrl ??
      brandPageUrl(
        await brandSlugFor(supabase, (row.brand_id as string | null) ?? null),
      ),
    externalId: consumerUserId ? await sha256Hex(consumerUserId) : null,
    fbp: supplied?.fbp ??
      (typeof session.fbp === "string" ? session.fbp : null),
    fbc: supplied?.fbc ??
      (typeof session.fbc === "string" ? session.fbc : null),
    scid: supplied?.scid ??
      (typeof session.scid === "string" ? session.scid : null),
    ttp: supplied?.ttp ??
      (typeof session.ttp === "string" ? session.ttp : null),
    trackingOptOut: supplied?.trackingOptOut === true ||
      session.ad_tracking_opt_out === true,
    clientIpAddress: supplied?.clientIpAddress ??
      (typeof session.client_ip === "string" ? session.client_ip : null),
    clientUserAgent: supplied?.clientUserAgent ??
      (typeof session.client_user_agent === "string"
        ? session.client_user_agent
        : null),
  };
}

/** #4238 W2-5: only a positive public RSVP is a free sign-up. */
const RSVP_CONVERSION_STATUSES = new Set(["going", "waitlisted"]);

/**
 * #4238 W2-5: the RSVP twin of resolveReservationContext. Reads the row the
 * submit_event_rsvp_with_delivery RPC wrote; browser match keys come from
 * input.adContext (an RSVP has no checkout session). A retry has no adContext,
 * so it reuses the click id the first fire stored on ad_conversions.
 */
async function resolveRsvpContext(
  supabase: SupabaseClient,
  rsvpId: string,
  input: FireAdConversionInput,
): Promise<ConversionContext | null> {
  const { data: rsvp, error } = await supabase
    .from("event_rsvps")
    .select("id, event_id, user_id, guest_email, guest_phone, rsvp_status")
    .eq("id", rsvpId)
    .maybeSingle();
  if (error || !rsvp) return null;
  const row = rsvp as Record<string, unknown>;
  if (!RSVP_CONVERSION_STATUSES.has(String(row.rsvp_status ?? ""))) {
    return null;
  }
  const minglaEventId = typeof row.event_id === "string" ? row.event_id : null;
  let brandId: string | null = null;
  let eventPage: string | null = null;
  if (minglaEventId) {
    const { data: ev } = await supabase
      .from("events")
      .select("brand_id, slug, event_type")
      .eq("id", minglaEventId)
      .maybeSingle();
    const evRow = (ev ?? {}) as {
      brand_id?: string;
      slug?: unknown;
      event_type?: unknown;
    };
    brandId = evRow.brand_id ?? null;
    eventPage = eventPageUrl({
      brandSlug: await brandSlugFor(supabase, brandId),
      eventSlug: evRow.slug,
      eventType: evRow.event_type,
    });
  }
  const supplied = input.adContext ?? null;
  let clickId = typeof input.clickId === "string" && input.clickId
    ? input.clickId
    : supplied?.clickId ?? null;
  if (!clickId) {
    const { data: prior } = await supabase
      .from("ad_conversions")
      .select("click_id")
      .eq("event_id", rsvpId)
      .maybeSingle();
    const priorClick = (prior as { click_id?: unknown } | null)?.click_id;
    clickId = typeof priorClick === "string" && priorClick ? priorClick : null;
  }
  const email = typeof row.guest_email === "string" ? row.guest_email : null;
  const phone = typeof row.guest_phone === "string" ? row.guest_phone : null;
  const userId = typeof row.user_id === "string" ? row.user_id : null;
  return {
    eventId: rsvpId,
    eventType: "reservation",
    valueCents: 0,
    currency: null,
    // #4238 W5-1: one place hashes each identity per platform (adIdentity).
    ...(await identityHashes(email, phone)),
    brandId,
    minglaEventId,
    orderId: null,
    stayGroupId: null,
    clickId,
    eventSourceUrl: input.eventSourceUrl ?? eventPage,
    externalId: userId ? await sha256Hex(userId) : null,
    fbp: supplied?.fbp ?? null,
    fbc: supplied?.fbc ?? null,
    scid: supplied?.scid ?? null,
    ttp: supplied?.ttp ?? null,
    trackingOptOut: supplied?.trackingOptOut === true,
    clientIpAddress: supplied?.clientIpAddress ?? null,
    clientUserAgent: supplied?.clientUserAgent ?? null,
  };
}

async function resolveStayContext(
  supabase: SupabaseClient,
  stayGroupId: string,
  input: FireAdConversionInput,
): Promise<ConversionContext | null> {
  const { data: group, error } = await supabase
    .from("stay_reservation_groups")
    .select(
      "id,brand_id,venue_id,user_id,currency_code,total_minor,guest_snapshot,attribution_click_id,fbp,fbc,scid,ttp,ad_tracking_opt_out,client_ip,client_user_agent,state",
    )
    .eq("id", stayGroupId)
    .maybeSingle();
  if (error || !group) return null;
  const row = group as Record<string, unknown>;
  const { data: refunds } = await supabase
    .from("stay_refunds")
    .select("amount_minor")
    .eq("group_id", stayGroupId)
    .eq("state", "succeeded");
  const refunded = Array.isArray(refunds)
    ? refunds.reduce((sum, refund) => {
      const amount = Number(
        (refund as { amount_minor?: unknown }).amount_minor ?? 0,
      );
      return sum + (Number.isSafeInteger(amount) && amount > 0 ? amount : 0);
    }, 0)
    : 0;
  const total = Number(row.total_minor ?? 0);
  if (!Number.isSafeInteger(total) || total < 0) return null;
  const guest = row.guest_snapshot && typeof row.guest_snapshot === "object"
    ? row.guest_snapshot as Record<string, unknown>
    : {};
  const email = typeof guest.email === "string" ? guest.email : null;
  const phone = typeof guest.phone === "string"
    ? guest.phone
    : typeof guest.phoneE164 === "string"
    ? guest.phoneE164
    : null;
  return {
    eventId: stayGroupId,
    eventType: input.eventType ?? "purchase",
    valueCents: Math.max(0, total - refunded),
    currency: typeof row.currency_code === "string" ? row.currency_code : null,
    // #4238 W5-1: one place hashes each identity per platform (adIdentity).
    ...(await identityHashes(email, phone)),
    brandId: typeof row.brand_id === "string" ? row.brand_id : null,
    minglaEventId: null,
    orderId: null,
    stayGroupId,
    clickId: typeof row.attribution_click_id === "string"
      ? row.attribution_click_id
      : null,
    eventSourceUrl: input.eventSourceUrl ??
      brandPageUrl(
        await brandSlugFor(
          supabase,
          typeof row.brand_id === "string" ? row.brand_id : null,
        ),
      ),
    externalId: typeof row.user_id === "string"
      ? await sha256Hex(row.user_id)
      : null,
    fbp: typeof row.fbp === "string" ? row.fbp : null,
    fbc: typeof row.fbc === "string" ? row.fbc : null,
    scid: typeof row.scid === "string" ? row.scid : null,
    ttp: typeof row.ttp === "string" ? row.ttp : null,
    trackingOptOut: row.ad_tracking_opt_out === true,
    clientIpAddress: typeof row.client_ip === "string" ? row.client_ip : null,
    clientUserAgent: typeof row.client_user_agent === "string"
      ? row.client_user_agent
      : null,
  };
}

/**
 * #4238 W3-3: a host-funnel conversion's context. The browser match keys come
 * from ad_match_contexts (written by host-attribution-attach or the lead
 * functions); the identity from the host's account (creator_accounts) or the
 * lead row. With no web context row, the conversion is recorded and every
 * channel is terminally skipped (no_web_context).
 */
async function resolveHostContext(
  supabase: SupabaseClient,
  host: HostEventInput,
  input: FireAdConversionInput,
): Promise<ConversionContext | null> {
  const eventId = host.eventId.trim();
  if (!eventId || !host.subjectId) return null;
  const eventType = HOST_FUNNEL_EVENT_TYPE[host.kind];
  let match: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase
      .from("ad_match_contexts")
      .select(
        "click_id,fbp,fbc,ttp,scid,client_ip,client_user_agent,ad_tracking_opt_out,event_source_url,surface",
      )
      .eq("subject_type", host.subjectType)
      .eq("subject_id", host.subjectId)
      .maybeSingle();
    match = (data ?? null) as Record<string, unknown> | null;
  } catch {
    match = null;
  }
  // The stored row (a trigger-queued sign-up / publish, or a retry) carries the
  // brand, the event and a first-sale value when the input does not.
  let prior: Record<string, unknown> = {};
  try {
    const { data } = await supabase
      .from("ad_conversions")
      .select("brand_id,mingla_event_id,value_cents,currency")
      .eq("event_id", eventId)
      .maybeSingle();
    prior = (data ?? {}) as Record<string, unknown>;
  } catch {
    prior = {};
  }
  let email: string | null = null;
  let phone: string | null = null;
  let externalId: string | null = null;
  try {
    if (host.subjectType === "host_user") {
      const { data } = await supabase
        .from("creator_accounts")
        .select("email,phone_e164")
        .eq("id", host.subjectId)
        .maybeSingle();
      const acct = (data ?? {}) as Record<string, unknown>;
      email = typeof acct.email === "string" ? acct.email : null;
      phone = typeof acct.phone_e164 === "string" ? acct.phone_e164 : null;
      externalId = await sha256Hex(host.subjectId);
    } else if (host.subjectId.startsWith("tool:")) {
      const { data } = await supabase
        .from("tool_leads")
        .select("email")
        .eq("id", host.subjectId.slice("tool:".length))
        .maybeSingle();
      const lead = (data ?? {}) as Record<string, unknown>;
      email = typeof lead.email === "string" ? lead.email : null;
    } else {
      const { data } = await supabase
        .from("book_call_leads")
        .select("email")
        .eq("id", host.subjectId)
        .maybeSingle();
      const lead = (data ?? {}) as Record<string, unknown>;
      email = typeof lead.email === "string" ? lead.email : null;
    }
  } catch {
    // Identity is optional: the click id and cookies still match.
  }
  const str = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;
  const isSale = host.kind === "host_first_sale";
  const priorValue = typeof prior.value_cents === "number"
    ? prior.value_cents
    : null;
  const valueCents = isSale
    ? (typeof host.valueCents === "number" ? host.valueCents : priorValue)
    : null;
  return {
    eventId,
    eventType,
    hostKind: host.kind,
    valueCents,
    currency: isSale ? (host.currency ?? str(prior.currency)) : null,
    ...(await identityHashes(email, phone)),
    brandId: host.brandId ?? str(prior.brand_id),
    minglaEventId: str(prior.mingla_event_id),
    orderId: null,
    stayGroupId: null,
    clickId: str(match?.click_id) ?? input.clickId ?? null,
    eventSourceUrl: input.eventSourceUrl ?? str(match?.event_source_url),
    externalId,
    fbp: str(match?.fbp),
    fbc: str(match?.fbc),
    scid: str(match?.scid),
    ttp: str(match?.ttp),
    trackingOptOut: match?.ad_tracking_opt_out === true,
    clientIpAddress: str(match?.client_ip),
    clientUserAgent: str(match?.client_user_agent),
    // A native (Host app) context is not a website: AppsFlyer measures it.
    noWebContext: match === null || match.surface !== "web",
  };
}

async function resolveTouch(
  supabase: SupabaseClient,
  clickId: string | null,
): Promise<TouchContext> {
  const empty: TouchContext = {
    touchId: null,
    connectionId: null,
    campaignId: null,
    network: null,
    externalClickId: null,
    externalClickIdType: null,
    fbc: null,
    // No touch → no Reject latch; organic conversions may still share.
    consentAllowsShare: true,
    consentState: "none",
  };
  if (!clickId) return empty;
  const { data: touch } = await supabase
    .from("ad_attribution_touches")
    .select(
      "id, connection_id, campaign_id, network, external_click_id, external_click_id_type, created_at, consent_state",
    )
    .eq("click_id", clickId)
    .maybeSingle();
  if (!touch) return empty;
  const t = touch as Record<string, unknown>;
  const network = (t.network as string | null) ?? null;
  const externalClickId = (t.external_click_id as string | null) ?? null;
  const createdAt = t.created_at
    ? Date.parse(t.created_at as string)
    : Date.now();
  // Missing column / null → treat as granted (pre-Wave-0 rows).
  const consentState = typeof t.consent_state === "string"
    ? t.consent_state
    : "granted";
  return {
    touchId: (t.id as string | null) ?? null,
    connectionId: (t.connection_id as string | null) ?? null,
    campaignId: (t.campaign_id as string | null) ?? null,
    network,
    externalClickId,
    externalClickIdType: typeof t.external_click_id_type === "string"
      ? t.external_click_id_type
      : null,
    // fbc is only meaningful for a Meta click id.
    fbc: network === "meta"
      ? reconstructFbc(
        externalClickId,
        isNaN(createdAt) ? Date.now() : createdAt,
      )
      : null,
    // toward #3697 / #3703: outbound only when granted. Reject and pre-consent
    // pending stay first-party-only (shared_with_platforms=false).
    consentAllowsShare: consentState === "granted",
    consentState: consentState === "pending" || consentState === "rejected" ||
        consentState === "granted"
      ? consentState
      : "granted",
  };
}

/**
 * Resolve a lane's {pixel_id, capi token env-var NAME} from ad_connections.extra.
 * #4238 W1-2: exported so the tracking-health run checks the exact same
 * connection the senders use (one owner for the resolution).
 */
export async function resolveSenderConnection(
  supabase: SupabaseClient,
  platform: Channel,
  lane: Lane,
  googleKind: GoogleConversionKind | null = "purchase",
): Promise<SenderConnection> {
  const dbPlatform = platform === "snap" ? "snapchat" : platform;
  const { data } = await supabase
    .from("ad_connections")
    .select("extra")
    .eq("platform", dbPlatform)
    .eq("lane", lane)
    .maybeSingle();
  const extra = ((data as { extra?: Record<string, unknown> } | null)?.extra ??
    {}) as Record<string, unknown>;
  const str = (
    v: unknown,
  ): string | null => (typeof v === "string" && v ? v : null);

  switch (platform) {
    case "meta":
      return {
        pixelId: str(extra.dataset_id) ?? str(extra.pixel_id),
        tokenEnvVar: str(extra.capi_env_var) ??
          (lane === "business"
            ? "META_MINGLABIZ_CAPI_ACCESS_TOKEN"
            : "META_CAPI_ACCESS_TOKEN"),
        lane,
      };
    case "tiktok":
      return {
        // #4238 W1-4 (I-4238-TIKTOK-PIXEL-CODE, Step 0 Z1): event_source_id is
        // the pixel CODE the browser loads. No fallback to the numeric
        // extra.pixel_id: a missing code is failed/no_pixel and alerts.
        pixelId: str(extra.pixel_code),
        tokenEnvVar: str(extra.events_env_var) ?? "TIKTOK_EVENTS_ACCESS_TOKEN",
        lane,
      };
    case "snap":
      return {
        pixelId: str(extra.pixel_id),
        tokenEnvVar: str(extra.capi_env_var) ??
          (lane === "business"
            ? "SNAPCHAT_MINGLABIZ_CAPI_TOKEN"
            : "SNAPCHAT_CAPI_TOKEN"),
        lane,
      };
    case "reddit":
      return {
        pixelId: str(extra.reddit_pixel_id) ?? str(extra.pixel_id),
        // An unset Reddit token makes the sender return failed/pending_config
        // (#4238 W1-2: retried and alerted) until the value exists.
        tokenEnvVar: str(extra.capi_env_var) ?? "REDDIT_ADS_CAPI_TOKEN",
        lane,
      };
    case "google": {
      // ISSUE-1267 — Google auth is OAuth (resolveGoogleClient), NOT an env-var
      // token, and it keys on a conversion-action RESOURCE, not a pixel id. The
      // resource lives in extra.conversion_action_resource (config, not a secret);
      // until the admin one-shot writes it, the sender soft-skips 'pending_config'.
      const g = (extra.google && typeof extra.google === "object")
        ? extra.google as Record<string, unknown>
        : {};
      const consentRaw = ((extra.consent ?? g.consent) ?? null) as
        | Record<string, unknown>
        | null;
      const adUserData = consentRaw
        ? str(consentRaw.ad_user_data) ?? str(consentRaw.adUserData)
        : null;
      const adPersonalization = consentRaw
        ? str(consentRaw.ad_personalization) ??
          str(consentRaw.adPersonalization)
        : null;
      // #4238 W5-1 (I-4238-GOOGLE-ACTION-PER-KIND): one action per kind in
      // extra.conversion_actions.<kind>. conversion_action_resource stays the
      // purchase alias. Any other kind with no action of its own resolves to
      // null (failed/pending_config, alerted), never to the purchase action.
      const actions =
        (extra.conversion_actions && typeof extra.conversion_actions ===
              "object")
          ? extra.conversion_actions as Record<string, unknown>
          : {};
      const kind: GoogleConversionKind | null = googleKind;
      const resource = kind === null
        ? null
        : kind === "purchase"
        ? str(actions.purchase) ?? str(extra.conversion_action_resource) ??
          str(g.conversion_action_resource)
        : str(actions[kind]);
      return {
        pixelId: null,
        tokenEnvVar: null,
        lane,
        googleConversionKind: kind,
        conversionActionResource: resource,
        consent: (adUserData || adPersonalization)
          ? {
            adUserData: adUserData ?? undefined,
            adPersonalization: adPersonalization ?? undefined,
          }
          : null,
      };
    }
  }
}

/**
 * Server checkout-start fanout for Meta + TikTok + Snap. The checkout session
 * id is the shared browser/server dedup id. Rejected/opted-out sessions are
 * terminal; pending touch consent stays unclaimed so the retry lane can
 * evaluate the latest consent within 24 hours.
 *
 * #4238 W1-3 (I-4238-CHECKOUT-START-PER-CHANNEL): a channel recorded `sent`
 * (or terminally skipped) for a session is never sent again. A retry sends
 * only the channels still open and merges their verdicts into the stored
 * response, so one TikTok 401 no longer re-sends Meta and Snap every hour.
 */
export async function fireAdCheckoutStart(
  supabase: SupabaseClient,
  checkoutSessionId: string,
  deps: FireAdConversionDeps = {},
): Promise<FireAdConversionResult> {
  try {
    const { data: session, error } = await supabase
      .from("ticket_checkout_sessions")
      .select(
        "id,event_id,brand_id,total_cents,buyer_total_cents,currency,buyer_user_id,attribution_click_id,fbp,fbc,scid,ttp,ad_tracking_opt_out,client_ip,client_user_agent,ad_checkout_start_sent_at,ad_checkout_start_provider_response,created_at",
      )
      .eq("id", checkoutSessionId)
      .maybeSingle();
    if (error || !session) {
      return {
        ok: false,
        eventId: checkoutSessionId,
        reason: "context_unresolved",
      };
    }
    const row = session as Record<string, unknown>;
    if (row.ad_checkout_start_sent_at) {
      return {
        ok: true,
        eventId: checkoutSessionId,
        deduped: true,
        results: [],
      };
    }
    const touch = await resolveTouch(
      supabase,
      typeof row.attribution_click_id === "string"
        ? row.attribution_click_id
        : null,
    );
    const storedResponse = checkoutStartResponse(
      row.ad_checkout_start_provider_response,
    );
    const channels: Channel[] = CHECKOUT_START_CHANNELS.filter((channel) =>
      checkoutStartChannelOpen(storedResponse[channel])
    );
    if (channels.length === 0) {
      // Every channel already settled (sent or terminally skipped): close it.
      await supabase.from("ticket_checkout_sessions").update({
        ad_checkout_start_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", checkoutSessionId).is("ad_checkout_start_sent_at", null);
      return {
        ok: true,
        eventId: checkoutSessionId,
        deduped: true,
        results: [],
      };
    }
    const trackingOptOut = row.ad_tracking_opt_out === true;
    if (!touch.consentAllowsShare || trackingOptOut) {
      const terminal = trackingOptOut || touch.consentState === "rejected";
      const reason = trackingOptOut
        ? "tracking_opt_out"
        : terminal
        ? "consent_rejected"
        : "consent_pending_retryable";
      const results: SenderResult[] = channels.map((channel) => ({
        channel,
        status: "skipped",
        reason,
      }));
      if (terminal) {
        await supabase.from("ticket_checkout_sessions").update({
          ad_checkout_start_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Merge: an earlier `sent` verdict stays on record.
          ad_checkout_start_provider_response: {
            ...storedResponse,
            ...Object.fromEntries(
              results.map((result) => [result.channel, {
                status: result.status,
                reason: result.reason ?? null,
                http: null,
              }]),
            ),
          },
        }).eq("id", checkoutSessionId).is("ad_checkout_start_sent_at", null);
      }
      return {
        ok: true,
        eventId: checkoutSessionId,
        deduped: false,
        results,
      };
    }
    const { data: claimed } = await supabase
      .from("ticket_checkout_sessions")
      .update({ ad_checkout_start_sent_at: new Date().toISOString() })
      .eq("id", checkoutSessionId)
      .is("ad_checkout_start_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) {
      return {
        ok: true,
        eventId: checkoutSessionId,
        deduped: true,
        results: [],
      };
    }

    const now = deps.now ?? (() => Date.now());
    const senderDeps: SenderDeps = {
      getToken: deps.getToken,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
    };
    const buyerExternalId = typeof row.buyer_user_id === "string"
      ? await sha256Hex(row.buyer_user_id)
      : null;
    const valueCents = typeof row.buyer_total_cents === "number"
      ? row.buyer_total_cents
      : typeof row.total_cents === "number"
      ? row.total_cents
      : null;
    // #4238 W1-5: checkout start happened when the session was created; the
    // page is that event's checkout surface.
    const sessionCreatedMs = typeof row.created_at === "string"
      ? Date.parse(row.created_at)
      : NaN;
    const checkoutStartMs = Number.isFinite(sessionCreatedMs)
      ? sessionCreatedMs
      : now();
    let checkoutEventType: unknown = null;
    if (typeof row.event_id === "string") {
      const { data: ev } = await supabase
        .from("events")
        .select("event_type")
        .eq("id", row.event_id)
        .maybeSingle();
      checkoutEventType = (ev as { event_type?: unknown } | null)?.event_type ??
        null;
    }
    const checkoutPage = checkoutStartUrl(row.event_id, checkoutEventType);
    const results = await Promise.all(channels.map(async (channel) => {
      const connection = await resolveSenderConnection(
        supabase,
        channel,
        "consumer",
      );
      const sendInput: ConversionSendInput = {
        eventId: checkoutSessionId,
        eventName: channel === "snap" ? "START_CHECKOUT" : "InitiateCheckout",
        valueCents,
        currency: typeof row.currency === "string" ? row.currency : null,
        contentId: typeof row.event_id === "string" ? row.event_id : null,
        brandId: typeof row.brand_id === "string" ? row.brand_id : null,
        eventSourceUrl: checkoutPage,
        hashedEmail: null,
        hashedPhone: null,
        fbc: channel === "meta"
          ? (typeof row.fbc === "string" ? row.fbc : touch.fbc)
          : null,
        fbp: channel === "meta" && typeof row.fbp === "string" ? row.fbp : null,
        externalId: buyerExternalId,
        ttp: channel === "tiktok" && typeof row.ttp === "string"
          ? row.ttp
          : null,
        scCookie1: channel === "snap" && typeof row.scid === "string"
          ? row.scid
          : null,
        externalClickId: (channel === "snap"
            ? touch.network === "snapchat"
            : touch.network === channel)
          ? touch.externalClickId
          : null,
        externalClickIdType: touch.network === channel
          ? touch.externalClickIdType
          : null,
        clientIpAddress: typeof row.client_ip === "string"
          ? row.client_ip
          : null,
        clientUserAgent: typeof row.client_user_agent === "string"
          ? row.client_user_agent
          : null,
        eventTimeMs: checkoutStartMs,
      };
      return (deps.senders?.[channel] ?? DEFAULT_SENDERS[channel])(
        sendInput,
        connection,
        senderDeps,
      );
    }));
    // Merge per channel: keep every earlier verdict, overwrite only the
    // channels attempted now.
    const mergedResponse: Record<string, CheckoutStartVerdict> = {
      ...storedResponse,
      ...Object.fromEntries(
        results.map((result) => [result.channel, {
          status: result.status,
          reason: result.reason ?? null,
          http: result.httpStatus ?? null,
        }]),
      ),
    };
    const stillOpen = CHECKOUT_START_CHANNELS.some((channel) =>
      checkoutStartChannelOpen(mergedResponse[channel])
    );
    const attemptedAt = new Date().toISOString();
    await supabase.from("ticket_checkout_sessions").update({
      // While any channel is still retryable the claim is cleared so the
      // scheduled retry re-evaluates latest consent; it sends only the open
      // channels. updated_at restarts the retry's 5-minute grace.
      ad_checkout_start_sent_at: stillOpen ? null : attemptedAt,
      updated_at: attemptedAt,
      ad_checkout_start_provider_response: mergedResponse,
    }).eq("id", checkoutSessionId);
    return { ok: true, eventId: checkoutSessionId, deduped: false, results };
  } catch (err) {
    console.warn(
      "[adConversionFire] checkout start absorbed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, eventId: checkoutSessionId, reason: "absorbed" };
  }
}

/** #4238 W1-6: the stored per-channel verdicts (an object), else empty. */
function priorProviderResponse(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

const CHECKOUT_START_CHANNELS: Channel[] = ["meta", "tiktok", "snap"];

interface CheckoutStartVerdict {
  status: string;
  reason: string | null;
  http: number | null;
}

function checkoutStartResponse(
  raw: unknown,
): Record<string, CheckoutStartVerdict> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CheckoutStartVerdict> = {};
  for (const [channel, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.status !== "string") continue;
    out[channel] = {
      status: entry.status,
      reason: typeof entry.reason === "string" ? entry.reason : null,
      http: typeof entry.http === "number" ? entry.http : null,
    };
  }
  return out;
}

/**
 * #4238 W1-3: a channel is still open unless it was sent or terminally
 * skipped. A consent-pending skip stays open so a later Accept can send.
 */
function checkoutStartChannelOpen(
  verdict: CheckoutStartVerdict | undefined,
): boolean {
  if (!verdict) return true;
  if (verdict.status === "sent") return false;
  if (verdict.status === "skipped") {
    return verdict.reason === "consent_pending_retryable";
  }
  return true;
}

// ── #4238 W4-1: native (Explorer app) purchases ───────────────────────────────

interface NativePurchaseInput {
  key: string;
  ctx: ConversionContext;
  lane: Lane;
  existingRow: Record<string, string | number | null> | null;
  existingResponse: Record<string, unknown>;
  channelPending: Record<Channel, boolean>;
  eventTimeMs: number;
  postAppsFlyer: AppsFlyerPostFn | null;
}

async function fireNativePurchase(
  supabase: SupabaseClient,
  input: NativePurchaseInput,
): Promise<FireAdConversionResult> {
  const { key, ctx, existingRow } = input;
  const device: AppsFlyerDeviceRow | null = ctx.buyerUserId
    ? await fetchAppsFlyerDevice(supabase, ctx.buyerUserId, "consumer")
    : null;
  // The row's surface is the buyer's Explorer device platform (iOS when the
  // device is unknown: the spec's default).
  const surface: Surface = device?.platform ?? "ios";

  await supabase.from("ad_conversions").upsert({
    event_id: key,
    event_type: ctx.eventType,
    event_name: rowEventName(ctx.eventType, ctx.hostKind ?? null),
    value_cents: ctx.valueCents,
    currency: ctx.currency,
    surface,
    lane: input.lane,
    order_id: ctx.orderId,
    stay_group_id: ctx.stayGroupId,
    brand_id: ctx.brandId,
    mingla_event_id: ctx.minglaEventId,
    click_id: ctx.clickId,
    event_source_url: null,
    hashed_email: ctx.hashedEmail,
    hashed_phone: ctx.hashedPhone,
    shared_with_platforms: false,
  }, { onConflict: "event_id", ignoreDuplicates: true });

  const results: SenderResult[] = (
    ["meta", "tiktok", "snap", "reddit", "google"] as Channel[]
  )
    .filter((channel) => input.channelPending[channel])
    .map((channel) => ({
      channel,
      status: "skipped" as const,
      reason: "native_surface",
    }));
  const statusUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    shared_with_platforms: false,
  };
  const providerResponse: Record<string, unknown> = {
    ...input.existingResponse,
  };
  for (const r of results) {
    statusUpdate[STATUS_COL[r.channel]] = "skipped";
    providerResponse[r.channel] = {
      status: "skipped",
      reason: "native_surface",
      http: null,
    };
  }

  const afPending = (existingRow?.appsflyer_status ?? "pending") === "pending";
  if (afPending) {
    const isPaid = ctx.eventType === "purchase" && (ctx.valueCents ?? 0) > 0;
    let afStatus: SendStatus;
    let afReason: string | null = null;
    if (!isPaid) {
      afStatus = "skipped";
      afReason = "not_a_purchase";
    } else if (ctx.trackingOptOut) {
      afStatus = "skipped";
      afReason = "tracking_opt_out";
    } else if (!device || !ctx.buyerUserId) {
      afStatus = "skipped";
      afReason = "no_appsflyer_device";
    } else if (input.postAppsFlyer === null) {
      // This caller's function holds no AppsFlyer secret: the hourly
      // ad-conversion-retry run posts it (appsflyer_status stays pending).
      afStatus = "skipped";
      afReason = "deferred_to_retry";
    } else if (!(await claimAppsFlyerSend(supabase, key))) {
      // A concurrent fire (confirm vs webhook) already owns the post.
      afStatus = "skipped";
      afReason = "claimed_elsewhere";
    } else {
      const ok = await input.postAppsFlyer({
        supabase,
        userId: ctx.buyerUserId,
        app: "consumer",
        device,
        eventName: "af_purchase",
        eventTime: formatEventTime(new Date(input.eventTimeMs)),
        eventValues: {
          af_revenue: majorFromMinor(ctx.valueCents ?? 0, ctx.currency),
          af_currency: (ctx.currency ?? "").toUpperCase() || undefined,
          af_order_id: ctx.orderId ?? key,
          af_content_id: ctx.minglaEventId ?? undefined,
        },
      });
      afStatus = ok ? "sent" : "failed";
      afReason = ok ? null : "appsflyer_post_failed";
    }
    if (afReason !== "claimed_elsewhere" && afReason !== "deferred_to_retry") {
      statusUpdate.appsflyer_status = afStatus;
      providerResponse.appsflyer = {
        status: afStatus,
        reason: afReason,
        http: null,
      };
    }
  }
  statusUpdate.provider_response = providerResponse;
  await supabase.from("ad_conversions").update(statusUpdate).eq(
    "event_id",
    key,
  );
  return { ok: true, eventId: key, deduped: false, results };
}

/**
 * #4238 W3-3: record a conversion that is never shared (no web context) and
 * mark every still-pending channel terminally skipped with `reason`.
 */
async function recordUnsharedConversion(
  supabase: SupabaseClient,
  input: {
    key: string;
    ctx: ConversionContext;
    lane: Lane;
    surface: Surface;
    existingResponse: Record<string, unknown>;
    channelPending: Record<Channel, boolean>;
    reason: string;
  },
): Promise<FireAdConversionResult> {
  const { key, ctx } = input;
  await supabase.from("ad_conversions").upsert({
    event_id: key,
    event_type: ctx.eventType,
    event_name: rowEventName(ctx.eventType, ctx.hostKind ?? null),
    value_cents: ctx.valueCents,
    currency: ctx.currency,
    surface: input.surface,
    lane: input.lane,
    brand_id: ctx.brandId,
    mingla_event_id: ctx.minglaEventId,
    click_id: ctx.clickId,
    event_source_url: ctx.eventSourceUrl,
    hashed_email: ctx.hashedEmail,
    hashed_phone: ctx.hashedPhone,
    shared_with_platforms: false,
  }, { onConflict: "event_id", ignoreDuplicates: true });
  const results: SenderResult[] = (
    ["meta", "tiktok", "snap", "reddit", "google"] as Channel[]
  )
    .filter((channel) => input.channelPending[channel])
    .map((channel) => ({
      channel,
      status: "skipped" as const,
      reason: input.reason,
    }));
  const statusUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    shared_with_platforms: false,
  };
  const providerResponse: Record<string, unknown> = {
    ...input.existingResponse,
  };
  for (const r of results) {
    statusUpdate[STATUS_COL[r.channel]] = "skipped";
    providerResponse[r.channel] = {
      status: "skipped",
      reason: input.reason,
      http: null,
    };
  }
  statusUpdate.provider_response = providerResponse;
  await supabase.from("ad_conversions").update(statusUpdate).eq(
    "event_id",
    key,
  );
  return { ok: true, eventId: key, deduped: false, results };
}

/**
 * Atomic claim of the one AppsFlyer post for a conversion: flips
 * appsflyer_status pending → failed only if it is still pending (the post
 * then records sent). Two concurrent fires cannot both win.
 */
async function claimAppsFlyerSend(
  supabase: SupabaseClient,
  key: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("ad_conversions")
      .update({ appsflyer_status: "failed" })
      .eq("event_id", key)
      .eq("appsflyer_status", "pending")
      .select("event_id")
      .maybeSingle();
    return !error && data !== null;
  } catch {
    return false;
  }
}

// ── The hook ──────────────────────────────────────────────────────────────────

export async function fireAdConversion(
  supabase: SupabaseClient,
  input: FireAdConversionInput,
  deps: FireAdConversionDeps = {},
): Promise<FireAdConversionResult> {
  const senders = { ...DEFAULT_SENDERS, ...(deps.senders ?? {}) };
  const now = deps.now ?? (() => Date.now());
  const lane: Lane = input.lane ?? "consumer";
  const surface: Surface = input.surface ?? "web";
  const senderDeps: SenderDeps = {
    getToken: deps.getToken,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  };

  try {
    const key = (input.hostEvent?.eventId ?? input.orderId ??
      input.reservationId ?? input.stayGroupId ?? input.rsvpId ?? "").trim();
    if (!key) return { ok: false, reason: "no_conversion_key" };

    // 1. Resolve the conversion context (order OR reservation OR stay OR RSVP).
    // #4238 W2-5: the retry lane re-fires a row with neither order nor stay id
    // as reservationId; an RSVP row resolves through the RSVP context.
    const ctx = input.hostEvent
      ? await resolveHostContext(supabase, input.hostEvent, input)
      : input.orderId
      ? await resolveOrderContext(supabase, input.orderId, input)
      : input.reservationId
      ? (await resolveReservationContext(
        supabase,
        input.reservationId,
        input,
      )) ?? (await resolveRsvpContext(supabase, input.reservationId, input))
      : input.stayGroupId
      ? await resolveStayContext(supabase, input.stayGroupId, input)
      : await resolveRsvpContext(supabase, input.rsvpId as string, input);
    if (!ctx) return { ok: false, eventId: key, reason: "context_unresolved" };

    // 2. Idempotency read: if the row exists and NO channel is still pending,
    //    a prior fire already sent — a re-delivered webhook re-sends nothing.
    const { data: existing } = await supabase
      .from("ad_conversions")
      .select(
        // ISSUE-1267 CRITICAL: google_ads_status MUST be projected here — the
        // per-channel gate below reads it to decide whether Google still needs to
        // fire. Omit it and Google appears perpetually 'pending' on every
        // re-delivered webhook and re-fires the upload every time.
        //
        // ISSUE-855 / #865 UNDERCOUNT REPAIR: the attribution columns
        // (brand_id, order_id, value_cents, currency, mingla_event_id) are ALSO
        // projected so the post-upsert backfill (step 4b) can COALESCE-fill ONLY
        // the columns the EARLY browser row left NULL — without ever clobbering an
        // already-set value.
        // #4238 W1-5: created_at is the first fire's time, reused by retries.
        // #4238 W1-6: provider_response is read so a fire that attempts a
        // subset of channels merges into it instead of erasing the others.
        // #4238 W4-1: appsflyer_status gates the native af_purchase post.
        "event_id, created_at, brand_id, order_id, stay_group_id, value_cents, currency, mingla_event_id, meta_capi_status, tiktok_events_status, snap_capi_status, reddit_capi_status, google_ads_status, appsflyer_status, provider_response",
      )
      .eq("event_id", key)
      .maybeSingle();
    const existingRow = existing as
      | Record<string, string | number | null>
      | null;
    const existingResponse = priorProviderResponse(
      (existing as { provider_response?: unknown } | null)?.provider_response,
    );

    const channelPending: Record<Channel, boolean> = {
      meta: (existingRow?.[STATUS_COL.meta] ?? "pending") === "pending",
      tiktok: (existingRow?.[STATUS_COL.tiktok] ?? "pending") === "pending",
      snap: (existingRow?.[STATUS_COL.snap] ?? "pending") === "pending",
      reddit: (existingRow?.[STATUS_COL.reddit] ?? "pending") === "pending",
      // ISSUE-1267 — Google is the 5th lane, added AFTER the ad_conversions row
      // shape was first set. Semantics, by construction:
      //   • fresh conversion (no row)          → fires (existingRow is null → true)
      //   • row with google_ads_status='pending' (post-migration DEFAULT, incl.
      //     rows that predate the google lane and were back-filled to 'pending')
      //                                         → fires exactly once, then settles
      //   • row with google_ads_status='sent'|'failed'|'skipped'
      //                                         → NOT re-fired (dedup)
      //   • row missing the column entirely (undefined) → treated as SETTLED, so a
      //     legacy projection can never spuriously re-fire Google. Post-migration
      //     every real row carries the NOT-NULL DEFAULT 'pending' string, so a
      //     genuinely-unfired lane is still caught — ONLY the literal 'pending'
      //     string marks it pending. (Kept distinct from the ?? 'pending' default
      //     above precisely so an absent value ≠ a fresh-pending value.)
      google: existingRow ? existingRow[STATUS_COL.google] === "pending" : true,
    };
    // #4238 W4-1: a native order is settled only when AppsFlyer is too.
    const appsFlyerOpen = ctx.nativeCheckout === true &&
      (existingRow?.appsflyer_status ?? "pending") === "pending";
    if (
      existingRow && !channelPending.meta && !channelPending.tiktok &&
      !channelPending.snap && !channelPending.reddit && !channelPending.google &&
      !appsFlyerOpen
    ) {
      return { ok: true, eventId: key, deduped: true, results: [] };
    }

    // #4238 W4-1 (I-4238-NATIVE-PURCHASE-VIA-APPSFLYER): an Explorer app
    // purchase is not a website event. The ad networks get nothing (terminal
    // skipped/native_surface); AppsFlyer gets af_purchase once, server side.
    if (ctx.nativeCheckout === true) {
      return await fireNativePurchase(supabase, {
        key,
        ctx,
        lane,
        existingRow,
        existingResponse,
        channelPending,
        // The action time; a retry reuses the first fire's created_at.
        eventTimeMs: typeof input.eventTimeMs === "number" &&
            Number.isFinite(input.eventTimeMs)
          ? input.eventTimeMs
          : typeof existingRow?.created_at === "string" &&
              Number.isFinite(Date.parse(existingRow.created_at))
          ? Date.parse(existingRow.created_at)
          : now(),
        postAppsFlyer: deps.postAppsFlyer ?? null,
      });
    }

    // #4238 W3-3: a host subject with no web context (native-only host, or a
    // lead with no browser data) is recorded and terminally skipped.
    if (ctx.noWebContext === true) {
      return await recordUnsharedConversion(supabase, {
        key,
        ctx,
        lane,
        surface,
        existingResponse,
        channelPending,
        reason: "no_web_context",
      });
    }

    // 3. Resolve the attributed touch (click_id → campaign/connection/fbc).
    const touch = await resolveTouch(supabase, ctx.clickId);
    const shareWithPlatforms = touch.consentAllowsShare &&
      !ctx.trackingOptOut;

    // 4. Ensure the ad_conversions row exists (idempotent insert, service-role).
    // toward #3697 Wave 0d: this is the trusted writer — browser/anon cannot.
    const conversionRow = {
      event_id: key,
      event_type: ctx.eventType,
      event_name: rowEventName(ctx.eventType, ctx.hostKind ?? null),
      value_cents: ctx.valueCents,
      currency: ctx.currency,
      surface,
      lane,
      order_id: ctx.orderId,
      stay_group_id: ctx.stayGroupId,
      brand_id: ctx.brandId,
      mingla_event_id: ctx.minglaEventId,
      click_id: ctx.clickId,
      touch_id: touch.touchId,
      connection_id: touch.connectionId,
      campaign_id: touch.campaignId,
      event_source_url: ctx.eventSourceUrl,
      hashed_email: ctx.hashedEmail,
      hashed_phone: ctx.hashedPhone,
      shared_with_platforms: shareWithPlatforms,
    };
    await supabase
      .from("ad_conversions")
      .upsert(conversionRow, {
        onConflict: "event_id",
        ignoreDuplicates: true,
      });

    // 4b. COALESCE-backfill attribution columns when a prior trusted fire left
    //     NULLs (legacy early browser rows are no longer written — Wave 0d).
    if (existingRow) {
      const backfill: Record<string, unknown> = {};
      if (existingRow.brand_id == null && ctx.brandId != null) {
        backfill.brand_id = ctx.brandId;
      }
      if (existingRow.order_id == null && ctx.orderId != null) {
        backfill.order_id = ctx.orderId;
      }
      if (existingRow.stay_group_id == null && ctx.stayGroupId != null) {
        backfill.stay_group_id = ctx.stayGroupId;
      }
      if (existingRow.value_cents == null && ctx.valueCents != null) {
        backfill.value_cents = ctx.valueCents;
      }
      if (existingRow.currency == null && ctx.currency != null) {
        backfill.currency = ctx.currency;
      }
      if (existingRow.mingla_event_id == null && ctx.minglaEventId != null) {
        backfill.mingla_event_id = ctx.minglaEventId;
      }
      if (Object.keys(backfill).length > 0) {
        await supabase
          .from("ad_conversions")
          .update(backfill)
          .eq("event_id", key);
      }
    }

    // 5. toward #3697 F-3 / #3703: no outbound when consent is not granted.
    // Reject → terminal skipped (never share). Pending → leave channel statuses
    // pending so a later Accept + webhook redelivery can still fan out.
    if (!shareWithPlatforms) {
      const rejected = touch.consentState === "rejected" ||
        ctx.trackingOptOut;
      const results: SenderResult[] = (
        ["meta", "tiktok", "snap", "reddit", "google"] as Channel[]
      ).map((channel) => ({
        channel,
        status: "skipped" as const,
        reason: rejected ? "consent_rejected" : "consent_pending_retryable",
      }));
      const statusUpdate: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        shared_with_platforms: false,
        // #4238 W1-6: record only the still-pending channels; a channel that
        // already settled keeps its earlier verdict.
        provider_response: {
          ...existingResponse,
          ...Object.fromEntries(
            results
              .filter((r) => channelPending[r.channel])
              .map((r) => [r.channel, {
                status: r.status,
                reason: r.reason,
                http: null,
              }]),
          ),
        },
      };
      if (rejected) {
        for (const r of results) {
          if (channelPending[r.channel]) {
            statusUpdate[STATUS_COL[r.channel]] = "skipped";
          }
        }
      }
      // pending: do NOT flip *_status off pending — redelivery after Accept can send.
      await supabase.from("ad_conversions").update(statusUpdate).eq(
        "event_id",
        key,
      );
      return { ok: true, eventId: key, deduped: false, results };
    }

    // 6. Fan out to each channel whose status is still pending (parallel,
    //    bounded, fail-open). Non-Meta channels never receive fbc/fbp.
    // #4238 W1-5: the action time, never the send time. A retry carries the
    // same event_time as the first send.
    const firstFireMs = typeof existingRow?.created_at === "string"
      ? Date.parse(existingRow.created_at)
      : NaN;
    const eventTimeMs = typeof input.eventTimeMs === "number" &&
        Number.isFinite(input.eventTimeMs)
      ? input.eventTimeMs
      : Number.isFinite(firstFireMs)
      ? firstFireMs
      : now();
    const attempts: { channel: Channel; run: Promise<SenderResult> }[] = [];
    for (
      const channel of [
        "meta",
        "tiktok",
        "snap",
        "reddit",
        "google",
      ] as Channel[]
    ) {
      if (!channelPending[channel]) continue;
      // #4238 W3-3: a platform with no event for this kind gets nothing.
      const eventName = channelEventName(
        channel,
        ctx.eventType,
        ctx.hostKind ?? null,
      );
      if (eventName === null) {
        attempts.push({
          channel,
          run: Promise.resolve({
            channel,
            status: "skipped",
            reason: "no_channel_event",
          }),
        });
        continue;
      }
      const conn = await resolveSenderConnection(
        supabase,
        channel,
        lane,
        channel === "google"
          ? googleKindFor(ctx.eventType, ctx.hostKind ?? null)
          : "purchase",
      );
      const sendInput: ConversionSendInput = {
        eventId: key,
        eventName,
        valueCents: ctx.valueCents,
        currency: ctx.currency,
        contentId: ctx.minglaEventId,
        brandId: ctx.brandId,
        eventSourceUrl: ctx.eventSourceUrl,
        hashedEmail: ctx.hashedEmail,
        hashedPhone: ctx.hashedPhone,
        hashedPhoneE164: ctx.hashedPhoneE164 ?? null,
        hashedEmailGoogle: ctx.hashedEmailGoogle ?? null,
        fbc: channel === "meta" ? (ctx.fbc ?? touch.fbc) : null,
        fbp: channel === "meta" ? ctx.fbp : null,
        externalId: ctx.externalId,
        ttp: channel === "tiktok" ? ctx.ttp : null,
        scCookie1: channel === "snap" ? ctx.scid : null,
        externalClickId: (channel === "snap"
            ? touch.network === "snapchat"
            : touch.network === channel)
          ? touch.externalClickId
          : null,
        externalClickIdType: touch.network === channel
          ? touch.externalClickIdType
          : null,
        clientIpAddress: ctx.clientIpAddress,
        clientUserAgent: ctx.clientUserAgent,
        eventTimeMs,
        testEventCode: input.testEventCode ?? null,
      };
      attempts.push({
        channel,
        run: senders[channel](sendInput, conn, senderDeps),
      });
    }

    const settled = await Promise.allSettled(attempts.map((a) => a.run));
    const results: SenderResult[] = settled.map((s, i) =>
      s.status === "fulfilled" ? s.value : {
        channel: attempts[i].channel,
        status: "failed" as const,
        reason: "sender_threw",
      }
    );

    // 7. Persist per-channel outcomes (never store a token in provider_response).
    const statusUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      shared_with_platforms: true,
    };
    // #4238 W1-6 (I-4238-PROVIDER-RESPONSE-MERGED): channels not attempted now
    // keep their earlier verdict.
    const providerResponse: Record<string, unknown> = { ...existingResponse };
    for (const r of results) {
      statusUpdate[STATUS_COL[r.channel]] = r.status;
      providerResponse[r.channel] = {
        status: r.status,
        reason: r.reason ?? null,
        http: r.httpStatus ?? null,
      };
    }
    statusUpdate.provider_response = providerResponse;
    await supabase.from("ad_conversions").update(statusUpdate).eq(
      "event_id",
      key,
    );

    return { ok: true, eventId: key, deduped: false, results };
  } catch (err) {
    // Last-resort absorb — the caller (post-finalize) must never see a throw.
    console.warn(
      "[adConversionFire] absorbed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, reason: "absorbed" };
  }
}
