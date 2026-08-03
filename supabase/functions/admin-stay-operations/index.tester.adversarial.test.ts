import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAdminStayOperationsHandler } from "./index.ts";

const attemptId = "00000000-1427-4000-8000-000000000101";
const groupId = "00000000-1427-4000-8000-000000000102";

type RpcCall = { name: string; args: Record<string, unknown> };

function context(
  attempt: Record<string, unknown>,
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>,
) {
  return {
    userId: "00000000-1427-4000-8000-000000000103",
    userEmail: "tester@example.test",
    service: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: attempt, error: null }),
          }),
        }),
      }),
      rpc,
    },
  };
}

function request(reason: string) {
  return new Request("http://local/admin-stay-operations", {
    method: "POST",
    headers: {
      authorization: "Bearer active-admin",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      mode: "reconcile_payment",
      paymentAttemptId: attemptId,
      reason,
    }),
  });
}

function stripeAttempt() {
  return {
    id: attemptId,
    group_id: groupId,
    provider: "stripe",
    connected_account_ref: "acct_tester_stay",
    amount_minor: 12500,
    currency_code: "USD",
    state: "ambiguous",
    provider_payment_ref: "pi_tester_stay",
    provider_charge_ref: null,
  };
}

Deno.test("tester: cancelled Stripe truth converges from the authorized amount rather than zero received", async () => {
  const calls: RpcCall[] = [];
  const handler = createAdminStayOperationsHandler({
    resolveAdmin: () => Promise.resolve(context(
      stripeAttempt(),
      (name, args) => {
        calls.push({ name, args });
        return Promise.resolve({ data: { state: "failed" }, error: null });
      },
    )),
    retrieveStripeIntent: () => Promise.resolve({
      id: "pi_tester_stay",
      status: "canceled",
      amount: 12500,
      amount_received: 0,
      currency: "usd",
      metadata: {
        mingla_purpose: "stay_reservation",
        stay_group_id: groupId,
        stay_payment_attempt_id: attemptId,
      },
    }),
  });

  const response = await handler(request("Provider confirms cancellation"));
  assertEquals(response.status, 200);
  assertEquals(calls.map((call) => call.name), [
    "admin_write_audit",
    "issue_1389_record_payment_create_failure",
  ]);
  assertObjectMatch(calls[1]?.args ?? {}, {
    p_attempt_id: attemptId,
    p_failure_code: "provider_payment_cancelled",
    p_ambiguous: false,
  });
});

Deno.test("tester: audit failure is fail-closed before provider truth mutates Stay payment state", async () => {
  const calls: RpcCall[] = [];
  const handler = createAdminStayOperationsHandler({
    resolveAdmin: () => Promise.resolve(context(
      stripeAttempt(),
      (name, args) => {
        calls.push({ name, args });
        if (name === "admin_write_audit") {
          return Promise.resolve({
            data: null,
            error: { message: "audit sink unavailable with private detail" },
          });
        }
        return Promise.resolve({ data: { state: "confirmed" }, error: null });
      },
    )),
    retrieveStripeIntent: () => Promise.resolve({
      id: "pi_tester_stay",
      status: "succeeded",
      amount: 12500,
      amount_received: 12500,
      currency: "usd",
      latest_charge: "ch_tester_stay",
      metadata: {
        mingla_purpose: "stay_reservation",
        stay_group_id: groupId,
        stay_payment_attempt_id: attemptId,
      },
    }),
  });

  const response = await handler(request("Verify provider before support action"));
  const body = await response.json();
  assertEquals(response.status, 500);
  assertEquals(body.error, "audit_failed");
  assertEquals(calls.map((call) => call.name), ["admin_write_audit"]);
  assertEquals(JSON.stringify(body).includes("private detail"), false);
});
