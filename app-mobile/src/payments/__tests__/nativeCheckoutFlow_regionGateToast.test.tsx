import {
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0953 §3.8 — consumer maps region-gate 400 to web-fallback copy", async () => {
  const source = await Deno.readTextFile(
    new URL("../nativeCheckoutFlow.ts", import.meta.url),
  );
  assertStringIncludes(source, "native_paid_not_allowed_in_region");
  assertStringIncludes(source, "Pay on the web to complete checkout");
});
