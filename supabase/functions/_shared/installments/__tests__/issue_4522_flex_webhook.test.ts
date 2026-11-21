/**
 * issue #4522 — webhook side of flexible payments. A collected flexible row
 * settles (re-spreads the balance) through issue_4522_settle_flex_payment; a
 * planned row is untouched. A failed flexible row is recorded and closed
 * through issue_4522_close_failed_flex, with no dunning and no at-risk flag.
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  closeFailedFlexPayment,
  settleFlexPaymentIfFlex,
} from "../../installmentWebhookHandlers.ts";
import { fakeSupabase } from "./issue_3645_fake_supabase.ts";

const ID = "45220000-0000-4000-8000-00000000f1e1";

Deno.test("a planned row never calls the flexible settle", async () => {
  const fake = fakeSupabase({});
  // deno-lint-ignore no-explicit-any
  await settleFlexPaymentIfFlex(fake.client as any, ID, "scheduled");
  assertEquals(fake.rpcCalls.length, 0);
});

Deno.test("a collected flexible row settles once through the RPC", async () => {
  const fake = fakeSupabase({
    rpc: () => ({
      data: { ok: true, remainingMinor: 0, paidInFull: true },
      error: null,
    }),
  });
  // deno-lint-ignore no-explicit-any
  await settleFlexPaymentIfFlex(fake.client as any, ID, "flex");
  assertEquals(fake.rpcCalls, [{
    name: "issue_4522_settle_flex_payment",
    args: { p_installment_id: ID },
  }]);
});

Deno.test("a refused settle throws so the webhook inbox retries", async () => {
  const fake = fakeSupabase({
    rpc: () => ({ data: { ok: false, reason: "not_collected" }, error: null }),
  });
  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => settleFlexPaymentIfFlex(fake.client as any, ID, "flex"),
    Error,
    "not_collected",
  );
});

Deno.test("a failed flexible row is recorded then closed", async () => {
  const fake = fakeSupabase({
    rpc: () => ({ data: { ok: true, closed: true }, error: null }),
    table: () => ({ data: null, error: null }),
  });
  // deno-lint-ignore no-explicit-any
  await closeFailedFlexPayment(
    fake.client as any,
    ID,
    "pi_1",
    "card_declined:",
  );
  assertEquals(fake.tableOps.length, 1);
  assertEquals(fake.tableOps[0].kind, "update");
  assertEquals(fake.tableOps[0].values?.status, "failed");
  assertEquals(
    fake.tableOps[0].filters.some(([k, c, v]) =>
      k === "eq" && c === "kind" && v === "flex"
    ),
    true,
  );
  assertEquals(fake.rpcCalls.map((c) => c.name), [
    "issue_4522_close_failed_flex",
  ]);
});
