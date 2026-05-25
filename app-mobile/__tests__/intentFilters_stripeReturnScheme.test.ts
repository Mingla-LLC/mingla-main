import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0953 §3.6 — consumer Android declares Stripe return URL scheme", async () => {
  const appJson = JSON.parse(
    await Deno.readTextFile(new URL("../app.json", import.meta.url)),
  );
  const filters = appJson.expo.android.intentFilters as Array<{
    data?: Array<{ scheme?: string }>;
  }>;
  assertEquals(
    filters.some((filter) =>
      filter.data?.some((entry) => entry.scheme === "com.mingla.app.v2")
    ),
    true,
  );
  assert(
    filters.length >= 2,
    "custom scheme must be added alongside HTTPS app links",
  );
});
