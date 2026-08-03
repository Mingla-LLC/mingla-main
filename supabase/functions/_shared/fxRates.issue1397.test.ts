import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sha256Hex, validateFxProviderPayload } from "./fxRates.ts";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const SUPPORTED = [
  { code: "USD", minorUnitExponent: 2 },
  { code: "NGN", minorUnitExponent: 2 },
] as const;
const BASE_PAYLOAD = {
  result: "success",
  base_code: "USD",
  time_last_update_unix: 1785412800,
  time_next_update_unix: 1785499200,
  rates: { USD: 1, NGN: 1534.25 },
};

Deno.test("issue 1397 accepts Open V6 no-EOL sentinel without fabricating a date", async () => {
  const first = validateFxProviderPayload(
    { ...BASE_PAYLOAD, time_eol_unix: 0 },
    SUPPORTED,
    NOW,
  );
  const second = validateFxProviderPayload(
    { ...BASE_PAYLOAD, time_eol_unix: 0 },
    SUPPORTED,
    NOW,
  );

  assertEquals(first.providerEolAt, null);
  assertEquals(JSON.parse(first.canonicalPayload).providerEolAt, null);
  assertEquals(first.canonicalPayload, second.canonicalPayload);
  assertEquals(
    await sha256Hex(first.canonicalPayload),
    await sha256Hex(second.canonicalPayload),
  );
});

Deno.test("issue 1397 preserves a positive future provider EOL", () => {
  const result = validateFxProviderPayload(
    { ...BASE_PAYLOAD, time_eol_unix: 1785585600 },
    SUPPORTED,
    NOW,
  );

  assertEquals(result.providerEolAt, "2026-08-01T12:00:00.000Z");
});

Deno.test("issue 1397 fails closed for a past nonzero provider EOL", () => {
  assertThrows(
    () =>
      validateFxProviderPayload(
        { ...BASE_PAYLOAD, time_eol_unix: 1785326400 },
        SUPPORTED,
        NOW,
      ),
    Error,
    "provider_data_expired",
  );
});

Deno.test("issue 1397 rejects invalid negative or missing EOL data", async () => {
  for (const time_eol_unix of [-1, undefined]) {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validateFxProviderPayload(
            { ...BASE_PAYLOAD, time_eol_unix },
            SUPPORTED,
            NOW,
          )
        ),
      Error,
      "invalid_provider_eol_at",
    );
  }
});

Deno.test("issue 1397 canonical hash distinguishes no EOL from an announced future EOL", async () => {
  const sentinel = validateFxProviderPayload(
    { ...BASE_PAYLOAD, time_eol_unix: 0 },
    SUPPORTED,
    NOW,
  );
  const repeatedSentinel = validateFxProviderPayload(
    { ...BASE_PAYLOAD, time_eol_unix: 0 },
    SUPPORTED,
    NOW,
  );
  const future = validateFxProviderPayload(
    { ...BASE_PAYLOAD, time_eol_unix: 1785585600 },
    SUPPORTED,
    NOW,
  );

  assertEquals(JSON.parse(sentinel.canonicalPayload).providerEolAt, null);
  assertEquals(
    JSON.parse(future.canonicalPayload).providerEolAt,
    "2026-08-01T12:00:00.000Z",
  );
  assertEquals(sentinel.canonicalPayload, repeatedSentinel.canonicalPayload);
  assertEquals(
    await sha256Hex(sentinel.canonicalPayload),
    await sha256Hex(repeatedSentinel.canonicalPayload),
  );
  assertNotEquals(sentinel.canonicalPayload, future.canonicalPayload);
  assertNotEquals(
    await sha256Hex(sentinel.canonicalPayload),
    await sha256Hex(future.canonicalPayload),
  );
});
