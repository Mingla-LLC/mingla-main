/**
 * adTrackingHealth.ts — #4238 W1-2 (D15, D2 detection). One health pass per
 * hourly `ad-conversion-retry` run, so a missing or rejected ad-platform key
 * is loud within the hour, with or without traffic.
 *
 * Per channel (consumer lane) it records, in public.ad_tracking_health:
 *   - key presence: the SAME sender connection the fan-out uses, and whether
 *     its token env-var NAME resolves (names only; a value is never stored);
 *   - passive failures: the last hour's failed sends and their reasons;
 *   - a daily no-record probe at 06:00 UTC (Meta/TikTok test_event_code,
 *     Snap's validate endpoint, Reddit CAPI v3 test_id from the same
 *     extra.test_event_code). Google resolves
 *     its upload client (OAuth mint) every run, which is its key check;
 *     its mint result is also the daily probe result;
 *   - one alert email per (channel, reason) per 6 h through sendOpsAlertEmail
 *     to the existing api_health recipients (no new recipient secret).
 *
 * Pure evaluators (evaluateChannelHealth, …) hold every rule; runAdTrackingHealth
 * is the one writer. It never throws into the retry run.
 */

// @ts-ignore — Deno ESM import (pin matches adConversionFire.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type Channel,
  type ConversionSendInput,
  resolveSenderConnection,
  type SenderConnection,
  type SenderDeps,
  type SenderResult,
} from "./adConversionFire.ts";
import { resolveCapiToken } from "./capiTokens.ts";
import { classifyReason } from "./adSendOutcome.ts";
import { sendMetaConversion } from "./metaCapi.ts";
import { probeGoogleUploadClient } from "./googleConversionUpload.ts";
import { sendTikTokConversion } from "./tiktokEvents.ts";
import { sendRedditConversion } from "./redditCapi.ts";
import { sendSnapConversion, type SnapSenderDeps } from "./snapCapi.ts";
import {
  type OpsAlertEmailInput,
  type OpsAlertEmailResult,
  sendOpsAlertEmail,
} from "./stripeOpsAlertEmail.ts";
import { apiHealthAlertRecipients } from "./secretBundle.ts";

export const HEALTH_CHANNELS: readonly Channel[] = [
  "meta",
  "tiktok",
  "snap",
  "reddit",
  "google",
];
export const HEALTH_LANE = "consumer" as const;
export const ALERT_DEDUPE_MS = 6 * 60 * 60 * 1000;
export const NO_SEND_WINDOW_MS = 6 * 60 * 60 * 1000;
export const FAILURE_WINDOW_MS = 60 * 60 * 1000;
export const PAYLOAD_ALERT_THRESHOLD = 3;
export const PROBE_UTC_HOUR = 6;
/** A second run inside the probe hour does not probe again. */
export const PROBE_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

export type ProbeResult =
  | "ok"
  | "auth_failed"
  | "not_configured"
  | "skipped_no_test_code"
  | "failed";

export const CHANNEL_LABEL: Record<Channel, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  snap: "Snapchat",
  reddit: "Reddit",
  google: "Google Ads",
};

const STATUS_COL: Record<Channel, string> = {
  meta: "meta_capi_status",
  tiktok: "tiktok_events_status",
  snap: "snap_capi_status",
  reddit: "reddit_capi_status",
  google: "google_ads_status",
};

export interface HealthRow {
  channel: Channel;
  lane: typeof HEALTH_LANE;
  token_present: boolean;
  pixel_configured: boolean;
  last_sent_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  failures_1h: number;
  last_probe_at: string | null;
  last_probe_result: ProbeResult | null;
  last_alerted_at: string | null;
  last_alert_reason: string | null;
  updated_at: string;
}

export interface FailureEvent {
  reason: string;
  at: string;
}

export interface ChannelObservation {
  channel: Channel;
  tokenPresent: boolean;
  pixelConfigured: boolean;
  /** The token env-var NAME the sender reads (for the fix text). */
  tokenEnvVar: string | null;
  failures1h: FailureEvent[];
  /** Latest `sent` seen in the last 6 h, or null. */
  lastSentAt: string | null;
  /** Consented conversions in the last 6 h this channel was expected to send. */
  expected6h: number;
  sent6h: number;
  probe: { result: ProbeResult; at: string } | null;
}

export interface ChannelAlert {
  channel: Channel;
  reason: string;
  subject: string;
  paragraphs: string[];
  idempotencyKey: string;
}

