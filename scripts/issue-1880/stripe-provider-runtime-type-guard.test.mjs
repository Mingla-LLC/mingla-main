import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync(
  new URL(
    "../../packages/payments-native/StripeNativeProvider.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Stripe config rejects non-string native values before SDK initialization", () => {
  assert.match(provider, /Record<string, unknown>/);
  assert.match(provider, /typeof fromExtra === ["']string["']/);
  assert.match(provider, /typeof fromEnv === ["']string["']/);
  assert.doesNotMatch(provider, /return fromExtra \?\? fromEnv/);
});
