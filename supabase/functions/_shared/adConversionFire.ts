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

// ── Shared contract types (imported by the 4 senders, type-only — no cycle) ───

export type SendStatus = "sent" | "failed" | "skipped";
export type Lane = "consumer" | "business";
export type Surface = "web" | "ios" | "android";
export type EventType = "purchase" | "reservation" | "lead" | "view";
export type Channel = "meta" | "tiktok" | "snap" | "reddit" | "google";

/** The normalized conversion the senders POST. PII is already hashed (SC-9). */
export interface ConversionSendInput {
  eventId: string; // dedup key == orders.id == browser Pixel eventID
  eventName: string; // per-channel event name (Meta 'Purchase', TikTok 'CompletePayment', …)
  valueCents: number | null;
  currency: string | null;
  eventSourceUrl: string | null;
  hashedEmail: string | null; // SHA-256 hex
  hashedPhone: string | null; // SHA-256 hex
  fbc: string | null; // UNHASHED (Meta only)
  fbp: string | null; // UNHASHED (Meta only)
  externalClickId: string | null; // raw fbclid / ttclid / sccid / rdt_cid
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
  surface?: Surface; // default 'web'
  lane?: Lane; // buyer conversions are consumer-lane by default
  eventType?: EventType; // default 'purchase' (order); reservations auto-tier (below)
  eventSourceUrl?: string | null;
  testEventCode?: string | null;
  /**
   * ISSUE-865 PR1 WP-2 — the first-party ad click_id, passed inline by a caller
   * that already holds it (the FREE-RSVP reservation-create path has no checkout
   * session to read from). Takes precedence over the session-join lookup. NULL /
   * absent for non-ad traffic.
   */
  clickId?: string | null;
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

export interface FireAdConversionDeps {
  senders?: Partial<Record<Channel, SenderFn>>;
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

/** Per-channel canonical event name — MUST match the browser pixel's event. */
const CHANNEL_EVENT_NAME: Record<
  Channel,
  { purchase: string; reservation: string }
> = {
  meta: { purchase: "Purchase", reservation: "Schedule" },
  tiktok: { purchase: "CompletePayment", reservation: "CompleteRegistration" },
  snap: { purchase: "PURCHASE", reservation: "SAVE" },
  reddit: { purchase: "Purchase", reservation: "Lead" },
  // ISSUE-1267 — Google keys on the conversion-action RESOURCE, not an event-name
  // string, so this name is cosmetic for the google sender (it ignores eventName);
  // kept for map-shape parity so the fan-out's CHANNEL_EVENT_NAME[channel] lookup
  // never dereferences undefined.
  google: { purchase: "Purchase", reservation: "Schedule" },
};

// ── Hashing (SC-9) — byte-identical to the WP-A attribution-capture idiom ─────

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const normEmail = (v: string): string => v.trim().toLowerCase();
const normPhone = (v: string): string => v.replace(/[^0-9]/g, "");

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

// ── Internal resolution shapes ────────────────────────────────────────────────

interface ConversionContext {
  eventId: string;
  eventType: EventType;
  valueCents: number | null;
  currency: string | null;
  hashedEmail: string | null;
  hashedPhone: string | null;
  brandId: string | null;
  minglaEventId: string | null;
  orderId: string | null;
  clickId: string | null;
  eventSourceUrl: string | null;
}

interface TouchContext {
  touchId: string | null;
  connectionId: string | null;
  campaignId: string | null;
  network: string | null; // 'meta' | 'tiktok' | …
  externalClickId: string | null;
  fbc: string | null; // reconstructed from fbclid + touch time (A2-5)
}

/** Build fbc from a raw fbclid + observation time (A2-5: fb.1.{tsMs}.{fbclid}). */
function reconstructFbc(fbclid: string | null, tsMs: number): string | null {
  if (!fbclid) return null;
  return `fb.1.${tsMs}.${fbclid}`;
}

async function resolveOrderContext(
  supabase: SupabaseClient,
  orderId: string,
  input: FireAdConversionInput,
): Promise<ConversionContext | null> {
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, event_id, total_cents, currency, buyer_email, buyer_phone, payment_status",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return null;

  const row = order as Record<string, unknown>;
  // Resolve brand via events.brand_id (orders has no brand_id).
  let brandId: string | null = null;
  const minglaEventId = (row.event_id as string | null) ?? null;
  if (minglaEventId) {
    const { data: ev } = await supabase
      .from("events")
      .select("brand_id")
      .eq("id", minglaEventId)
      .maybeSingle();
    brandId = (ev as { brand_id?: string } | null)?.brand_id ?? null;
  }

  // Resolve the threaded click_id via the checkout session (WP-C threading).
  let clickId: string | null = null;
  const { data: sess } = await supabase
    .from("ticket_checkout_sessions")
    .select("attribution_click_id")
    .eq("order_id", orderId)
    .not("attribution_click_id", "is", null)
    .maybeSingle();
  clickId =
    (sess as { attribution_click_id?: string } | null)?.attribution_click_id ??
      null;

  const email = (row.buyer_email as string | null) ?? null;
  const phone = (row.buyer_phone as string | null) ?? null;

  return {
    eventId: orderId,
    eventType: input.eventType ?? "purchase",
    valueCents: typeof row.total_cents === "number"
      ? (row.total_cents as number)
      : null,
    currency: (row.currency as string | null) ?? null,
    hashedEmail: email ? await sha256Hex(normEmail(email)) : null,
    hashedPhone: phone ? await sha256Hex(normPhone(phone)) : null,
    brandId,
    minglaEventId,
    orderId,
    clickId,
    eventSourceUrl: input.eventSourceUrl ?? null,
  };
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

  // ISSUE-865 PR1 WP-2 — resolve the threaded click_id: the caller's inline
  // override (the free path holds it) first, else the reservation checkout
  // session (the fee path threaded it at create). Best-effort, fail-open.
  let clickId: string | null =
    typeof input.clickId === "string" && input.clickId ? input.clickId : null;
  if (!clickId) {
    try {
      const { data: sess } = await supabase
        .from("reservation_checkout_sessions")
        .select("attribution_click_id")
        .eq("reservation_id", reservationId)
        .not("attribution_click_id", "is", null)
        .maybeSingle();
      clickId = (sess as { attribution_click_id?: string } | null)
        ?.attribution_click_id ?? null;
    } catch {
      clickId = null;
    }
  }

  return {
    eventId: reservationId,
    eventType,
    valueCents,
    currency: (row.fee_currency as string | null) ?? null,
    hashedEmail: email ? await sha256Hex(normEmail(email)) : null,
    hashedPhone: phone ? await sha256Hex(normPhone(phone)) : null,
    brandId: (row.brand_id as string | null) ?? null,
    minglaEventId: null,
    orderId: null,
    clickId,
    eventSourceUrl: input.eventSourceUrl ?? null,
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
    fbc: null,
  };
  if (!clickId) return empty;
  const { data: touch } = await supabase
    .from("ad_attribution_touches")
    .select(
      "id, connection_id, campaign_id, network, external_click_id, created_at",
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
  return {
    touchId: (t.id as string | null) ?? null,
    connectionId: (t.connection_id as string | null) ?? null,
    campaignId: (t.campaign_id as string | null) ?? null,
    network,
    externalClickId,
    // fbc is only meaningful for a Meta click id.
    fbc: network === "meta"
      ? reconstructFbc(
        externalClickId,
        isNaN(createdAt) ? Date.now() : createdAt,
      )
      : null,
  };
}

/** Resolve a lane's {pixel_id, capi token env-var NAME} from ad_connections.extra. */
async function resolveSenderConnection(
  supabase: SupabaseClient,
  platform: Channel,
  lane: Lane,
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
        pixelId: str(extra.pixel_id),
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
        // Reddit token is name-reserved but its VALUE is not provisioned yet →
        // the sender fail-closes soft ('pending_config') until the env exists.
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
      return {
        pixelId: null,
        tokenEnvVar: null,
        lane,
        conversionActionResource: str(extra.conversion_action_resource) ??
          str(g.conversion_action_resource),
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
    const key = (input.orderId ?? input.reservationId ?? "").trim();
    if (!key) return { ok: false, reason: "no_conversion_key" };

    // 1. Resolve the conversion context (order OR reservation).
    const ctx = input.orderId
      ? await resolveOrderContext(supabase, input.orderId, input)
      : await resolveReservationContext(
        supabase,
        input.reservationId as string,
        input,
      );
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
        "event_id, meta_capi_status, tiktok_events_status, snap_capi_status, reddit_capi_status, google_ads_status",
      )
      .eq("event_id", key)
      .maybeSingle();
    const existingRow = existing as Record<string, string> | null;

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
    if (
      existingRow && !channelPending.meta && !channelPending.tiktok &&
      !channelPending.snap && !channelPending.reddit && !channelPending.google
    ) {
      return { ok: true, eventId: key, deduped: true, results: [] };
    }

    // 3. Resolve the attributed touch (click_id → campaign/connection/fbc).
    const touch = await resolveTouch(supabase, ctx.clickId);

    // 4. Ensure the ad_conversions row exists (idempotent insert, service-role).
    const conversionRow = {
      event_id: key,
      event_type: ctx.eventType,
      event_name: CHANNEL_EVENT_NAME
        .meta[ctx.eventType === "reservation" ? "reservation" : "purchase"],
      value_cents: ctx.valueCents,
      currency: ctx.currency,
      surface,
      lane,
      order_id: ctx.orderId,
      brand_id: ctx.brandId,
      mingla_event_id: ctx.minglaEventId,
      click_id: ctx.clickId,
      touch_id: touch.touchId,
      connection_id: touch.connectionId,
      campaign_id: touch.campaignId,
      event_source_url: ctx.eventSourceUrl,
      hashed_email: ctx.hashedEmail,
      hashed_phone: ctx.hashedPhone,
    };
    await supabase
      .from("ad_conversions")
      .upsert(conversionRow, {
        onConflict: "event_id",
        ignoreDuplicates: true,
      });

    // 5. Fan out to each channel whose status is still pending (parallel,
    //    bounded, fail-open). Non-Meta channels never receive fbc/fbp.
    const eventTimeMs = now();
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
      const conn = await resolveSenderConnection(supabase, channel, lane);
      const sendInput: ConversionSendInput = {
        eventId: key,
        eventName: CHANNEL_EVENT_NAME[channel][
          ctx.eventType === "reservation" ? "reservation" : "purchase"
        ],
        valueCents: ctx.valueCents,
        currency: ctx.currency,
        eventSourceUrl: ctx.eventSourceUrl,
        hashedEmail: ctx.hashedEmail,
        hashedPhone: ctx.hashedPhone,
        fbc: channel === "meta" ? touch.fbc : null,
        fbp: null, // fbp is a browser-only cookie; not reconstructable server-side
        externalClickId: touch.network === channel
          ? touch.externalClickId
          : null,
        clientIpAddress: null, // the webhook has no buyer browser IP/UA
        clientUserAgent: null,
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

    // 6. Persist per-channel outcomes (never store a token in provider_response).
    const statusUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const providerResponse: Record<string, unknown> = {};
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
