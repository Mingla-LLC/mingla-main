// #4430 P-3 — a second PARTIAL Paystack refund on a payment that already had
// a partial refund. After any partial refund Paystack reports the transaction
// as `reversed` / `reversal-pending`; the shared adapter used to refuse every
// later refund there (paystack_refund_transaction_state_ambiguous), so the
// TEST contract d0976ab9's ₦57.50 counter refund failed every retry after its
// ₦60 dispute refund.
//
// Allowed only when the refund list was read, nothing matches this claim, and
// every non-failed refund plus this one fits in the transaction amount. A
// full refund, an unreadable list and an over-refund stay ambiguous; the
// `success` path is unchanged (issue_1430 / issue_2079 suites).
//
// FAILS-ON-REVERT: restoring `identity.state !== "success"` as the only check
// fails the first test; dropping the sum or the list guard fails the others.
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPaystackRefund } from "../paystackRefunds.ts";

const REFERENCE = "ghold_d0976ab9_v1";
const TRANSACTION_ID = 4430001;
const NOTE = "gig_refund:d0976ab9:counter_lower:base:hold-1:5750";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type World = {
  state?: string;
  amount?: number;
  refunds?: Array<Record<string, unknown>>;
  listFails?: boolean;
  postAnswer?: () => Response;
};

async function withPaystack(
  world: World,
  run: (seen: { posts: Array<Record<string, unknown>> }) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const mode = Deno.env.get("PAYSTACK_MODE");
  const key = Deno.env.get("PAYSTACK_SECRET_KEY_TEST");
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue4430");
  const seen = { posts: [] as Array<Record<string, unknown>> };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes(`/transaction/verify/${REFERENCE}`)) {
      return Promise.resolve(json({
        status: true,
        data: {
          id: TRANSACTION_ID,
          reference: REFERENCE,
          status: world.state ?? "reversed",
          currency: "NGN",
          amount: world.amount ?? 23000,
        },
      }));
    }
    if (method === "GET" && url.includes("/refund?")) {
      if (world.listFails) {
        return Promise.resolve(json({ status: false, message: "boom" }, 500));
      }
      return Promise.resolve(json({ status: true, data: world.refunds ?? [] }));
    }
    if (method === "POST" && url.endsWith("/refund")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      seen.posts.push(body);
      if (world.postAnswer) return Promise.resolve(world.postAnswer());
      return Promise.resolve(json({
        status: true,
        data: {
          id: 19159300,
          amount: body.amount,
          status: "pending",
          currency: "NGN",
          transaction: TRANSACTION_ID,
          merchant_note: body.merchant_note,
        },
      }));
    }
    return Promise.resolve(json({ status: false }, 404));
  }) as typeof fetch;
  try {
    await run(seen);
  } finally {
    globalThis.fetch = originalFetch;
    if (mode === undefined) Deno.env.delete("PAYSTACK_MODE");
    else Deno.env.set("PAYSTACK_MODE", mode);
    if (key === undefined) Deno.env.delete("PAYSTACK_SECRET_KEY_TEST");
    else Deno.env.set("PAYSTACK_SECRET_KEY_TEST", key);
  }
}

// The production shape: 23000 held, a 6000 dispute refund already processed.
const FIRST_REFUND = {
  id: 19159279,
  amount: 6000,
  status: "processed",
  merchant_note: "gig_refund:d0976ab9:resolved_partial:base:hold-1:6000",
  transaction: TRANSACTION_ID,
  currency: "NGN",
};

for (const state of ["reversed", "reversal-pending"]) {
  Deno.test(`#4430 P-3: a second partial refund on a ${state} transaction goes through once`, async () => {
    await withPaystack({ state, refunds: [FIRST_REFUND] }, async (seen) => {
      const result = await createPaystackRefund({
        transaction: REFERENCE,
        merchantNote: NOTE,
        amountSubunits: 5750,
        currency: "NGN",
      });
      assertEquals(result.replayed, false);
      assertEquals(result.amount, 5750);
      assertEquals(seen.posts.length, 1);
      assertEquals(seen.posts[0].amount, 5750);
    });
  });
}

Deno.test("#4430 P-3: failed refunds do not count against the amount", async () => {
  const failed = {
    ...FIRST_REFUND,
    id: 19159280,
    amount: 17000,
    status: "failed",
  };
  await withPaystack({ refunds: [FIRST_REFUND, failed] }, async (seen) => {
    await createPaystackRefund({
      transaction: REFERENCE,
      merchantNote: NOTE,
      amountSubunits: 17000,
      currency: "NGN",
    });
    assertEquals(seen.posts.length, 1);
  });
});

