// #4273 item 10 — SMS prices are automatic.
//
// P-1 the Twilio Pricing API response parses to the HIGHEST outbound price,
//     as an exact minor-unit fraction. The fixture follows the documented v1
//     `GET /v1/Messaging/Countries/{ISO}` response (no account SID in it).
// P-2 the sanity guard refuses ≤0, a wrong currency, and a move over ±50%.
// P-3 the refresh writes good prices, keeps the last good one on a refusal or
//     a failed fetch, and alerts ops once with every kept country.
// P-4 the staleness alert names refreshed prices older than 7 days, never the
//     fixed Termii price, and alerts when the table can't be read.
// P-5 table rows become quote rates that never expire; a bad row only drops
//     its own country; quote = send with a fetched price.
// The pg17 half (table, RLS, seed, cron) is
// supabase/migrations/__tests__/issue_4273_sms_all_countries.implementor.pg17.test.sql.
// MINGLA-INVARIANT: I-4273-SMS-PRICES-AUTOMATIC | issue #4273 | SMS prices come from public.sms_country_prices, refreshed daily from Twilio's Pricing API behind a sanity guard; a price never expires, a stale one is alerted, and a country with no price is skipped.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decimalToMinorFraction,
  loadSmsRates,
  parseTwilioMessagingPrice,
  smsPriceRejection,
  smsPriceStalenessAlert,
  smsRatesFromRows,
  twilioPricedCountries,
} from "../../_shared/smsPriceTable.ts";
import { refreshSmsPrices } from "../index.ts";
import { buildMarketingBookQuote } from "../../_shared/marketingBookQuote.ts";

const FIXTURE = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/twilio_pricing_messaging_gb.json", import.meta.url),
  ),
);

Deno.test("#4273 P-1 the highest outbound price, as an exact fraction", () => {
  const parsed = parseTwilioMessagingPrice(FIXTURE, "GB");
  assertEquals(parsed.currency, "USD");
  assertEquals(parsed.price, "0.0560");
  assertEquals({ n: parsed.numerator, d: parsed.denominator }, { n: 28, d: 5 }); // 5.60 cents = 560/100
  assertEquals(decimalToMinorFraction("0.0083"), {
    numerator: 83,
    denominator: 100,
  });
  assertEquals(decimalToMinorFraction("1"), { numerator: 100, denominator: 1 });
  assertEquals(decimalToMinorFraction("0"), null);
  assertEquals(decimalToMinorFraction("-0.01"), null);
  let thrown = "";
  try {
    parseTwilioMessagingPrice(FIXTURE, "FR");
  } catch (error) {
    thrown = (error as Error).message;
  }
  assertEquals(thrown, "sms_price_wrong_country");
  const cheaper = structuredClone(FIXTURE);
  cheaper.outbound_sms_prices[0].prices = [{
    number_type: "mobile",
    base_price: "0.01",
    current_price: "0.01",
  }];
  cheaper.outbound_sms_prices[1].prices = [{
    number_type: "mobile",
    base_price: "0.09",
    current_price: "0.0901",
  }];
  assertEquals(
    parseTwilioMessagingPrice(cheaper, "GB").price,
    "0.0901",
    "the highest carrier wins",
  );
});

Deno.test("#4273 P-2 the sanity guard", () => {
  const last = {
    currency: "USD",
    minor_numerator: 560,
    minor_denominator: 100,
  };
  assertEquals(
    smsPriceRejection(
      { currency: "USD", numerator: 600, denominator: 100 },
      last,
    ),
    null,
  );
  assertEquals(
    smsPriceRejection(
      { currency: "USD", numerator: 0, denominator: 100 },
      last,
    ),
    "not_positive",
  );
  assertEquals(
    smsPriceRejection(
      { currency: "EUR", numerator: 560, denominator: 100 },
      last,
    ),
    "wrong_currency",
  );
  assertEquals(
    smsPriceRejection(
      { currency: "USD", numerator: 900, denominator: 100 },
      last,
    ),
    "changed_over_50_percent",
  );
  assertEquals(
    smsPriceRejection(
      { currency: "USD", numerator: 270, denominator: 100 },
      last,
    ),
    "changed_over_50_percent",
  );
  assertEquals(
    smsPriceRejection(
      { currency: "USD", numerator: 900, denominator: 100 },
      null,
    ),
    null,
    "a first price has nothing to compare",
  );
});

