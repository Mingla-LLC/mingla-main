// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4347 rework (P3-6) — exchange rates were fetched only at launch. A
// phone left in the background for days kept a rate that stops being
// servable at 48 hours, and every converted price fell back to its source
// currency. Returning to the foreground now refetches once the last LIVE
// fetch is over 24 hours old.
//
// FAILS-ON-REVERT: deleting refreshRatesIfStale's age check (or the
// AppState "active" listener in AppStateManager.tsx) fails here.
//
// Run: deno test --allow-read --no-check app-mobile/src/services/__tests__/issue_4347_rates_freshness.implementor.test.ts

function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  if (actual !== expected) throw new Error(`${message}\n  actual:   ${actual}\n  expected: ${expected}`);
}
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

let seq = 0;
async function freshService() {
  seq += 1;
  return await import(`../currencyService.ts?rates4347=${seq}`);
}

async function withWorld<T>(nowMs: number, calls: { n: number }, fn: () => Promise<T> | T): Promise<T> {
  const realNow = Date.now;
  const realFetch = globalThis.fetch;
  Date.now = () => nowMs;
  globalThis.fetch = () => {
    calls.n += 1;
    return Promise.resolve(new Response(JSON.stringify({ rates: { USD: 1, NGN: 1347.74 } }), { status: 200 }));
  };
  try {
    return await fn();
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
  }
}

const H = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 8, 12);

Deno.test("#4347 foreground refresh: never fetched → fetch now", async () => {
  const service = await freshService();
  const calls = { n: 0 };
  await withWorld(T0, calls, async () => {
    assertEquals(service.refreshRatesIfStale(), true, "a cold app did not refetch on foreground");
    await service.fetchExchangeRates(); // join the in-flight fetch
  });
  assertEquals(calls.n, 1);
  await withWorld(T0, calls, () => assertEquals(service.getServableRate("NGN"), 1347.74));
});

Deno.test("#4347 foreground refresh: fresh rates are left alone; over 24 h they are refetched", async () => {
  const service = await freshService();
  const calls = { n: 0 };
  await withWorld(T0, calls, () => service.fetchExchangeRates());
  assertEquals(calls.n, 1);
  await withWorld(T0 + 23 * H, calls, () => {
    assertEquals(service.refreshRatesIfStale(), false, "refetched fresh rates on every foreground");
  });
  assertEquals(calls.n, 1);
  await withWorld(T0 + 25 * H, calls, async () => {
    assertEquals(service.refreshRatesIfStale(), true, "a 25 h old rate was not refreshed on foreground");
    await service.fetchExchangeRates();
  });
  assertEquals(calls.n, 2);
  // …and the refreshed rate is servable well past the original 48 h line.
  await withWorld(T0 + 60 * H, calls, () => assertEquals(service.getServableRate("NGN"), 1347.74));
});

Deno.test("#4347 the app refreshes on return to the foreground", async () => {
  const src = await Deno.readTextFile(new URL("../../components/AppStateManager.tsx", import.meta.url));
  assert(/AppState\.addEventListener\("change"/.test(src), "AppStateManager no longer listens for foreground");
  assert(/next === "active"\) refreshRatesIfStale\(\)/.test(src), "foreground does not refresh stale rates");
  assert(src.includes("sub.remove()"), "the AppState listener is never removed");
});
