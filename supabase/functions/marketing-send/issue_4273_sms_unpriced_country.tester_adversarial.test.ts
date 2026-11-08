// #4273 — tester adversarial: an unpriced phone is skipped the same way by the
// quote and by the send, on routes the implementor's suite does not walk:
// the wrong provider for a country, Nigeria priced only on Twilio, phones no
// country can be read from, a mixed audience end to end, and a book that is
// configured but holds no rates. A book that cannot price anything must fail
// the quote closed, never read as "every number is in a country Mingla can't
// text".
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import {
  allocateSmsCosts,
  configuredSmsRoutes,
  smsRateForPhone,
  type SmsRateV1,
  validatedSmsRates,
} from "../_shared/smsPriceBook.ts";
import {
  buildMarketingBookQuote,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";
import {
  marketingBookQuoteErrorCode,
  processClaimedCampaigns,
} from "./index.ts";
import {
  composeSmsBody,
  computeSegments,
  smsAdapter,
} from "../_shared/adapters/smsAdapter.ts";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const US = "+12025550142";
const US2 = "+12025550199";
const NG = "+2348031104273";
const BE = "+32470123456";
const GB = "+447700900123";
// Valid E.164, but no calling code Mingla maps to a country.
const NO_COUNTRY = "+9991234567";

const rate = (
  rateId: string,
  provider: "twilio" | "termii",
  country: string,
  currency: string,
  minor: number,
): SmsRateV1 => ({
  rateId,
  provider,
  country,
  currency,
  unit: "sms_segment",
  minorNumerator: minor,
  minorDenominator: 1,
  effectiveAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  sourceReference: `${rateId}-card`,
});

const candidate = (key: string, phone: string | null, allowed = true) => ({
  personKey: key,
  brandPersonId: `p-${key}`,
  contactMethodId: `m-${key}`,
  normalizedContact: phone,
  allowed,
  safeReasonCode: allowed ? "allowed" : "suppressed",
});
const smsEnvelope = (candidates: ReturnType<typeof candidate>[]) => ({
  brandId: "brand",
  channel: "sms" as const,
  selectedCount: candidates.length,
  content: { kind: "sms", body: "Doors at 9" },
  audienceId: "aud",
  audienceKind: "combined_sources" as const,
  audienceVersion: 1,
  audienceName: "Your Book",
  candidates,
});
const QUOTE_OPTIONS = { trackingOrigin: "https://usemingla.com/m" };

// ── The rule: the provider route decides, not the country alone ────────────
Deno.test("#4273 T-1 a rate on the wrong provider does not price the country", () => {
  // US priced only on Termii (Termii cannot reach US handsets).
  assertEquals(
    smsRateForPhone(US, [rate("t-us", "termii", "US", "USD", 5)]),
    null,
  );
  // Nigeria priced only on Twilio: Nigeria routes to Termii, so unpriced.
  assertEquals(
    smsRateForPhone(NG, [rate("tw-ng", "twilio", "NG", "NGN", 5)]),
    null,
  );
  // The right route prices it.
  assertEquals(
    smsRateForPhone(NG, [rate("te-ng", "termii", "NG", "NGN", 5)])?.rateId,
    "te-ng",
  );
});

Deno.test("#4273 T-2 phones no country can be read from are unpriced, never thrown", () => {
  const rates = [rate("tw-us", "twilio", "US", "USD", 79)];
  for (const phone of [NO_COUNTRY, "+1", "+234", "not-a-phone", ""]) {
    assertEquals(smsRateForPhone(phone, rates), null, phone);
  }
  const priced = allocateSmsCosts(
    [
      { key: "a", normalizedPhone: NO_COUNTRY, segments: 1, target: "x" },
      { key: "b", normalizedPhone: "+1", segments: 1, target: "y" },
    ],
    NOW,
    rates,
  );
  assertEquals(priced.allocations, []);
  assertEquals(priced.unpriced.map((u) => u.target), ["x", "y"]);
  assertEquals(priced.estimatedCostMinor, 0);
  assertEquals(priced.currency, null);
  // A bad segment count is still a loud failure, not an unpriced skip.
  assertThrows(
    () =>
      allocateSmsCosts(
        [{ key: "a", normalizedPhone: US, segments: 0, target: "x" }],
        NOW,
        rates,
      ),
    Error,
    "sms_segments_invalid",
  );
});

// ── The quote: mixed audience, counts balance, nothing per-person leaks ────
Deno.test("#4273 T-3 mixed audience: only priced routes count, the execution still balances", async () => {
  const rates = [
    rate("tw-us", "twilio", "US", "USD", 79),
    rate("tw-ng", "twilio", "NG", "NGN", 265), // wrong provider for NG
  ];
  const quote = await buildMarketingBookQuote(
    smsEnvelope([
      candidate("us", US),
      candidate("us2", US2),
      candidate("ng", NG),
      candidate("be", BE),
      candidate("gb", GB),
      candidate("nc", NO_COUNTRY),
      candidate("off", US, false),
      {
        ...candidate("none", null),
        contactMethodId: null as unknown as string,
        allowed: false,
        safeReasonCode: "channel_unavailable",
      },
    ]),
    NOW,
    { ...QUOTE_OPTIONS, smsRates: rates },
  );
  assertEquals(quote.reachableCount, 2);
  assertEquals(quote.unpricedCount, 4, "NG(wrong route), BE, GB, no-country");
  assertEquals(quote.suppressedCount, 5, "4 unpriced + 1 opted out");
  assertEquals(quote.unavailableCount, 1);
  assertEquals(
    quote.selectedCount,
    quote.reachableCount + quote.suppressedCount + quote.unavailableCount,
  );
  const unpriced = quote.candidates.filter((c) => c.smsUnpriced).map((c) =>
    c.personKey
  ).sort();
  assertEquals(unpriced, ["be", "gb", "nc", "ng"]);
  for (const c of quote.candidates) {
    if (c.smsUnpriced) {
      assertEquals(c.segments, 0, `${c.personKey} segments`);
      assertEquals(c.allocatedCostMinor, null);
      assertEquals(c.rateId, null);
      // The Book's own verdict stays: the confirm compares it to the live list.
      assertEquals(c.allowed, true);
      assertEquals(c.safeReasonCode, "allowed");
    }
  }
  // An opted-out or contactless person is never mislabelled as unpriced.
  assertEquals(
    quote.candidates.find((c) => c.personKey === "off")?.smsUnpriced,
    false,
  );
  assertEquals(
    quote.candidates.find((c) => c.personKey === "none")?.smsUnpriced,
    false,
  );
  assertEquals(quote.rateIds, ["tw-us"], "the unused NG rate is not cited");
  assertEquals(quote.currency, "USD");
  // Privacy: the public quote carries the count only.
  const pub = publicMarketingBookQuote(quote) as Record<string, unknown>;
  assertEquals(pub.unpricedCount, 4);
  const wire = JSON.stringify(pub);
  for (const secret of [BE, GB, NG, NO_COUNTRY, "p-be", "m-be", "be"]) {
    assert(!wire.includes(`"${secret}"`), `public quote leaks ${secret}`);
  }
  assertEquals(pub.candidates, undefined);
});

Deno.test("#4273 T-4 an email quote never reports unpriced people", async () => {
  const quote = await buildMarketingBookQuote(
    {
      ...smsEnvelope([candidate("a", "a@example.test")]),
      channel: "email" as const,
      content: { kind: "email" },
    },
    NOW,
    { ...QUOTE_OPTIONS, smsRates: [] },
  );
  assertEquals(quote.unpricedCount, 0);
  assertEquals(quote.reachableCount, 1);
  assertEquals(quote.suppressedCount, 0);
});

// ── The book itself must still fail closed ──────────────────────────────────
Deno.test("#4273 T-5 a configured book with no rates fails closed, not 'every country unpriced'", async () => {
  assertThrows(
    () => validatedSmsRates(NOW, []),
    Error,
    "sms_rate_book_missing",
  );
  const previous = Deno.env.get("MINGLA_RUNTIME_CONFIG_JSON");
  Deno.env.set(
    "MINGLA_RUNTIME_CONFIG_JSON",
    JSON.stringify({
      schema_version: 1,
      bunny_storage_cap_bytes: 1000,
      bunny_traffic_cap_bytes: 2000,
      event_cover_video_provider: "bunny",
      google_ads_api_version: "v24",
      meta_api_version: "v25.0",
      mingla_footer_address: "Mingla legal address",
      mingla_logo_url: "https://usemingla.com/brand/email/logo.png",
      termii_base_url: "https://v3.api.termii.com",
      offering_invite_sms_price_book_v1: [],
    }),
  );
  try {
    const error = await assertRejects(() =>
      buildMarketingBookQuote(
        smsEnvelope([candidate("us", US), candidate("be", BE)]),
        NOW,
        QUOTE_OPTIONS,
      )
    );
    assertEquals(
      marketingBookQuoteErrorCode(error),
      "BOOK_BLAST_RATE_BOOK_UNAVAILABLE",
    );
  } finally {
    if (previous === undefined) Deno.env.delete("MINGLA_RUNTIME_CONFIG_JSON");
    else Deno.env.set("MINGLA_RUNTIME_CONFIG_JSON", previous);
  }
});

Deno.test("#4273 T-6 an expired book in the runtime config fails the whole quote, even with an unpriced number in it", async () => {
  const previous = Deno.env.get("MINGLA_RUNTIME_CONFIG_JSON");
  Deno.env.set(
    "MINGLA_RUNTIME_CONFIG_JSON",
    JSON.stringify({
      schema_version: 1,
      bunny_storage_cap_bytes: 1000,
      bunny_traffic_cap_bytes: 2000,
      event_cover_video_provider: "bunny",
      google_ads_api_version: "v24",
      meta_api_version: "v25.0",
      mingla_footer_address: "Mingla legal address",
      mingla_logo_url: "https://usemingla.com/brand/email/logo.png",
      termii_base_url: "https://v3.api.termii.com",
      offering_invite_sms_price_book_v1: [{
        ...rate("tw-us", "twilio", "US", "USD", 79),
        expiresAt: "2026-02-01T00:00:00.000Z",
      }],
    }),
  );
  try {
    const error = await assertRejects(() =>
      buildMarketingBookQuote(
        smsEnvelope([candidate("us", US), candidate("be", BE)]),
        NOW,
        QUOTE_OPTIONS,
      )
    );
    assertEquals(
      marketingBookQuoteErrorCode(error),
      "BOOK_BLAST_RATE_BOOK_EXPIRED",
    );
  } finally {
    if (previous === undefined) Deno.env.delete("MINGLA_RUNTIME_CONFIG_JSON");
    else Deno.env.set("MINGLA_RUNTIME_CONFIG_JSON", previous);
  }
});

// ── The send: same numbers as the quote, end to end ────────────────────────
function sendFake(phones: string[]) {
  const brandId = "42730000-0000-4000-8000-0000000000b1";
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
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
    const filters: Array<[string, unknown]> = [];
    const result = () => {
      if (op === "upsert" && table === "marketing_messages") {
        return { data: { id: `msg-${writes.length}` }, error: null };
      }
      if (op !== "select") return { data: null, error: null };
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
            : { data: null, error: null },
        ),
    },
  };
}