Deno.test("#4430 P-3: an over-refund on a reversed transaction is refused with no POST", async () => {
  await withPaystack({ refunds: [FIRST_REFUND] }, async (seen) => {
    const error = await assertRejects(() =>
      createPaystackRefund({
        transaction: REFERENCE,
        merchantNote: NOTE,
        amountSubunits: 17001,
        currency: "NGN",
      })
    );
    assertEquals(
      (error as Error).message,
      "paystack_refund_transaction_state_ambiguous",
    );
    assertEquals(seen.posts.length, 0);
  });
});

Deno.test("#4430 P-3: a full refund on a reversed transaction stays refused", async () => {
  await withPaystack({ refunds: [FIRST_REFUND] }, async (seen) => {
    const error = await assertRejects(() =>
      createPaystackRefund({
        transaction: REFERENCE,
        merchantNote: NOTE,
        currency: "NGN",
      })
    );
    assertEquals(
      (error as Error).message,
      "paystack_refund_transaction_state_ambiguous",
    );
    assertEquals(seen.posts.length, 0);
  });
});

Deno.test("#4430 P-3: a duplicate replays the existing refund and creates none", async () => {
  const mine = {
    id: 19159301,
    amount: 5750,
    status: "pending",
    merchant_note: NOTE,
    transaction: TRANSACTION_ID,
    currency: "NGN",
  };
  await withPaystack({ refunds: [FIRST_REFUND, mine] }, async (seen) => {
    const result = await createPaystackRefund({
      transaction: REFERENCE,
      merchantNote: NOTE,
      amountSubunits: 5750,
      currency: "NGN",
    });
    assertEquals(result.replayed, true);
    assertEquals(result.id, "19159301");
    assertEquals(seen.posts.length, 0);
  });
});

Deno.test("#4430 P-3: an unreadable refund list is refused with no POST", async () => {
  await withPaystack({ listFails: true }, async (seen) => {
    const error = await assertRejects(() =>
      createPaystackRefund({
        transaction: REFERENCE,
        merchantNote: NOTE,
        amountSubunits: 5750,
        currency: "NGN",
      })
    );
    assertEquals(
      (error as Error).message,
      "paystack_refund_transaction_state_ambiguous",
    );
    assertEquals(seen.posts.length, 0);
  });
});

Deno.test("#4430 P-3: a duplicate signal on a reversed transaction follows the same rule", async () => {
  // Paystack says "already exists" but the list shows no matching refund:
  // a fitting partial is a duplicate we cannot pin (duplicate_ambiguous), an
  // over-refund stays state-ambiguous. Neither posts twice.
  const duplicate = () =>
    json({
      status: false,
      message: "A refund already exist for this transaction",
    }, 400);
  await withPaystack(
    { refunds: [FIRST_REFUND], postAnswer: duplicate },
    async (seen) => {
      const error = await assertRejects(() =>
        createPaystackRefund({
          transaction: REFERENCE,
          merchantNote: NOTE,
          amountSubunits: 5750,
          currency: "NGN",
        })
      );
      assertEquals(
        (error as Error).message,
        "paystack_refund_duplicate_ambiguous",
      );
      assertEquals(seen.posts.length, 1);
    },
  );
});

Deno.test("#4430 P-3: the success path is unchanged (an unreadable list still fails as before)", async () => {
  await withPaystack({ state: "success", listFails: true }, async (seen) => {
    const error = await assertRejects(() =>
      createPaystackRefund({
        transaction: REFERENCE,
        merchantNote: NOTE,
        amountSubunits: 5750,
        currency: "NGN",
      })
    );
    assertEquals(
      (error as Error).message,
      "Paystack refund reconciliation failed",
    );
    assertEquals(seen.posts.length, 0);
  });
});

Deno.test("#4430 P-3: a reversed transaction with no live refund on its list stays refused (#1430)", async () => {
  const failedOnly = { ...FIRST_REFUND, status: "failed" };
  for (const refunds of [[], [failedOnly]]) {
    await withPaystack({ refunds }, async (seen) => {
      const error = await assertRejects(() =>
        createPaystackRefund({
          transaction: REFERENCE,
          merchantNote: NOTE,
          amountSubunits: 5750,
          currency: "NGN",
        })
      );
      assertEquals(
        (error as Error).message,
        "paystack_refund_transaction_state_ambiguous",
      );
      assertEquals(seen.posts.length, 0);
    });
  }
});
