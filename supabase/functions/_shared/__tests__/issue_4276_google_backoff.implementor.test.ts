// Issue #4276 C8: Google 429 waits and tries again, honours Retry-After, and gives the
// caller the last response so the failure is still recorded.
//
// FAILS-ON-REVERT: remove the retry loop and "retries a 429" sees one call.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { backoffWaitMs, createConcurrencyLimit, fetchWithGoogleBackoff, retryAfterMs } from "../googleBackoff.ts";

function script(...statuses: Array<[number, Record<string, string>?]>) {
  let i = 0;
  const calls = { count: 0 };
  const call = () => {
    calls.count++;
    const [status, headers] = statuses[Math.min(i++, statuses.length - 1)];
    return Promise.resolve(new Response("x", { status, headers }));
  };
  return { call, calls };
}

Deno.test("retries a 429 with exponential waits, then succeeds", async () => {
  const { call, calls } = script([429], [429], [200]);
  const waits: number[] = [];
  const res = await fetchWithGoogleBackoff(call, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); }, random: () => 0 });
  assertEquals(res.status, 200);
  assertEquals(calls.count, 3);
  assertEquals(waits, [1000, 2000]);
});

Deno.test("Retry-After is respected over the backoff, up to the cap", async () => {
  const { call } = script([429, { "retry-after": "7" }], [200]);
  const waits: number[] = [];
  await fetchWithGoogleBackoff(call, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
  assertEquals(waits, [7000]);
  assertEquals(retryAfterMs("Thu, 05 Nov 2026 12:00:10 GMT", Date.parse("2026-11-05T12:00:00Z")), 10_000);
  assertEquals(retryAfterMs("nonsense"), null);
  assertEquals(backoffWaitMs(1, 999_000, { baseMs: 1000, maxWaitMs: 30_000, random: 0 }), 30_000);
});

Deno.test("gives up after its attempts and returns the 429, so it gets recorded", async () => {
  const { call, calls } = script([429]);
  const res = await fetchWithGoogleBackoff(call, { sleep: () => Promise.resolve() });
  assertEquals(res.status, 429);
  assertEquals(calls.count, 4);
});

Deno.test("other errors are the caller's and aren't retried", async () => {
  const { call, calls } = script([400]);
  const res = await fetchWithGoogleBackoff(call, { sleep: () => Promise.resolve() });
  assertEquals(res.status, 400);
  assertEquals(calls.count, 1);
});

Deno.test("the concurrency limit holds", async () => {
  const limit = createConcurrencyLimit(2);
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 8 }, () =>
    limit(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
    })));
  assertEquals(peak, 2);
});
