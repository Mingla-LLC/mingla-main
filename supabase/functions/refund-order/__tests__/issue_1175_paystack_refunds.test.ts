import {
  createPaystackRefund,
  isRetryablePaystackRefundError,
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

const originalFetch = globalThis.fetch;

Deno.test("issue #1175: partial Paystack refund reconciles before POST and sends exact kobo", async () => {
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1175fixture");
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: String(init?.body ?? "") });
    if (url.includes("/transaction/verify/txn-1175")) {
      return Promise.resolve(verifiedTransaction("txn-1175", 117501, 12500));
    }
    if (url.includes("/refund?transaction=117501&perPage=100")) {
      return Promise.resolve(response({ status: true, data: [] }));
    }
    return Promise.resolve(response({
      status: true,
      data: { id: 701, amount: 12500, status: "pending" },
    }));
  }) as typeof fetch;
  try {
    const result = await createPaystackRefund({
      transaction: "txn-1175",
      merchantNote: "mingla_refund:11111111-1111-4111-8111-111111111111",
      amountSubunits: 12500,
      currency: "NGN",
    });
    assert(result.id === "701", "provider refund id must be returned");
    assert(
      calls.length === 3,
      "verify and numeric reconcile GETs must precede exactly one POST",
    );
    assert(calls[0].method === "GET", "first request must reconcile");
    assert(
      calls[0].url.includes("/transaction/verify/txn-1175"),
      "first request must verify the original reference",
    );
    assert(
      calls[1].url.includes("transaction=117501"),
      "second request must reconcile by numeric transaction ID",
    );
    assert(calls[2].method === "POST", "third request must initiate");
    const body = JSON.parse(calls[2].body) as Record<string, unknown>;
    assert(body.transaction === "txn-1175", "transaction reference drifted");
    assert(body.amount === 12500, "partial refund kobo amount drifted");
    assert(body.currency === "NGN", "refund currency drifted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("issue #1175: retry returns the matching existing refund without a second POST", async () => {
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1175fixture");
  let calls = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    assert((init?.method ?? "GET") === "GET", "replay must never POST");
    const url = String(input);
    if (url.includes("/transaction/verify/txn-1175-replay")) {
      return Promise.resolve(
        verifiedTransaction("txn-1175-replay", 117502, 12500),
      );
    }
    assert(
      url.includes("/refund?transaction=117502&perPage=100"),
      "replay must reconcile by numeric transaction ID",
    );
    return Promise.resolve(response({
      status: true,
      data: [{
        id: 702,
        amount: 12500,
        status: "processed",
        merchant_note: "mingla_refund:22222222-2222-4222-8222-222222222222",
        transaction: 117502,
      }],
    }));
  }) as typeof fetch;
  try {
    const result = await createPaystackRefund({
      transaction: "txn-1175-replay",
      merchantNote: "mingla_refund:22222222-2222-4222-8222-222222222222",
      amountSubunits: 12500,
    });
    assert(result.replayed, "existing provider refund must be a replay");
    assert(
      result.id === "702",
      "existing provider refund id must be preserved",
    );
    assert(calls === 2, "replay should use two reads and zero writes");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("issue #1175: full transaction_reversed is accepted as an idempotent replay", async () => {
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1175fixture");
  let calls = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const url = String(input);
    if (url.includes("/transaction/verify/txn-already-reversed")) {
      return Promise.resolve(
        verifiedTransaction("txn-already-reversed", 117503, 25000),
      );
    }
    if ((init?.method ?? "GET") === "GET") {
      assert(
        url.includes("/refund?transaction=117503&perPage=100"),
        "full replay must reconcile by numeric transaction ID",
      );
      return Promise.resolve(response({ status: true, data: [] }));
    }
    return Promise.resolve(
      response({ status: false, message: "transaction_reversed" }, 400),
    );
  }) as typeof fetch;
  try {
    const result = await createPaystackRefund({
      transaction: "txn-already-reversed",
      merchantNote: "mingla_venue_refund:33333333-3333-4333-8333-333333333333",
    });
    assert(result.replayed, "transaction_reversed must be replay-success");
    assert(result.status === "processed", "replay status must be processed");
    assert(
      calls === 3,
      "full replay must verify, reconcile, then initiate once",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("issue #1175: Paystack 5xx remains retryable while a definitive 4xx fails", async () => {
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1175fixture");
  for (
    const [status, expectedRetryable] of [[500, true], [400, false]] as const
  ) {
    let calls = 0;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const url = String(input);
      if (url.includes(`/transaction/verify/txn-${status}`)) {
        return Promise.resolve(
          verifiedTransaction(`txn-${status}`, 117500 + status, 5000),
        );
      }
      if ((init?.method ?? "GET") === "GET") {
        assert(
          url.includes(
            `/refund?transaction=${117500 + status}&perPage=100`,
          ),
          `${status} must reconcile by numeric transaction ID`,
        );
        return Promise.resolve(response({ status: true, data: [] }));
      }
      return Promise.resolve(
        response({ status: false, message: `provider_${status}` }, status),
      );
    }) as typeof fetch;
    try {
      await createPaystackRefund({
        transaction: `txn-${status}`,
        merchantNote:
          `mingla_refund:${status}000000-0000-4000-8000-000000000000`,
        amountSubunits: 5000,
      });
      throw new Error(`expected ${status} to throw`);
    } catch (error) {
      assert(
        isRetryablePaystackRefundError(error) === expectedRetryable,
        `${status} retry classification drifted`,
      );
      assert(
        calls === 3,
        `${status} must verify and reconcile before initiate`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

Deno.test("issue #1175: order and trip handlers retain Paystack and Stripe direct-charge shapes", async () => {
  const root = new URL("../../", import.meta.url);
  const refundOrder = await Deno.readTextFile(
    new URL("refund-order/index.ts", root),
  );
  const adminRefund = await Deno.readTextFile(
    new URL("admin-refund-order/index.ts", root),
  );
  const tripRefund = await Deno.readTextFile(
    new URL("cancel-trip-booking/index.ts", root),
  );
  for (
    const [name, source] of [
      ["refund-order", refundOrder],
      ["admin-refund-order", adminRefund],
      ["cancel-trip-booking", tripRefund],
    ] as const
  ) {
    assert(
      source.includes("createPaystackRefund"),
      `${name} is missing the Paystack refund branch`,
    );
    assert(
      source.includes("record_paystack_refund_outcome"),
      `${name} does not persist replay/debt reconciliation`,
    );
  }
  assert(
    refundOrder.includes("stripeAccount: connectedAccountId") &&
      refundOrder.includes(
        "refund_application_fee: applicationFeeAmountCents > 0",
      ),
    "organiser Stripe direct-charge refund shape changed",
  );
  assert(
    adminRefund.includes("stripeAccount: connectedAccountId") &&
      adminRefund.includes(
        "refund_application_fee: applicationFeeAmountCents > 0",
      ),
    "admin Stripe direct-charge refund shape changed",
  );
  assert(
    tripRefund.includes("stripeAccount: connectedAccountId"),
    "trip Stripe account routing changed",
  );
  for (const source of [refundOrder, adminRefund, tripRefund]) {
    assert(
      !source.includes("reverse_transfer:"),
      "reverse_transfer re-entered",
    );
  }
});

Deno.test("issue #1175: webhook routes processed and failed refunds through one idempotent RPC", async () => {
  const root = new URL("../../", import.meta.url);
  const webhook = await Deno.readTextFile(
    new URL("paystack-webhook/index.ts", root),
  );
  const router = await Deno.readTextFile(
    new URL("_shared/paystackRefundRouter.ts", root),
  );
  assert(
    webhook.includes(
      'handlePaystackRefundEvent(supabase, "refund.processed", data)',
    ),
    "processed refund webhook is not routed",
  );
  assert(
    webhook.includes(
      'handlePaystackRefundEvent(supabase, "refund.failed", data)',
    ),
    "failed refund webhook is not routed",
  );
  assert(
    router.includes('"record_paystack_refund_outcome"'),
    "webhook router bypasses the idempotent refund RPC",
  );
});
