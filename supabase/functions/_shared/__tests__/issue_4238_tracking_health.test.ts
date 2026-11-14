// MINGLA-INVARIANT: I-4238-MISSING-KEY-LOUD | issue #4238 | the hourly tracking-health run records key presence per channel and sends one alert per (channel, reason) per 6 h; consent skips never alert; a config/auth failure is retried for 72 h while any other failure keeps the 24 h window.
/**
 * #4238 W1-2 (D15, D2 detection). The health pass that would have caught the
 * 30 Oct to 12 Nov outage with no traffic at all. Hermetic: fake DB, fake
 * alert sender, fake token getter. No network, no real token.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AdTrackingHealthDeps,
  type HealthRow,
  runAdTrackingHealth,
} from "../adTrackingHealth.ts";
import {
  type AdConversionRetryRow,
  retryableChannels,
} from "../adConversionRetry.ts";
import type { Channel, SenderConnection } from "../adConversionFire.ts";
import type { OpsAlertEmailInput } from "../stripeOpsAlertEmail.ts";

const NOW = Date.parse("2026-11-14T10:30:00.000Z"); // not the 06:00 probe hour

type Tables = Record<string, unknown[]>;

/** Fake supabase: every read returns the table's rows; upserts are captured. */
function fakeDb(tables: Tables) {
  const upserts: Array<{ table: string; rows: unknown }> = [];
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      not: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      upsert: (value: unknown) => {
        upserts.push({ table, rows: value });
        if (table === "ad_tracking_health") {
          tables.ad_tracking_health = value as unknown[];
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return {
    client: { from } as unknown as Parameters<typeof runAdTrackingHealth>[0],
    upserts,
    tables,
  };
}

const CONNECTIONS: Record<Channel, SenderConnection> = {
  meta: { pixelId: "px-meta", tokenEnvVar: "META_CAPI_ACCESS_TOKEN" },
  tiktok: { pixelId: "D9B98EBC77U1EOHV2O0G", tokenEnvVar: "TIKTOK_EVENTS_ACCESS_TOKEN" },
  snap: { pixelId: "px-snap", tokenEnvVar: "SNAPCHAT_CAPI_TOKEN" },
  reddit: { pixelId: "a2_x", tokenEnvVar: "REDDIT_ADS_CAPI_TOKEN" },
  google: {
    pixelId: null,
    tokenEnvVar: null,
    conversionActionResource: "customers/1/conversionActions/2",
  },
};

function harness(present: Set<string>, nowMs = NOW) {
  const alerts: OpsAlertEmailInput[] = [];
  const deps: AdTrackingHealthDeps = {
    now: () => nowMs,
    getToken: (name) => (present.has(name) ? "synthetic-token" : undefined),
    resolveConnection: (channel) => Promise.resolve(CONNECTIONS[channel]),
    googleProbe: () => Promise.resolve("ok"),
    sendAlert: (input) => {
      alerts.push(input);
      return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
    },
    recipients: () => ["ops@mingla-fixture.org"],
  };
  return { deps, alerts };
}

const ALL_KEYS = new Set([
  "META_CAPI_ACCESS_TOKEN",
  "TIKTOK_EVENTS_ACCESS_TOKEN",
  "SNAPCHAT_CAPI_TOKEN",
  "REDDIT_ADS_CAPI_TOKEN",
]);

Deno.test("#4238 W1-2 (a) a missing key is recorded and alerts once; a second run within 6 h does not", async () => {
  const present = new Set(ALL_KEYS);
  present.delete("META_CAPI_ACCESS_TOKEN");
  const db = fakeDb({ ad_tracking_health: [], ad_conversions: [], ticket_checkout_sessions: [] });
  const first = harness(present);
  const summary = await runAdTrackingHealth(db.client, first.deps);
  assertEquals(summary.ok, true);
  const meta = summary.rows.find((row) => row.channel === "meta") as HealthRow;
  assertEquals(meta.token_present, false);
  assertEquals(meta.last_alert_reason, "no_token");
  assertEquals(
    summary.rows.filter((row) => row.channel !== "meta").every((row) => row.token_present),
    true,
  );
  assertEquals(first.alerts.length, 1);
  assertEquals(first.alerts[0].subject, "[Ad tracking] Meta server events failing: no_token");
  assertEquals(
    first.alerts[0].paragraphs.some((line) =>
      line.includes("Put META_CAPI_ACCESS_TOKEN back into AD_CONVERSION_TOKENS")
    ),
    true,
  );
  // Names only: the email never carries a token value.
  assertEquals(JSON.stringify(first.alerts).includes("synthetic-token"), false);

  const second = harness(present, NOW + 60 * 60 * 1000);
  await runAdTrackingHealth(db.client, second.deps);
  assertEquals(second.alerts.length, 0);

  const later = harness(present, NOW + 7 * 60 * 60 * 1000);
  await runAdTrackingHealth(db.client, later.deps);
  assertEquals(later.alerts.length, 1, "re-alerts after the 6 h window");
});

Deno.test("#4238 W1-2 (b) three http_401 failures in the last hour raise one auth alert", async () => {
  const failed = (minutesAgo: number) => ({
    updated_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
    provider_response: { tiktok: { status: "failed", reason: "http_401", http: 401 } },
    tiktok_events_status: "failed",
  });
  const db = fakeDb({
    ad_tracking_health: [],
    ad_conversions: [failed(10), failed(20), failed(30)],
    ticket_checkout_sessions: [],
  });
  const { deps, alerts } = harness(ALL_KEYS);
  const summary = await runAdTrackingHealth(db.client, deps);
  const tiktok = summary.rows.find((row) => row.channel === "tiktok") as HealthRow;
  assertEquals(tiktok.failures_1h, 3);
  assertEquals(tiktok.last_failure_reason, "http_401");
  assertEquals(alerts.length, 1);
  assertEquals(alerts[0].subject, "[Ad tracking] TikTok server events failing: http_401");
  assertEquals(alerts[0].idempotencyKey?.startsWith("ad-health:tiktok:http_401:"), true);
});

Deno.test("#4238 W1-2 (c) consent-skipped rows never alert", async () => {
  const skipped = {
    created_at: new Date(NOW - 30 * 60_000).toISOString(),
    updated_at: new Date(NOW - 30 * 60_000).toISOString(),
    shared_with_platforms: false,
    provider_response: {
      meta: { status: "skipped", reason: "consent_rejected" },
      tiktok: { status: "skipped", reason: "consent_rejected" },
    },
    meta_capi_status: "skipped",
    tiktok_events_status: "skipped",
    snap_capi_status: "skipped",
    reddit_capi_status: "skipped",
    google_ads_status: "skipped",
  };
  const db = fakeDb({
    ad_tracking_health: [],
    ad_conversions: [skipped, skipped, skipped, skipped],
    ticket_checkout_sessions: [],
  });
  const { deps, alerts } = harness(ALL_KEYS);
  const summary = await runAdTrackingHealth(db.client, deps);
  assertEquals(summary.ok, true);
  assertEquals(alerts.length, 0);
});

Deno.test("#4238 W1-2 a consented conversion with no send in 6 h alerts no_send_6h", async () => {
  const pending = {
    created_at: new Date(NOW - 3 * 60 * 60_000).toISOString(),
    updated_at: new Date(NOW - 3 * 60 * 60_000).toISOString(),
    shared_with_platforms: true,
    provider_response: {},
    meta_capi_status: "sent",
    tiktok_events_status: "sent",
    snap_capi_status: "pending",
    reddit_capi_status: "sent",
    google_ads_status: "skipped",
  };
  const db = fakeDb({ ad_tracking_health: [], ad_conversions: [pending], ticket_checkout_sessions: [] });
  const { deps, alerts } = harness(ALL_KEYS);
  await runAdTrackingHealth(db.client, deps);
  assertEquals(alerts.map((alert) => alert.subject), [
    "[Ad tracking] Snapchat server events failing: no_send_6h",
  ]);
});

Deno.test("#4238 W1-2 the 06:00 UTC probe uses the test event code and records auth_failed on 401", async () => {
  const probeHour = Date.parse("2026-11-14T06:05:00.000Z");
  const db = fakeDb({
    ad_tracking_health: [],
    ad_conversions: [],
    ticket_checkout_sessions: [],
    ad_connections: [{ extra: { test_event_code: "TEST123" } }],
  });
  const { deps, alerts } = harness(ALL_KEYS, probeHour);
  const seen: Array<{ channel: string; eventId: string; testEventCode: string | null | undefined; validateOnly?: boolean }> = [];
  deps.senders = {
    meta: (input) => {
      seen.push({ channel: "meta", eventId: input.eventId, testEventCode: input.testEventCode });
      return Promise.resolve({ channel: "meta", status: "sent" });
    },
    tiktok: (input) => {
      seen.push({ channel: "tiktok", eventId: input.eventId, testEventCode: input.testEventCode });
      return Promise.resolve({ channel: "tiktok", status: "failed", reason: "http_401", httpStatus: 401 });
    },
    snap: (input, _conn, senderDeps) => {
      seen.push({ channel: "snap", eventId: input.eventId, testEventCode: input.testEventCode, validateOnly: senderDeps?.validateOnly });
      return Promise.resolve({ channel: "snap", status: "sent" });
    },
  };
  const summary = await runAdTrackingHealth(db.client, deps);
  const byChannel = new Map(summary.rows.map((row) => [row.channel, row]));
  assertEquals(byChannel.get("meta")?.last_probe_result, "ok");
  assertEquals(byChannel.get("tiktok")?.last_probe_result, "auth_failed");
  assertEquals(byChannel.get("snap")?.last_probe_result, "ok");
  assertEquals(byChannel.get("reddit")?.last_probe_result, "skipped_no_test_code");
  assertEquals(byChannel.get("google")?.last_probe_result, "ok");
  assertEquals(seen.find((call) => call.channel === "meta"), {
    channel: "meta",
    eventId: "health:meta:20261114",
    testEventCode: "TEST123",
  });
  assertEquals(seen.find((call) => call.channel === "snap")?.validateOnly, true);
  assertEquals(alerts.map((alert) => alert.subject), [
    "[Ad tracking] TikTok server events failing: probe_auth_failed",
  ]);
});

const retryRow = (
  createdHoursAgo: number,
  reason: string,
): AdConversionRetryRow => ({
  event_id: "order-1",
  order_id: "order-1",
  stay_group_id: null,
  event_type: "purchase",
  surface: "web",
  lane: "consumer",
  created_at: new Date(NOW - createdHoursAgo * 60 * 60 * 1000).toISOString(),
  updated_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
  provider_response: { meta: { status: "failed", reason } },
  meta_capi_status: "failed",
  tiktok_events_status: "sent",
  snap_capi_status: "sent",
  reddit_capi_status: "sent",
  google_ads_status: "skipped",
});

Deno.test("#4238 W1-2 (d) a 30-hour-old no_token row goes back to pending; a 30-hour-old http_500 row does not", () => {
  assertEquals(retryableChannels(retryRow(30, "no_token"), NOW), {
    meta_capi_status: "pending",
  });
  assertEquals(retryableChannels(retryRow(30, "http_401"), NOW), {
    meta_capi_status: "pending",
  });
  assertEquals(retryableChannels(retryRow(30, "http_500"), NOW), {});
  // Inside 24 h every failure retries (unchanged #3697 behaviour).
  assertEquals(retryableChannels(retryRow(2, "http_500"), NOW), {
    meta_capi_status: "pending",
  });
  // Past 72 h nothing retries.
  assertEquals(retryableChannels(retryRow(73, "no_token"), NOW), {});
});