/**
 * The one reason a channel alerts on this run, or null. Order is severity:
 * a missing key first, then a missing pixel, a rejected key, any config or
 * auth failure in the last hour, repeated payload failures, then silence.
 */
export function alertReasonFor(obs: ChannelObservation): string | null {
  if (!obs.tokenPresent) {
    return obs.channel === "google" ? "pending_config" : "no_token";
  }
  if (!obs.pixelConfigured) {
    return obs.channel === "google" ? "pending_config" : "no_pixel";
  }
  if (obs.probe?.result === "auth_failed") return "probe_auth_failed";
  const loud = obs.failures1h.find((failure) => {
    const cls = classifyReason(failure.reason);
    return cls === "config" || cls === "auth";
  });
  if (loud) return loud.reason;
  const payload = obs.failures1h.filter((failure) =>
    classifyReason(failure.reason) === "payload"
  );
  if (payload.length >= PAYLOAD_ALERT_THRESHOLD) return payload[0].reason;
  if (obs.expected6h >= 1 && obs.sent6h === 0) return "no_send_6h";
  return null;
}

function fixText(obs: ChannelObservation, reason: string): string {
  const label = CHANNEL_LABEL[obs.channel];
  const name = obs.tokenEnvVar ?? "the token";
  if (reason === "no_token" || reason === "no_token_name") {
    return `Put ${name} back into AD_CONVERSION_TOKENS.`;
  }
  if (reason === "no_pixel") {
    return `Reconnect ${label} in Admin > Ad connections so the pixel is saved on the connection.`;
  }
  if (reason === "pending_config") {
    return obs.channel === "google"
      ? "Finish the Google Ads connection (keys and the conversion action) for the consumer lane."
      : `Put ${name} into AD_CONVERSION_TOKENS.`;
  }
  if (reason === "probe_auth_failed" || classifyReason(reason) === "auth") {
    return `${label} rejected the key. Issue a new token in ${label} and put it into AD_CONVERSION_TOKENS as ${name}.`;
  }
  if (reason === "no_send_6h") {
    return `Check provider_response.${obs.channel} on recent ad_conversions rows for the reason.`;
  }
  return `${label} rejected the event. Check provider_response.${obs.channel} on recent ad_conversions rows.`;
}

function plainReason(reason: string): string {
  switch (reason) {
    case "no_token":
    case "no_token_name":
      return "the server key is missing";
    case "no_pixel":
      return "no pixel is saved on the connection";
    case "pending_config":
      return "the connection is not set up";
    case "probe_auth_failed":
      return "the daily key check was rejected";
    case "no_send_6h":
      return "no server event was sent in 6 hours while conversions were created";
    default:
      return classifyReason(reason) === "auth"
        ? `the platform rejected the key (${reason})`
        : `the platform rejected events (${reason})`;
  }
}

/** Build the alert for this run, deduped to one per (channel, reason) per 6 h. */
export function buildChannelAlert(
  obs: ChannelObservation,
  previous: Pick<HealthRow, "last_alerted_at" | "last_alert_reason"> | null,
  nowMs: number,
): ChannelAlert | null {
  const reason = alertReasonFor(obs);
  if (!reason) return null;
  const lastAt = previous?.last_alerted_at
    ? Date.parse(previous.last_alerted_at)
    : NaN;
  if (
    previous?.last_alert_reason === reason && Number.isFinite(lastAt) &&
    nowMs - lastAt < ALERT_DEDUPE_MS
  ) return null;
  const label = CHANNEL_LABEL[obs.channel];
  const matching = obs.failures1h.filter((failure) =>
    failure.reason === reason
  );
  const times = matching.map((failure) => failure.at).sort();
  const paragraphs = [
    `${label} server events are failing: ${plainReason(reason)}.`,
  ];
  if (matching.length > 0) {
    paragraphs.push(
      `${matching.length} failed send(s) in the last hour, first at ${
        times[0]
      }, last at ${times[times.length - 1]}.`,
    );
  }
  paragraphs.push(`Fix: ${fixText(obs, reason)}`);
  paragraphs.push(
    "Failed events are retried every hour for up to 72 hours, so they recover once this is fixed.",
  );
  const bucket = Math.floor(nowMs / ALERT_DEDUPE_MS);
  return {
    channel: obs.channel,
    reason,
    subject: `[Ad tracking] ${label} server events failing: ${reason}`,
    paragraphs,
    idempotencyKey: `ad-health:${obs.channel}:${reason}:${bucket}`,
  };
}

