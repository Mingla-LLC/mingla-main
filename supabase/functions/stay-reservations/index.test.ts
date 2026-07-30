import {
  assertEquals,
  assertMatch,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");

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
