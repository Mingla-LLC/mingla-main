/**
 * issue #4522 (D-9) — the cancel preview and the Paystack minimum check compute
 * the refund for the same actor begin uses, so a host's preview includes a
 * non-refundable v2 deposit exactly as the cancel will (otherwise the SC-22
 * freshness check would refuse every host cancel of such a booking).
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("preview and the Paystack floor use the per-actor computation", () => {
  assertEquals(
    source.split('"issue_4522_compute_refund_for_cancel_as"').length - 1,
    2,
  );
  assertEquals(
    source.includes('supabase.rpc(\n      "biz_compute_refund_for_cancel"'),
    false,
  );
  assertStringIncludes(source, 'p_actor_kind: actorKind ?? "buyer",');
});