function fakeDb(rows: Array<Record<string, unknown>>) {
  const writes: Array<Record<string, unknown>> = [];
  return {
    writes,
    rows,
    from: () => ({
      select: () => Promise.resolve({ data: rows, error: null }),
      upsert: (row: Record<string, unknown>) => {
        writes.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };
}

Deno.test("#4273 P-3 the refresh writes good prices and keeps the last good one, alerting once", async () => {
  const db = fakeDb([{
    country: "GB",
    currency: "USD",
    minor_numerator: 100,
    minor_denominator: 100,
  }]);
  const alerts: string[][] = [];
  const outcome = await refreshSmsPrices({
    db,
    accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    authToken: "redacted",
    now: () => new Date("2026-11-09T06:17:00.000Z"),
    alert: (subject, paragraphs) => {
      alerts.push([subject, ...paragraphs]);
      return Promise.resolve();
    },
    fetch: ((url: string | URL) => {
      const iso = String(url).split("/").pop() as string;
      if (iso === "US") {
        return Promise.resolve(new Response("nope", { status: 503 }));
      }
      const body = structuredClone(FIXTURE);
      body.iso_country = iso;
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200 }),
      );
    }) as typeof fetch,
  });
  // GB jumped from 1.00 to 5.60 cents (> +50%): refused, last good kept.
  assert(
    outcome.refused.some((row) =>
      row.country === "GB" && row.reason === "changed_over_50_percent"
    ),
  );
  assert(
    outcome.failed.some((row) =>
      row.country === "US" && row.reason === "http_503"
    ),
  );
  assertEquals(
    db.writes.some((row) => row.country === "GB" || row.country === "US"),
    false,
  );
  assertEquals(outcome.updated.length, twilioPricedCountries().length - 2);
  const fr = db.writes.find((row) => row.country === "FR")!;
  assertEquals([
    fr.provider,
    fr.currency,
    fr.minor_numerator,
    fr.minor_denominator,
    fr.source,
  ], ["twilio", "USD", 28, 5, "twilio_pricing_api"]);
  assertEquals(
    db.writes.some((row) => row.country === "NG"),
    false,
    "Termii is never fetched",
  );
  assertEquals(alerts.length, 1);
  assert(alerts[0].join(" ").includes("GB: refused (changed_over_50_percent)"));
  assert(!alerts[0].join(" ").includes("ACxx"), "never the account SID");
});

Deno.test("#4273 P-4 the staleness alert", () => {
  const now = new Date("2026-11-20T13:00:00.000Z");
  assertEquals(
    smsPriceStalenessAlert(now, [
      {
        country: "GB",
        source: "twilio_pricing_api",
        fetched_at: "2026-11-19T06:17:00.000Z",
      },
      {
        country: "NG",
        source: "termii_fixed",
        fetched_at: "2026-10-23T00:00:00.000Z",
      },
    ]),
    null,
    "fresh Twilio + the fixed Termii price: quiet",
  );
  const stale = smsPriceStalenessAlert(now, [
    {
      country: "US",
      source: "seed_4080",
      fetched_at: "2026-10-23T00:00:00.000Z",
    },
    {
      country: "GB",
      source: "twilio_pricing_api",
      fetched_at: "2026-11-12T06:17:00.000Z",
    },
  ]);
  assert(
    stale !== null && stale.paragraphs[0].includes("GB, US"),
    JSON.stringify(stale),
  );
  assert(smsPriceStalenessAlert(now, null)?.subject.includes("can't be read"));
});

Deno.test("#4273 P-5 rows → rates that never expire; one bad row drops only its country; quote = send", async () => {
  const rows = [
    {
      country: "US",
      provider: "twilio",
      currency: "USD",
      minor_numerator: 83,
      minor_denominator: 100,
      source: "seed_4080",
      source_reference: "s",
      fetched_at: "2026-10-23T00:00:00Z",
    },
    {
      country: "NG",
      provider: "termii",
      currency: "NGN",
      minor_numerator: 500,
      minor_denominator: 1,
      source: "termii_fixed",
      source_reference: "s",
      fetched_at: "2026-10-23T00:00:00Z",
    },
    {
      country: "GB",
      provider: "termii",
      currency: "USD",
      minor_numerator: 5,
      minor_denominator: 1,
      source: "twilio_pricing_api",
      source_reference: "s",
      fetched_at: "2026-11-09T00:00:00Z",
    },
  ];
  const rates = smsRatesFromRows(rows);
  assertEquals(
    rates.map((rate) => rate.country),
    ["US", "NG"],
    "GB on the wrong route is dropped",
  );
  assertEquals(rates[0].rateId, "twilio-us-2026-10-23T00:00:00.000Z");
  assertEquals(rates[0].expiresAt, "9999-12-31T23:59:59.000Z");
  assertEquals(
    await loadSmsRates({
      from: () => ({
        select: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
    rates,
  );
  await assertRejects(
    () =>
      loadSmsRates({
        from: () => ({
          select: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    Error,
    "sms_rate_book_missing",
  );
  // A fetched price seals into the quote: rateId and per-person cost.
  const quote = await buildMarketingBookQuote(
    {
      brandId: "b",
      channel: "sms",
      selectedCount: 1,
      content: { kind: "sms", body: "Doors at 9" },
      candidates: [{
        brandPersonId: "p",
        contactMethodId: "m",
        normalizedContact: "+12025550142",
        allowed: true,
        safeReasonCode: "allowed",
      }],
    },
    new Date("2026-11-09T12:00:00.000Z"),
    {
      smsRates: rates,
      smsCountryLive: () => true,
      trackingOrigin: "https://usemingla.com/m",
    },
  );
  assertEquals(quote.rateIds, ["twilio-us-2026-10-23T00:00:00.000Z"]);
  assertEquals(quote.estimatedCostMinor, Math.ceil(quote.smsSegments * 0.83));
});
