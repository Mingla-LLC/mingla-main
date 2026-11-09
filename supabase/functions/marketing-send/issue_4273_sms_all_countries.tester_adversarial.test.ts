// #4273 — tester adversarial for "text every payout country". Runs the REAL
// production send path (no injected routes, no injected switches): prices come
// from the sms_country_prices table, each country's switch from
// MINGLA_DELIVERY_FLAGS_JSON, and the alphanumeric sender from
// TWILIO_MARKETING_MESSAGING_SERVICE_SID. It proves the quote and the send
// pick the same people per country and per sender, that an alphanumeric
// country never falls back to the toll-free number, that US/CA never use the
// alphanumeric service, that a sealed send never leaves a recipient deferred
// forever once their country can no longer be texted, and that New
// Brunswick's overlay code is read in Atlantic time.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import { buildMarketingBookQuote } from "../_shared/marketingBookQuote.ts";
import { smsRatesFromRows } from "../_shared/smsPriceTable.ts";
import { isWithinSmsWindow, smsLocalZones } from "../_shared/smsCountries.ts";
import { processClaimedCampaigns } from "./index.ts";
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";

const US = "+12025550142";
const NG = "+2348031104273";
const GB = "+447700900123";
const DE = "+4915112345678";
const FR = "+33612345678";
const CA = "+14165550123"; // Toronto
const BE = "+32470123456";
const ALL = [US, NG, GB, DE, FR, CA, BE];

// Monday 2026-11-09 17:00Z: Washington 12:00, Toronto 12:00, London 17:00,
// Paris/Berlin/Brussels 18:00, Lagos 18:00 — inside every window.
const SEND_AT = new Date("2026-11-09T17:00:00Z");

const priceRow = (
  country: string,
  provider: "twilio" | "termii",
  currency: string,
  n: number,
  d: number,
) => ({
  country,
  provider,
  currency,
  minor_numerator: n,
  minor_denominator: d,
  source: provider === "termii" ? "termii_fixed" : "twilio_pricing_api",
  source_reference: `${country}-test`,
  fetched_at: "2026-11-08T06:17:00.000Z",
});
// Every country in this test is priced: who is texted is decided only by the
// switch and the sender route.
const PRICE_ROWS = [
  priceRow("US", "twilio", "USD", 83, 100),
  priceRow("CA", "twilio", "USD", 83, 100),
  priceRow("NG", "termii", "NGN", 500, 1),
  priceRow("GB", "twilio", "USD", 560, 100),
  priceRow("DE", "twilio", "USD", 1120, 100),
  priceRow("FR", "twilio", "USD", 798, 100),
  priceRow("BE", "twilio", "USD", 1113, 100),
];

// GB, DE and BE switched on; FR explicitly off; CA absent (off).
const FLAGS = JSON.stringify({
  schema_version: 1,
  marketing_send_live_enabled: true,
  sms_live_enabled: {
    us: true,
    ng: true,
    gb: true,
    de: true,
    be: true,
    fr: false,
  },
});

type Write = { table: string; op: string; payload: unknown };

