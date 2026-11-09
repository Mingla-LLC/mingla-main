// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4347 — TESTER ADVERSARIAL, RETEST of the rework (P3-2, P3-4, P3-6).
// The implementor's rework suites test the stamp check with hand-written ids
// and the foreground refresh on the happy timeline. This suite attacks:
//
//   P3-4  the stamp is only worth anything if it CHANGES every launch. Two
//         launches are two fresh module instances (query-string imports); a
//         card persisted by launch 1 (JSON round trip, as Likes / Calendar /
//         deck snapshots do) must not be trusted by launch 2, and must fall
//         back to the client rate or the host's own money.
//   P3-6  the 24 h boundary to the millisecond; a FAILED refresh must not
//         leave the app stuck (the next foreground retries); a burst of
//         foreground events while a fetch is in flight makes ONE request.
//   P3-2  the compact roll-up at every unit boundary.
//
// FAILS-ON-REVERT (verified by the tester on #4347):
//   - a constant LIVE_DISPLAY_PRICE_SESSION (e.g. "live") fails P3-4 cases;
//   - refreshRatesIfStale without its staleness guard fails the boundary and
//     burst cases; turning its `<= CACHE_TTL_MS` into `<` (refetch at exactly
//     24 h) fails the boundary case;
//   - removing the roll-up in compact() fails the P3-2 case.
//
// Run: deno test --allow-read --no-check app-mobile/src/utils/__tests__/issue_4347_rework.tester.adversarial.test.ts

import { buildDisplayPrice, formatApproxAmount, trustedServerPrice } from "../displayPrice.ts";

function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

let seq = 0;
async function launch() {
  seq += 1;
  return await import(`../liveDisplayPriceSession.ts?tester4347launch=${seq}`);
}
async function freshCurrencyService() {
  seq += 1;
  return await import(`../../services/currencyService.ts?tester4347rework=${seq}`);
}

const SYMBOLS: Record<string, string> = { USD: "$", NGN: "₦", EUR: "€" };
const deps = (rateFor: (c: string) => number | null) => ({
  symbolFor: (c: string) => SYMBOLS[c] ?? null,
  rateFor,
  locale: "en-US",
});
const NO_RATES = deps(() => null);
// A rate deliberately far from the server's 74.20 so the source of the figure is visible.
const OTHER_RATES = deps((c) => ({ USD: 1, NGN: 1000 } as Record<string, number>)[c] ?? null);

const LAGOS = { min: 100_000, max: 100_000, sourceCurrency: "NGN", viewerCurrency: "USD" };

// ── P3-4: the stamp is per launch ─────────────────────────────────────────────

Deno.test("#4347 retest P3-4: every launch gets its own stamp", async () => {
  const first = (await launch()).LIVE_DISPLAY_PRICE_SESSION;
  const second = (await launch()).LIVE_DISPLAY_PRICE_SESSION;
  assert(typeof first === "string" && first.length >= 8, `stamp too weak: ${first}`);
  assert(first !== second, `two launches share the stamp "${first}" — a persisted card would be trusted forever`);
});

Deno.test("#4347 retest P3-4: a card persisted by the last launch is not trusted by this one", async () => {
  const lastLaunch = (await launch()).LIVE_DISPLAY_PRICE_SESSION;
  const thisLaunch = (await launch()).LIVE_DISPLAY_PRICE_SESSION;
  // The deck card as deckService stamps it, then a Likes / Calendar round trip.
  const liveCard = {
    ...LAGOS,
    displayPriceMin: 74.2,
    displayPriceMax: 74.2,
    displayCurrency: "USD",
    priceIsApprox: true,
    displayPriceSession: lastLaunch,
  };
  const restored = JSON.parse(JSON.stringify(liveCard));

  // In the launch that received it, the server figure wins over the client rate.
  assertEquals(
    buildDisplayPrice({ ...LAGOS, server: trustedServerPrice(liveCard, lastLaunch) }, OTHER_RATES)?.text,
    "≈ $74",
  );
  // In the next launch: never the old conversion. Client rate if servable…
  assertEquals(
    buildDisplayPrice({ ...LAGOS, server: trustedServerPrice(restored, thisLaunch) }, OTHER_RATES)?.text,
    "≈ $100",
    "the last launch's conversion was reused",
  );
  // …otherwise the host's own money.
  assertEquals(
    buildDisplayPrice({ ...LAGOS, server: trustedServerPrice(restored, thisLaunch) }, NO_RATES)?.text,
    "₦100,000",
  );
});

