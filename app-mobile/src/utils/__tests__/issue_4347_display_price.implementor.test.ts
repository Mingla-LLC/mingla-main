// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4347 — Explorer showed a Lagos experience priced ₦100,000 as
// "$100,000" to a dollar viewer: the amount was formatted with no source
// currency, defaulted to USD, and USD→USD is a no-op. These are the display
// rules approved on the issue (2026-11-08), run against the ONE producer.
//
// FAILS-ON-REVERT: making buildDisplayPrice ignore the source currency (treat
// every amount as the viewer's), dropping the "≈", writing the viewer's symbol
// on an unconverted number, or summing an AI plan's tier constants into money
// fails here.
//
// Run: deno test --allow-read --no-check app-mobile/src/utils/__tests__/issue_4347_display_price.implementor.test.ts

import { buildDisplayPrice, formatFromPrice, isFreePrice, roundApproxAmount, trustedServerPrice } from "../displayPrice.ts";
import { curatedSpendLevel } from "../curatedPriceRange.ts";

function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const SYMBOLS: Record<string, string> = { USD: "$", NGN: "₦", EUR: "€", GBP: "£" };
// 1 USD = rate units; today's snapshot had 1 USD = ₦1,347.74.
const RATES: Record<string, number> = { USD: 1, NGN: 1347.74, EUR: 0.92, GBP: 0.78 };
const deps = {
  symbolFor: (code: string) => SYMBOLS[code] ?? null,
  rateFor: (code: string) => RATES[code] ?? null,
  locale: "en-US",
};
const noRates = { ...deps, rateFor: () => null };

Deno.test("#4347 the reported card: ₦100,000 to a dollar viewer reads ≈ $74, never $100,000", () => {
  const price = buildDisplayPrice(
    { min: 100_000, max: 100_000, sourceCurrency: "NGN", viewerCurrency: "USD" },
    deps,
  );
  assertEquals(price?.text, "≈ $74");
  assertEquals(price?.isApprox, true);
  assertEquals(price?.sourceText, "₦100,000", "the original is kept for the 'charged in naira' line");
  assertEquals(price?.sourceCurrency, "NGN");
});

Deno.test("#4347 the server's snapshot conversion wins when it is in the viewer's currency", () => {
  const price = buildDisplayPrice(
    {
      min: 100_000,
      sourceCurrency: "NGN",
      viewerCurrency: "USD",
      server: { displayPriceMin: 74.2, displayPriceMax: 74.2, displayCurrency: "USD", priceIsApprox: true },
    },
    noRates,
  );
  assertEquals(price?.text, "≈ $74");
});

Deno.test("#4347 collab: a conversion made for ANOTHER member's currency is never shown", () => {
  // The card was converted for a euro viewer; this viewer is in dollars.
  const price = buildDisplayPrice(
    {
      min: 100_000,
      sourceCurrency: "NGN",
      viewerCurrency: "USD",
      server: { displayPriceMin: 68, displayCurrency: "EUR", priceIsApprox: true },
    },
    deps,
  );
  assertEquals(price?.text, "≈ $74", "converted for THIS viewer, not the euro figure");
});

Deno.test("#4347 same currency: exact, no mark", () => {
  assertEquals(
    buildDisplayPrice({ min: 5_000, max: 7_500, sourceCurrency: "NGN", viewerCurrency: "NGN" }, deps)?.text,
    "₦5,000–₦7,500",
  );
  assertEquals(
    buildDisplayPrice({ min: 12.5, sourceCurrency: "USD", viewerCurrency: "USD" }, deps)?.text,
    "$12.50",
  );
});

Deno.test("#4347 no servable rate: the source money with its OWN symbol, never the viewer's", () => {
  const price = buildDisplayPrice(
    { min: 100_000, sourceCurrency: "NGN", viewerCurrency: "USD" },
    noRates,
  );
  assertEquals(price?.text, "₦100,000");
  assertEquals(price?.isApprox, false);
  assertEquals(price?.sourceText, null);
  // A currency with no glyph in the table is written with its code.
  assertEquals(
    buildDisplayPrice({ min: 900, sourceCurrency: "ISK", viewerCurrency: "USD" }, noRates)?.text,
    "ISK 900",
  );
});

Deno.test("#4347 a price with no source currency is not printed at all", () => {
  assertEquals(buildDisplayPrice({ min: 50, sourceCurrency: "", viewerCurrency: "USD" }, deps), null);
  assertEquals(buildDisplayPrice({ min: Number.NaN, sourceCurrency: "USD", viewerCurrency: "USD" }, deps), null);
});

Deno.test("#4347 rounding: <100 whole, <1,000 to 5, <10,000 to 10, ≥10,000 compact", () => {
  assertEquals(roundApproxAmount(73.6), 74);
  assertEquals(roundApproxAmount(362), 360);
  assertEquals(roundApproxAmount(363), 365);
  assertEquals(roundApproxAmount(4_444), 4_440);
  // ₦ viewer, $ source: $899 → ≈ ₦1.2M; $100 → ≈ ₦135K.
  assertEquals(buildDisplayPrice({ min: 899, sourceCurrency: "USD", viewerCurrency: "NGN" }, deps)?.text, "≈ ₦1.2M");
  assertEquals(buildDisplayPrice({ min: 100, sourceCurrency: "USD", viewerCurrency: "NGN" }, deps)?.text, "≈ ₦135K");
});

