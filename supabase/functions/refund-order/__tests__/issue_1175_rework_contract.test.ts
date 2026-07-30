import {
  createPaystackRefund,
  PAYSTACK_MIN_REFUND_SUBUNITS,
  paystackRefundOutcomeStatus,
} from "../../_shared/paystackRefunds.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

function verifiedTransaction(
  reference: string,
  id: number,
  amount: number,
): Response {
  return response({
    status: true,
    data: { id, reference, status: "success", currency: "NGN", amount },
  });
}

Deno.test("issue #1175 rework: processed provider results stay processed for debt materialization", () => {
  assert(
    paystackRefundOutcomeStatus("processed") === "processed",
    "processed refund was downgraded",
  );
  assert(
    paystackRefundOutcomeStatus("pending") === "accepted",
    "pending provider refund must persist as accepted, not processed",
  );
  assert(
    paystackRefundOutcomeStatus("failed") === "failed",
    "definitive provider failure was not preserved",
  );
});

Deno.test("issue #1175 rework: explicit partial refunds enforce NGN 50 before any provider request", async () => {
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1175fixture");
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(response({ status: true, data: [] }));
  }) as typeof fetch;
  try {
    let rejected = false;
    try {
      await createPaystackRefund({
        transaction: "txn-below-floor",
        merchantNote: "mingla_refund:44444444-4444-4444-8444-444444444444",
        amountSubunits: PAYSTACK_MIN_REFUND_SUBUNITS - 1,
      });
    } catch (error) {
      rejected = error instanceof Error &&
        error.message.includes("at least NGN 50");
    }
    assert(rejected, "NGN 49.99 partial refund was not rejected truthfully");
    assert(calls === 0, "below-floor partial refund reached Paystack");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("issue #1175 rework: exact-floor partial and sub-floor full refund keep distinct request shapes", async () => {
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1175fixture");
  const postBodies: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/transaction/verify/txn-exact-floor")) {
      return Promise.resolve(
        verifiedTransaction(
          "txn-exact-floor",
          117550,
          PAYSTACK_MIN_REFUND_SUBUNITS,
        ),
      );
    }
    if (url.includes("/transaction/verify/txn-full-below-floor")) {
      return Promise.resolve(
        verifiedTransaction("txn-full-below-floor", 117551, 4999),
      );
    }
    if ((init?.method ?? "GET") === "GET") {
      assert(
        url.includes("/refund?transaction=117550&perPage=100") ||
          url.includes("/refund?transaction=117551&perPage=100"),
        "reconciliation did not use the verified numeric transaction ID",
      );
      return Promise.resolve(response({ status: true, data: [] }));
    }
    postBodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(response({
      status: true,
      data: { id: postBodies.length, status: "pending" },
    }));
  }) as typeof fetch;
  try {
    await createPaystackRefund({
      transaction: "txn-exact-floor",
      merchantNote: "mingla_refund:55555555-5555-4555-8555-555555555555",
      amountSubunits: PAYSTACK_MIN_REFUND_SUBUNITS,
    });
    await createPaystackRefund({
      transaction: "txn-full-below-floor",
      merchantNote: "mingla_refund:66666666-6666-4666-8666-666666666666",
    });
    assert(
      postBodies[0].amount === PAYSTACK_MIN_REFUND_SUBUNITS,
      "exact NGN 50 partial did not send its amount",
    );
    assert(
      !("amount" in postBodies[1]),
      "true full refund must omit amount even when its local total is below NGN 50",
    );
    assert(
      calls.length === 6,
      "each initiated refund must verify, reconcile, then POST exactly once",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("issue #1175 rework: trip retries preserve durable identity after cancellation", async () => {
  const functionsRoot = new URL("../../", import.meta.url);
  const trip = await Deno.readTextFile(
    new URL("cancel-trip-booking/index.ts", functionsRoot),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270110000006_issue_1175_paystack_refunds.sql",
      import.meta.url,
    ),
  );

  assert(
    trip.includes(
      "entry.refund_cents === entry.paid_cents\n          ? undefined",
    ),
    "full trip refund no longer omits amount",
  );
  assert(
    trip.includes("isRetryablePaystackRefundError(err)") &&
      trip.includes("if (!paystackFailureRetryable)"),
    "trip uncertainty is still rolled back terminally",
  );
  assert(
    migration.includes("'paystack_retry',true") &&
      migration.includes("a.status IN ('pending','accepted','processed')"),
    "trip cancellation has no durable retry branch",
  );
});
