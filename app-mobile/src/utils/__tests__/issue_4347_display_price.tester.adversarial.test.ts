// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4347 — TESTER ADVERSARIAL. The implementor's suites feed
// buildDisplayPrice a hand-made rate table. This suite attacks what they do not:
//
//   1. The REAL client rate source (services/currencyService.ts), with the
//      network stubbed. The app ships a months-old FALLBACK_RATES table
//      (NGN 1600) and `getRate` answers 1.0 for anything unknown. Neither may
//      ever produce an "≈" figure: only a live fetch inside 48 hours is
//      servable. Each case loads a FRESH module instance (query-string import),
//      so module-level cache state cannot leak between cases.
//   2. The collab case with NO servable client rate: a server conversion made
//      for another member's currency must fall back to the source money with
//      its OWN symbol, never the other member's figure.
//   3. Hostile numbers (negative, NaN, Infinity, min > max) and the rounding
//      boundaries 99.5 / 999.5 / 9,999.5 / 10,000.
//   4. EUR and GBP viewers on NGN prices, an NGN viewer on USD prices, and
//      zero-decimal-ish HUF / ISK, all through the real servable-rate binding.
//
// FAILS-ON-REVERT (verified by the tester, see #4347):
//   - getServableRate answering from the fallback table / getRate (no live
//     fetch, or a fetch older than 48 h) fails cases 1a, 1c, 1d and 2.
//   - dropping the `displayCurrency === viewer` check in buildDisplayPrice
//     fails case 2.
//
// Run: deno test --allow-read --no-check app-mobile/src/utils/__tests__/issue_4347_display_price.tester.adversarial.test.ts

import { buildDisplayPrice, formatApproxAmount, roundApproxAmount } from "../displayPrice.ts";
import { curatedSpendLevel } from "../curatedPriceRange.ts";

function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const SYMBOLS: Record<string, string> = { USD: "$", NGN: "₦", EUR: "€", GBP: "£", HUF: "Ft", ISK: "kr" };
const symbolFor = (code: string) => SYMBOLS[code] ?? null;

// The live provider's answer on 2026-11-08 (1 USD = rate units).
const LIVE = { USD: 1, NGN: 1347.74, EUR: 0.92, GBP: 0.78, HUF: 360, ISK: 138 };

let seq = 0;
/** A FRESH currencyService instance (module state is per specifier). */
async function freshCurrencyService() {
  seq += 1;
  return await import(`../../services/currencyService.ts?tester4347=${seq}`);
}

