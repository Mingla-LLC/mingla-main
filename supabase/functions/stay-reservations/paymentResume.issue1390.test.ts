import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const groupId = "00000000-1390-4000-8000-000000000301";
const attemptId = "00000000-1390-4000-8000-000000000302";

function paymentRequest(): Request {
  return new Request("http://local/stay-reservations", {
    method: "POST",
    headers: { authorization: "Bearer guest-token" },
    body: JSON.stringify({
      action: "create_payment",
      expectedVersion: 4,
      payload: {
        groupId,
        idempotencyKey: `stay:payment:${groupId}`,
      },
    }),
  });
}

function dependencies(providerCode: string) {
  let failureRecorded = false;
  return {
    value: {
      createRpcClient: () => ({
        rpc: () =>
          Promise.resolve({
            data: {
              attemptId,
              groupId,
              provider: "stripe",
              providerPaymentRef: "pi_stay_existing",
              state: "pending",
              connectedAccountRef: "acct_server",
              amountMinor: "42000",
              currencyCode: "USD",
              applicationFeeMinor: "4200",
              buyerEmail: "guest@example.test",
            },
            error: null,
          }),
      }),
      createServiceRpcClient: () => ({
        rpc: (name: string) => {
          if (name === "issue_1389_record_payment_create_failure") {
            failureRecorded = true;
          }
          return Promise.resolve({ data: {}, error: null });
        },
      }),
      createPaymentSession: () => {
        throw new Error(providerCode);
      },
    },
    failureRecorded: () => failureRecorded,
  };
}

Deno.test("an already-pending Stay payment returns conflict without making it ambiguous", async () => {
  const deps = dependencies("stay_payment_already_pending");
  const response = await handleStayReservations(paymentRequest(), deps.value);
  assertEquals(response.status, 409);
  assertObjectMatch(await response.json(), {
    kind: "error",
    code: "stay_payment_already_pending",
  });
  assertEquals(deps.failureRecorded(), false);
});

Deno.test("a temporary Stripe resume read failure remains retryable and unmutated", async () => {
  const deps = dependencies("stay_payment_resume_unavailable");
  const response = await handleStayReservations(paymentRequest(), deps.value);
  assertEquals(response.status, 503);
  assertObjectMatch(await response.json(), {
    kind: "error",
    code: "stay_payment_resume_unavailable",
  });
  assertEquals(deps.failureRecorded(), false);
});

Deno.test("Stay payment rejects an unknown presentation surface before preparation", async () => {
  let called = false;
  const request = new Request("http://local/stay-reservations", {
    method: "POST",
    headers: { authorization: "Bearer guest-token" },
    body: JSON.stringify({
      action: "create_payment",
      expectedVersion: 4,
      payload: {
        groupId,
        idempotencyKey: `stay:payment:${groupId}`,
        surface: "desktop",
      },
    }),
  });
  const response = await handleStayReservations(request, {
    createRpcClient: () => {
      called = true;
      throw new Error("must not prepare");
    },
  });
  assertEquals(response.status, 422);
  assertEquals(called, false);
});
