// MINGLA-INVARIANT: I-4624-8 | issue #4624 | brand-discount-upsert passes endsAfterCount through for codes and refuses 0, negatives and decimals as limit_invalid (422) before SQL.
// #4624 — a discount code can stop after N tickets (endsAfterCount, the
// editor's "Total tickets"). The writer forwards it for codes and refuses a
// value that is not a whole number of 1 or more with a stable detail.
// FAILS ON REVERT: drop the endsAfterCountInvalid pre-check and the 0 / -1 /
// 2.5 cases reach the rpc (calls is not empty, status is not 422).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createDiscountUpsertHandler,
  discountWriteDetail,
  endsAfterCountInvalid,
} from "../index.ts";
import { DISCOUNT_WRITE_REFUSAL_COPY } from "../../../../packages/offering-rendering/discountWriteRefusalCopy.ts";

const codePayload = (endsAfterCount: unknown): Record<string, unknown> => ({
  brandId: "brand-1",
  kind: "code",
  code: "TOPZY",
  name: "Talent code",
  valueType: "percent",
  valueBps: 10000,
  scopeKind: "brand",
  targets: [],
  endsAfterCount,
});

function harness() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const handler = createDiscountUpsertHandler({
    actorId: () => Promise.resolve("actor-1"),
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data: { id: "d-1" }, error: null });
    },
  });
  const post = (payload: Record<string, unknown>) =>
    handler(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", payload }),
      }),
    );
  return { calls, post };
}

Deno.test("#4624 a code with endsAfterCount 5 reaches the SQL writer unchanged", async () => {
  const { calls, post } = harness();
  const response = await post(codePayload(5));
  assertEquals(response.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "issue_3872_upsert_discount");
  assertEquals(
    (calls[0].args.p_payload as Record<string, unknown>).endsAfterCount,
    5,
  );
  assertEquals(
    (calls[0].args.p_payload as Record<string, unknown>).kind,
    "code",
  );
});

Deno.test("#4624 no ticket limit (absent, null, empty) is accepted", async () => {
  for (const value of [undefined, null, ""]) {
    const { calls, post } = harness();
    const payload = codePayload(value);
    if (value === undefined) delete payload.endsAfterCount;
    const response = await post(payload);
    assertEquals(response.status, 200, `value ${String(value)}`);
    assertEquals(calls.length, 1);
  }
});

Deno.test("#4624 0, negatives and decimals are refused as limit_invalid before SQL", async () => {
  for (const value of [0, -1, 2.5, "0", "-3", "2.5", "five", true]) {
    const { calls, post } = harness();
    const response = await post(codePayload(value));
    assertEquals(response.status, 422, `value ${String(value)}`);
    assertEquals(await response.json(), {
      error: "discount_write_failed",
      detail: "limit_invalid",
    });
    assertEquals(calls.length, 0, `value ${String(value)} reached SQL`);
  }
});

Deno.test("#4624 endsAfterCountInvalid accepts whole numbers 1 and up", () => {
  assertEquals(endsAfterCountInvalid({ endsAfterCount: 1 }), false);
  assertEquals(endsAfterCountInvalid({ endsAfterCount: "12" }), false);
  assertEquals(endsAfterCountInvalid({ endsAfterCount: 2147483648 }), true);
  assertEquals(endsAfterCountInvalid({}), false);
});

Deno.test("#4624 the SQL column check maps to limit_invalid, never a bare 500", () => {
  assertEquals(
    discountWriteDetail(
      {
        message:
          'new row for relation "brand_discounts" violates check constraint "brand_discounts_ends_after_count_check"',
        code: "23514",
      },
      codePayload(0),
    ),
    "limit_invalid",
  );
});

Deno.test("#4624 Ari has a sentence for limit_invalid", () => {
  assertEquals(
    DISCOUNT_WRITE_REFUSAL_COPY.limit_invalid,
    "A ticket limit has to be a whole number, 1 or more. Tell me how many tickets and ask me again. Nothing was saved.",
  );
});
