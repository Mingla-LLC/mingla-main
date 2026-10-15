import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  checkoutClientAttemptFingerprint,
  createCheckoutAttemptTracker,
} from "../ticketCheckoutContract.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const STANDARD = "22222222-2222-4222-8222-222222222222";
const VIP = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const base = {
  eventId: EVENT,
  purchaseTermsAccepted: true,
  buyer: {
    name: "Buyer",
    email: "Buyer@Example.test",
    phone: "+15555550123",
    marketingOptIn: false,
  },
  providerInput: { surface: "web" as const },
  lines: [
    { ticketTypeId: VIP, quantity: 2, paymentPlanChoice: "full" as const },
    {
      ticketTypeId: STANDARD,
      quantity: 1,
      paymentPlanChoice: "installments" as const,
    },
  ],
  eventDateId: null,
  eventDateIds: [] as string[],
  intakeFormData: [],
};

Deno.test("#3859 client fingerprint preserves mixed per-line choices and ignores line order", () => {
  assertEquals(
    checkoutClientAttemptFingerprint({
      ...base,
      lines: [...base.lines].reverse(),
    }),
    checkoutClientAttemptFingerprint(base),
  );
  assertEquals(
    checkoutClientAttemptFingerprint(base).includes("paymentPlanChoice"),
    true,
  );
});

Deno.test("#3859 one logical retry retains its UUID and a changed line choice rotates it", () => {
  const ids = [ATTEMPT_A, ATTEMPT_B];
  const tracker = createCheckoutAttemptTracker(() => ids.shift()!);
  assertEquals(tracker.idFor(base), ATTEMPT_A);
  assertEquals(
    tracker.idFor({ ...base, lines: [...base.lines].reverse() }),
    ATTEMPT_A,
  );
  assertEquals(
    tracker.idFor({
      ...base,
      lines: base.lines.map((line) => ({
        ...line,
        paymentPlanChoice: "full" as const,
      })),
    }),
    ATTEMPT_B,
  );
});

Deno.test("#3859 changing purchase-terms acceptance rotates the logical attempt", () => {
  const ids = [ATTEMPT_A, ATTEMPT_B];
  const tracker = createCheckoutAttemptTracker(() => ids.shift()!);
  assertEquals(tracker.idFor(base), ATTEMPT_A);
  assertEquals(
    tracker.idFor({ ...base, purchaseTermsAccepted: false }),
    ATTEMPT_B,
  );
});

Deno.test("#3859 semantically identical intake order retains its UUID and reset rotates it", () => {
  const ids = [ATTEMPT_A, ATTEMPT_B];
  const tracker = createCheckoutAttemptTracker(() => ids.shift()!);
  const intakeFormData = [
    {
      ticket_type_id: STANDARD,
      schema_version_id: "44444444-4444-4444-8444-444444444444",
      answers: { second: "B", first: "A" },
    },
    {
      ticket_type_id: VIP,
      schema_version_id: "55555555-5555-4555-8555-555555555555",
      answers: { choice: true },
    },
  ];
  assertEquals(tracker.idFor({ ...base, intakeFormData }), ATTEMPT_A);
  assertEquals(
    tracker.idFor({
      ...base,
      intakeFormData: [...intakeFormData].reverse(),
    }),
    ATTEMPT_A,
  );
  tracker.reset();
  assertEquals(tracker.idFor({ ...base, intakeFormData }), ATTEMPT_B);
});

Deno.test("#3859 malformed or missing per-line choices fail closed before UUID minting", () => {
  let minted = 0;
  const tracker = createCheckoutAttemptTracker(() => {
    minted += 1;
    return ATTEMPT_A;
  });
  assertThrows(() =>
    tracker.idFor({
      ...base,
      lines: [{ ticketTypeId: STANDARD, quantity: 1 }] as never,
    })
  );
  assertEquals(minted, 0);
});
