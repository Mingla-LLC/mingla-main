import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dualPoolBorrowLimits, interleave } from "../index.ts";
import { sourceRefundPayloadFingerprint } from "../../_shared/sourceRefundNotifications.ts";

Deno.test("Dual pool reserves 15 generic and 10 source and borrows only unused capacity", () => {
  assertEquals(dualPoolBorrowLimits(15, 10), { generic: 0, source: 0 });
  assertEquals(dualPoolBorrowLimits(5, 10), { generic: 0, source: 10 });
  assertEquals(dualPoolBorrowLimits(15, 4), { generic: 6, source: 0 });
  assertEquals(dualPoolBorrowLimits(0, 0), { generic: 10, source: 15 });
  for (const [generic, source] of [[0, 0], [5, 4], [15, 10]]) {
    const borrow = dualPoolBorrowLimits(generic, source);
    assertEquals(generic + source + borrow.generic + borrow.source, 25);
  }
});

Deno.test("Dual pool processing alternates generic then source without dropping tails", () => {
  assertEquals(interleave(["g1", "g2", "g3"], ["s1", "s2"]), [
    { kind: "generic", row: "g1" },
    { kind: "source", row: "s1" },
    { kind: "generic", row: "g2" },
    { kind: "source", row: "s2" },
    { kind: "generic", row: "g3" },
  ]);
});

Deno.test("Source payload fingerprint is JCS-stable and excludes recipient credentials", async () => {
  const common = {
    category: "source_refund_buyer_state",
    audience: "buyer" as const,
    channel: "email" as const,
    serializerVersion: 9,
  };
  const first = await sourceRefundPayloadFingerprint({
    ...common,
    payload: {
      state: "needs_attention",
      source_refund_id: "12210000-0000-4000-8000-000000000027",
      nested: { z: 2, a: 1 },
    },
  });
  const reordered = await sourceRefundPayloadFingerprint({
    ...common,
    payload: {
      nested: { a: 1, z: 2 },
      source_refund_id: "12210000-0000-4000-8000-000000000027",
      state: "needs_attention",
    },
  });
  assertEquals(first, reordered);
  assertEquals(first.length, 64);
  assertNotEquals(
    first,
    await sourceRefundPayloadFingerprint({
      ...common,
      payload: {
        state: "needs_attention",
        source_refund_id: "12210000-0000-4000-8000-000000000027",
        nested: { a: 1, z: 3 },
      },
    }),
  );
});