/** The health row this run writes (alert fields set by the writer). */
export function evaluateChannelHealth(
  obs: ChannelObservation,
  previous: HealthRow | null,
  nowMs: number,
): HealthRow {
  const latestFailure = [...obs.failures1h].sort((a, b) =>
    a.at < b.at ? 1 : -1
  )[0];
  return {
    channel: obs.channel,
    lane: HEALTH_LANE,
    token_present: obs.tokenPresent,
    pixel_configured: obs.pixelConfigured,
    last_sent_at: obs.lastSentAt ?? previous?.last_sent_at ?? null,
    last_failure_at: latestFailure?.at ?? previous?.last_failure_at ?? null,
    last_failure_reason: latestFailure?.reason ??
      previous?.last_failure_reason ?? null,
    failures_1h: obs.failures1h.length,
    last_probe_at: obs.probe?.at ?? previous?.last_probe_at ?? null,
    last_probe_result: obs.probe?.result ?? previous?.last_probe_result ??
      null,
    last_alerted_at: previous?.last_alerted_at ?? null,
    last_alert_reason: previous?.last_alert_reason ?? null,
    updated_at: new Date(nowMs).toISOString(),
  };
}

export function shouldProbe(
  previous: Pick<HealthRow, "last_probe_at"> | null,
  nowMs: number,
): boolean {
  if (new Date(nowMs).getUTCHours() !== PROBE_UTC_HOUR) return false;
  const last = previous?.last_probe_at ? Date.parse(previous.last_probe_at) : NaN;
  return !Number.isFinite(last) || nowMs - last >= PROBE_MIN_INTERVAL_MS;
}

/** Map a probe send to its result. */
export function probeResultFromSend(result: SenderResult): ProbeResult {
  if (result.status === "sent") return "ok";
  const cls = classifyReason(result.reason);
  if (cls === "auth") return "auth_failed";
  if (cls === "config") return "not_configured";
  return "failed";
}

// ── Row scanning (pure) ──────────────────────────────────────────────────────

export interface ConversionHealthRow {
  created_at?: string | null;
  updated_at?: string | null;
  shared_with_platforms?: boolean | null;
  provider_response?: Record<string, unknown> | null;
  [statusColumn: string]: unknown;
}

function failedEntry(
  response: Record<string, unknown> | null | undefined,
  channel: Channel,
): string | null {
  const entry = response?.[channel];
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (record.status !== "failed") return null;
  return typeof record.reason === "string" ? record.reason : "unknown";
}

/** Failed sends per channel from rows updated in the last hour. */
export function collectFailures(
  conversions: ConversionHealthRow[],
  checkoutStarts: Array<
    { updated_at?: string | null; ad_checkout_start_provider_response?: unknown }
  >,
  channel: Channel,
): FailureEvent[] {
  const out: FailureEvent[] = [];
  for (const row of conversions) {
    const reason = failedEntry(row.provider_response ?? null, channel);
    if (reason) out.push({ reason, at: String(row.updated_at ?? "") });
  }
  for (const row of checkoutStarts) {
    const response = row.ad_checkout_start_provider_response;
    const reason = failedEntry(
      response && typeof response === "object"
        ? response as Record<string, unknown>
        : null,
      channel,
    );
    if (reason) out.push({ reason, at: String(row.updated_at ?? "") });
  }
  return out;
}

/** Expected vs sent in the last 6 h, for the "silent channel" alert. */
export function collectSendCounts(
  conversions6h: ConversionHealthRow[],
  channel: Channel,
): { expected: number; sent: number; lastSentAt: string | null } {
  let expected = 0;
  let sent = 0;
  let lastSentAt: string | null = null;
  for (const row of conversions6h) {
    if (row.shared_with_platforms !== true) continue;
    const status = row[STATUS_COL[channel]];
    // A terminal skip (consent, no Google click) was never expected to send.
    if (status !== "sent" && status !== "failed" && status !== "pending") {
      continue;
    }
    expected += 1;
    if (status === "sent") {
      sent += 1;
      const at = typeof row.updated_at === "string" ? row.updated_at : null;
      if (at && (!lastSentAt || at > lastSentAt)) lastSentAt = at;
    }
  }
  return { expected, sent, lastSentAt };
}

// ── The writer ───────────────────────────────────────────────────────────────