async function runSend(
  phones: string[],
  smsRoutes: ReturnType<typeof configuredSmsRoutes>,
) {
  const sentTo: string[] = [];
  const realSend = smsAdapter.send;
  // 12:00 in Washington, 18:00 in Lagos: inside both marketing windows.
  const time = new FakeTime(new Date("2026-11-09T17:00:00Z"));
  smsAdapter.send = (input) => {
    sentTo.push(input.to);
    return Promise.resolve({
      ok: true,
      status: "sent",
      providerMessageId: `SM-${sentTo.length}`,
      provider: "twilio",
      segments: computeSegments(composeSmsBody(input.message, true)),
      // deno-lint-ignore no-explicit-any
    } as any);
  };
  const fake = sendFake(phones);
  let summary;
  try {
    summary = await processClaimedCampaigns(
      // deno-lint-ignore no-explicit-any
      fake.client as any,
      [{
        id: "42730000-0000-4000-8000-0000000000c1",
        account_id: "42730000-0000-4000-8000-0000000000d1",
        brand_id: "42730000-0000-4000-8000-0000000000b1",
        audience_id: "aud",
        channel: "sms",
        // deno-lint-ignore no-explicit-any
        channel_payload: { kind: "sms", body: "Doors at 9." } as any,
        name: "Unpriced adversarial",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      { live: true, resendApiKey: "re_test_key", smsRoutes },
    );
  } finally {
    smsAdapter.send = realSend;
    time.restore();
  }
  return { summary, sentTo, writes: fake.writes };
}

Deno.test("#4273 T-7 quote = send: a mixed audience texts exactly the numbers the quote priced", async () => {
  const book = [
    rate("tw-us", "twilio", "US", "USD", 79),
    // One currency keeps this about routing, not FX conversion.
    rate("te-ng", "termii", "NG", "USD", 3),
    rate("te-gb", "termii", "GB", "USD", 4), // wrong provider for GB
  ];
  const phones = [US, NG, BE, GB, NO_COUNTRY, US2];
  const quote = await buildMarketingBookQuote(
    smsEnvelope(phones.map((phone, i) => candidate(`k${i}`, phone))),
    NOW,
    { ...QUOTE_OPTIONS, smsRates: book },
  );
  const quoted = quote.candidates.filter((c) => c.allowed && !c.smsUnpriced)
    .map((c) => c.normalizedContact as string).sort();
  const { summary, sentTo, writes } = await runSend(
    phones,
    configuredSmsRoutes(book),
  );
  assertEquals([...sentTo].sort(), quoted);
  assertEquals([...sentTo].sort(), [NG, US, US2].sort());
  assertEquals(summary.delivered, 3);
  assertEquals(summary.recipient_failed, 0);
  for (const phone of [BE, GB, NO_COUNTRY]) {
    assertEquals(
      writes.filter((w) =>
        w.table === "marketing_messages" &&
        JSON.stringify(w.payload).includes(phone)
      ),
      [],
      `no message row for ${phone}`,
    );
  }
});

Deno.test("#4273 T-8 the send guard reads the configured book: an empty book texts no one", async () => {
  const { summary, sentTo, writes } = await runSend([US, NG], []);
  assertEquals(sentTo, []);
  assertEquals(summary.delivered, 0);
  assertEquals(
    writes.filter((w) => w.table === "marketing_messages" && w.op !== "select"),
    [],
  );
});

Deno.test("#4273 T-9 the send guard keeps a priced country after its rate aged past expiry (sealed sends finish)", async () => {
  const aged = [{
    ...rate("tw-us", "twilio", "US", "USD", 79),
    expiresAt: "2026-01-02T00:00:00.000Z",
  }];
  const { sentTo } = await runSend([US, BE], configuredSmsRoutes(aged));
  assertEquals(sentTo, [US]);
});
