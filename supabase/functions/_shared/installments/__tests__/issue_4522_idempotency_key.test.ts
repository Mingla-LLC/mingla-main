/**
 * issue #4522 — I-4522-5: a changed instalment amount never reuses a Stripe
 * idempotency key. Version 0 keeps today's key byte for byte (SC-9).
 */
// MINGLA-INVARIANT: I-4522-5 | issue #4522 | A rebalanced instalment row's Stripe idempotency key carries its schedule version, so a changed amount never reuses a key; version 0 keeps the legacy key.
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  flexPaymentIdempotencyKey,
  installmentIdempotencyKey,
  installmentKeyVersionSuffix,
} from "../installmentIdempotencyKey.ts";

const source = await Deno.readTextFile(
  new URL("../createInstallmentPI.ts", import.meta.url),
);

Deno.test("version 0 keeps the legacy key; a rebalanced row adds :v<n>", () => {
  assertEquals(
    installmentIdempotencyKey({ orderId: "o1", ordinal: 2, retryCount: 1 }),
    "installment:o1:2:1",
  );
  assertEquals(
    installmentIdempotencyKey({
      orderId: "o1",
      ordinal: 2,
      retryCount: 1,
      scheduleVersion: 0,
    }),
    "installment:o1:2:1",
  );
  assertEquals(
    installmentIdempotencyKey({
      orderId: "o1",
      ordinal: 2,
      retryCount: 0,
      scheduleVersion: 1,
    }),
    "installment:o1:2:0:v1",
  );
  assertEquals(installmentKeyVersionSuffix(null), "");
  assertEquals(installmentKeyVersionSuffix(3), ":v3");
  assertEquals(
    flexPaymentIdempotencyKey("o1", "client-key-1"),
    "flex:o1:client-key-1",
  );
});

Deno.test("createInstallmentPI builds its key with the version suffix and reads the version", () => {
  assertMatch(
    source,
    /`installment:\$\{installment\.order_id\}:\$\{installment\.ordinal\}:\$\{installment\.retry_count\}` \+\n\s+installmentKeyVersionSuffix\(installment\.schedule_version\);/,
  );
  assertMatch(
    source,
    /retry_count, stripe_payment_intent_id, schedule_version"/,
  );
});
