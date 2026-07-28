/**
 * ISSUE-1267 — Google Ads, the 5th server-side conversion lane (NEW, append-only).
 *
 * Google is a click-conversion UPLOAD (uploadClickConversions / Enhanced
 * Conversions), NOT an event POST — but it rides the SAME fireAdConversion
 * fan-out with the SAME fail-open contract as the 4 CAPI senders. This battery
 * covers, hermetically (injected resolveClient + requestImpl seams — NO global
 * fetch, NO network, NO real DB):
 *   • the upload WIRE shape (endpoint, gclid, conversionAction, dateTime, value,
 *     currency, orderId, partialFailure:true);
 *   • Enhanced-Conversions userIdentifiers (already-hashed email/phone, SC-9);
 *   • the TWO-TIER value (paid = fee value, free RSVP = 0);
 *   • validateOnly passthrough (deploy live-validation, zero real objects);
 *   • FAIL-OPEN skips (pending_config when unprovisioned / client throws; no_gclid)
 *     and FAIL-OPEN failure (a platform/API throw is absorbed, never propagated);
 *   • google_ads_status IN the redelivery-dedup gate — a re-delivered webhook
 *     re-fires Google NOTHING once the lane is settled, still fires it when the
 *     lane is genuinely pending (back-fill), and treats an absent column as
 *     settled (the pre-google-lane row shape stays deduped);
 *   • resolveSenderConnection resolves the conversion-action resource + consent;
 *   • the conversion-action provisioning builders (create op + resource parse).
 *
 * fails-on-revert: drop google from the pending-check gate/SELECT and the
 * "redelivery re-fires nothing" / "absent-column stays deduped" cases flip; drop
 * the two-tier passthrough and the free-RSVP-value case flips.
 */

import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { GoogleClient } from "../google.ts";
import {
  buildConversionActionCreateOperation,
  formatGoogleConversionDateTime,
  parseConversionActionResourceName,
  sendGoogleConversion,
} from "../googleConversionUpload.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderConnection,
  type SenderResult,
} from "../adConversionFire.ts";

const CONVERSION_ACTION = "customers/1234567890/conversionActions/555";

const FAKE_CLIENT = {
  platform: "google",
  accessToken: "ya29.fake",
  developerToken: "dev",
  customerId: "1234567890",
  loginCustomerId: "9999999999",
  apiVersion: "v24",
  apiBase: "https://googleads.googleapis.com",
} as unknown as GoogleClient;

/** A requestImpl that records calls and returns a canned upload response. */
function captureRequest(payload: Record<string, unknown> = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const impl = (
    _client: GoogleClient,
    path: string,
    body: Record<string, unknown>,
  ) => {
    calls.push({ path, body });
    return Promise.resolve({ payload, requestId: "req-123" });
  };
  return { impl, calls };
}

function baseInput(
  overrides: Partial<ConversionSendInput> = {},
): ConversionSendInput {
  return {
    eventId: "order-1267",
    eventName: "Purchase",
    valueCents: 2500,
    currency: "GBP",
    eventSourceUrl: "https://usemingla.com/e/brand/event",
    hashedEmail: "a".repeat(64),
    hashedPhone: "b".repeat(64),
    fbc: null,
    fbp: null,
    externalClickId: "GCLID_ABC123",
    clientIpAddress: null,
    clientUserAgent: null,
    eventTimeMs: 1_700_000_000_000, // 2023-11-14T22:13:20.000Z
    ...overrides,
  };
}

function googleConn(
  overrides: Partial<SenderConnection> = {},
): SenderConnection {
  return {
    pixelId: null,
    tokenEnvVar: null,
    lane: "consumer",
    conversionActionResource: CONVERSION_ACTION,
    ...overrides,
  };
}

// ── Sender WIRE shape ─────────────────────────────────────────────────────────

Deno.test("googleConversionUpload: wire shape — endpoint, gclid, conversionAction, dateTime, value, currency, orderId, partialFailure", async () => {
  const { impl, calls } = captureRequest();
  const res = await sendGoogleConversion(baseInput(), googleConn(), {
    resolveClient: () => Promise.resolve(FAKE_CLIENT),
    requestImpl: impl,
  });
  assertEquals(res.status, "sent");
  assertEquals(res.channel, "google");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].path, "customers/1234567890:uploadClickConversions");
  assertEquals(calls[0].body.partialFailure, true);
  assertEquals(calls[0].body.validateOnly, undefined); // not a validate run
  const conv = (calls[0].body.conversions as Record<string, unknown>[])[0];
  assertEquals(conv.gclid, "GCLID_ABC123");
  assertEquals(conv.conversionAction, CONVERSION_ACTION);
  assertEquals(conv.orderId, "order-1267"); // shared dedup key
  assertEquals(conv.conversionValue, 25); // 2500c -> 25.00
  assertEquals(conv.currencyCode, "GBP");
  assertMatch(
    conv.conversionDateTime as string,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+00:00$/,
  );
});