async function withFetch<T>(response: () => Promise<Response>, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (() => response()) as typeof fetch;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

async function withNow<T>(now: number, body: () => T | Promise<T>): Promise<T> {
  const original = Date.now;
  Date.now = () => now;
  try {
    return await body();
  } finally {
    Date.now = original;
  }
}

const liveOk = (rates: Record<string, number>) => () =>
  Promise.resolve(new Response(JSON.stringify({ base: "USD", rates }), { status: 200 }));

function depsFrom(service: { getServableRate: (c: string) => number | null }) {
  return { symbolFor, rateFor: service.getServableRate, locale: "en-US" };
}

const LAGOS = { min: 100_000, max: 100_000, sourceCurrency: "NGN", viewerCurrency: "USD" };

// ── 1. The real client rate source ────────────────────────────────────────────

Deno.test("#4347 adv 1a: before any live fetch the fallback table is NOT servable (NGN 1600 never becomes ≈ $63)", async () => {
  const service = await freshCurrencyService();
  // The months-old table is still what getRate answers…
  assertEquals(service.getRate("NGN"), 1600, "precondition: the stale fallback is loaded");
  // …but it may not put an ≈ figure in front of anyone.
  assertEquals(service.getServableRate("NGN"), null, "fallback rate served as live");
  assertEquals(service.getServableRate("XYZ"), null, "getRate's 1:1 guess served as a rate");
  const price = buildDisplayPrice(LAGOS, depsFrom(service));
  assertEquals(price?.text, "₦100,000", "no servable rate: the source money with its OWN symbol");
  assertEquals(price?.isApprox, false);
});

Deno.test("#4347 adv 1b: a live fetch makes the rate servable and the card reads ≈ $74", async () => {
  const service = await freshCurrencyService();
  await withFetch(liveOk(LIVE), () => service.fetchExchangeRates());
  assertEquals(service.getServableRate("NGN"), 1347.74);
  assertEquals(buildDisplayPrice(LAGOS, depsFrom(service))?.text, "≈ $74");
});

Deno.test("#4347 adv 1c: a live rate older than 48 hours stops being servable", async () => {
  const service = await freshCurrencyService();
  const fetchedAt = Date.UTC(2026, 10, 8, 12);
  await withNow(fetchedAt, () => withFetch(liveOk(LIVE), () => service.fetchExchangeRates()));
  const H = 60 * 60 * 1000;
  await withNow(fetchedAt + 47 * H, () => {
    assertEquals(service.getServableRate("NGN"), 1347.74, "47 h old is still servable");
  });
  await withNow(fetchedAt + 48 * H + 1, () => {
    assertEquals(service.getServableRate("NGN"), null, "a 48 h+ rate was served");
    assertEquals(
      buildDisplayPrice(LAGOS, depsFrom(service))?.text,
      "₦100,000",
      "a stale rate produced an ≈ figure",
    );
  });
});

Deno.test("#4347 adv 1d: a failed fetch at startup leaves NOTHING servable (HTTP 500 and network error)", async () => {
  for (const response of [
    () => Promise.resolve(new Response("boom", { status: 500 })),
    () => Promise.reject(new TypeError("Network request failed")),
    () => Promise.resolve(new Response(JSON.stringify({ rates: { NGN: 1347 } }), { status: 200 })), // no USD anchor
  ]) {
    const service = await freshCurrencyService();
    await withFetch(response, () => service.fetchExchangeRates());
    assertEquals(service.getServableRate("NGN"), null, "a failed fetch made the fallback servable");
    assertEquals(service.getServableRate("EUR"), null);
    assertEquals(buildDisplayPrice({ ...LAGOS, viewerCurrency: "EUR" }, depsFrom(service))?.text, "₦100,000");
  }
});

Deno.test("#4347 adv 1e: EUR / GBP viewers on naira and a naira viewer on dollars, through the real binding", async () => {
  const service = await freshCurrencyService();
  await withFetch(liveOk(LIVE), () => service.fetchExchangeRates());
  const deps = depsFrom(service);
  const eur = buildDisplayPrice({ min: 100_000, sourceCurrency: "NGN", viewerCurrency: "EUR" }, deps);
  assertEquals(eur?.text, "≈ €68");
  assertEquals(eur?.sourceText, "₦100,000");
  const gbp = buildDisplayPrice({ min: 100_000, max: 250_000, sourceCurrency: "NGN", viewerCurrency: "GBP" }, deps);
  assertEquals(gbp?.text, "≈ £58–£145");
  assertEquals(gbp?.sourceText, "₦100,000–₦250,000");
  // A naira viewer on a $25 ticket: compact, never "₦25".
  const ngn = buildDisplayPrice({ min: 25, sourceCurrency: "USD", viewerCurrency: "NGN" }, deps);
  assertEquals(ngn?.text, "≈ ₦33.7K");
  assertEquals(ngn?.sourceText, "$25");
  // HUF / ISK (no minor unit in practice): whole numbers on the ≈ side.
  assertEquals(buildDisplayPrice({ min: 25, sourceCurrency: "USD", viewerCurrency: "HUF" }, deps)?.text, "≈ Ft9,000");
  assertEquals(buildDisplayPrice({ min: 9_000, sourceCurrency: "ISK", viewerCurrency: "USD" }, deps)?.text, "≈ $65");
  // USD is the anchor: a USD viewer on a USD price is exact even with no fetch.
  const cold = await freshCurrencyService();
  assertEquals(buildDisplayPrice({ min: 12.5, sourceCurrency: "USD", viewerCurrency: "USD" }, depsFrom(cold))?.text, "$12.50");
});

Deno.test({
  name: "#4347 adv 1f KNOWN DEFECT: a currency the live provider omits is served from the stale fallback table",
  // P3 on #4347: fetchExchangeRates merges FALLBACK_RATES under the live
  // answer ({ ...FALLBACK_RATES, ...rates }), and getServableRate only checks
  // the fetch time, so NGN 1600 (months old) is served as live when the
  // provider's payload has no NGN. Un-ignore with the fix.
  fn: async () => {
    const service = await freshCurrencyService();
    const { NGN: _omitted, ...withoutNaira } = LIVE;
    await withFetch(liveOk(withoutNaira), () => service.fetchExchangeRates());
    assertEquals(service.getServableRate("NGN"), null, "stale fallback NGN served as a live rate");
  },
});

// ── 2. Collab with no servable client rate ────────────────────────────────────

Deno.test("#4347 adv 2: another member's server conversion is never shown, even when the client has no rate", async () => {
  const service = await freshCurrencyService(); // never fetched → nothing servable
  const price = buildDisplayPrice(
    {
      ...LAGOS,
      server: { displayPriceMin: 68.1, displayPriceMax: 68.1, displayCurrency: "EUR", priceIsApprox: true },
    },
    depsFrom(service),
  );
  assertEquals(price?.text, "₦100,000", "a euro figure (or a $ on a euro number) reached a dollar viewer");
  assertEquals(price?.currency, "NGN");
  // Lowercase / padded server codes still match THIS viewer.
  const own = buildDisplayPrice(
    { ...LAGOS, server: { displayPriceMin: 74.2, displayPriceMax: 74.2, displayCurrency: " usd " } },
    depsFrom(service),
  );
  assertEquals(own?.text, "≈ $74");
  // A poisoned server figure (NaN / negative) is ignored, not printed.
  for (const bad of [Number.NaN, -74, Number.POSITIVE_INFINITY]) {
    const poisoned = buildDisplayPrice(
      { ...LAGOS, server: { displayPriceMin: bad, displayCurrency: "USD" } },
      depsFrom(service),
    );
    assertEquals(poisoned?.text, "₦100,000", `server displayPriceMin ${bad} was printed`);
  }
  // Same currency as the viewer: the server is not consulted and nothing is ≈.
  const same = buildDisplayPrice(
    { min: 5_000, sourceCurrency: "NGN", viewerCurrency: "NGN", server: { displayPriceMin: 1, displayCurrency: "NGN" } },
    depsFrom(service),
  );
  assertEquals(same?.text, "₦5,000");
  assertEquals(same?.isApprox, false);
});

// ── 3. Hostile numbers and rounding boundaries ────────────────────────────────

const RATES = { symbolFor, rateFor: (c: string) => LIVE[c as keyof typeof LIVE] ?? null, locale: "en-US" };

Deno.test("#4347 adv 3a: negative, NaN, Infinity and min > max never print a made-up price", () => {
  assertEquals(buildDisplayPrice({ min: -5, sourceCurrency: "USD", viewerCurrency: "USD" }, RATES), null);
  assertEquals(buildDisplayPrice({ min: Number.NaN, sourceCurrency: "NGN", viewerCurrency: "USD" }, RATES), null);
  assertEquals(buildDisplayPrice({ min: Number.POSITIVE_INFINITY, sourceCurrency: "NGN", viewerCurrency: "USD" }, RATES), null);
  // An unusable max is dropped, never printed as "∞" or "NaN".
  assertEquals(buildDisplayPrice({ min: 10, max: Number.POSITIVE_INFINITY, sourceCurrency: "USD", viewerCurrency: "USD" }, RATES)?.text, "$10");
  assertEquals(buildDisplayPrice({ min: 10, max: -3, sourceCurrency: "USD", viewerCurrency: "USD" }, RATES)?.text, "$10");
  // min > max (the pre-#4265 "max 0 under a real min" shape) reads "from".
  assertEquals(buildDisplayPrice({ min: 5_000, max: 100, sourceCurrency: "NGN", viewerCurrency: "NGN" }, RATES)?.text, "₦5,000+");
  // A source code that is not a currency is not a price.
  for (const bad of ["", "$", "NAIRA", "ng", null, undefined, 42]) {
    assertEquals(buildDisplayPrice({ min: 10, sourceCurrency: bad, viewerCurrency: "USD" }, RATES), null, `source ${bad}`);
  }
  // A garbage VIEWER code shows the source as-is rather than guessing one.
  assertEquals(buildDisplayPrice({ ...LAGOS, viewerCurrency: "dollars" }, RATES)?.text, "₦100,000");
});

Deno.test("#4347 adv 3b: rounding boundaries 99.5 / 999.5 / 9,999.5 / 10,000", () => {
  const usd = (n: number) => formatApproxAmount(n, "USD", RATES);
  assertEquals(usd(99.4), "$99");
  assertEquals(usd(99.5), "$100");
  assertEquals(usd(999.4), "$1,000");
  assertEquals(usd(999.5), "$1,000");
  assertEquals(usd(9_999.4), "$10,000");
  assertEquals(usd(9_999.5), "$10,000");
  assertEquals(usd(10_000), "$10K");
  assertEquals(usd(99_949), "$99.9K");
  assertEquals(usd(99_950), "$100K");
  assertEquals(usd(1_250_000), "$1.3M");
  assertEquals(roundApproxAmount(2.5), 3);
  assertEquals(roundApproxAmount(102.5), 105);
  assertEquals(roundApproxAmount(1_005), 1_010);
  // A narrow range that rounds to one figure is said once, not "$74–$74".
  assertEquals(
    buildDisplayPrice({ min: 100_000, max: 100_200, sourceCurrency: "NGN", viewerCurrency: "USD" }, RATES)?.text,
    "≈ $74",
  );
});

Deno.test({
  name: "#4347 adv 3c KNOWN DEFECT: 999,950 to 999,999 prints '1000K' instead of '1M'",
  // P3 on #4347: compact() picks the unit before rounding. Un-ignore with the fix.
  fn: () => {
    assertEquals(formatApproxAmount(999_950, "NGN", RATES), "₦1M");
    assertEquals(formatApproxAmount(999_999_999, "NGN", RATES), "₦1B");
  },
});

// ── 4. Spend level boundaries (Decision 2) ────────────────────────────────────

Deno.test("#4347 adv 4: spend level boundaries and hostile stop prices", () => {
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 50 }]), "budget");
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 50.01 }]), "moderate");
  assertEquals(curatedSpendLevel([{ priceMin: 150, priceMax: 150 }]), "moderate");
  assertEquals(curatedSpendLevel([{ priceMin: 150.01, priceMax: 0 }]), "upscale", "open-ended (max below min) still counts its min");
  assertEquals(curatedSpendLevel([{ priceMin: Number.NaN, priceMax: 120 }]), "moderate");
  assertEquals(curatedSpendLevel([{ priceMin: -500, priceMax: 40 }]), "budget", "a negative amount cannot lift or sink the level");
  assertEquals(curatedSpendLevel(undefined as never), null);
});
