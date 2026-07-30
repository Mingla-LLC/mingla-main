import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPaystackRefund,
  isRetryablePaystackRefundError,
} from "../paystackRefunds.ts";
import {
  runSourceRefundOperation,
  type SourceRefundOperation,
} from "../sourceRefundControlPlane.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function paystackVerify(
  reference: string,
  id: number,
  amount: number,
): Response {
  return json({
    status: true,
    data: {
      id,
      reference,
      status: "success",
      currency: "NGN",
      amount,
    },
  });
}

function setPaystackTestEnvironment(): () => void {
  const originalMode = Deno.env.get("PAYSTACK_MODE");
  const originalKey = Deno.env.get("PAYSTACK_SECRET_KEY_TEST");
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1430fixture");
  return () => {
    if (originalMode === undefined) Deno.env.delete("PAYSTACK_MODE");
    else Deno.env.set("PAYSTACK_MODE", originalMode);
    if (originalKey === undefined) Deno.env.delete("PAYSTACK_SECRET_KEY_TEST");
    else Deno.env.set("PAYSTACK_SECRET_KEY_TEST", originalKey);
  };
}

Deno.test("#1430 Paystack verifies the reference, reconciles by numeric ID, and replays without a second POST", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  const reference = "issue-1430-paystack-happy";
  const merchantNote = "mingla_source_refund:1430:1";
  const transactionId = 1430001;
  const calls: Array<{ method: string; url: string }> = [];
  let providerVisible = false;
  let posts = 0;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.includes(`/transaction/verify/${reference}`)) {
      return Promise.resolve(paystackVerify(reference, transactionId, 10000));
    }
    if (method === "GET") {
      assertStringIncludes(
        url,
        `/refund?transaction=${transactionId}&perPage=100`,
      );
      return Promise.resolve(json({
        status: true,
        data: providerVisible
          ? [{
            id: 14301,
            amount: 10000,
            status: "pending",
            merchant_note: merchantNote,
            transaction: transactionId,
            currency: "NGN",
          }]
          : [],
      }));
    }
    posts += 1;
    providerVisible = true;
    return Promise.resolve(json({
      status: true,
      data: {
        id: 14301,
        amount: 10000,
        status: "pending",
        transaction: transactionId,
        currency: "NGN",
      },
    }));
  }) as typeof fetch;

  try {
    const input = {
      transaction: reference,
      merchantNote,
      amountSubunits: 10000,
      currency: "NGN",
    };
    const first = await createPaystackRefund(input);
    const replay = await createPaystackRefund(input);
    assertEquals(first.id, "14301");
    assertEquals(first.replayed, false);
    assertEquals(replay.id, first.id);
    assertEquals(replay.replayed, true);
    assertEquals(posts, 1);
    assertEquals(calls.map((call) => call.method), [
      "GET",
      "GET",
      "POST",
      "GET",
      "GET",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

Deno.test("#1430 Paystack duplicate ambiguity reconciles exact identity and never emits a third POST", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  const reference = "issue-1430-paystack-lost-response";
  const merchantNote = "mingla_refund:1430-lost-response";
  const transactionId = 1430002;
  let listReads = 0;
  let posts = 0;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes(`/transaction/verify/${reference}`)) {
      return Promise.resolve(paystackVerify(reference, transactionId, 15000));
    }
    if (method === "GET") {
      listReads += 1;
      assertStringIncludes(url, `transaction=${transactionId}`);
      return Promise.resolve(json({
        status: true,
        data: listReads === 1 ? [] : [{
          id: 14302,
          amount: 15000,
          status: "pending",
          merchant_note: merchantNote,
          transaction: transactionId,
        }],
      }));
    }
    posts += 1;
    return Promise.resolve(
      json(
        {
          status: false,
          message: "A refund already exist for this transaction",
        },
        400,
      ),
    );
  }) as typeof fetch;

  try {
    const replay = await createPaystackRefund({
      transaction: reference,
      merchantNote,
      amountSubunits: 15000,
      currency: "NGN",
    });
    assertEquals(replay.id, "14302");
    assertEquals(replay.replayed, true);
    assertEquals(posts, 1);
    assertEquals(listReads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

Deno.test("#1430 Paystack mismatched duplicate remains retryable ambiguity", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  const reference = "issue-1430-paystack-ambiguous";
  const transactionId = 1430003;
  let listReads = 0;
  let posts = 0;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes(`/transaction/verify/${reference}`)) {
      return Promise.resolve(paystackVerify(reference, transactionId, 20000));
    }
    if (method === "GET") {
      listReads += 1;
      return Promise.resolve(json({
        status: true,
        data: listReads === 1 ? [] : [{
          id: 14303,
          amount: 20000,
          status: "pending",
          merchant_note: "different-operation",
          transaction: transactionId,
        }],
      }));
    }
    posts += 1;
    return Promise.resolve(
      json({ status: false, code: "already_exists" }, 400),
    );
  }) as typeof fetch;

  try {
    const error = await assertRejects(
      () =>
        createPaystackRefund({
          transaction: reference,
          merchantNote: "mingla_refund:1430-ambiguous",
          amountSubunits: 20000,
          currency: "NGN",
        }),
      Error,
      "paystack_refund_duplicate_ambiguous",
    );
    assert(isRetryablePaystackRefundError(error));
    assertEquals(posts, 1);
    assertEquals(listReads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

Deno.test("#1430 Paystack identity mismatch fails before refund reconciliation or POST", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setPaystackTestEnvironment();
  let calls = 0;
  globalThis.fetch = ((_input: string | URL | Request) => {
    calls += 1;
    return Promise.resolve(
      paystackVerify("different-reference", 1430004, 5000),
    );
  }) as typeof fetch;

  try {
    await assertRejects(
      () =>
        createPaystackRefund({
          transaction: "issue-1430-paystack-mismatch",
          merchantNote: "mingla_refund:1430-mismatch",
          amountSubunits: 5000,
          currency: "NGN",
        }),
      Error,
      "Paystack transaction identity mismatch",
    );
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

function sourceRefundStripeOperation(): SourceRefundOperation {
  return {
    id: "14300000-0000-4000-8000-000000000001",
    source_type: "venue_reservation",
    source_id: "14300000-0000-4000-8000-000000000002",
    subject_id: "14300000-0000-4000-8000-000000000003",
    brand_id: "14300000-0000-4000-8000-000000000004",
    provider: "stripe",
    currency: "USD",
    original_charge_cents: 10000,
    original_application_fee_cents: 1000,
    buyer_refund_requested_cents: 10000,
    fee_reversal_required_cents: 1000,
    buyer_state: "queued",
    fee_state: "queued",
    active_buyer_attempt_no: 0,
    active_fee_attempt_no: 0,
    provider_payment_reference: "pi_issue1430permission",
    provider_account_reference: "acct_issue1430",
    stripe_application_fee_id: null,
    provider_refund_id: null,
  };
}

function setStripeTestEnvironment(): () => void {
  const originalDisabled = Deno.env.get("SOURCE_REFUNDS_POST_DISABLED");
  const originalModes = Deno.env.get("MINGLA_PAYMENT_MODES_JSON");
  const originalKey = Deno.env.get("STRIPE_RAK_TICKET_REFUND_TEST");
  Deno.env.set("SOURCE_REFUNDS_POST_DISABLED", "false");
  Deno.env.set(
    "MINGLA_PAYMENT_MODES_JSON",
    JSON.stringify({
      schema_version: 1,
      stripe_mode: "test",
      paystack_mode: "test",
    }),
  );
  Deno.env.set(
    "STRIPE_RAK_TICKET_REFUND_TEST",
    "rk_test_issue1430fixture",
  );
  return () => {
    if (originalDisabled === undefined) {
      Deno.env.delete("SOURCE_REFUNDS_POST_DISABLED");
    } else Deno.env.set("SOURCE_REFUNDS_POST_DISABLED", originalDisabled);
    if (originalModes === undefined) {
      Deno.env.delete("MINGLA_PAYMENT_MODES_JSON");
    } else Deno.env.set("MINGLA_PAYMENT_MODES_JSON", originalModes);
    if (originalKey === undefined) {
      Deno.env.delete("STRIPE_RAK_TICKET_REFUND_TEST");
    } else Deno.env.set("STRIPE_RAK_TICKET_REFUND_TEST", originalKey);
  };
}

Deno.test("#1430 Stripe null fee identity proves the connected-account chain before both refund legs", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setStripeTestEnvironment();
  const fetchCalls: Array<{ method: string; url: string }> = [];
  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    fetchCalls.push({ method, url });
    if (url.includes("/v1/payment_intents/")) {
      return Promise.resolve(json({
        id: "pi_issue1430permission",
        latest_charge: "ch_issue1430",
      }));
    }
    if (url.includes("/v1/charges/")) {
      return Promise.resolve(json({
        id: "ch_issue1430",
        amount: 10000,
        currency: "usd",
        application_fee: "fee_issue1430",
      }));
    }
    if (url.endsWith("/v1/application_fees/fee_issue1430")) {
      return Promise.resolve(json({
        id: "fee_issue1430",
        account: "acct_issue1430",
        charge: "ch_issue1430",
        amount: 1000,
        currency: "usd",
      }));
    }
    if (url.endsWith("/v1/refunds")) {
      return Promise.resolve(json({
        id: "re_issue1430",
        amount: 10000,
        status: "succeeded",
      }));
    }
    if (
      url.endsWith(
        "/v1/application_fees/fee_issue1430/refunds",
      )
    ) {
      return Promise.resolve(json({
        id: "fr_issue1430",
        amount: 1000,
      }));
    }
    return Promise.resolve(
      json({ error: { message: "unexpected request" } }, 500),
    );
  }) as typeof fetch;

  const providerEvents: Array<Record<string, unknown>> = [];
  let feeIdentityWrites = 0;
  class Query {
    select(): Query {
      return this;
    }
    eq(): Query {
      return this;
    }
    maybeSingle(): Promise<{ data: null; error: null }> {
      return Promise.resolve({ data: null, error: null });
    }
  }
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "set_source_refund_stripe_fee_identity") {
        feeIdentityWrites += 1;
      }
      if (fn === "ensure_source_refund_attempt") {
        const leg = String(args.p_leg_type);
        return Promise.resolve({
          data: {
            attempt_no: 1,
            idempotency_key: `source-refund-${leg}:1430:1`,
            merchant_note: null,
            provider_operation_id: null,
            reconcile_only: false,
          },
          error: null,
        });
      }
      if (fn === "record_source_refund_provider_event") {
        providerEvents.push(args);
        return Promise.resolve({
          data: {
            source_refund_event_id: providerEvents.length,
            attention_generation: 1,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    },
    from() {
      return new Query();
    },
  };
  const operation = sourceRefundStripeOperation();

  try {
    await runSourceRefundOperation(client, operation);
    assertEquals(feeIdentityWrites, 1);
    assertEquals(operation.stripe_application_fee_id, "fee_issue1430");
    assertEquals(
      providerEvents.map((event) => [
        event.p_leg_type,
        event.p_next_state,
        event.p_provider_operation_id,
      ]),
      [
        ["buyer_refund", "processed", "re_issue1430"],
        ["application_fee_reversal", "processed", "fr_issue1430"],
      ],
    );
    assertEquals(
      fetchCalls.filter((call) => call.method === "POST").length,
      2,
    );

    operation.buyer_state = "processed";
    operation.fee_state = "processed";
    const callCountBeforeReplay = fetchCalls.length;
    await runSourceRefundOperation(client, operation);
    assertEquals(fetchCalls.length, callCountBeforeReplay);
    assertEquals(
      providerEvents.map((event) => event.p_provider_operation_id),
      ["re_issue1430", "fr_issue1430"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

Deno.test("#1430 Stripe identity-read permission denial records a safe fee state before any buyer refund POST", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setStripeTestEnvironment();

  const fetchCalls: Array<{ method: string; url: string }> = [];
  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    fetchCalls.push({
      method: init?.method ?? "GET",
      url: String(input),
    });
    return Promise.resolve(json({
      error: {
        type: "invalid_request_error",
        message: "restricted key cannot read this resource",
      },
    }, 403));
  }) as typeof fetch;

  const providerEvents: Array<Record<string, unknown>> = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "ensure_source_refund_attempt") {
        return Promise.resolve({
          data: {
            attempt_no: 1,
            idempotency_key: "source-refund-fee:1430:1",
            merchant_note: null,
            provider_operation_id: null,
            reconcile_only: false,
          },
          error: null,
        });
      }
      if (fn === "record_source_refund_provider_event") {
        providerEvents.push(args);
      }
      return Promise.resolve({ data: {}, error: null });
    },
  };
  const operation = sourceRefundStripeOperation();

  try {
    await runSourceRefundOperation(client, operation);
    assertEquals(fetchCalls.length, 1);
    assertEquals(fetchCalls[0].method, "GET");
    assertStringIncludes(fetchCalls[0].url, "/v1/payment_intents/");
    assertEquals(providerEvents.length, 1);
    assertEquals(providerEvents[0].p_leg_type, "application_fee_reversal");
    assertEquals(providerEvents[0].p_next_state, "needs_attention");
    assertEquals(providerEvents[0].p_amount_observed_cents, 0);
    assertEquals(providerEvents[0].p_provider_operation_id, null);
    assertEquals(
      providerEvents[0].p_safe_reason_code,
      "stripe_fee_identity_permission_denied",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});