Deno.test("googleConversionUpload: Enhanced-Conversions userIdentifiers carry the already-hashed email + phone (SC-9)", async () => {
  const { impl, calls } = captureRequest();
  await sendGoogleConversion(baseInput(), googleConn(), {
    resolveClient: () => Promise.resolve(FAKE_CLIENT),
    requestImpl: impl,
  });
  const conv = (calls[0].body.conversions as Record<string, unknown>[])[0];
  const ids = conv.userIdentifiers as Record<string, unknown>[];
  assertEquals(ids.length, 2);
  assertEquals(ids[0], {
    hashedEmail: "a".repeat(64),
    userIdentifierSource: "FIRST_PARTY",
  });
  assertEquals(ids[1], {
    hashedPhoneNumber: "b".repeat(64),
    userIdentifierSource: "FIRST_PARTY",
  });
  // No plaintext PII was passed in this path (the fire helper hashes upstream),
  // but assert the hashes are 64-hex just as the wire carries them.
  assertMatch(ids[0].hashedEmail as string, /^[0-9a-f]{64}$/);
});

// ── TWO-TIER value (paid = fee value, free RSVP = 0) ──────────────────────────

Deno.test("googleConversionUpload: TWO-TIER — a PAID conversion carries the fee value + currency", async () => {
  const { impl, calls } = captureRequest();
  await sendGoogleConversion(
    baseInput({ valueCents: 4200, currency: "USD" }),
    googleConn(),
    { resolveClient: () => Promise.resolve(FAKE_CLIENT), requestImpl: impl },
  );
  const conv = (calls[0].body.conversions as Record<string, unknown>[])[0];
  assertEquals(conv.conversionValue, 42);
  assertEquals(conv.currencyCode, "USD");
});

Deno.test("googleConversionUpload: TWO-TIER — a FREE RSVP uploads conversionValue 0 with no currency", async () => {
  const { impl, calls } = captureRequest();
  await sendGoogleConversion(
    baseInput({ valueCents: 0, currency: null }),
    googleConn(),
    { resolveClient: () => Promise.resolve(FAKE_CLIENT), requestImpl: impl },
  );
  const conv = (calls[0].body.conversions as Record<string, unknown>[])[0];
  assertEquals(conv.conversionValue, 0); // driven customer, never revenue
  assertEquals(conv.currencyCode, undefined);
});

// ── validateOnly passthrough (deploy live-validation, zero real objects) ──────

Deno.test("googleConversionUpload: validateOnly=true → body.validateOnly:true (zero real conversion objects)", async () => {
  const { impl, calls } = captureRequest();
  const res = await sendGoogleConversion(baseInput(), googleConn(), {
    resolveClient: () => Promise.resolve(FAKE_CLIENT),
    requestImpl: impl,
    validateOnly: true,
  });
  assertEquals(res.status, "sent");
  assertEquals(calls[0].body.validateOnly, true);
  assertEquals(calls[0].body.partialFailure, true); // still required true
});

// ── CONSENT-MODE (config-driven; omitted → UNSPECIFIED) ───────────────────────

Deno.test("googleConversionUpload: consent block is emitted only when configured on the connection", async () => {
  const withConsent = captureRequest();
  await sendGoogleConversion(
    baseInput(),
    googleConn({
      consent: { adUserData: "GRANTED", adPersonalization: "DENIED" },
    }),
    {
      resolveClient: () => Promise.resolve(FAKE_CLIENT),
      requestImpl: withConsent.impl,
    },
  );
  const convWith =
    (withConsent.calls[0].body.conversions as Record<string, unknown>[])[0];
  assertEquals(convWith.consent, {
    adUserData: "GRANTED",
    adPersonalization: "DENIED",
  });

  const noConsent = captureRequest();
  await sendGoogleConversion(baseInput(), googleConn(), {
    resolveClient: () => Promise.resolve(FAKE_CLIENT),
    requestImpl: noConsent.impl,
  });
  const convNone =
    (noConsent.calls[0].body.conversions as Record<string, unknown>[])[0];
  assertEquals(convNone.consent, undefined);
});

// ── FAIL-OPEN skips (never throws, never egresses while unconfigured) ─────────

