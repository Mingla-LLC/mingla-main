import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("#4174 — every Explorer Google Pay rail derives test mode from the Stripe key", async () => {
  const cases = [
    ["../src/payments/nativeCheckoutFlow.ts", "data.publishableKey"],
    ["../src/hooks/useReserveTable.ts", "created.publishableKey"],
    ["../src/components/venueOrdering/useConsumerVenueOrdering.ts", "created.publishableKey"],
    ["../src/components/stay/ConsumerStayGuestExperience.tsx", "payment.publishableKey"],
    ["../app/stay/[groupId].tsx", "payment.publishableKey"],
  ] as const;

  for (const [path, keyExpression] of cases) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assertStringIncludes(source, "isStripeGooglePayTestEnv");
    assertStringIncludes(
      source,
      `testEnv: isStripeGooglePayTestEnv(${keyExpression})`,
    );
    assertEquals(
      source.includes("process.env.EAS_BUILD_PROFILE"),
      false,
      `${path} must not infer a Stripe environment from an EAS profile`,
    );
  }
});
