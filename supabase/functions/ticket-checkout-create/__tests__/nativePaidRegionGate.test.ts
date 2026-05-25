import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  getNativePaidAllowedRegions,
  isNativePaidAllowedForBrand,
} from "../../_shared/stripeTax.ts";

Deno.test("ORCH-0953 §3.8 — empty NATIVE_PAID_ALLOWED_REGIONS disables native paid", () => {
  const prior = Deno.env.get("NATIVE_PAID_ALLOWED_REGIONS");
  try {
    Deno.env.delete("NATIVE_PAID_ALLOWED_REGIONS");
    assertEquals(getNativePaidAllowedRegions(), []);
    assertEquals(isNativePaidAllowedForBrand("US"), false);
  } finally {
    if (prior === undefined) Deno.env.delete("NATIVE_PAID_ALLOWED_REGIONS");
    else Deno.env.set("NATIVE_PAID_ALLOWED_REGIONS", prior);
  }
});

Deno.test("ORCH-0953 §3.8 — allowlist admits US/GB and blocks FR", () => {
  const prior = Deno.env.get("NATIVE_PAID_ALLOWED_REGIONS");
  try {
    Deno.env.set("NATIVE_PAID_ALLOWED_REGIONS", "US,GB");
    assertEquals(isNativePaidAllowedForBrand("US"), true);
    assertEquals(isNativePaidAllowedForBrand("GB"), true);
    assertEquals(isNativePaidAllowedForBrand("FR"), false);
  } finally {
    if (prior === undefined) Deno.env.delete("NATIVE_PAID_ALLOWED_REGIONS");
    else Deno.env.set("NATIVE_PAID_ALLOWED_REGIONS", prior);
  }
});

Deno.test("ORCH-0953 §3.8 — ticket-checkout-create gates native surface before PaymentIntent creation", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assertStringIncludes(source, 'surface === "native"');
  assertStringIncludes(source, "isNativePaidAllowedForBrand");
  assertStringIncludes(source, 'error: "native_paid_not_allowed_in_region"');
  assert(
    source.indexOf('error: "native_paid_not_allowed_in_region"') <
      source.indexOf("paymentIntents.create"),
    "native region gate must run before PaymentIntent creation",
  );
});
