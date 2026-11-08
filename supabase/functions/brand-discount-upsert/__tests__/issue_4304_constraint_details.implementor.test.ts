// #4304 — a CHECK constraint the discount writer hits is a known Host mistake
// with a stable detail, never a bare 500. The messages below are the exact
// PostgreSQL 17 errors issue_3872_upsert_discount raised locally for each case
// (production WYTHE20 = bdt_shape).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDiscountUpsertHandler } from "../index.ts";

const check = (name: string, relation = "brand_discounts") =>
  `new row for relation "${relation}" violates check constraint "${name}"`;

async function answer(
  error: { message: string; code?: string },
  payload: Record<string, unknown> = { kind: "code", valueType: "percent" },
) {
  const handler = createDiscountUpsertHandler({
    actorId: () => Promise.resolve("actor-1"),
    rpc: () => Promise.resolve({ data: null, error }),
  });
  const response = await handler(
    new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", payload }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

Deno.test("#4304 the production WYTHE20 failure is a target-shape refusal, not 500", async () => {
  assertEquals(
    await answer({
      message: check("bdt_shape", "brand_discount_targets"),
      code: "23514",
    }),
    {
      status: 422,
      body: { error: "discount_write_failed", detail: "target_shape_invalid" },
    },
  );
});

Deno.test("#4304 every discount CHECK maps to a stable detail", async () => {
  const cases: Array<[string, string, number]> = [
    ["bd_code_shape", "code_shape_invalid", 422],
    ["bd_value_shape", "value_shape_invalid", 422],
    ["brand_discounts_name_check", "name_invalid", 422],
    ["bd_window", "window_invalid", 409],
    ["bd_set_price_items", "scope_target_mismatch", 409],
    ["bd_sale_price_items", "scope_target_mismatch", 409],
    ["bd_schedule_shape", "schedule_invalid", 422],
  ];
  for (const [constraint, detail, status] of cases) {
    assertEquals(
      await answer({ message: check(constraint), code: "23514" }),
      { status, body: { error: "discount_write_failed", detail } },
      constraint,
    );
  }
});

Deno.test("#4304 a well-formed amount refused by bd_value_shape means no brand currency", async () => {
  assertEquals(
    await answer(
      { message: check("bd_value_shape"), code: "23514" },
      { kind: "code", valueType: "amount", valueMinor: 500 },
    ),
    {
      status: 422,
      body: { error: "discount_write_failed", detail: "currency_missing" },
    },
  );
});

Deno.test("#4304 RAISE codes, bad input and the unknown keep honest statuses", async () => {
  assertEquals(await answer({ message: "code_taken" }), {
    status: 409,
    body: { error: "discount_write_failed", detail: "code_taken" },
  });
  assertEquals(await answer({ message: "target_not_discountable" }), {
    status: 409,
    body: { error: "discount_write_failed", detail: "target_not_discountable" },
  });
  assertEquals(await answer({ message: "brand_required" }), {
    status: 400,
    body: { error: "invalid_request", detail: "invalid_request" },
  });
  assertEquals(
    await answer({
      message: 'invalid input syntax for type uuid: "nope"',
      code: "22P02",
    }),
    {
      status: 422,
      body: { error: "discount_write_failed", detail: "invalid_input" },
    },
  );
  assertEquals(
    await answer({ message: check("some_future_check"), code: "23514" }),
    { status: 500, body: { error: "internal", detail: "internal" } },
  );
});
