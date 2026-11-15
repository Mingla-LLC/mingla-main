// MINGLA-INVARIANT: I-4238-REDDIT-CAPI-V3 | issue #4238 | the Reddit server event is a CAPI v3 event (POST /api/v3/pixels/{pixel}/conversion_events, body data.events[], event_at in Unix ms, action_source WEBSITE, upper-case tracking_type or CUSTOM + custom_event_name, metadata.conversion_id = the browser conversionId), and the daily key check marks itself with data.test_id.
/**
 * #4238 Reddit CAPI v3 migration (Step 0 Z5, carried from Wave 1). The sender
 * posted the deprecated v2.0 shape (event_type, event_metadata, ISO event_at,
 * test_mode). Field names re-read from the v3 schema on ads-api.reddit.com
 * (post-conversion-events, 14 Nov 2026). Hermetic: stub fetch, fake DB.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRedditConversionBody,
  redditEventType,
  sendRedditConversion,
} from "../redditCapi.ts";
import type { ConversionSendInput } from "../adConversionFire.ts";
import { runAdTrackingHealth } from "../adTrackingHealth.ts";

const AT = Date.parse("2026-11-14T09:00:00.000Z");

function input(overrides: Partial<ConversionSendInput> = {}): ConversionSendInput {
  return {
    eventId: "order-4238-r",
    eventName: "Purchase",
    valueCents: 2500,
    currency: "GBP",
    eventSourceUrl: "https://host.usemingla.com/e/brand/event",
    hashedEmail: "a".repeat(64),
    hashedPhone: null,
    fbc: null,
    fbp: null,
    externalClickId: "rdt-click-1",
    clientIpAddress: "203.0.113.7",
    clientUserAgent: "Mozilla/5.0",
    eventTimeMs: AT,
    ...overrides,
  };
}

type Event = Record<string, unknown> & {
  type: Record<string, unknown>;
  metadata: Record<string, unknown>;
  user?: Record<string, unknown>;
};
const firstEvent = (body: Record<string, unknown>): Event =>
  ((body.data as Record<string, unknown>).events as Event[])[0];

Deno.test("#4238 Reddit v3 a purchase is a v3 event: ms event_at, WEBSITE, PURCHASE, metadata value", () => {
  const body = buildRedditConversionBody(input());
  assertEquals(Object.keys(body), ["data"]);
  assertEquals("test_id" in (body.data as object), false);
  const event = firstEvent(body);
  assertEquals(event.event_at, AT);
  assertEquals(Number.isInteger(event.event_at), true);
  assertEquals(event.action_source, "WEBSITE");
  assertEquals(event.type, { tracking_type: "PURCHASE" });
  assertEquals(event.metadata, {
    conversion_id: "order-4238-r",
    value: 25,
    currency: "GBP",
  });
  assertEquals(event.click_id, "rdt-click-1");
  assertEquals(event.event_source_url, "https://host.usemingla.com/e/brand/event");
  assertEquals(event.user, {
    email: "a".repeat(64),
    ip_address: "203.0.113.7",
    user_agent: "Mozilla/5.0",
  });
  // No v2.0 field survives.
  for (const legacy of ["event_type", "event_metadata"]) {
    assertEquals(legacy in event, false);
  }
  assertEquals(JSON.stringify(body).includes("test_mode"), false);
  assertEquals(JSON.stringify(body).includes("value_decimal"), false);
});

Deno.test("#4238 Reddit v3 a free sign-up is SIGN_UP with no value or currency", () => {
  const event = firstEvent(buildRedditConversionBody(input({
    eventName: "SignUp",
    valueCents: 0,
    currency: null,
  })));
  assertEquals(event.type, { tracking_type: "SIGN_UP" });
  assertEquals(event.metadata, { conversion_id: "order-4238-r" });
});

Deno.test("#4238 Reddit v3 tracking types: standard names upper-case, anything else is CUSTOM with its name", () => {
  assertEquals(redditEventType("Lead"), { tracking_type: "LEAD" });
  assertEquals(redditEventType("PageVisit"), { tracking_type: "PAGE_VISIT" });
  assertEquals(redditEventType("PURCHASE"), { tracking_type: "PURCHASE" });
  assertEquals(redditEventType("HostSignUp"), {
    tracking_type: "CUSTOM",
    custom_event_name: "HostSignUp",
  });
  assertEquals(
    redditEventType("x".repeat(80)).custom_event_name,
    "x".repeat(64),
  );
});

Deno.test("#4238 Reddit v3 a test code rides as data.test_id", () => {
  const body = buildRedditConversionBody(input({ testEventCode: " t2_test4238 " }));
  assertEquals((body.data as Record<string, unknown>).test_id, "t2_test4238");
});

Deno.test("#4238 Reddit v3 the sender posts to the v3 pixel path with the bearer token", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  const result = await sendRedditConversion(input(), {
    pixelId: "a2_jcfwvnfcfqcs",
    tokenEnvVar: "REDDIT_ADS_CAPI_TOKEN",
  }, { fetchImpl, getToken: () => "rtok" });
  assertEquals(result.status, "sent");
  assertEquals(
    calls[0].url,
    "https://ads-api.reddit.com/api/v3/pixels/a2_jcfwvnfcfqcs/conversion_events",
  );
  assertEquals(
    (calls[0].init.headers as Record<string, string>).Authorization,
    "Bearer rtok",
  );
  assertEquals(
    firstEvent(JSON.parse(String(calls[0].init.body))).metadata.conversion_id,
    "order-4238-r",
  );
});

Deno.test("#4238 Reddit v3 the daily key check sends a PageVisit with test_id and reads 401 as auth_failed", async () => {
  const probeHour = Date.parse("2026-11-14T06:05:00.000Z");
  const tables: Record<string, unknown[]> = {
    ad_tracking_health: [],
    ad_conversions: [],
    ticket_checkout_sessions: [],
    ad_connections: [{ extra: { test_event_code: "t2_test4238" } }],
  };
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      not: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  const posted: Record<string, unknown>[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    if (url.includes("ads-api.reddit.com/api/v3/pixels/")) {
      posted.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response("{}", { status: 401 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  const summary = await runAdTrackingHealth(
    { from } as unknown as Parameters<typeof runAdTrackingHealth>[0],
    {
      now: () => probeHour,
      getToken: () => "synthetic-token",
      resolveConnection: (channel) =>
        Promise.resolve(
          channel === "reddit"
            ? { pixelId: "a2_x", tokenEnvVar: "REDDIT_ADS_CAPI_TOKEN" }
            : { pixelId: null, tokenEnvVar: null },
        ),
      googleProbe: () => Promise.resolve("ok"),
      senders: {
        meta: () => Promise.resolve({ channel: "meta", status: "sent" }),
        tiktok: () => Promise.resolve({ channel: "tiktok", status: "sent" }),
        snap: () => Promise.resolve({ channel: "snap", status: "sent" }),
      },
      fetchImpl,
      sendAlert: () => Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 }),
      recipients: () => ["ops@mingla-fixture.org"],
    },
  );
  const reddit = summary.rows.find((row) => row.channel === "reddit");
  assertEquals(reddit?.last_probe_result, "auth_failed");
  assertEquals(posted.length, 1);
  assertEquals((posted[0].data as Record<string, unknown>).test_id, "t2_test4238");
  const event = firstEvent(posted[0]);
  assertEquals(event.type, { tracking_type: "PAGE_VISIT" });
  assertEquals(event.metadata, { conversion_id: "health:reddit:20261114" });
});