Deno.test("#4347 retest P3-4: forged or malformed stamps are refused", () => {
  const server = { displayPriceMin: 74.2, displayCurrency: "USD" };
  for (const stamp of ["", null, undefined, 0, true, {}, ["s"]]) {
    assertEquals(trustedServerPrice({ ...server, displayPriceSession: stamp }, "s-now"), null, `stamp ${JSON.stringify(stamp)}`);
  }
  // An empty live session never matches an empty stamp.
  assertEquals(trustedServerPrice({ ...server, displayPriceSession: "" }, ""), null);
  for (const notAnObject of ["USD", 74.2, true]) {
    assertEquals(trustedServerPrice(notAnObject, "s-now"), null);
  }
  // A trusted stamp does not make another member's currency acceptable.
  const euro = { displayPriceMin: 68.1, displayCurrency: "EUR", displayPriceSession: "s-now" };
  assertEquals(buildDisplayPrice({ ...LAGOS, server: trustedServerPrice(euro, "s-now") }, NO_RATES)?.text, "₦100,000");
});

// ── P3-6: foreground refresh ──────────────────────────────────────────────────

const H = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 8, 9);

async function withWorld<T>(
  now: number,
  fetchImpl: () => Promise<Response>,
  counter: { n: number },
  body: () => Promise<T> | T,
): Promise<T> {
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  Date.now = () => now;
  globalThis.fetch = (() => {
    counter.n += 1;
    return fetchImpl();
  }) as typeof fetch;
  try {
    return await body();
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
}
const ok = () => Promise.resolve(new Response(JSON.stringify({ rates: { USD: 1, NGN: 1347.74 } }), { status: 200 }));
const down = () => Promise.reject(new TypeError("Network request failed"));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("#4347 retest P3-6: the 24 h line, to the millisecond", async () => {
  const service = await freshCurrencyService();
  const calls = { n: 0 };
  await withWorld(T0, ok, calls, () => service.fetchExchangeRates());
  assertEquals(calls.n, 1);
  await withWorld(T0 + 24 * H, ok, calls, () => {
    assertEquals(service.refreshRatesIfStale(T0 + 24 * H), false, "refetched at exactly 24 h");
  });
  assertEquals(calls.n, 1);
  await withWorld(T0 + 24 * H + 1, ok, calls, async () => {
    assertEquals(service.refreshRatesIfStale(T0 + 24 * H + 1), true, "24 h + 1 ms did not refetch");
    await settle();
  });
  assertEquals(calls.n, 2);
});

Deno.test("#4347 retest P3-6: a failed refresh is retried on the next foreground, never stuck", async () => {
  const service = await freshCurrencyService();
  const calls = { n: 0 };
  // Offline at launch.
  await withWorld(T0, down, calls, async () => {
    await service.fetchExchangeRates();
  });
  assertEquals(service.getServableRate("NGN"), null);
  // First foreground: still offline. Second: back online.
  await withWorld(T0 + H, down, calls, async () => {
    assertEquals(service.refreshRatesIfStale(T0 + H), true);
    await settle();
  });
  await withWorld(T0 + 2 * H, ok, calls, async () => {
    assertEquals(service.refreshRatesIfStale(T0 + 2 * H), true, "a failed fetch left the refresh disarmed");
    await settle();
    await settle();
  });
  assertEquals(calls.n, 3);
  await withWorld(T0 + 2 * H, ok, calls, () => {
    assertEquals(service.getServableRate("NGN"), 1347.74, "the recovered rate is not servable");
  });
});

Deno.test("#4347 retest P3-6: a burst of foreground events makes ONE request", async () => {
  const service = await freshCurrencyService();
  const calls = { n: 0 };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = async () => {
    await gate;
    return await ok();
  };
  await withWorld(T0, slow, calls, async () => {
    // iOS fires inactive→active on every system sheet (Face ID, permissions).
    for (let i = 0; i < 5; i += 1) service.refreshRatesIfStale(T0);
    release();
    await settle();
    await settle();
  });
  assertEquals(calls.n, 1, "each foreground event started its own request");
  await withWorld(T0 + H, ok, calls, () => {
    assertEquals(service.refreshRatesIfStale(T0 + H), false, "fresh rates were refetched");
  });
  assertEquals(calls.n, 1);
});

// ── P3-2: compact roll-up at every boundary ──────────────────────────────────

Deno.test("#4347 retest P3-2: compact amounts roll up to the next unit, never '1000K' / '1000M'", () => {
  const d = deps(() => null);
  const ngn = (n: number) => formatApproxAmount(n, "NGN", d);
  assertEquals(ngn(999_499), "₦999K");
  assertEquals(ngn(999_500), "₦1M");
  assertEquals(ngn(999_999), "₦1M");
  assertEquals(ngn(9_999_950), "₦10M");
  assertEquals(ngn(99_999_999), "₦100M");
  assertEquals(ngn(999_500_000), "₦1B");
  assertEquals(ngn(1_000_000), "₦1M");
  for (const n of [999_500, 999_999, 999_500_000, 999_999_999]) {
    assert(!/1000[KM]/.test(ngn(n)), `${n} printed ${ngn(n)}`);
  }
});
