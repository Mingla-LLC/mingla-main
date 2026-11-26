// #4624 — the target guard refuses a ticket or item target on a "Specific
// offerings" (scope 'listings') discount with RAISE 'listings_target_invalid'.
// The writer returns that stable detail as a 409, never a bare 500.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDiscountUpsertHandler } from "../index.ts";
import { DISCOUNT_WRITE_REFUSAL_COPY } from "../../../../packages/offering-rendering/discountWriteRefusalCopy.ts";

Deno.test("#4624 listings_target_invalid maps to 409 with that detail", async () => {
  const calls: string[] = [];
  const handler = createDiscountUpsertHandler({
    actorId: () => Promise.resolve("actor-1"),
    rpc: (name) => {
      calls.push(name);
      return Promise.resolve({
        data: null,
        error: { message: "listings_target_invalid", code: "P0001" },
      });
    },
  });
  const response = await handler(
    new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create",
        payload: {
          brandId: "brand-1",
          kind: "code",
          scopeKind: "listings",
          targets: [{ targetKind: "ticket_type", targetId: "tt-1" }],
        },
      }),
    }),
  );
  assertEquals(calls, ["issue_3872_upsert_discount"]);
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: "discount_write_failed",
    detail: "listings_target_invalid",
  });
});

Deno.test("#4624 Ari has a sentence for listings_target_invalid", () => {
  assertEquals(
    DISCOUNT_WRITE_REFUSAL_COPY.listings_target_invalid,
    "Pick whole events, experiences or trips for this discount and ask me again. Nothing was saved.",
  );
});
