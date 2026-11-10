// #4273 (country switches) — marketing-send reads each country's switch and
// the marketing sender from public.sms_country_switches /
// sms_marketing_sender_config, through the REAL adapter (fetch stubbed):
//
// T-M1 GB switched on: one Twilio POST carrying the DB marketing SID and the
//      opt-out link, no "Reply STOP".
// T-M2 GB switched off: skipped as unpriced, zero provider HTTP, no row.
// T-M3 switches unreadable: a sealed send is re-parked (retry_later) with no
//      message row and an ops alert naming the switches; a legacy send records
//      every number as sms_rate_book_unavailable; nothing is texted.
// T-M4 today's seed (US and NG on) sends exactly as on 28f88fea6d: US on the
//      toll-free service (no override), NG on Termii generic; with the bundle
//      US master switch off (DB still on), US is not texted (SC-9).
// T-M5 the quote: unreadable switches → BOOK_BLAST_RATE_BOOK_UNAVAILABLE.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import {
  marketingBookQuoteErrorCode,
  processClaimedCampaigns,
  smsQuoteInputs,
} from "./index.ts";
import { buildMarketingBookQuote } from "../_shared/marketingBookQuote.ts";
import { MAPPED_COUNTRIES } from "../_shared/e164Country.ts";
import { SMS_COUNTRIES } from "../_shared/smsCountries.ts";
import { smsRatesFromRows } from "../_shared/smsPriceTable.ts";
import {
  seededSmsSwitches,
  TEST_MARKETING_SERVICE_SID,
} from "../_shared/__tests__/_issue4273SmsSwitchesFixture.ts";

const US = "+12025550142";
const NG = "+2348031104273";
const GB = "+447700900123";
// Monday 17:00Z: Washington 12:00, London 17:00, Lagos 18:00 — all open.
const SEND_AT = new Date("2026-11-09T17:00:00Z");

const ENV: Record<string, string> = {
  MINGLA_DELIVERY_FLAGS_JSON: JSON.stringify({
    schema_version: 1,
    marketing_send_live_enabled: true,
    sms_live_enabled: { us: true, ng: true },
  }),
  TWILIO_ACCOUNT_SID: "AC4273switch",
  TWILIO_AUTH_TOKEN: "tok4273switch",
  TWILIO_MESSAGING_SERVICE_SID: "MG4273tollfree",
  TERMII_API_KEY: "tk4273switch",
  TERMII_BASE_URL: "https://termii.switch.test",
  TERMII_SENDER_ID: "Mingla",
  UNSUBSCRIBE_TOKEN_SECRET: "issue4273-switch-secret-0123456789abcdef",
  MINGLA_TRACKING_LINK_ORIGIN: "https://usemingla.com/m",
};

type Write = { table: string; op: string; payload: unknown };

function switchesRow(on: Set<string>) {
  return {
    marketingServiceSid: TEST_MARKETING_SERVICE_SID,
    countries: MAPPED_COUNTRIES.map((country) => {
      const sender = SMS_COUNTRIES[country].sender;
      return {
        country,
        marketingEnabled: on.has(country),
        sender: sender === "alphanumeric"
          ? "marketing_service"
          : sender === "needs_number"
          ? "needs_local_number"
          : sender,
        registrationRequired: SMS_COUNTRIES[country].registrationRequired,
        registrationDone: false,
      };
    }),
  };
}