Deno.test("googleConversionUpload: no conversion_action_resource → skipped 'pending_config', NO request (mirror reddit SC-12)", async () => {
  const { impl, calls } = captureRequest();
  const res = await sendGoogleConversion(
    baseInput(),
    googleConn({ conversionActionResource: null }),
    { resolveClient: () => Promise.resolve(FAKE_CLIENT), requestImpl: impl },
  );
  assertEquals(res.status, "skipped");
  assertEquals(res.reason, "pending_config");
  assertEquals(calls.length, 0); // never resolves a client / POSTs while unconfigured
});

Deno.test("googleConversionUpload: no google gclid → skipped 'no_gclid', NO request", async () => {
  const { impl, calls } = captureRequest();
  const res = await sendGoogleConversion(
    baseInput({ externalClickId: null }),
    googleConn(),
    { resolveClient: () => Promise.resolve(FAKE_CLIENT), requestImpl: impl },
  );
  assertEquals(res.status, "skipped");
  assertEquals(res.reason, "no_gclid");
  assertEquals(calls.length, 0);
});

Deno.test("googleConversionUpload: resolveClient throws (lane unprovisioned) → skipped 'pending_config', NEVER throws", async () => {
  const { impl, calls } = captureRequest();
  let threw = false;
  let res: SenderResult | undefined;
  try {
    res = await sendGoogleConversion(baseInput(), googleConn(), {
      resolveClient: () => {
        throw new Error("google_not_provisioned");
      },
      requestImpl: impl,
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, false); // fail-open: a post-paid, off-critical-path send never throws
  assertEquals(res?.status, "skipped");
  assertEquals(res?.reason, "pending_config");
  assertEquals(calls.length, 0);
});

// ── FAIL-OPEN failure (a platform/API throw is absorbed as 'failed') ──────────

Deno.test("googleConversionUpload: a requestImpl throw is absorbed as 'failed', NEVER propagated (RT-1)", async () => {
  let threw = false;
  let res: SenderResult | undefined;
  try {
    res = await sendGoogleConversion(baseInput(), googleConn(), {
      resolveClient: () => Promise.resolve(FAKE_CLIENT),
      requestImpl: () => Promise.reject(new Error("http_500")),
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, false);
  assertEquals(res?.status, "failed");
});

Deno.test("googleConversionUpload: a 200 with a populated partialFailureError is a soft 'failed'", async () => {
  const { impl } = captureRequest({
    partialFailureError: { code: 3, message: "invalid gclid" },
  });
  const res = await sendGoogleConversion(baseInput(), googleConn(), {
    resolveClient: () => Promise.resolve(FAKE_CLIENT),
    requestImpl: impl,
  });
  assertEquals(res.status, "failed");
  assertEquals(res.reason, "partial_failure");
});

// ── Provisioning builders (conversion-action create op + resource parse) ──────

Deno.test("buildConversionActionCreateOperation: PURCHASE / UPLOAD_CLICKS / ONE_PER_CLICK + clamped attribution window", () => {
  const op = buildConversionActionCreateOperation();
  const create = op.create as Record<string, unknown>;
  assertEquals(create.category, "PURCHASE");
  assertEquals(create.type, "UPLOAD_CLICKS");
  assertEquals(create.countingType, "ONE_PER_CLICK");
  assertEquals(create.status, "ENABLED");
  assertEquals(create.clickThroughLookbackWindowDays, 30); // default

  assertEquals(
    (buildConversionActionCreateOperation({ attributionWindowDays: 45 })
      .create as Record<string, unknown>).clickThroughLookbackWindowDays,
    45,
  );
  // clamp to Google's 1..90 range
  assertEquals(
    (buildConversionActionCreateOperation({ attributionWindowDays: 999 })
      .create as Record<string, unknown>).clickThroughLookbackWindowDays,
    90,
  );
  assertEquals(
    (buildConversionActionCreateOperation({ attributionWindowDays: 0 })
      .create as Record<string, unknown>).clickThroughLookbackWindowDays,
    1,
  );
});

Deno.test("parseConversionActionResourceName: first resourceName, else null; formatGoogleConversionDateTime shape", () => {
  assertEquals(
    parseConversionActionResourceName({
      results: [{ resourceName: "customers/1/conversionActions/9" }],
    }),
    "customers/1/conversionActions/9",
  );
  assertEquals(parseConversionActionResourceName({ results: [] }), null);
  assertEquals(parseConversionActionResourceName({}), null);
  assertEquals(
    formatGoogleConversionDateTime(1_700_000_000_000),
    "2023-11-14 22:13:20+00:00",
  );
});

// ── fireAdConversion INTEGRATION — google in the redelivery-dedup gate ────────

interface FakeTables {
  orders?: Record<string, unknown> | null;
  events?: Record<string, unknown> | null;
  ticket_checkout_sessions?: Record<string, unknown> | null;
  ad_conversions?: Record<string, unknown> | null;
  ad_attribution_touches?: Record<string, unknown> | null;
  ad_connections?: Record<string, unknown> | null;
}

function makeFakeSupabase(tables: FakeTables) {
  const from = (table: string) => {
    const canned = (tables as Record<string, unknown>)[table] ?? null;
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve({ data: canned, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      update: () => builder,
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: canned, error: null }),
    };
    return builder;
  };
  return { from } as unknown as Parameters<typeof fireAdConversion>[0];
}

function spyGoogle(record: string[]) {
  return (
    input: ConversionSendInput,
    conn: SenderConnection,
  ): Promise<SenderResult> => {
    record.push(
      `google:${input.eventId}:${conn.conversionActionResource ?? "no-action"}`,
    );
    return Promise.resolve({ channel: "google", status: "sent" });
  };
}

const ORDER = {
  orders: {
    id: "evt-1267",
    event_id: "ev",
    total_cents: 2500,
    currency: "GBP",
    buyer_email: "b@x.com",
    buyer_phone: "+447700900000",
  },
  events: { brand_id: "brand-1" },
};

Deno.test("fireAdConversion: google_ads_status IN the dedup gate — a settled google lane re-fires NOTHING on webhook redelivery", async () => {
  const record: string[] = [];
  const client = makeFakeSupabase({
    ...ORDER,
    ad_conversions: {
      event_id: "evt-1267",
      meta_capi_status: "sent",
      tiktok_events_status: "sent",
      snap_capi_status: "sent",
      reddit_capi_status: "skipped",
      google_ads_status: "sent", // Google already fired
    },
  });
  const res = await fireAdConversion(client, { orderId: "evt-1267" }, {
    senders: { google: spyGoogle(record) },
  });
  assertEquals(res.deduped, true);
  assertEquals(record.length, 0); // redelivery → Google re-fires nothing
});

Deno.test("fireAdConversion: a genuinely-pending google lane STILL fires on redelivery (back-fill) even when the other 4 are settled", async () => {
  const record: string[] = [];
  const client = makeFakeSupabase({
    ...ORDER,
    ad_conversions: {
      event_id: "evt-1267",
      meta_capi_status: "sent",
      tiktok_events_status: "sent",
      snap_capi_status: "sent",
      reddit_capi_status: "skipped",
      google_ads_status: "pending", // never fired (added lane / prior failure)
    },
    ad_connections: {
      extra: { conversion_action_resource: CONVERSION_ACTION },
    },
  });
  const res = await fireAdConversion(client, { orderId: "evt-1267" }, {
    senders: { google: spyGoogle(record) },
  });
  assertEquals(res.deduped, false);
  // ONLY google fires (the other 4 are settled → skipped in the fan-out loop).
  assertEquals(record, [`google:evt-1267:${CONVERSION_ACTION}`]);
});

Deno.test("fireAdConversion: a pre-google-lane row (google_ads_status ABSENT) with the 4 old lanes settled STAYS deduped — no spurious re-fire", async () => {
  const record: string[] = [];
  const client = makeFakeSupabase({
    ...ORDER,
    ad_conversions: {
      event_id: "evt-1267",
      meta_capi_status: "sent",
      tiktok_events_status: "sent",
      snap_capi_status: "sent",
      reddit_capi_status: "skipped",
      // google_ads_status intentionally ABSENT (the row shape from before #1267).
    },
  });
  const res = await fireAdConversion(client, { orderId: "evt-1267" }, {
    senders: { google: spyGoogle(record) },
  });
  assertEquals(res.deduped, true); // absent column ≠ fresh-pending → treated settled
  assertEquals(record.length, 0);
});

Deno.test("fireAdConversion: resolveSenderConnection feeds google the conversion-action resource + consent from ad_connections.extra", async () => {
  const record: string[] = [];
  let capturedConn: SenderConnection | undefined;
  const client = makeFakeSupabase({
    ...ORDER,
    ad_conversions: null, // fresh → fires
    ad_connections: {
      extra: {
        conversion_action_resource: CONVERSION_ACTION,
        consent: { ad_user_data: "GRANTED", ad_personalization: "GRANTED" },
      },
    },
  });
  const capturingGoogle = (
    input: ConversionSendInput,
    conn: SenderConnection,
  ): Promise<SenderResult> => {
    capturedConn = conn;
    record.push(`google:${input.eventId}`);
    return Promise.resolve({ channel: "google", status: "sent" });
  };
  await fireAdConversion(client, { orderId: "evt-1267" }, {
    senders: { google: capturingGoogle },
  });
  assertEquals(capturedConn?.conversionActionResource, CONVERSION_ACTION);
  assertEquals(capturedConn?.consent, {
    adUserData: "GRANTED",
    adPersonalization: "GRANTED",
  });
});