type SendFn = (
  input: ConversionSendInput,
  conn: SenderConnection,
  deps?: SenderDeps & SnapSenderDeps,
) => Promise<SenderResult>;

export interface AdTrackingHealthDeps {
  now?: () => number;
  getToken?: (name: string) => string | undefined;
  resolveConnection?: (
    channel: Channel,
  ) => Promise<SenderConnection>;
  /**
   * Google: resolve the upload client exactly as the sender does (OAuth mint,
   * cached about an hour by google.ts). not_configured = keys missing.
   */
  googleProbe?: () => Promise<ProbeResult>;
  senders?: Partial<Record<"meta" | "tiktok" | "snap" | "reddit", SendFn>>;
  fetchImpl?: typeof fetch;
  sendAlert?: (input: OpsAlertEmailInput) => Promise<OpsAlertEmailResult>;
  recipients?: () => string[];
}

export interface AdTrackingHealthSummary {
  ok: boolean;
  rows: HealthRow[];
  alerts: Array<{ channel: Channel; reason: string; delivered: boolean }>;
  reason?: string;
}

async function defaultGoogleProbe(): Promise<ProbeResult> {
  return await probeGoogleUploadClient(HEALTH_LANE);
}

async function testEventCodeFor(
  db: SupabaseClient,
  channel: Channel,
): Promise<string | null> {
  const { data } = await db
    .from("ad_connections")
    .select("extra")
    .eq("platform", channel)
    .eq("lane", HEALTH_LANE)
    .maybeSingle();
  const extra = (data as { extra?: Record<string, unknown> } | null)?.extra;
  const code = extra?.test_event_code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

async function runProbe(
  db: SupabaseClient,
  channel: Channel,
  conn: SenderConnection,
  deps: AdTrackingHealthDeps,
  nowMs: number,
): Promise<ProbeResult> {
  const testEventCode = channel === "snap"
    ? null
    : await testEventCodeFor(db, channel);
  if (channel !== "snap" && !testEventCode) return "skipped_no_test_code";
  const day = new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "");
  const input: ConversionSendInput = {
    eventId: `health:${channel}:${day}`,
    // Reddit has no checkout-start event; PageVisit is a standard v3 type.
    eventName: channel === "snap"
      ? "START_CHECKOUT"
      : channel === "reddit"
      ? "PageVisit"
      : "InitiateCheckout",
    valueCents: 0,
    currency: null,
    contentId: null,
    brandId: null,
    eventSourceUrl: null,
    hashedEmail: null,
    hashedPhone: null,
    fbc: null,
    fbp: null,
    externalId: null,
    externalClickId: null,
    clientIpAddress: null,
    clientUserAgent: null,
    eventTimeMs: nowMs,
    testEventCode,
  };
  const senderDeps = { getToken: deps.getToken, fetchImpl: deps.fetchImpl };
  if (channel === "snap") {
    // Step 0 Z3: Snap's validate endpoint checks key + event, records nothing.
    const send = deps.senders?.snap ?? sendSnapConversion;
    return probeResultFromSend(
      await send(input, conn, { ...senderDeps, validateOnly: true }),
    );
  }
  if (channel === "reddit") {
    // #4238 Step 0 Z5: CAPI v3 `test_id` (the Events Testing id, saved as
    // extra.test_event_code) marks the probe as a test event.
    const send = deps.senders?.reddit ?? sendRedditConversion;
    return probeResultFromSend(await send(input, conn, senderDeps));
  }
  if (channel !== "meta" && channel !== "tiktok") return "skipped_no_test_code";
  const send = deps.senders?.[channel] ??
    (channel === "meta" ? sendMetaConversion : sendTikTokConversion);
  return probeResultFromSend(await send(input, conn, senderDeps));
}

/**
 * The one writer. Reads, evaluates, alerts, upserts. Never throws: a failure
 * is returned in the summary so the retry run's response shows it.
 */
