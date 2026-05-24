import {
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0953 §3.7 — consumer Google Pay EAS profile gate is source-of-truth", async () => {
  const source = await Deno.readTextFile(
    new URL("../src/payments/nativeCheckoutFlow.ts", import.meta.url),
  );
  assertStringIncludes(
    source,
    'process.env.EAS_BUILD_PROFILE !== "production"',
  );
  assertStringIncludes(source, "testEnv: isStripeGooglePayTestEnv()");
  if (source.includes("testEnv: __DEV__")) {
    throw new Error(
      "consumer native checkout must not gate Google Pay on __DEV__",
    );
  }
});
