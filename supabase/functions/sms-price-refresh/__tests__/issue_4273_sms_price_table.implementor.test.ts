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
  SMS_REFERENCE_PRICE_CENTS,
  decimalToMinorFraction,
  smsPriceAnchor,
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

type Row = Record<string, unknown>;

/** An in-memory stand-in for the two tables the refresh reads and writes. */
function fakeDb(rows: Row[], historyRows: Row[] = []) {
  const writes: Row[] = [];
  let nextId = 1;
  const history: Row[] = historyRows.map((row) => ({
    id: nextId++,
    outcome: "accepted",
    recorded_at: "2026-11-01T06:17:00.000Z",
    ...row,
  }));
  const historyWrites: Row[] = [];
  const table = (name: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let limit = Infinity;
    let mode: "select" | "delete" = "select";
    const source = () => name === "sms_country_price_history" ? history : rows;
    const run = () => {
      const matched = source().filter((row) => filters.every((f) => f(row)))
        .sort((a, b) =>
          String(b.recorded_at ?? "").localeCompare(String(a.recorded_at ?? ""))
        );
      if (mode === "delete") {
        for (const row of matched) history.splice(history.indexOf(row), 1);
        return { data: null, error: null };
      }
      return { data: matched.slice(0, limit), error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      delete: () => {
        mode = "delete";
        return chain;
      },
      eq: (col: string, value: unknown) => {
        filters.push((row) => row[col] === value);
        return chain;
      },
      gt: (col: string, value: string) => {
        filters.push((row) => String(row[col]) > value);
        return chain;
      },
      lt: (col: string, value: string) => {
        filters.push((row) => String(row[col]) < value);
        return chain;
      },
      not: (col: string, _op: string, list: string) => {
        const ids = list.replace(/[()]/g, "").split(",").map(Number);
        filters.push((row) => !ids.includes(row[col] as number));
        return chain;
      },
      order: () => chain,
      limit: (n: number) => {
        limit = n;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve),
      upsert: (row: Row) => {
        writes.push(row);
        const at = rows.findIndex((r) => r.country === row.country);
        if (at >= 0) rows[at] = { ...rows[at], ...row };
        else rows.push(row);
        return Promise.resolve({ error: null });
      },
      insert: (row: Row) => {
        const stored = { id: nextId++, ...row };
        history.push(stored);
        historyWrites.push(stored);
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  };
  return { writes, historyWrites, history, rows, from: table };
}

/** One daily refresh where the feed offers `cents` for every country. */
async function day(
  db: ReturnType<typeof fakeDb>,
  iso: string,
  cents: number,
  alerts: string[][] = [],
) {
  return await refreshSmsPrices({
    db,
    accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    authToken: "redacted",
    now: () => new Date(iso),
    alert: (subject, paragraphs) => {
      alerts.push([subject, ...paragraphs]);
      return Promise.resolve();
    },
    fetch: ((url: string | URL) => {
      const body = structuredClone(FIXTURE);
      body.iso_country = String(url).split("/").pop();
      for (const carrier of body.outbound_sms_prices) {
        carrier.prices = [{
          number_type: "mobile",
          base_price: (cents / 100).toFixed(6),
          current_price: (cents / 100).toFixed(6),
        }];
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch,
  });
}

const gbCents = (db: ReturnType<typeof fakeDb>) => {
  const gb = db.rows.find((row) => row.country === "GB")!;
  return (gb.minor_numerator as number) / (gb.minor_denominator as number);
};

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
      if (iso !== "GB") {
        // Every other country offers exactly its list price (cold start).
        const usd = (SMS_REFERENCE_PRICE_CENTS[iso] / 100).toFixed(4);
        for (const carrier of body.outbound_sms_prices) {
          carrier.prices = [{ number_type: "mobile", base_price: usd, current_price: usd }];
        }
      }
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
  ], ["twilio", "USD", 399, 50, "twilio_pricing_api"]); // 7.98 cents
  assertEquals(
    db.writes.some((row) => row.country === "NG"),
    false,
    "Termii is never fetched",
  );
  assertEquals(
    db.historyWrites.filter((row) => row.outcome === "accepted").map((row) =>
      row.country
    ).sort(),
    db.writes.map((row) => row.country).sort(),
    "every accepted price joins the anchor history",
  );
  assertEquals(
    db.historyWrites.filter((row) => row.outcome === "refused").map((row) =>
      row.country
    ),
    ["GB"],
    "a refused fetch is recorded for the stable-step rule",
  );
  assertEquals(alerts.length, 1);
  assert(alerts[0].join(" ").includes("GB: refused (changed_over_50_percent)"));
  assert(!alerts[0].join(" ").includes("ACxx"), "never the account SID");
});

Deno.test("#4273 P-6 (tester P3) a feed creeping up 1.5x a day stays refused", async () => {
  // GB has been 4.00 cents for a week; the feed then offers 1.5x more daily.
  const price = { country: "GB", currency: "USD", minor_numerator: 400, minor_denominator: 100 };
  const db = fakeDb([{ ...price }], Array.from({ length: 7 }, () => ({ ...price })));
  let offered = 4;
  const seen: number[] = [];
  for (let d = 10; d <= 19; d += 1) {
    offered *= 1.5;
    await day(db, `2026-11-${d}T06:17:00.000Z`, offered);
    seen.push(gbCents(db));
  }
  // Day 1 (6.00) is within 50% of the 4.00 median and is taken; every later
  // offer is more than 50% from the median, never the same value twice, so
  // the stable-step rule never fires either.
  assertEquals(seen, [6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
});

Deno.test("#4273 P-8 (tester retest 3) a real step change above 50% is accepted on day 3, with an alert", async () => {
  const price = { country: "GB", currency: "USD", minor_numerator: 400, minor_denominator: 100 };
  const db = fakeDb([{ ...price }], Array.from({ length: 7 }, () => ({ ...price })));
  const alerts: string[][] = [];
  await day(db, "2026-11-10T06:17:00.000Z", 9.0, alerts);
  assertEquals(gbCents(db), 4, "day 1: refused");
  await day(db, "2026-11-11T06:17:00.000Z", 9.05, alerts);
  assertEquals(gbCents(db), 4, "day 2: refused (same value within 1%)");
  alerts.length = 0;
  await day(db, "2026-11-12T06:17:00.000Z", 9.02, alerts);
  assertEquals(gbCents(db), 9.02, "day 3: accepted");
  assert(
    alerts.some((a) => a[0].includes("Accepted a price change above 50%")),
    JSON.stringify(alerts),
  );
  // A gap day breaks the run: refused, refused, (no fetch), refused → still 4.
  const db2 = fakeDb([{ ...price }], Array.from({ length: 7 }, () => ({ ...price })));
  await day(db2, "2026-11-10T06:17:00.000Z", 9);
  await day(db2, "2026-11-11T06:17:00.000Z", 9);
  await day(db2, "2026-11-13T06:17:00.000Z", 9);
  assertEquals(gbCents(db2), 4);
});

Deno.test("#4273 P-10 (retest 4) cold start: a 10x or 1000x price is refused against the list price", async () => {
  for (const multiple of [10, 1000, 0.1]) {
    const db = fakeDb([]); // no last price, no history anywhere
    const alerts: string[][] = [];
    await day(db, "2026-11-10T06:17:00.000Z", 5.6 * multiple, alerts);
    assertEquals(
      db.rows.some((row) => row.country === "GB"),
      false,
      `GB at ${multiple}x the list price is not taken`,
    );
    assert(
      alerts.some((a) =>
        a.join(" ").includes("GB: refused (outside_reference_band_needs_manual_accept)")
      ),
      JSON.stringify(alerts),
    );
  }
  // The list price itself (and anything within x0.33-x3) is taken.
  const ok = fakeDb([]);
  await day(ok, "2026-11-10T06:17:00.000Z", 5.6 * 2.5);
  assertEquals(gbCents(ok), 14);
});

Deno.test("#4273 P-11 (retest 4) a stable step is capped at x3 of the anchor; x1.8 is still taken on day 3", async () => {
  const price = { country: "GB", currency: "USD", minor_numerator: 400, minor_denominator: 100 };
  for (const multiple of [10, 1000]) {
    const db = fakeDb([{ ...price }], Array.from({ length: 7 }, () => ({ ...price })));
    const alerts: string[][] = [];
    for (const d of [10, 11, 12, 13]) {
      await day(db, `2026-11-${d}T06:17:00.000Z`, 4 * multiple, alerts);
    }
    assertEquals(gbCents(db), 4, `${multiple}x is never taken on its own`);
    assert(
      alerts.some((a) =>
        a.join(" ").includes("GB: refused (stable_step_beyond_3x_needs_manual_accept)")
      ),
      "and it asks for a manual accept",
    );
  }
  const real = fakeDb([{ ...price }], Array.from({ length: 7 }, () => ({ ...price })));
  await day(real, "2026-11-10T06:17:00.000Z", 7.2);
  await day(real, "2026-11-11T06:17:00.000Z", 7.2);
  assertEquals(gbCents(real), 4, "x1.8 is refused on days 1 and 2");
  await day(real, "2026-11-12T06:17:00.000Z", 7.2);
  assertEquals(gbCents(real), 7.2, "and accepted on day 3");
});

Deno.test("#4273 P-9 (tester retest 3) history older than 180 days is pruned, the latest 7 accepted stay", async () => {
  const old = (iso: string) => ({
    country: "GB",
    currency: "USD",
    minor_numerator: 400,
    minor_denominator: 100,
    recorded_at: iso,
  });
  const ancient = Array.from({ length: 9 }, (_, i) =>
    old(`2025-01-0${i + 1}T06:17:00.000Z`)
  );
  const db = fakeDb([{ ...old("x"), recorded_at: undefined }], [
    ...ancient,
    { ...old("2025-02-01T06:17:00.000Z"), outcome: "refused" },
  ]);
  // A feed failure that day: nothing new accepted, only the prune runs.
  await refreshSmsPrices({
    db,
    accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    authToken: "redacted",
    now: () => new Date("2026-11-10T06:17:00.000Z"),
    alert: () => Promise.resolve(),
    fetch: (() => Promise.resolve(new Response("x", { status: 503 }))) as typeof fetch,
  });
  const gb = db.history.filter((row) => row.country === "GB");
  assertEquals(gb.length, 7, "only the latest 7 accepted survive");
  assert(gb.every((row) => row.outcome === "accepted"));
  assertEquals(
    gb.map((row) => row.recorded_at).sort()[0],
    "2025-01-03T06:17:00.000Z",
  );
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

Deno.test("#4273 P-7 the anchor is the lower median of the last 7", () => {
  const p = (n: number) => ({ currency: "USD", minor_numerator: n, minor_denominator: 1 });
  assertEquals(smsPriceAnchor([]), null);
  assertEquals(smsPriceAnchor([p(9), p(4)])?.minor_numerator, 4);
  assertEquals(
    smsPriceAnchor([p(9), p(9), p(9), p(4), p(4), p(4), p(4), p(1)])
      ?.minor_numerator,
    4,
    "only the newest 7 count",
  );
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
