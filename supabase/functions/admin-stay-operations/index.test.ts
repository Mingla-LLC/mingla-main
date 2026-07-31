import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAdminStayOperationsHandler } from "./index.ts";

const attemptId = "00000000-1427-4000-8000-000000000001";
const groupId = "00000000-1427-4000-8000-000000000002";

type RpcCall = { name: string; args: Record<string, unknown> };
type MockContext = {
  userId: string;
  userEmail: string;
  service: {
    from: (table: string) => unknown;
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
};

function adminContext(
  attempt: Record<string, unknown>,
  calls: RpcCall[],
): MockContext {
  return {
    userId: "00000000-1427-4000-8000-000000000003",
    userEmail: "admin@example.test",
    service: {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: table === "stay_payment_attempts" ? attempt : null,
                error: null,
              }),
          }),
        }),
      }),
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve({
          data: name === "issue_1389_finalize_payment"
            ? { state: "confirmed" }
            : { auditId: "00000000-1427-4000-8000-000000000004" },
          error: null,
        });
      },
    },
  };
}

function request(
  body: Record<string, unknown>,
  authorization = "Bearer admin-token",
) {
  return new Request("http://local/admin-stay-operations", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("Admin Stay operations rejects a missing active Admin session", async () => {
  const handler = createAdminStayOperationsHandler({
    resolveAdmin: () => Promise.resolve(null),
  });
  const response = await handler(request({
    mode: "reconcile_payment",
    paymentAttemptId: attemptId,
    reason: "Support investigation",
  }, ""));
  assertEquals(response.status, 401);
});

Deno.test("Admin Stay payment reconciliation accepts only the bounded request shape", async () => {
  let providerRead = false;
  const handler = createAdminStayOperationsHandler({
    resolveAdmin: () => Promise.resolve(adminContext({}, [])),
    retrieveStripeIntent: () => {
      providerRead = true;
      return Promise.resolve({});
    },
  });
  const response = await handler(request({
    mode: "reconcile_payment",
    paymentAttemptId: attemptId,
    reason: "Support investigation",
    amountMinor: 1,
  }));
  assertEquals(response.status, 400);
  assertEquals(providerRead, false);
});

Deno.test("Stripe reconciliation trusts retrieved provider evidence and audits once", async () => {
  const calls: RpcCall[] = [];
  const attempt = {
    id: attemptId,
    group_id: groupId,
    provider: "stripe",
    connected_account_ref: "acct_stay_test",
    amount_minor: 12500,
    currency_code: "USD",
    state: "ambiguous",
    provider_payment_ref: "pi_stay_test",
    provider_charge_ref: null,
  };
  const handler = createAdminStayOperationsHandler({
    resolveAdmin: () => Promise.resolve(adminContext(attempt, calls)),
    retrieveStripeIntent: (paymentRef, accountRef) => {
      assertEquals(paymentRef, "pi_stay_test");
      assertEquals(accountRef, "acct_stay_test");
      return Promise.resolve({
        id: "pi_stay_test",
        status: "succeeded",
        amount_received: 12500,
        currency: "usd",
        latest_charge: { id: "ch_stay_test" },
        metadata: {
          mingla_purpose: "stay_reservation",
          stay_group_id: groupId,
          stay_payment_attempt_id: attemptId,
        },
      });
    },
  });
  const response = await handler(request({
    mode: "reconcile_payment",
    paymentAttemptId: attemptId,
    reason: "Provider showed a completed charge",
  }));
  assertEquals(response.status, 200);
  assertEquals(
    calls.filter((call) => call.name === "issue_1389_finalize_payment").length,
    1,
  );
  assertEquals(
    calls.filter((call) => call.name === "admin_write_audit").length,
    1,
  );
  assertObjectMatch(
    calls.find((call) => call.name === "issue_1389_finalize_payment")?.args ??
      {},
    {
      p_provider: "stripe",
      p_provider_payment_ref: "pi_stay_test",
      p_provider_charge_ref: "ch_stay_test",
      p_amount_minor: 12500,
      p_currency_code: "USD",
    },
  );
});

Deno.test("Provider metadata mismatch cannot converge or audit a payment", async () => {
  const calls: RpcCall[] = [];
  const attempt = {
    id: attemptId,
    group_id: groupId,
    provider: "paystack",
    connected_account_ref: null,
    amount_minor: 850000,
    currency_code: "NGN",
    state: "ambiguous",
    provider_payment_ref: "stay-paystack-ref",
    provider_charge_ref: null,
  };
  const handler = createAdminStayOperationsHandler({
    resolveAdmin: () => Promise.resolve(adminContext(attempt, calls)),
    verifyPaystack: () =>
      Promise.resolve({
        id: 42,
        reference: "stay-paystack-ref",
        status: "success",
        amount: 850000,
        currency: "NGN",
        fees: 1000,
        metadata: {
          mingla_purpose: "stay_reservation",
          stay_group_id: "00000000-1427-4000-8000-000000000099",
          stay_payment_attempt_id: attemptId,
        },
      }),
  });
  const response = await handler(request({
    mode: "reconcile_payment",
    paymentAttemptId: attemptId,
    reason: "Verify ambiguous Paystack charge",
  }));
  assertEquals(response.status, 409);
  assertEquals(calls.length, 0);
});

Deno.test("Paystack reconciliation rejects a subaccount-settled Stay charge", async () => {
  const calls: RpcCall[] = [];
  const attempt = {
    id: attemptId,
    group_id: groupId,
    provider: "paystack",
    connected_account_ref: "ACCT_stored_brand",
    amount_minor: 850000,
    currency_code: "NGN",
    state: "ambiguous",
    provider_payment_ref: "stay-paystack-ref",
    provider_charge_ref: null,
  };
  const handler = createAdminStayOperationsHandler({
    resolveAdmin: () => Promise.resolve(adminContext(attempt, calls)),
    verifyPaystack: () =>
      Promise.resolve({
        id: 42,
        reference: "stay-paystack-ref",
        status: "success",
        amount: 850000,
        currency: "NGN",
        fees: 1000,
        subaccount: { subaccount_code: "ACCT_unexpected_split" },
        metadata: {
          mingla_purpose: "stay_reservation",
          stay_group_id: groupId,
          stay_payment_attempt_id: attemptId,
        },
      }),
  });
  const response = await handler(request({
    mode: "reconcile_payment",
    paymentAttemptId: attemptId,
    reason: "Verify settlement destination",
  }));
  assertEquals(response.status, 409);
  assertEquals(calls.length, 0);
});

Deno.test("payment convergence failures never expose database detail", async () => {
  const calls: RpcCall[] = [];
  const attempt = {
    id: attemptId,
    group_id: groupId,
    provider: "stripe",
    connected_account_ref: "acct_stay_test",
    amount_minor: 12500,
    currency_code: "USD",
    state: "ambiguous",
    provider_payment_ref: "pi_stay_test",
    provider_charge_ref: null,
  };
  const context = adminContext(attempt, calls);
  context.service.rpc = (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "issue_1389_finalize_payment") {
      return Promise.resolve({
        data: null,
        error: { message: "private row and database detail" },
      });
    }
    return Promise.resolve({ data: {}, error: null });
  };
  const handler = createAdminStayOperationsHandler({
    resolveAdmin: () => Promise.resolve(context),
    retrieveStripeIntent: () =>
      Promise.resolve({
        id: "pi_stay_test",
        status: "succeeded",
        amount_received: 12500,
        currency: "usd",
        latest_charge: "ch_stay_test",
        metadata: {
          mingla_purpose: "stay_reservation",
          stay_group_id: groupId,
          stay_payment_attempt_id: attemptId,
        },
      }),
  });
  const response = await handler(request({
    mode: "reconcile_payment",
    paymentAttemptId: attemptId,
    reason: "Recheck stored provider evidence",
  }));
  const body = await response.json();
  assertEquals(response.status, 409);
  assertEquals(body.error, "payment_convergence_failed");
  assertEquals(JSON.stringify(body).includes("private row"), false);
});