function fakeDb(
  phones: string[],
  opts: {
    sealed: boolean;
    existing?: Record<string, Record<string, unknown>>;
  },
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
  const builder = (table: string) => {
    let op = "select";
    const filters: Array<[string, string, unknown]> = [];
    const result = () => {
      if (op === "upsert" && table === "marketing_messages") {
        return { data: { id: crypto.randomUUID() }, error: null };
      }
      if (op !== "select") return { data: null, error: null };
      if (table === "sms_country_prices") {
        return { data: PRICE_ROWS, error: null };
      }
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
      if (table === "marketing_messages") {
        const phone = filters.find(([m, c]) =>
          m === "eq" && c === "recipient_phone"
        )?.[2];
        return {
          data: typeof phone === "string"
            ? opts.existing?.[phone] ?? null
            : null,
          error: null,
        };
      }
      if (table === "marketing_book_send_executions") {
        return { data: opts.sealed ? { id: "exec" } : null, error: null };
      }
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {};
    for (
      const method of ["eq", "in", "is", "neq", "or", "order", "range", "limit"]
    ) {
      chain[method] = (column: string, value: unknown) => {
        filters.push([method, column, value]);
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
            : { data: null, error: null },
        ),
    },
  };
}

interface Sent {
  to: string;
  messagingServiceSid: string | null | undefined;
  optOutLink: string | undefined;
}

async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const before: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    before[name] = Deno.env.get(name);
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

const BASE_ENV = {
  MINGLA_DELIVERY_FLAGS_JSON: FLAGS,
  UNSUBSCRIBE_TOKEN_SECRET: "tester-4273-secret-0123456789abcdef",
  MINGLA_TRACKING_LINK_ORIGIN: "https://usemingla.com/m",
};

async function runProductionSend(
  phones: string[],
  opts: {
    sealed: boolean;
    existing?: Record<string, Record<string, unknown>>;
  },
  at = SEND_AT,
) {
  const sent: Sent[] = [];
  const realSend = smsAdapter.send;
  const time = new FakeTime(at);
  smsAdapter.send = (input) => {
    sent.push({
      to: input.to,
      messagingServiceSid: input.messagingServiceSid,
      optOutLink: input.optOutLink,
    });
    return Promise.resolve({
      ok: true,
      status: "sent",
      providerMessageId: `SM-${sent.length}`,
      provider: "twilio",
      segments: 1,
      // deno-lint-ignore no-explicit-any
    } as any);
  };
  const db = fakeDb(phones, opts);
  try {
    const summary = await processClaimedCampaigns(
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
        name: "All countries",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      { live: true, resendApiKey: "re_test_key" },
    );
    return { summary, sent, writes: db.writes };
  } finally {
    smsAdapter.send = realSend;
    time.restore();
  }
}

async function quoteReach(): Promise<string[]> {
  const quote = await buildMarketingBookQuote(
    {
      brandId: "brand",
      channel: "sms" as const,
      selectedCount: ALL.length,
      content: { kind: "sms", body: "Doors at 9." },
      audienceId: "aud",
      audienceKind: "combined_sources" as const,
      audienceVersion: 1,
      audienceName: "Your Book",
      candidates: ALL.map((phone, i) => ({
        personKey: `k${i}`,
        brandPersonId: `p-${i}`,
        contactMethodId: `m-${i}`,
        normalizedContact: phone,
        allowed: true,
        safeReasonCode: "allowed",
      })),
    },
    SEND_AT,
    {
      trackingOrigin: "https://usemingla.com/m",
      // The live table's rows, the live switches (no smsCountryLive override).
      smsRates: smsRatesFromRows(PRICE_ROWS),
      costCurrency: "USD",
      fx: {
        convert: (
          { subtotals }: {
            subtotals: Array<{ currency: string; estimatedCostMinor: number }>;
          },
        ) =>
          Promise.resolve({
            snapshotId: "fx-test",
            converted: subtotals.map((s) => ({
              currency: s.currency,
              providerCostMinor: s.estimatedCostMinor,
              convertedCostMinor: s.estimatedCostMinor,
            })),
          }),
        // deno-lint-ignore no-explicit-any
      } as any,
    },
  );
  return quote.candidates.filter((c) => c.allowed && !c.smsUnpriced).map((c) =>
    c.normalizedContact as string
  ).sort();
}

Deno.test("#4273 X-1 no marketing sender: alphanumeric countries are skipped by quote AND send, never sent on the toll-free", async () => {
  await withEnv(
    { ...BASE_ENV, TWILIO_MARKETING_MESSAGING_SERVICE_SID: undefined },
    async () => {
      const quoted = await quoteReach();
      assertEquals(
        quoted,
        [NG, US].sort(),
        "GB/DE need the alpha sender; FR off; CA off; BE has no sender",
      );
      const { sent } = await runProductionSend(ALL, { sealed: true });
      assertEquals(sent.map((s) => s.to).sort(), quoted);
      for (const s of sent) {
        assertEquals(
          s.messagingServiceSid ?? null,
          null,
          `${s.to} uses the default (toll-free / Termii) route`,
        );
        assertEquals(s.optOutLink, undefined, `${s.to} can reply STOP`);
      }
    },
  );
});

Deno.test("#4273 X-2 with the marketing sender: GB/DE go by it with an opt-out link; US/NG never do; FR/CA/BE stay skipped", async () => {
  await withEnv(
    { ...BASE_ENV, TWILIO_MARKETING_MESSAGING_SERVICE_SID: "MGtester4273" },
    async () => {
      const quoted = await quoteReach();
      assertEquals(quoted, [DE, GB, NG, US].sort());
      const { sent, writes } = await runProductionSend(ALL, { sealed: true });
      assertEquals(sent.map((s) => s.to).sort(), quoted, "quote = send");
      const by = Object.fromEntries(sent.map((s) => [s.to, s]));
      assertEquals(by[GB].messagingServiceSid, "MGtester4273");
      assertEquals(by[DE].messagingServiceSid, "MGtester4273");
      assertEquals(
        by[US].messagingServiceSid ?? null,
        null,
        "US stays on the toll-free",
      );
      assertEquals(by[NG].messagingServiceSid ?? null, null);
      for (const phone of [GB, DE]) {
        const link = by[phone].optOutLink ?? "";
        assert(link.startsWith("https://usemingla.com/m/"), link);
        assertEquals(
          link.length,
          "https://usemingla.com/m/00000000-0000-4000-8000-000000000000".length,
          "the link the quote measured",
        );
      }
      assertEquals(by[US].optOutLink, undefined);
      assertEquals(by[NG].optOutLink, undefined);
      // Nothing is written for the switched-off / sender-less numbers on a
      // sealed send (their sealed targets already read as not reached).
      for (const phone of [FR, CA, BE]) {
        assertEquals(
          writes.filter((w) =>
            w.table === "marketing_messages" &&
            JSON.stringify(w.payload).includes(phone)
          ),
          [],
          phone,
        );
      }
    },
  );
});

Deno.test("#4273 X-3 a sealed recipient deferred overnight is resolved, not deferred forever, when their country is switched off before the next pass", async () => {
  // GB was deferred by quiet hours on an earlier pass; GB is now switched off.
  const flagsGbOff = JSON.stringify({
    schema_version: 1,
    marketing_send_live_enabled: true,
    sms_live_enabled: { us: true, ng: true, gb: false },
  });
  await withEnv(
    {
      ...BASE_ENV,
      MINGLA_DELIVERY_FLAGS_JSON: flagsGbOff,
      TWILIO_MARKETING_MESSAGING_SERVICE_SID: "MGtester4273",
    },
    async () => {
      const { sent, writes } = await runProductionSend([US, GB], {
        sealed: true,
        existing: {
          [GB]: {
            id: "msg-gb",
            status: "deferred",
            attempt_count: 1,
            created_at: "2026-11-08T22:00:00.000Z",
            provider_message_id: null,
          },
        },
      });
      assertEquals(sent.map((s) => s.to), [US]);
      const gbWrites = writes.filter((w) =>
        w.table === "marketing_messages" &&
        JSON.stringify(w.payload).includes(GB)
      );
      assertEquals(gbWrites.length, 1, "the deferred row is closed out");
      const payload = gbWrites[0].payload as {
        status: string;
        failure_reason: string;
      };
      assertEquals(payload.status, "failed");
      assertEquals(payload.failure_reason, "sms_unpriced_country");
    },
  );
});

Deno.test("#4273 X-4 a sealed fresh recipient in a switched-off country still writes no row", async () => {
  await withEnv(
    { ...BASE_ENV, TWILIO_MARKETING_MESSAGING_SERVICE_SID: "MGtester4273" },
    async () => {
      const { writes } = await runProductionSend([FR], { sealed: true });
      assertEquals(
        writes.filter((w) => w.table === "marketing_messages"),
        [],
      );
    },
  );
});

Deno.test("#4273 X-5 New Brunswick (506 and its 428 overlay) is in Atlantic time", () => {
  // 21:30 Atlantic = 20:30 Eastern: closed in New Brunswick.
  const at = new Date("2026-11-10T01:30:00Z");
  for (const phone of ["+15065550123", "+14285550123"]) {
    assertEquals(smsLocalZones(phone, "CA"), ["America/Halifax"], phone);
    assertEquals(isWithinSmsWindow(phone, "CA", at), false, phone);
  }
  // Toronto is still open at the same instant (20:30 local).
  assertEquals(isWithinSmsWindow("+14165550123", "CA", at), true);
});

Deno.test("#4273 X-6 Europe and multi-zone North America windows", () => {
  // Sunday 2026-11-08 11:00 Paris: France never on a Sunday; Berlin is open.
  const sundayMorning = new Date("2026-11-08T10:00:00Z");
  assertEquals(isWithinSmsWindow(FR, "FR", sundayMorning), false);
  assertEquals(isWithinSmsWindow(DE, "DE", sundayMorning), true);
  // Saturday 21:15 Paris is open, 21:30 is closed.
  assertEquals(
    isWithinSmsWindow(FR, "FR", new Date("2026-11-07T20:15:00Z")),
    true,
  );
  assertEquals(
    isWithinSmsWindow(FR, "FR", new Date("2026-11-07T20:30:00Z")),
    false,
  );
  // 20:59 London open, 21:00 closed.
  assertEquals(
    isWithinSmsWindow(GB, "GB", new Date("2026-11-09T20:59:00Z")),
    true,
  );
  assertEquals(
    isWithinSmsWindow(GB, "GB", new Date("2026-11-09T21:00:00Z")),
    false,
  );
  // 807 spans Eastern and Central: 08:30 Eastern is 07:30 Central → closed.
  assertEquals(
    isWithinSmsWindow("+18075550123", "CA", new Date("2026-11-09T13:30:00Z")),
    false,
  );
  assertEquals(
    isWithinSmsWindow("+18075550123", "CA", new Date("2026-11-09T14:30:00Z")),
    true,
  );
  // Canary Islands are an hour behind Madrid; Spain needs both open.
  assertEquals(
    isWithinSmsWindow("+34612345678", "ES", new Date("2026-11-09T07:30:00Z")),
    false,
    "08:30 Madrid, 07:30 Canaries",
  );
  // An unmapped +1 area code (Caribbean NANP) is never in a window.
  assertEquals(
    isWithinSmsWindow("+18765550123", "US", new Date("2026-11-09T17:00:00Z")),
    false,
  );
});