function fakeDb(
  phones: string[],
  sealed: boolean,
  switchesRpc: () => { data: unknown; error: unknown } = () => ({
    data: null,
    error: { message: "not used" },
  }),
) {
  const brandId = "42730000-0000-4000-8000-0000000000b1";
  const writes: Write[] = [];
  const row = (key: string, phone: string) => ({
    contact_key: key,
    display_name: "Guest",
    first_name: "Guest",
    raw_email: null,
    raw_phone: phone,
    order_count: 1,
    total_spend_minor: 0,
    total_spend_currency: "USD",
    last_event_id: null,
    last_event_name: null,
    last_purchase_at: null,
    email_marketing_ok: false,
    sms_marketing_ok: true,
  });
  const priceRows = [
    ["US", "twilio", "USD", 83, 100],
    ["NG", "termii", "NGN", 500, 1],
    ["GB", "twilio", "USD", 560, 100],
  ].map(([country, provider, currency, n, d]) => ({
    country,
    provider,
    currency,
    minor_numerator: n,
    minor_denominator: d,
    source: provider === "termii" ? "termii_fixed" : "twilio_pricing_api",
    source_reference: `${country}-test`,
    fetched_at: "2026-11-08T06:17:00.000Z",
  }));
  const builder = (table: string) => {
    let op = "select";
    const filters: Array<[string, unknown]> = [];
    const result = () => {
      if (op === "upsert" && table === "marketing_messages") {
        return { data: { id: crypto.randomUUID() }, error: null };
      }
      if (op !== "select") return { data: null, error: null };
      if (table === "sms_country_prices") return { data: priceRows, error: null };
      if (table === "marketing_audiences") {
        return {
          data: {
            id: "aud",
            brand_id: brandId,
            query_definition: { kind: "all_brand_people", brand_id: brandId },
          },
          error: null,
        };
      }
      if (table === "brands") {
        return filters.some(([m]) => m === "in")
          ? { data: [{ id: brandId, slug: "lantern-room" }], error: null }
          : {
            data: { id: brandId, name: "Lantern Room", slug: "lantern-room" },
            error: null,
          };
      }
      if (table === "marketing_messages") return { data: null, error: null };
      if (table === "marketing_book_send_executions") {
        return {
          data: sealed ? { id: "exec", scheduled_for: null } : null,
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {};
    for (
      const method of ["eq", "in", "is", "neq", "or", "order", "range", "limit"]
    ) {
      chain[method] = (_column: string, value: unknown) => {
        filters.push([method, value]);
        return chain;
      };
    }
    const write = (kind: string) => (p?: unknown) => {
      op = kind;
      writes.push({ table, op, payload: p ?? null });
      return chain;
    };
    chain.select = () => chain;
    chain.insert = write("insert");
    chain.update = write("update");
    chain.upsert = write("upsert");
    chain.delete = write("delete");
    chain.maybeSingle = () => Promise.resolve(result());
    chain.single = () => Promise.resolve(result());
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  };
  return {
    writes,
    client: {
      from: builder,
      rpc: (name: string) =>
        Promise.resolve(
          name === "biz_marketing_book_send_audience"
            ? {
              data: {
                brand_id: brandId,
                reach: {
                  total: phones.length,
                  reachable_email: 0,
                  reachable_sms: phones.length,
                },
                rows: phones.map((phone, i) => row(`k${i}`, phone)),
              },
              error: null,
            }
            : name === "sms_marketing_switches_v1"
            ? switchesRpc()
            : { data: null, error: null },
        ),
    },
  };
}

interface Http {
  url: string;
  body: string;
}

async function runSend(
  phones: string[],
  opts: {
    sealed?: boolean;
    // deno-lint-ignore no-explicit-any
    smsSwitches?: any;
    switchesRpc?: () => { data: unknown; error: unknown };
    env?: Record<string, string>;
    alerts?: string[][];
  },
) {
  const env = { ...ENV, ...(opts.env ?? {}) };
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = Deno.env.get(k);
    Deno.env.set(k, v);
  }
  const http: Http[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    http.push({ url, body: String(init?.body ?? "") });
    return Promise.resolve(
      url.includes("api.twilio.com")
        ? new Response(JSON.stringify({ sid: `SM${http.length}` }), { status: 201 })
        : new Response(
          JSON.stringify({ code: "ok", message_id: "3017857812138224517130997" }),
          { status: 200 },
        ),
    );
  }) as typeof fetch;
  const time = new FakeTime(SEND_AT);
  const db = fakeDb(phones, opts.sealed ?? true, opts.switchesRpc);
  try {
    // The loader's retry pause (3 tries) runs on the fake clock: tick it.
    let settled = false;
    const pending = processClaimedCampaigns(
      // deno-lint-ignore no-explicit-any
      db.client as any,
      [{
        id: "42730000-0000-4000-8000-0000000000c1",
        account_id: "42730000-0000-4000-8000-0000000000d1",
        brand_id: "42730000-0000-4000-8000-0000000000b1",
        audience_id: "aud",
        channel: "sms",
        // deno-lint-ignore no-explicit-any
        channel_payload: { kind: "sms", body: "Doors at 9." } as any,
        name: "Country switches",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      {
        live: true,
        resendApiKey: "re_test_key",
        ...("smsSwitches" in opts ? { smsSwitches: opts.smsSwitches } : {}),
        opsAlert: (subject: string, paragraphs: string[]) => {
          opts.alerts?.push([subject, ...paragraphs]);
          return Promise.resolve();
        },
      },
    ).finally(() => {
      settled = true;
    });
    while (!settled) await time.tickAsync(250);
    const summary = await pending;
    return { summary, http, writes: db.writes };
  } finally {
    time.restore();
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

const messageRows = (writes: Write[]) =>
  writes.filter((w) => w.table === "marketing_messages" && w.op !== "select");

Deno.test("#4273 T-M1 GB switched on: the Twilio POST carries the DB marketing SID and the opt-out link", async () => {
  const { http, summary } = await runSend([GB], {
    smsSwitches: seededSmsSwitches({ on: ["US", "NG", "GB"] }),
  });
  assertEquals(summary.failed, 0, JSON.stringify(summary.errors));
  assertEquals(http.length, 1);
  assert(http[0].url.includes("api.twilio.com"));
  const params = new URLSearchParams(http[0].body);
  assertEquals(params.get("MessagingServiceSid"), TEST_MARKETING_SERVICE_SID);
  const body = params.get("Body") ?? "";
  assert(/\nStop: https:\/\/usemingla\.com\/m\/[0-9a-f-]{36}$/.test(body), body);
  assert(!body.includes("Reply STOP"));
});

Deno.test("#4273 T-M2 GB switched off: skipped, zero provider HTTP, no message row", async () => {
  const { http, writes, summary } = await runSend([GB], {
    smsSwitches: seededSmsSwitches(),
  });
  assertEquals(summary.failed, 0);
  assertEquals(http, []);
  assertEquals(messageRows(writes), [], "a sealed fresh recipient writes nothing");
});

Deno.test("#4273 T-M3 switches unreadable: sealed waits (retry_later) and alerts; legacy says why; nothing is texted", async () => {
  const alerts: string[][] = [];
  const sealed = await runSend([US, GB], { smsSwitches: null, alerts });
  assertEquals(sealed.http, []);
  assertEquals(messageRows(sealed.writes), [], "no recipient row on a sealed send");
  const park = sealed.writes.filter((w) =>
    w.table === "marketing_campaigns" && w.op === "update"
  ).at(-1)?.payload as { status?: string } | undefined;
  assertEquals(park?.status, "scheduled", "re-parked for a later pass");
  assertEquals(alerts.length, 1);
  assertEquals(alerts[0][0], "[SMS] A Blast is waiting: SMS country switches can't be read");
  assert(alerts[0][1].includes("public.sms_country_switches"));

  const legacy = await runSend([US, GB], { sealed: false, smsSwitches: null });
  assertEquals(legacy.http, []);
  const failed = messageRows(legacy.writes).map((w) =>
    (w.payload as { failure_reason?: string }).failure_reason
  );
  assertEquals(failed, ["sms_rate_book_unavailable", "sms_rate_book_unavailable"]);

  // The REAL loader: an RPC error reads as unreadable too (three tries; the
  // retry pause runs on the fake clock).
  const viaRpc = await runSend([US], {
    sealed: false,
    switchesRpc: () => ({ data: null, error: { message: "timeout" } }),
  });
  assertEquals(viaRpc.http, []);
});

Deno.test("#4273 T-M4 today's seed sends US/NG exactly as before; the US bundle master switch still stops US marketing", async () => {
  const { http, summary } = await runSend([US, NG, GB], {
    smsSwitches: seededSmsSwitches(),
  });
  assertEquals(summary.failed, 0, JSON.stringify(summary.errors));
  assertEquals(http.length, 2, "US and NG; GB is off");
  const twilio = http.find((h) => h.url.includes("api.twilio.com"))!;
  assertEquals(
    new URLSearchParams(twilio.body).get("MessagingServiceSid"),
    "MG4273tollfree",
    "US stays on the toll-free service",
  );
  assert(new URLSearchParams(twilio.body).get("Body")!.endsWith("Reply STOP to opt out."));
  const termii = http.find((h) => h.url.startsWith("https://termii.switch.test/"))!;
  assertEquals(JSON.parse(termii.body).channel, "generic");

  // The real loader with the DB saying US on, and the bundle US switch off.
  const killed = await runSend([US, NG], {
    sealed: false,
    switchesRpc: () => ({ data: switchesRow(new Set(["US", "NG"])), error: null }),
    env: {
      MINGLA_DELIVERY_FLAGS_JSON: JSON.stringify({
        schema_version: 1,
        marketing_send_live_enabled: true,
        sms_live_enabled: { us: false, ng: true },
      }),
    },
  });
  assertEquals(killed.http.map((h) => new URL(h.url).hostname), ["termii.switch.test"], "only NG");
});

Deno.test("#4273 T-M5 the quote: unreadable switches fail closed as BOOK_BLAST_RATE_BOOK_UNAVAILABLE", async () => {
  const quiet = console.error;
  console.error = () => {};
  // The US/NG master switches are on (the bundle), as in production.
  const savedFlags = Deno.env.get("MINGLA_DELIVERY_FLAGS_JSON");
  Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", ENV.MINGLA_DELIVERY_FLAGS_JSON);
  try {
    const unreadable = await smsQuoteInputs(fakeDb([], true).client);
    assertEquals("smsCountryLive" in unreadable, false);
    assertEquals(unreadable.smsRates?.length, 3, "prices still read");
    const readable = await smsQuoteInputs(
      fakeDb([], true, () => ({ data: switchesRow(new Set(["US"])), error: null })).client,
    );
    assertEquals(readable.smsCountryLive?.("US"), true);
    assertEquals(readable.smsCountryLive?.("NG"), false);
    const envelope = {
      brandId: "brand",
      channel: "sms" as const,
      selectedCount: 1,
      content: { kind: "sms" as const, body: "Doors at 9." },
      candidates: [{
        brandPersonId: "p-us",
        contactMethodId: "m-us",
        normalizedContact: US,
        allowed: true,
        safeReasonCode: "allowed",
      }],
    };
    let code = "";
    try {
      await buildMarketingBookQuote(envelope, SEND_AT, {
        ...unreadable,
        smsRates: smsRatesFromRows([{
          country: "US",
          provider: "twilio",
          currency: "USD",
          minor_numerator: 83,
          minor_denominator: 100,
          source: "twilio_pricing_api",
          source_reference: "US-test",
          fetched_at: "2026-11-08T06:17:00.000Z",
        }]),
        trackingOrigin: "https://usemingla.com/m",
      });
    } catch (error) {
      code = marketingBookQuoteErrorCode(error);
    }
    assertEquals(code, "BOOK_BLAST_RATE_BOOK_UNAVAILABLE");
  } finally {
    console.error = quiet;
    if (savedFlags === undefined) Deno.env.delete("MINGLA_DELIVERY_FLAGS_JSON");
    else Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", savedFlags);
  }
});
