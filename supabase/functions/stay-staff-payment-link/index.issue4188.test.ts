import {
  assertEquals,
  assertFalse,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleStayStaffPaymentLink,
  resetStayStaffPaymentLinkRateLimitForTests,
} from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const token = "A".repeat(43);
const groupId = "00000000-4188-4000-8000-000000000020";
const attemptId = "00000000-4188-4000-8000-000000000030";

function request(
  action: "view" | "pay",
  extra: Record<string, unknown> = {},
): Request {
  return new Request("http://local/stay-staff-payment-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, token, ...extra }),
  });
}

Deno.test("staff Stay payment link view returns only the RPC safe projection", async () => {
  resetStayStaffPaymentLinkRateLimitForTests();
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const response = await handleStayStaffPaymentLink(request("view"), {
    createServiceRpcClient: () => ({
      rpc: (name, params) => {
        calls.push({ name, params });
        return Promise.resolve({
          data: {
            groupId,
            publicReference: "STAY-4188",
            guestName: "Link Guest",
            totalMinor: "12000",
            currencyCode: "USD",
            version: 4,
          },
          error: null,
        });
      },
    }),
  });
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.data.groupId, groupId);
  assertFalse(JSON.stringify(body).includes(token));
  assertObjectMatch(calls[0], {
    name: "issue_4188_staff_payment_link_details",
  });
  assertEquals(String(calls[0].params.p_token_hash).startsWith("\\x"), true);
});

Deno.test("staff Stay payment link pay uses canonical prepare, provider, and bind rails", async () => {
  resetStayStaffPaymentLinkRateLimitForTests();
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const response = await handleStayStaffPaymentLink(
    request("pay", {
      idempotencyKey: "guest-link-payment-4188",
      expectedVersion: 4,
    }),
    {
      createServiceRpcClient: () => ({
        rpc: (name, params) => {
          calls.push({ name, params });
          if (name === "issue_4188_prepare_staff_link_payment") {
            return Promise.resolve({
              data: {
                attemptId,
                groupId,
                provider: "stripe",
                connectedAccountRef: "acct_4188",
                amountMinor: "12000",
                currencyCode: "USD",
                applicationFeeMinor: "1200",
                buyerEmail: "link@example.test",
                state: "created",
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
      createPaymentSession: () =>
        Promise.resolve({
          kind: "requires_payment",
          provider: "stripe",
          attemptId,
          providerPaymentRef: "pi_4188",
          clientSecret: "pi_4188_secret_abc",
          publishableKey: "pk_test_4188",
          stripeAccountId: "acct_4188",
          amountMinor: "12000",
          currencyCode: "USD",
        }),
    },
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.data.attemptId, attemptId);
  assertEquals(calls.map((call) => call.name), [
    "issue_4188_prepare_staff_link_payment",
    "issue_1389_bind_payment_attempt",
  ]);
  assertObjectMatch(calls[1].params, {
    p_attempt_id: attemptId,
    p_provider_payment_ref: "pi_4188",
  });
});

Deno.test("staff Stay payment link rejects malformed and throttled tokens before database work", async () => {
  resetStayStaffPaymentLinkRateLimitForTests();
  let rpcCalls = 0;
  const dependencies = {
    createServiceRpcClient: () => ({
      rpc: () => {
        rpcCalls += 1;
        return Promise.resolve({ data: {}, error: null });
      },
    }),
  };
  const malformed = await handleStayStaffPaymentLink(
    new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "view", token: "too-short" }),
    }),
    dependencies,
  );
  let finalResponse = malformed;
  for (let index = 0; index < 31; index += 1) {
    finalResponse = await handleStayStaffPaymentLink(
      request("view"),
      dependencies,
    );
  }

  assertEquals(malformed.status, 400);
  assertEquals(finalResponse.status, 429);
  assertEquals(rpcCalls, 30);
});

Deno.test("staff Stay payment link preserves already-pending as a conflict, not an ambiguous failure", async () => {
  resetStayStaffPaymentLinkRateLimitForTests();
  const response = await handleStayStaffPaymentLink(
    request("pay", {
      idempotencyKey: "guest-link-payment-4188",
      expectedVersion: 4,
    }),
    {
      createServiceRpcClient: () => ({
        rpc: (name) =>
          Promise.resolve({
            data: name === "issue_4188_prepare_staff_link_payment"
              ? {
                attemptId,
                groupId,
                provider: "paystack",
                connectedAccountRef: "ACCT_4188",
                amountMinor: "12000",
                currencyCode: "NGN",
                applicationFeeMinor: "1200",
                buyerEmail: "link@example.test",
                state: "pending",
              }
              : null,
            error: null,
          }),
      }),
      createPaymentSession: () =>
        Promise.reject(new Error("stay_payment_already_pending")),
    },
  );
  const body = await response.json();

  assertEquals(response.status, 409);
  assertEquals(body.code, "stay_payment_already_pending");
});