Deno.test("#4347 ranges keep both ends; open-ended reads 'from'", () => {
  assertEquals(
    buildDisplayPrice({ min: 50_000, max: 150_000, sourceCurrency: "NGN", viewerCurrency: "USD" }, deps)?.text,
    "≈ $37–$110", // 111.3 is over 100, so it rounds to the nearest 5
  );
  assertEquals(
    buildDisplayPrice({ min: 100_000, max: 100_000, openEnded: true, sourceCurrency: "NGN", viewerCurrency: "USD" }, deps)?.text,
    "≈ $74+",
  );
  assertEquals(isFreePrice(0, 0), true);
  assertEquals(isFreePrice(0, 10), false);
});

Deno.test("#4347 Decision 2: an AI plan shows a spend level, never its USD tier constants", () => {
  // admin-seed-places tier constants: chill 0–50, comfy 50–150, bougie 150–300, lavish 300–500.
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 0 }, { priceMin: 0, priceMax: 0 }]), "free");
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 50 }, { priceMin: 0, priceMax: 0 }]), "budget");
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 50 }, { priceMin: 50, priceMax: 150 }]), "moderate");
  assertEquals(curatedSpendLevel([{ priceMin: 50, priceMax: 150 }, { priceMin: 300, priceMax: 500 }]), "upscale");
  assertEquals(curatedSpendLevel([]), null, "no stops: no level rather than an invented one");
});

Deno.test("#4347 rework: server fields are trusted only from THIS session's live deck response", async () => {
  const live = { displayPriceMin: 74.2, displayCurrency: "USD", priceIsApprox: true, displayPriceSession: "s-now" };
  assertEquals(trustedServerPrice(live, "s-now"), live);
  // A Likes / Calendar copy from an earlier launch, or one never stamped.
  assertEquals(trustedServerPrice({ ...live, displayPriceSession: "s-last-week" }, "s-now"), null);
  assertEquals(trustedServerPrice({ ...live, displayPriceSession: undefined }, "s-now"), null);
  assertEquals(trustedServerPrice(null, "s-now"), null);

  // Through the binding's order: an untrusted saved figure is dropped, and the
  // price is recomputed (or shown in its own currency with no servable rate).
  const saved = { displayPriceMin: 50, displayCurrency: "USD", priceIsApprox: true, displayPriceSession: "old" };
  const lagos = { min: 100_000, sourceCurrency: "NGN", viewerCurrency: "USD" };
  assertEquals(buildDisplayPrice({ ...lagos, server: trustedServerPrice(saved, "s-now") }, noRates)?.text, "₦100,000");
  assertEquals(buildDisplayPrice({ ...lagos, server: trustedServerPrice(saved, "s-now") }, deps)?.text, "≈ $74");

  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const formatters = strip(await Deno.readTextFile(new URL("../../components/utils/formatters.ts", import.meta.url)));
  if (!/trustedServerPrice\(input\.server, LIVE_DISPLAY_PRICE_SESSION\)/.test(formatters)) {
    throw new Error("formatDisplayPrice trusts server fields without the live-session check");
  }
  const deck = strip(await Deno.readTextFile(new URL("../../services/deckService.ts", import.meta.url)));
  if (!deck.includes("? LIVE_DISPLAY_PRICE_SESSION : null")) {
    throw new Error("deckService no longer stamps live display fields");
  }
});

Deno.test("#4347 venue experience rows: From ≈ $74 converted, exact when same currency, own symbol with no rate", () => {
  const labels = { free: "Gratis", from: (price: string) => `Desde ${price}` };
  const withRates = (p) => buildDisplayPrice(p, deps);
  const withoutRates = (p) => buildDisplayPrice(p, noRates);
  // ₦100,000 = 10,000,000 kobo, viewer in dollars.
  const row = { isFree: false, fromMinor: 10_000_000, currency: "NGN", viewerCurrency: "USD" };
  assertEquals(formatFromPrice(row, withRates, labels), "Desde ≈ $74", "the row printed naira as dollars, or did not convert");
  assertEquals(formatFromPrice({ ...row, viewerCurrency: "NGN" }, withRates, labels), "Desde ₦100,000");
  assertEquals(formatFromPrice(row, withoutRates, labels), "Desde ₦100,000", "no rate: own currency, own symbol");
  assertEquals(formatFromPrice({ ...row, isFree: true }, withRates, labels), "Gratis");
  assertEquals(formatFromPrice({ ...row, fromMinor: null }, withRates, labels), "", "no priced tier: nothing");
  assertEquals(formatFromPrice({ ...row, currency: null }, withRates, labels), "", "no currency: never a USD guess");
});
