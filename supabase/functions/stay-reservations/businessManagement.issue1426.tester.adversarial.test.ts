import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");

const venueId = "00000000-1426-4000-8000-000000000011";
const groupId = "00000000-1426-4000-8000-000000000020";
const lineId = "00000000-1426-4000-8000-000000000021";
const requestId = "00000000-1426-4000-8000-000000000099";

function request(
  body: Record<string, unknown>,
  includeAuthorization = true,
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-request-id": requestId,
  });
  if (includeAuthorization) {
    headers.set("authorization", "Bearer staff-token");
  }
  return new Request("http://local/stay-reservations", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

Deno.test("Stay staff routes reject unauthenticated and malformed cancellation requests before any RPC", async () => {
  let rpcCalls = 0;
  const dependencies = {
    createRpcClient: () => ({
      rpc: () => {
        rpcCalls += 1;
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };

  const unauthenticated = await handleStayReservations(
    request({ action: "list_staff_groups", payload: { venueId } }, false),
    dependencies,
  );
  const noSelectedLines = await handleStayReservations(
    request({
      action: "cancel_preview",
      expectedVersion: 4,
      payload: { groupId, selectedLineIds: [] },
    }),
    dependencies,
  );
  const invalidVersion = await handleStayReservations(
    request({
      action: "cancel_preview",
      expectedVersion: 0,
      payload: { groupId, selectedLineIds: [lineId] },
    }),
    dependencies,
  );

  assertEquals(unauthenticated.status, 401);
  assertEquals(noSelectedLines.status, 422);
  assertEquals(invalidVersion.status, 422);
  assertEquals(rpcCalls, 0);
});

Deno.test("Stay staff permission and stale-version failures preserve safe public codes without leaking database detail", async () => {
  let call = 0;
  const dependencies = {
    createRpcClient: () => ({
      rpc: () => {
        call += 1;
        return Promise.resolve({
          data: null,
          error: call === 1
            ? {
              message: "forbidden private_brand_row=do-not-leak",
              code: "42501",
            }
            : {
              message: "stay_version_conflict internal_group_version=88",
              code: "40001",
            },
        });
      },
    }),
  };

  const forbidden = await handleStayReservations(
    request({ action: "get_staff_group", payload: { groupId } }),
    dependencies,
  );
  const stale = await handleStayReservations(
    request({
      action: "approve_request",
      expectedVersion: 2,
      payload: {
        groupId,
        idempotencyKey: "staff-approve-adversarial-1426",
      },
    }),
    dependencies,
  );
  const forbiddenBody = await forbidden.json();
  const staleBody = await stale.json();

  assertEquals(forbidden.status, 403);
  assertEquals(forbiddenBody.code, "forbidden");
  assertEquals(stale.status, 409);
  assertEquals(staleBody.code, "stay_version_conflict");
  assertEquals(forbiddenBody.requestId, requestId);
  assertEquals(staleBody.requestId, requestId);
  assertFalse(JSON.stringify(forbiddenBody).includes("do-not-leak"));
  assertFalse(JSON.stringify(staleBody).includes("internal_group_version"));
});

Deno.test("Unknown Stay staff database failures are generic and redact raw operational data", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleStayReservations(
      request({ action: "list_staff_groups", payload: { venueId } }),
      {
        createRpcClient: () => ({
          rpc: () =>
            Promise.resolve({
              data: null,
              error: {
                message: "database_password=never-expose-this",
                code: "XX000",
              },
            }),
        }),
      },
    );
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(body.code, "internal_error");
    assertEquals(
      body.message,
      "We couldn’t complete this Stay reservation. Try again.",
    );
    assertFalse(JSON.stringify(body).includes("never-expose-this"));
  } finally {
    console.error = originalError;
  }
});