export async function runAdTrackingHealth(
  db: SupabaseClient,
  deps: AdTrackingHealthDeps = {},
): Promise<AdTrackingHealthSummary> {
  const nowMs = (deps.now ?? (() => Date.now()))();
  const getToken = deps.getToken ?? ((n: string) => resolveCapiToken(n));
  const sendAlert = deps.sendAlert ?? sendOpsAlertEmail;
  const recipients = deps.recipients ?? apiHealthAlertRecipients;
  try {
    const hourAgo = new Date(nowMs - FAILURE_WINDOW_MS).toISOString();
    const sixHoursAgo = new Date(nowMs - NO_SEND_WINDOW_MS).toISOString();
    const [previousRead, recentRead, windowRead, checkoutRead] = await Promise
      .all([
        db.from("ad_tracking_health").select("*").eq("lane", HEALTH_LANE),
        db.from("ad_conversions")
          .select(
            "updated_at,provider_response,meta_capi_status,tiktok_events_status,snap_capi_status,reddit_capi_status,google_ads_status",
          )
          .gte("updated_at", hourAgo)
          .limit(1000),
        db.from("ad_conversions")
          .select(
            "created_at,updated_at,shared_with_platforms,meta_capi_status,tiktok_events_status,snap_capi_status,reddit_capi_status,google_ads_status",
          )
          .gte("created_at", sixHoursAgo)
          .limit(1000),
        db.from("ticket_checkout_sessions")
          .select("updated_at,ad_checkout_start_provider_response")
          .gte("updated_at", hourAgo)
          .not("ad_checkout_start_provider_response", "is", null)
          .limit(1000),
      ]);
    if (previousRead.error) {
      return { ok: false, rows: [], alerts: [], reason: "health_read_failed" };
    }
    const previousByChannel = new Map<string, HealthRow>(
      ((previousRead.data ?? []) as HealthRow[]).map((row) => [row.channel, row]),
    );
    const recent = (recentRead.data ?? []) as ConversionHealthRow[];
    const window6h = (windowRead.data ?? []) as ConversionHealthRow[];
    const checkouts = (checkoutRead.data ?? []) as Array<
      { updated_at?: string | null; ad_checkout_start_provider_response?: unknown }
    >;

    const rows: HealthRow[] = [];
    const alerts: AdTrackingHealthSummary["alerts"] = [];
    for (const channel of HEALTH_CHANNELS) {
      const previous = previousByChannel.get(channel) ?? null;
      const conn = await (deps.resolveConnection
        ? deps.resolveConnection(channel)
        : resolveSenderConnection(db, channel, HEALTH_LANE));
      const tokenName = conn.tokenEnvVar?.trim() ?? null;
      const googleState = channel === "google"
        ? await (deps.googleProbe ?? defaultGoogleProbe)()
        : null;
      const tokenPresent = channel === "google"
        ? googleState !== "not_configured"
        : !!(tokenName && getToken(tokenName)?.trim());
      const pixelConfigured = channel === "google"
        ? !!conn.conversionActionResource?.trim()
        : !!conn.pixelId?.trim();
      const probe = tokenPresent && pixelConfigured &&
          shouldProbe(previous, nowMs)
        ? {
          result: googleState ?? await runProbe(db, channel, conn, deps, nowMs),
          at: new Date(nowMs).toISOString(),
        }
        : null;
      const counts = collectSendCounts(window6h, channel);
      const obs: ChannelObservation = {
        channel,
        tokenPresent,
        pixelConfigured,
        tokenEnvVar: conn.tokenEnvVar,
        failures1h: collectFailures(recent, checkouts, channel),
        lastSentAt: counts.lastSentAt,
        expected6h: counts.expected,
        sent6h: counts.sent,
        probe,
      };
      const row = evaluateChannelHealth(obs, previous, nowMs);
      const alert = buildChannelAlert(obs, previous, nowMs);
      if (alert) {
        const result = await sendAlert({
          subject: alert.subject,
          paragraphs: alert.paragraphs,
          recipients: recipients(),
          idempotencyKey: alert.idempotencyKey,
        });
        const delivered = result.succeeded > 0;
        if (delivered) {
          row.last_alerted_at = new Date(nowMs).toISOString();
          row.last_alert_reason = alert.reason;
        } else {
          console.warn("[adTrackingHealth] alert not delivered", {
            channel,
            reason: alert.reason,
            attempted: result.attempted,
            failed: result.failed,
          });
        }
        alerts.push({ channel, reason: alert.reason, delivered });
      }
      rows.push(row);
    }
    const { error: upsertError } = await db
      .from("ad_tracking_health")
      .upsert(rows, { onConflict: "channel,lane" });
    if (upsertError) {
      console.warn(
        "[adTrackingHealth] health upsert failed:",
        upsertError.message,
      );
      return { ok: false, rows, alerts, reason: "health_write_failed" };
    }
    return { ok: true, rows, alerts };
  } catch (err) {
    console.warn(
      "[adTrackingHealth] absorbed:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, rows: [], alerts: [], reason: "absorbed" };
  }
}
