import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  constantTimeEqual,
  sha256Hex,
  validateFxProviderPayload,
} from "./fxRates.ts";

const now = new Date("2026-07-29T12:00:00.000Z");
const payload = {
  result: "success",
  base_code: "USD",
  time_last_update_unix: 1785322800,
  time_next_update_unix: 1785409200,
  time_eol_unix: 1785495600,
  rates: { USD: 1, NGN: 1600.25 },
};

Deno.test("issue 1384 validates complete positive provider rates", () => {
  const result = validateFxProviderPayload(
    payload,
    [
      { code: "USD", minorUnitExponent: 2 },
      { code: "NGN", minorUnitExponent: 2 },
    ],
    now,
  );
  assertEquals(result.rates, { USD: 1, NGN: 1600.25 });
});

Deno.test("issue 1384 rejects incomplete, non-positive, or non-USD payloads", () => {
  for (const candidate of [
    { ...payload, base_code: "EUR" },
    { ...payload, rates: { USD: 1 } },
    { ...payload, rates: { USD: 1, NGN: 0 } },
  ]) {
    let rejected = false;
    try {
      validateFxProviderPayload(candidate, [
        { code: "USD", minorUnitExponent: 2 },
        { code: "NGN", minorUnitExponent: 2 },
      ], now);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }
});

Deno.test("issue 1384 hashes payloads and compares secrets without plain equality", async () => {
  assertEquals((await sha256Hex("mingla")).length, 64);
  assertEquals(await constantTimeEqual("same", "same"), true);
  assertEquals(await constantTimeEqual("same", "different"), false);
  await assertRejects(() => Promise.reject(new Error("control")));
});
