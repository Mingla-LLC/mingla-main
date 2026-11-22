/**
 * issue #4522 (D-9) — the cancel preview and the Paystack minimum check compute
 * the refund for the same actor begin uses, so a host's preview includes a
 * non-refundable v2 deposit exactly as the cancel will (otherwise the SC-22
 * freshness check would refuse every host cancel of such a booking).
 *
 * Rework F6: before the #4522 migrations are applied the per-actor function
 * does not exist, so both calls fall back to biz_compute_refund_for_cancel
 * exactly as it was called before #4522.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { computeRefundForActor } from "../refundEntries.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function recorder() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
}

Deno.test("preview and the Paystack floor go through the per-actor computation", () => {
  assertEquals(source.split("computeRefundForActor(").length - 1, 2);
  assertEquals(source.includes('supabase.rpc(\n      "biz_compute_refund_for_cancel"'), false);
  assertStringIncludes(source, 'actorKind: actorKind ?? "buyer",');
});

Deno.test("with the #4522 schema: the per-actor function", async () => {
  const { calls, client } = recorder();
  await computeRefundForActor(client, true, { orderId: "o1", cancelAt: "t", actorKind: "operator" });
  assertEquals(calls, [{
    fn: "issue_4522_compute_refund_for_cancel_as",
    args: { p_order_id: "o1", p_cancel_at: "t", p_actor_kind: "operator" },
  }]);
});

Deno.test("before the #4522 migrations: exactly the pre-#4522 call", async () => {
  const { calls, client } = recorder();
  await computeRefundForActor(client, false, { orderId: "o1", cancelAt: "t", actorKind: "buyer" });
  assertEquals(calls, [{
    fn: "biz_compute_refund_for_cancel",
    args: { p_order_id: "o1", p_cancel_at: "t" },
  }]);
});
