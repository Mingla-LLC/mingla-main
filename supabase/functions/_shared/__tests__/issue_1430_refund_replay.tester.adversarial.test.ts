import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPaystackRefund,
  isRetryablePaystackRefundError,
  reconcilePaystackRefund,
} from "../paystackRefunds.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setPaystackTestEnvironment(): () => void {
  const originalMode = Deno.env.get("PAYSTACK_MODE");
  const originalKey = Deno.env.get("PAYSTACK_SECRET_KEY_TEST");
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1430adversarial");
  return () => {
    if (originalMode === undefined) Deno.env.delete("PAYSTACK_MODE");
    else Deno.env.set("PAYSTACK_MODE", originalMode);
    if (originalKey === undefined) Deno.env.delete("PAYSTACK_SECRET_KEY_TEST");
    else Deno.env.set("PAYSTACK_SECRET_KEY_TEST", originalKey);
  };
}

Deno.test("#1430 tester adversarial: substituted transaction identity stays ambiguous with no extra POST", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  const reference = "issue-1430-provider-substitution";
  const transactionId = 1430100;
  const substitutedTransactionId = 1430101;
  const merchantNote = "mingla_refund:1430-provider-substitution";
  const methods: string[] = [];
  let verifyReads = 0;
  let listReads = 0;
  let posts = 0;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    methods.push(method);
    if (url.includes(`/transaction/verify/${reference}`)) {
      verifyReads += 1;
      return Promise.resolve(json({
        status: true,
        data: {
          id: transactionId,
          reference,
          status: "success",
          currency: "NGN",
          amount: 18000,
        },
      }));
    }
    if (method === "GET") {
      listReads += 1;
      assertStringIncludes(
        url,
        `/refund?transaction=${transactionId}&perPage=100`,
      );
      return Promise.resolve(json({
        status: true,
        data: [{
          id: 1430102,
          amount: 18000,
          status: "pending",
          merchant_note: merchantNote,
          transaction: substitutedTransactionId,
          currency: "NGN",
        }],
      }));
    }
    posts += 1;
    return Promise.resolve(json({
      status: false,
      message: "A refund already exist for this transaction",
    }, 400));
  }) as typeof fetch;

  try {
    const error = await assertRejects(
      () =>
        createPaystackRefund({
          transaction: reference,
          merchantNote,
          amountSubunits: 18000,
          currency: "NGN",
        }),
      Error,
      "paystack_refund_duplicate_ambiguous",
    );
    assertEquals(isRetryablePaystackRefundError(error), true);
    assertEquals(verifyReads, 2);
    assertEquals(listReads, 2);
    assertEquals(posts, 1);
    assertEquals(methods, ["GET", "GET", "POST", "GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

Deno.test("#1430 tester adversarial: persisted refund identity cannot be substituted during read-only adoption", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  const reference = "issue-1430-persisted-refund-substitution";
  const transactionId = 1430110;
  const methods: string[] = [];

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    methods.push(method);
    if (url.includes(`/transaction/verify/${reference}`)) {
      return Promise.resolve(json({
        status: true,
        data: {
          id: transactionId,
          reference,
          status: "success",
          currency: "NGN",
          amount: 22000,
        },
      }));
    }
    assertEquals(method, "GET");
    assertStringIncludes(url, `transaction=${transactionId}`);
    return Promise.resolve(json({
      status: true,
      data: [{
        id: "provider-refund-substitute",
        amount: 22000,
        status: "pending",
        merchant_note: "mingla_refund:1430-persisted-adoption",
        transaction: transactionId,
        currency: "NGN",
      }],
    }));
  }) as typeof fetch;

  try {
    const match = await reconcilePaystackRefund({
      transaction: reference,
      merchantNote: "mingla_refund:1430-persisted-adoption",
      amountSubunits: 22000,
      currency: "NGN",
      providerRefundId: "provider-refund-authoritative",
    });
    assertEquals(match, null);
    assertEquals(methods, ["GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

Deno.test("#1430 tester adversarial: reversal-pending exact identity is read-only adopted", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  const reference = "issue-1430-reversal-pending-exact";
  const transactionId = 1430120;
  const merchantNote = "mingla_refund:1430-reversal-pending-exact";
  const methods: string[] = [];

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    methods.push(method);
    if (url.includes(`/transaction/verify/${reference}`)) {
      return Promise.resolve(json({
        status: true,
        data: {
          id: transactionId,
          reference,
          status: "reversal-pending",
          currency: "NGN",
          amount: 24000,
        },
      }));
    }
    assertEquals(method, "GET");
    assertStringIncludes(url, `transaction=${transactionId}`);
    return Promise.resolve(json({
      status: true,
      data: [{
        id: "provider-refund-pending-exact",
        amount: 24000,
        status: "pending",
        merchant_note: merchantNote,
        transaction: transactionId,
        currency: "NGN",
      }],
    }));
  }) as typeof fetch;

  try {
    const replay = await createPaystackRefund({
      transaction: reference,
      merchantNote,
      amountSubunits: 24000,
      currency: "NGN",
    });
    assertEquals(replay.id, "provider-refund-pending-exact");
    assertEquals(replay.replayed, true);
    assertEquals(methods, ["GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

Deno.test("#1430 tester adversarial: reversal-pending empty and mismatched rows stay retryable with zero POST", async () => {
  for (const variant of ["empty", "mismatch"] as const) {
    const originalFetch = globalThis.fetch;
    const restoreEnvironment = setPaystackTestEnvironment();
    const reference = `issue-1430-reversal-pending-${variant}`;
    const transactionId = variant === "empty" ? 1430130 : 1430131;
    const merchantNote = `mingla_refund:1430-reversal-pending-${variant}`;
    let listReads = 0;
    let posts = 0;

    globalThis.fetch = ((
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes(`/transaction/verify/${reference}`)) {
        return Promise.resolve(json({
          status: true,
          data: {
            id: transactionId,
            reference,
            status: "reversal-pending",
            currency: "NGN",
            amount: 26000,
          },
        }));
      }
      if (method === "GET") {
        listReads += 1;
        return Promise.resolve(json({
          status: true,
          data: variant === "empty" ? [] : [{
            id: `provider-refund-${variant}`,
            amount: 26000,
            status: "pending",
            merchant_note: `${merchantNote}:wrong`,
            transaction: transactionId,
            currency: "NGN",
          }],
        }));
      }
      posts += 1;
      return Promise.resolve(json({ status: true, data: {} }));
    }) as typeof fetch;

    try {
      const error = await assertRejects(
        () =>
          createPaystackRefund({
            transaction: reference,
            merchantNote,
            amountSubunits: 26000,
            currency: "NGN",
          }),
        Error,
        "paystack_refund_transaction_state_ambiguous",
      );
      assertEquals(isRetryablePaystackRefundError(error), true);
      assertEquals(listReads, 1);
      assertEquals(posts, 0);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvironment();
    }
  }
});

Deno.test("#1430 tester adversarial: reversed exact row adopts while absent identity never POSTs", async () => {
  for (const exact of [true, false]) {
    const originalFetch = globalThis.fetch;
    const restoreEnvironment = setPaystackTestEnvironment();
    const reference = `issue-1430-reversed-${exact ? "exact" : "absent"}`;
    const transactionId = exact ? 1430140 : 1430141;
    const merchantNote = `mingla_refund:1430-reversed-${
      exact ? "exact" : "absent"
    }`;
    let posts = 0;

    globalThis.fetch = ((
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes(`/transaction/verify/${reference}`)) {
        return Promise.resolve(json({
          status: true,
          data: {
            id: transactionId,
            reference,
            status: "reversed",
            currency: "NGN",
            amount: 28000,
          },
        }));
      }
      if (method === "GET") {
        return Promise.resolve(json({
          status: true,
          data: exact
            ? [{
              id: "provider-refund-reversed-exact",
              amount: 28000,
              status: "processed",
              merchant_note: merchantNote,
              transaction: transactionId,
              currency: "NGN",
            }]
            : [],
        }));
      }
      posts += 1;
      return Promise.resolve(json({ status: true, data: {} }));
    }) as typeof fetch;

    try {
      if (exact) {
        const replay = await createPaystackRefund({
          transaction: reference,
          merchantNote,
          amountSubunits: 28000,
          currency: "NGN",
        });
        assertEquals(replay.id, "provider-refund-reversed-exact");
        assertEquals(replay.replayed, true);
      } else {
        const error = await assertRejects(
          () =>
            createPaystackRefund({
              transaction: reference,
              merchantNote,
              amountSubunits: 28000,
              currency: "NGN",
            }),
          Error,
          "paystack_refund_transaction_state_ambiguous",
        );
        assertEquals(isRetryablePaystackRefundError(error), true);
      }
      assertEquals(posts, 0);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvironment();
    }
  }
});

Deno.test("#1430 tester adversarial: success with no exact row is the sole fresh POST authority", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  const reference = "issue-1430-success-post-authority";
  const transactionId = 1430150;
  let posts = 0;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes(`/transaction/verify/${reference}`)) {
      return Promise.resolve(json({
        status: true,
        data: {
          id: transactionId,
          reference,
          status: "success",
          currency: "NGN",
          amount: 30000,
        },
      }));
    }
    if (method === "GET") {
      return Promise.resolve(json({ status: true, data: [] }));
    }
    posts += 1;
    return Promise.resolve(json({
      status: true,
      data: {
        id: "provider-refund-success-authority",
        amount: 30000,
        status: "pending",
        transaction: transactionId,
        currency: "NGN",
      },
    }));
  }) as typeof fetch;

  try {
    const created = await createPaystackRefund({
      transaction: reference,
      merchantNote: "mingla_refund:1430-success-post-authority",
      amountSubunits: 30000,
      currency: "NGN",
    });
    assertEquals(created.id, "provider-refund-success-authority");
    assertEquals(created.replayed, false);
    assertEquals(posts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

Deno.test("#1430 tester adversarial: unknown or malformed identity fails before list and POST", async () => {
  const valid = {
    id: 1430160,
    reference: "issue-1430-invalid-identity",
    status: "success",
    currency: "NGN",
    amount: 32000,
  };
  const cases: Array<{ name: string; data: Record<string, unknown> }> = [
    { name: "unknown-state", data: { ...valid, status: "processing" } },
    { name: "missing-state", data: { ...valid, status: undefined } },
    { name: "reference", data: { ...valid, reference: "substituted" } },
    { name: "currency", data: { ...valid, currency: "GHS" } },
    { name: "id", data: { ...valid, id: 0 } },
    { name: "amount", data: { ...valid, amount: 32000.5 } },
  ];

  for (const fixture of cases) {
    const originalFetch = globalThis.fetch;
    const restoreEnvironment = setPaystackTestEnvironment();
    let listReads = 0;
    let posts = 0;

    globalThis.fetch = ((
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/transaction/verify/")) {
        return Promise.resolve(json({ status: true, data: fixture.data }));
      }
      if (method === "GET") {
        listReads += 1;
        return Promise.resolve(json({ status: true, data: [] }));
      }
      posts += 1;
      return Promise.resolve(json({ status: true, data: {} }));
    }) as typeof fetch;

    try {
      await assertRejects(
        () =>
          createPaystackRefund({
            transaction: valid.reference,
            merchantNote: `mingla_refund:1430-invalid-${fixture.name}`,
            amountSubunits: 32000,
            currency: "NGN",
          }),
        Error,
        "Paystack transaction identity mismatch",
      );
      assertEquals(listReads, 0, fixture.name);
      assertEquals(posts, 0, fixture.name);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvironment();
    }
  }
});

Deno.test("#1430 tester adversarial: duplicate recovery re-verifies reversal-pending and adopts only exact identity", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  const reference = "issue-1430-duplicate-reversal-pending";
  const transactionId = 1430170;
  const merchantNote = "mingla_refund:1430-duplicate-reversal-pending";
  const methods: string[] = [];
  let verifyReads = 0;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    methods.push(method);
    if (url.includes(`/transaction/verify/${reference}`)) {
      verifyReads += 1;
      return Promise.resolve(json({
        status: true,
        data: {
          id: transactionId,
          reference,
          status: verifyReads === 1 ? "success" : "reversal-pending",
          currency: "NGN",
          amount: 34000,
        },
      }));
    }
    if (method === "GET") {
      return Promise.resolve(json({
        status: true,
        data: verifyReads === 1 ? [] : [{
          id: "provider-refund-duplicate-recovered",
          amount: 34000,
          status: "pending",
          merchant_note: merchantNote,
          transaction: transactionId,
          currency: "NGN",
        }],
      }));
    }
    return Promise.resolve(json({
      status: false,
      message: "A refund already exist for this transaction",
    }, 400));
  }) as typeof fetch;

  try {
    const replay = await createPaystackRefund({
      transaction: reference,
      merchantNote,
      amountSubunits: 34000,
      currency: "NGN",
    });
    assertEquals(replay.id, "provider-refund-duplicate-recovered");
    assertEquals(replay.replayed, true);
    assertEquals(methods, ["GET", "GET", "POST", "GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});
