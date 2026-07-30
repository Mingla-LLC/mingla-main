import {
  assertEquals,
  assertMatch,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const venueId = "00000000-1388-4000-8000-000000000004";
const quoteId = "00000000-1388-4000-8000-000000000080";

Deno.test("Stay reservation boundary rejects missing bearer before RPC", async () => {
  let created = false;
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      body: JSON.stringify({
        action: "quote",
        payload: {
          venueId,
          idempotencyKey: "quote-key-1388",
          lines: [{}],
        },
      }),
    }),
    {
      createRpcClient: () => {
        created = true;
        throw new Error("must not create");
      },
    },
  );
  assertEquals(response.status, 401);
  assertEquals(created, false);
});

Deno.test("Stay quote forwards one bounded canonical RPC envelope", async () => {
  let call: { name: string; params: Record<string, unknown> } | null = null;
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "x-request-id": "00000000-1388-4000-8000-000000000099",
      },
      body: JSON.stringify({
        action: "quote",
        payload: {
          venueId,
          idempotencyKey: "quote-key-1388",
          lines: [{ kind: "room" }],
        },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          call = { name, params };
          return Promise.resolve({
            data: { quoteId, mode: "instant", totalMinor: "12000" },
            error: null,
          });
        },
      }),
    },
  );
  assertEquals(response.status, 200);
  assertObjectMatch(call ?? {}, {
    name: "biz_manage_stay_reservation",
    params: {
      p_action: "quote",
      p_expected_version: null,
      p_request_id: "00000000-1388-4000-8000-000000000099",
    },
  });
  assertObjectMatch(await response.json(), {
    kind: "success",
    data: { totalMinor: "12000" },
  });
});

Deno.test("group creation requires optimistic version and guest object", async () => {
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({
        action: "create_group",
        payload: {
          quoteId,
          idempotencyKey: "group-key-1388",
          guest: { name: "Ada" },
        },
      }),
    }),
    {
      createRpcClient: () => {
        throw new Error("must not create");
      },
    },
  );
  assertEquals(response.status, 422);
});

Deno.test("inventory conflict is safe 409 with no database detail", async () => {
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({
        action: "create_group",
        expectedVersion: 1,
        payload: {
          quoteId,
          idempotencyKey: "group-key-1388",
          guest: { name: "Ada", email: "ada@example.test" },
        },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "40001",
              message: "stay_inventory_changed secret row detail",
            },
          }),
      }),
    },
  );
  const body = await response.json();
  assertEquals(response.status, 409);
  assertEquals(body.code, "stay_inventory_changed");
  assertEquals(JSON.stringify(body).includes("secret row detail"), false);
});

Deno.test("non-object JSON is rejected before any RPC call", async () => {
  let called = false;
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: "null",
    }),
    {
      createRpcClient: () => {
        called = true;
        return {
          rpc: () => Promise.resolve({ data: null, error: null }),
        };
      },
    },
  );
  assertEquals(response.status, 422);
  assertEquals(called, false);
});

Deno.test("invalid caller request ID is replaced with a server UUID", async () => {
  let rpcRequestId: unknown;
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "x-request-id": "not-a-uuid",
      },
      body: JSON.stringify({
        action: "quote",
        payload: {
          venueId,
          idempotencyKey: "quote-key-1388",
          lines: [{ kind: "room" }],
        },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: (_name, params) => {
          rpcRequestId = params.p_request_id;
          return Promise.resolve({
            data: { quoteId },
            error: null,
          });
        },
      }),
    },
  );
  assertEquals(response.status, 200);
  assertMatch(
    String(rpcRequestId),
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

Deno.test("Stay payment uses prepared server money then service-role binds provider identity", async () => {
  const groupId = "00000000-1389-4000-8000-000000000101";
  const attemptId = "00000000-1389-4000-8000-000000000102";
  const calls: Array<{ lane: string; name: string; params: Record<string, unknown> }> = [];
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: { authorization: "Bearer guest-token" },
      body: JSON.stringify({
        action: "create_payment",
        expectedVersion: 4,
        payload: {
          groupId,
          idempotencyKey: "stay-payment-1389",
          amountMinor: "1",
          currencyCode: "USD",
          connectedAccountRef: "acct_attacker",
        },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          calls.push({ lane: "user", name, params });
          return Promise.resolve({
            data: {
              attemptId,
              groupId,
              provider: "stripe",
              state: "created",
              connectedAccountRef: "acct_server",
              amountMinor: "42000",
              currencyCode: "NGN",
              applicationFeeMinor: "4200",
              buyerEmail: "guest@example.test",
            },
            error: null,
          });
        },
      }),
      createServiceRpcClient: () => ({
        rpc: (name, params) => {
          calls.push({ lane: "service", name, params });
          return Promise.resolve({ data: {}, error: null });
        },
      }),
      createPaymentSession: (prepared) => {
        assertEquals(prepared.amountMinor, "42000");
        assertEquals(prepared.currencyCode, "NGN");
        assertEquals(prepared.connectedAccountRef, "acct_server");
        return Promise.resolve({
          kind: "requires_payment",
          provider: "stripe",
          attemptId,
          providerPaymentRef: "pi_stay_1389",
          clientSecret: "pi_stay_1389_secret",
          publishableKey: "pk_test_1389",
          stripeAccountId: "acct_server",
          amountMinor: "42000",
          currencyCode: "NGN",
        });
      },
    },
  );
  assertEquals(response.status, 200);
  assertObjectMatch(calls[0], {
    lane: "user",
    name: "issue_1389_prepare_payment",
    params: {
      p_group_id: groupId,
      p_idempotency_key: "stay-payment-1389",
      p_expected_group_version: 4,
    },
  });
  assertObjectMatch(calls[1], {
    lane: "service",
    name: "issue_1389_bind_payment_attempt",
    params: {
      p_attempt_id: attemptId,
      p_provider_payment_ref: "pi_stay_1389",
    },
  });
});

Deno.test("ambiguous provider creation preserves inventory for reconciliation", async () => {
  const groupId = "00000000-1389-4000-8000-000000000111";
  const attemptId = "00000000-1389-4000-8000-000000000112";
  let failureParams: Record<string, unknown> | null = null;
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: { authorization: "Bearer guest-token" },
      body: JSON.stringify({
        action: "create_payment",
        expectedVersion: 2,
        payload: { groupId, idempotencyKey: "stay-payment-timeout-1389" },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: () =>
          Promise.resolve({
            data: {
              attemptId,
              groupId,
              provider: "stripe",
              state: "created",
              connectedAccountRef: "acct_server",
              amountMinor: "10000",
              currencyCode: "USD",
              applicationFeeMinor: "1000",
              buyerEmail: "guest@example.test",
            },
            error: null,
          }),
      }),
      createServiceRpcClient: () => ({
        rpc: (name, params) => {
          if (name === "issue_1389_record_payment_create_failure") {
            failureParams = params;
          }
          return Promise.resolve({ data: {}, error: null });
        },
      }),
      createPaymentSession: () => {
        throw new Error("network_timeout_after_submit");
      },
    },
  );
  assertEquals(response.status, 502);
  assertObjectMatch(failureParams ?? {}, {
    p_attempt_id: attemptId,
    p_failure_code: "provider_create_ambiguous",
    p_ambiguous: true,
  });
});
