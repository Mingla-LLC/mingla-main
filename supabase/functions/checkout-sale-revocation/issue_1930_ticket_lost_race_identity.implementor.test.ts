import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  neutralizeTicketStripeAttempt,
  type TicketStripeAttempt,
  type TicketStripeNeutralizer,
} from "./ticketProviderNeutralization.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20270403001930_issue_1930_checkout_current_truth.sql",
    import.meta.url,
  ),
);

type RecordedCall = {
  checkoutSessionId?: string;
  paymentIntentId?: string;
  stripeAccountId: string;
  operationKey: string;
};

function delayedNeutralizer() {
  const calls: RecordedCall[] = [];
  const releases: Array<() => void> = [];
  const wait = (input: RecordedCall) => {
    calls.push(input);
    return new Promise<void>((resolve) => releases.push(resolve));
  };
  const neutralizer: TicketStripeNeutralizer = {
    expireCheckout: (input) => wait(input),
    cancelPaymentIntent: (input) => wait(input),
  };
  return { calls, releases, neutralizer };
}

async function waitForCalls(
  calls: RecordedCall[],
  expected: number,
): Promise<void> {
  for (let count = 0; count < 20 && calls.length < expected; count += 1) {
    await Promise.resolve();
  }
  assertEquals(calls.length, expected);
}

Deno.test("#1930 implementor: closure-won ticket commit adopts exact returned identity before enqueue", () => {
  const commit = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.issue_1930_commit_ticket_provider_attempt",
    ),
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.issue_1930_mark_ticket_provider_unknown",
    ),
  );
  const lostRace = commit.slice(
    commit.indexOf("IF v_attempt.claimed_epoch"),
    commit.indexOf("RETURN jsonb_build_object('outcome','revoked');"),
  );
  for (
    const identity of [
      "provider_object_id=COALESCE(provider_object_id,p_provider_object_id)",
      "provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id)",
      "provider_reference=COALESCE(provider_reference,p_provider_reference)",
      "continuation_fingerprint=COALESCE(continuation_fingerprint,p_continuation_fingerprint)",
    ]
  ) {
    assertStringIncludes(lostRace, identity);
  }
  assert(
    lostRace.indexOf("provider_object_id=COALESCE") <
      lostRace.indexOf("checkout_sale_revocation_outbox"),
    "returned provider truth must commit before durable cleanup is enqueued",
  );
});

for (
  const scenario of [
    {
      name: "hosted Checkout Session",
      attempt: {
        flow: "stripe_checkout",
        provider_object_id: null,
        provider_checkout_id: "cs_exact_returned",
        provider_idempotency_key: "ticket_checkout:session:stripe_checkout",
      } satisfies TicketStripeAttempt,
      expected: {
        checkoutSessionId: "cs_exact_returned",
        stripeAccountId: "acct_exact",
        operationKey: "ticket_checkout:session:stripe_checkout:expire",
      },
    },
    {
      name: "native PaymentIntent",
      attempt: {
        flow: "stripe_native",
        provider_object_id: "pi_exact_returned",
        provider_checkout_id: null,
        provider_idempotency_key: "ticket_checkout:session:stripe_native",
      } satisfies TicketStripeAttempt,
      expected: {
        paymentIntentId: "pi_exact_returned",
        stripeAccountId: "acct_exact",
        operationKey: "ticket_checkout:session:stripe_native:cancel",
      },
    },
  ] as const
) {
  Deno.test(`#1930 implementor: delayed ${scenario.name} cleanup re-drives exact identity and operation key`, async () => {
    const immediateCalls: RecordedCall[] = [];
    const immediateFailure: TicketStripeNeutralizer = {
      expireCheckout: (input) => {
        immediateCalls.push(input);
        throw new Error("immediate_cleanup_failed");
      },
      cancelPaymentIntent: (input) => {
        immediateCalls.push(input);
        throw new Error("immediate_cleanup_failed");
      },
    };
    await assertRejects(
      () =>
        neutralizeTicketStripeAttempt(
          scenario.attempt,
          "acct_exact",
          immediateFailure,
        ),
      Error,
      "immediate_cleanup_failed",
    );
    assertEquals(immediateCalls, [scenario.expected]);

    const delayed = delayedNeutralizer();
    const first = neutralizeTicketStripeAttempt(
      scenario.attempt,
      "acct_exact",
      delayed.neutralizer,
    );
    await waitForCalls(delayed.calls, 1);
    assertEquals(delayed.calls[0], scenario.expected);
    delayed.releases.shift()?.();
    await first;

    const duplicate = neutralizeTicketStripeAttempt(
      scenario.attempt,
      "acct_exact",
      delayed.neutralizer,
    );
    await waitForCalls(delayed.calls, 2);
    assertEquals(delayed.calls[1], scenario.expected);
    delayed.releases.shift()?.();
    await duplicate;
  });
}

Deno.test("#1930 implementor: flow-inappropriate or missing Stripe identity stays retryable", async () => {
  const delayed = delayedNeutralizer();
  await assertRejects(
    () =>
      neutralizeTicketStripeAttempt(
        {
          flow: "stripe_checkout",
          provider_object_id: "pi_wrong_flow",
          provider_checkout_id: null,
          provider_idempotency_key: "ticket_checkout:session:stripe_checkout",
        },
        "acct_exact",
        delayed.neutralizer,
      ),
    Error,
    "provider_identity_missing",
  );
  assertEquals(delayed.calls, []);
});
